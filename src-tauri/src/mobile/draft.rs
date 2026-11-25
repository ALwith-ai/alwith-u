//! Runtime drafts have no persisted Codex history until their first prompt is accepted.
use super::history::SessionHistoryPage;
use alwith_api::SessionRunState;
use std::future::Future;

pub async fn read_page<S, SF, H, HF>(
    session_id: &str, cursor: Option<&str>, read_states: S, read_history: H,
) -> Result<SessionHistoryPage, String>
where
    S: FnOnce() -> SF,
    SF: Future<Output = Result<Vec<SessionRunState>, String>>,
    H: FnOnce() -> HF,
    HF: Future<Output = Result<SessionHistoryPage, String>>,
{
    if cursor.is_none()
        && read_states().await?.iter().any(|state| state.session_id == session_id && state.reusable_draft)
    {
        return Ok(SessionHistoryPage { session_id: session_id.into(), lines: Vec::new(), next_cursor: None });
    }
    read_history().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn state(id: &str, draft: bool) -> alwith_api::SessionRunState {
        serde_json::from_value(json!({
            "sessionId":id,"state":"idle","reusableDraft":draft,"owner":"main","cwd":"/repo","title":"",
            "since":1,"tasks":[],"listeningPorts":[],"executionId":null,"executionRole":null,
            "lastActivityAt":1,"version":1,"interruption":null
        }))
        .unwrap()
    }
    #[tokio::test]
    async fn initial_reusable_draft_returns_empty_without_any_persisted_history_request() {
        let result = read_page(
            "draft",
            None,
            || std::future::ready(Ok(vec![state("other", false), state("draft", true)])),
            || -> std::future::Ready<Result<SessionHistoryPage, String>> {
                panic!("unmaterialized draft must not call persisted history")
            },
        )
        .await
        .unwrap();
        assert_eq!(result.session_id, "draft");
        assert!(result.lines.is_empty());
        assert!(result.next_cursor.is_none());
    }
    #[tokio::test]
    async fn materialized_and_unknown_sessions_keep_the_original_history_read() {
        for states in [vec![state("session", false), state("other", true)], vec![]] {
            let result = read_page(
                "session",
                None,
                || std::future::ready(Ok(states)),
                || {
                    std::future::ready(Ok(SessionHistoryPage {
                        session_id: "session".into(),
                        lines: vec!["persisted".into()],
                        next_cursor: Some("older".into()),
                    }))
                },
            )
            .await
            .unwrap();
            assert_eq!(result.lines, vec!["persisted"]);
            assert_eq!(result.next_cursor.as_deref(), Some("older"));
        }
    }
    #[tokio::test]
    async fn continuation_never_treats_a_draft_flag_as_an_empty_persisted_page() {
        let error = read_page(
            "session",
            Some("older"),
            || -> std::future::Ready<Result<Vec<alwith_api::SessionRunState>, String>> {
                panic!("continuation must keep its existing path")
            },
            || std::future::ready(Err("persisted read failed".into())),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "persisted read failed");
    }
    #[tokio::test]
    async fn runtime_state_and_non_draft_history_errors_are_propagated() {
        let error = read_page(
            "session",
            None,
            || std::future::ready(Err("Runtime unavailable".into())),
            || -> std::future::Ready<Result<SessionHistoryPage, String>> { panic!("state failure must propagate") },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "Runtime unavailable");
        let error = read_page(
            "session",
            None,
            || std::future::ready(Ok(vec![state("session", false)])),
            || std::future::ready(Err("adapter rejected history".into())),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "adapter rejected history");
    }
}
