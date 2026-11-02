#[tauri3_specta::command]
pub async fn parse_spreadsheet(
    bytes: Vec<u8>, extension: String,
) -> Result<alwith_editor::SpreadsheetWorkbook, String> {
    tauri::async_runtime::spawn_blocking(move || alwith_editor::parse_spreadsheet(&bytes, &extension))
        .await
        .map_err(|e| format!("Spreadsheet decoder task failed: {e}"))?
}
