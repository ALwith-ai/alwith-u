use super::Policy;

#[test]
fn permission_and_running_tasks_are_both_required_and_disable_releases_immediately() {
    let mut policy = Policy::<usize> { active: true, ..Default::default() };
    policy.reconcile(|| panic!("disabled")).unwrap();
    policy.enabled = true;
    policy.reconcile(|| Ok(1)).unwrap();
    policy.reconcile(|| panic!("already held")).unwrap();
    assert_eq!(policy.lease, Some(1));
    policy.enabled = false;
    policy.reconcile(|| panic!("disabled")).unwrap();
    assert!(policy.lease.is_none());
    policy.enabled = true;
    policy.reconcile(|| Ok(2)).unwrap();
    policy.active = false;
    policy.reconcile(|| panic!("idle")).unwrap();
    assert!(policy.lease.is_none());
}

#[test]
fn failed_acquisition_is_retried_without_claiming_a_lease() {
    let mut policy = Policy::<usize> { enabled: true, active: true, lease: None };
    assert!(policy.reconcile(|| Err("denied".into())).is_err());
    assert!(policy.lease.is_none());
    policy.reconcile(|| Ok(1)).unwrap();
    assert_eq!(policy.lease, Some(1));
}

#[test]
fn tasks_in_other_sessions_and_approval_waits_keep_the_lease() {
    use alwith_api::RunState::{Done, Idle, RequiresAction, Running};
    assert!(super::has_active_tasks([&Idle, &Running]));
    assert!(super::has_active_tasks([&RequiresAction, &Done]));
    assert!(!super::has_active_tasks([&Idle, &Done]));
    assert!(!super::has_active_tasks([]));
}
