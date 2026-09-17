use std::time::Duration;

/// VSCode abstractUpdateService: first check after 30s, then hourly, chained.
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(3600);
pub const OVERWRITE_CHECK_INTERVAL: Duration = Duration::from_secs(300);
pub const OVERWRITE_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

pub async fn schedule_check_loop<F, Fut>(first_delay: Duration, interval: Duration, check: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    tokio::time::sleep(first_delay).await;
    loop {
        check().await;
        tokio::time::sleep(interval).await;
    }
}

/// Every 5 minutes, while an update sits in `Ready`, re-validate it against the remote so a
/// release withdrawn or replaced after download is not installed.
pub async fn schedule_overwrite_check<IsReady, CheckOver, FutCheck>(
    interval: Duration, is_ready: IsReady, check_overwrite: CheckOver,
) where
    IsReady: Fn() -> bool + Send + Sync,
    CheckOver: Fn() -> FutCheck + Send + Sync,
    FutCheck: std::future::Future<Output = ()> + Send,
{
    loop {
        tokio::time::sleep(interval).await;
        if is_ready() {
            check_overwrite().await;
        }
    }
}

/// The overwrite check gets 2 seconds; timeout or error counts as "still latest" (`None`).
pub async fn is_latest_with_timeout<F, Fut>(timeout: Duration, check: F) -> Option<bool>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<bool, String>>,
{
    match tokio::time::timeout(timeout, check()).await {
        Ok(Ok(is_latest)) => Some(is_latest),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    const TICK: Duration = Duration::from_millis(20);

    #[tokio::test]
    async fn schedule_check_loop_fires_after_first_delay_then_every_interval() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_clone = calls.clone();
        let handle = tokio::spawn(async move {
            schedule_check_loop(TICK, TICK, move || {
                let calls = calls_clone.clone();
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                }
            })
            .await;
        });
        tokio::time::sleep(TICK / 2).await;
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        tokio::time::sleep(TICK * 4).await;
        assert!(calls.load(Ordering::Relaxed) >= 2);
        handle.abort();
    }

    #[tokio::test]
    async fn overwrite_check_only_fires_while_ready() {
        let is_ready = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicU32::new(0));
        let is_ready_c = is_ready.clone();
        let calls_c = calls.clone();
        let handle = tokio::spawn(async move {
            schedule_overwrite_check(
                TICK,
                move || is_ready_c.load(Ordering::Relaxed),
                move || {
                    let calls = calls_c.clone();
                    async move {
                        calls.fetch_add(1, Ordering::Relaxed);
                    }
                },
            )
            .await;
        });
        tokio::time::sleep(TICK * 3).await;
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        is_ready.store(true, Ordering::Relaxed);
        tokio::time::sleep(TICK * 3).await;
        assert!(calls.load(Ordering::Relaxed) >= 1);
        handle.abort();
    }

    #[tokio::test]
    async fn is_latest_with_timeout_maps_success_timeout_and_error() {
        assert_eq!(is_latest_with_timeout(TICK, || async { Ok(true) }).await, Some(true));
        assert_eq!(
            is_latest_with_timeout(TICK, || async {
                tokio::time::sleep(TICK * 5).await;
                Ok(true)
            })
            .await,
            None
        );
        assert_eq!(is_latest_with_timeout(TICK, || async { Err("net".into()) }).await, None);
    }
}
