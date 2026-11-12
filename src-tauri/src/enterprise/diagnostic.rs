//! Credential-free enterprise operation traces included in the application's diagnostic log.
use serde_json::{Value, json};
use std::{
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

pub(super) fn details(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| {
                    matches!(
                        key.as_str(),
                        "message"
                            | "detail"
                            | "reason"
                            | "error"
                            | "cause"
                            | "data"
                            | "code"
                            | "kind"
                            | "type"
                            | "stage"
                            | "status"
                            | "httpStatus"
                            | "requestId"
                            | "generation"
                            | "automatic_renewal"
                            | "requires_login"
                    )
                })
                .map(|(key, value)| (key.clone(), details(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().take(16).map(details).collect()),
        Value::String(value) => {
            static PROOFS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            let pattern = PROOFS.get_or_init(|| {
                regex::Regex::new(r#"(?i)\bstate(["']*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)"#).unwrap()
            });
            json!(pattern.replace_all(&crate::diagnostics::redact_log(value), "state${1}[redacted]").into_owned())
        }
        value => value.clone(),
    }
}

pub(super) async fn trace<T>(
    stage: &str, generation: Option<u64>, work: impl Future<Output = Result<T, Value>>,
) -> Result<T, Value> {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let operation = NEXT.fetch_add(1, Ordering::Relaxed);
    let start = Instant::now();
    // Status is polled by settings; only failures belong in the log.
    if stage != "status" {
        log::info!("[enterprise] operation={operation} stage={stage} generation={generation:?} started");
    }
    let result = work.await;
    let elapsed = start.elapsed().as_millis();
    match &result {
        Err(reason) => log::error!(
            "[enterprise] operation={operation} stage={stage} generation={generation:?} elapsed_ms={elapsed} failed {}",
            details(reason)
        ),
        Ok(_) if stage != "status" => log::info!(
            "[enterprise] operation={operation} stage={stage} generation={generation:?} elapsed_ms={elapsed} completed"
        ),
        Ok(_) => {}
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_causes_keep_diagnostic_fields_and_drop_credentials() {
        let value = details(&json!({"kind":"http", "data":{"status":401,"requestId":"req-1","cause":{"message":"Rejected access_token=private-token", "code":"invalid_grant"},"headers":{"authorization":"secret"},"ticket":"private-ticket"}, "authorization_url":"https://login/?state=private-state"})).to_string();
        for expected in ["401", "req-1", "invalid_grant", "Rejected"] {
            assert!(value.contains(expected));
        }
        for secret in ["private-token", "private-ticket", "private-state", "secret"] {
            assert!(!value.contains(secret));
        }
    }
}
