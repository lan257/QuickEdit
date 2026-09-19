mod commands;
mod error;
mod models;
mod services;
mod windows;

use models::terminal::TerminalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::files::collect_launch_paths();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths: Vec<String> = args.into_iter().skip(1).filter(|item| !item.is_empty()).collect();
            use tauri::Emitter;
            let _ = app.emit("open-paths", paths);
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            commands::files::take_launch_paths,
            commands::terminal::launch_terminal,
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::files::reveal_in_explorer,
            windows::shell_integration::set_shell_integration,
            commands::config::load_config,
            commands::config::save_config,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::files::get_documents_directory,
            commands::files::get_file_metadata,
            commands::files::list_directory,
            commands::files::read_text_file,
            commands::files::save_text_file,
            commands::files::read_binary_file,
            commands::files::read_binary_range,
            commands::files::read_text_chunk,
            commands::files::save_binary_file,
            commands::files::create_folder,
            commands::files::create_document,
            commands::annotations::load_annotations,
            commands::annotations::recover_annotations,
            commands::annotations::save_annotations,
            commands::review::review_begin,
            commands::review::review_track,
            commands::review::review_capture,
            commands::review::review_get,
            commands::review::review_diff,
            commands::review::review_pending,
            commands::review::review_history,
            commands::review::review_approve,
            commands::review::review_reject,
            commands::files::rename_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
