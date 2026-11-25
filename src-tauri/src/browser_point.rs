//! What a person points at on a page: the thing under the pointer. Positions are fractions of the
//! page's visible area, so the interface needs neither the page's zoom nor its scroll position.

use serde::Serialize;
use serde_json::{Value, json};
use tauri::Manager;

use crate::browser_ai::{BrowserAi, GuestAgent, GuestTarget};

/// The objects one question holds in the page; released when it is answered.
const GROUP: &str = "alwith-point";

/// The element a point falls on, climbing from text to the element that holds it. The page as a
/// whole is no element to point at: a point on its background is a spot.
const ELEMENT: &str = "function() { const element = this.nodeType === 1 ? this : this.parentElement; \
     return element && element !== document.body && element !== document.documentElement ? element : null }";

/// How wide and high the spot around a point on nothing in particular is, in page pixels.
const SPOT: f64 = 48.0;

/// The share of the visible area from which an element counts as the page's background.
const BACKDROP: f64 = 0.6;

/// What a person would call the element: its kind, the words on it and around it. A field's
/// contents are never read. `selector` matches this element and no other, so a conversation acts
/// on exactly what was pointed at; an element inside a frame or a shadow tree has none.
const DESCRIBE: &str = r#"function() {
  // Editors keep characters of no width in their text; they are no words.
  const plain = (value) => (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
  const words = (value) => plain(value).slice(0, 200)
  const field = this.matches('input, textarea, select')
  const label = this.getAttribute('aria-label') || this.getAttribute('alt') || this.getAttribute('title')
    || this.getAttribute('placeholder') || (this.labels && this.labels[0] && this.labels[0].innerText)
  const heading = this.closest('section, article, form, nav, header, footer, main, dialog, li, tr')
  const only = (selector) => {
    try { return document.querySelectorAll(selector).length === 1 } catch { return false }
  }
  let selector = ''
  if (this.getRootNode() === document && window.top === window) {
    const steps = []
    for (let element = this; element && element !== document.documentElement; element = element.parentElement) {
      const id = element.id && '#' + CSS.escape(element.id)
      if (id && only(id)) { steps.unshift(id); break }
      const twins = [...element.parentElement.children].filter((child) => child.tagName === element.tagName)
      const nth = twins.length > 1 ? ':nth-of-type(' + (twins.indexOf(element) + 1) + ')' : ''
      steps.unshift(element.tagName.toLowerCase() + nth)
    }
    const path = steps.join(' > ')
    if (path.length <= 300 && only(path)) selector = path
  }
  // In a document, the paragraph the element is part of says which one it is. A paragraph is told by
  // how the page lays it out: editors build theirs from whatever elements they like.
  let part = this
  while (part.parentElement && getComputedStyle(part).display.startsWith('inline')) part = part.parentElement
  const said = part === document.body || part === document.documentElement ? '' : plain(part.innerText)
  // More than a paragraph's worth is a region of the page, which says nothing about where in it.
  const block = said.length <= 600 ? said : ''
  // A picture or an icon says nothing itself: the link or button it is part of does.
  const control = this.closest('a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], label, summary')
  if (!label && !field && !words(this.innerText) && control && control !== this) {
    return {
      selector,
      kind: this.getAttribute('role') || this.tagName.toLowerCase(),
      name: words(control.getAttribute('aria-label') || control.getAttribute('title') || control.innerText),
      text: '',
      around: '',
      block
    }
  }
  return {
    selector,
    kind: this.getAttribute('role') || this.tagName.toLowerCase(),
    name: words(label),
    text: field ? '' : words(this.innerText),
    around: heading && heading !== this ? words(heading.innerText) : '',
    block
  }
}"#;

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Pointed {
    /// Left, top, width and height, as fractions of the page's visible area.
    rect: [f64; 4],
    kind: String,
    name: String,
    text: String,
    around: String,
    /// A CSS selector that matches only this element, or nothing when there is none.
    selector: String,
    /// The paragraph, list item or table cell the element is part of, as the page shows it.
    block: String,
}

fn guest(webview: &tauri::Webview, label: &str) -> Result<(std::sync::Arc<GuestAgent>, GuestTarget), String> {
    if webview.label() != "main" {
        return Err("Only the main document points at pages".into());
    }
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned().ok_or("Unknown guest")?;
    let target = agent.view(webview.app_handle(), label).ok_or("Guest closed")?;
    Ok((agent, target))
}

/// The width and height of the page's visible area.
async fn visible(agent: &GuestAgent, target: &GuestTarget) -> Result<[f64; 2], String> {
    let metrics = agent.call(target, "Page.getLayoutMetrics", json!({})).await?;
    let view = &metrics["cssVisualViewport"];
    let number = |name: &str| view[name].as_f64().filter(|value| value.is_finite());
    match (number("clientWidth"), number("clientHeight")) {
        (Some(width), Some(height)) if width > 0.0 && height > 0.0 => Ok([width, height]),
        _ => Err("The page has no visible area".into()),
    }
}

/// A box's four corners as the fractions of the visible area it covers, cut to that area.
fn covered(quad: &Value, width: f64, height: f64) -> Option<[f64; 4]> {
    let corners: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
    if corners.len() != 8 {
        return None;
    }
    let side = |offset: usize, pick: fn(f64, f64) -> f64, limit: f64| {
        (corners[offset..].iter().step_by(2).copied().reduce(pick).unwrap_or(0.0) / limit).clamp(0.0, 1.0)
    };
    let (left, right) = (side(0, f64::min, width), side(0, f64::max, width));
    let (top, bottom) = (side(1, f64::min, height), side(1, f64::max, height));
    (right > left && bottom > top).then_some([left, top, right - left, bottom - top])
}

/// The spot around a point, as the fractions of the visible area it covers.
fn spot(x: f64, y: f64, width: f64, height: f64) -> [f64; 4] {
    let (wide, high) = ((SPOT / width).min(1.0), (SPOT / height).min(1.0));
    [(x - wide / 2.0).clamp(0.0, 1.0 - wide), (y - high / 2.0).clamp(0.0, 1.0 - high), wide, high]
}

async fn pointed(
    agent: &GuestAgent, target: &GuestTarget, x: f64, y: f64, describe: bool,
) -> Result<Option<Pointed>, String> {
    let [width, height] = visible(agent, target).await?;
    let at = json!({"x": (x * width).round(), "y": (y * height).round(), "includeUserAgentShadowDOM": false});
    // A point over nothing, such as a page still loading, has no node.
    let Ok(node) = agent.call(target, "DOM.getNodeForLocation", at).await else { return Ok(None) };
    let node = json!({"backendNodeId": node["backendNodeId"], "objectGroup": GROUP});
    let object = agent.call(target, "DOM.resolveNode", node).await?;
    let call = |function: &str, by_value: bool, id: &Value| json!({"objectId": id, "functionDeclaration": function, "returnByValue": by_value, "objectGroup": GROUP});
    let element =
        agent.call(target, "Runtime.callFunctionOn", call(ELEMENT, false, &object["object"]["objectId"])).await?;
    let id = &element["result"]["objectId"];
    let spot = Pointed { rect: spot(x, y, width, height), ..Pointed::default() };
    if !id.is_string() {
        return Ok(Some(spot));
    }
    // An element that draws nothing, such as one laid out as `display: contents`, has no box.
    let Ok(model) = agent.call(target, "DOM.getBoxModel", json!({"objectId": id})).await else { return Ok(Some(spot)) };
    let Some(rect) = covered(&model["model"]["border"], width, height) else { return Ok(Some(spot)) };
    // A container that fills the view is the page's background, whatever the page calls it.
    if rect[2] * rect[3] >= BACKDROP {
        return Ok(Some(spot));
    }
    let mut pointed = Pointed { rect, ..Pointed::default() };
    if describe {
        let said = agent.call(target, "Runtime.callFunctionOn", call(DESCRIBE, true, id)).await?;
        let word = |name: &str| said["result"]["value"][name].as_str().unwrap_or_default().to_owned();
        pointed = Pointed {
            kind: word("kind"),
            name: word("name"),
            text: word("text"),
            around: word("around"),
            selector: word("selector"),
            block: word("block"),
            ..pointed
        };
    }
    Ok(Some(pointed))
}

/// The element at a point of a page, the point given as fractions of the page's visible area.
/// `describe` adds what the element is and says; without it only its place is answered.
#[tauri::command]
pub async fn cef_guest_point(
    webview: tauri::Webview, label: String, x: f64, y: f64, describe: bool,
) -> Result<Option<Pointed>, String> {
    if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {
        return Err("The point is outside the page".into());
    }
    let (agent, target) = guest(&webview, &label)?;
    let answer = pointed(&agent, &target, x, y, describe).await;
    let _ = agent.call(&target, "Runtime.releaseObjectGroup", json!({"objectGroup": GROUP})).await;
    answer
}

/// Scrolls whatever lies under a point of the page, as a turn of the wheel there would. The point
/// is given as fractions of the page's visible area, the turn in page pixels.
#[tauri::command]
pub async fn cef_guest_wheel(
    webview: tauri::Webview,
    label: String,
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
) -> Result<(), String> {
    if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) || !delta_x.is_finite() || !delta_y.is_finite() {
        return Err("The turn of the wheel is outside the page".into());
    }
    let (agent, target) = guest(&webview, &label)?;
    let [width, height] = visible(&agent, &target).await?;
    let turn = json!({
        "type": "mouseWheel",
        "x": (x * width).round(),
        "y": (y * height).round(),
        "deltaX": delta_x,
        "deltaY": delta_y
    });
    agent.call(&target, "Input.dispatchMouseEvent", turn).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_box_is_the_part_of_the_visible_area_it_covers() {
        let quad = json!([128, 64, 384, 64, 384, 192, 128, 192]);
        assert_eq!(covered(&quad, 1024.0, 512.0), Some([0.125, 0.125, 0.25, 0.25]));
        // A box that runs past the edge is cut to what shows.
        let wide = json!([-100, 384, 2000, 384, 2000, 900, -100, 900]);
        assert_eq!(covered(&wide, 1024.0, 512.0), Some([0.0, 0.75, 1.0, 0.25]));
    }

    #[test]
    fn a_spot_surrounds_its_point_and_stays_on_the_page() {
        assert_eq!(spot(0.5, 0.5, 768.0, 384.0), [0.46875, 0.4375, 0.0625, 0.125]);
        assert_eq!(spot(0.0, 1.0, 768.0, 384.0), [0.0, 0.875, 0.0625, 0.125]);
        // A page smaller than a spot is all of it.
        assert_eq!(spot(0.5, 0.5, 24.0, 24.0), [0.0, 0.0, 1.0, 1.0]);
    }

    #[test]
    fn a_box_off_the_page_or_malformed_covers_nothing() {
        assert_eq!(covered(&json!([1200, 0, 1300, 0, 1300, 10, 1200, 10]), 1000.0, 500.0), None);
        assert_eq!(covered(&json!([0, 0, 10, 0]), 1000.0, 500.0), None);
        assert_eq!(covered(&json!(null), 1000.0, 500.0), None);
    }
}
