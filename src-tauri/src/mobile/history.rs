//! Project Codex's persisted, paged ACP history onto the mobile replay wire.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, future::Future};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    session_id: String,
    consistency: String,
    revision: Option<Value>,
    turns: Vec<Turn>,
    #[serde(default)]
    framed_items: bool,
    next_cursor: Option<String>,
    complete: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Turn {
    turn_id: String,
    items_view: String,
    updates: Vec<Value>,
}

/// Runtime replay excludes resolved permissions. Keep its original request frames, not its
/// message history: Codex already supplies those messages above the pending requests.
pub fn pending_permissions(session_id: &str, replay: Vec<String>) -> Result<Vec<String>, String> {
    let mut permissions = Vec::new();
    for line in replay {
        let frame: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if frame["method"] != "session/request_permission" {
            continue;
        }
        if frame["params"]["sessionId"].as_str() != Some(session_id) {
            return Err("Invalid mobile permission session".into());
        }
        permissions.push(line);
    }
    Ok(permissions)
}

async fn item_updates<F, Fut>(session_id: &str, turn_id: &str, request: &mut F) -> Result<Vec<Value>, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut params =
        json!({"sessionId": session_id, "turnId": turn_id, "mode": "browse", "sortDirection": "asc", "limit": 30});
    params["framed"] = true.into();
    let mut cursors = HashSet::new();
    let mut ids = HashSet::new();
    let mut updates = Vec::new();
    loop {
        let mut bytes = Vec::new();
        let mut part = 0;
        let mut digest = None;
        let page = loop {
            let mut page = request("_codex/session_history_items", params.clone()).await?;
            if page["sessionId"] != session_id || page["consistency"] != "live" || !page["revision"].is_null() {
                return Err("Invalid mobile history item page".into());
            }
            if let Some(fragment) = page.get("fragment") {
                let hash = page["fragmentDigest"].as_str().ok_or("Invalid history fragment digest")?;
                if page["fragmentPart"] != part || digest.as_deref().is_some_and(|d| d != hash) {
                    return Err("Invalid mobile history fragment".into());
                }
                digest = Some(hash.to_owned());
                STANDARD
                    .decode_vec(fragment.as_str().ok_or("Invalid history fragment")?, &mut bytes)
                    .map_err(|error| error.to_string())?;
                part += 1;
                if page["nextFragment"].is_null() {
                    page["items"] = Value::Array(vec![serde_json::from_slice(&bytes).map_err(|e| e.to_string())?]);
                    params.as_object_mut().unwrap().remove("fragment");
                } else {
                    if page["nextFragment"] != format!("{hash}:{part}") {
                        return Err("Invalid mobile fragment continuation".into());
                    }
                    params["fragment"] = page["nextFragment"].clone();
                    continue;
                }
            } else if part != 0 {
                return Err("Incomplete mobile history fragment".into());
            }
            break page;
        };
        let items = page["items"].as_array().ok_or("Invalid mobile history items")?;
        for item in items {
            if item["turnId"] != turn_id || !ids.insert(item["itemId"].as_str().ok_or("Invalid item ID")?.to_owned()) {
                return Err("Invalid mobile history item identity".into());
            }
            updates.extend(item["updates"].as_array().ok_or("Invalid history updates")?.iter().cloned());
        }
        match (page["complete"].as_bool(), &page["nextCursor"]) {
            (Some(true), Value::Null) => return Ok(updates),
            (Some(false), Value::String(cursor))
                if !items.is_empty() && !cursor.is_empty() && cursors.insert(cursor.clone()) =>
            {
                params["cursor"] = cursor.clone().into();
            }
            _ => return Err("Invalid mobile history item cursor".into()),
        }
    }
}

pub async fn read<F, Fut>(session_id: &str, mut request: F) -> Result<Vec<String>, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut cursor: Option<String> = None;
    let mut cursors = HashSet::new();
    let mut seen = HashSet::new();
    let mut turns = Vec::new();
    let mut legacy = false;
    loop {
        let mut params = json!({
            "sessionId": session_id, "mode": "browse", "sortDirection": "desc",
            "itemsView": if legacy { "full" } else { "summary" }, "limit": 5
        });
        if legacy {
            params["maxBytes"] = (16 * 1024 * 1024).into();
        }
        if let Some(value) = &cursor {
            params["cursor"] = Value::String(value.clone());
        }
        let page: Page = serde_json::from_value(request("_codex/session_history", params).await?)
            .map_err(|error| error.to_string())?;
        if page.session_id != session_id
            || page.consistency != "live"
            || page.revision.is_some()
            || page.complete != page.next_cursor.is_none()
            || (page.next_cursor.is_some() && page.turns.is_empty())
        {
            return Err("Invalid mobile history pagination".into());
        }
        // Older packaged adapters return no framed-items capability on the first summary page.
        if !legacy && !page.framed_items {
            if cursor.is_some() {
                return Err("Mobile history capability changed during replay".into());
            }
            legacy = true;
            continue;
        }
        for mut turn in page.turns {
            if turn.items_view != (if legacy { "full" } else { "summary" }) || !seen.insert(turn.turn_id.clone()) {
                return Err("Invalid mobile history turn".into());
            }
            if !legacy {
                let mut updates = item_updates(session_id, &turn.turn_id, &mut request).await?;
                updates.append(&mut turn.updates);
                turn.updates = updates;
            }
            turns.push(turn);
        }
        match page.next_cursor {
            Some(next) if !next.is_empty() && cursors.insert(next.clone()) => cursor = Some(next),
            Some(_) => return Err("Invalid mobile history cursor".into()),
            None => break,
        }
    }
    let mut lines = Vec::new();
    for turn in turns.into_iter().rev() {
        for update in turn.updates {
            if update.get("sessionUpdate").and_then(Value::as_str).is_none() {
                return Err("Invalid mobile history update".into());
            }
            lines.push(
                json!({"jsonrpc":"2.0", "method":"session/update",
                "params":{"sessionId":session_id,"update":update}})
                .to_string(),
            );
        }
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn permission(session_id: &str) -> String {
        json!({"jsonrpc":"2.0", "id":42, "method":"session/request_permission", "params":{
            "sessionId":session_id, "title":"Allow command?",
            "subject":{"toolCall":{"toolCallId":"tool-1", "rawInput":{"command":"pwd"}}},
            "options":[{"optionId":"allow", "name":"Allow", "kind":"allow_once"}]
        }})
        .to_string()
    }

    #[test]
    fn replays_pending_permissions_unchanged_without_duplicating_messages() {
        let pending = permission("background");
        let replay = vec![
            json!({"method":"session/update", "params":{"sessionId":"background"}}).to_string(),
            json!({"method":"session/prompt", "params":{"sessionId":"background"}}).to_string(),
            pending.clone(),
        ];
        assert_eq!(pending_permissions("background", replay).unwrap(), vec![pending]);
    }

    #[test]
    fn does_not_reconstruct_resolved_permissions_from_tool_history() {
        let replay = vec![
            json!({"method":"session/update", "params":{
                "sessionId":"background", "update":{"sessionUpdate":"tool_call",
                "toolCallId":"tool-1", "status":"completed"}
            }})
            .to_string(),
        ];
        assert!(pending_permissions("background", replay).unwrap().is_empty());
        assert!(pending_permissions("background", vec![]).unwrap().is_empty());
    }

    #[test]
    fn rejects_cross_session_permissions_and_invalid_frames() {
        assert!(pending_permissions("background", vec![permission("other")]).is_err());
        assert!(pending_permissions("background", vec!["invalid".into()]).is_err());
    }
    fn page(id: &str, cursor: Option<&str>) -> Value {
        json!({"sessionId":"background", "consistency":"live", "revision":null,
            "framedItems":true, "turns":[{"turnId":id,"itemsView":"summary","updates":[]}], "nextCursor":cursor, "complete":cursor.is_none()})
    }
    #[tokio::test]
    async fn reads_persisted_background_history_in_order_without_resuming_a_session() {
        let mut calls = Vec::new();
        let lines = read("background", |method, params| {
            if method.ends_with("_items") {
                let id = params["turnId"].as_str().unwrap();
                return std::future::ready(Ok(json!({"sessionId":"background","consistency":"live","revision":null,"items":[
                    {"turnId":id,"itemId":"item","updates":[{"sessionUpdate":"user_message","messageId":format!("u-{id}")},{"sessionUpdate":"agent_message","messageId":format!("a-{id}")}]}
                ],"nextCursor":null,"complete":true})));
            }
            calls.push(params.clone());
            std::future::ready(Ok(if params.get("cursor").is_some() {
                page("old", None)
            } else {
                page("new", Some("older"))
            }))
        })
        .await
        .unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1]["cursor"], "older");
        let messages: Vec<Value> = lines.iter().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["params"]["update"]["messageId"], "u-old");
        assert_eq!(messages[2]["params"]["update"]["messageId"], "u-new");
        assert!(messages.iter().all(|line| line["params"]["sessionId"] == "background"));
    }
    #[tokio::test]
    async fn reassembles_fragmented_item_before_advancing() {
        let item = json!({"turnId":"turn","itemId":"item","updates":[{"sessionUpdate":"agent_message",
            "messageId":"answer","content":[{"type":"text","text":"你好"}]}]});
        let bytes = serde_json::to_vec(&item).unwrap();
        let split = bytes.iter().position(|byte| *byte >= 128).unwrap() + 1;
        let digest = "a".repeat(64);
        let mut calls = 0;
        let updates = item_updates("s", "turn", &mut |_, params| {
            let first = calls == 0;
            if !first {
                assert_eq!(params["fragment"], format!("{digest}:1"));
            }
            assert!(params.get("cursor").is_none());
            calls += 1;
            std::future::ready(Ok(json!({"sessionId":"s", "consistency":"live", "items":[],
                "fragment":STANDARD.encode(if first { &bytes[..split] } else { &bytes[split..] }),
                "fragmentDigest":digest,"fragmentPart":calls-1,
                "nextFragment":first.then(|| format!("{digest}:1")), "nextCursor":null,"complete":true})))
        })
        .await
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(Value::Array(updates), item["updates"]);
    }

    #[tokio::test]
    async fn rejects_cross_session_history_and_cursor_cycles() {
        assert!(read("other", |_, _| std::future::ready(Ok(page("turn", None)))).await.is_err());
        let mut count = 0;
        assert!(
            read("background", |method, _| {
                if method.ends_with("_items") {
                    return std::future::ready(Ok(json!({"sessionId":"background","consistency":"live","items":[],"nextCursor":null,"complete":true})));
                }
                count += 1;
                std::future::ready(Ok(page(&count.to_string(), Some("cycle"))))
            })
            .await
            .is_err()
        );
    }
}
