//! Tauri wire adapters for SDK types that do not implement Specta.
//! IO and policy remain in alwith-extension; conversions are exhaustive.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpRequest {
    pub url: String,
    pub method: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub body: Option<Vec<u8>>,
}
impl From<HttpRequest> for alwith_extension::http::HttpRequest {
    fn from(value: HttpRequest) -> Self {
        Self { url: value.url, method: value.method, headers: value.headers, body: value.body }
    }
}

#[derive(Serialize, specta::Type)]
pub struct HttpResponse {
    pub status: u16,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}
impl From<alwith_extension::http::HttpResponse> for HttpResponse {
    fn from(value: alwith_extension::http::HttpResponse) -> Self {
        Self { status: value.status, url: value.url, headers: value.headers, body: value.body }
    }
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileOperation {
    Read,
    Write,
    Mkdir,
    Remove,
    List,
    Stat,
}
impl From<FileOperation> for alwith_extension::filesystem::FileOperation {
    fn from(value: FileOperation) -> Self {
        match value {
            FileOperation::Read => Self::Read,
            FileOperation::Write => Self::Write,
            FileOperation::Mkdir => Self::Mkdir,
            FileOperation::Remove => Self::Remove,
            FileOperation::List => Self::List,
            FileOperation::Stat => Self::Stat,
        }
    }
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRequest {
    pub operation: FileOperation,
    pub scope: Option<String>,
    pub path: String,
    pub body: Option<Vec<u8>>,
    #[serde(default)]
    pub recursive: bool,
}
impl From<FileRequest> for alwith_extension::filesystem::FileRequest {
    fn from(value: FileRequest) -> Self {
        Self {
            operation: value.operation.into(),
            scope: value.scope,
            path: value.path,
            body: value.body,
            recursive: value.recursive,
        }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_file: bool,
    pub is_directory: bool,
}
impl From<alwith_extension::filesystem::FileEntry> for FileEntry {
    fn from(value: alwith_extension::filesystem::FileEntry) -> Self {
        Self { name: value.name, is_file: value.is_file, is_directory: value.is_directory }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileResponse {
    Read { body: Vec<u8> },
    List { entries: Vec<FileEntry> },
    Stat { exists: bool, size: u64, mtime: Option<u64>, is_file: bool, is_directory: bool },
    Ok,
}
impl From<alwith_extension::filesystem::FileResponse> for FileResponse {
    fn from(value: alwith_extension::filesystem::FileResponse) -> Self {
        match value {
            alwith_extension::filesystem::FileResponse::Read { body } => Self::Read { body },
            alwith_extension::filesystem::FileResponse::List { entries } => {
                Self::List { entries: entries.into_iter().map(Into::into).collect() }
            }
            alwith_extension::filesystem::FileResponse::Stat { exists, size, mtime, is_file, is_directory } => {
                Self::Stat { exists, size, mtime, is_file, is_directory }
            }
            alwith_extension::filesystem::FileResponse::Ok => Self::Ok,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requests_preserve_sdk_defaults_and_reject_unknown_fields() {
        let input = json!({"operation": "read", "path": "notes.txt"});
        let wire: FileRequest = serde_json::from_value(input.clone()).unwrap();
        let adapted: alwith_extension::filesystem::FileRequest = wire.into();
        let native: alwith_extension::filesystem::FileRequest = serde_json::from_value(input).unwrap();
        assert_eq!(adapted.path, native.path);
        assert_eq!(adapted.scope, native.scope);
        assert_eq!(adapted.recursive, native.recursive);
        assert!(matches!(adapted.operation, alwith_extension::filesystem::FileOperation::Read));
        assert!(
            serde_json::from_value::<FileRequest>(json!({"operation": "read", "path": "a", "unknown": true})).is_err()
        );
        let request: HttpRequest = serde_json::from_value(json!({"url": "https://example.com"})).unwrap();
        let native: alwith_extension::http::HttpRequest = request.into();
        assert!(native.method.is_none());
        assert!(native.headers.is_empty());
        assert!(native.body.is_none());
    }

    #[test]
    fn responses_preserve_the_sdk_serialization() {
        use alwith_extension::filesystem::FileResponse as Native;
        for response in [
            Native::Read { body: vec![0, 127, 255] },
            Native::List {
                entries: vec![alwith_extension::filesystem::FileEntry {
                    name: "notes.txt".into(),
                    is_file: true,
                    is_directory: false,
                }],
            },
            Native::Stat { exists: true, size: 123, mtime: Some(456), is_file: true, is_directory: false },
            Native::Ok,
        ] {
            let expected = serde_json::to_value(&response).unwrap();
            assert_eq!(serde_json::to_value(FileResponse::from(response)).unwrap(), expected);
        }
        let response = alwith_extension::http::HttpResponse {
            status: 200,
            url: "https://example.com".into(),
            headers: BTreeMap::new(),
            body: vec![0, 255],
        };
        let expected = serde_json::to_value(&response).unwrap();
        assert_eq!(serde_json::to_value(HttpResponse::from(response)).unwrap(), expected);
    }
}
