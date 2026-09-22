# QuickEdit V2 探索版需求与设计文档

*V2 Exploration / Overnight Agent Implementation Plan*

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Implementation Draft |
| 版本 | v2-exploration |
| 日期 | 2026-09-18 |
| 仓库 | `lan257/QuickEdit` |
| 基线 | `master` tree `88949a497a6ae760f41b414dfef1cecde9b4b657` |
| 当前版本 | V1.1.0 |
| 技术栈 | Tauri v2 + Vite + Vanilla TypeScript/HTML/CSS + Rust |
| 目标 | 在不破坏 V1 稳定性的前提下，完成工程化拆分并探索高价值格式、运行、大文件、MCP 与暗色主题能力 |

> **说明：第 2 项“http 静态预览”按此前讨论理解为 HTML（`.html/.htm`）静态预览 + 文本编辑。本文不把 QuickEdit 做成 HTTP URL 浏览器。**

## 1. 本轮范围

本轮只围绕以下 11 项：

0. 工程化重构：拆分前端/后端巨型单文件，建立模块化 Handler / Service / Feature；
1. 图片预览；
2. HTML 静态安全预览 + 文本编辑；
3. Legacy Word `.doc` 预览，同时保留现有 `.docx`；
4. PowerPoint `.pptx/.ppt` 预览；
5. CSV 预览和编辑；
6. `.bat/.cmd/.ps1/.exe` 在内置终端运行，其中 `.bat/.cmd/.ps1` 可直接文本编辑；
7. 其他脚本通过配置自定义运行命令；
8. 大文件多次懒加载 / 渐进加载；
9. Agent 修改审批 + MCP 工具；
10. 完整暗色主题。

另外增加一个横向基础能力：

- **通用对象信息页（Generic Info View）**：文件夹、EXE、未支持格式、过大文件、加载失败文件都必须有正式的信息展示页，而不是落入空白页或简单“暂不支持”提示。

不继续扩张到 IDE、LSP、Debugger、Build System、Git GUI、Office 级编辑、浏览器/Web Server、云服务、多人协作、插件市场。

## 2. 当前工程基线

当前仓库已经能稳定完成 V1 基础功能，但工程组织已需要拆分。

当前主要文件体量约为：

```text
src/main.ts              104 KB
src/styles.css            37 KB
src-tauri/src/lib.rs      46 KB
index.html                17 KB
```

当前 `main.ts` 同时承担 Workspace、文件树、Text、Markdown、XLSX、PDF、DOCX、Find/Replace、Annotation、Terminal、Settings、窗口 UI；Rust `lib.rs` 同时承担 Config、Workspace、文件 IO、编码、Annotation、Rename、Terminal、Shell Integration、Windows Registry 与所有 Tauri Commands。

因此本轮第一原则是：

> **先建立格式隔离架构，再增加格式。**

## 3. 不可破坏原则

### 3.1 V1 行为冻结

不得主动改变现有 Workspace、文档区、Text 打开/保存、Markdown Preview、XLSX 基础编辑、PDF/DOCX 阅读、Ctrl+F/H、`.qnote`、Terminal、Windows Shell 集成、单实例行为。允许迁移代码，但必须保持兼容。

### 3.2 格式冷加载

新增格式必须满足：

```text
不打开该格式
→ 不加载该格式 Handler 重型实现
→ 不初始化 Parser / Renderer
```

采用两层 Lazy Load：

```text
Core
↓
Handler dynamic import
↓
Heavy Library dynamic import
```

### 3.3 启动不扫正文

启动只恢复 Workspace 引用、元数据、配置和 UI 状态。禁止全工作区解析、Office 预解析、图片 Decode、脚本扫描、全文索引。

### 3.4 程序运行必须由用户明确触发

任何 `.exe/.bat/.cmd/.ps1` 或自定义 Runner 都只能在用户点击“运行”后执行。禁止打开即运行、预览即运行、Workspace 加载时运行。

### 3.5 每阶段必须保持可构建

至少执行：

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

阶段失败必须先修复，不继续叠加下一层功能。


# 4. 目标工程结构

## 4.1 前端

```text
src/
├── main.ts
├── app/
│   ├── bootstrap.ts
│   ├── app-controller.ts
│   └── app-state.ts
├── core/
│   ├── types.ts
│   ├── document-session.ts
│   ├── capabilities.ts
│   ├── handler-registry.ts
│   ├── errors.ts
│   └── events.ts
├── platform/tauri/
│   ├── file-api.ts
│   ├── config-api.ts
│   ├── annotation-api.ts
│   ├── terminal-api.ts
│   ├── runner-api.ts
│   └── review-api.ts
├── handlers/
│   ├── text/
│   ├── markdown/
│   ├── html/
│   ├── image/
│   ├── csv/
│   ├── xlsx/
│   ├── pdf/
│   ├── docx/
│   ├── doc/
│   ├── pptx/
│   ├── ppt/
│   └── executable/
├── features/
│   ├── workspace/
│   ├── search/
│   ├── annotations/
│   ├── terminal/
│   ├── runners/
│   ├── review/
│   ├── settings/
│   └── theme/
├── ui/
│   ├── elements.ts
│   ├── toast.ts
│   ├── dialog.ts
│   └── context-menu.ts
└── styles/
    ├── tokens.css
    ├── base.css
    ├── layout.css
    ├── workspace.css
    ├── document.css
    ├── annotations.css
    ├── terminal.css
    ├── office.css
    └── theme.css
```

`src/main.ts` 最终只负责 CSS import 和 `bootstrap()`。

## 4.2 Rust

```text
src-tauri/src/
├── main.rs
├── lib.rs
├── error.rs
├── models/
│   ├── file.rs
│   ├── config.rs
│   ├── annotation.rs
│   ├── terminal.rs
│   ├── runner.rs
│   └── review.rs
├── commands/
│   ├── files.rs
│   ├── config.rs
│   ├── workspace.rs
│   ├── annotations.rs
│   ├── terminal.rs
│   ├── runners.rs
│   ├── legacy_office.rs
│   ├── review.rs
│   └── shell.rs
├── services/
│   ├── file_io.rs
│   ├── encoding.rs
│   ├── atomic_write.rs
│   ├── annotation_store.rs
│   ├── terminal_service.rs
│   ├── runner_service.rs
│   ├── legacy_office_service.rs
│   └── review_service.rs
└── windows/
    ├── registry.rs
    └── shell_integration.rs
```

`lib.rs` 最终只保留 Tauri Builder、Plugin/State/Command 注册和 startup glue。

# 5. HandlerRegistry

```ts
export interface HandlerManifest {
  id: string;
  extensions: string[];
  load: () => Promise<DocumentHandler>;
}

export interface DocumentCapabilities {
  editable: boolean;
  searchable: boolean;
  replaceable: boolean;
  annotatable: boolean;
  runnable?: boolean;
  preview?: { type: "markdown" | "html" };
  paged?: boolean;
  spreadsheet?: boolean;
}

export interface DocumentHandler {
  readonly id: string;
  readonly capabilities: DocumentCapabilities;
  open(context: OpenContext): Promise<void>;
  save?(context: SaveContext): Promise<void>;
  search?(context: SearchContext): Promise<SearchResult[]>;
  dispose(): void | Promise<void>;
}
```

注册只保存 loader：

```ts
registry.register({
  id: "pdf",
  extensions: [".pdf"],
  load: async () => (await import("../handlers/pdf")).createPdfHandler(),
});
```

Handler 生命周期：

```text
打开文件
→ Registry 找 Manifest
→ dynamic import
→ open()
→ 切文件
→ dispose()
```

`dispose()` 必须释放 Event Listener、Observer、Canvas、Blob URL、Worker、Workbook、PDF/PPT Viewer、Timer 和未完成任务。


# 6. 通用对象信息页（Generic Info View）

这是本轮工程化之后应尽早完成的基础 UI。目标不是“给每一种不支持格式单独做页面”，而是建立统一 fallback：

> **即使 QuickEdit 不能预览某个文件，也必须让用户看到一个完整、正式、可操作的信息页。**

## 6.1 覆盖对象

统一支持以下场景：

```text
folder
unsupported
executable
too-large
load-error
```

以后还可以自然扩展：

```text
readonly-fallback
corrupted
permission-denied
```

但不需要为每种状态单独创建 Handler。

## 6.2 设计原则

`FileInfoView` 是应用级 fallback，不是文件格式 Handler。

打开流程：

```text
用户点击节点
→ HandlerRegistry
→ 有可用 Handler：进入 Viewer / Editor
→ 无 Handler / Handler 决定不直接打开：进入 Generic Info View
```

不要新增：

```text
UnsupportedHandler
ExeInfoHandler
LargeFileHandler
BrokenFileHandler
```

这类会重新把 HandlerRegistry 做乱的伪 Handler。

## 6.3 统一 View Model

建议：

```ts
type InfoViewKind =
  | "folder"
  | "unsupported"
  | "executable"
  | "too-large"
  | "load-error";

interface InfoViewMetadataItem {
  label: string;
  value: string;
}

interface InfoViewAction {
  id: string;
  label: string;
  primary?: boolean;
  execute(): void | Promise<void>;
}

interface FileInfoModel {
  kind: InfoViewKind;

  badge: string;
  title: string;
  subtitle: string;

  metadata: InfoViewMetadataItem[];

  actions: InfoViewAction[];
}
```

主 UI 只需要：

```ts
showInfoView(model);
```

## 6.4 视觉结构

复用当前已经做好的“文件夹信息卡片”视觉：

```text
┌──────────────────────────────────────┐
│  TYPE    文件名                      │
│          类型 / 状态                 │
│                                      │
│  ─────────────────────────────────   │
│                                      │
│  名称          ...                   │
│  类型          ...                   │
│  大小          ...                   │
│  修改日期      ...                   │
│  创建日期      ...                   │
│  位置          ...                   │
│                                      │
│  [主操作] [次操作]                   │
└──────────────────────────────────────┘
```

类型 Badge 继续保持字母块风格：

```text
DIR
EXE
DOC
PPT
ZIP
MP4
FILE
```

未知格式使用：

```text
FILE
```

不要使用过强的错误态视觉。

## 6.5 文件夹信息页

当前实现保留。

建议展示：

```text
名称
修改日期
创建日期
位置
包含文件数量
```

操作：

```text
[打开终端]
[复制位置]
```

现有文档列表右键菜单已经支持：

```text
在资源管理器中打开
```

因此本轮**不重复增加一个“在资源管理器中显示”按钮作为必需项**。

## 6.6 未支持格式信息页

例如：

```text
archive.7z
video.mp4
unknown.xyz
```

展示：

```text
FILE / XYZ
文件名

当前版本暂不支持预览

名称
类型
大小
修改日期
创建日期
位置
```

操作建议：

```text
[使用系统程序打开]
[复制位置]
```

如果文件看起来可能是文本，允许提供：

```text
[以文本方式打开]
```

但只作为用户明确操作，不自动尝试所有未知文件。

“以文本方式打开”仍必须走 TextHandler 的：

- size limit；
- encoding detect；
- read failure handling。

## 6.7 可执行文件信息页

`.exe` 使用 Generic Info View 的 executable 状态。

展示：

```text
EXE
tool.exe
Windows 可执行程序
```

元数据：

```text
名称
类型
大小
修改日期
创建日期
位置
```

正文卡片中的操作仍可保留：

```text
[复制位置]
[使用系统程序打开]（可选）
```

但**运行入口不放在信息卡的大按钮区域**。

### 运行按钮位置

用户已确定：

> **运行按钮放在右上角 Header 的一个小图标按钮上。**

建议：

```text
tool.exe                                    ▶
Windows 可执行程序
```

或者使用更符合现有 UI 的小型 Icon Button：

```text
[▶]
```

要求：

- 只有 `runnable=true` 时显示；
- hover tooltip：`在终端运行`；
- 点击后才执行；
- 不因打开 EXE 自动执行；
- 运行后自动打开/激活已有 Terminal Panel；
- cwd = 当前文件所在目录。

这一规则同样适用于：

```text
.bat
.cmd
.ps1
以及有 Runner 的其他脚本
```

即：

> **“运行”属于 Document Header 的轻量能力按钮，而不是大号主要操作按钮。**

## 6.8 Too Large 信息页

Handler 判断：

```text
OpenMode = readonly / external
```

时，可以先显示：

```text
LOG
server.log

文件较大，为避免长时间冻结，
QuickEdit 未以普通编辑模式打开。

大小：186 MB
...
```

可提供：

```text
[只读打开]
[使用系统程序打开]
[复制位置]
```

如果 Handler 可以直接 lazy readonly，也可以直接进入 Viewer，不必经过 Info View。

因此 Info View 是：

```text
能力解释 + 用户选择
```

而不是所有大文件都必须先停一次。

## 6.9 Load Error 信息页

已支持格式解析失败时，不要冒充“不支持”。

例如：

```text
DOCX
report.docx

⚠ 无法解析该文件

可能原因：
- 文件损坏
- 文件结构不兼容
- 当前解析器不支持其中部分内容
```

操作：

```text
[重新尝试]
[使用系统程序打开]
[复制位置]
```

`load-error` 与 `unsupported` 必须是两个不同状态。

## 6.10 Header Action Capability

建议统一：

```ts
interface HeaderAction {
  id: string;
  icon: string;
  title: string;
  visible: boolean;
  run(): void | Promise<void>;
}
```

文件/Handler 根据能力提供：

```text
save
rename
annotate
preview
run
```

其中 `run` 统一使用右上角小图标按钮。

避免以后每个格式自己在 Card 中插入不同尺寸的 Run Button。

## 6.11 验收

- [ ] 点击文件夹：显示现有 Folder Info；
- [ ] 点击未支持文件：显示正式 File Info，不是简单 unsupported 空态；
- [ ] `.exe` 显示 EXE Info；
- [ ] `.exe` 右上角出现小型 Run Icon；
- [ ] 打开 `.exe` 不会自动执行；
- [ ] `.bat/.cmd/.ps1` 正常进入 Text Editor，Header 显示 Run Icon；
- [ ] Custom Runner 文件 Header 显示 Run Icon；
- [ ] 不存在 Runner 的文件不显示 Run Icon；
- [ ] `load-error` 与 `unsupported` 文案不同；
- [ ] 现有右键“在资源管理器中打开”继续保留，不重复破坏。


# 7. 图片预览

支持：

```text
.png .jpg .jpeg .webp .gif .bmp
```

第一版不把 SVG 当普通图片直接运行；SVG 暂按文本或后续安全 Viewer 处理。

能力：

- Fit；
- 100%；
- Zoom；
- Ctrl+滚轮缩放；
- 居中；
- 可选 90° 视图旋转；
- 文件信息；
- 系统程序打开。

不做 OCR、裁剪、滤镜、涂鸦、内容编辑。

实现：

```text
ImageHandler
→ read bytes
→ Blob
→ URL.createObjectURL()
→ <img>
```

切换文件时 `URL.revokeObjectURL()`。

验收：

- Workspace 中存在大量图片不影响启动；
- 只有打开图片才加载 ImageHandler；
- GIF 正常；
- Zoom 不修改源文件；
- dispose 后释放 Blob URL。

# 8. HTML 静态安全预览 + 文本编辑

`.html/.htm` 仍属于 Text Handler，增加：

```text
[编辑 | 预览]
```

Preview 使用当前内存内容，不重新读磁盘。

安全流程：

```text
DocumentSession text
→ DOMPurify
→ 严格 CSP
→ iframe.srcdoc
→ sandbox=""
```

iframe 不得启用 `allow-scripts/allow-forms/allow-popups/allow-top-navigation`。

建议 CSP：

```html
<meta http-equiv="Content-Security-Policy"
content="
  default-src 'none';
  script-src 'none';
  connect-src 'none';
  frame-src 'none';
  object-src 'none';
  style-src 'unsafe-inline';
  img-src data: blob:;
">
```

同时删除外部 `link/src/href/srcset`；链接只保留文本；相对图片第一版不加载。

缓存：

```text
contentRevision
previewRevision
```

只有 Preview 被打开且内容变化时才重新渲染。

验收：

- script 不执行；
- 远程图片不发请求；
- HTML 可编辑；
- 未保存内容可以预览；
- 不打开 HTML 时 Sanitizer/Preview Handler 不进入主路径。

# 9. Legacy `.doc` 预览

现有 `.docx → Mammoth` 保留，不回归。

新增：

```text
.doc → Legacy Word Preview
```

Legacy `.doc` 不在前端自行实现 Word Binary Parser。优先使用 Rust 侧 Parser Adapter，候选 `office_oxide`。

建议 command：

```text
render_legacy_document(path)
```

返回：

```ts
interface LegacyDocumentPreview {
  html: string;
  text: string;
  warnings: string[];
}
```

HTML 返回前端后再次 Sanitization。

`.doc` 定位：

> 可读，不追求 Word 像素级排版。

优先保证段落、普通文字、标题、粗斜体、列表、基本表格、文本提取。复杂浮动形状、宏、OLE、精确分页允许降级。

Parser 不支持时：

```text
可提取文本 → 纯文本预览
否则 → “无法完整预览”
+
[使用系统程序打开]
```

不得因为 `.doc` 失败影响 `.docx`。


# 10. PPT/PPTX 预览

支持：

```text
.pptx
.ppt
```

只读，不做 PowerPoint 编辑。

## 10.1 PPTX

优先用浏览器端独立 Renderer，并完全包在 `PptxHandler` 内动态加载。候选 `pptx-preview`，先做 Spike。

目标：

- Slide 列表；
- 当前 Slide；
- Previous / Next；
- Fit；
- 基本文本搜索；
- 系统打开。

不要求动画、视频、宏、SmartArt 完整还原、PowerPoint 像素级一致。

## 10.2 Legacy PPT

优先复用 Rust legacy Office adapter，例如 `office_oxide`：

```text
.ppt
→ Rust parse
→ HTML / structured content
→ Slide-like Preview
```

如果无法得到足够视觉结构，按 Slide/Section 显示提取文字，并提供系统打开。

目标是“内容能看”，不是还原幻灯片效果。

## 10.3 Spike Gate

先测试：

```text
简单 PPTX
含图片 PPTX
Legacy PPT
```

第三方库不稳定时不要自行重写 PowerPoint Parser，保留 Handler + 降级预览并继续后续任务。

# 11. CSV 预览与编辑

CSV 从通用 Text 视觉路径中独立成 `CsvHandler`。已有用户配置即使仍把 `.csv` 放在 Text Extensions，也由专用 CSV Handler 优先，不要求用户手工迁移配置。

能力：

- Grid 预览；
- 单元格编辑；
- Ctrl+F；
- Ctrl+H；
- 保存；
- 行滚动；
- 虚拟化。

Parser 候选 `Papa Parse`，必须正确处理：

- quoted comma；
- escaped quote；
- CRLF/LF；
- 空列；
- BOM；
- 最后一空行。

保存尽量保持原 line ending 和 UTF-8 BOM。

小/中 CSV：

```text
normal editable
```

大 CSV：

```text
lazy readonly
```

第一版不要尝试 100MB CSV 全量可编辑。

Grid 永远只创建 viewport rows + buffer，不把十万行全部放进 DOM。

# 12. BAT/CMD/PS1/EXE 在终端运行

`.bat/.cmd/.ps1` 加入 Text Handler 默认扩展，支持编辑、查找、保存、批注。

`.exe` 不可编辑，显示文件元数据和：

```text
[在终端运行]
[系统打开]
[资源管理器中显示]
```

运行只来自用户明确点击。

运行入口统一放在当前文档 Header 右上角的小型图标按钮：

```text
[▶]
```

Tooltip：

```text
在终端运行
```

不在编辑区或信息卡中放大号“运行”主按钮。

cwd：

```text
当前文件所在目录
```

默认：

```text
.bat/.cmd → cmd.exe
.ps1      → PowerShell
.exe      → 终端中执行完整路径
```

PowerShell 不得自动使用 `-ExecutionPolicy Bypass`。系统策略阻止时直接在 Terminal 显示错误。

第一版可以无参数运行；参数输入属于可选增强。


# 13. 自定义 Script Runner

配置不要只保存一整段任意 shell 字符串，优先结构化：

```json
{
  "runners": [
    {
      "name": "Python",
      "extensions": [".py"],
      "shell": "powershell",
      "command": "python",
      "args": ["{file}"]
    },
    {
      "name": "Node",
      "extensions": [".js", ".mjs"],
      "shell": "powershell",
      "command": "node",
      "args": ["{file}"]
    },
    {
      "name": "Go Run",
      "extensions": [".go"],
      "shell": "powershell",
      "command": "go",
      "args": ["run", "{file}"]
    }
  ]
}
```

支持 placeholder：

```text
{file}
{dir}
{name}
{stem}
{workspace}
```

由 `RunnerService` 统一：

- placeholder expansion；
- Windows shell quote；
- cwd；
- validation。

禁止简单 `${command} ${file}` 拼接，避免空格/特殊字符路径导致错误或命令注入。

只有存在 Runner 时 UI 才显示 Run。

# 14. 大文件多次懒加载

统一概念：

```ts
type OpenMode = "normal" | "lazy" | "readonly" | "external";

interface OpenDecision {
  mode: OpenMode;
  reason?: string;
}
```

核心原则：

> **宁可多次短等待，不允许一次长时间冻结。**

必须：

- UI 始终响应；
- 局部 Loading；
- 异步任务带 `sessionId/taskId`；
- 切文档后旧结果不能覆盖新文档；
- CPU Heavy Parse 尽量 Worker / Rust `spawn_blocking`；
- 远离视口的 DOM/Canvas 可释放。

## 14.1 Binary IPC

当前 `read_binary_file -> Vec<u8> -> number[]` 不适合大文件路径。

新增：

```text
read_binary_range(path, offset, length)
```

优先使用 Tauri binary IPC response，而非 JSON number array。旧 command 保留给小文件兼容。

## 14.2 Text

建议初始策略（可配置）：

```text
<= 1 MB       normal editable
1 ~ 32 MB     lazy readonly
> 32 MB       external / 用户确认后尝试 lazy readonly
```

Lazy Text：

```text
read_text_chunk
→ byte range
→ 修正 UTF-8/UTF-16 边界
→ 尽量按行返回
→ 接近底部再请求
```

大文本第一版只读。

## 14.3 CSV

小 CSV 全量解析编辑；大 CSV：

```text
Rust chunk read
→ incremental parser state
→ 分批 rows
→ row virtualization
```

大 CSV 第一版只读。

## 14.4 PDF

保留现有 PDF.js dynamic import + IntersectionObserver + Canvas lazy，新增 Page DOM Window：

```text
current ± N pages
```

远处释放 Canvas/内容，只保留高度 placeholder。本轮不强制做 PDF Byte Range Reader。

## 14.5 XLSX

明确：

> Row Virtualization 解决 DOM，不等于 Workbook Streaming。

本轮：

- Handler 冷加载；
- `xlsx.read()` 尽量放 Web Worker；
- 只渲染当前 Sheet；
- Row Virtualization；
- 非当前 Sheet 不创建 Grid DOM；
- 超大 Workbook 可 readonly/external。

不要求实现 ZIP Byte Range XLSX Parser。

## 14.6 DOC/PPT

Parser 若必须全文件解析，允许，但必须放 Worker/Rust blocking task；解析完成后 Page/Slide 分批挂载，不能一次生成大量 DOM。


# 15. Agent 修改审批 + MCP

QuickEdit 不内置完整 Agent。

推荐：

```text
QuickEdit Terminal
→ Claude Code / Codex
```

Agent 负责修改；QuickEdit 负责展示修改、用户审批、回滚和审批记录。

## 15.1 ChangeSet

```ts
type ChangeSetStatus =
  | "recording"
  | "pending"
  | "approved"
  | "rejected"
  | "conflict";

interface ChangeSet {
  id: string;
  source: "agent" | "external";
  createdAt: string;
  completedAt?: string;
  status: ChangeSetStatus;
  summary?: string;
  files: FileChange[];
  decision?: {
    decidedAt: string;
    reason?: string;
  };
}
```

## 15.2 Baseline

可靠回滚必须先保存 before：

```text
review.begin(paths)
→ QuickEdit snapshot
→ Agent 用自己的工具修改
→ review.capture(id)
→ before vs disk
→ Diff
→ pending
```

后续新增目标文件：

```text
review.track(id, paths)
```

必须先 track 再修改。

## 15.3 UI

第一版只做整轮审批：

```text
Agent 本轮修改 4 个文件

config.json   +3 -2
src/app.ts    +8 -4
README.md     +2 -0

[查看 Diff]

[确认本轮修改]
[回滚本轮修改]
```

Approve：

```text
Audit 保留
Rollback Payload 删除
```

Rollback：

```text
恢复 baseline
status = rejected
Audit 保留
Rollback Payload 删除
```

Reject 支持可选原因，供 Agent 下一轮读取。

## 15.4 Agent 不能审批自己

MCP 不提供：

```text
review.approve
review.reject
```

只能用户 UI 审批。

## 15.5 MCP Tools V1

必须：

```text
review.begin
review.track
review.capture
review.get
review.history
```

可选推荐：

```text
document.get_active_context
document.open
document.reveal
```

不需要：

```text
read_file
write_file
run_shell
git_*
```

Agent 自己已有这些能力。

## 15.6 Transport

实现顺序：

```text
Step A
ReviewService + UI 独立完成

Step B
Local IPC

Step C
quickedit-mcp stdio bridge
```

MCP Rust 实现优先考虑官方 `rmcp` SDK。

推荐：

```text
Claude Code
→ stdio quickedit-mcp
→ local IPC
→ QuickEdit
```

如果 sidecar 随安装包分发在本轮成为阻塞，不阻塞 ReviewService：允许先交付 dev binary + 配置示例，把 installer bundling 单独列 TODO。

Review 数据：

```text
app_config_dir/reviews/
├── audit/
└── rollback/
```

默认只保留最近约 100 条 audit；完整 rollback payload 在 approve/reject 后删除。


# 16. 暗色主题

实现：

```text
Light
Dark
System
```

禁止全局 `filter: invert()`。

把硬编码颜色收敛为 Semantic Token：

```css
:root {
  --bg-app: ...;
  --bg-sidebar: ...;
  --bg-panel: ...;
  --bg-elevated: ...;

  --text-primary: ...;
  --text-secondary: ...;
  --text-muted: ...;

  --border-default: ...;
  --border-strong: ...;

  --accent: ...;
  --accent-soft: ...;
  --danger: ...;
  --warning: ...;

  --selection-bg: ...;
  --hover-bg: ...;
  --shadow: ...;
}
```

使用：

```css
html[data-theme="light"] { ... }
html[data-theme="dark"]  { ... }
```

System 使用：

```text
matchMedia("(prefers-color-scheme: dark)")
```

并监听实时变化。

xterm 必须单独更新：

```ts
terminal.options.theme = ...
```

PDF、PPT、DOC/DOCX 页面、HTML Preview、图片保持原文视觉，不强制 invert。Dark UI + 白色 PDF page 属于正常设计。

# 17. 第三方依赖策略

候选：

| 需求 | 候选 |
| --- | --- |
| HTML sanitize | `dompurify` |
| CSV | `papaparse` |
| PPTX | `pptx-preview`（先 Spike） |
| Legacy DOC/PPT | Rust `office_oxide` |
| MCP | Rust `rmcp` |

规则：

- 第三方库必须包在 Handler/Service Adapter 后；
- Heavy package 必须 Lazy；
- 先 Spike 再正式接；
- 不成功则降级，不自行实现 Word/PPT 二进制格式；
- 不因为一个格式 Parser 失败阻塞其他 Phase。

# 18. 一夜执行顺序

## Phase 0 — Baseline

```powershell
pnpm install
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

记录 build、tests 和核心文件大小，创建独立开发分支。

## Phase 1 — 工程化重构

只拆代码，不加用户功能：

- Frontend module tree；
- Rust module tree；
- HandlerRegistry；
- DocumentCapabilities；
- RunnerRegistry 骨架；
- CSS token / feature CSS。

确保 V1 仍可构建。

## Phase 2 — 冷加载迁移

迁移 XLSX、PDF、DOCX、Markdown Preview、Terminal（能拆则拆），用 Vite build 输出确认重型模块形成独立 chunk。

## Phase 2.5 — Generic Info View

在新增格式之前完成统一对象信息页：

```text
Folder
Unsupported
Executable
Too Large
Load Error
```

并完成 Header Action 模型，确保 `.exe` / 脚本 Runner 的运行入口使用右上角小图标按钮。

不要重复实现资源管理器按钮；文档列表右键已有“在资源管理器中打开”。

## Phase 3 — 高收益格式

依次：

```text
Image
HTML
CSV
```

每个独立完成、测试、提交。

## Phase 4 — Runner

完成 BAT/CMD/PS1/EXE + Custom Runner。

重点测：

- 空格路径；
- 中文路径；
- `&` 等特殊字符；
- cwd；
- quote。

## Phase 5 — DOC/PPT

先 Spike，再接 Handler。失败格式必须有可读降级 + 系统打开，不阻塞夜间任务。

## Phase 6 — 大文件

完成：

- OpenMode；
- sessionId/taskId；
- binary range；
- Large Text readonly chunks；
- Large CSV；
- PDF Page Window；
- XLSX row virtualization/Worker。

## Phase 7 — Dark Theme

完成 Light/Dark/System 和 Terminal Theme。

## Phase 8 — Change Review

先不接 MCP，完成 ChangeSet、Baseline、Diff、Approve/Rollback、Audit/Rollback Storage、Review UI。

## Phase 9 — MCP

最后实现 review tools 和 Agent 配置说明。


# 19. Git / 验证规则

不要“一夜一个巨大 commit”。

建议至少：

```text
refactor: modularize frontend and tauri backend
refactor: introduce lazy handler registry
feat: add image preview
feat: add secure html preview
feat: add csv viewer and editor
feat: add terminal runners
feat: add doc and ppt preview
feat: add progressive large-file loading
feat: add dark theme
feat: add change review workflow
feat: add mcp review bridge
docs: update v2 exploration status
```

每个 commit 前：

```text
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

如果引入前端纯逻辑模块，推荐补 Vitest；至少覆盖 HandlerRegistry、Runner placeholder/quote、CSV round-trip、Review state transition。

# 20. 验收清单

## 0. 工程化
- [ ] `main.ts` 不再承载全部业务；
- [ ] Rust `lib.rs` 不再承载全部 command/service；
- [ ] Handler 独立目录；
- [ ] 新格式 Registry 注册；
- [ ] Heavy Handler dynamic import；
- [ ] V1 build/test 通过。

## 0.5 通用对象信息页
- [ ] Folder / Unsupported / Executable / Too Large / Load Error 共用 Info View；
- [ ] 未支持文件不再只是简单空态；
- [ ] `.exe` 使用 Info View；
- [ ] Run 使用 Header 右上角小图标按钮；
- [ ] `.bat/.cmd/.ps1` 编辑页同样使用 Header Run Icon；
- [ ] 现有右键“在资源管理器中打开”保持不变。

## 1. 图片
- [ ] PNG/JPG/WEBP/GIF/BMP；
- [ ] Fit/Zoom；
- [ ] dispose Blob URL。

## 2. HTML
- [ ] Edit/Preview；
- [ ] 未保存内容 Preview；
- [ ] JS 不执行；
- [ ] 无远程网络请求；
- [ ] sandbox iframe。

## 3. DOC
- [ ] `.docx` 不回归；
- [ ] `.doc` 可读；
- [ ] Parser 失败可系统打开；
- [ ] 不长时间阻塞 UI。

## 4. PPT
- [ ] `.pptx` Slide Preview；
- [ ] `.ppt` 至少可读降级；
- [ ] Prev/Next；
- [ ] 不执行宏；
- [ ] Parser 按需加载。

## 5. CSV
- [ ] quoted comma；
- [ ] escaped quote；
- [ ] UTF-8 BOM；
- [ ] 编辑/保存；
- [ ] Grid virtualization；
- [ ] 大 CSV lazy readonly。

## 6. Runner
- [ ] BAT/CMD/PS1/EXE；
- [ ] BAT/PS1 可编辑；
- [ ] 只有用户点击才运行；
- [ ] 不绕过 PowerShell ExecutionPolicy。

## 7. Custom Runner
- [ ] Python 示例；
- [ ] Node 示例；
- [ ] placeholders；
- [ ] 空格/中文路径安全；
- [ ] 无效 config 明确报错。

## 8. 大文件
- [ ] UI 不冻结；
- [ ] 多批次 Loading；
- [ ] 旧任务不覆盖新文档；
- [ ] Text lazy；
- [ ] CSV lazy；
- [ ] PDF page window；
- [ ] XLSX 不全量 DOM。

## 9. Agent Approval / MCP
- [ ] begin/track/capture/get/history；
- [ ] Diff UI；
- [ ] Approve；
- [ ] Rollback；
- [ ] Audit 保留；
- [ ] Rollback Payload 清理；
- [ ] Agent 能读 reject reason；
- [ ] MCP 无 approve/reject tool。

## 10. Dark
- [ ] Light；
- [ ] Dark；
- [ ] System；
- [ ] xterm 更新；
- [ ] 文档内容不被强制 invert；
- [ ] 设置持久化。

# 21. 回归检查

至少人工验证：

```text
TXT 打开/编辑/保存
Markdown 编辑/预览
XLSX 编辑/保存
PDF 滚动
DOCX 预览
Ctrl+F / Ctrl+H
.qnote
Terminal 多 Session
右键打开
F2 Rename
复制路径
设置
单实例
```

# 22. 完成标准

本轮不是要求 Office 文件完美还原，而是：

> **格式能快速、稳定地打开到“足够可用”；复杂或无法可靠解析的内容有明确降级路径。**

```text
Fallback → 不支持/失败/EXE 也有正式信息页
Image  → 能看
HTML   → 能改 + 安全静态看
DOC    → 能读
PPT    → 能按 Slide/内容看
CSV    → 能表格看 + 简单改
Script → 能改 + 显式运行
Large  → 不长卡，能分批出现
Review → 改了什么看得见，用户能确认/回滚
Dark   → 整个应用 UI 一致可用
```

# 23. 可直接交给 Coding Agent 的执行指令

> 以当前 `master` 为 V1 稳定基线，实现本文 V2 Exploration。先模块化，再完成 Generic Info View，再加格式；不要继续把实现堆在现有 `main.ts` / `lib.rs`。未支持格式、EXE、过大文件与加载失败必须进入统一信息页；现有文档列表右键“在资源管理器中打开”保持不变，不重复造入口；所有可运行文件统一在 Header 右上角显示小型 Run Icon。每个新增格式必须走 `HandlerRegistry` 且重型依赖动态加载。每阶段完成后运行 `pnpm build` 和 `cargo test --manifest-path src-tauri/Cargo.toml`，失败先修复再继续。不得删除已有 V1 能力，不得破坏 `.qnote`，不得把项目改成 React/Vue/IDE。程序/脚本只能在用户明确点击运行后进入已有终端。大文件优先保证 UI 响应和渐进展示，不追求任意大文件完整编辑。Legacy Office Parser 若第三方依赖无法稳定工作，采用可读降级 + 系统打开，不自行实现 Word/PPT 二进制格式。Change Review 必须先于 MCP 完成；Agent 绝不能通过 MCP 自己 approve/reject。最后更新 README、V2 backlog 和实现状态，并输出完成项、降级项、未完成项、构建与测试结果。
