//! Source calls share the ordinary reader's expression and term frames.
use super::*;
use crate::dom::source::{SourceArgument, SourceCall, SourceSymbol, SourceTarget};

pub(super) struct CallFrame<'a> {
    node: &'a Node,
    arguments: Option<Vec<&'a Node>>,
    args: Vec<SourceArgument>,
    name: Option<String>,
}
impl<'a> CallFrame<'a> {
    pub(super) fn new(node: &'a Node) -> Self {
        Self { node, arguments: None, args: Vec::new(), name: None }
    }
}

pub(super) struct SourceArgumentFrame<'a> {
    node: &'a Node,
    targets: Option<Vec<&'a Node>>,
    values: Vec<SourceTarget>,
}
impl<'a> SourceArgumentFrame<'a> {
    fn new(node: &'a Node) -> Self {
        Self { node, targets: None, values: Vec::new() }
    }
}

impl<'a> Reader<'a> {
    pub(super) fn source_parameter(&self, node: &'a Node) -> R<SourceSymbol> {
        let name = self.value(self.token(node)?).strip_prefix('@').unwrap_or("");
        if !self.reading_head.get() && !self.parameters.borrow().contains(name) {
            return Err(self.error(node, format!("undeclared parameter @{name}")));
        }
        self.unresolved.set(true);
        Ok(SourceSymbol::Parameter(name.into(), self.first(node)))
    }

    pub(super) fn source_call(&self, node: &'a Node) -> R<SourceCall> {
        match self.run(Frame::SourceCall(CallFrame::new(node)))? {
            Val::SourceCall(call) => Ok(call),
            _ => unreachable!("a source call reads a call"),
        }
    }

    pub(super) fn resume_source_call(&self, frame: &mut CallFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        self.unresolved.set(true);
        if let Some(Val::SourceArgument(arg)) = input {
            frame.args.push(arg);
        }
        if frame.arguments.is_none() {
            frame.name = Some(self.value(self.token(frame.node)?).into());
            frame.arguments = Some(self.some(frame.node, "call-argument", 1)?);
        }
        if let Some(&node) = frame.arguments.as_ref().unwrap().get(frame.args.len()) {
            return Ok(Step::Call(Frame::SourceArgument(SourceArgumentFrame::new(node))));
        }
        Ok(Step::Done(Val::SourceCall(SourceCall {
            name: frame.name.take().unwrap(),
            args: std::mem::take(&mut frame.args),
            at: self.first(frame.node),
        })))
    }

    pub(super) fn pattern_requirements(&self, node: &'a Node) -> R<Term> {
        self.requirements_in(node, "invalid tag requirement", true)
    }
    pub(super) fn source_requirements(&self, node: &'a Node, invalid_operand: &str) -> R<Term> {
        self.requirements_in(node, invalid_operand, false)
    }
    fn requirements_in(&self, node: &'a Node, invalid_operand: &str, pattern: bool) -> R<Term> {
        let mut args = Vec::new();
        for requirement in self.rules(node, "tag-requirement") {
            let operand = self.one(requirement, "test-operand")?;
            let part = self.inner(operand, ATOMS)?;
            let value = match rule_name(part) {
                "tag" => Term::Tag(if pattern && self.value(self.token(part)?) == "_Elided" {
                    "_Elided".into()
                } else {
                    self.tag_of(self.token(part)?)?
                }),
                "constant-reference" => self.constant_reference(self.token(part)?)?,
                "parameter" => Term::Source(self.source_parameter(part)?),
                _ => return Err(self.error(operand, invalid_operand)),
            };
            let negated = self.tokens_of(requirement).any(|token| self.value(token) == "¬");
            args.push(Arg::Term(if negated { Term::Call("forbid".into(), vec![Arg::Term(value)]) } else { value }));
        }
        Ok(Term::Call("requirements".into(), args))
    }

    pub(super) fn resume_source_argument(
        &self,
        frame: &mut SourceArgumentFrame<'a>,
        input: Option<Val>,
    ) -> R<Step<'a>> {
        match input {
            Some(Val::Expr(expr)) => return Ok(Step::Done(Val::SourceArgument(SourceArgument::Body(expr)))),
            Some(Val::Term(term, _)) => {
                return Ok(Step::Done(Val::SourceArgument(SourceArgument::Term(term))));
            }
            Some(Val::SourceCall(call)) => frame.values.push(SourceTarget::Symbol(SourceSymbol::Call(call))),
            None => {}
            _ => unreachable!("a call argument reads a term, expression or target"),
        }
        if frame.targets.is_none() {
            let inner = self.inner(
                frame.node,
                &["requirement-argument", "target-argument", "body-argument", "symbol-argument", "term"],
            )?;
            match rule_name(inner) {
                "requirement-argument" => {
                    return Ok(Step::Done(Val::SourceArgument(SourceArgument::Requirements(
                        self.source_requirements(inner, "a tag requirement requires a tag or tag-set constant")?,
                    ))));
                }
                "target-argument" => {
                    frame.targets = Some(self.parts(inner).into_iter().filter(|n| n.kind == NodeKind::Rule).collect());
                }
                "body-argument" | "symbol-argument" => {
                    let primary = self.inner(inner, PRIMARIES)?;
                    return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(primary, true))));
                }
                _ => {
                    if let Some(union) = self.rules(inner, "union").next() {
                        if let Some(name) = self.rule_name_in(union) {
                            return Ok(Step::Done(Val::SourceArgument(SourceArgument::Body(Expr::Ref(name)))));
                        }
                    }
                    return Ok(Step::Call(Frame::Term(TermFrame::new(inner, true))));
                }
            }
        }
        let targets = frame.targets.as_ref().unwrap();
        while let Some(&node) = targets.get(frame.values.len()) {
            let target = match rule_name(node) {
                "call" => return Ok(Step::Call(Frame::SourceCall(CallFrame::new(node)))),
                "parameter" => SourceTarget::Symbol(self.source_parameter(node)?),
                "reference" => SourceTarget::Rule(self.value(self.token(node)?).into()),
                "tag" => SourceTarget::Terminal(self.tag_of(self.token(node)?)?),
                _ => return Err(self.error(node, "invalid target argument")),
            };
            frame.values.push(target);
        }
        Ok(Step::Done(Val::SourceArgument(SourceArgument::Targets(std::mem::take(&mut frame.values)))))
    }
}
