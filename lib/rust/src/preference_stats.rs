//! Scoped instrumentation for tests and measurements.
use std::cell::RefCell;
/// The work of one preference-enabled forest ranking.
#[derive(Debug, Clone, Default)]
pub struct PreferenceStatistics {
    /// Whether the forest takes the lossless signature path.
    pub slow: bool,
    /// The visited forest nodes.
    pub forest_items: usize,
    /// The visited forest dependencies.
    pub forest_edges: usize,
    /// The signature summary contexts.
    pub contexts: usize,
    /// The retained signatures across all contexts.
    pub signatures: usize,
    /// The largest all or allowed signature set.
    pub largest_set: usize,
    /// The pairs compared at the complete root.
    pub comparisons: usize,
}
thread_local! { static WATCHERS: RefCell<Vec<Vec<PreferenceStatistics>>> = const { RefCell::new(Vec::new()) }; }
/// Runs a measurement with scoped, thread-local ranking statistics.
pub fn with_preference_statistics<T>(run: impl FnOnce() -> T) -> (T, Vec<PreferenceStatistics>) {
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
pub(crate) fn record(stats: &PreferenceStatistics) {
    WATCHERS.with(|w| {
        for watcher in w.borrow_mut().iter_mut() {
            watcher.push(stats.clone());
        }
    });
}
