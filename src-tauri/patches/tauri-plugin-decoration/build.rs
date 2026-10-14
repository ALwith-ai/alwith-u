const COMMANDS: &[&str] = &[
    "frontend_ack",
    "frontend_document_boot",
    "frontend_document_ready",
    "frontend_geometry",
    "window_control",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
