use std::{
    error::Error,
    io::ErrorKind,
    time::{Duration, Instant},
};

const LIMIT: usize = 200 * 1024 * 1024;
const ATTEMPTS: usize = 3;

struct Failure {
    message: String,
    retryable: bool,
}

fn transient_status(status: u16) -> bool {
    matches!(status, 408 | 500 | 502 | 503 | 504)
}

fn transient_io(error: &(dyn Error + 'static)) -> bool {
    let mut source = Some(error);
    while let Some(error) = source {
        if let Some(error) = error.downcast_ref::<std::io::Error>()
            && matches!(
                error.kind(),
                ErrorKind::ConnectionRefused
                    | ErrorKind::ConnectionReset
                    | ErrorKind::ConnectionAborted
                    | ErrorKind::NotConnected
                    | ErrorKind::TimedOut
                    | ErrorKind::UnexpectedEof
            )
        {
            return true;
        }
        source = error.source();
    }
    false
}

fn request_failure(error: reqwest::Error) -> Failure {
    let retryable = error.is_timeout() || transient_io(&error);
    // Signed URLs must not enter the logs. The caller records only the resource path.
    let error = error.without_url();
    Failure { message: format!("{error:?}"), retryable }
}

async fn attempt(client: &reqwest::Client, url: &reqwest::Url) -> Result<Vec<u8>, Failure> {
    let mut response = client.get(url.clone()).send().await.map_err(request_failure)?;
    let status = response.status();
    if !status.is_success() {
        return Err(Failure {
            message: format!("Vibemon download returned HTTP {status}"),
            retryable: transient_status(status.as_u16()),
        });
    }
    if response.content_length().is_some_and(|size| size > LIMIT as u64) {
        return Err(Failure { message: "Vibemon resource exceeds 200 MiB".into(), retryable: false });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        let mut failure = request_failure(error);
        failure.message = format!("{} after {} bytes", failure.message, bytes.len());
        failure
    })? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err(Failure { message: "Vibemon resource exceeds 200 MiB".into(), retryable: false });
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(Failure { message: "Empty Vibemon spritesheet".into(), retryable: false });
    }
    Ok(bytes)
}

async fn retry<T, F, Fut>(mut operation: F) -> Result<T, String>
where
    F: FnMut(usize) -> Fut,
    Fut: std::future::Future<Output = Result<T, Failure>>,
{
    for number in 1..=ATTEMPTS {
        match operation(number).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !error.retryable || number == ATTEMPTS {
                    return Err(error.message);
                }
                // Backoff controls request pressure; it does not stand in for readiness.
                tokio::time::sleep(Duration::from_secs(number as u64)).await;
            }
        }
    }
    unreachable!("the final attempt always returns")
}

pub(super) async fn download(url: reqwest::Url) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // Active transfers may be slow; only stalled reads should fail quickly.
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("{error:?}"))?;
    let mut resource = url.clone();
    resource.set_query(None);
    resource.set_fragment(None);
    log::info!("[pet-download] started resource={resource}");
    retry(|number| {
        let client = &client;
        let url = &url;
        let resource = &resource;
        async move {
            let started = Instant::now();
            let result = attempt(client, url).await;
            if let Ok(bytes) = &result {
                log::info!(
                    "[pet-download] completed resource={resource} bytes={} elapsed_ms={}",
                    bytes.len(),
                    started.elapsed().as_millis()
                );
            }
            if let Err(error) = &result {
                log::warn!(
                    "[pet-download] resource={resource} attempt={number}/{ATTEMPTS} retryable={} cause={}",
                    error.retryable,
                    error.message
                );
            }
            result
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permanent_http_failures_are_not_retried() {
        for status in [400, 401, 403, 404, 410, 413, 429, 501] {
            assert!(!transient_status(status));
        }
        for status in [408, 500, 502, 503, 504] {
            assert!(transient_status(status));
        }
        assert!(transient_io(&std::io::Error::from(ErrorKind::ConnectionReset)));
        assert!(!transient_io(&std::io::Error::from(ErrorKind::InvalidData)));
    }

    #[tokio::test]
    async fn permanent_failures_stop_immediately() {
        let mut attempts = 0;
        let result = retry::<(), _, _>(|_| {
            attempts += 1;
            std::future::ready(Err(Failure { message: "forbidden".into(), retryable: false }))
        })
        .await;
        assert_eq!(attempts, 1);
        assert_eq!(result, Err("forbidden".into()));
    }

    #[tokio::test]
    async fn transient_failures_have_a_finite_retry_budget() {
        let mut attempts = 0;
        let result = retry::<(), _, _>(|_| {
            attempts += 1;
            std::future::ready(Err(Failure { message: "timeout".into(), retryable: true }))
        })
        .await;
        assert_eq!(attempts, ATTEMPTS);
        assert_eq!(result, Err("timeout".into()));
    }

    #[tokio::test]
    async fn a_successful_retry_stops_downloading() {
        let mut attempts = 0;
        let result = retry(|_| {
            attempts += 1;
            std::future::ready(if attempts == 1 {
                Err(Failure { message: "reset".into(), retryable: true })
            } else {
                Ok(vec![1, 2, 3])
            })
        })
        .await;
        assert_eq!(attempts, 2);
        assert_eq!(result, Ok(vec![1, 2, 3]));
    }
}
