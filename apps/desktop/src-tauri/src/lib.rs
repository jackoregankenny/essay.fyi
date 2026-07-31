use essay_markdown::DocumentIndex;

/// Index a Markdown source: headings now; blocks, links and references as
/// the document engine grows. The index points into the source — the
/// frontend must never use it to regenerate the file.
#[tauri::command]
fn index_document(source: String) -> DocumentIndex {
  essay_markdown::index(&source)
}

/// Read a manuscript from disk. File IO lives in Rust so revision capture
/// and file watching (essay-workspace, Milestone 3) can hook in here.
#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|err| format!("cannot read {path}: {err}"))
}

/// Write the serialized manuscript back to disk.
#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
  std::fs::write(&path, contents).map_err(|err| format!("cannot write {path}: {err}"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      index_document,
      read_document,
      write_document,
      list_markdown_tree
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
