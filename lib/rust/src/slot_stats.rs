//! Scoped instrumentation for tests and measurements.
use std::cell::RefCell;
/// The work of one ranked-choice forest ranking.
#[derive(Debug, Clone, Default)]
pub struct SlotStatistics {
    /// The raw chart facts.
    pub chart_facts: usize,
    /// The normalized slot groups.
    pub groups: usize,
    /// The candidate packed edges.
    pub candidate_edges: usize,
    /// The retained packed edges across contexts.
    pub retained_edges: usize,
}
thread_local! { static WATCHERS: RefCell<Vec<Vec<SlotStatistics>>> = const { RefCell::new(Vec::new()) }; }
/// Runs a measurement with scoped, thread-local ranking statistics.
pub fn with_slot_statistics<T>(run: impl FnOnce() -> T) -> (T, Vec<SlotStatistics>) {
    struct Watch;
    impl Drop for Watch {
        fn drop(&mut self) {
            WATCHERS.with(|w| {
                w.borrow_mut().pop();
            });
        }
    }
    WATCHERS.with(|w| w.borrow_mut().push(Vec::new()));
    let guard = Watch;
    let value = run();
    let stats = WATCHERS.with(|w| w.borrow().last().expect("a watcher").clone());
    drop(guard);
    (value, stats)
}
pub(crate) fn record(stats: &SlotStatistics) {
    WATCHERS.with(|w| {
        for watcher in w.borrow_mut().iter_mut() {
            watcher.push(stats.clone());
        }
    });
}
