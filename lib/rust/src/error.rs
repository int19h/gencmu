//! The error a library call returns: a dialect that cannot be loaded, or a
//! caller's mistake such as an unknown stage name.

use crate::json::Json;
use std::fmt;

/// The written source of a ranked group or inheritance step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupSite {
    /// The source document, when known.
    pub document: Option<String>,
    /// The source line and column, when known.
    pub at: Option<(usize, usize)>,
    /// The final stitched rule.
    pub rule: String,
    /// The zero-based alternative index.
    pub alternative: usize,
    /// The expression path relative to its alternative.
    pub path: String,
}
impl GroupSite {
    fn value(&self) -> Json {
        let mut fields = Vec::new();
        if let Some(document) = &self.document {
            fields.push(("document".into(), Json::Str(document.clone())));
        }
        if let Some((line, column)) = self.at {
            fields.push(("at".into(), Json::Arr(vec![Json::Int(line as i64), Json::Int(column as i64)])));
        }
        fields.extend([
            ("rule".into(), Json::Str(self.rule.clone())),
            ("alternative".into(), Json::Int(self.alternative as i64)),
            ("path".into(), Json::Str(self.path.clone())),
        ]);
        Json::Obj(fields)
    }
}

/// What kind of failure an [`Error`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorKind {
    /// A grammar or pipeline document is missing, is not valid UTF-8 on
    /// disk, does not parse as the notation, or does not stitch into a valid
    /// grammar; or one of the shipped data files (`unicode.txt`,
    /// `bootstrap.json`) is malformed.
    Grammar,
    /// A file could not be read from disk, for a reason other than its
    /// bytes.
    Io,
    /// The caller asked for something that does not exist, such as an
    /// unknown stage name in [`ParseOptions::until`](crate::ParseOptions::until).
    Usage,
}

/// An error returned by the loaders and by [`Dialect::parse`](crate::Dialect::parse).
///
/// A text that does not parse is not an error: it is a
/// [`ParseResult`](crate::ParseResult) whose `ok` is false.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    /// What kind of failure this is.
    pub kind: ErrorKind,
    /// The human description.
    pub message: String,
    /// The document the error is in, as its path, when known.
    pub document: Option<String>,
    /// The line in that document, counting from 1, when known.
    pub line: Option<usize>,
    /// The column in that line, in code points counting from 1, when known.
    pub column: Option<usize>,
    /// The pipeline stage the error concerns, when known.
    pub stage: Option<String>,
    /// The optional ranked loading details.
    pub diagnostic: Option<Box<RankedDiagnostic>>,
}

/// The structured fields of a ranked loading diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RankedDiagnostic {
    /// The stable ranked loading code, when present.
    pub code: Option<String>,
    /// The written ranked group.
    pub group: Option<GroupSite>,
    /// The zero-based option index.
    pub option: Option<usize>,
    /// The original written DOM expression.
    pub expression: Option<Json>,
    /// The shortest tag inheritance witness.
    pub inheritance: Option<Vec<GroupSite>>,
}

impl std::ops::Deref for Error {
    type Target = RankedDiagnostic;
    fn deref(&self) -> &RankedDiagnostic {
        static EMPTY: RankedDiagnostic =
            RankedDiagnostic { code: None, group: None, option: None, expression: None, inheritance: None };
        self.diagnostic.as_deref().unwrap_or(&EMPTY)
    }
}
impl std::ops::DerefMut for Error {
    fn deref_mut(&mut self) -> &mut RankedDiagnostic {
        self.diagnostic.get_or_insert_with(Default::default)
    }
}

impl Error {
    /// Writes the canonical loading diagnostic schema.
    pub fn to_json(&self) -> String {
        let kind = match self.kind {
            ErrorKind::Grammar => "grammar",
            ErrorKind::Usage => "usage",
            ErrorKind::Io => "io",
        };
        let mut fields = vec![("kind".into(), Json::Str(kind.into()))];
        if let Some(code) = &self.code {
            fields.push(("code".into(), Json::Str(code.clone())));
        }
        fields.push(("message".into(), Json::Str(self.to_string())));
        if let Some(group) = &self.group {
            fields.push(("group".into(), group.value()));
        }
        if let Some(option) = self.option {
            fields.push(("option".into(), Json::Int(option as i64)));
        }
        if let Some(expression) = &self.expression {
            fields.push(("expression".into(), expression.clone()));
        }
        if let Some(inheritance) = &self.inheritance {
            fields.push(("inheritance".into(), Json::Arr(inheritance.iter().map(GroupSite::value).collect())));
        }
        Json::Obj(fields).to_json()
    }
    pub(crate) fn ranked_detail(mut self, option: usize, expression: Option<Json>) -> Self {
        self.option = Some(option);
        self.expression = expression;
        self
    }
    pub(crate) fn coded(mut self, code: &str) -> Self {
        self.code = Some(code.into());
        self
    }

    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Error {
        Error { kind, message: message.into(), document: None, line: None, column: None, stage: None, diagnostic: None }
    }

    pub(crate) fn grammar(message: impl Into<String>) -> Error {
        Error::new(ErrorKind::Grammar, message)
    }

    pub(crate) fn usage(message: impl Into<String>) -> Error {
        Error::new(ErrorKind::Usage, message)
    }

    pub(crate) fn in_document(mut self, document: &str) -> Error {
        if self.document.is_none() {
            self.document = Some(document.to_string());
        }
        self
    }

    pub(crate) fn at(mut self, line: usize, column: usize) -> Error {
        if self.line.is_none() {
            self.line = Some(line);
            self.column = Some(column);
        }
        self
    }

    pub(crate) fn in_stage(mut self, stage: &str) -> Error {
        if self.stage.is_none() {
            self.stage = Some(stage.to_string());
        }
        self
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.document.as_deref() == Some("notation/bootstrap.json")
            && self.message.starts_with("notation/bootstrap.json:")
        {
            return write!(f, "{}", self.message);
        }
        if let Some(document) = &self.document {
            write!(f, "{document}")?;
            if let (Some(line), Some(column)) = (self.line, self.column) {
                write!(f, ":{line}:{column}")?;
            }
            write!(f, ": ")?;
        } else if let (Some(line), Some(column)) = (self.line, self.column) {
            write!(f, "{line}:{column}: ")?;
        }
        if let Some(stage) = &self.stage {
            write!(f, "stage {stage}: ")?;
        }
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for Error {}
