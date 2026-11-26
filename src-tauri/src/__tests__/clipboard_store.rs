use super::*;

fn texts(store: &Store, query: &str) -> Vec<String> {
    store.list(query, 100).unwrap().into_iter().map(|item| item.text).collect()
}

#[test]
fn records_newest_first_and_moves_repeated_content_to_the_front() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    store.record(&Capture::Text("one".into()), 1).unwrap();
    store.record(&Capture::Text("two".into()), 2).unwrap();
    let again = store.record(&Capture::Text("one".into()), 3).unwrap();
    assert_eq!(texts(&store, ""), ["one", "two"]);
    assert_eq!(again.copied_at, 3);
    // The same characters as a file path are a different entry.
    store.record(&Capture::Files(vec!["one".into()]), 4).unwrap();
    assert_eq!(store.list("", 100).unwrap().len(), 3);
}

#[test]
fn survives_reopening_and_searches_text_literally() {
    let directory = tempfile::tempdir().unwrap();
    {
        let mut store = Store::open(directory.path()).unwrap();
        store.record(&Capture::Text("100% done_now".into()), 1).unwrap();
        store.record(&Capture::Text("1000 lines".into()), 2).unwrap();
        store.record(&Capture::Files(vec!["/tmp/Report.pdf".into(), "/tmp/b.txt".into()]), 3).unwrap();
    }
    let store = Store::open(directory.path()).unwrap();
    assert_eq!(texts(&store, "100"), ["1000 lines", "100% done_now"]);
    assert_eq!(texts(&store, "100%"), ["100% done_now"]);
    assert_eq!(texts(&store, "e_n"), ["100% done_now"]);
    assert_eq!(texts(&store, "report"), ["/tmp/Report.pdf\n/tmp/b.txt"]);
    assert_eq!(store.list("", 2).unwrap().len(), 2);
}

#[test]
fn pins_lead_the_list_and_outlive_clearing_and_retention() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    let old = store.record(&Capture::Text("old".into()), 1).unwrap();
    store.record(&Capture::Text("stale".into()), 2).unwrap();
    let now = RETENTION_MILLISECONDS + 10;
    store.record(&Capture::Text("fresh".into()), now).unwrap();
    store.pin(old.id, true, now).unwrap();
    assert_eq!(texts(&store, ""), ["old", "fresh", "stale"]);
    assert!(store.get(old.id).unwrap().unwrap().pinned);
    store.prune(now).unwrap();
    assert_eq!(texts(&store, ""), ["old", "fresh"]);
    store.clear().unwrap();
    assert_eq!(texts(&store, ""), ["old"]);
    store.pin(old.id, false, now).unwrap();
    store.clear().unwrap();
    assert!(texts(&store, "").is_empty());
    assert!(store.pin(old.id, true, now).is_err());
}

#[test]
fn an_image_entry_owns_its_file_until_the_entry_goes() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    let item = store.record(&Capture::Image(vec![1, 2, 3]), 1).unwrap();
    let path = std::path::PathBuf::from(item.image.clone().unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), [1, 2, 3]);
    assert_eq!((item.kind, item.text.as_str()), (Kind::Image, ""));
    // The same pixels again keep the one file.
    assert_eq!(store.record(&Capture::Image(vec![1, 2, 3]), 2).unwrap().id, item.id);
    store.remove(item.id).unwrap();
    assert!(!path.exists());
    assert!(store.get(item.id).unwrap().is_none());
}

#[test]
fn a_search_over_fifty_thousand_entries_stays_interactive() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    store.connection.execute_batch("BEGIN").unwrap();
    for index in 0..50_000 {
        store
            .record(&Capture::Text(format!("entry {index} {}", "lorem ipsum dolor sit amet ".repeat(8))), index)
            .unwrap();
    }
    store.connection.execute_batch("COMMIT").unwrap();
    let started = std::time::Instant::now();
    assert_eq!(store.list("entry 49999 ", 50).unwrap().len(), 1);
    let elapsed = started.elapsed();
    eprintln!("search over 50000 entries: {elapsed:?}");
    // 22 ms on an M-series laptop and 134 ms on a shared CI runner: the bound catches a search that
    // has stopped being one pass over the table, not the speed of the machine it runs on.
    assert!(elapsed < std::time::Duration::from_secs(1), "{elapsed:?}");
}
