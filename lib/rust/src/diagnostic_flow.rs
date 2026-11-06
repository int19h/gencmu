//! Diagnostic owners and reporting collections (engine §11.5 and §12.1).
use crate::earley::Tok;
use crate::fxhash::{FxMap, FxSet};
use crate::lower::Lowered;
use crate::result::{Attachment, Warning};
use crate::tree::{IKind, ITree};
use crate::work::{self, Work};

#[derive(Clone, Default)]
pub(crate) struct Lists {
    pub errors: Vec<Warning>,
    pub warnings: Vec<Warning>,
}
impl Lists {
    pub(crate) fn parts(&self) -> (&[Warning], &[Warning]) {
        (&self.errors, &self.warnings)
    }
    fn push(&mut self, event: &Event) {
        if event.error {
            self.errors.push(event.diagnostic.clone());
        } else {
            self.warnings.push(event.diagnostic.clone());
        }
    }
}

fn identity(diagnostic: &Warning) -> usize {
    std::sync::Arc::as_ptr(&diagnostic.record.as_ref().expect("a diagnostic has a fixed record").identity) as usize
}

pub(crate) fn join<'a>(collections: impl IntoIterator<Item = (&'a [Warning], &'a [Warning])>) -> Lists {
    let mut result = Lists::default();
    let (mut errors, mut warnings) = (FxSet::default(), FxSet::default());
    for (left, right) in collections {
        for (source, into, seen) in
            [(left, &mut result.errors, &mut errors), (right, &mut result.warnings, &mut warnings)]
        {
            for diagnostic in source {
                work::count(Work::Walked, 1);
                if seen.insert(identity(diagnostic)) {
                    into.push(diagnostic.clone());
                }
            }
        }
    }
    result
}

#[cfg(test)]
fn input(tokens: &[Tok]) -> Lists {
    join(tokens.iter().map(|token| (token.errors.as_slice(), token.warnings.as_slice())))
}

fn ordered(mut diagnostics: Vec<Warning>) -> Vec<Warning> {
    diagnostics.sort_by_key(|diagnostic| {
        work::count(Work::Walked, 1);
        let identity = &diagnostic.record.as_ref().unwrap().identity;
        (identity.stage_order, identity.ordinal)
    });
    diagnostics
}

#[derive(Clone)]
pub(crate) struct Event {
    pub node: u32,
    pub diagnostic: Warning,
    pub error: bool,
    pub own: bool,
}

#[derive(PartialEq, Eq, Hash)]
struct ObjectKey {
    stage: String,
    code: String,
    rule: String,
    span: std::ops::Range<usize>,
    source: std::ops::Range<usize>,
    message: String,
    rejection: Option<RejectionKey>,
}
#[derive(PartialEq, Eq, Hash)]
struct RejectionKey {
    token: usize,
    source: std::ops::Range<usize>,
    line: usize,
    column: usize,
    expected: Vec<(String, Vec<String>)>,
}
fn object_key(diagnostic: &Warning) -> ObjectKey {
    ObjectKey {
        stage: diagnostic.stage.clone(),
        code: diagnostic.code.clone(),
        rule: diagnostic.rule.clone(),
        span: diagnostic.span.clone(),
        source: diagnostic.source.clone(),
        message: diagnostic.message.clone(),
        rejection: diagnostic.rejection.as_ref().map(|rejection| RejectionKey {
            token: rejection.token,
            source: rejection.source.clone(),
            line: rejection.line,
            column: rejection.column,
            expected: rejection
                .expected
                .iter()
                .map(|expected| (expected.terminal.clone(), expected.rules.clone()))
                .collect(),
        }),
    }
}

pub(crate) fn tied(first: &[Event], second: &[Event]) -> Lists {
    let mut result = Lists::default();
    for error in [true, false] {
        let mut carried = FxSet::default();
        let (mut counts, mut later) = (FxMap::default(), FxMap::default());
        for (reading, events) in [first, second].into_iter().enumerate() {
            for event in events.iter().filter(|event| event.error == error) {
                work::count(Work::Walked, 1);
                if event.own {
                    let key = object_key(&event.diagnostic);
                    let previous = *counts.get(&key).unwrap_or(&0);
                    let table = if reading == 0 { &mut counts } else { &mut later };
                    let number = table.entry(key).or_insert(0usize);
                    *number += 1;
                    if reading == 1 && *number <= previous {
                        continue;
                    }
                } else if !carried.insert(identity(&event.diagnostic)) {
                    continue;
                }
                result.push(event);
            }
        }
    }
    result
}

#[derive(Clone)]
pub(crate) enum Group {
    Scope(usize),
    Lists(Lists),
}
#[derive(Default)]
struct Scope {
    rows: Vec<usize>,
    unowned: Lists,
}
struct Row {
    span: (usize, usize),
    support: Option<(usize, usize)>,
    emission: u32,
    own: Lists,
    groups: Vec<Group>,
    finished: Lists,
    before: Vec<Option<usize>>,
    after: Vec<Option<usize>>,
}

pub(crate) struct DiagnosticFlow<'a> {
    tree: &'a ITree,
    tokens: &'a [Tok],
    parents: Vec<Option<u32>>,
    erased: Vec<bool>,
    scopes_of: Vec<usize>,
    scope_roots: Vec<Option<usize>>,
    own: Vec<Option<Event>>,
    evaluated: Vec<Event>,
    scopes: Vec<Scope>,
    rows: Vec<Row>,
    prefix: Vec<usize>,
    next: Vec<usize>,
    previous: Vec<usize>,
}
impl<'a> DiagnosticFlow<'a> {
    pub(crate) fn new(grammar: &Lowered, tree: &'a ITree, tokens: &'a [Tok]) -> Self {
        let size = tree.nodes.len();
        let mut parents = vec![None; size];
        let mut erased = vec![false; size];
        let mut live = vec![0usize; tokens.len()];
        for (index, node) in tree.nodes.iter().enumerate() {
            work::count(Work::Walked, 1);
            erased[index] = parents[index].is_some_and(|parent| erased[parent as usize])
                || matches!(node.kind,IKind::Close{prod,..} if grammar.prods[prod as usize].erased);
            for &child in &node.children {
                parents[child as usize] = Some(index as u32);
            }
            if let IKind::Read { tok, .. } = node.kind {
                if !erased[index] {
                    live[tok as usize] = 1;
                }
            }
        }
        let mut prefix = vec![0];
        let mut previous = vec![0];
        let mut next = vec![tokens.len(); tokens.len() + 1];
        for (index, &bit) in live.iter().enumerate() {
            work::count(Work::Walked, 1);
            prefix.push(prefix[index] + bit);
            previous.push(if bit == 0 { previous[index] } else { index + 1 });
        }
        for index in (0..tokens.len()).rev() {
            work::count(Work::Walked, 1);
            next[index] = if live[index] == 0 { next[index + 1] } else { index };
        }
        Self {
            tree,
            tokens,
            parents,
            erased,
            scopes_of: vec![0; size],
            scope_roots: vec![None; size],
            own: vec![None; size],
            evaluated: Vec::new(),
            scopes: vec![Scope::default()],
            rows: Vec::new(),
            prefix,
            next,
            previous,
        }
    }
    fn span(&self, node: u32) -> (usize, usize) {
        match self.tree.nodes[node as usize].kind {
            IKind::Read { tok, .. } => (tok as usize, tok as usize + 1),
            IKind::Close { start, end, .. } => (start as usize, end as usize),
        }
    }
    fn count(&self, start: usize, end: usize) -> usize {
        self.prefix[end] - self.prefix[start]
    }
    pub(crate) fn add(&mut self, node: u32, diagnostic: Warning, error: bool) {
        let event = Event { node, diagnostic, error, own: true };
        self.own[node as usize] = Some(event.clone());
        self.evaluated.push(event);
    }
    pub(crate) fn ordinal(&self) -> usize {
        self.evaluated.len()
    }
    pub(crate) fn messages(&self) -> Lists {
        let mut result = Lists::default();
        for event in &self.evaluated {
            work::count(Work::Walked, 1);
            if !self.erased[event.node as usize] {
                result.push(event);
            }
        }
        result
    }
    pub(crate) fn events(&self) -> Vec<Event> {
        let mut result = Vec::new();
        for (index, node) in self.tree.nodes.iter().enumerate() {
            work::count(Work::Walked, 1);
            if self.erased[index] {
                continue;
            }
            if let Some(event) = &self.own[index] {
                result.push(event.clone());
            }
            if let IKind::Read { tok, .. } = node.kind {
                let token = &self.tokens[tok as usize];
                for (diagnostics, error) in [(&token.errors, true), (&token.warnings, false)] {
                    result.extend(diagnostics.iter().map(|diagnostic| Event {
                        node: index as u32,
                        diagnostic: diagnostic.clone(),
                        error,
                        own: false,
                    }));
                }
            }
        }
        result
    }
    pub(crate) fn collected(&self) -> Lists {
        let mut result = Lists::default();
        for event in self.events() {
            result.push(&event);
        }
        join([result.parts()])
    }
    pub(crate) fn attachment(&mut self, root: u32) -> usize {
        let scope = self.scopes.len();
        self.scopes.push(Scope::default());
        self.scope_roots[root as usize] = Some(scope);
        scope
    }
    pub(crate) fn emitted(&mut self, span: (usize, usize), part: Option<u32>, emission: u32, scope: usize) -> usize {
        let support = part.and_then(|node| {
            let (a, b) = self.span(node);
            (self.count(a, b) > 0).then(|| (self.next[a], self.previous[b]))
        });
        let row = self.rows.len();
        self.rows.push(Row {
            span,
            support,
            emission,
            own: Lists::default(),
            groups: Vec::new(),
            finished: Lists::default(),
            before: Vec::new(),
            after: Vec::new(),
        });
        self.scopes[scope].rows.push(row);
        row
    }
    pub(crate) fn inherited(&mut self, row: usize, before: &[Attachment], after: &[Attachment]) {
        let row = &mut self.rows[row];
        row.before = vec![None; before.len()];
        row.after = vec![None; after.len()];
        row.groups.extend(
            before
                .iter()
                .chain(after)
                .map(|token| Group::Lists(Lists { errors: token.errors.clone(), warnings: token.warnings.clone() })),
        );
    }
    pub(crate) fn attachments(
        &mut self,
        row: usize,
        before: Vec<Option<usize>>,
        after: Vec<Option<usize>>,
        before_scopes: &[usize],
        after_scopes: &[usize],
    ) {
        let row = &mut self.rows[row];
        let mut groups: Vec<_> = before_scopes.iter().copied().map(Group::Scope).collect();
        groups.append(&mut row.groups);
        groups.extend(after_scopes.iter().copied().map(Group::Scope));
        row.groups = groups;
        let mut all = before;
        all.append(&mut row.before);
        row.before = all;
        row.after.extend(after);
    }
    fn all(&self, scope: usize) -> Lists {
        let scope = &self.scopes[scope];
        let lists = join(
            std::iter::once(scope.unowned.parts()).chain(scope.rows.iter().map(|&row| self.rows[row].finished.parts())),
        );
        Lists { errors: ordered(lists.errors), warnings: ordered(lists.warnings) }
    }
    fn first(&self, rows: &[usize], before: impl Fn(&Row) -> bool) -> Option<usize> {
        let index = rows.partition_point(|&row| {
            work::count(Work::Walked, 1);
            before(&self.rows[row])
        });
        rows.get(index).copied()
    }
    fn owner(
        &self,
        node: u32,
        scope: usize,
        supported: &[usize],
        emissions: &[Vec<usize>],
        nearest: &[Option<u32>],
    ) -> Option<usize> {
        let (a, b) = self.span(node);
        if self.count(a, b) > 0 {
            if let Some(row) = self.first(supported, |row| row.support.unwrap().1 <= a) {
                let (start, end) = self.rows[row].support.unwrap();
                if start < b && self.count(a.max(start), b.min(end)) > 0 {
                    return Some(row);
                }
            }
        }
        if let Some(emission) = nearest[node as usize] {
            let rows = &emissions[emission as usize];
            if !rows.is_empty() {
                return self.first(rows, |row| row.support.unwrap_or(row.span).1 < a).or_else(|| rows.last().copied());
            }
        }
        let rows = &self.scopes[scope].rows;
        self.first(rows, |row| row.span.0 < a).or_else(|| rows.last().copied())
    }
    pub(crate) fn assign(&mut self) -> Lists {
        for index in 0..self.parents.len() {
            work::count(Work::Walked, 1);
            self.scopes_of[index] = self.scope_roots[index]
                .unwrap_or_else(|| self.parents[index].map_or(0, |parent| self.scopes_of[parent as usize]));
        }
        let mut events = vec![Vec::new(); self.scopes.len()];
        for event in self.events() {
            events[self.scopes_of[event.node as usize]].push(event);
        }
        let mut emissions = vec![Vec::new(); self.parents.len()];
        for (row, value) in self.rows.iter().enumerate() {
            emissions[value.emission as usize].push(row);
        }
        let mut nearest = vec![None; self.parents.len()];
        for index in 0..self.parents.len() {
            work::count(Work::Walked, 1);
            nearest[index] = if !emissions[index].is_empty() {
                Some(index as u32)
            } else {
                self.parents[index]
                    .filter(|&parent| self.scopes_of[parent as usize] == self.scopes_of[index])
                    .and_then(|parent| nearest[parent as usize])
            };
        }
        for (scope, events) in events.into_iter().enumerate() {
            let supported: Vec<_> =
                self.scopes[scope].rows.iter().copied().filter(|&row| self.rows[row].support.is_some()).collect();
            for event in events {
                work::count(Work::Walked, 1);
                if let Some(row) = self.owner(event.node, scope, &supported, &emissions, &nearest) {
                    self.rows[row].own.push(&event);
                } else {
                    self.scopes[scope].unowned.push(&event);
                }
            }
        }
        for scope in (0..self.scopes.len()).rev() {
            for index in 0..self.scopes[scope].rows.len() {
                let row = self.scopes[scope].rows[index];
                let groups: Vec<_> = self.rows[row]
                    .groups
                    .iter()
                    .map(|group| match group {
                        Group::Scope(scope) => self.all(*scope),
                        Group::Lists(lists) => lists.clone(),
                    })
                    .collect();
                let displayed_errors: FxSet<_> = groups.iter().flat_map(|group| &group.errors).map(identity).collect();
                let displayed_warnings: FxSet<_> =
                    groups.iter().flat_map(|group| &group.warnings).map(identity).collect();
                let own = &self.rows[row].own;
                let own = Lists {
                    errors: ordered(
                        own.errors
                            .iter()
                            .filter(|diagnostic| !displayed_errors.contains(&identity(diagnostic)))
                            .cloned()
                            .collect(),
                    ),
                    warnings: ordered(
                        own.warnings
                            .iter()
                            .filter(|diagnostic| !displayed_warnings.contains(&identity(diagnostic)))
                            .cloned()
                            .collect(),
                    ),
                };
                self.rows[row].finished = join(std::iter::once(own.parts()).chain(groups.iter().map(Lists::parts)));
            }
        }
        self.scopes[0].unowned.clone()
    }
    pub(crate) fn row(&self, row: usize) -> &Lists {
        &self.rows[row].finished
    }
    pub(crate) fn display_children(&self, row: usize) -> (&[Option<usize>], &[Option<usize>]) {
        (&self.rows[row].before, &self.rows[row].after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measures::{DiagnosticIdentity, DiagnosticRecord, Measure};
    use crate::tree::INode;
    use std::sync::Arc;

    fn grammar() -> crate::Pipeline {
        crate::load_pipeline_sources(
            [(
                "p.md",
                "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n%rule erased A\n%erased\n```\n",
            )],
            "p.md",
        )
        .unwrap()
    }
    fn diagnostic(code: &str, stage: usize, ordinal: usize) -> Warning {
        let mut diagnostic = Warning::new(format!("s{stage}"), code.into(), 0..1, 0..1, code.into());
        diagnostic.record = Some(Arc::new(DiagnosticRecord {
            identity: Arc::new(DiagnosticIdentity { stage_order: stage, ordinal }),
            measure: Measure::ZERO,
        }));
        diagnostic
    }
    fn token(index: usize) -> Tok {
        Tok {
            text: "a".into(),
            value: "a".into(),
            image: "a".into(),
            source: (index, index + 1),
            tags: 0,
            errors: Vec::new(),
            warnings: Vec::new(),
            before: Vec::new(),
            after: Vec::new(),
            sound: Default::default(),
            quiet: 0,
        }
    }
    fn close(prod: u32, start: u32, end: u32, children: &[u32]) -> INode {
        INode {
            structure: u32::MAX,
            kind: IKind::Close { prod, start, end, tags: 0, caps: Vec::new() },
            children: children.into(),
        }
    }
    fn read(tok: u32) -> INode {
        INode { structure: u32::MAX, kind: IKind::Read { tok, terminal: 0 }, children: Vec::new() }
    }
    fn codes(lists: &[Warning]) -> Vec<&str> {
        lists.iter().map(|diagnostic| diagnostic.code.as_str()).collect()
    }

    #[test]
    fn deferred_flow_keeps_reporting_preorder_and_orders_attachment_carriers() {
        // Engine §12.1 and §11.5: reporting and attachment groups use distinct orders.
        let pipeline = grammar();
        let grammar = pipeline.lowered_stage(0);
        let tree = ITree { nodes: vec![close(0, 0, 1, &[1]), close(0, 0, 1, &[2]), read(0)] };
        let mut tokens = vec![token(0)];
        tokens[0].warnings.push(diagnostic("old", 0, 0));
        let mut flow = DiagnosticFlow::new(&grammar, &tree, &tokens);
        flow.add(1, diagnostic("fresh", 1, 0), false);
        assert_eq!(codes(&flow.collected().warnings), ["fresh", "old"]);
        let attachment = flow.attachment(1);
        let child = flow.emitted((0, 1), Some(1), 1, attachment);
        let carrier = flow.emitted((0, 0), None, 0, 0);
        flow.attachments(carrier, vec![Some(child)], Vec::new(), &[attachment], &[]);
        assert!(flow.assign().warnings.is_empty());
        assert_eq!(codes(&flow.row(child).warnings), ["old", "fresh"]);
        assert_eq!(codes(&flow.row(carrier).warnings), ["old", "fresh"]);
        assert_eq!(flow.display_children(carrier).0, [Some(child)]);
        assert_eq!(codes(&flow.collected().warnings), ["fresh", "old"]);
    }

    #[test]
    fn deferred_flow_drops_erased_messages_from_failure_collections() {
        // Engine §12.1: evaluation visits erased nodes, while both collections omit them.
        let pipeline = grammar();
        let grammar = pipeline.lowered_stage(0);
        let erased = grammar.prods.iter().position(|production| production.erased).unwrap() as u32;
        let tree =
            ITree { nodes: vec![close(0, 0, 1, &[1, 3]), close(erased, 0, 1, &[2]), read(0), close(0, 1, 1, &[])] };
        let mut tokens = vec![token(0)];
        tokens[0].errors.push(diagnostic("carried", 0, 0));
        let mut flow = DiagnosticFlow::new(&grammar, &tree, &tokens);
        flow.add(1, diagnostic("hidden", 1, 0), true);
        flow.add(3, diagnostic("live", 1, 1), false);
        assert_eq!(flow.ordinal(), 2);
        assert!(flow.messages().errors.is_empty());
        assert!(flow.collected().errors.is_empty());
        assert_eq!(codes(&flow.messages().warnings), ["live"]);
        assert_eq!(codes(&flow.collected().warnings), ["live"]);
    }

    #[test]
    fn deferred_flow_uses_counted_support_before_empty_boundary_fallback() {
        // Engine §11.5: an empty occurrence uses the nearest emission's inclusive end.
        let pipeline = grammar();
        let grammar = pipeline.lowered_stage(0);
        let tree = ITree {
            nodes: vec![close(0, 0, 2, &[1, 3, 4]), close(0, 0, 1, &[2]), read(0), close(0, 1, 1, &[]), read(1)],
        };
        let tokens = vec![token(0), token(1)];
        let mut flow = DiagnosticFlow::new(&grammar, &tree, &tokens);
        flow.add(0, diagnostic("root", 1, 0), true);
        flow.add(3, diagnostic("empty", 1, 1), false);
        let first = flow.emitted((0, 1), Some(1), 0, 0);
        let second = flow.emitted((1, 2), Some(4), 0, 0);
        flow.assign();
        assert_eq!(codes(&flow.row(first).errors), ["root"]);
        assert_eq!(codes(&flow.row(first).warnings), ["empty"]);
        assert!(flow.row(second).errors.is_empty());
        assert!(flow.row(second).warnings.is_empty());
    }

    #[test]
    fn deferred_flow_keeps_unlisted_and_tokenless_diagnostics() {
        // Engine §11.5: an unlisted leaf uses the next output, or the empty stage.
        let pipeline = grammar();
        let grammar = pipeline.lowered_stage(0);
        let tree = ITree { nodes: vec![close(0, 0, 2, &[1, 2]), read(0), read(1)] };
        let mut tokens = vec![token(0), token(1)];
        tokens[0].warnings.push(diagnostic("gap", 0, 0));
        let mut flow = DiagnosticFlow::new(&grammar, &tree, &tokens);
        let next = flow.emitted((1, 2), Some(2), 2, 0);
        assert!(flow.assign().warnings.is_empty());
        assert_eq!(codes(&flow.row(next).warnings), ["gap"]);
        let mut empty = DiagnosticFlow::new(&grammar, &tree, &tokens);
        assert_eq!(codes(&empty.assign().warnings), ["gap"]);
        assert_eq!(codes(&input(&tokens).warnings), ["gap"]);
    }

    #[test]
    fn deferred_tie_collections_keep_maximum_own_multiplicity_and_carried_identity() {
        // Engine §12.1: carried identities join once, while equal own objects keep their maximum multiplicity.
        let own = |ordinal| Event { node: 0, diagnostic: diagnostic("same", 1, ordinal), error: true, own: true };
        let carried = Event { node: 1, diagnostic: diagnostic("old", 0, 0), error: true, own: false };
        let first = vec![own(0), own(1), carried.clone()];
        let second = vec![own(0), carried, own(1), own(2)];
        assert_eq!(codes(&tied(&first, &second).errors), ["same", "same", "old", "same"]);
    }
}
