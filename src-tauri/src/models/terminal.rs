use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct TerminalSession {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

impl TerminalSession {
    pub fn shutdown(&mut self) {
        let _ = self.killer.kill();
        let _ = self.writer.flush();
    }
}

#[derive(Default)]
pub struct TerminalState {
    pub sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

pub fn lock_terminal_state(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
) -> std::sync::MutexGuard<'_, HashMap<String, TerminalSession>> {
    sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
}
