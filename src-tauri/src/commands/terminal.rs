use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::error::{command_error, CommandResult};
use crate::models::terminal::{
    lock_terminal_state, TerminalExitEvent, TerminalOutputEvent, TerminalSession, TerminalState,
};

pub fn terminal_working_dir(cwd: Option<String>) -> CommandResult<PathBuf> {
    let working_dir = cwd
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| command_error("TERMINAL_CWD_FAILED", "无法确定 Terminal 工作目录。"))?;
    if !working_dir.is_dir() {
        return Err(command_error("TERMINAL_CWD_FAILED", "Terminal 工作目录不是有效文件夹。"));
    }
    Ok(working_dir)
}

#[tauri::command]
pub fn launch_terminal(cwd: Option<String>) -> CommandResult<()> {
    let working_dir = terminal_working_dir(cwd)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        Command::new("cmd.exe")
            .arg("/K")
            .arg("cd")
            .arg("/d")
            .arg(working_dir.as_os_str())
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|error| command_error("TERMINAL_LAUNCH_FAILED", error.to_string()))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = working_dir;
        Err(command_error("UNSUPPORTED_PLATFORM", "仅 Windows 支持外部 Terminal。"))
    }
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> CommandResult<()> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use tauri::Emitter;

    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(command_error("TERMINAL_SESSION_INVALID", "Terminal 会话标识不能为空。"));
    }
    let working_dir = terminal_working_dir(cwd)?;
    let shell_name = shell
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("powershell")
        .to_ascii_lowercase();
    let program = match shell_name.as_str() {
        "cmd" => "cmd.exe",
        _ => "powershell.exe",
    };

    {
        let mut sessions = lock_terminal_state(&state.sessions);
        if let Some(mut previous) = sessions.remove(&session_id) {
            previous.shutdown();
        }
    }

    let size = PtySize {
        rows: rows.unwrap_or(24).max(1),
        cols: cols.unwrap_or(80).max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let mut command = CommandBuilder::new(program);
    command.cwd(&working_dir);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    drop(pair.slave);

    let emit_app = app.clone();
    let emit_session_id = session_id.clone();
    std::thread::spawn(move || {
        use base64::Engine;
        use std::io::Read;
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let payload = TerminalOutputEvent {
                        session_id: emit_session_id.clone(),
                        data: base64::engine::general_purpose::STANDARD.encode(&buffer[..size]),
                    };
                    if emit_app.emit("terminal-output", payload).is_err() {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = emit_app.emit("terminal-exit", TerminalExitEvent { session_id: emit_session_id });
    });

    let mut sessions = lock_terminal_state(&state.sessions);
    sessions.insert(session_id, TerminalSession { writer, master: pair.master, killer });
    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> CommandResult<()> {
    let mut sessions = lock_terminal_state(&state.sessions);
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| command_error("TERMINAL_NOT_RUNNING", "内置终端未运行。"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| command_error("TERMINAL_WRITE_FAILED", error.to_string()))
}

#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> CommandResult<()> {
    use portable_pty::PtySize;
    let sessions = lock_terminal_state(&state.sessions);
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|error| command_error("TERMINAL_RESIZE_FAILED", error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_kill(state: tauri::State<'_, TerminalState>, session_id: String) -> CommandResult<()> {
    let mut sessions = lock_terminal_state(&state.sessions);
    if let Some(mut session) = sessions.remove(&session_id) {
        session.shutdown();
    }
    Ok(())
}
