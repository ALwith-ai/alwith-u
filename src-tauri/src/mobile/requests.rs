//! Retract a caller-owned ACP request when its host future is abandoned.
use serde_json::Value;
use std::future::Future;
struct CancelOnDrop<C: FnOnce(Value)>(Option<(Value, C)>);
impl<C: FnOnce(Value)> Drop for CancelOnDrop<C> {
    fn drop(&mut self) {
        if let Some((id, cancel)) = self.0.take() {
            cancel(id);
        }
    }
}
pub async fn run<F, Fut, C>(id: Value, request: F, cancel: C) -> Result<Value, String>
where
    F: FnOnce(Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
    C: FnOnce(Value),
{
    let mut guard = CancelOnDrop(Some((id.clone(), cancel)));
    let result = request(id).await;
    guard.0 = None;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        future::{Future, pending, ready},
        sync::{Arc, Mutex},
        task::{Context, Poll, Waker},
    };
    #[test]
    fn dropping_an_inflight_history_request_retracts_its_exact_acp_id_once() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let request_calls = calls.clone();
        let cancel_calls = calls.clone();
        let mut request = Box::pin(run(
            json!("mobile-history-id"),
            move |id| {
                request_calls.lock().unwrap().push(("request", id));
                pending::<Result<serde_json::Value, String>>()
            },
            move |id| {
                cancel_calls.lock().unwrap().push(("cancel", id));
            },
        ));
        assert!(request.as_mut().poll(&mut Context::from_waker(Waker::noop())).is_pending());
        drop(request);
        assert_eq!(
            *calls.lock().unwrap(),
            vec![("request", json!("mobile-history-id")), ("cancel", json!("mobile-history-id"))]
        );
    }
    #[test]
    fn completed_success_and_error_do_not_retract_finished_requests() {
        for result in [Ok(json!("response")), Err("explicit error".into())] {
            let expected = result.clone();
            let mut request = Box::pin(run(
                json!("finished"),
                move |_| ready(result),
                |_| panic!("completed request must not be cancelled"),
            ));
            assert_eq!(request.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Ready(expected));
            drop(request);
        }
    }
    #[test]
    fn dropping_an_unpolled_host_future_does_not_retract_an_unsent_request() {
        let request =
            run(json!("unsent"), |_| pending::<Result<serde_json::Value, String>>(), |_| panic!("request never sent"));
        drop(request);
    }
}
