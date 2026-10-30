//! Source patterns can exceed the DOM depth bound before validation.
use super::{Children, Pattern};

enum Part {
    Pattern(Pattern),
    Children(Children),
}

fn clear(mut pending: Vec<Part>) {
    while let Some(part) = pending.pop() {
        match part {
            Part::Pattern(pattern) => match pattern {
                Pattern::Test(_, _, inner) | Pattern::Path(_, inner) => pending.push(Part::Pattern(*inner)),
                Pattern::Node(inner, _, children) => {
                    pending.push(Part::Pattern(*inner));
                    pending.extend(children.map(Part::Children));
                }
                Pattern::Union(items) | Pattern::Intersection(items) => {
                    pending.extend(items.into_iter().map(Part::Pattern));
                }
                Pattern::Difference(left, right) => {
                    pending.push(Part::Pattern(*left));
                    pending.push(Part::Pattern(*right));
                }
                _ => {}
            },
            Part::Children(children) => match children {
                Children::Node(pattern) => pending.push(Part::Pattern(*pattern)),
                Children::Sequence(items) | Children::Choice(items) => {
                    pending.extend(items.into_iter().map(Part::Children));
                }
                Children::Optional(inner) => pending.push(Part::Children(*inner)),
                Children::Repeat(inner, separator) => {
                    pending.push(Part::Children(*inner));
                    pending.extend(separator.map(|separator| Part::Children(*separator)));
                }
                Children::Siblings => {}
            },
        }
    }
}

impl Pattern {
    pub(crate) fn clear(&mut self) {
        if matches!(self, Pattern::Any) {
            return;
        }
        clear(vec![Part::Pattern(std::mem::replace(self, Pattern::Any))]);
    }
}

impl Children {
    pub(crate) fn clear(&mut self) {
        if matches!(self, Children::Siblings) {
            return;
        }
        clear(vec![Part::Children(std::mem::replace(self, Children::Siblings))]);
    }
}
