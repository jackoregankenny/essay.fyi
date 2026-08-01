//! The agents Essay knows how to launch, and whether this machine has them.
//!
//! Everything here speaks ACP over stdio, so the registry is a table of
//! commands rather than a set of adapters. Adding an agent is adding a row.

use agent_client_protocol::AcpAgentConfig;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// How to launch one agent, and how to tell whether it is installed.
pub struct AgentDefinition {
    pub id: &'static str,
    pub name: &'static str,
    /// The executable to run. Resolved against PATH at launch time.
    pub command: &'static str,
    pub args: &'static [&'static str],
    /// Executables that must exist for this agent to be usable. Usually the
    /// command itself; for an agent behind a launcher it is both the launcher
    /// and the agent it launches, because `npx` alone proves nothing.
    pub requires: &'static [&'static str],
}

pub const KNOWN_AGENTS: &[AgentDefinition] = &[
    // Native ACP: no adapter, no npm fetch, works offline once installed.
    AgentDefinition {
        id: "opencode",
        name: "opencode",
        command: "opencode",
        args: &["acp"],
        requires: &["opencode"],
    },
    // Claude Code speaks ACP through an adapter. `npx -y` fetches it on first
    // use, so this one is the exception to "fully offline": the agent itself
    // needs the network anyway.
    AgentDefinition {
        id: "claude-code",
        name: "Claude Code",
        command: "npx",
        args: &["-y", "@agentclientprotocol/claude-agent-acp"],
        requires: &["npx", "claude"],
    },
];

/// What the frontend needs to offer an agent: who it is, and whether picking
/// it will work.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    /// The command line, for the "why is this greyed out?" tooltip.
    pub command: String,
    pub available: bool,
}

pub fn definition(id: &str) -> Option<&'static AgentDefinition> {
    KNOWN_AGENTS.iter().find(|agent| agent.id == id)
}

/// Every known agent, with availability probed now rather than cached: an
/// author who installs opencode while Essay is open should see it appear.
pub fn list_agents() -> Vec<AgentInfo> {
    KNOWN_AGENTS
        .iter()
        .map(|agent| AgentInfo {
            id: agent.id.to_string(),
            name: agent.name.to_string(),
            command: std::iter::once(agent.command)
                .chain(agent.args.iter().copied())
                .collect::<Vec<_>>()
                .join(" "),
            available: agent.requires.iter().all(|name| which(name).is_some()),
        })
        .collect()
}

impl AgentDefinition {
    /// Build the launch configuration, resolving the command against PATH.
    ///
    /// Resolution is ours to do rather than the OS's. `CreateProcess` on
    /// Windows searches PATH but only ever appends `.exe`, so a launcher
    /// shipped as `npx.cmd` — which is how Node ships it — is simply not found.
    /// A resolved `.cmd` or `.bat` is not an executable either: it has to go
    /// through the command interpreter.
    pub fn launch_config(&self) -> Result<AcpAgentConfig, LaunchError> {
        let resolved = which(self.command).ok_or_else(|| LaunchError::NotInstalled {
            agent: self.name.to_string(),
            command: self.command.to_string(),
        })?;

        #[cfg(windows)]
        if is_script(&resolved) {
            return Ok(AcpAgentConfig::new("cmd")
                .arg("/c")
                .arg(resolved.to_string_lossy().to_string())
                .args(self.args.iter().copied()));
        }

        Ok(AcpAgentConfig::new(resolved).args(self.args.iter().copied()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("{agent} is not installed: `{command}` is not on PATH")]
    NotInstalled { agent: String, command: String },
}

#[cfg(windows)]
fn is_script(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
}

/// Find `name` on PATH, trying the executable suffixes this platform uses.
///
/// A hand-rolled `which` rather than a dependency: it is twenty lines, and the
/// crates that do this pull in a process-inspection stack Essay has no other
/// use for.
pub fn which(name: &str) -> Option<PathBuf> {
    let direct = Path::new(name);
    if direct.is_absolute() && direct.is_file() {
        return Some(direct.to_path_buf());
    }

    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for candidate in candidates(&dir, name) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    // PATHEXT candidates only — never the bare name. Node ships an
    // extensionless `npx` (a POSIX sh script for Git Bash) beside `npx.cmd`,
    // and resolving to it hands `CreateProcess` a shell script: os error 193,
    // "%1 is not a valid Win32 application". The bare name is considered only
    // when the caller already spelled an extension (`which("claude.exe")`).
    let mut out = Vec::new();
    if Path::new(name).extension().is_some() {
        out.push(dir.join(name));
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for ext in extensions.split(';').filter(|ext| !ext.is_empty()) {
        out.push(dir.join(format!("{name}{ext}")));
    }
    out
}

#[cfg(not(windows))]
fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    vec![dir.join(name)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_is_launched_as_a_native_acp_subprocess() {
        let opencode = definition("opencode").expect("opencode is a known agent");
        assert_eq!(opencode.args, &["acp"]);
    }

    #[test]
    fn claude_code_is_launched_through_its_acp_adapter() {
        let claude = definition("claude-code").expect("claude-code is a known agent");
        assert!(claude
            .args
            .contains(&"@agentclientprotocol/claude-agent-acp"));
    }

    #[test]
    fn an_unknown_agent_id_has_no_definition() {
        assert!(definition("emacs-doctor").is_none());
    }

    #[test]
    fn listing_reports_every_known_agent_whether_or_not_it_is_installed() {
        let listed = list_agents();
        assert_eq!(listed.len(), KNOWN_AGENTS.len());
        assert!(listed.iter().any(|agent| agent.id == "opencode"));
        // The point of the flag: a missing agent is listed, not hidden, so the
        // author can see what they could install.
        assert!(listed
            .iter()
            .all(|agent| !agent.name.is_empty() && !agent.command.is_empty()));
    }

    #[test]
    fn a_command_that_cannot_be_found_is_a_launch_error_not_a_panic() {
        let missing = AgentDefinition {
            id: "nope",
            name: "Nope",
            command: "essay-agent-that-does-not-exist",
            args: &[],
            requires: &["essay-agent-that-does-not-exist"],
        };
        assert!(matches!(
            missing.launch_config(),
            Err(LaunchError::NotInstalled { .. })
        ));
    }

    /// The bug this guards against: Node ships an extensionless `npx` (a
    /// POSIX sh script) beside `npx.cmd`, and resolving to the script hands
    /// `CreateProcess` something it cannot run — os error 193 — which the
    /// author saw as "Claude Code could not start".
    #[cfg(windows)]
    #[test]
    fn resolution_never_offers_an_extensionless_file_to_createprocess() {
        let dir = Path::new("C:\\nodejs");
        let offered = candidates(dir, "npx");
        assert!(
            !offered.contains(&dir.join("npx")),
            "the bare name is a shell script on Windows, not an executable"
        );
        assert!(offered.contains(&dir.join("npx.CMD")) || offered.contains(&dir.join("npx.cmd")));

        // A caller who spells the extension has named a real file; honour it.
        assert!(candidates(dir, "claude.exe").contains(&dir.join("claude.exe")));
    }

    #[test]
    fn resolving_finds_an_executable_that_is_certainly_on_path() {
        // Every platform this ships on has one of these.
        let found = which("cmd").or_else(|| which("sh")).or_else(|| which("ls"));
        assert!(found.is_some(), "PATH resolution found nothing at all");
    }
}
