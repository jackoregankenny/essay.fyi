use essay_agents::{
  AcceptOutcome, AgentEvent, AgentHost, AgentInfo, ChangeSet, HostObserver, PermissionDecision,
  PermissionRequest, SessionSummary,
};
use essay_markdown::DocumentIndex;
use essay_revisions::{Revision, RevisionAuthor, RevisionOrigin};
use essay_workspace::{
  DocumentPayload, DocumentWatcher, ExternalChange, JournalEntry, RecoveryStore, SnapshotStore,
  WriteOutcome,
};
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Everything durable about the open document: who is watching it, where
/// unsaved buffers are journalled, and whose name goes on a revision.
struct Workspace {
  watcher: DocumentWatcher,
  recovery: RecoveryStore,
  author: RevisionAuthor,
}

/// The ACP host, and through it every running agent and the review queue.
struct Agents {
  host: Arc<AgentHost>,
  /// Sessions that have already been sent their skills. The agent keeps them
  /// in context for the rest of the session, so repeating them every turn
  /// would spend the author's subscription to say something already said.
  primed: std::sync::Mutex<std::collections::HashSet<String>>,
}

/// Event carrying an edit Essay did not make. The change is already in the
/// sidecar by the time this reaches the WebView.
const EXTERNAL_CHANGE: &str = "essay://external-change";

/// One thing that happened in an agent session — a message chunk, a thought,
/// a tool call, the end of a turn. Tagged by `kind`.
const AGENT_EVENT: &str = "essay://agent-event";

/// An agent has proposed an edit and it is waiting on the author.
const CHANGE_SET: &str = "essay://change-set";

/// An agent is blocked on a decision only the author can make.
const PERMISSION_REQUEST: &str = "essay://permission-request";

/// Index a Markdown source: headings now; blocks, links and references as
/// the document engine grows. The index points into the source — the
/// frontend must never use it to regenerate the file.
#[tauri::command]
fn index_document(source: String) -> DocumentIndex {
  essay_markdown::index(&source)
}

/// Read a manuscript from disk, snapshot it, and start watching it.
///
/// The returned hash is the document's identity for the rest of its time
/// open: the editor hands it back on save so Essay can tell whether the file
/// is still the one it read.
#[tauri::command]
fn read_document(
  path: String,
  workspace: tauri::State<'_, Workspace>,
) -> Result<DocumentPayload, String> {
  let file = Path::new(&path);
  let payload = essay_workspace::read_document(file).map_err(|err| err.to_string())?;

  // A file whose history already exists but whose bytes have moved on changed
  // while Essay was not running — that is an external edit, not an import.
  if let Some(store) = open_store(file) {
    let origin = match store.latest() {
      Ok(Some(_)) => RevisionOrigin::ExternalEdit,
      _ => RevisionOrigin::Import,
    };
    // Whoever last wrote this file, it was not this session.
    log_sidecar_error(store.snapshot(&payload.contents, origin, RevisionAuthor::Unknown, None));
  }

  if let Err(err) = workspace.watcher.watch(file, payload.hash.clone()) {
    log::warn!("cannot watch {path}: {err}");
  }
  Ok(payload)
}

/// Write the serialized manuscript back to disk, refusing to overwrite an
/// edit that arrived since the editor last read the file.
///
/// `base_hash` is what the editor believes is on disk; `None` means a first
/// save or a Save As, where the native dialog already settled the question.
#[tauri::command]
fn write_document(
  path: String,
  contents: String,
  base_hash: Option<String>,
  workspace: tauri::State<'_, Workspace>,
) -> Result<WriteOutcome, String> {
  let file = Path::new(&path);

  // Announce the write before making it: the watcher can see the file land
  // the instant the rename completes, and Essay must not report its own save
  // back to the author as somebody else's edit.
  workspace
    .watcher
    .expect(essay_workspace::hash_source(&contents));

  let outcome = essay_workspace::write_document(file, &contents, base_hash.as_deref())
    .map_err(|err| err.to_string())?;

  if let WriteOutcome::Written { hash } = &outcome {
    if let Some(store) = open_store(file) {
      log_sidecar_error(store.snapshot(
        &contents,
        RevisionOrigin::HumanSession,
        workspace.author.clone(),
        None,
      ));
    }
    // The buffer reached disk, so there is nothing left to recover.
    let _ = workspace.recovery.clear(&path);
    // A Save As points the watch at the new file.
    if workspace.watcher.watching().as_deref() != Some(file) {
      let _ = workspace.watcher.watch(file, hash.clone());
    }
  }
  Ok(outcome)
}

/// Record the in-progress buffer outside the document tree, so a crash costs
/// nothing. Called on a short debounce while typing — well ahead of autosave,
/// and the only protection an untitled buffer has at all.
#[tauri::command]
fn journal_buffer(
  key: String,
  name: String,
  path: Option<String>,
  contents: String,
  base_hash: Option<String>,
  workspace: tauri::State<'_, Workspace>,
) -> Result<(), String> {
  workspace
    .recovery
    .record(
      &key,
      &name,
      path.as_deref(),
      &contents,
      base_hash.as_deref(),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn clear_journal(key: String, workspace: tauri::State<'_, Workspace>) -> Result<(), String> {
  workspace.recovery.clear(&key).map_err(|err| err.to_string())
}

/// Buffers from a previous run that hold something their file does not.
#[tauri::command]
fn pending_recovery(
  workspace: tauri::State<'_, Workspace>,
) -> Result<Vec<JournalEntry>, String> {
  workspace.recovery.pending().map_err(|err| err.to_string())
}

/// Compare two versions of a manuscript for the review surface.
///
/// Pure and cheap, so it can be called straight off a notice bar. Keeping it
/// in Rust keeps `essay-diff` the only place a diff is computed — the panel,
/// the CLI and any future agent surface can never disagree about what changed.
#[tauri::command]
fn diff_documents(old: String, new: String) -> essay_diff::DocumentDiff {
  essay_diff::diff_documents(&old, &new)
}

/// The document's editorial history, newest first.
#[tauri::command]
fn list_revisions(path: String, limit: usize) -> Result<Vec<Revision>, String> {
  let store = SnapshotStore::for_document(Path::new(&path)).map_err(|err| err.to_string())?;
  store.revisions(limit).map_err(|err| err.to_string())
}

/// The full Markdown behind a revision's content hash, for diffing and
/// restoring.
#[tauri::command]
fn revision_source(path: String, hash: String) -> Result<Option<String>, String> {
  let store = SnapshotStore::for_document(Path::new(&path)).map_err(|err| err.to_string())?;
  store.source(&hash).map_err(|err| err.to_string())
}

/// Stop watching — the document was closed, or replaced by an untitled buffer.
#[tauri::command]
fn close_document(workspace: tauri::State<'_, Workspace>) {
  workspace.watcher.stop();
}

/// The sidecar is a convenience, never a precondition. A document on a
/// read-only volume still opens, saves and prints; it just has no history.
fn open_store(document: &Path) -> Option<SnapshotStore> {
  match SnapshotStore::for_document(document) {
    Ok(store) => Some(store),
    Err(err) => {
      log::warn!("no sidecar for {}: {err}", document.display());
      None
    }
  }
}

fn log_sidecar_error<T>(result: essay_workspace::Result<T>) {
  if let Err(err) = result {
    log::warn!("cannot record revision: {err}");
  }
}

/// Local-first: there is no account to ask, so a revision is attributed to
/// whoever is at the keyboard according to the OS.
fn local_author() -> RevisionAuthor {
  let name = std::env::var("USERNAME")
    .or_else(|_| std::env::var("USER"))
    .ok()
    .filter(|name| !name.trim().is_empty())
    .unwrap_or_else(|| "you".to_string());
  RevisionAuthor::Human { name }
}

#[derive(serde::Serialize)]
pub struct RenderedDocument {
  pages: Vec<String>,
  warnings: Vec<String>,
}

/// Typeset the manuscript to SVG pages for the live print preview. Runs on
/// a blocking thread — typing and navigation never wait on this (the
/// frontend debounces and drops stale results).
#[tauri::command]
async fn render_document(
  source: String,
  root: Option<String>,
) -> Result<RenderedDocument, String> {
  tauri::async_runtime::spawn_blocking(move || {
    essay_render::render_svg_pages(&source, root.map(Into::into))
      .map(|pages| RenderedDocument { pages: pages.svgs, warnings: pages.warnings })
      .map_err(|err| err.to_string())
  })
  .await
  .map_err(|err| err.to_string())?
}

/// Typeset the manuscript to a finished PDF at `path`.
#[tauri::command]
async fn export_pdf(
  source: String,
  root: Option<String>,
  path: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes =
      essay_render::render_pdf(&source, root.map(Into::into)).map_err(|err| err.to_string())?;
    std::fs::write(&path, bytes).map_err(|err| format!("cannot write {path}: {err}"))
  })
  .await
  .map_err(|err| err.to_string())?
}

/// List one workspace folder's Markdown contents as root-relative paths for
/// the explorer tree: directories end with '/', files are .md/.markdown.
/// Hidden entries and heavy build directories are skipped. Moves to
/// essay-workspace once file watching lands (Milestone 3).
#[tauri::command]
fn list_markdown_tree(root: String) -> Result<Vec<String>, String> {
  let root_path = std::path::PathBuf::from(&root);
  if !root_path.is_dir() {
    return Err(format!("not a directory: {root}"));
  }
  let mut paths = Vec::new();
  walk_markdown(&root_path, &root_path, &mut paths, 0);
  Ok(paths)
}

const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out"];
const MAX_DEPTH: u8 = 12;

fn walk_markdown(
  root: &std::path::Path,
  dir: &std::path::Path,
  out: &mut Vec<String>,
  depth: u8,
) {
  if depth > MAX_DEPTH {
    return;
  }
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') {
      continue;
    }
    let Ok(file_type) = entry.file_type() else {
      continue;
    };
    let path = entry.path();
    if file_type.is_dir() {
      if SKIPPED_DIRS.contains(&name.as_str()) {
        continue;
      }
      if let Some(rel) = relative_path(root, &path) {
        out.push(format!("{rel}/"));
      }
      walk_markdown(root, &path, out, depth + 1);
    } else {
      let lower = name.to_lowercase();
      if lower.ends_with(".md") || lower.ends_with(".markdown") {
        if let Some(rel) = relative_path(root, &path) {
          out.push(rel);
        }
      }
    }
  }
}

fn relative_path(root: &std::path::Path, path: &std::path::Path) -> Option<String> {
  path
    .strip_prefix(root)
    .ok()
    .map(|p| p.to_string_lossy().replace('\\', "/"))
}

// ---------------------------------------------------------------------------
// Agents
//
// The host runs the protocol; these commands are the app's half of it. Nothing
// here decides anything — an agent's edit becomes a change set, and the author
// answers with accept or reject. That is the whole shape of the feature.
// ---------------------------------------------------------------------------

/// Forwards the host's three kinds of news to the WebView.
struct AppObserver {
  handle: tauri::AppHandle,
}

impl AppObserver {
  fn send(&self, event: &str, payload: impl serde::Serialize + Clone) {
    if let Err(err) = self.handle.emit(event, payload) {
      log::warn!("cannot deliver {event}: {err}");
    }
  }
}

impl HostObserver for AppObserver {
  fn agent_event(&self, event: AgentEvent) {
    self.send(AGENT_EVENT, event);
  }

  fn change_set(&self, change: &ChangeSet) {
    self.send(CHANGE_SET, change.clone());
  }

  fn permission_request(&self, request: &PermissionRequest) {
    self.send(PERMISSION_REQUEST, request.clone());
  }
}

/// Every agent Essay can host, and whether this machine has it. Probed on each
/// call, so installing one while Essay is open makes it selectable.
#[tauri::command]
fn list_agents() -> Vec<AgentInfo> {
  essay_agents::list_agents()
}

/// Launch an agent and open a session against the document on screen.
///
/// Resolves only once the agent has answered the ACP handshake, so a missing
/// binary or a failed start is an error on the button the author pressed.
#[tauri::command]
async fn start_agent_session(
  agent_id: String,
  document_path: String,
  agents: tauri::State<'_, Agents>,
) -> Result<SessionSummary, String> {
  agents
    .host
    .start_session(&agent_id, Path::new(&document_path))
    .await
    .map_err(|err| err.to_string())
}

/// Send the author's instruction. Returns as soon as the turn is queued —
/// everything the agent says comes back on `essay://agent-event`.
#[tauri::command]
fn send_agent_prompt(
  session_id: String,
  prompt: String,
  skill_ids: Vec<String>,
  agents: tauri::State<'_, Agents>,
) -> Result<(), String> {
  let text = compose_session_prompt(&session_id, &prompt, &skill_ids, &agents);
  agents
    .host
    .prompt(&session_id, text)
    .map_err(|err| err.to_string())
}

/// Exactly what the agent will be sent for this turn.
///
/// Exposed as its own command so the panel can show it. Quietly prefixing
/// someone's words with instructions they cannot read would be the intrusive
/// version of this feature; the preamble is theirs to inspect, and it is spent
/// from their subscription.
#[tauri::command]
fn preview_agent_prompt(
  session_id: String,
  prompt: String,
  skill_ids: Vec<String>,
  agents: tauri::State<'_, Agents>,
) -> String {
  compose_session_prompt(&session_id, &prompt, &skill_ids, &agents)
}

fn compose_session_prompt(
  session_id: &str,
  prompt: &str,
  skill_ids: &[String],
  agents: &Agents,
) -> String {
  let first_turn = !agents.primed.lock().unwrap().contains(session_id);
  let document = agents
    .host
    .sessions()
    .into_iter()
    .find(|session| session.session_id == session_id)
    .map(|session| session.document);

  let skills = match &document {
    Some(path) => selected_skills(Path::new(path), skill_ids),
    // No document to read preferences beside, but the agent still needs to
    // be told where it is.
    None => vec![essay_agents::house_skill()],
  };

  let text = essay_agents::compose_prompt(&skills, prompt, first_turn);
  if first_turn {
    agents
      .primed
      .lock()
      .unwrap()
      .insert(session_id.to_string());
  }
  text
}

/// The house skill plus whichever preferences the author has switched on.
/// The house skill is not optional — it is what tells the agent this is a
/// manuscript rather than a codebase.
fn selected_skills(document: &Path, skill_ids: &[String]) -> Vec<essay_agents::Skill> {
  essay_agents::load_skills(document)
    .into_iter()
    .filter(|skill| skill.built_in || skill_ids.contains(&skill.id))
    .collect()
}

/// Skills available for a document: the built-in one, then anything in
/// `.essay/skills/`.
#[tauri::command]
fn list_skills(document_path: String) -> Vec<essay_agents::Skill> {
  essay_agents::load_skills(Path::new(&document_path))
}

/// The knobs the agent exposes on a session — mode, model, whatever else —
/// with their current values. How a reattaching panel finds out what it can
/// tune; changes stream in on `essay://agent-event` as `options`.
#[tauri::command]
fn agent_session_options(
  session_id: String,
  agents: tauri::State<'_, Agents>,
) -> Vec<essay_agents::SessionOption> {
  agents.host.options(&session_id)
}

/// Change one of the agent's knobs. The new state comes back as an `options`
/// event rather than a return value — agents also change these on their own,
/// and the panel needs one source of truth for both.
#[tauri::command]
fn set_agent_session_option(
  session_id: String,
  option_id: String,
  value: String,
  agents: tauri::State<'_, Agents>,
) -> Result<(), String> {
  agents
    .host
    .set_option(&session_id, option_id, value)
    .map_err(|err| err.to_string())
}

/// Interrupt the turn in progress. The session stays open; the agent confirms
/// by ending the turn with `cancelled`.
#[tauri::command]
fn cancel_agent_turn(
  session_id: String,
  agents: tauri::State<'_, Agents>,
) -> Result<(), String> {
  agents
    .host
    .cancel(&session_id)
    .map_err(|err| err.to_string())
}

/// End a session and the subprocess with it.
#[tauri::command]
fn stop_agent_session(
  session_id: String,
  agents: tauri::State<'_, Agents>,
) -> Result<(), String> {
  agents.host.stop(&session_id).map_err(|err| err.to_string())
}

#[tauri::command]
fn list_agent_sessions(agents: tauri::State<'_, Agents>) -> Vec<SessionSummary> {
  agents.host.sessions()
}

/// The review queue, oldest first — including everything already settled, so
/// the panel can show what was accepted as well as what is waiting.
#[tauri::command]
fn list_change_sets(agents: tauri::State<'_, Agents>) -> Vec<ChangeSet> {
  agents.host.changes().list()
}

/// Apply a proposal to the manuscript.
///
/// Goes through the same hash-guarded write as the editor's own save, so a
/// proposal composed against a document that has since moved comes back as a
/// conflict rather than overwriting what arrived. The watcher is told first,
/// or it would report this write back as somebody else's edit.
#[tauri::command]
fn accept_change_set(
  id: String,
  agents: tauri::State<'_, Agents>,
  workspace: tauri::State<'_, Workspace>,
) -> Result<AcceptOutcome, String> {
  let agent = agents
    .host
    .changes()
    .get(&id)
    .map(|change| change.provenance.agent)
    .unwrap_or_else(|| "agent".to_string());

  agents
    .host
    .changes()
    .accept(&id, &agent, |hash| {
      workspace.watcher.expect(hash.to_string());
    })
    .map_err(|err| err.to_string())
}

/// Decline a proposal. The file is untouched either way; this is what removes
/// it from the queue and stops it shadowing the file for the agent.
#[tauri::command]
fn reject_change_set(
  id: String,
  agents: tauri::State<'_, Agents>,
) -> Result<ChangeSet, String> {
  agents
    .host
    .changes()
    .reject(&id)
    .map_err(|err| err.to_string())
}

/// The author's answer to `essay://permission-request`. The ACP request has
/// been held open on the wire since it was asked.
#[tauri::command]
fn respond_to_permission(
  request_id: String,
  outcome: PermissionDecision,
  agents: tauri::State<'_, Agents>,
) -> Result<(), String> {
  agents.host.permissions().resolve(&request_id, outcome)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      index_document,
      read_document,
      write_document,
      close_document,
      journal_buffer,
      clear_journal,
      pending_recovery,
      diff_documents,
      list_revisions,
      revision_source,
      list_markdown_tree,
      render_document,
      export_pdf,
      list_agents,
      start_agent_session,
      send_agent_prompt,
      preview_agent_prompt,
      list_skills,
      agent_session_options,
      set_agent_session_option,
      cancel_agent_turn,
      stop_agent_session,
      list_agent_sessions,
      list_change_sets,
      accept_change_set,
      reject_change_set,
      respond_to_permission
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let host = Arc::new(AgentHost::new(Arc::new(AppObserver {
        handle: app.handle().clone(),
      })));

      // An edit from anywhere else — an agent, a terminal, another editor —
      // is snapshotted before the author is told about it, so the decision
      // about what to do with it is never a decision about losing it.
      let handle = app.handle().clone();
      let watching_host = Arc::clone(&host);
      let watcher = DocumentWatcher::new(move |change: ExternalChange| {
        // Not every agent honours the protocol's filesystem capability —
        // opencode 1.17.8 writes the file itself, verified against the binary.
        // Those edits arrive here rather than as change sets, and the least
        // Essay can do is name the agent that was running at the time instead
        // of filing the edit under `Unknown`. Circumstantial attribution, and
        // marked as such by the origin being the same `AgentPatch` an accepted
        // proposal gets: something an agent did, to this document, now.
        let attribution = watching_host
          .session_for(Path::new(&change.path))
          .and_then(|session| watching_host.attribution(&session));

        if let Ok(store) = SnapshotStore::for_document(Path::new(&change.path)) {
          let (origin, author, instruction) = match &attribution {
            Some(provenance) => (
              RevisionOrigin::AgentPatch,
              RevisionAuthor::Agent {
                name: provenance.agent.clone(),
              },
              Some(provenance.prompt_excerpt.clone())
                .filter(|excerpt| !excerpt.trim().is_empty()),
            ),
            None => (RevisionOrigin::ExternalEdit, RevisionAuthor::Unknown, None),
          };
          log_sidecar_error(store.snapshot(&change.contents, origin, author, instruction));
        }
        if let Err(err) = handle.emit(EXTERNAL_CHANGE, change) {
          log::warn!("cannot report external change: {err}");
        }
      });

      // Recovery state is about this installation's unsaved buffers, not
      // about any one document, so it lives here rather than in `.essay/`.
      let recovery = RecoveryStore::open(&app.path().app_data_dir()?)?;

      app.manage(Workspace {
        watcher,
        recovery,
        author: local_author(),
      });
      app.manage(Agents {
        host,
        primed: Default::default(),
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
