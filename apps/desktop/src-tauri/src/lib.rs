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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      index_document,
      read_document,
      write_document
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
