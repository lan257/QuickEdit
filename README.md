# QuickEdit

QuickEdit 是一个 Windows 优先、轻量、本地文件编辑与阅读工作区：在单个窗口内管理 Workspace 文件夹、编辑文本与 Markdown、编辑 Excel、阅读 PDF/DOCX，并支持伴随式批注、文档内查找/替换和外部终端拉起。

- 当前版本：`0.1.0`（V1 稳定版候选；`1.0.0` 定版待确认）
- 技术栈：Tauri v2 + Vite + vanilla TypeScript/HTML/CSS + Rust
- 应用标识：`com.quickedit.desktop`
- 纯本地文件操作，无网络功能；所有文件系统读写统一经过 Rust command 层

## 功能概览（V1 稳定版）

| 类别 | 能力 |
|---|---|
| Workspace | 打开文件夹只读元数据，选中文件才加载正文；搜索过滤；从列表移除不删除磁盘文件 |
| 文本 / Markdown | UTF-8 / UTF-8 BOM / UTF-16，默认 1MB 上限，编辑、保存、外部修改检测；Markdown 编辑/预览双模式（预览不修改原文） |
| Excel (XLSX) | Sheet 切换、基础单元格编辑与保存 |
| PDF / DOCX | 只读阅读，支持批注 |
| 批注 | 保存为原文件同目录伴生 `.qnote` 文件，不写入原文件；支持全文、文本选区、PDF 页、Excel 单元格、Markdown 预览选区 |
| 查找 / 替换 | `Ctrl+F` 查找、`Ctrl+H` 替换；上一个/下一个、匹配大小写、单次/全部替换；不影响文档 dirty 状态 |
| 状态栏 | 当前行号（文本）、当前单元格（Excel `Sheet!Cell`）、当前页（PDF） |
| Terminal | `Ctrl+`` 或右键菜单拉起外部 `cmd.exe`（独立控制台窗口）；cwd 规则：Workspace 根目录 / 单文件所在目录 / 用户主目录 |
| 交互 | 右键"复制文件路径"或点击文件元信息复制完整路径；`F2` 重命名文件或文件夹 |
| 设置 | 分组设置弹窗（卡片布局、单滚动区、底部操作固定）；浅色主题持久化；深色主题点击提示"暂不支持，已排入 V2" |
| Windows 集成 | 单实例 + 命令行参数转发、资源管理器右键 / Open With 注册（安装钩子） |

## 目录结构

```
queryedit/
├── index.html              # 主界面单页
├── src/
│   ├── main.ts             # 全部 UI / 状态逻辑（查找替换层、批注、主题、终端拉起）
│   ├── styles.css          # 样式（查找栏、菜单、设置卡片、批注浮层等）
│   └── QuickEdit_Config_Help.md   # 应用内只读帮助（markdown-it 渲染）
├── src-tauri/
│   ├── src/lib.rs          # Rust command 层（21 个命令、原子写、编码、Shell 集成）
│   ├── tauri.conf.json     # 应用配置（标识、窗口、打包、NSIS 钩子）
│   ├── capabilities/default.json  # 权限（窗口 + 剪贴板写文本）
│   └── windows/installer-hooks.nsh # 安装/卸载 Shell 注册钩子
├── docs/                   # 执行与计划文档
├── 设计文档/                # 需求规格、设计、HTML Terminal 设计、Markdown 扩展设计
└── .dsh/scratch/           # 会话临时产物（不纳入版本管理）
```

## 开发

前置条件：Node.js + pnpm、Rust（`cargo`）。若终端提示 `cargo: program not found`，将 `%USERPROFILE%\.cargo\bin` 加入 PATH（cmd 下：`set PATH=%PATH%;C:\Users\29812\.cargo\bin`；PowerShell 下：`$env:PATH += ";C:\Users\29812\.cargo\bin"`）。

```powershell
pnpm install
pnpm tauri dev     # 开发运行（Vite 端口 1420）

# 前端单独构建 / 类型检查
pnpm build

# Rust 单元测试（6 个用例：编码、路径、默认配置、旧版 .qnote 兼容）
cargo test --manifest-path src-tauri/Cargo.toml
```

## 发布打包

```powershell
pnpm tauri build
# 产物：src-tauri/target/release/bundle/msi/QuickEdit_<ver>_x64_en-US.msi
#       src-tauri/target/release/bundle/nsis/QuickEdit_<ver>_x64-setup.exe
```

安装包包含 NSIS 安装/卸载 Shell 注册钩子（资源管理器右键 / Open With）。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/QuickEdit_Development_v1.md` | 开发文档：架构、命令清单、关键实现、构建与验证流程、已知坑 |
| `docs/QuickEdit_Undeveloped_v2.md` | 待开发文档：v2.0+ backlog（基于 2026-09-17 三份设计文档，旧 `_v1` 版已废弃） |
| `docs/QuickEdit_V1_Stable_V2_Plan_v1.md` | V1 稳定版实施计划与 V2 排期（v1.2，V2 明细以设计文档与待开发文档为准） |
| `docs/QuickEdit_Execution_Roadmap_v1.md` | P0–P5 执行路线图（v1.15） |
| `src/QuickEdit_Config_Help.md` | 应用内只读帮助（Logo 菜单 → 帮助） |
| `设计文档/QuickEdit_Requirements_Specification.md` | 需求规格 |
| `设计文档/QuickEdit_Design_Document.md` | 设计文档 |
| `设计文档/QuickEdit_HTML_Terminal_Requirements_Design.md` | HTML/Terminal 需求设计（V2 参考） |
| `设计文档/QuickEdit_Post_Markdown_Requirements_Design.md` | Markdown 后需求设计 |
| `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md` | v2.0+ 需求设计与演进规划（Draft） |
| `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md` | Annotation V2 需求设计（Draft） |
| `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md` | Agent Change Review & MCP 需求设计（Draft） |

## 版本状态

- `0.1.0`：V1 稳定版候选（功能完成、候选 MSI/NSIS 已生成、回归验证中）
- `1.0.0`：定版（待版本号确认后重新打包 + 版本说明 + Git 基线标签）
- v2.0+ 内容见 `docs/QuickEdit_Undeveloped_v2.md`
