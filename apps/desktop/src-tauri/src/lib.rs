use essay_markdown::DocumentIndex;

/// Index a Markdown source: headings now; blocks, links and references as
/// the document engine grows. The index points into the source — the
/// frontend must never use it to regenerate the file.
#[tauri::command]
fn index_document(source: String) -> DocumentIndex {
  essay_markdown::index(&source)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![index_document])
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
