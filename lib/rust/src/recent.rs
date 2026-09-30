//! A map that keeps only the entries used most recently.

/// A map of at most `limit` entries. When it is full, a new entry drops the
/// entry that was used least recently. It has no lock of its own, so its
/// owner locks it when threads share it.
pub(crate) struct Recent<K, V> {
    limit: usize,
    /// The entries, least recently used first.
    entries: Vec<(K, V)>,
}

impl<K: PartialEq, V: Clone> Recent<K, V> {
    pub(crate) fn new(limit: usize) -> Recent<K, V> {
        Recent { limit, entries: Vec::new() }
    }

    /// The value of a key, now the most recently used. A key that the map
    /// lacks gets the value that `make` makes.
    pub(crate) fn get_or_insert_with(&mut self, key: K, make: impl FnOnce() -> V) -> V {
        let entry = match self.entries.iter().position(|(k, _)| *k == key) {
            Some(index) => self.entries.remove(index),
            None => (key, make()),
        };
        let value = entry.1.clone();
        self.entries.push(entry);
        if self.entries.len() > self.limit {
            self.entries.remove(0);
        }
        value
    }

    /// The number of entries.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}
