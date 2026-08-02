//! The agents Essay knows how to launch, and whether this machine has them.
//!
//! Everything here speaks ACP over stdio, so the registry is a table of
//! commands rather than a set of adapters. Adding an agent is adding a row.

use crate::install::{self, Adapter};
use agent_client_protocol::AcpAgentConfig;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// How to launch one agent, and how to tell whether it is installed.
pub struct AgentDefinition {
    pub id: &'static str,
    pub name: &'static str,
    /// The executable to run when there is no local adapter install to use
    /// instead. Resolved against PATH at launch time.
    pub command: &'static str,
    pub args: &'static [&'static str],
    /// Executables that must exist *besides* `command` for this agent to be
    /// usable: for an agent behind a launcher, the agent it launches, because
    /// `npx` alone proves nothing. `command` is checked separately, because a
    /// local adapter install can stand in for it.
    pub requires: &'static [&'static str],
    /// The npm-published adapter Essay pins and installs for itself, if this
    /// agent needs one. Its presence is what turns a registry round trip on
    /// every launch into `node <script>`.
    pub adapter: Option<Adapter>,
}

pub const KNOWN_AGENTS: &[AgentDefinition] = &[
    // Native ACP: no adapter, no npm fetch, works offline once installed.
    AgentDefinition {
        id: "opencode",
        name: "opencode",
        command: "opencode",
        args: &["acp"],
        requires: &[],
        adapter: None,
    },
    // Claude Code speaks ACP through an adapter published to npm. Essay keeps
    // a pinned copy under its app data directory and runs it with `node`;
    // `npx -y` is what happens before that install finishes, or on a machine
    // where it could not be done at all.
    AgentDefinition {
        id: "claude-code",
        name: "Claude Code",
        command: "npx",
        args: &["-y", "@agentclientprotocol/claude-agent-acp"],
        requires: &["claude"],
        adapter: Some(install::CLAUDE_ADAPTER),
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
            available: agent.is_available(),
        })
        .collect()
}

/// Which of the two routes to an agent produced a command line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchPath {
    /// The pinned adapter Essay installed, handed straight to `node`. No
    /// registry round trip, and it starts on a train.
    LocalAdapter,
    /// The command as published: the agent's own binary, or the launcher that
    /// fetches the adapter. Always correct, and for `npx` slow every time.
    Command,
}

/// A resolved command line, and the route that produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub path: LaunchPath,
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl LaunchPlan {
    fn into_config(self) -> AcpAgentConfig {
        AcpAgentConfig::new(self.program).args(self.args)
    }
}

impl AgentDefinition {
    /// Whether picking this agent will actually start something.
    ///
    /// The launcher is not part of the answer once Essay has installed the
    /// adapter itself: an author with a finished install and no `npx` on PATH
    /// is ready to go, and greying the row out would be a lie. The agent's own
    /// binary is always part of the answer — an adapter with nothing to adapt
    /// starts and then fails.
    pub fn is_available(&self) -> bool {
        self.is_available_in(install::adapter_root())
    }

    #[doc(hidden)]
    pub fn is_available_in(&self, adapter_root: Option<&Path>) -> bool {
        self.requires.iter().all(|name| which(name).is_some())
            && (self.local_plan(adapter_root).is_some() || which(self.command).is_some())
    }

    /// Build the launch configuration, resolving the command against PATH.
    pub fn launch_config(&self) -> Result<AcpAgentConfig, LaunchError> {
        let plan = self.launch_plan()?;
        log::info!(
            "launching {} via {:?}: {} {}",
            self.name,
            plan.path,
            plan.program.display(),
            plan.args.join(" ")
        );
        Ok(plan.into_config())
    }

    /// Decide how this agent starts: the local adapter if one is installed,
    /// otherwise the published command.
    ///
    /// Resolution is ours to do rather than the OS's. `CreateProcess` on
    /// Windows searches PATH but only ever appends `.exe`, so a launcher
    /// shipped as `npx.cmd` — which is how Node ships it — is simply not found.
    /// A resolved `.cmd` or `.bat` is not an executable either: it has to go
    /// through the command interpreter. `node.exe` needs neither, which is part
    /// of why running the adapter directly is the better path.
    pub fn launch_plan(&self) -> Result<LaunchPlan, LaunchError> {
        self.launch_plan_in(install::adapter_root())
    }

    /// The decision with the adapter directory passed in, so it can be tested
    /// against a laid-out tree instead of whatever this machine happens to
    /// have installed.
    #[doc(hidden)]
    pub fn launch_plan_in(&self, adapter_root: Option<&Path>) -> Result<LaunchPlan, LaunchError> {
        if let Some(plan) = self.local_plan(adapter_root) {
            return Ok(plan);
        }

        let resolved = which(self.command).ok_or_else(|| LaunchError::NotInstalled {
            agent: self.name.to_string(),
            command: self.command.to_string(),
        })?;

        #[cfg(windows)]
        if is_script(&resolved) {
            let mut args = vec!["/c".to_string(), resolved.to_string_lossy().into_owned()];
            args.extend(self.args.iter().map(|arg| arg.to_string()));
            return Ok(LaunchPlan {
                path: LaunchPath::Command,
                program: PathBuf::from("cmd"),
                args,
            });
        }

        Ok(LaunchPlan {
            path: LaunchPath::Command,
            program: resolved,
            args: self.args.iter().map(|arg| arg.to_string()).collect(),
        })
    }

    /// The pinned adapter, if this agent has one, Essay knows where adapters
    /// live, the install finished, and there is a `node` to run it with. Any
    /// of those missing is the fallback's job, not an error.
    fn local_plan(&self, adapter_root: Option<&Path>) -> Option<LaunchPlan> {
        let adapter = self.adapter?;
        let entry = install::installed_entry(adapter_root?, &adapter)?;
        let node = which("node")?;
        Some(LaunchPlan {
            path: LaunchPath::LocalAdapter,
            program: node,
            args: vec![entry.to_string_lossy().into_owned()],
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("{agent} is not installed: `{command}` is not on PATH")]
    NotInstalled { agent: String, command: String },
}

#[cfg(windows)]
pub(crate) fn is_script(path: &Path) -> bool {
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
            adapter: None,
        };
        assert!(matches!(
            missing.launch_config(),
            Err(LaunchError::NotInstalled { .. })
        ));
    }

    /// Lay out what a finished `npm install` of the pinned adapter leaves
    /// behind, without going near the network.
    fn install_the_pinned_adapter(root: &Path) {
        let adapter = crate::install::CLAUDE_ADAPTER;
        let package = crate::install::install_dir(root, &adapter)
            .join("node_modules")
            .join("@agentclientprotocol")
            .join("claude-agent-acp");
        std::fs::create_dir_all(package.join("dist")).unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"bin":{"claude-agent-acp":"dist/index.js"}}"#,
        )
        .unwrap();
        std::fs::write(package.join("dist/index.js"), "// adapter").unwrap();
        std::fs::write(
            crate::install::install_dir(root, &adapter).join(".essay-adapter-installed"),
            "done",
        )
        .unwrap();
    }

    #[test]
    fn a_pinned_install_is_launched_with_node_rather_than_the_launcher() {
        let root = tempfile::tempdir().unwrap();
        install_the_pinned_adapter(root.path());

        let claude = definition("claude-code").expect("claude-code is a known agent");
        let plan = claude
            .launch_plan_in(Some(root.path()))
            .expect("node and the install are both there");

        assert_eq!(plan.path, LaunchPath::LocalAdapter);
        assert!(plan
            .program
            .file_stem()
            .is_some_and(|stem| stem.eq_ignore_ascii_case("node")));
        assert_eq!(plan.args.len(), 1, "node takes the script and nothing else");
        assert!(plan.args[0].ends_with("index.js"));
        // The whole point: no registry round trip in the command line.
        assert!(!plan.args.iter().any(|arg| arg.contains("-y")));
    }

    #[test]
    fn without_an_install_the_launcher_is_used_exactly_as_before() {
        let empty = tempfile::tempdir().unwrap();
        let claude = definition("claude-code").expect("claude-code is a known agent");

        for root in [None, Some(empty.path())] {
            let plan = claude.launch_plan_in(root).expect("npx is on this machine");
            assert_eq!(plan.path, LaunchPath::Command);
            assert!(plan
                .args
                .iter()
                .any(|arg| arg == "@agentclientprotocol/claude-agent-acp"));
        }
    }

    /// The npx launcher goes through `cmd /c` on Windows; the local adapter
    /// does not, because `node.exe` is a real executable.
    #[cfg(windows)]
    #[test]
    fn only_the_launcher_needs_the_command_interpreter() {
        let root = tempfile::tempdir().unwrap();
        let claude = definition("claude-code").expect("claude-code is a known agent");

        let launcher = claude.launch_plan_in(Some(root.path())).unwrap();
        assert_eq!(launcher.program, Path::new("cmd"));
        assert_eq!(launcher.args[0], "/c");

        install_the_pinned_adapter(root.path());
        let local = claude.launch_plan_in(Some(root.path())).unwrap();
        assert_ne!(local.program, Path::new("cmd"));
    }

    /// The picker row says "not on PATH" under an agent that cannot start, so
    /// it has to mean it: a local install replaces the launcher, and nothing
    /// replaces the agent the adapter talks to.
    #[test]
    fn availability_counts_a_local_install_in_place_of_the_launcher() {
        let root = tempfile::tempdir().unwrap();
        install_the_pinned_adapter(root.path());

        let with_launcher = AgentDefinition {
            id: "fake",
            name: "Fake",
            command: "essay-launcher-that-does-not-exist",
            args: &[],
            requires: &[],
            adapter: Some(crate::install::CLAUDE_ADAPTER),
        };
        assert!(
            with_launcher.is_available_in(Some(root.path())),
            "an installed adapter does not need the launcher"
        );
        assert!(
            !with_launcher.is_available_in(None),
            "and without the install the missing launcher is the whole story"
        );

        let missing_agent = AgentDefinition {
            requires: &["essay-agent-that-does-not-exist"],
            ..with_launcher
        };
        assert!(
            !missing_agent.is_available_in(Some(root.path())),
            "an adapter with nothing to adapt is not availability"
        );
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
