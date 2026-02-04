//! Data models for SaveContext.
//!
//! This module contains all domain models:
//! - Session
//! - ContextItem
//! - Issue
//! - Checkpoint
//! - Plan
//! - Memory
//! - Project

pub mod plan;
pub mod project;

pub use plan::{Plan, PlanStatus};
pub use project::Project;
