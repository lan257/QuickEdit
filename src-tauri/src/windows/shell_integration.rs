use crate::error::{command_error, CommandResult};
use crate::windows::registry::run_reg;

#[tauri::command]
pub fn set_shell_integration(kind: String, enabled: bool) -> CommandResult<()> {
    let exe = std::env::current_exe()
        .map_err(|error| command_error("EXE_PATH_FAILED", error.to_string()))?;
    let exe_str = exe.to_string_lossy().into_owned();
    let open_command = format!("\"{exe_str}\" \"%1\"");

    #[cfg(windows)]
    match kind.as_str() {
        "contextMenu" => {
            if enabled {
                for key in [
                    r"Software\Classes\*\shell\QuickEdit",
                    r"Software\Classes\Directory\shell\QuickEdit",
                ] {
                    run_reg(&["add", &format!("HKCU\\{key}"), "/v", "MUIVerb", "/t", "REG_SZ", "/d", "Open with QuickEdit", "/f"])?;
                    run_reg(&["add", &format!("HKCU\\{key}"), "/v", "Icon", "/t", "REG_SZ", "/d", &exe_str, "/f"])?;
                    run_reg(&["add", &format!("HKCU\\{key}\\command"), "/ve", "/t", "REG_SZ", "/d", &open_command, "/f"])?;
                }
            } else {
                for key in [
                    r"Software\Classes\*\shell\QuickEdit",
                    r"Software\Classes\Directory\shell\QuickEdit",
                ] {
                    let _ = run_reg(&["delete", &format!("HKCU\\{key}"), "/f"]);
                }
            }
        }
        "openWith" => {
            if enabled {
                run_reg(&["add", r"HKCU\Software\Classes\Applications\quickedit.exe", "/ve", "/t", "REG_SZ", "/d", "QuickEdit", "/f"])?;
                run_reg(&["add", r"HKCU\Software\Classes\Applications\quickedit.exe\shell\open\command", "/ve", "/t", "REG_SZ", "/d", &open_command, "/f"])?;
            } else {
                let _ = run_reg(&["delete", r"HKCU\Software\Classes\Applications\quickedit.exe", "/f"]);
            }
        }
        _ => return Err(command_error("INVALID_KIND", "未知的 Shell 集成类型。")),
    }
    #[cfg(not(windows))]
    let _ = (exe_str, open_command);
    Ok(())
}
