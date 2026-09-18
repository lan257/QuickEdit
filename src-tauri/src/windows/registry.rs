use crate::error::{command_error, CommandResult};

#[cfg(windows)]
pub fn run_reg(args: &[&str]) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| command_error("REG_LAUNCH_FAILED", error.to_string()))?;
    if !output.status.success() {
        return Err(command_error(
            "REG_FAILED",
            format!("reg {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim()),
        ));
    }
    Ok(())
}
