//! Application boundary: window identity, private credentials and event routing.
use alwith_voice::{
    Voice,
    contract::{StartOptions, VoiceEvent},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tauri::{
    Manager, State,
    ipc::{Channel, InvokeBody, Request},
};

#[derive(Default)]
struct Document {
    generation: u64,
    ready: bool,
}
impl Document {
    fn replace(&mut self) -> u64 {
        let previous = self.generation;
        self.generation += 1;
        self.ready = false;
        previous
    }
    fn capture_identity(&self, label: &str) -> Result<String, String> {
        if !self.ready {
            return Err("voice_document_loading".into());
        }
        Ok(format!("{label}:{}", self.generation))
    }
}
type Routes = Arc<Mutex<BTreeMap<String, (String, Channel<VoiceEvent>)>>>;
pub struct VoiceState {
    service: Voice,
    channels: Routes,
    credentials: Arc<Mutex<crate::voice_credentials::Credentials>>,
    generations: Mutex<BTreeMap<String, Document>>,
}
impl VoiceState {
    fn identity(&self, label: &str) -> Result<String, String> {
        let mut generations = self.generations.lock().map_err(|_| "voice_generations_poisoned")?;
        let document = generations.entry(label.into()).or_default();
        Ok(format!("{label}:{}", document.generation))
    }
}
#[derive(Serialize, specta::Type)]
pub struct Profiles {
    vui: bool,
    doubao: bool,
}
fn check(window: &tauri::Window, settings: bool) -> Result<(), String> {
    let allowed =
        if settings { window.label() == "settings" } else { matches!(window.label(), "main" | "chat" | "settings") };
    if !allowed {
        return Err("voice_window_denied".into());
    }
    Ok(())
}
pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let service = Voice::new()?;
    let channels: Routes = Arc::new(Mutex::new(BTreeMap::new()));
    let path = app.path().app_data_dir()?.join("voice-credentials.json");
    let credentials = crate::voice_credentials::Credentials::new(path);
    let reader = service.clone();
    let routes = Arc::clone(&channels);
    std::thread::Builder::new().name("voice-events".into()).spawn(move || {
        loop {
            let value = match reader.next() {
                Ok(Some(value)) => value,
                Ok(None) => break,
                Err(error) => {
                    log::error!("Voice event reader failed: {error}");
                    reader.shutdown();
                    break;
                }
            };
            let result = (|| -> Result<(), String> {
                let id = value["recordingId"].as_str().ok_or("missing_recording_id")?;
                let owner = value["owner"].as_str().ok_or("missing_owner")?;
                let terminal = matches!(value["type"].as_str(), Some("final" | "failed" | "cancelled"));
                let mut routes = routes.lock().map_err(|_| "voice_routes_poisoned")?;
                if let Some((bound, channel)) = routes.get(id) {
                    if bound != owner {
                        return Err("voice_route_owner_mismatch".into());
                    }
                    let event: VoiceEvent = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                    if let Err(error) = channel.send(event) {
                        // A broken channel does not prove the old MediaStream has stopped.
                        if !terminal {
                            reader.command(json!({"action":"cancel","owner":owner,"recordingId":id}))?;
                        }
                        log::error!("Voice event delivery failed: {error}");
                    }
                    if terminal {
                        routes.remove(id);
                    }
                }
                Ok(())
            })();
            if let Err(error) = result {
                log::error!("Voice routing failed: {error}");
                reader.shutdown();
                break;
            }
        }
    })?;
    app.manage(VoiceState {
        service,
        channels,
        credentials: Arc::new(Mutex::new(credentials)),
        generations: Mutex::new(BTreeMap::new()),
    });
    Ok(())
}
#[tauri3_specta::command]
pub async fn voice_start(
    window: tauri::Window, state: State<'_, VoiceState>, options: StartOptions, events: Channel<VoiceEvent>,
) -> Result<(), String> {
    check(&window, false)?;
    if !matches!(window.label(), "main" | "chat") {
        return Err("voice_capture_window_denied".into());
    }
    let provider = match options.credential_profile_id {
        alwith_voice::contract::Provider::Vui => "vui",
        alwith_voice::contract::Provider::Doubao => "doubao",
    };
    let owner = state
        .generations
        .lock()
        .map_err(|_| "voice_generations_poisoned")?
        .entry(window.label().into())
        .or_default()
        .capture_identity(window.label())?;
    let id = options.recording_id.clone();
    {
        let mut channels = state.channels.lock().map_err(|_| "voice_routes_poisoned")?;
        if channels.contains_key(&id) {
            return Err("duplicate_recording".into());
        }
        channels.insert(id.clone(), (owner.clone(), events));
    }
    let service = state.service.clone();
    let credentials = Arc::clone(&state.credentials);
    let command_owner = owner.clone();
    let command_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Hold the same lock through native acceptance so revocation cannot race a queued start.
        let credentials = credentials.lock().map_err(|_| "voice_credentials_poisoned")?;
        let key = credentials.get(provider)?.ok_or("voice_profile_not_configured")?;
        service.command(json!({"action":"start","owner":command_owner,"start":{"owner":command_owner,"recordingId":command_id,"provider":provider,"key":key,"hotwords":options.hotwords,"smooth":options.smooth,"resourceId":options.resource_id}}))
    }).await.map_err(|e| e.to_string())?;
    if result.is_ok() && state.identity(window.label())? != owner {
        state.service.command(json!({"action":"detach","owner":owner}))?;
        state.channels.lock().map_err(|_| "voice_routes_poisoned")?.remove(&id);
        return Err("voice_document_replaced".into());
    }
    if result.is_err() {
        state.channels.lock().map_err(|_| "voice_routes_poisoned")?.remove(&id);
    }
    result
}
#[tauri::command]
pub fn voice_push(window: tauri::Window, state: State<'_, VoiceState>, request: Request<'_>) -> Result<(), String> {
    check(&window, false)?;
    let id =
        request.headers().get("x-recording-id").ok_or("missing_recording_id")?.to_str().map_err(|e| e.to_string())?;
    let sequence = request
        .headers()
        .get("x-audio-sequence")
        .ok_or("missing_audio_sequence")?
        .to_str()
        .map_err(|e| e.to_string())?
        .parse::<u32>()
        .map_err(|e| e.to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected_binary_pcm".into());
    };
    state.service.push(&state.identity(window.label())?, id, sequence, bytes)
}
#[tauri3_specta::command]
pub async fn voice_control(
    window: tauri::Window, state: State<'_, VoiceState>, action: String, recording_id: String,
) -> Result<(), String> {
    check(&window, false)?;
    if !matches!(action.as_str(), "cancel" | "finish" | "release") {
        return Err("invalid_voice_action".into());
    }
    let command = json!({"action":action,"owner":state.identity(window.label())?,"recordingId":recording_id});
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || service.command(command)).await.map_err(|e| e.to_string())?
}
#[tauri3_specta::command]
pub async fn voice_profiles(window: tauri::Window, state: State<'_, VoiceState>) -> Result<Profiles, String> {
    check(&window, false)?;
    let credentials = Arc::clone(&state.credentials);
    tauri::async_runtime::spawn_blocking(move || {
        let keys = credentials.lock().map_err(|_| "voice_credentials_poisoned")?;
        Ok(Profiles { vui: keys.get("vui")?.is_some(), doubao: keys.get("doubao")?.is_some() })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialInput {
    provider: alwith_voice::contract::Provider,
    api_key: String,
}
#[tauri3_specta::command]
pub async fn voice_save_credential(
    window: tauri::Window, state: State<'_, VoiceState>, input: CredentialInput,
) -> Result<(), String> {
    check(&window, true)?;
    let provider = match input.provider {
        alwith_voice::contract::Provider::Vui => "vui",
        alwith_voice::contract::Provider::Doubao => "doubao",
    };
    let credentials = Arc::clone(&state.credentials);
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let keys = credentials.lock().map_err(|_| "voice_credentials_poisoned")?;
        keys.set(provider, &input.api_key)?;
        service.command(json!({"action":"cancelProvider","provider":provider}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct CredentialProvider {
    provider: alwith_voice::contract::Provider,
}
#[tauri3_specta::command]
pub async fn voice_delete_credential(
    window: tauri::Window, state: State<'_, VoiceState>, input: CredentialProvider,
) -> Result<(), String> {
    check(&window, true)?;
    let provider = match input.provider {
        alwith_voice::contract::Provider::Vui => "vui",
        alwith_voice::contract::Provider::Doubao => "doubao",
    };
    let credentials = Arc::clone(&state.credentials);
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let keys = credentials.lock().map_err(|_| "voice_credentials_poisoned")?;
        keys.revoke(provider)?;
        service.command(json!({"action":"cancelProvider","provider":provider}))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn detach(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<VoiceState>() {
        let owner = {
            let mut generations = state.generations.lock().expect("voice generations");
            let previous = generations.entry(label.into()).or_default().replace();
            format!("{label}:{previous}")
        };
        if let Err(error) = state.service.command(json!({"action":"detach","owner":owner})) {
            log::error!("Voice detach failed: {error}");
        }
        state.channels.lock().expect("voice routes").retain(|_, (bound, _)| bound != &owner);
    }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<VoiceState>() {
        state.service.shutdown();
    }
}

pub fn document_ready(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<VoiceState>() {
        state.generations.lock().expect("voice generations").entry(label.into()).or_default().ready = true;
    }
}
#[cfg(test)]
mod tests {
    use super::{Document, Voice};
    #[test]
    fn shared_voice_service_shutdown_wakes_reader() {
        let service = Voice::new().expect("create voice service");
        let reader = service.clone();
        let thread = std::thread::spawn(move || reader.next());
        assert_eq!(
            service.command(serde_json::json!({"action":"invalid","owner":"test","recordingId":"r"})).unwrap_err(),
            "unknown_recording"
        );
        service.shutdown();
        assert!(thread.join().unwrap().unwrap().is_none());
    }

    #[test]
    fn navigation_denies_capture_until_finished_and_changes_owner() {
        let mut document = Document::default();
        assert!(document.capture_identity("chat").is_err());
        document.ready = true;
        assert_eq!(document.capture_identity("chat").unwrap(), "chat:0");
        assert_eq!(document.replace(), 0);
        assert!(document.capture_identity("chat").is_err());
        document.ready = true;
        assert_eq!(document.capture_identity("chat").unwrap(), "chat:1");
    }
}
