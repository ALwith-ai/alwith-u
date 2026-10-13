use std::{sync::mpsc, thread, time::Duration};
use tauri_runtime_wry::{
    tao::{
        event::Event,
        event_loop::{ControlFlow, EventLoopBuilder},
        platform::run_return::EventLoopExtRunReturn,
        window::WindowBuilder,
    },
    wry::{RequestAsyncResponder, WebViewBuilder, http::Response},
};

enum CheckEvent {
    Loaded(String),
    Pending(RequestAsyncResponder),
    Abandoned,
    Failed(String),
}

fn page(path: &str) -> Response<Vec<u8>> {
    let message = serde_json::to_string(path).expect("serialize fixture path");
    Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .body(format!("<!doctype html><script>window.ipc.postMessage({message})</script>").into_bytes())
        .expect("valid fixture response")
}

fn worker_returns_without_main_loop(action: impl FnOnce() + Send + 'static) -> Result<(), String> {
    let (sent, received) = mpsc::channel();
    thread::spawn(move || {
        action();
        // The receiver is gone only after the timeout has already reported a failure.
        let _ = sent.send(());
    });
    // Deliberately pause the main thread. Delivery and abandoned responder cleanup
    // must enqueue work rather than synchronously wait for WebKit on this thread.
    received
        .recv_timeout(Duration::from_secs(1))
        .map_err(|error| format!("Worker blocked waiting for the WebKit main loop: {error}"))
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut event_loop = EventLoopBuilder::<CheckEvent>::with_user_event().build();
    let window = WindowBuilder::new().with_title("Wry protocol regression").with_visible(false).build(&event_loop)?;
    let protocol_proxy = event_loop.create_proxy();
    let ipc_proxy = event_loop.create_proxy();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(15));
        // Exit independently so a blocked main loop cannot hide a deadlock.
        eprintln!("WebKit regression timed out");
        std::process::exit(1);
    });
    let webview = WebViewBuilder::new()
        .with_asynchronous_custom_protocol("wry-regression".into(), move |_, request, responder| {
            let event = match request.uri().path() {
                "/main" | "/cancelled" | "/done" => {
                    responder.respond(page(request.uri().path()));
                    return;
                }
                "/worker" => {
                    if let Err(error) = worker_returns_without_main_loop(move || responder.respond(page("/worker"))) {
                        CheckEvent::Failed(error)
                    } else {
                        return;
                    }
                }
                "/held" => CheckEvent::Pending(responder),
                "/abandoned" => match worker_returns_without_main_loop(move || drop(responder)) {
                    Ok(()) => CheckEvent::Abandoned,
                    Err(error) => CheckEvent::Failed(error),
                },
                path => CheckEvent::Failed(format!("Unexpected fixture request: {path}")),
            };
            assert!(protocol_proxy.send_event(event).is_ok(), "regression event loop is running");
        })
        .with_ipc_handler(move |request| {
            assert!(
                ipc_proxy.send_event(CheckEvent::Loaded(request.body().clone())).is_ok(),
                "regression event loop is running"
            );
        })
        .with_url("wry-regression://localhost/main")
        .build(&window)?;

    let mut pending = None;
    let mut step = 0;
    let mut result = Err("Regression exited before completing all checks".to_owned());
    event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let Event::UserEvent(event) = event else { return };
        let next = match (step, event) {
            (_, CheckEvent::Failed(error)) => Err(error),
            (0, CheckEvent::Loaded(path)) if path == "/main" => Ok(Some("/worker")),
            (1, CheckEvent::Loaded(path)) if path == "/worker" => Ok(Some("/held")),
            (2, CheckEvent::Pending(responder)) => {
                pending = Some(responder);
                Ok(Some("/cancelled"))
            }
            (3, CheckEvent::Loaded(path)) if path == "/cancelled" => {
                // A completed navigation has cancelled the previous document's task.
                let responder = pending.take().expect("held request exists before cancellation");
                worker_returns_without_main_loop(move || responder.respond(page("/stale"))).map(|()| Some("/abandoned"))
            }
            (4, CheckEvent::Abandoned) => Ok(Some("/done")),
            (5, CheckEvent::Loaded(path)) if path == "/done" => Ok(None),
            _ => Err(format!("Unexpected callback in regression step {step}")),
        };
        match next {
            Ok(Some(path)) => {
                step += 1;
                if let Err(error) = webview.load_url(&format!("wry-regression://localhost{path}")) {
                    result = Err(error.to_string());
                    *control_flow = ControlFlow::Exit;
                }
            }
            Ok(None) => {
                result = Ok(());
                *control_flow = ControlFlow::Exit;
            }
            Err(error) => {
                result = Err(error);
                *control_flow = ControlFlow::Exit;
            }
        }
    });
    result?;
    println!("PASS: main-thread delivery, worker delivery, cancelled response, abandoned responder");
    Ok(())
}
