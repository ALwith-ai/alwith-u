use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::oneshot;

pub(crate) type MainThreadJob = Box<dyn FnOnce() + Send + 'static>;

const JOB_QUEUED: u8 = 0;
const JOB_RUNNING: u8 = 1;
const JOB_CANCELLED: u8 = 2;

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum DispatchError<E> {
    Schedule(E),
    Action(E),
    CompletionDropped,
    Panicked,
    TimedOut,
}

enum Completion<T, E> {
    Action(Result<T, E>),
    Panicked,
}

pub(crate) async fn dispatch<T, E, F, S>(
    schedule: S,
    action: F,
    deadline: Duration,
    operation: &'static str,
    window_label: String,
) -> Result<T, DispatchError<E>>
where
    T: Send + 'static,
    E: Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
    S: FnOnce(MainThreadJob) -> Result<(), E>,
{
    let (completion_tx, completion_rx) = oneshot::channel();
    let job_state = Arc::new(AtomicU8::new(JOB_QUEUED));
    let action_state = job_state.clone();
    let job = Box::new(move || {
        if action_state
            .compare_exchange(JOB_QUEUED, JOB_RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let completion = match catch_unwind(AssertUnwindSafe(action)) {
            Ok(result) => Completion::Action(result),
            Err(_) => Completion::Panicked,
        };
        let _ = completion_tx.send(completion);
    });

    schedule(job).map_err(DispatchError::Schedule)?;
    let mut completion_rx = completion_rx;
    let completion = match tokio::time::timeout(deadline, &mut completion_rx).await {
        Ok(Ok(completion)) => completion,
        Ok(Err(_)) => return Err(DispatchError::CompletionDropped),
        Err(_) => {
            if job_state
                .compare_exchange(
                    JOB_QUEUED,
                    JOB_CANCELLED,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
            {
                return Err(DispatchError::TimedOut);
            }
            // A platform callback that has started cannot be safely unwound from
            // another thread. The caller must revalidate ownership when this
            // stage returns; queued work remains cancellable above.
            eprintln!(
                "decoration: main-thread operation {operation:?} exceeded its deadline after starting for window {window_label:?}; awaiting completion"
            );
            match completion_rx.await {
                Ok(completion) => completion,
                Err(_) => return Err(DispatchError::CompletionDropped),
            }
        }
    };
    match completion {
        Completion::Action(result) => result.map_err(DispatchError::Action),
        Completion::Panicked => Err(DispatchError::Panicked),
    }
}

#[cfg(test)]
mod tests {
    use super::{dispatch, DispatchError, MainThreadJob};
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };

    const DEADLINE: Duration = Duration::from_secs(1);

    #[test]
    fn dispatch_returns_action_success() {
        let value = tauri::async_runtime::block_on(dispatch(
            |job| {
                job();
                Ok::<(), &'static str>(())
            },
            || Ok(42),
            DEADLINE,
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(value, Ok(42));
    }

    #[test]
    fn dispatch_returns_action_error() {
        let result = tauri::async_runtime::block_on(dispatch(
            |job| {
                job();
                Ok::<(), &'static str>(())
            },
            || Err::<(), _>("action failed"),
            DEADLINE,
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Err(DispatchError::Action("action failed")));
    }

    #[test]
    fn queue_failure_is_returned_without_waiting() {
        let result = tauri::async_runtime::block_on(dispatch(
            |_| Err("queue failed"),
            || Ok::<_, &'static str>(42),
            DEADLINE,
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Err(DispatchError::Schedule("queue failed")));
    }

    #[test]
    fn dropped_queued_job_returns_completion_error() {
        let result = tauri::async_runtime::block_on(dispatch(
            |job| {
                drop(job);
                Ok::<(), &'static str>(())
            },
            || Ok(42),
            DEADLINE,
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Err(DispatchError::CompletionDropped));
    }

    #[test]
    fn queued_action_panic_is_contained() {
        let result = tauri::async_runtime::block_on(dispatch(
            |job| {
                job();
                Ok::<(), &'static str>(())
            },
            || -> Result<(), &'static str> { panic!("boom") },
            DEADLINE,
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Err(DispatchError::Panicked));
    }

    #[test]
    fn queued_action_has_a_deadline_and_is_cancelled_before_late_execution() {
        let retained: Arc<Mutex<Option<MainThreadJob>>> = Arc::new(Mutex::new(None));
        let queued = retained.clone();
        let result = tauri::async_runtime::block_on(dispatch(
            move |job| {
                *queued.lock().unwrap() = Some(job);
                Ok::<(), &'static str>(())
            },
            || Ok(42),
            Duration::from_millis(1),
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Err(DispatchError::TimedOut));
        retained.lock().unwrap().take().unwrap()();
    }

    #[test]
    fn started_action_completes_authoritatively_after_the_queue_deadline() {
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            release_tx.send(()).unwrap();
        });

        let result = tauri::async_runtime::block_on(dispatch(
            move |job| {
                std::thread::spawn(job);
                // Do not start the dispatch deadline until the action has
                // actually claimed the job. Otherwise a slow test thread can
                // exercise the queued-timeout path instead of this scenario.
                started_rx.recv().unwrap();
                Ok::<(), &'static str>(())
            },
            move || {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(42)
            },
            Duration::from_millis(1),
            "test",
            "test-window".to_owned(),
        ));

        assert_eq!(result, Ok(42));
    }
}
