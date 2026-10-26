//! Project Codex's persisted, paged ACP history onto the mobile replay wire.
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

pub async fn read<F, Fut>(session_id: &str, mut request: F) -> Result<Vec<String>, String>
where
    F: FnMut(Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut cursor: Option<String> = None;
    let mut cursors = HashSet::new();
    let mut seen = HashSet::new();
    let mut turns = Vec::new();
    loop {
        let mut params = json!({
            "sessionId": session_id, "mode": "browse", "sortDirection": "desc",
            "itemsView": "full", "limit": 1, "maxBytes": 16 * 1024 * 1024
        });
        if let Some(value) = &cursor {
            params["cursor"] = Value::String(value.clone());
        }
        let page: Page = serde_json::from_value(request(params).await?).map_err(|error| error.to_string())?;
        if page.session_id != session_id
            || page.consistency != "live"
            || page.revision.is_some()
            || page.complete != page.next_cursor.is_none()
            || (page.next_cursor.is_some() && page.turns.is_empty())
        {
            return Err("Invalid mobile history pagination".into());
        }
        for turn in page.turns {
            if turn.items_view != "full" || !seen.insert(turn.turn_id.clone()) {
                return Err("Invalid mobile history turn".into());
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
            "turns":[{"turnId":id,"itemsView":"full","updates":[
                {"sessionUpdate":"user_message","messageId":format!("u-{id}"),"content":[{"type":"text","text":id}]},
                {"sessionUpdate":"agent_message","messageId":format!("a-{id}"),"content":[{"type":"text","text":"answer"}]}
            ]}], "nextCursor":cursor, "complete":cursor.is_none()})
    }
    #[tokio::test]
    async fn reads_persisted_background_history_in_order_without_resuming_a_session() {
        let mut calls = Vec::new();
        let lines = read("background", |params| {
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
    async fn rejects_cross_session_history_and_cursor_cycles() {
        assert!(read("other", |_| std::future::ready(Ok(page("turn", None)))).await.is_err());
        let mut count = 0;
        assert!(
            read("background", |_| {
                count += 1;
                std::future::ready(Ok(page(&count.to_string(), Some("cycle"))))
            })
            .await
            .is_err()
        );
    }
}
