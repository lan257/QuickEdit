# QuickEdit 开发文档

版本：v1.0
日期：2026-09-16
状态：与 V1 稳定版 `1.1.0` 发布代码一致
适用：参与 QuickEdit 开发/维护的工程师与 Agent

---

## 1. 技术选型与总体架构

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面外壳 | Tauri v2 | 标识 `com.quickedit.desktop`；无装饰窗口（`decorations:false`），自绘窗口控制按钮 |
| 前端 | Vite + vanilla TypeScript/HTML/CSS | 单页 `index.html` + `src/main.ts` + `src/styles.css`，无框架、无组件库 |
| 后端 | Rust（`src-tauri/src/lib.rs` 单文件） | 21 个 Tauri command，统一 `CommandResult<T>` / `CommandError` 错误模型 |
| 文本渲染 | `markdown-it`（`html:false`） | 图片转占位、链接剥离，安全降级 |
| Excel | `xlsx`（动态 import） | 仅在打开 XLSX 时加载 |
| PDF | `pdfjs-dist`（动态 import） | 连续纵向页面流，`IntersectionObserver` 懒渲染 |
| DOCX | `mammoth/mammoth.browser`（动态 import） | 只读转换渲染 |
| 剪贴板 | `@tauri-apps/plugin-clipboard-manager` | 官方插件，不用 `navigator.clipboard` |
| 对话框/外部打开/单实例 | `plugin-dialog` / `plugin-opener` / `plugin-single-instance` | 见 `src-tauri/Cargo.toml` |

数据流：

```
index.html 元素
   ↕ (DOM / 事件)
src/main.ts（UI 状态机：workspace、文档、查找替换、批注、主题、设置）
   ↕ invoke（camelCase 参数）
src-tauri/src/lib.rs（Rust command 层）
   ↕ 文件系统 / 注册表 / 进程
Windows 磁盘、%APPDATA% 配置、资源管理器 Shell
```

关键约束：

- **前端不直接碰文件系统**，一切文件读写走 Rust command。
- 配置与 Workspace 状态持久化在 `%APPDATA%\com.quickedit.desktop\`（`app_config_dir()`）。
- 本地 only：无任何网络请求。

## 2. Rust Command 清单（lib.rs）

| 命令 | 职责 |
|---|---|
| `load_config` / `save_config` | 应用配置读写（编辑器上限、处理器、外观主题等） |
| `load_workspace` / `save_workspace` | Workspace 引用持久化 |
| `get_documents_directory` | 固定"文档"分区目录 |
| `get_file_metadata` | 单文件元数据（大小、修改时间、编码探测等） |
| `list_directory` | 目录枚举；排序规则：**文件在前、文件夹在后** |
| `read_text_file` / `save_text_file` | 文本读写；UTF-8 / UTF-8 BOM / UTF-16，奇数字节 UTF-16 拒绝 |
| `read_binary_file` / `save_binary_file` | 二进制读写（XLSX 等），保存带 `expectedSize` / `expectedModifiedTime` 冲突检查 |
| `create_folder` / `create_document` | 新建文件夹/文档（写入磁盘） |
| `load_annotations` / `save_annotations` / `recover_annotations` | `.qnote` 伴生批注读写；目标失效（stale）标记与恢复 |
| `rename_document` | 重命名文件或文件夹（含 `.qnote` 伴生同步） |
| `terminal_spawn` / `terminal_write` / `terminal_resize` / `terminal_kill` | 内置 xterm 面板对应的 PTY 生命周期、输入输出与尺寸同步（见 §7） |
| `reveal_in_explorer` | 资源管理器中显示 |
| `set_shell_integration` | 资源管理器右键 / Open With 注册开关（`reg` 写注册表） |

## 3. 文件写入模型

- **原子写**：先写同目录临时文件，再 `MoveFileExW(temp, target, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`（`replace_file` / `atomic_write`）。
- **外部修改检测**：保存前比对 `expectedSize` / `expectedModifiedTime`，不一致报冲突错误，不覆盖。
- **编码**：`decode_text` / `encode_text`；UTF-8 BOM 保留不回显；UTF-16LE 往返；畸形 UTF-16（奇数字节）直接拒绝而非截断。
- **文本上限**：默认 1MB（`default_config_keeps_one_mb_text_limit` 有单测锁定）。

## 4. 批注（.qnote）

- 存储：目标文件同目录 `<原名>.qnote` JSON（`AnnotationState{path, exists, stale, document}`）。
- 关联目标：全文、文本选区、PDF 页、Excel 单元格、**Markdown 预览选区**（前端快照 `previewSelectionSnapshot`，点击批注浮层前捕获，防止面板失焦丢选区）。
- 目标失效：`annotation_target_is_stale` 判定（文件被删/重命名/内容变更），UI 标记 stale 并提供 `recover_annotations` 恢复。
- 旧版兼容：`annotation_target` 接受 legacy 字符串 target，序列化升级为对象（有单测）。
- 批注不写入原文件；原文件删除后 `.qnote` 成为孤儿（管理工具在 V2）。

## 5. 格式处理器

| 格式 | 模式 | 关键实现 |
|---|---|---|
| 文本 / Markdown / HTML 源码 | 可编辑 | `TextHandler`；Markdown 预览用当前内存内容，预览不修改原文 |
| XLSX | 可编辑（基础） | `xlsx` 动态 import；Sheet 切换、单元格编辑；二进制保存走冲突检查 |
| PDF | 只读 | `pdfjs-dist` 动态 import；**连续纵向页面流**：`.pdf-page` 宿主 + `IntersectionObserver(rootMargin:"900px 0px")` 懒渲染 canvas；滚动驱动当前页状态 |
| DOCX | 只读 | `mammoth` 动态 import 转 HTML 渲染 |

扩展名判断集中在前端处理器映射；V2 将统一为 `PreviewCapability` 抽象（见待开发文档）。

## 6. 查找 / 替换层（main.ts）

- 入口：`Ctrl+F`（查找）、`Ctrl+H`（替换模式）；Ctrl+反引号键打开/关闭内置终端面板。
- 核心函数：`findSupported`（判断当前文档是否支持查找）、`refreshFindMatches`（匹配计数）、`findNextMatch`、`replaceCurrentMatch`、`replaceAllMatches`、`openFindBar`。
- 查找栏 `#findBar`：查找/替换输入、大小写开关、状态计数、上/下一个、替换、全部替换、关闭。
- 约束：查找状态不写入原文件、不影响 dirty；PDF/DOCX/XLSX 不承诺完整替换（V2 扩展）。

## 7. 内置 Terminal（xterm + portable_pty）

- 前端使用 `@xterm/xterm` 和 `@xterm/addon-fit` 渲染终端，`TerminalSession` 管理多个会话、Shell、cwd、状态和宿主节点。
- `terminal_spawn` 创建 Rust PTY；`terminal_write` 写入键盘输入；`terminal_resize` 同步行列；`terminal_kill` 结束会话。
- Rust 端使用 `portable_pty` 启动 PowerShell 或 `cmd.exe`，通过 `terminal-output` / `terminal-exit` 事件向前端传输输出和退出状态。
- cwd 规则：Workspace 或其子文件进入 Workspace Root；固定“文档”区文件和无当前文件时进入文档/quickedit目录。
- 终端面板支持打开/关闭、Shell 切换、重启、多个会话切换和拖拽调整高度；启动失败只弹错误 Toast，不影响主窗口。
- WebView2 显示层必须保留 xterm 辅助输入框的透明/零尺寸样式，避免原生 `textarea` 作为底部黑色长条露出。
- V1 不实现 Task Runner、Build/Run 按钮、Debugger 或 Git UI；这些与内置终端本身无关，保留为 Future/V2 边界。

## 8. 交互与剪贴板

- **路径复制**：右键菜单"复制文件路径" + 点击文件元信息（`.path-copyable`）。走 `clipboard-manager:allow-write-text` 官方插件；**不要用 `navigator.clipboard`**（无用户激活时失败，CDP 自动化下必现）。
- **当前行**：文本显示"第 N 行"；Excel 显示 `Sheet!Cell`；PDF 显示当前页。
- **右键菜单**：`.menu` 宽度 100px（窄版），按钮自动换行。
- **主题**：`AppearanceConfig{theme}` 默认 `"light"`；深色/系统点击 → Toast"暂不支持，已排入 V2"，不写入 dark 配置（`requestTheme`）。

## 9. 单实例 / CLI / Shell 集成

- `plugin-single-instance`：第二个实例启动时把参数转发给首实例，`collect_launch_paths` / `take_launch_paths` 消费。
- `set_shell_integration(kind, enabled)`：通过 `reg` 写注册表实现资源管理器右键 / Open With；`windows/installer-hooks.nsh` 在安装/卸载时维护钩子。

## 10. 构建与验证流程

### 10.1 常规构建

```powershell
pnpm install
pnpm tauri dev                    # 开发运行（Vite 1420）
pnpm build                        # tsc + vite build
cargo test --manifest-path src-tauri/Cargo.toml   # 8 个单元测试
pnpm tauri build                  # release + MSI + NSIS
```

### 10.2 CDP 功能验证（真实 app，非静态推理）

1. 用独立配置启动 dev 实例（避免与已跑实例撞端口/单实例标识）：
   `pnpm tauri dev -- --config` 覆盖 `identifier`（测试标识如 `com.quickedit.v1terminal.dev`）。
2. WebView2 开启 `--remote-debugging-port=9250`，用 CDP 驱动验证。
3. **注意**：page 级 WebSocket 在 WebView2 下返回 HTTP 500，必须用 **browser 级** `Target.attachToTarget(flatten=true)`。
4. 验证脚本放 `.dsh/scratch/sessions/<session>/working/`，产物目录用 `CARGO_TARGET_DIR` 隔离（如 `target-v1stable` / `target-v1release`）。

### 10.3 release 验收要点

- 内置终端验收：验证面板打开、xterm 辅助输入框计算样式为透明且零尺寸、PowerShell/cmd PTY 启动和输出事件、Shell 切换、重启/关闭及 cwd；WebView2 CDP 使用 browser 级 `Target.attachToTarget(flatten=true)`。
- 剪贴板：核对系统剪贴板实际内容与 Toast。
- 格式回归：PDF/XLSX/DOCX/Markdown 全量打开-编辑-保存链路。

## 11. 已知坑（勿重踩）

| 坑 | 原因 | 对策 |
|---|---|---|
| Vite watcher `EBUSY`（`设计文档/*.md` 被占用） | 外部进程锁定设计文档 | `vite.config.ts` watcher `ignore`：`**/src-tauri/**`、`**/.dsh/**`、`**/target/**`、`**/设计文档/**` |
| 内置终端底部出现黑色长条 | WebView2 未应用 xterm 辅助 textarea 样式 | 作用域样式保持透明/零尺寸并保留焦点；同时检查 xterm viewport 尺寸 |
| `navigator.clipboard` 复制失败 | 需要 user activation，CDP 下必现 | 官方 clipboard-manager 插件 |
| 预览选区点批注浮层丢失 | 面板点击导致失焦 | `selectionchange` 时快照选区 |
| 双 dev 实例端口/单实例冲突 | 都占 1420 + 同 identifier | `--config` 覆盖 identifier；先停旧实例 |
| invoke 参数大小写 | Tauri v2 前端传 camelCase | 如 `targetPath`、`expectedSize`、`parentPath` |

## 12. 开发约定

- 临时/测试产物一律放 `.dsh/scratch/sessions/<session>/…`，不进版本库、不放项目根。
- 不直接删除文件；需要删除走回收站。
- 文件在前、文件夹在后的列表排序是既定行为（`list_directory`），回归时不要"顺手改回"。
- 新增 Tauri command：沿用 `CommandResult<T>` + 错误码字符串模型，camelCase 参数命名。
- 前端大依赖（xlsx/pdfjs/mammoth）保持动态 import，控制首屏。
- 版本相关文档：大版本进文件名（`_v1.md`），小版本写文件内容（`版本：vX.Y`）。
