//! Loading rejects structurally empty error productions (engine §3.6).

use crate::dom::Expr;
use crate::error::Error;
use crate::fxhash::FxMap;
use crate::grammar::StageGrammar;
use crate::work::{self, Work};

#[derive(Clone, Copy)]
enum Site<'a> {
    Rule(usize),
    Expression(&'a Expr),
}

#[derive(Hash, PartialEq, Eq)]
enum Key {
    Rule(usize),
    Expression(*const Expr),
}

#[derive(Default)]
struct Node {
    all: bool,
    nullable: bool,
    remaining: usize,
    users: Vec<usize>,
}

fn intern<'a>(site: Site<'a>, sites: &mut Vec<Site<'a>>, nodes: &mut Vec<Node>, seen: &mut FxMap<Key, usize>) -> usize {
    work::count(Work::Walked, 1);
    let key = match site {
        Site::Rule(rule) => Key::Rule(rule),
        Site::Expression(expression) => Key::Expression(expression),
    };
    if let Some(index) = seen.get(&key) {
        return *index;
    }
    let index = nodes.len();
    seen.insert(key, index);
    sites.push(site);
    nodes.push(Node::default());
    index
}

pub(crate) fn check(grammar: &StageGrammar) -> Result<(), Error> {
    let mut sites = Vec::new();
    let mut nodes = Vec::new();
    let mut seen = FxMap::default();
    let mut errors = Vec::new();
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            work::count(Work::Walked, 1);
            if alternative.clauses.error.is_some() {
                let root = intern(Site::Expression(&alternative.alternative.expr), &mut sites, &mut nodes, &mut seen);
                errors.push((rule, alternative, root));
            }
        }
    }
    let mut index = 0;
    while index < sites.len() {
        work::count(Work::Walked, 1);
        let mut children = Vec::new();
        let mut all = false;
        match sites[index] {
            Site::Rule(rule) => children.extend(
                grammar.rules[rule]
                    .alternatives
                    .iter()
                    .map(|alternative| Site::Expression(&alternative.alternative.expr)),
            ),
            Site::Expression(expression) => match expression {
                Expr::Empty | Expr::Optional(..) => all = true,
                Expr::Seq(items) => {
                    all = true;
                    children.extend(items.iter().map(Site::Expression));
                }
                Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                    children.extend(items.iter().map(Site::Expression))
                }
                Expr::Capture(_, inner)
                | Expr::Tested(_, _, inner)
                | Expr::Splice(inner)
                | Expr::Repeat(inner, _, _) => children.push(Site::Expression(inner)),
                Expr::Ref(name) => {
                    if let Some(rule) = grammar.index.get(name) {
                        children.push(Site::Rule(*rule));
                    }
                }
                _ => {}
            },
        }
        nodes[index].all = all;
        nodes[index].remaining = children.len();
        for child in children {
            let child = intern(child, &mut sites, &mut nodes, &mut seen);
            nodes[child].users.push(index);
        }
        index += 1;
    }
    let mut ready = Vec::new();
    for (index, node) in nodes.iter_mut().enumerate() {
        work::count(Work::Walked, 1);
        if node.all && node.remaining == 0 {
            node.nullable = true;
            ready.push(index);
        }
    }
    let mut cursor = 0;
    while cursor < ready.len() {
        let users = std::mem::take(&mut nodes[ready[cursor]].users);
        for user in users {
            work::count(Work::Walked, 1);
            let node = &mut nodes[user];
            if node.nullable {
                continue;
            }
            node.remaining -= 1;
            if !node.all || node.remaining == 0 {
                node.nullable = true;
                ready.push(user);
            }
        }
        cursor += 1;
    }
    for (rule, alternative, root) in errors {
        if nodes[root].nullable {
            return Err(Error::grammar(format!("an error production of {} can match no tokens", rule.name))
                .in_document(&alternative.document)
                .at(alternative.at.0, alternative.at.1)
                .in_stage(&grammar.name));
        }
    }
    Ok(())
}
