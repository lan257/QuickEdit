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

V2 承载新的文件能力与尚未充分验证的工作流。当前实现状态：

已完成：

- 工程化分层：前端 `core / features / handlers / ui`，Rust `error / models / services / commands / windows`；格式经 `HandlerRegistry` 注册，重型依赖（SheetJS、pdf.js、mammoth、papaparse、DOMPurify）按需动态加载；
- 统一对象信息页：文件夹、不支持格式、可执行文件、过大文件、加载失败共用一套视图，未支持格式可直接“以文本方式打开”；运行入口统一为右上角小型 Run 图标；
- 图片只读 Viewer：适应窗口、缩放、旋转、系统打开，切换文档时释放 Blob；
- HTML 静态安全预览：保留原页面样式，脚本不执行、远程资源不抓取，同时可切回文本编辑；
- CSV 表格查看与编辑：引号/逗号/BOM/CRLF 往返一致，虚拟滚动 + 粘顶表头 + 单元格查找；
- 脚本运行：`.bat/.cmd/.ps1` 可直接编辑，点击运行总是新建终端并切到脚本所在目录，自定义 Runner 支持占位符与空格/中文路径；不绕过 PowerShell 执行策略；
- PPTX 逐页正文 + 翻页；`.doc/.ppt` 尽力抽取正文文字；
- 大文件分批只读加载（文本按行安全切块、二进制走 IPC 分段、PDF 页窗口释放远处画布、XLSX 按 200 行分段浏览）；
- 浅色 / 深色 / 跟随系统主题，选择持久化并实时跟随系统；终端面板固定深底并自带 16 色 ANSI 调色板；
- Agent Change Review：记录基线 → 采集差异 → 行级 Diff → 整轮确认或回滚，审计与回滚数据分离，回滚原因写回记录供 Agent 读取。

已明确的降级边界：

- `.doc` / `.ppt` 只能取出正文文字，不保留版式、图片与表格结构；无法抽取时进入信息页并用系统程序打开；
- PPTX 是文字抽取视图，不还原母版、动画与图片；
- 大文本与大 CSV 为只读，搜索只在已加载部分生效。

V2 backlog（单一入口为 `docs/QuickEdit_Undeveloped_v2.md`，其 §11 状态总表、§12 复验待办、§13 探索方向）：

- MCP Bridge（`quickedit-mcp` stdio + 本地 IPC），让 Agent 直接调用 review.begin / track / capture / get / history；审批动作仍只在界面完成；
- SheetJS 解析移入 Web Worker；超大 CSV 分段只读加载；
- MCP sidecar 随安装包分发；
- 崩溃恢复与自动保存草稿；外部修改冲突检测与简单合并；轻量 Workspace 搜索；
- 2026-09-22 复验待办 6 条（设置项回填、运行按钮位置、侧栏可拉伸、暗色品牌区文字、重命名预填、上一个/下一个文档快捷键）。

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
│   ├── main.ts             # 控制器：状态、视图切换、快捷键
│   ├── core/               # 类型、HandlerRegistry、路径/格式化工具
│   ├── editor/             # CodeMirror 编辑器封装
│   ├── annotations/        # 批注服务、锚点、各视图渲染器、面板 UI
│   ├── features/           # 终端、Runner、HTML 预览、审阅
│   ├── handlers/           # 各格式 Handler（按需动态加载）
│   ├── ui/                 # DOM 元素、视图切换、菜单、提示
│   ├── styles.css          # 样式与主题 token
│   └── QuickEdit_Config_Help.md
├── src-tauri/
│   ├── src/                # lib.rs 装配；commands / services / models / windows 分层
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
| `设计文档/QuickEdit_Annotation_V2_1_Content_First_Requirements_Design.md` | Annotation V2.1 内容优先批注设计（已实现） |
| `设计文档/QuickEdit_V2_Exploration_Overnight_Implementation_Design.md` | v2 探索版需求与实施设计（Phase 0–9，本轮已实现部分的直接依据） |
| `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md` | Agent Change Review 与 MCP Bridge 设计 |
| `设计文档/需求零碎记录.md` | 需求原始记录（逐条状态见待开发文档） |

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
