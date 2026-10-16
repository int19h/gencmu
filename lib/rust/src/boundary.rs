//! Finite complete-tree boundary records (engine §4.2).
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{LCond, Lowered};
use std::collections::BTreeSet;

pub(crate) type Bits = BTreeSet<u32>;
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Literal {
    pub forward: bool,
    pub targets: Vec<String>,
    pub positive: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub(crate) struct Record {
    pub nonempty: bool,
    pub start: Bits,
    pub first: BTreeSet<String>,
    pub end: Bits,
    pub last: BTreeSet<String>,
}
impl Record {
    pub fn dominates(&self, lower: &Self) -> bool {
        self.nonempty == lower.nonempty && self.first == lower.first && self.last == lower.last
            && self.start.is_subset(&lower.start) && self.end.is_subset(&lower.end)
    }
}
#[derive(Debug)]
pub(crate) struct Records {
    pub records: Vec<Record>,
    index: FxMap<Record, u32>,
    pub literals: Vec<Literal>,
    literal_index: FxMap<Literal, u32>,
    forward: FxSet<String>,
    backward: FxSet<String>,
}
pub(crate) fn atom(condition: &LCond) -> Option<&LCond> {
    let mut stack = vec![condition];
    while let Some(c) = stack.pop() {
        match c {
            LCond::Boundary(..) => return Some(c),
            LCond::Not(c) => stack.push(c),
            LCond::All(cs) | LCond::Any(cs) => stack.extend(cs.iter().rev()),
            LCond::If(a,b) => stack.extend([&**b,&**a]),
            _ => {}
        }
    }
    None
}
impl Records {
    pub fn new(g: &Lowered) -> Option<Self> {
        let mut out = Self { records: vec![], index: FxMap::default(), literals: vec![], literal_index: FxMap::default(), forward: FxSet::default(), backward: FxSet::default() };
        for (c,_) in g.prods.iter().flat_map(|p| &p.conds).chain(g.ranked.plans.values().flat_map(|p| p.conditions.iter().flatten())) {
            if let Some(LCond::Boundary(forward,_,targets,_,_)) = atom(c) {
                let names = if *forward { &mut out.forward } else { &mut out.backward };
                names.extend(targets.iter().cloned());
            }
        }
        out.intern(Record::default());
        (!out.forward.is_empty() || !out.backward.is_empty()).then_some(out)
    }
    pub fn intern(&mut self, record: Record) -> u32 {
        if let Some(&id) = self.index.get(&record) { return id; }
        let id = self.records.len() as u32;
        self.records.push(record.clone());
        self.index.insert(record,id);
        id
    }
    pub fn literal(&mut self, forward: bool, targets: &[String], positive: bool) -> u32 {
        let mut targets=targets.to_vec(); targets.sort(); targets.dedup();
        let literal=Literal {forward,targets,positive};
        if let Some(&id)=self.literal_index.get(&literal) {return id;}
        let id=self.literals.len() as u32;
        self.literals.push(literal.clone()); self.literal_index.insert(literal,id); id
    }
    pub fn leaf(&mut self, name: &str, empty: bool) -> u32 {
        if empty {return 0;}
        let mut r=Record {nonempty:true,..Record::default()};
        if self.forward.contains(name) {r.first.insert(name.to_string());}
        if self.backward.contains(name) {r.last.insert(name.to_string());}
        self.intern(r)
    }
    fn meet(&self, literals: &Bits, offers: &BTreeSet<String>, forward: bool, final_: bool, failed: &mut Vec<u32>) -> Bits {
        literals.iter().copied().filter(|&id| {
            let l=&self.literals[id as usize];
            if l.forward != forward {return true;}
            let hit=l.targets.iter().any(|n|offers.contains(n));
            if !hit && !final_ {return true;}
            if hit != l.positive {failed.push(id);}
            false
        }).collect()
    }
    pub fn advance(&mut self, prefix: u32, child: u32, failed: &mut Vec<u32>) -> u32 {
        let mut p=self.records[prefix as usize].clone();
        let c=self.records[child as usize].clone();
        if !c.nonempty {
            let end=if p.nonempty {self.meet(&c.end,&p.last,false,false,failed)} else {c.end};
            p.end.extend(end);
        } else if !p.nonempty {
            let mut pending=p.end; pending.extend(&c.start);
            p=Record {nonempty:true,start:self.meet(&pending,&c.first,true,false,failed),first:c.first,end:c.end,last:c.last};
        } else {
            let mut middle=p.end; middle.extend(&c.start);
            self.meet(&middle,&c.first,true,true,failed);
            self.meet(&middle,&p.last,false,true,failed);
            p.end=c.end; p.last=c.last;
        }
        self.intern(p)
    }
    pub fn complete(&mut self, record: u32, name: Option<&str>, backward: &Bits, forward: &Bits, failed: &mut Vec<u32>) -> u32 {
        let mut r=self.records[record as usize].clone();
        if !r.nonempty {r.end.extend(backward);r.end.extend(forward);return self.intern(r);}
        if let Some(name)=name {
            if self.forward.contains(name) {r.first.insert(name.to_string());}
            if self.backward.contains(name) {r.last.insert(name.to_string());}
        }
        r.start=self.meet(&r.start,&r.first,true,false,failed);
        r.end=self.meet(&r.end,&r.last,false,false,failed);
        r.start.extend(backward);r.end.extend(forward);self.intern(r)
    }
    pub fn append(&mut self, record: u32, bits: &Bits) -> u32 {
        if bits.is_empty() {return record;}
        let mut r=self.records[record as usize].clone(); r.end.extend(bits);self.intern(r)
    }
    pub fn accepts(&self, record: u32) -> bool {
        let r=&self.records[record as usize];
        r.start.iter().chain(&r.end).all(|&id|!self.literals[id as usize].positive)
    }
    pub fn open(&self, prefix: u32, child: u32) -> Record {
        let p=&self.records[prefix as usize];let c=&self.records[child as usize];
        if !c.nonempty {
            let end=if p.nonempty {self.meet(&c.end,&p.last,false,false,&mut vec![])} else {c.end.clone()};
            Record {end,..Record::default()}
        } else if !p.nonempty {c.clone()} else {Record {nonempty:true,end:c.end.clone(),last:c.last.clone(),..Record::default()}}
    }
}

/// Boundary atoms in written order, before presence simplification.
pub(crate) fn dom_atoms(condition: &crate::dom::Cond) -> Vec<&crate::dom::Cond> {
    use crate::dom::Cond;
    let mut found=vec![];let mut stack=vec![condition];
    while let Some(c)=stack.pop() {
        match c {
            Cond::Boundary(..) => found.push(c),
            Cond::Not(c) => stack.push(c),
            Cond::All(cs)|Cond::Any(cs) => stack.extend(cs.iter().rev()),
            Cond::If(a,b) => stack.extend([&**b,&**a]),
            _ => {}
        }
    }
    found
}
pub(crate) fn ownership(condition: &mut LCond, own: bool) {
    match condition {
        LCond::Boundary(_,crate::lower::Span::Whole,_,active,_) => *active=own,
        LCond::Not(c) => ownership(c,own),
        LCond::All(cs)|LCond::Any(cs) => for c in cs {ownership(c,own)},
        LCond::If(a,b) => {ownership(a,own);ownership(b,own);}
        _ => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Site {pub rule:u32,pub condition:usize}
pub(crate) fn condition_offsets(g:&crate::grammar::StageGrammar) -> FxMap<usize,usize> {
    let mut offsets=FxMap::default();
    for rule in &g.rules {
        let mut count=0;
        for alt in &rule.alternatives {
            let key=std::sync::Arc::as_ptr(&alt.clauses) as usize;
            if let std::collections::hash_map::Entry::Vacant(e)=offsets.entry(key) {
                e.insert(count);count+=alt.clauses.conditions.len();
            }
        }
    }
    offsets
}
/// Source graphs carry late annotation joins without splitting chart facts.
#[derive(Debug,Default)]
pub(crate) struct Sources {nodes:Vec<Source>}
#[derive(Debug,Default)]
struct Source {sites:BTreeSet<Site>,parents:BTreeSet<u32>}
#[derive(Debug,Clone,Default)]
pub(crate) struct Annotations {pub start:FxMap<u32,u32>,pub end:FxMap<u32,u32>}
#[derive(Debug)]
pub(crate) struct Failure {pub at:u32,pub end:u32,pub source:u32}
impl Sources {
    fn node(&mut self) -> u32 {let id=self.nodes.len() as u32;self.nodes.push(Source::default());id}
    pub fn join(&mut self,inputs:impl IntoIterator<Item=u32>) -> u32 {
        let id=self.node();self.nodes[id as usize].parents.extend(inputs);id
    }
    pub fn add(&mut self,map:&mut FxMap<u32,u32>,literal:u32,site:Option<Site>) {
        let id=*map.entry(literal).or_insert_with(||self.node());
        if let Some(site)=site {self.nodes[id as usize].sites.insert(site);}
    }
    fn select(&mut self,bits:&Bits,inputs:&[&FxMap<u32,u32>]) -> FxMap<u32,u32> {
        bits.iter().map(|&literal| {
            let id=self.join(inputs.iter().filter_map(|m|m.get(&literal).copied()));(literal,id)
        }).collect()
    }
    pub fn merge(&mut self,target:&mut Annotations,other:&Annotations) {
        for (a,b) in [(&mut target.start,&other.start),(&mut target.end,&other.end)] {
            for (&literal,&source) in b {
                let id=*a.entry(literal).or_insert_with(||self.node());
                if id!=source {self.nodes[id as usize].parents.insert(source);}
            }
        }
    }
    pub fn retain(&mut self,a:&Annotations,r:&Record) -> Annotations {
        Annotations {start:self.select(&r.start,&[&a.start]),end:self.select(&r.end,&[&a.end])}
    }
    pub fn meeting(&mut self,a:&Annotations,b:&Annotations,empty:bool,literal:u32) -> u32 {
        if empty {self.join(b.end.get(&literal).copied())} else {self.join(a.end.get(&literal).into_iter().chain(b.start.get(&literal)).copied())}
    }
    pub fn advance(&mut self,a:&Annotations,p:&Record,b:&Annotations,c:&Record,r:&Record) -> Annotations {
        if !c.nonempty {Annotations {start:self.select(&r.start,&[&a.start]),end:self.select(&r.end,&[&a.end,&b.end])}}
        else if !p.nonempty {Annotations {start:self.select(&r.start,&[&a.end,&b.start]),end:self.select(&r.end,&[&b.end])}}
        else {Annotations {start:self.select(&r.start,&[&a.start]),end:self.select(&r.end,&[&b.end])}}
    }
    pub fn sites(&self,id:u32) -> BTreeSet<Site> {
        let mut sites=BTreeSet::new();let mut seen=FxSet::default();let mut stack=vec![id];
        while let Some(id)=stack.pop() {
            if !seen.insert(id) {continue;}
            let n=&self.nodes[id as usize];sites.extend(&n.sites);stack.extend(&n.parents);
        }
        sites
    }
}
