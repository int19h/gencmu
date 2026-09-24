//! The error a library call returns: a dialect that cannot be loaded, or a
//! caller's mistake such as an unknown stage name.

use std::fmt;

/// What kind of failure an [`Error`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ErrorKind {
    /// A grammar or pipeline document is missing, does not parse as the
    /// notation, or does not stitch into a valid grammar; or one of the
    /// shipped data files (`unicode.txt`, `bootstrap.json`) is malformed.
    Grammar,
    /// A file could not be read from disk.
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
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Error {
        Error { kind, message: message.into(), document: None, line: None, column: None, stage: None }
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
