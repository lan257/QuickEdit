# QuickEdit

QuickEdit 是一个 **Windows 优先、轻量、本地、快速的文件编辑与阅读工作区**。

它不是为了替代完整的 WPS、Microsoft Office 或 VS Code，而是为“打开本地文件、快速查看、简单编辑、批注和保存”这类高频任务提供更轻、更快、更集中的入口。

<p align="center">
  <a href="https://github.com/lan257/QuickEdit/releases">
    <img src="https://img.shields.io/badge/QuickEdit-v2.1.0-5b6cf9" alt="QuickEdit v2.1.0" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-0078d4" alt="Windows" />
  <img src="https://img.shields.io/badge/license-private-lightgrey" alt="Private project" />
</p>

## 界面预览

<p align="center">
  <img src="docs/images/quickedit-editor.png" alt="QuickEdit Markdown 预览界面" width="48%" />
  <img src="docs/images/quickedit-terminal.png" alt="QuickEdit 内置终端界面" width="48%" />
</p>

> 展示图来自当前 `2.1.0` 代码，已对本机文件路径做脱敏处理。

## 为什么需要 QuickEdit

在日常使用 WPS、VS Code 等工具时，从零启动应用并打开一个 Excel、DOCX、PDF 或 Markdown 文档，通常需要等待较长时间才能进入正常的编辑或阅读状态。

QuickEdit 的核心目标，就是降低这类高频操作的启动成本：

- **从零打开**：在开发者本机的实际使用体验中，打开 Excel、DOCX、PDF、Markdown 等文件，通常不超过 5 秒即可进入编辑或渲染状态；
- **连续打开**：QuickEdit 已启动时，继续打开新的文档通常不到 1 秒；
- **按需加载**：先加载工作区和文件元数据，选中文件后才加载正文或对应解析器；
- **低干扰工作流**：不需要为了查看一个文件启动一整套重量级应用。

> 以上时间是当前开发者本机的实际体验描述，不是对所有电脑、文件大小和文件复杂度的统一性能承诺。实际耗时会受到硬件、文件结构和解析复杂度影响。

## 产品定位

QuickEdit 可以概括为：

> **一个面向 Windows 的本地资料工作台，用于快速查看、定位、批注、编辑和保存文件。**

它更适合以下场景：

- 管理包含文档、脚本、笔记、表格和资料的本地 Workspace；
- 快速浏览和筛选文件，而不是启动完整办公套件；
- 对文本和 Markdown 进行高频小规模编辑；
- 快速查看或修改 XLSX 表格；
- 阅读 PDF 和 DOCX，并在文件旁保存批注；
- 在同一个窗口内完成文件管理、查找替换、阅读、编辑和终端调用。

QuickEdit 更像是“本地文件工作台”，而不是传统意义上的办公软件、写作软件或开发 IDE。它关注的是：**让本地文件更快被打开、更快被理解，也更快被处理。**

## 核心设计原则

### 本地优先

文件直接在本机处理，不依赖云端同步、在线账号或网络服务。文件系统读写统一经过 Rust command 层，尽量保证操作路径清晰、稳定、可控。

### 轻量快速

性能重点不是盲目追求复杂解析的极限速度，而是避免不必要的工作：

- 启动时不解析文档正文；
- 打开工作区时优先读取文件元数据；
- 选中文件后才加载对应内容；
- Excel、PDF、DOCX 等解析能力按需启用；
- 大目录采用异步枚举和懒加载思路。

核心原则是：

> **宁可多次短等待，也不允许一次长时间冻结。**

### 简单、可靠、低侵入

QuickEdit 不直接把批注写入原文件，而是使用同目录伴生的 `.qnote` 文件保存批注；保存时关注外部修改检测、原子写入和文件内容安全，尽量不破坏用户原有文件。

## 主要能力

### Workspace / 文件管理

- 打开本地工作目录或单个文档；
- 只读取文件元数据构建工作区，选中文件后再加载正文；
- 搜索、过滤和排序文件列表；
- 从列表移除文件但不删除磁盘文件；
- 使用 `F2` 重命名文件或文件夹；
- 复制完整文件路径；
- 查看文件夹位置、时间和文件数量。

### 文本与 Markdown

- 支持 UTF-8、UTF-8 BOM、UTF-16；
- 文本编辑、保存和外部修改检测；
- Markdown 编辑与预览双模式；
- 预览不会修改原始 Markdown 内容；
- `Ctrl+F` 查找、`Ctrl+H` 替换；
- 支持上一个/下一个、大小写匹配、单次替换和全部替换。

### Excel / XLSX

- Sheet 切换；
- 基础单元格编辑；
- 保存回写；
- 显示当前 Sheet 与单元格位置。

### PDF / DOCX

- 本地只读阅读；
- PDF 连续阅读和当前页状态；
- DOCX 内容渲染；
- 复杂编辑场景可交给系统程序处理。

### 批注

- 批注保存为原文件同目录的伴生 `.qnote` 文件；
- 不直接修改原文件；
- 支持全文、文本选区、PDF 页面、Excel 单元格和 Markdown 预览选区；
- 文件改名时同步更新批注关联路径。

### 内置终端

- 支持 PowerShell 与 `cmd.exe`；
- 根据 Workspace、当前文件或默认目录确定 cwd；
- 支持多个终端会话、切换、重启和关闭；
- 使用 Ctrl+反引号键快速打开或关闭终端面板；
- `1.1.0` 修复 xterm 辅助输入控件在 WebView2 中误显示为底部黑色长条的问题。

### Windows 集成

- 单实例运行和命令行参数转发；
- 资源管理器右键菜单 / Open With；
- 本地文件操作统一通过 Rust command 层完成。

## V1 与 V2

### V1：稳定基础版本

当前版本：**`2.1.0`**。

V1 定位为 QuickEdit 的稳定基础版本，重点是维护和完善已有能力：

- 稳定性优化；
- 性能改进；
- 打开和保存体验优化；
- 交互细节调整；
- 兼容性改进；
- Bug 修复；
- 安装包和 Windows 集成的持续维护。

除非出现非常明确且必要的需求，V1 不再轻易引入新的复杂功能，尽量保持：

> **简单、轻量、稳定，并长期作为可靠的基础版本持续维护。**

### V2：改进版与实验版本

V2 用于承载新的设计、新的文件能力以及尚未充分验证的工作流。计划方向包括：

- HTML 静态安全预览；
- 崩溃恢复和自动保存草稿；
- 外部修改冲突检测与简单合并；
- Annotation V2：让批注真正附着在文本、单元格或页面内容上；
- 批注搜索、标签、状态和导出；
- 图片只读 Viewer；
- XLSX 虚拟化和大文件降级策略；
- PDF 大文件按页加载；
- PPTX 只读 Viewer；
- 轻量 Workspace 搜索；
- Agent Change Review 和 MCP UI Bridge。

QuickEdit 不默认演进为：

- IDE；
- 完整 Office 套件；
- Git GUI；
- Build / Debug / Test 系统；
- Agent 自主执行平台；
- 云同步或多人协作平台；
- 超大文件分析器。

长期边界是：

> **QuickEdit 负责查看、定位、批注、审阅和确认；复杂分析、Agent Planning 和 Shell Execution 交给专业工具。**

## 技术栈

- Tauri v2
- Vite
- TypeScript
- HTML / CSS
- Rust
- `@xterm/xterm` + `@xterm/addon-fit`
- `markdown-it`、`xlsx`、`pdfjs-dist`、`mammoth`

前端负责界面和交互，Rust 负责本地文件系统访问、编码处理、命令封装、原子写入、终端进程和 Windows 集成。

## 快速开始

### 环境要求

- Node.js
- pnpm
- Rust / cargo

### 安装与开发运行

```powershell
pnpm install
pnpm tauri dev
```

### 前端构建

```powershell
pnpm build
```

### Rust 测试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

### 打包发布

```powershell
pnpm tauri build
```

## 项目结构

```text
QuickEdit/
├── index.html              # 主界面
├── src/
│   ├── main.ts             # UI / 状态逻辑
│   ├── styles.css          # 样式
│   └── QuickEdit_Config_Help.md
├── src-tauri/
│   ├── src/lib.rs          # Rust command 层与终端实现
│   ├── tauri.conf.json     # Tauri 配置
│   ├── capabilities/       # 权限配置
│   └── windows/             # 安装/卸载钩子
├── docs/                    # 开发与版本计划文档
│   └── images/              # README 展示图片
├── 设计文档/                # 需求与设计文档
└── README.md
```

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/QuickEdit_Development_v1.md` | V1 架构、命令清单、实现和验证流程 |
| `docs/QuickEdit_V1_Stable_V2_Plan_v1.md` | V1 稳定版范围与 V2 规划原则 |
| `docs/QuickEdit_Undeveloped_v1.md` | V1 待开发项 |
| `docs/QuickEdit_Undeveloped_v2.md` | v2.0+ 待开发项的单一入口 |
| `docs/QuickEdit_Execution_Roadmap_v1.md` | P0–P5 执行路线图 |
| `设计文档/QuickEdit_Requirements_Specification.md` | 需求规格 |
| `设计文档/QuickEdit_Design_Document.md` | 总体设计与架构文档 |
| `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md` | v2.0+ 需求设计与演进路线 |
| `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md` | Annotation V2 设计 |
| `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md` | Agent Change Review 与 MCP Bridge 设计 |

## 版本与验证

当前版本号在以下文件保持一致：

- `package.json`：`2.1.0`；
- `src-tauri/tauri.conf.json`：`2.1.0`；
- `src-tauri/Cargo.toml`：`2.1.0`。

推荐在提交前执行：

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 一句话总结

**QuickEdit 是一个面向 Windows 的本地文件工作台：用更低的启动成本，快速打开、查看、编辑、批注和保存 Excel、DOCX、PDF、Markdown 以及其他常用文件。**
