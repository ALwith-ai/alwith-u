use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
};
use tokio::sync::oneshot;

use crate::{
    frontend::{SnapGeometryUpdate, WindowControlPolicy},
    DecorationError, DecorationStatus,
};

#[cfg(target_os = "macos")]
use crate::traffic_state::TrafficRegistry;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct Generation(u64);

impl Generation {
    pub(crate) fn get(self) -> u64 {
        self.0
    }

    #[cfg(test)]
    fn from_raw(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct DocumentToken(u64);

impl DocumentToken {
    pub(crate) fn get(self) -> u64 {
        self.0
    }

    #[cfg(test)]
    fn from_raw(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FrontendTarget {
    pub(crate) window: Generation,
    pub(crate) document: DocumentToken,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReadinessChallenge(u64);

impl ReadinessChallenge {
    pub(crate) fn get(self) -> u64 {
        self.0
    }

    pub(crate) fn from_raw(value: u64) -> Option<Self> {
        (value != 0).then_some(Self(value))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DocumentBinding {
    nonce: Option<String>,
    origin: String,
    lease: u64,
}

impl FrontendTarget {
    pub(crate) fn from_values(window: u64, document: u64) -> Option<Self> {
        (window != 0 && document != 0).then_some(Self {
            window: Generation(window),
            document: DocumentToken(document),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Reserved(DocumentToken),
    Preparing(DocumentToken),
    Applying(DocumentToken),
    Active(DocumentToken),
    Failed(DocumentToken),
    Native(DocumentToken),
    Recovering(DocumentToken),
    Destroying,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Entry {
    generation: Generation,
    phase: Phase,
    policy: Option<WindowControlPolicy>,
    last_geometry_sequence: u64,
    last_geometry_operation: Option<SnapGeometryUpdate>,
    window_state_revision: u64,
}

impl Entry {
    fn target(self) -> Option<FrontendTarget> {
        let document = match self.phase {
            Phase::Reserved(document)
            | Phase::Preparing(document)
            | Phase::Applying(document)
            | Phase::Active(document)
            | Phase::Failed(document)
            | Phase::Native(document)
            | Phase::Recovering(document) => document,
            Phase::Destroying => return None,
        };
        Some(FrontendTarget {
            window: self.generation,
            document,
        })
    }

    fn matches(self, target: FrontendTarget) -> bool {
        self.target() == Some(target)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ActivationDecision {
    AlreadyActive(FrontendTarget),
    InProgress(FrontendTarget),
    Recovering,
    Reserved(FrontendTarget),
}

pub(crate) enum PageStartDecision {
    Activate {
        previous: Option<FrontendTarget>,
        target: FrontendTarget,
    },
    BindingOnly,
    Ignored,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReadinessDecision {
    Apply,
    AlreadyApplying,
    AlreadyActive,
    Stale,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DocumentBootDecision {
    Challenge(FrontendTarget, ReadinessChallenge, u64),
    Registered(u64),
    RetryCurrentBinding,
    Stale,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DocumentReadyDecision {
    Accepted,
    NoActivation,
    RetryCurrentBinding,
    Stale,
}

fn document_origin(url: &str) -> String {
    tauri::webview::Url::parse(url)
        .expect("Tauri page-load URLs are valid URLs")
        .origin()
        .ascii_serialization()
}

#[derive(Debug, Default)]
pub(crate) struct Lifecycle {
    next_generation: u64,
    next_document: u64,
    entries: HashMap<String, Entry>,
}

impl Lifecycle {
    fn allocate_window_target(&mut self) -> FrontendTarget {
        self.next_generation += 1;
        self.next_document += 1;
        FrontendTarget {
            window: Generation(self.next_generation),
            document: DocumentToken(self.next_document),
        }
    }

    fn allocate_document(&mut self, generation: Generation) -> FrontendTarget {
        self.next_document += 1;
        FrontendTarget {
            window: generation,
            document: DocumentToken(self.next_document),
        }
    }

    pub(crate) fn begin_activation(&mut self, label: &str) -> ActivationDecision {
        if let Some(entry) = self.entries.get(label).copied() {
            match entry.phase {
                Phase::Active(_) => {
                    return ActivationDecision::AlreadyActive(
                        entry.target().expect("active entry has a document"),
                    );
                }
                Phase::Reserved(_) | Phase::Preparing(_) | Phase::Applying(_) => {
                    return ActivationDecision::InProgress(
                        entry.target().expect("in-progress entry has a document"),
                    );
                }
                Phase::Failed(_) | Phase::Native(_) => {
                    let target = self.allocate_document(entry.generation);
                    self.entries.insert(
                        label.to_owned(),
                        Entry {
                            generation: target.window,
                            phase: Phase::Reserved(target.document),
                            policy: None,
                            last_geometry_sequence: 0,
                            last_geometry_operation: None,
                            window_state_revision: 0,
                        },
                    );
                    return ActivationDecision::Reserved(target);
                }
                Phase::Recovering(_) => return ActivationDecision::Recovering,
                Phase::Destroying => {
                    // A replacement may reuse the label while generation-specific
                    // teardown for the old native window is still completing.
                }
            }
        }

        let target = self.allocate_window_target();
        self.entries.insert(
            label.to_owned(),
            Entry {
                generation: target.window,
                phase: Phase::Reserved(target.document),
                policy: None,
                last_geometry_sequence: 0,
                last_geometry_operation: None,
                window_state_revision: 0,
            },
        );
        ActivationDecision::Reserved(target)
    }

    pub(crate) fn page_started(&mut self, label: &str) -> PageStartDecision {
        let Some(entry) = self.entries.get(label).copied() else {
            let target = self.allocate_window_target();
            self.entries.insert(
                label.to_owned(),
                Entry {
                    generation: target.window,
                    phase: Phase::Native(target.document),
                    policy: None,
                    last_geometry_sequence: 0,
                    last_geometry_operation: None,
                    window_state_revision: 0,
                },
            );
            return PageStartDecision::BindingOnly;
        };
        match entry.phase {
            Phase::Native(_) => {
                let target = self.allocate_document(entry.generation);
                self.entries.insert(
                    label.to_owned(),
                    Entry {
                        generation: target.window,
                        phase: Phase::Native(target.document),
                        policy: None,
                        last_geometry_sequence: 0,
                        last_geometry_operation: None,
                        window_state_revision: 0,
                    },
                );
                PageStartDecision::BindingOnly
            }
            Phase::Recovering(_) => PageStartDecision::BindingOnly,
            Phase::Destroying => PageStartDecision::Ignored,
            _ => {
                let previous = entry.target();
                let target = self.allocate_document(entry.generation);
                self.entries.insert(
                    label.to_owned(),
                    Entry {
                        generation: target.window,
                        phase: Phase::Reserved(target.document),
                        policy: None,
                        last_geometry_sequence: 0,
                        last_geometry_operation: None,
                        window_state_revision: 0,
                    },
                );
                PageStartDecision::Activate { previous, target }
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn pending_target(&self, label: &str) -> Option<FrontendTarget> {
        self.entries.get(label).copied().and_then(|entry| {
            matches!(entry.phase, Phase::Reserved(_) | Phase::Preparing(_))
                .then(|| entry.target().expect("pending entry has a document"))
        })
    }

    pub(crate) fn current_target(&self, label: &str) -> Option<FrontendTarget> {
        self.entries.get(label).copied().and_then(Entry::target)
    }

    fn is_applying(&self, label: &str, target: FrontendTarget) -> bool {
        self.entries
            .get(label)
            .is_some_and(|entry| entry.matches(target) && matches!(entry.phase, Phase::Applying(_)))
    }

    #[cfg(test)]
    pub(crate) fn active_target(&self, label: &str) -> Option<FrontendTarget> {
        self.entries.get(label).copied().and_then(|entry| {
            matches!(entry.phase, Phase::Active(_))
                .then(|| entry.target().expect("active entry has a document"))
        })
    }

    pub(crate) fn claim_window_state_revision(
        &mut self,
        label: &str,
    ) -> Option<(FrontendTarget, u64)> {
        let entry = self.entries.get_mut(label)?;
        if !matches!(entry.phase, Phase::Active(_)) {
            return None;
        }
        entry.window_state_revision = entry.window_state_revision.checked_add(1)?;
        Some((
            entry.target().expect("active entry has a document"),
            entry.window_state_revision,
        ))
    }

    #[cfg(test)]
    pub(crate) fn fail_preparation(&mut self, label: &str, target: FrontendTarget) -> bool {
        self.transition(
            label,
            target,
            |phase| matches!(phase, Phase::Reserved(_) | Phase::Preparing(_)),
            Phase::Failed(target.document),
        )
    }

    pub(crate) fn begin_preparation(&mut self, label: &str, target: FrontendTarget) -> bool {
        self.transition(
            label,
            target,
            |phase| matches!(phase, Phase::Reserved(_)),
            Phase::Preparing(target.document),
        )
    }

    pub(crate) fn is_reserved(&self, label: &str, target: FrontendTarget) -> bool {
        self.entries
            .get(label)
            .is_some_and(|entry| entry.matches(target) && matches!(entry.phase, Phase::Reserved(_)))
    }

    pub(crate) fn begin_native_apply(
        &mut self,
        label: &str,
        target: FrontendTarget,
    ) -> ReadinessDecision {
        let Some(entry) = self.entries.get(label).copied() else {
            return ReadinessDecision::Stale;
        };
        if !entry.matches(target) {
            return ReadinessDecision::Stale;
        }

        match entry.phase {
            Phase::Preparing(_) => {
                self.entries.insert(
                    label.to_owned(),
                    Entry {
                        generation: target.window,
                        phase: Phase::Applying(target.document),
                        policy: entry.policy,
                        last_geometry_sequence: entry.last_geometry_sequence,
                        last_geometry_operation: entry.last_geometry_operation,
                        window_state_revision: entry.window_state_revision,
                    },
                );
                ReadinessDecision::Apply
            }
            Phase::Applying(_) => ReadinessDecision::AlreadyApplying,
            Phase::Active(_) => ReadinessDecision::AlreadyActive,
            Phase::Reserved(_)
            | Phase::Failed(_)
            | Phase::Native(_)
            | Phase::Recovering(_)
            | Phase::Destroying => ReadinessDecision::Stale,
        }
    }

    pub(crate) fn commit_native_apply(&mut self, label: &str, target: FrontendTarget) -> bool {
        self.transition(
            label,
            target,
            |phase| matches!(phase, Phase::Applying(_)),
            Phase::Active(target.document),
        )
    }

    #[cfg(test)]
    pub(crate) fn fail_native_apply(&mut self, label: &str, target: FrontendTarget) -> bool {
        self.transition(
            label,
            target,
            |phase| matches!(phase, Phase::Applying(_)),
            Phase::Failed(target.document),
        )
    }

    #[cfg(test)]
    pub(crate) fn cancel_current(&mut self, label: &str) -> Option<FrontendTarget> {
        let entry = self.entries.get_mut(label)?;
        if entry.phase == Phase::Destroying {
            return None;
        }
        let target = entry.target()?;
        entry.phase = Phase::Native(target.document);
        entry.policy = None;
        Some(target)
    }

    pub(crate) fn begin_recovery(
        &mut self,
        label: &str,
        expected: Option<FrontendTarget>,
    ) -> Option<FrontendTarget> {
        let entry = self.entries.get_mut(label)?;
        if matches!(
            entry.phase,
            Phase::Native(_) | Phase::Recovering(_) | Phase::Destroying
        ) {
            return None;
        }
        let target = entry.target()?;
        if expected.is_some_and(|expected| expected != target) {
            return None;
        }
        entry.phase = Phase::Recovering(target.document);
        entry.policy = None;
        Some(target)
    }

    pub(crate) fn begin_frontend_failure(
        &mut self,
        label: &str,
        expected: Option<FrontendTarget>,
    ) -> Option<FrontendTarget> {
        let entry = self.entries.get_mut(label)?;
        if !matches!(entry.phase, Phase::Preparing(_)) {
            return None;
        }
        let target = entry.target()?;
        if expected.is_some_and(|expected| expected != target) {
            return None;
        }
        entry.phase = Phase::Recovering(target.document);
        entry.policy = None;
        Some(target)
    }

    pub(crate) fn finish_recovery(
        &mut self,
        label: &str,
        target: FrontendTarget,
        restored: bool,
    ) -> bool {
        self.transition(
            label,
            target,
            |phase| matches!(phase, Phase::Recovering(_)),
            if restored {
                Phase::Native(target.document)
            } else {
                Phase::Failed(target.document)
            },
        )
    }

    pub(crate) fn status(&self, label: &str) -> DecorationStatus {
        match self.entries.get(label).map(|entry| entry.phase) {
            Some(Phase::Reserved(_) | Phase::Preparing(_) | Phase::Applying(_)) => {
                DecorationStatus::Preparing
            }
            Some(Phase::Active(_)) => DecorationStatus::Active,
            Some(Phase::Failed(_)) => DecorationStatus::Failed,
            Some(Phase::Recovering(_)) => DecorationStatus::Recovering,
            Some(Phase::Native(_) | Phase::Destroying) | None => DecorationStatus::Native,
        }
    }

    fn transition(
        &mut self,
        label: &str,
        target: FrontendTarget,
        accepts: impl FnOnce(Phase) -> bool,
        next: Phase,
    ) -> bool {
        let Some(entry) = self.entries.get_mut(label) else {
            return false;
        };
        if !entry.matches(target) || !accepts(entry.phase) {
            return false;
        }
        entry.phase = next;
        if matches!(
            next,
            Phase::Failed(_) | Phase::Native(_) | Phase::Recovering(_) | Phase::Destroying
        ) {
            entry.policy = None;
        }
        true
    }

    pub(crate) fn set_policy(
        &mut self,
        label: &str,
        target: FrontendTarget,
        policy: WindowControlPolicy,
    ) -> bool {
        let Some(entry) = self.entries.get_mut(label) else {
            return false;
        };
        if !entry.matches(target) || !matches!(entry.phase, Phase::Preparing(_)) {
            return false;
        }
        entry.policy = Some(policy);
        true
    }

    pub(crate) fn policy(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<WindowControlPolicy> {
        self.entries
            .get(label)
            .filter(|entry| entry.matches(target))
            .and_then(|entry| entry.policy)
    }

    pub(crate) fn active_policy(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<WindowControlPolicy> {
        self.entries
            .get(label)
            .filter(|entry| entry.matches(target) && matches!(entry.phase, Phase::Active(_)))
            .and_then(|entry| entry.policy)
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn accept_geometry(
        &self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> GeometryDecision {
        let Some(entry) = self.entries.get(label) else {
            return GeometryDecision::Denied;
        };
        if !entry.matches(target)
            || !matches!(entry.phase, Phase::Active(_))
            || !entry.policy.is_some_and(|policy| policy.snap_geometry)
        {
            return GeometryDecision::Denied;
        }
        if update.sequence() == entry.last_geometry_sequence {
            return if entry.last_geometry_operation == Some(update) {
                GeometryDecision::Retry
            } else {
                GeometryDecision::Conflict
            };
        }
        if entry.last_geometry_sequence.checked_add(1) == Some(update.sequence()) {
            return GeometryDecision::Next;
        }
        GeometryDecision::Stale
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn commit_geometry(
        &mut self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> bool {
        let Some(entry) = self.entries.get_mut(label) else {
            return false;
        };
        if !entry.matches(target)
            || !matches!(entry.phase, Phase::Active(_))
            || !entry.policy.is_some_and(|policy| policy.snap_geometry)
            || entry.last_geometry_sequence.checked_add(1) != Some(update.sequence())
        {
            return false;
        }
        entry.last_geometry_sequence = update.sequence();
        entry.last_geometry_operation = Some(update);
        true
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn geometry_cursor(&self, label: &str, target: FrontendTarget) -> Option<u64> {
        self.entries
            .get(label)
            .filter(|entry| entry.matches(target) && matches!(entry.phase, Phase::Active(_)))
            .map(|entry| entry.last_geometry_sequence)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn geometry_operation(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<SnapGeometryUpdate> {
        self.entries
            .get(label)
            .filter(|entry| entry.matches(target) && matches!(entry.phase, Phase::Active(_)))
            .and_then(|entry| entry.last_geometry_operation)
    }

    pub(crate) fn record_geometry_operation(
        &mut self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> bool {
        let Some(entry) = self.entries.get_mut(label) else {
            return false;
        };
        if !entry.matches(target)
            || !matches!(entry.phase, Phase::Applying(_))
            || entry.last_geometry_sequence.checked_add(1) != Some(update.sequence())
        {
            return false;
        }
        entry.last_geometry_sequence = update.sequence();
        entry.last_geometry_operation = Some(update);
        true
    }

    pub(crate) fn generation(&self, label: &str) -> Option<Generation> {
        self.entries.get(label).map(|entry| entry.generation)
    }

    pub(crate) fn begin_destroy(&mut self, label: &str, generation: Generation) -> bool {
        let Some(entry) = self.entries.get_mut(label) else {
            return false;
        };
        if entry.generation != generation || entry.phase == Phase::Destroying {
            return false;
        }
        entry.phase = Phase::Destroying;
        entry.policy = None;
        true
    }

    pub(crate) fn begin_destroy_current(&mut self, label: &str) -> Option<Generation> {
        let generation = self.generation(label)?;
        self.begin_destroy(label, generation).then_some(generation)
    }

    pub(crate) fn finish_destroy(&mut self, label: &str, generation: Generation) -> bool {
        let should_remove = self.entries.get(label).is_some_and(|entry| {
            entry.generation == generation && entry.phase == Phase::Destroying
        });
        if should_remove {
            self.entries.remove(label);
        }
        should_remove
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GeometryDecision {
    Next,
    Retry,
    Conflict,
    Stale,
    Denied,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct AttemptId(u64);

struct PendingActivation {
    id: AttemptId,
    challenge: Option<ReadinessChallenge>,
    document_nonce: Option<String>,
    document_lease: Option<u64>,
    document_origin: Option<String>,
    target: FrontendTarget,
    claimed: bool,
    deadline_elapsed: bool,
    waiters: Vec<oneshot::Sender<Result<(), DecorationError>>>,
}

struct PendingRecovery {
    id: RecoveryId,
    target: FrontendTarget,
    waiters: Vec<oneshot::Sender<Result<(), DecorationError>>>,
}

#[derive(Default)]
struct RuntimeState {
    next_attempt: u64,
    next_challenge: u64,
    next_document_lease: u64,
    next_recovery: u64,
    lifecycle: Lifecycle,
    documents: HashMap<String, DocumentBinding>,
    pending: HashMap<String, PendingActivation>,
    recovery: HashMap<String, PendingRecovery>,
}

impl RuntimeState {
    fn allocate_attempt(&mut self) -> AttemptId {
        self.next_attempt += 1;
        AttemptId(self.next_attempt)
    }

    fn allocate_recovery(&mut self) -> RecoveryId {
        self.next_recovery += 1;
        RecoveryId(self.next_recovery)
    }

    fn allocate_challenge(&mut self) -> ReadinessChallenge {
        self.next_challenge += 1;
        ReadinessChallenge(self.next_challenge)
    }

    fn allocate_document_lease(&mut self) -> u64 {
        self.next_document_lease += 1;
        self.next_document_lease
    }
}

pub(crate) enum ActivationRequest {
    AlreadyActive,
    Pending {
        attempt: AttemptId,
        challenge: Option<ReadinessChallenge>,
        receiver: oneshot::Receiver<Result<(), DecorationError>>,
        start: bool,
        target: FrontendTarget,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct NavigationRequest {
    pub(crate) attempt: Option<AttemptId>,
    pub(crate) challenge: Option<ReadinessChallenge>,
    pub(crate) start_deadline: bool,
    pub(crate) target: Option<FrontendTarget>,
    pub(crate) document_lease: u64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RecoveryClaim {
    id: RecoveryId,
    pub(crate) target: FrontendTarget,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RecoveryId(u64);

pub(crate) enum RecoveryRequest {
    AlreadyNative,
    Claimed(RecoveryClaim),
    InProgress(oneshot::Receiver<Result<(), DecorationError>>),
}

pub(crate) struct DecorationState {
    activation_timeout: std::time::Duration,
    runtime: Mutex<RuntimeState>,
    #[cfg(target_os = "macos")]
    traffic: Mutex<TrafficRegistry>,
}

impl DecorationState {
    pub(crate) fn new(activation_timeout: std::time::Duration) -> Self {
        Self {
            activation_timeout,
            runtime: Mutex::new(RuntimeState::default()),
            #[cfg(target_os = "macos")]
            traffic: Mutex::new(TrafficRegistry::default()),
        }
    }

    pub(crate) fn activation_timeout(&self) -> std::time::Duration {
        self.activation_timeout
    }

    fn runtime(&self) -> MutexGuard<'_, RuntimeState> {
        self.runtime.lock().unwrap()
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn with_traffic<T>(&self, action: impl FnOnce(&mut TrafficRegistry) -> T) -> T {
        let mut traffic = self.traffic.lock().unwrap();
        action(&mut traffic)
    }

    pub(crate) fn request_activation(
        &self,
        label: &str,
    ) -> Result<ActivationRequest, DecorationError> {
        let (sender, receiver) = oneshot::channel();
        let mut runtime = self.runtime();
        match runtime.lifecycle.begin_activation(label) {
            ActivationDecision::AlreadyActive(_) => Ok(ActivationRequest::AlreadyActive),
            ActivationDecision::Recovering => Err(DecorationError::cancelled(
                "native decoration restoration is in progress",
            )),
            ActivationDecision::InProgress(target) => {
                let pending = runtime
                    .pending
                    .get_mut(label)
                    .expect("in-progress lifecycle entry has a pending activation");
                debug_assert_eq!(pending.target, target);
                pending.waiters.push(sender);
                Ok(ActivationRequest::Pending {
                    attempt: pending.id,
                    challenge: pending.challenge,
                    receiver,
                    start: false,
                    target,
                })
            }
            ActivationDecision::Reserved(target) => {
                let attempt = runtime.allocate_attempt();
                let challenge = runtime.allocate_challenge();
                let (document_nonce, document_lease, document_origin) = runtime
                    .documents
                    .get(label)
                    .map(|document| {
                        (
                            document.nonce.clone(),
                            Some(document.lease),
                            Some(document.origin.clone()),
                        )
                    })
                    .unwrap_or((None, None, None));
                runtime.pending.insert(
                    label.to_owned(),
                    PendingActivation {
                        id: attempt,
                        challenge: Some(challenge),
                        document_nonce,
                        document_lease,
                        document_origin,
                        target,
                        claimed: false,
                        deadline_elapsed: false,
                        waiters: vec![sender],
                    },
                );
                Ok(ActivationRequest::Pending {
                    attempt,
                    challenge: Some(challenge),
                    receiver,
                    start: true,
                    target,
                })
            }
        }
    }

    pub(crate) fn page_started(&self, label: &str, url: String) -> Option<NavigationRequest> {
        let mut runtime = self.runtime();
        let decision = runtime.lifecycle.page_started(label);
        if matches!(decision, PageStartDecision::Ignored) {
            return None;
        }
        let document_lease = runtime.allocate_document_lease();
        let origin = document_origin(&url);
        runtime.documents.insert(
            label.to_owned(),
            DocumentBinding {
                nonce: None,
                origin: origin.clone(),
                lease: document_lease,
            },
        );
        let PageStartDecision::Activate { previous, target } = decision else {
            return Some(NavigationRequest {
                attempt: None,
                challenge: None,
                start_deadline: false,
                target: None,
                document_lease,
            });
        };
        let challenge = runtime.allocate_challenge();
        if let Some(pending) = runtime.pending.get_mut(label) {
            if previous == Some(pending.target) {
                pending.target = target;
                pending.challenge = Some(challenge);
                pending.document_nonce = None;
                pending.document_lease = Some(document_lease);
                pending.document_origin = Some(origin.clone());
                return Some(NavigationRequest {
                    attempt: Some(pending.id),
                    challenge: Some(challenge),
                    start_deadline: false,
                    target: Some(target),
                    document_lease,
                });
            }
        }

        let attempt = runtime.allocate_attempt();
        runtime.pending.insert(
            label.to_owned(),
            PendingActivation {
                id: attempt,
                challenge: Some(challenge),
                document_nonce: None,
                document_lease: Some(document_lease),
                document_origin: Some(origin),
                target,
                claimed: false,
                deadline_elapsed: false,
                waiters: Vec::new(),
            },
        );
        Some(NavigationRequest {
            attempt: Some(attempt),
            challenge: Some(challenge),
            start_deadline: true,
            target: Some(target),
            document_lease,
        })
    }

    pub(crate) fn claim_activation_attempt(
        &self,
        label: &str,
        attempt: AttemptId,
        target: FrontendTarget,
    ) -> bool {
        let mut runtime = self.runtime();
        if !runtime.lifecycle.is_reserved(label, target) {
            return false;
        }
        let Some(pending) = runtime.pending.get_mut(label) else {
            return false;
        };
        if pending.id != attempt || pending.target != target || pending.claimed {
            return false;
        }
        pending.claimed = true;
        true
    }

    pub(crate) fn activation_attempt_is_current(
        &self,
        label: &str,
        attempt: AttemptId,
        target: FrontendTarget,
    ) -> bool {
        let runtime = self.runtime();
        runtime.pending.get(label).is_some_and(|pending| {
            pending.id == attempt
                && pending.target == target
                && pending.claimed
                && !pending.deadline_elapsed
                && runtime.lifecycle.current_target(label) == Some(target)
        })
    }

    #[cfg(test)]
    pub(crate) fn begin_preparation(&self, label: &str, target: FrontendTarget) -> bool {
        self.runtime().lifecycle.begin_preparation(label, target)
    }

    pub(crate) fn register_document_boot(
        &self,
        label: &str,
        nonce: String,
        document_lease: u64,
        url: String,
    ) -> DocumentBootDecision {
        let mut runtime = self.runtime();
        let origin = document_origin(&url);
        let Some(document) = runtime.documents.get_mut(label) else {
            return DocumentBootDecision::RetryCurrentBinding;
        };
        if document.lease != document_lease {
            return DocumentBootDecision::Stale;
        }
        if document.origin != origin {
            return DocumentBootDecision::RetryCurrentBinding;
        }
        if document
            .nonce
            .as_deref()
            .is_some_and(|current| current != nonce)
        {
            return DocumentBootDecision::Stale;
        }
        document.nonce = Some(nonce.to_owned());
        let document_lease = document.lease;
        let Some(pending) = runtime.pending.get_mut(label) else {
            return DocumentBootDecision::Registered(document_lease);
        };
        if pending.document_lease != Some(document_lease)
            || pending.document_origin.as_deref() != Some(origin.as_str())
        {
            return DocumentBootDecision::Registered(document_lease);
        }
        if pending
            .document_nonce
            .as_deref()
            .is_some_and(|expected| expected != nonce)
        {
            return DocumentBootDecision::Stale;
        }
        pending.document_nonce = Some(nonce);
        pending.document_origin = Some(origin);
        pending.document_lease = Some(document_lease);
        pending.challenge.map_or(
            DocumentBootDecision::Registered(document_lease),
            |challenge| DocumentBootDecision::Challenge(pending.target, challenge, document_lease),
        )
    }

    pub(crate) fn accept_document_ready(
        &self,
        label: &str,
        target: FrontendTarget,
        challenge: ReadinessChallenge,
        nonce: &str,
        document_lease: u64,
        url: &str,
    ) -> DocumentReadyDecision {
        let mut runtime = self.runtime();
        let Some(pending) = runtime.pending.get(label) else {
            return DocumentReadyDecision::NoActivation;
        };
        let Some(document) = runtime.documents.get(label) else {
            return DocumentReadyDecision::RetryCurrentBinding;
        };
        let origin = document_origin(url);
        if document.lease != document_lease || document.origin != origin {
            return DocumentReadyDecision::RetryCurrentBinding;
        }
        if pending.target != target
            || pending.challenge != Some(challenge)
            || pending.document_nonce.as_deref() != Some(nonce)
            || pending.document_lease != Some(document_lease)
            || pending.document_origin.as_deref() != Some(origin.as_str())
            || document.nonce.as_deref() != Some(nonce)
        {
            return DocumentReadyDecision::Stale;
        }
        if !runtime.lifecycle.begin_preparation(label, target) {
            return DocumentReadyDecision::NoActivation;
        }
        runtime
            .pending
            .get_mut(label)
            .expect("accepted readiness retains its activation")
            .challenge = None;
        DocumentReadyDecision::Accepted
    }

    #[cfg(test)]
    pub(crate) fn pending_readiness(
        &self,
        label: &str,
    ) -> Option<(FrontendTarget, ReadinessChallenge)> {
        let runtime = self.runtime();
        let pending = runtime.pending.get(label)?;
        Some((pending.target, pending.challenge?))
    }

    pub(crate) fn deadline_latched(&self, label: &str, attempt: AttemptId) -> bool {
        self.runtime()
            .pending
            .get(label)
            .is_some_and(|pending| pending.id == attempt && pending.deadline_elapsed)
    }

    pub(crate) fn set_policy(
        &self,
        label: &str,
        target: FrontendTarget,
        policy: WindowControlPolicy,
    ) -> bool {
        self.runtime().lifecycle.set_policy(label, target, policy)
    }

    pub(crate) fn policy(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<WindowControlPolicy> {
        self.runtime().lifecycle.policy(label, target)
    }

    pub(crate) fn active_policy(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<WindowControlPolicy> {
        self.runtime().lifecycle.active_policy(label, target)
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn accept_geometry(
        &self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> GeometryDecision {
        self.runtime()
            .lifecycle
            .accept_geometry(label, target, update)
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn commit_geometry(
        &self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> bool {
        self.runtime()
            .lifecycle
            .commit_geometry(label, target, update)
    }

    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn geometry_cursor(&self, label: &str, target: FrontendTarget) -> Option<u64> {
        self.runtime().lifecycle.geometry_cursor(label, target)
    }

    pub(crate) fn document_lease(&self, label: &str, target: FrontendTarget) -> Option<u64> {
        let runtime = self.runtime();
        let document = runtime.documents.get(label)?;
        let current = runtime.lifecycle.current_target(label)?;
        (current == target).then_some(document.lease)
    }

    pub(crate) fn current_document_lease(&self, label: &str) -> Option<u64> {
        self.runtime()
            .documents
            .get(label)
            .map(|document| document.lease)
    }

    pub(crate) fn is_current_document(
        &self,
        label: &str,
        target: Option<FrontendTarget>,
        document_lease: u64,
    ) -> bool {
        let runtime = self.runtime();
        let Some(document) = runtime.documents.get(label) else {
            return false;
        };
        document.lease == document_lease
            && target.is_none_or(|target| runtime.lifecycle.current_target(label) == Some(target))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn geometry_operation(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> Option<SnapGeometryUpdate> {
        self.runtime().lifecycle.geometry_operation(label, target)
    }

    pub(crate) fn record_geometry_operation(
        &self,
        label: &str,
        target: FrontendTarget,
        update: SnapGeometryUpdate,
    ) -> bool {
        self.runtime()
            .lifecycle
            .record_geometry_operation(label, target, update)
    }

    pub(crate) fn begin_native_apply(
        &self,
        label: &str,
        target: FrontendTarget,
    ) -> ReadinessDecision {
        let mut runtime = self.runtime();
        if runtime
            .pending
            .get(label)
            .is_some_and(|pending| pending.target == target && pending.deadline_elapsed)
        {
            return ReadinessDecision::Stale;
        }
        runtime.lifecycle.begin_native_apply(label, target)
    }

    pub(crate) fn native_apply_is_current(&self, label: &str, target: FrontendTarget) -> bool {
        self.runtime().lifecycle.is_applying(label, target)
    }

    pub(crate) fn complete_activation(&self, label: &str, target: FrontendTarget) -> bool {
        let waiters = {
            let mut runtime = self.runtime();
            if !runtime.lifecycle.commit_native_apply(label, target) {
                return false;
            }
            Self::take_waiters(&mut runtime, label, target)
        };
        Self::notify(waiters, Ok(()));
        true
    }

    pub(crate) fn request_recovery(
        &self,
        label: &str,
        expected: Option<FrontendTarget>,
    ) -> RecoveryRequest {
        let mut runtime = self.runtime();
        Self::request_recovery_locked(&mut runtime, label, expected)
    }

    pub(crate) fn request_frontend_failure(
        &self,
        label: &str,
        expected: Option<FrontendTarget>,
    ) -> RecoveryRequest {
        let mut runtime = self.runtime();
        let Some(target) = runtime.lifecycle.begin_frontend_failure(label, expected) else {
            return RecoveryRequest::AlreadyNative;
        };
        let id = runtime.allocate_recovery();
        runtime.recovery.insert(
            label.to_owned(),
            PendingRecovery {
                id,
                target,
                waiters: Vec::new(),
            },
        );
        RecoveryRequest::Claimed(RecoveryClaim { id, target })
    }

    pub(crate) fn request_attempt_recovery(
        &self,
        label: &str,
        attempt: AttemptId,
        target: FrontendTarget,
    ) -> RecoveryRequest {
        let mut runtime = self.runtime();
        if !runtime
            .pending
            .get(label)
            .is_some_and(|pending| pending.id == attempt && pending.target == target)
        {
            return RecoveryRequest::AlreadyNative;
        }
        Self::request_recovery_locked(&mut runtime, label, Some(target))
    }

    fn request_recovery_locked(
        runtime: &mut RuntimeState,
        label: &str,
        expected: Option<FrontendTarget>,
    ) -> RecoveryRequest {
        if let Some(recovery) = runtime.recovery.get_mut(label) {
            if expected.is_none_or(|target| target == recovery.target) {
                let (sender, receiver) = oneshot::channel();
                recovery.waiters.push(sender);
                return RecoveryRequest::InProgress(receiver);
            }
            return RecoveryRequest::AlreadyNative;
        }
        let Some(target) = runtime.lifecycle.begin_recovery(label, expected) else {
            return RecoveryRequest::AlreadyNative;
        };
        let id = runtime.allocate_recovery();
        runtime.recovery.insert(
            label.to_owned(),
            PendingRecovery {
                id,
                target,
                waiters: Vec::new(),
            },
        );
        RecoveryRequest::Claimed(RecoveryClaim { id, target })
    }

    pub(crate) fn claim_timeout(&self, label: &str, attempt: AttemptId) -> Option<RecoveryClaim> {
        let mut runtime = self.runtime();
        let (target, claimed) = {
            let pending = runtime.pending.get(label)?;
            if pending.id != attempt {
                return None;
            }
            (pending.target, pending.claimed)
        };
        if claimed {
            runtime
                .pending
                .get_mut(label)
                .expect("activation remains pending while its setup job executes")
                .deadline_elapsed = true;
            return None;
        }
        let target = runtime.lifecycle.begin_recovery(label, Some(target))?;
        let id = runtime.allocate_recovery();
        runtime.recovery.insert(
            label.to_owned(),
            PendingRecovery {
                id,
                target,
                waiters: Vec::new(),
            },
        );
        Some(RecoveryClaim { id, target })
    }

    pub(crate) fn finish_activation_setup(
        &self,
        label: &str,
        attempt: AttemptId,
    ) -> Option<RecoveryClaim> {
        let mut runtime = self.runtime();
        let target = {
            let pending = runtime.pending.get_mut(label)?;
            if pending.id != attempt || !pending.claimed {
                return None;
            }
            pending.claimed = false;
            if !pending.deadline_elapsed {
                return None;
            }
            pending.target
        };
        let target = runtime.lifecycle.begin_recovery(label, Some(target))?;
        let id = runtime.allocate_recovery();
        runtime.recovery.insert(
            label.to_owned(),
            PendingRecovery {
                id,
                target,
                waiters: Vec::new(),
            },
        );
        Some(RecoveryClaim { id, target })
    }

    pub(crate) fn finish_recovery(
        &self,
        label: &str,
        claim: RecoveryClaim,
        restored: bool,
        result: DecorationError,
    ) -> bool {
        let (activation_waiters, recovery_waiters) =
            {
                let mut runtime = self.runtime();
                if !runtime.recovery.get(label).is_some_and(|recovery| {
                    recovery.id == claim.id && recovery.target == claim.target
                }) {
                    return false;
                }
                if !runtime
                    .lifecycle
                    .finish_recovery(label, claim.target, restored)
                {
                    return false;
                }
                let activation_waiters = Self::take_waiters(&mut runtime, label, claim.target);
                let recovery_waiters = runtime
                    .recovery
                    .remove(label)
                    .filter(|recovery| recovery.target == claim.target)
                    .map(|recovery| recovery.waiters)
                    .unwrap_or_default();
                (activation_waiters, recovery_waiters)
            };
        Self::notify(activation_waiters, Err(result.clone()));
        Self::notify(
            recovery_waiters,
            if restored { Ok(()) } else { Err(result) },
        );
        true
    }

    pub(crate) fn status(&self, label: &str) -> DecorationStatus {
        self.runtime().lifecycle.status(label)
    }

    #[cfg(test)]
    fn for_test() -> Self {
        Self::new(std::time::Duration::from_secs(5))
    }

    #[cfg(test)]
    pub(crate) fn begin_activation(&self, label: &str) -> ActivationDecision {
        self.runtime().lifecycle.begin_activation(label)
    }

    #[cfg(test)]
    pub(crate) fn fail_preparation(&self, label: &str, target: FrontendTarget) -> bool {
        self.runtime().lifecycle.fail_preparation(label, target)
    }

    #[cfg(test)]
    pub(crate) fn fail_native_apply(&self, label: &str, target: FrontendTarget) -> bool {
        self.runtime().lifecycle.fail_native_apply(label, target)
    }

    #[cfg(test)]
    pub(crate) fn cancel_current(&self, label: &str) -> Option<FrontendTarget> {
        self.runtime().lifecycle.cancel_current(label)
    }

    #[cfg(test)]
    pub(crate) fn pending_target(&self, label: &str) -> Option<FrontendTarget> {
        self.runtime().lifecycle.pending_target(label)
    }

    #[cfg(test)]
    pub(crate) fn current_target(&self, label: &str) -> Option<FrontendTarget> {
        self.runtime().lifecycle.current_target(label)
    }

    #[cfg(test)]
    pub(crate) fn active_target(&self, label: &str) -> Option<FrontendTarget> {
        self.runtime().lifecycle.active_target(label)
    }

    pub(crate) fn claim_window_state_revision(&self, label: &str) -> Option<(FrontendTarget, u64)> {
        self.runtime().lifecycle.claim_window_state_revision(label)
    }

    #[cfg(test)]
    pub(crate) fn generation(&self, label: &str) -> Option<Generation> {
        self.runtime().lifecycle.generation(label)
    }

    #[cfg(test)]
    pub(crate) fn begin_destroy(&self, label: &str, generation: Generation) -> bool {
        self.runtime().lifecycle.begin_destroy(label, generation)
    }

    pub(crate) fn begin_destroy_current(&self, label: &str) -> Option<Generation> {
        let (generation, activation_waiters, recovery_waiters) = {
            let mut runtime = self.runtime();
            let generation = runtime.lifecycle.begin_destroy_current(label)?;
            runtime.documents.remove(label);
            let activation_waiters = runtime
                .pending
                .remove(label)
                .map(|pending| pending.waiters)
                .unwrap_or_default();
            let recovery_waiters = runtime
                .recovery
                .remove(label)
                .map(|recovery| recovery.waiters)
                .unwrap_or_default();
            (generation, activation_waiters, recovery_waiters)
        };
        let error = DecorationError::window_destroyed("the decorated window was destroyed");
        Self::notify(activation_waiters, Err(error.clone()));
        Self::notify(recovery_waiters, Err(error));
        Some(generation)
    }

    pub(crate) fn finish_destroy(&self, label: &str, generation: Generation) -> bool {
        self.runtime().lifecycle.finish_destroy(label, generation)
    }

    pub(crate) fn shutdown(&self) {
        let (activation_waiters, recovery_waiters) = {
            let mut runtime = self.runtime();
            let activation_waiters = runtime
                .pending
                .drain()
                .flat_map(|(_, pending)| pending.waiters)
                .collect();
            let recovery_waiters = runtime
                .recovery
                .drain()
                .flat_map(|(_, recovery)| recovery.waiters)
                .collect();
            (activation_waiters, recovery_waiters)
        };
        let error = DecorationError::application_shutdown(
            "the application shut down during decoration activation",
        );
        Self::notify(activation_waiters, Err(error.clone()));
        Self::notify(recovery_waiters, Err(error));
    }

    fn take_waiters(
        runtime: &mut RuntimeState,
        label: &str,
        target: FrontendTarget,
    ) -> Vec<oneshot::Sender<Result<(), DecorationError>>> {
        let should_remove = runtime
            .pending
            .get(label)
            .is_some_and(|pending| pending.target == target);
        if should_remove {
            runtime
                .pending
                .remove(label)
                .expect("pending activation exists")
                .waiters
        } else {
            Vec::new()
        }
    }

    fn notify(
        waiters: Vec<oneshot::Sender<Result<(), DecorationError>>>,
        result: Result<(), DecorationError>,
    ) {
        for waiter in waiters {
            let _ = waiter.send(result.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActivationDecision, ActivationRequest, DecorationState, DocumentBootDecision,
        DocumentReadyDecision, DocumentToken, FrontendTarget, Generation, GeometryDecision,
        ReadinessDecision, RecoveryRequest,
    };
    use crate::frontend::{SnapGeometryUpdate, WindowControlPolicy};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    fn reserve(state: &DecorationState, label: &str) -> FrontendTarget {
        match state.begin_activation(label) {
            ActivationDecision::Reserved(target) => target,
            other => panic!("expected a reservation, got {other:?}"),
        }
    }

    fn disabled(sequence: u64) -> SnapGeometryUpdate {
        SnapGeometryUpdate::Disabled {
            fallback: false,
            sequence,
        }
    }

    fn activate(state: &DecorationState, label: &str) -> FrontendTarget {
        let target = reserve(state, label);
        assert!(state.begin_preparation(label, target));
        assert_eq!(
            state.begin_native_apply(label, target),
            ReadinessDecision::Apply
        );
        assert!(state.complete_activation(label, target));
        target
    }

    fn activate_with_policy(
        state: &DecorationState,
        label: &str,
        policy: WindowControlPolicy,
    ) -> FrontendTarget {
        let target = reserve(state, label);
        assert!(state.begin_preparation(label, target));
        assert!(state.set_policy(label, target, policy));
        assert_eq!(
            state.begin_native_apply(label, target),
            ReadinessDecision::Apply
        );
        assert!(state.complete_activation(label, target));
        target
    }

    #[test]
    fn initial_activation_prepares_a_window_generation_and_document_token() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");

        assert_ne!(target.window.get(), 0);
        assert_ne!(target.document.get(), 0);
        assert_eq!(state.pending_target("main"), Some(target));
        assert_eq!(state.active_target("main"), None);
    }

    #[test]
    fn active_activation_is_idempotent() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");

        assert_eq!(
            state.begin_activation("main"),
            ActivationDecision::AlreadyActive(target)
        );
    }

    #[test]
    fn window_state_revisions_are_monotonic_and_target_scoped() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");

        assert_eq!(state.claim_window_state_revision("main"), Some((target, 1)));
        assert_eq!(state.claim_window_state_revision("main"), Some((target, 2)));
        let _replacement = state
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap();
        assert_eq!(state.claim_window_state_revision("main"), None);
    }

    #[test]
    fn concurrent_activation_joins_the_current_target() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");

        assert_eq!(
            state.begin_activation("main"),
            ActivationDecision::InProgress(target)
        );
    }

    #[test]
    fn delayed_document_readiness_cannot_prepare_a_navigation_replacement() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            target: outgoing,
            challenge: Some(outgoing_challenge),
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("initial activation must issue a readiness challenge");
        };
        let replacement = state
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap();
        let replacement_target = replacement
            .target
            .expect("navigation activation has a target");
        let replacement_challenge = replacement
            .challenge
            .expect("navigation activation has a challenge");

        assert_eq!(
            state.accept_document_ready(
                "main",
                outgoing,
                outgoing_challenge,
                "missing",
                replacement.document_lease,
                "https://example.test/next",
            ),
            DocumentReadyDecision::Stale
        );
        assert_eq!(
            state.accept_document_ready(
                "main",
                replacement_target,
                outgoing_challenge,
                "missing",
                replacement.document_lease,
                "https://example.test/next",
            ),
            DocumentReadyDecision::Stale
        );
        assert!(matches!(
            state.register_document_boot(
                "main",
                "document-b".to_owned(),
                replacement.document_lease,
                "https://example.test/next".to_owned(),
            ),
            DocumentBootDecision::Challenge(..)
        ));
        assert_eq!(
            state.accept_document_ready(
                "main",
                replacement_target,
                replacement_challenge,
                "document-b",
                replacement.document_lease,
                "https://example.test/next",
            ),
            DocumentReadyDecision::Accepted
        );
        assert_eq!(state.pending_readiness("main"), None);
    }

    #[test]
    fn document_boot_nonce_and_origin_are_required_for_readiness() {
        let state = DecorationState::for_test();
        let document = state
            .page_started("main", "https://example.test".to_owned())
            .expect("initial page start creates a document binding");
        let ActivationRequest::Pending {
            target,
            challenge: Some(challenge),
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("initial activation must issue a readiness challenge");
        };
        assert!(matches!(
            state.register_document_boot(
                "main",
                "document-a".to_owned(),
                document.document_lease,
                "https://example.test".to_owned(),
            ),
            DocumentBootDecision::Challenge(..)
        ));
        assert_eq!(
            state.accept_document_ready(
                "main",
                target,
                challenge,
                "document-b",
                document.document_lease,
                "https://example.test",
            ),
            DocumentReadyDecision::Stale
        );
        assert_eq!(
            state.accept_document_ready(
                "main",
                target,
                challenge,
                "document-a",
                document.document_lease,
                "https://example.test/redirected",
            ),
            DocumentReadyDecision::Accepted
        );
        assert_eq!(
            state.accept_document_ready(
                "main",
                target,
                challenge,
                "document-a",
                document.document_lease,
                "https://example.test",
            ),
            DocumentReadyDecision::Stale
        );
    }

    #[test]
    fn matching_readiness_can_apply_and_commit() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");
        assert!(state.begin_preparation("main", target));

        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Apply
        );
        assert!(state.complete_activation("main", target));
        assert_eq!(state.active_target("main"), Some(target));
    }

    #[test]
    fn navigation_invalidates_the_previous_document_before_reconciliation() {
        let state = DecorationState::for_test();
        let old = activate(&state, "main");

        let replacement = state
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap()
            .target
            .expect("navigation activation has a target");
        assert_eq!(replacement.window, old.window);
        assert_ne!(replacement.document, old.document);
        assert_eq!(state.active_target("main"), None);
        assert_eq!(
            state.begin_native_apply("main", old),
            ReadinessDecision::Stale
        );
        assert_eq!(state.pending_target("main"), Some(replacement));
    }

    #[test]
    fn overlapping_navigation_always_targets_the_latest_document() {
        let state = DecorationState::for_test();
        let original = activate(&state, "main");

        let first = state
            .page_started("main", "https://example.test/first".to_owned())
            .unwrap()
            .target
            .expect("navigation activation has a target");
        let second = state
            .page_started("main", "https://example.test/second".to_owned())
            .unwrap()
            .target
            .expect("navigation activation has a target");
        assert_eq!(second.window, original.window);
        assert_ne!(first, second);
        assert_eq!(state.pending_target("main"), Some(second));
    }

    #[test]
    fn an_unregistered_document_boot_cannot_bind_a_newer_document() {
        let state = DecorationState::for_test();
        let first = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("initial page start creates a binding");
        let _ = state.request_activation("main").unwrap();
        let _second = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("same-url navigation creates a newer binding");
        assert_ne!(first.document_lease, _second.document_lease);
        assert!(matches!(
            state.register_document_boot(
                "main",
                "delayed-first-document".to_owned(),
                first.document_lease,
                "https://example.test/app".to_owned(),
            ),
            DocumentBootDecision::Stale
        ));
        assert!(matches!(
            state.register_document_boot(
                "main",
                "current-document".to_owned(),
                _second.document_lease,
                "https://example.test/app".to_owned(),
            ),
            DocumentBootDecision::Challenge(..)
        ));
    }

    #[test]
    fn delayed_same_url_boot_nonce_cannot_bind_a_newer_document() {
        let state = DecorationState::for_test();
        let first = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("initial page start creates a binding");
        assert!(matches!(
            state.register_document_boot(
                "main",
                "first-document".to_owned(),
                first.document_lease,
                "https://example.test/app".to_owned(),
            ),
            DocumentBootDecision::Registered(_)
        ));
        let _ = state.request_activation("main").unwrap();
        let _second = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("same-url navigation creates a newer binding");
        let third = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("latest same-url navigation creates a binding");

        assert_ne!(first.document_lease, third.document_lease);
        assert!(matches!(
            state.register_document_boot(
                "main",
                "first-document".to_owned(),
                first.document_lease,
                "https://example.test/app".to_owned(),
            ),
            DocumentBootDecision::Stale
        ));
        assert!(matches!(
            state.register_document_boot(
                "main",
                "current-document".to_owned(),
                third.document_lease,
                "https://example.test/app".to_owned(),
            ),
            DocumentBootDecision::Challenge(..)
        ));
    }

    #[test]
    fn stale_navigation_work_cannot_reconcile_a_newer_document() {
        let state = DecorationState::for_test();
        let first = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("initial page start creates a binding");
        let second = state
            .page_started("main", "https://example.test/app".to_owned())
            .expect("overlapping page start creates a newer binding");

        assert!(!state.is_current_document("main", first.target, first.document_lease));
        assert!(state.is_current_document("main", second.target, second.document_lease));
    }

    #[test]
    fn activation_setup_releases_its_claim_and_hands_a_latched_timeout_to_recovery() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt, target, ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };

        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.claim_timeout("main", attempt).is_none());
        assert!(state.deadline_latched("main", attempt));
        assert!(state.finish_activation_setup("main", attempt).is_some());
        assert!(!state.claim_activation_attempt("main", attempt, target));

        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt, target, ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };
        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.finish_activation_setup("main", attempt).is_none());
        assert!(state.claim_timeout("main", attempt).is_some());
    }

    #[test]
    fn navigation_preserves_a_latched_timeout_until_setup_hands_off_recovery() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt, target, ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };

        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.claim_timeout("main", attempt).is_none());
        let replacement = state
            .page_started("main", "https://example.test/replacement".to_owned())
            .expect("navigation must rotate the pending document");

        assert_eq!(replacement.attempt, Some(attempt));
        assert!(!replacement.start_deadline);
        assert!(state.deadline_latched("main", attempt));
        assert!(state.finish_activation_setup("main", attempt).is_some());
    }

    #[test]
    fn deferred_activation_lease_is_revoked_by_navigation_before_each_stage() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt, target, ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };

        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.activation_attempt_is_current("main", attempt, target));
        state
            .page_started("main", "https://example.test/replacement".to_owned())
            .expect("navigation must rotate the pending document");
        assert!(!state.activation_attempt_is_current("main", attempt, target));
    }

    #[test]
    fn native_apply_lease_rejects_late_commit_after_cancel_or_destroy() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");
        assert!(state.begin_preparation("main", target));
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Apply
        );
        assert!(state.native_apply_is_current("main", target));
        assert_eq!(state.cancel_current("main"), Some(target));
        assert!(!state.native_apply_is_current("main", target));
        assert!(!state.complete_activation("main", target));

        let state = DecorationState::for_test();
        let target = reserve(&state, "main");
        assert!(state.begin_preparation("main", target));
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Apply
        );
        assert!(state.begin_destroy_current("main").is_some());
        assert!(!state.native_apply_is_current("main", target));
        assert!(!state.complete_activation("main", target));
    }

    #[test]
    fn deadline_latched_acknowledgement_cannot_begin_native_apply() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt, target, ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };

        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.claim_timeout("main", attempt).is_none());
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Stale
        );
    }

    #[test]
    fn deadline_during_native_apply_invalidates_the_late_commit() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt,
            target,
            mut receiver,
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must be pending");
        };

        assert!(state.claim_activation_attempt("main", attempt, target));
        assert!(state.finish_activation_setup("main", attempt).is_none());
        assert!(state.begin_preparation("main", target));
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Apply
        );

        let claim = state
            .claim_timeout("main", attempt)
            .expect("the released setup claim lets the deadline own recovery");
        assert!(!state.native_apply_is_current("main", target));
        assert!(!state.complete_activation("main", target));

        let timeout = crate::DecorationError::activation_timeout("test deadline");
        assert!(state.finish_recovery("main", claim, true, timeout.clone()));
        assert_eq!(receiver.try_recv(), Ok(Err(timeout)));
    }

    #[test]
    fn unknown_navigation_cannot_rotate_a_later_activation() {
        let state = DecorationState::for_test();
        assert_eq!(
            state
                .page_started("main", "https://example.test".to_owned())
                .expect("unknown navigation creates a native binding")
                .target,
            None
        );
        let target = reserve(&state, "main");
        assert_eq!(state.pending_target("main"), Some(target));
    }

    #[test]
    fn failed_frontend_preparation_is_safe_and_retryable() {
        let state = DecorationState::for_test();
        let failed = reserve(&state, "main");

        assert!(state.fail_preparation("main", failed));
        assert_eq!(state.active_target("main"), None);
        assert_eq!(state.pending_target("main"), None);

        let retry = reserve(&state, "main");
        assert_eq!(retry.window, failed.window);
        assert_ne!(retry.document, failed.document);
        assert_eq!(state.pending_target("main"), Some(retry));
    }

    #[test]
    fn failed_native_apply_cannot_be_committed_by_a_late_success() {
        let state = DecorationState::for_test();
        let failed = reserve(&state, "main");
        assert!(state.begin_preparation("main", failed));
        assert_eq!(
            state.begin_native_apply("main", failed),
            ReadinessDecision::Apply
        );

        assert!(state.fail_native_apply("main", failed));
        assert!(!state.complete_activation("main", failed));
        assert_eq!(state.active_target("main"), None);
    }

    #[test]
    fn cancelling_a_preparation_invalidates_late_readiness_and_preserves_other_windows() {
        let state = DecorationState::for_test();
        let cancelled = reserve(&state, "main");
        let other = activate(&state, "secondary");

        assert_eq!(state.cancel_current("main"), Some(cancelled));
        assert_eq!(
            state.begin_native_apply("main", cancelled),
            ReadinessDecision::Stale
        );
        assert_eq!(state.active_target("secondary"), Some(other));

        let retry = reserve(&state, "main");
        assert_eq!(retry.window, cancelled.window);
        assert_ne!(retry.document, cancelled.document);
    }

    #[test]
    fn explicit_native_restore_stays_off_across_navigation_until_reactivated() {
        let state = DecorationState::for_test();
        let cancelled = activate(&state, "main");

        assert_eq!(state.cancel_current("main"), Some(cancelled));
        assert_eq!(state.cancel_current("main"), Some(cancelled));
        assert_eq!(
            state
                .page_started("main", "https://example.test".to_owned())
                .expect("native navigation refresh creates a binding")
                .target,
            None
        );
        assert_eq!(
            state.begin_native_apply("main", cancelled),
            ReadinessDecision::Stale
        );

        let reactivated = reserve(&state, "main");
        assert_eq!(reactivated.window, cancelled.window);
        assert_ne!(reactivated.document, cancelled.document);
    }

    #[test]
    fn duplicate_readiness_for_an_active_document_is_idempotent() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");

        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::AlreadyActive
        );
    }

    #[test]
    fn duplicate_readiness_during_native_apply_is_explicit() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");
        assert!(state.begin_preparation("main", target));
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::Apply
        );
        assert_eq!(
            state.begin_native_apply("main", target),
            ReadinessDecision::AlreadyApplying
        );
    }

    #[test]
    fn stale_window_destruction_cannot_remove_a_replacement() {
        let state = DecorationState::for_test();
        let old = reserve(&state, "main");
        assert!(state.begin_destroy("main", old.window));

        let replacement = reserve(&state, "main");
        assert_ne!(replacement.window, old.window);
        assert!(!state.finish_destroy("main", old.window));
        assert_eq!(state.pending_target("main"), Some(replacement));
    }

    #[test]
    fn destroy_current_invalidates_frontend_dispatch() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");

        assert_eq!(state.begin_destroy_current("main"), Some(target.window));
        assert_eq!(state.current_target("main"), None);
        assert!(state.finish_destroy("main", target.window));
        assert_eq!(state.generation("main"), None);
    }

    #[test]
    fn exact_target_policy_is_revoked_by_navigation_recovery_and_destroy() {
        let policy = WindowControlPolicy {
            close: true,
            snap_geometry: true,
            ..WindowControlPolicy::default()
        };

        let navigation = DecorationState::for_test();
        let target = activate_with_policy(&navigation, "main", policy);
        assert_eq!(navigation.active_policy("main", target), Some(policy));
        navigation
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap();
        assert_eq!(navigation.active_policy("main", target), None);

        let recovery = DecorationState::for_test();
        let target = activate_with_policy(&recovery, "main", policy);
        let RecoveryRequest::Claimed(_claim) = recovery.request_recovery("main", Some(target))
        else {
            panic!("active target must own recovery");
        };
        assert_eq!(recovery.active_policy("main", target), None);

        let destruction = DecorationState::for_test();
        let target = activate_with_policy(&destruction, "main", policy);
        assert_eq!(
            destruction.begin_destroy_current("main"),
            Some(target.window)
        );
        assert_eq!(destruction.active_policy("main", target), None);
    }

    #[test]
    fn snap_geometry_is_transactional_bounded_and_retryable() {
        let state = DecorationState::for_test();
        let policy = WindowControlPolicy {
            snap_geometry: true,
            ..WindowControlPolicy::default()
        };
        let target = activate_with_policy(&state, "main", policy);

        assert_eq!(
            state.accept_geometry("main", target, disabled(1)),
            GeometryDecision::Next
        );
        assert!(state.commit_geometry("main", target, disabled(1)));
        assert_eq!(
            state.accept_geometry("main", target, disabled(1)),
            GeometryDecision::Retry
        );
        assert_eq!(
            state.accept_geometry(
                "main",
                target,
                SnapGeometryUpdate::Geometry {
                    geometry: crate::frontend::SnapGeometry {
                        control_band_width: 1,
                        height: 1,
                        titlebar_height: 1,
                        width: 1,
                        x: 0,
                        y: 0,
                    },
                    sequence: 1,
                },
            ),
            GeometryDecision::Conflict
        );
        assert_eq!(
            state.accept_geometry(
                "main",
                target,
                SnapGeometryUpdate::Disabled {
                    fallback: true,
                    sequence: 1,
                },
            ),
            GeometryDecision::Conflict
        );
        assert_eq!(
            state.accept_geometry("main", target, disabled(0)),
            GeometryDecision::Stale
        );
        assert_eq!(
            state.accept_geometry("main", target, disabled(u64::MAX)),
            GeometryDecision::Stale
        );
        assert_eq!(state.geometry_cursor("main", target), Some(1));
        assert_eq!(
            state.accept_geometry("main", target, disabled(3)),
            GeometryDecision::Stale
        );
        assert_eq!(
            state.accept_geometry("main", target, disabled(2)),
            GeometryDecision::Next
        );
        assert!(state.commit_geometry("main", target, disabled(2)));
        let replacement = state
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap()
            .target
            .expect("navigation activation has a target");
        assert_eq!(
            state.accept_geometry("main", target, disabled(3)),
            GeometryDecision::Denied
        );
        assert_eq!(
            state.accept_geometry("main", replacement, disabled(1)),
            GeometryDecision::Denied
        );
    }

    #[test]
    fn frontend_failure_recovery_accepts_only_exact_preparing_target() {
        let state = DecorationState::for_test();
        let target = reserve(&state, "main");
        assert!(state.begin_preparation("main", target));

        let RecoveryRequest::Claimed(claim) = state.request_frontend_failure("main", Some(target))
        else {
            panic!("the preparing target must own frontend failure recovery");
        };
        assert!(state.finish_recovery(
            "main",
            claim,
            true,
            crate::DecorationError::frontend("test recovery")
        ));
    }

    #[test]
    fn active_frontend_failure_acknowledgement_cannot_start_recovery() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");

        assert!(matches!(
            state.request_frontend_failure("main", Some(target)),
            RecoveryRequest::AlreadyNative
        ));
        assert_eq!(state.active_target("main"), Some(target));
    }

    #[test]
    fn prevented_exit_leaves_activation_and_recovery_lifecycle_usable() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending { target, .. } = state.request_activation("main").unwrap()
        else {
            panic!("initial activation must be pending");
        };

        let ActivationRequest::Pending { target: joined, .. } =
            state.request_activation("main").unwrap()
        else {
            panic!("activation after a prevented exit must remain pending");
        };
        assert_eq!(joined, target);

        let RecoveryRequest::Claimed(claim) = state.request_recovery("main", Some(target)) else {
            panic!("the pending target must remain recoverable");
        };
        assert!(state.finish_recovery(
            "main",
            claim,
            true,
            crate::DecorationError::cancelled("prevented exit recovery")
        ));

        let ActivationRequest::Pending { target: retry, .. } =
            state.request_activation("main").unwrap()
        else {
            panic!("activation after restoration must be pending");
        };
        assert_eq!(retry.window, target.window);
        assert_ne!(retry.document, target.document);
    }

    #[test]
    fn concurrent_restore_joins_one_uniquely_owned_recovery() {
        let state = DecorationState::for_test();
        let target = activate(&state, "main");
        let RecoveryRequest::Claimed(claim) = state.request_recovery("main", Some(target)) else {
            panic!("first restoration must claim ownership");
        };
        let RecoveryRequest::InProgress(mut receiver) =
            state.request_recovery("main", Some(target))
        else {
            panic!("second restoration must join");
        };

        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
        assert!(state.finish_recovery(
            "main",
            claim,
            true,
            crate::DecorationError::cancelled("test recovery")
        ));
        assert_eq!(receiver.try_recv(), Ok(Ok(())));
        assert!(!state.finish_recovery(
            "main",
            claim,
            true,
            crate::DecorationError::cancelled("late recovery")
        ));
    }

    #[test]
    fn activation_waiters_complete_only_after_owned_recovery_commits() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt,
            target,
            mut receiver,
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("initial activation must be pending");
        };
        assert!(state.begin_preparation("main", target));
        let RecoveryRequest::Claimed(claim) = state.request_recovery("main", Some(target)) else {
            panic!("prepared target must claim recovery");
        };

        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
        let cause = crate::DecorationError::native_apply("activation failed");
        assert!(state.finish_recovery("main", claim, true, cause.clone()));
        assert_eq!(receiver.try_recv(), Ok(Err(cause)));
        assert!(matches!(
            state.request_attempt_recovery("main", attempt, target),
            RecoveryRequest::AlreadyNative
        ));
    }

    #[test]
    fn accepted_preparation_failures_preserve_their_typed_causes() {
        for kind in [
            crate::DecorationErrorKind::FrontendUnavailable,
            crate::DecorationErrorKind::NativeApply,
            crate::DecorationErrorKind::UnsupportedPlatform,
        ] {
            let state = DecorationState::for_test();
            let ActivationRequest::Pending {
                target,
                mut receiver,
                ..
            } = state.request_activation("main").unwrap()
            else {
                panic!("activation must remain pending while preparing");
            };
            assert!(state.begin_preparation("main", target));
            let RecoveryRequest::Claimed(claim) = state.request_recovery("main", Some(target))
            else {
                panic!("accepted preparation failure must claim recovery");
            };
            let cause = crate::DecorationError::new(kind, "injected preparation failure");
            assert!(state.finish_recovery("main", claim, true, cause.clone()));
            assert_eq!(receiver.try_recv(), Ok(Err(cause)));
        }
    }

    #[test]
    fn recovery_failure_replaces_the_original_preparation_cause() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            target,
            mut receiver,
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("activation must remain pending while preparing");
        };
        assert!(state.begin_preparation("main", target));
        let RecoveryRequest::Claimed(claim) = state.request_recovery("main", Some(target)) else {
            panic!("accepted preparation failure must claim recovery");
        };
        let recovery_error = crate::DecorationError::new(
            crate::DecorationErrorKind::NativeRestore,
            "injected restoration failure",
        );
        assert!(state.finish_recovery("main", claim, false, recovery_error.clone()));
        assert_eq!(receiver.try_recv(), Ok(Err(recovery_error)));
    }

    #[test]
    fn stale_target_failure_cannot_abort_a_navigation_replacement() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending {
            attempt,
            target: original,
            mut receiver,
            ..
        } = state.request_activation("main").unwrap()
        else {
            panic!("initial activation must be pending");
        };
        let replacement = state
            .page_started("main", "https://example.test/next".to_owned())
            .unwrap()
            .target
            .expect("navigation activation has a target");

        assert!(matches!(
            state.request_attempt_recovery("main", attempt, original),
            RecoveryRequest::AlreadyNative
        ));
        assert_eq!(state.pending_target("main"), Some(replacement));
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn application_shutdown_completes_pending_activation_waiters() {
        let state = DecorationState::for_test();
        let ActivationRequest::Pending { mut receiver, .. } =
            state.request_activation("main").unwrap()
        else {
            panic!("initial activation must be pending");
        };

        state.shutdown();

        let error = receiver
            .try_recv()
            .expect("shutdown must publish a result")
            .unwrap_err();
        assert_eq!(
            error.kind(),
            crate::DecorationErrorKind::ApplicationShutdown
        );
    }

    #[test]
    fn token_types_are_not_interchangeable() {
        let target = FrontendTarget {
            window: Generation::from_raw(7),
            document: DocumentToken::from_raw(11),
        };
        assert_eq!(target.window.get(), 7);
        assert_eq!(target.document.get(), 11);
    }

    #[test]
    fn frontend_targets_accept_only_nonzero_token_values() {
        assert_eq!(FrontendTarget::from_values(0, 1), None);
        assert_eq!(FrontendTarget::from_values(1, 0), None);
        assert_eq!(
            FrontendTarget::from_values(7, 11),
            Some(FrontendTarget {
                window: Generation::from_raw(7),
                document: DocumentToken::from_raw(11),
            })
        );
    }

    #[test]
    fn poisoned_state_is_not_recovered() {
        let state = DecorationState::for_test();
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _guard = state.runtime.lock().unwrap();
            panic!("poison the lifecycle mutex");
        }));

        assert!(catch_unwind(AssertUnwindSafe(|| state.begin_activation("main"))).is_err());
    }

    #[test]
    fn managed_state_records_runtime_policy() {
        let state = DecorationState::for_test();
        assert_eq!(
            state.activation_timeout(),
            std::time::Duration::from_secs(5)
        );
    }
}
