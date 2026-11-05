use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
pub(super) struct Route {
    pub agent: String,
    pub model: String,
    pub generation: u64,
}

#[derive(Default)]
pub(super) struct Gate {
    pub generation: u64,
    pub account: Option<String>,
    pub models: BTreeSet<String>,
    pub routes: BTreeMap<String, Route>,
}

impl Gate {
    pub fn bind(&mut self, account: String) -> Result<u64, String> {
        if self.account.as_ref() == Some(&account) {
            return Ok(self.generation);
        }
        self.invalidate()?;
        self.account = Some(account);
        Ok(self.generation)
    }
    pub fn invalidate(&mut self) -> Result<(), String> {
        self.generation = self.generation.checked_add(1).ok_or("Enterprise generation exhausted")?;
        self.account = None;
        self.models.clear();
        Ok(())
    }
    pub fn commit(&mut self, generation: u64, models: BTreeSet<String>) -> Result<(), String> {
        if self.account.is_none() || self.generation != generation {
            return Err("ALwith account changed".into());
        }
        for route in self.routes.values_mut() {
            if !models.contains(&route.model) {
                route.generation = 0;
            }
        }
        self.models = models;
        Ok(())
    }
    pub fn check(&self, requested: Option<&str>, session: Option<&str>) -> Result<(), String> {
        if requested.is_some_and(|model| self.account.is_none() || !self.models.contains(model)) {
            return Err("The selected ALwith account model is unavailable. Select another model before sending.".into());
        }
        if session.and_then(|id| self.routes.get(id)).is_some_and(|route| {
            self.account.is_none() || route.generation != self.generation || !self.models.contains(&route.model)
        }) {
            return Err("The ALwith account changed. Select a model before sending.".into());
        }
        Ok(())
    }
    pub fn observe(&mut self, session: &str, agent: &str, model: &str, generation: Option<u64>) {
        if generation.is_some() || !self.routes.contains_key(session) {
            self.routes.insert(
                session.into(),
                Route { agent: agent.into(), model: model.into(), generation: generation.unwrap_or(self.generation) },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const MODEL: &str = "gateway:custom-enterprise:model";
    #[test]
    fn revoked_sessions_need_explicit_reselection_even_after_same_account_relogin() {
        let mut gate = Gate::default();
        let first = gate.bind("a".into()).unwrap();
        gate.commit(first, BTreeSet::from([MODEL.into()])).unwrap();
        gate.observe("session", "codex", MODEL, Some(first));
        gate.invalidate().unwrap();
        assert!(gate.check(None, Some("session")).is_err());
        let next = gate.bind("a".into()).unwrap();
        gate.commit(next, BTreeSet::from([MODEL.into()])).unwrap();
        assert!(gate.commit(first, BTreeSet::from([MODEL.into()])).is_err());
        gate.observe("session", "codex", MODEL, None);
        assert!(gate.check(None, Some("session")).is_err());
        gate.observe("session", "codex", MODEL, Some(next));
        assert!(gate.check(None, Some("session")).is_ok());
    }
    #[test]
    fn a_catalog_removal_cannot_be_undone_by_a_late_notification_or_catalog_reappearance() {
        let mut gate = Gate::default();
        let generation = gate.bind("a".into()).unwrap();
        gate.commit(generation, BTreeSet::from([MODEL.into()])).unwrap();
        gate.observe("session", "codex", MODEL, Some(generation));
        gate.commit(generation, BTreeSet::new()).unwrap();
        gate.commit(generation, BTreeSet::from([MODEL.into()])).unwrap();
        gate.observe("session", "codex", MODEL, None);
        assert!(gate.check(None, Some("session")).is_err());
        assert!(gate.check(Some(MODEL), None).is_ok());
    }
    #[test]
    fn binding_another_account_rejects_previous_catalogs() {
        let mut gate = Gate::default();
        let first = gate.bind("a".into()).unwrap();
        let second = gate.bind("b".into()).unwrap();
        assert_ne!(first, second);
        assert!(gate.commit(first, BTreeSet::from([MODEL.into()])).is_err());
        assert!(gate.check(Some(MODEL), None).is_err());
    }
}
