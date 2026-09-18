use serde::{Deserialize, Serialize};

pub const CONFIG_FILE: &str = "config.json";
pub const WORKSPACE_FILE: &str = "workspace.json";
pub const DEFAULT_MAX_TEXT_FILE_SIZE_MB: u64 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorConfig {
    pub max_text_file_size_mb: u64,
    pub confirm_before_close_unsaved: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            max_text_file_size_mb: DEFAULT_MAX_TEXT_FILE_SIZE_MB,
            confirm_before_close_unsaved: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct TextHandlerConfig {
    pub enabled: bool,
    pub extensions: Vec<String>,
}

impl Default for TextHandlerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extensions: vec![
                ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".ini", ".log", ".csv", ".sql",
                ".py", ".js", ".ts", ".cs", ".java", ".cpp", ".html", ".css", ".bat", ".cmd", ".ps1",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct FileHandlerConfig {
    pub enabled: bool,
    pub extensions: Vec<String>,
}

impl Default for FileHandlerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extensions: Vec::new(),
        }
    }
}

fn default_spreadsheet_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".xlsx".to_string()],
    }
}

fn default_pdf_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".pdf".to_string()],
    }
}

fn default_docx_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".docx".to_string()],
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HandlerConfig {
    pub text: TextHandlerConfig,
    #[serde(default = "default_spreadsheet_handler")]
    pub spreadsheet: FileHandlerConfig,
    #[serde(default = "default_pdf_handler")]
    pub pdf: FileHandlerConfig,
    #[serde(default = "default_docx_handler")]
    pub docx: FileHandlerConfig,
}

impl Default for HandlerConfig {
    fn default() -> Self {
        Self {
            text: TextHandlerConfig::default(),
            spreadsheet: FileHandlerConfig {
                enabled: true,
                extensions: vec![".xlsx".to_string()],
            },
            pdf: FileHandlerConfig {
                enabled: true,
                extensions: vec![".pdf".to_string()],
            },
            docx: FileHandlerConfig {
                enabled: true,
                extensions: vec![".docx".to_string()],
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationConfig {
    pub enabled: bool,
    pub extension: String,
}

impl Default for AnnotationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extension: ".qnote".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceConfig {
    pub restore_last_session: bool,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            restore_last_session: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceConfig {
    pub theme: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self { theme: "light".to_string() }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellConfig {
    pub context_menu: bool,
    pub open_with: bool,
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            context_menu: true,
            open_with: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct RunnerConfig {
    pub name: String,
    pub extensions: Vec<String>,
    pub shell: String,
    pub command: String,
    pub args: Vec<String>,
}

impl Default for RunnerConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            extensions: Vec::new(),
            shell: "powershell".to_string(),
            command: String::new(),
            args: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub version: u8,
    pub editor: EditorConfig,
    pub handlers: HandlerConfig,
    pub annotations: AnnotationConfig,
    pub workspace: WorkspaceConfig,
    pub shell: ShellConfig,
    pub appearance: AppearanceConfig,
    pub runners: Vec<RunnerConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            editor: EditorConfig::default(),
            handlers: HandlerConfig::default(),
            annotations: AnnotationConfig::default(),
            workspace: WorkspaceConfig::default(),
            shell: ShellConfig::default(),
            appearance: AppearanceConfig::default(),
            runners: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceReference {
    pub name: String,
    pub path: String,
    pub expanded: bool,
}

impl Default for WorkspaceReference {
    fn default() -> Self {
        Self {
            name: String::new(),
            path: String::new(),
            expanded: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceState {
    pub version: u8,
    pub docs_files: Vec<String>,
    pub workspaces: Vec<WorkspaceReference>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: 2,
            docs_files: Vec::new(),
            workspaces: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_keeps_one_mb_text_limit() {
        let config = AppConfig::default();
        assert_eq!(config.editor.max_text_file_size_mb, 1);
        assert!(config
            .handlers
            .text
            .extensions
            .iter()
            .any(|item| item == ".md"));
    }
}
