//! Source patterns can exceed the DOM depth bound before validation.
use super::{Children, Pattern};

impl Pattern {
    pub(crate) fn clear(&mut self) {
        if !matches!(self, Pattern::Any) {
            crate::dom::drop_pattern(std::mem::replace(self, Pattern::Any));
        }
    }
}

impl Children {
    pub(crate) fn clear(&mut self) {
        if !matches!(self, Children::Siblings) {
            crate::dom::drop_pattern_children(std::mem::replace(self, Children::Siblings));
        }
    }
}
