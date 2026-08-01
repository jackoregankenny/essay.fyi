//! Agent integration (Milestone 4).
//!
//! Essay hosts coding agents over the **Agent Client Protocol** — Zed's
//! JSON-RPC-over-stdio standard, which opencode speaks natively (`opencode
//! acp`) and Claude Code speaks through an adapter. One protocol, several
//! agents, and — the reason it was chosen over spawning each agent's own
//! headless mode — a client-proxied filesystem. When Essay advertises the `fs`
//! capability, the agent asks Essay to write rather than writing itself, and
//! that request is the seam the product needs:
//!
//! **AI proposes; the author decides.** A write becomes a [`ChangeSet`] — the
//! proposed content, the diff against the file as it stands, and the
//! provenance saying which agent, which session, which instruction, when.
//! Nothing reaches the manuscript until the author accepts it, and accepting
//! goes through the same hash-guarded write the editor's own save uses, so a
//! proposal composed against a document that has since moved is refused rather
//! than applied blind.
//!
//! The universal fallback still stands alongside this: `essay-workspace`'s
//! `DocumentWatcher` catches edits from any tool at all, including an agent
//! run outside Essay. What ACP adds is provenance, and the chance to intervene
//! before the bytes land rather than after.

mod acp;
mod changeset;
mod registry;
mod session;
mod skills;

pub use acp::{AgentHost, HostError, MODE_OPTION_ID};
pub use changeset::{
    excerpt, provenance, AcceptOutcome, ChangeSet, ChangeSetError, ChangeSetStore, ChangeStatus,
    Provenance,
};
pub use registry::{list_agents, AgentDefinition, AgentInfo, LaunchError, KNOWN_AGENTS};
pub use skills::{compose_prompt, house_skill, load_skills, skills_dir, Skill, SkillScope};
pub use session::{
    AgentCommand, AgentEvent, HostObserver, PermissionBroker, PermissionDecision,
    PermissionOption, PermissionRequest, PlanEntry, SessionChoice, SessionOption, SessionSummary,
};
