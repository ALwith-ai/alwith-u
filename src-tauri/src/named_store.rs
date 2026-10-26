//! 命名 KV 存储的桌面侧入口(`@alwith/module-store` 的 Tauri 实现),与 ALwith Desktop
//! `features/store.rs` 同一套,去掉其 provider 专属过滤。
//!
//! 登录态、Vibemon 资源这类前端杂项原先走 tauri-plugin-store —— 裸 `fs::write` 非原子,
//! 解析失败静默回退默认值;改走这里后与 Desktop 同一份实现(原子替换、`.bak`、损坏不静默重置)。
//! 文件路径不变(`app_data_dir/<name>.json`,JSON 对象),已有数据原样读回。

use alwith_module_store::{ScopedStores, Store, StoreScope};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct NamedStoreState {
    stores: ScopedStores,
}

impl NamedStoreState {
    pub fn store_in(&self, scope: StoreScope, name: &str) -> Result<std::sync::Arc<Store>, String> {
        self.stores.open(scope, name)
    }
}

/// 缓存域 store 的子目录名 —— 单独一层,「设置 → 缓存 → 清理」整个删掉即可。
pub const CACHE_STORE_DIRECTORY: &str = "stores";

pub fn init(app: &AppHandle) -> Result<(), String> {
    let data_directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let cache_directory = app.path().app_cache_dir().map_err(|error| error.to_string())?.join(CACHE_STORE_DIRECTORY);
    std::fs::create_dir_all(&data_directory).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&cache_directory).map_err(|error| error.to_string())?;
    let state = NamedStoreState { stores: ScopedStores::new(data_directory, cache_directory) };
    // 所有命名存储的变更走同一条通道,订阅一次即可 —— 不是每开一个 store 各挂一个转发任务。
    let (mut receiver, mut cache_receiver) = state.stores.subscribe();
    let emit_application = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let change = tokio::select! {
                data = receiver.recv() => data,
                cache = cache_receiver.recv() => cache
            };
            match change {
                Ok(change) => {
                    let _ = emit_application.emit("store-changed", &change);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    app.manage(state);
    Ok(())
}

#[tauri3_specta::command]
pub fn store_entries(state: State<'_, NamedStoreState>, scope: StoreScope, store: String) -> Result<Value, String> {
    Ok(Value::Object(state.store_in(scope, &store)?.entries().into_iter().collect()))
}

#[tauri3_specta::command]
pub fn store_set(
    state: State<'_, NamedStoreState>, scope: StoreScope, store: String, key: String, value: Value,
) -> Result<(), String> {
    state.store_in(scope, &store)?.set(key, value)
}

#[tauri3_specta::command]
pub fn store_delete(
    state: State<'_, NamedStoreState>, scope: StoreScope, store: String, key: String,
) -> Result<(), String> {
    state.store_in(scope, &store)?.remove(&key)
}

#[tauri3_specta::command]
pub fn store_clear(state: State<'_, NamedStoreState>, scope: StoreScope, store: String) -> Result<(), String> {
    state.store_in(scope, &store)?.clear()
}

#[tauri3_specta::command]
pub fn store_reload(state: State<'_, NamedStoreState>, scope: StoreScope, store: String) -> Result<(), String> {
    state.store_in(scope, &store)?.reload()
}
