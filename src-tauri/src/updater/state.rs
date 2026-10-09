use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DisablementReason {
    InvalidConfiguration,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub filename: String,
    pub signature: String,
    pub content_length: Option<u64>,
}

/// The updater state machine (VSCode abstractUpdateService). `AvailableForDownload` is
/// stored but never emitted: a hit is downloaded straight away.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[derive(tauri3_specta::Event)]
#[event(name = "updater:state")]
pub enum State {
    Uninitialized,
    Disabled {
        reason: DisablementReason,
    },
    Idle,
    CheckingForUpdates,
    AvailableForDownload {
        update: UpdateInfo,
    },
    Downloading {
        update: UpdateInfo,
        #[serde(rename = "downloadedBytes")]
        downloaded_bytes: Option<u64>,
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
    },
    Ready {
        update: UpdateInfo,
    },
    Restarting {
        update: UpdateInfo,
    },
}

impl State {
    pub fn idle() -> Self {
        State::Idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_with_camelcase_type_tag() {
        let json = serde_json::to_string(&State::idle()).unwrap();
        assert!(json.contains("\"type\":\"idle\""));
    }

    #[test]
    fn ready_state_with_update_info_round_trips() {
        let update = UpdateInfo {
            version: "0.2.0".into(),
            filename: "ALwith.Codex.app.tar.gz".into(),
            signature: "sig".into(),
            content_length: Some(123),
        };
        let state = State::Ready { update };
        let json = serde_json::to_string(&state).unwrap();
        let back: State = serde_json::from_str(&json).unwrap();
        assert_eq!(state, back);
    }

    #[test]
    fn downloading_serializes_snake_case_fields_as_camelcase() {
        let state = State::Downloading {
            update: UpdateInfo {
                version: "1.1.0".into(),
                filename: "x.tar.gz".into(),
                signature: "signature".into(),
                content_length: Some(1000),
            },
            downloaded_bytes: Some(100),
            total_bytes: Some(1000),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"downloadedBytes\":100"));
        assert!(json.contains("\"totalBytes\":1000"));
    }
}
