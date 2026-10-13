use super::{Claims, claim};
use std::sync::Barrier;

#[test]
fn requests_are_claimed_once_per_scope() {
    let claims = Claims::default();
    assert!(claims.claim("session-a", "reply"));
    assert!(!claims.claim("session-a", "reply"));
    assert!(claims.claim("session-b", "reply"));
    assert!(claims.claim("session-a", "answer"));
    assert!(!claims.claim("session-a", "answer"));
}

#[test]
fn concurrent_submissions_have_exactly_one_winner() {
    let claims = Claims::default();
    let barrier = Barrier::new(16);
    std::thread::scope(|scope| {
        let workers: Vec<_> = (0..16)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    claims.claim("session", "request")
                })
            })
            .collect();
        let winners = workers.into_iter().map(|worker| usize::from(worker.join().unwrap())).sum::<usize>();
        assert_eq!(winners, 1);
    });
}

#[test]
fn host_calls_share_process_lifetime_claims() {
    let scope = uuid::Uuid::new_v4().to_string();
    assert!(claim(&scope, "request"));
    assert!(!std::thread::spawn(move || claim(&scope, "request")).join().unwrap());
}
