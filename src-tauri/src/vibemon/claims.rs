use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};

#[derive(Default)]
struct Claims(Mutex<HashSet<String>>);

impl Claims {
    fn claim(&self, scope: &str, request_id: &str) -> bool {
        self.0.lock().expect("Vibemon claims lock").insert(format!("{scope}/{request_id}"))
    }
}

// Keep claims for the process lifetime, including across WebView reloads and owner changes.
static CLAIMS: OnceLock<Claims> = OnceLock::new();

pub(super) fn claim(scope: &str, request_id: &str) -> bool {
    CLAIMS.get_or_init(Default::default).claim(scope, request_id)
}

#[cfg(test)]
#[path = "__tests__/claims.rs"]
mod tests;
