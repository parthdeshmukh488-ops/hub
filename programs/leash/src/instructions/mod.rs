//! One module per instruction, each with its `Accounts` struct (01-onchain-program §6).
//! Anchor's generated client modules are found through these glob re-exports.

mod payment;

pub mod add_payee;
pub mod approve_request;
pub mod close_agent;
pub mod create_agent;
pub mod expire_request;
pub mod freeze_agent;
pub mod freeze_principal;
pub mod initialize_principal;
pub mod pay;
pub mod reject_request;
pub mod remove_payee;
pub mod report_denied_attempt;
pub mod request_payment;
pub mod set_guardian;
pub mod unfreeze_agent;
pub mod unfreeze_principal;
pub mod update_payee;
pub mod update_policy;

pub use add_payee::*;
pub use approve_request::*;
pub use close_agent::*;
pub use create_agent::*;
pub use expire_request::*;
pub use freeze_agent::*;
pub use freeze_principal::*;
pub use initialize_principal::*;
pub use pay::*;
pub use reject_request::*;
pub use remove_payee::*;
pub use report_denied_attempt::*;
pub use request_payment::*;
pub use set_guardian::*;
pub use unfreeze_agent::*;
pub use unfreeze_principal::*;
pub use update_payee::*;
pub use update_policy::*;
