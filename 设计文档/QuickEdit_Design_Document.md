# QuickEdit 设计文档

*Software Design Document / Architecture & Detailed Design*

| 文档状态 | Draft |
| --- | --- |
| 版本 | v0.1 |
| 日期 | 2026-09-15 |
| 产品定位 | 轻量、本地、快速、稳定的文件编辑与阅读工作区 |

> 本文档基于当前产品讨论与已确认 Demo 方向形成，用于后续实现、评审与迭代。

## 1. 设计目标与关键决策

设计围绕“低启动成本、按需加载、文件操作可靠、UI 简洁”展开。文档给出 V1 推荐实现，不要求未来所有版本永久绑定同一技术栈。

### 1.1 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 桌面宿主 | Tauri + HTML/CSS/TypeScript + Rust 后端 | 保留网页 UI 的设计效率，同时减少 Electron 式运行时负担；Windows 文件系统/IPC/注册表能力放后端。 |
| 工作区 | 左 280px 树形工作区（固定“文档”分区 + 多工作区 + 嵌套文件夹）+ 右内容区 + 可折叠批注栏 | 参考 VS Code 资源管理器的树形心智模型；与当前 Demo 一致。 |
| 添加入口 | 左上角 Logo 弹出“打开文档 / 新增工作区” | 全局唯一添加入口，替代侧栏顶部按钮组。 |
| 文件解析 | Handler Registry | 避免 if/else 扩展地狱；新增格式时不改主 UI 流程。 |
| 文本大文件 | 默认 1MB 上限 | 产品定位不是大文件编辑器，直接控制复杂度与内存。 |
| PDF/DOCX | 只读 | 避免陷入 Office/PDF 完整编辑兼容问题。 |
| 批注 | .qnote 伴生 JSON | 本地、透明、易迁移、与原文件解耦。 |
| 重命名 | 单文件事务 | 保留旧工具最有价值的文件操作能力，但去掉批量流程。 |
| Windows 集成 | 安装器注册 + CLI + 单实例 IPC | 支持右键/打开方式，同时避免重复进程。 |

## 2. 总体架构

采用分层 + FileHandler 插件式边界。UI 不直接读写磁盘；所有文件操作经应用服务与基础设施层完成，以便统一错误处理、事务和测试。

| 层 | 主要组件 | 职责边界 |
| --- | --- | --- |
| UI / Presentation | 左侧树形工作区（文档分区 + 多工作区）、顶部操作区、编辑/阅读区、可折叠批注栏 | 只负责展示与交互，不直接操作磁盘 |
| Application Services | Workspace / Document / Rename / Annotation / Settings / Shell | 编排用例、事务与状态 |
| File Handler Registry | Text / Spreadsheet / PDF / DOCX / Unsupported | 按扩展名与能力选择处理器 |
| Infrastructure | FileSystem / Encoding / Config / IPC / Windows Integration | 封装操作系统与持久化细节 |

### 2.1 推荐目录结构

```text
src/
  ui/
    workspace/
    editor/
    reader/
    annotation/
    settings/
  application/
    workspace_service
    document_service
    rename_service
    annotation_service
    settings_service
    shell_service
  handlers/
    text_handler
    spreadsheet_handler
    pdf_handler
    docx_handler
    unsupported_handler
  infrastructure/
    filesystem
    encoding
    config_store
    workspace_store
    ipc
    windows_integration
src-tauri/
  commands/
  platform/windows/
  main.rs
```

### 2.2 核心对象

| 对象 | 关键字段 | 职责 |
| --- | --- | --- |
| WorkspaceNode | id, kind(workspace/docs/folder/file), name, path, parentId, children[], expanded, ext, size, handlerId, loadState | 左侧树中的轻量节点；file 节点不持有正文，目录节点持有展开状态与子级。 |
| DocumentSession | workspaceItemId, handlerId, dirty, readOnly, viewState | 当前打开文件的会话状态。 |
| FileHandler | id, extensions, capabilities | 判断能否打开、加载模型、保存、提供定位信息。 |
| AnnotationDocument | version, target, updatedAt, annotations[] | 映射 .qnote 文件。 |
| AnnotationEntry | id, scope, locator, text, timestamps | 单条批注。 |
| AppConfig | handlers, editor, annotations, workspace, shell | 映射 config.json。 |

## 3. UI 设计

主界面保持单窗口、低层级导航。高频动作必须在一屏内完成，不引入多标签页、多窗口或复杂工具栏。

```text
┌──────────────────────────── QuickEdit ──────────────────────────┐
│ [Q▾] QuickEdit          │ 当前文件信息        重命名  批注  保存 │
├─────────────────────────┼───────────────────────────────────────┤
│ Workspace        n files│                                       │
│ ▾ 文档                  │                                       │
│    c.json               │           编辑器 / 阅读器              │
│    d.html               │                                       │
│ ▾ 工作区A  C:\Users\LinU│                                       │
│    ▾ 文件夹B        + × │                          ┌───────────┐│
│       ▸ 文件夹C         │                          │ 批注栏(可选)│
│       a.txt             │                          └───────────┘│
│       b.md              │                                       │
│ ▸ 工作区B  G:\AI视频\伪…│                                       │
├─────────────────────────┴───────────────────────────────────────┤
│ 状态 / 编码 / 行数 / Sheet / 页码 / xxx.ext.qnote               │
└─────────────────────────────────────────────────────────────────┘
```

- 左栏宽度建议 260–300px，V1 默认 280px；树形行高约 32px，缩进每级约 14px（与 Demo 一致）。
- 左上角 Logo（带 ▾ 角标）是全局唯一添加入口：点击弹出菜单，仅“打开文档”与“新增工作区”两项，替代旧版“打开文件 / 打开文件夹”按钮组。
- 树节点分三类：固定“文档”分区（始终存在、不可移除）、工作区（行内显示来源路径）、文件夹（可嵌套）；文档是叶子节点。
- 交互遵循 VS Code 习惯：点击工作区/文件夹行展开或折叠；点击文档行在右侧打开；行悬停显示“＋”（仅非文档节点，弹出新建文件夹/新建文档）与“×”（从列表移除，不删磁盘）；右键菜单提供展开/折叠、重命名、打开批注、移除。
- “打开文档”加入的文件只归入“文档”分区，不移动磁盘位置；在“文档”分区新建的文档默认保存到 文档/quickedit/（系统“文档”目录下的 quickedit 子目录）。
- 批注栏默认关闭，打开后宽度约 300–340px；关闭后内容区恢复全宽。
- 重命名使用独立小弹窗；设置使用中型弹窗；不引入独立“重命名页面”。
- 文件类型使用轻量图标/短标签即可，不依赖复杂缩略图生成。
## 4. 文件打开与懒加载流程

性能的核心不是“解析更快”，而是避免不必要的解析。

### 4.1 新增工作区（打开文件夹）

1. 用户点击左上角 Logo 选择“新增工作区”，调用系统目录选择器得到目录句柄/路径。
1. 异步枚举条目，只采集 path、name、extension、size、modifiedTime、isDirectory 等元数据，构建以该目录为根的子树。
1. 根据 config.json 和 HandlerRegistry 过滤可显示文件；默认忽略 .qnote。
1. 将 WorkspaceNode 批量推送到 UI；大目录子级使用虚拟化或懒展开（展开时再枚举），均不预读正文。
1. 用户点击树中的文档节点时，才调用对应 Handler.load()。

### 4.2 打开单文件（“打开文档”）

1. 用户点击左上角 Logo 选择“打开文档”，系统文件选择器支持一次多选。
1. 选中的文件逐个加入“文档”分区：只记录文件引用，不移动、不复制磁盘文件。
1. 读取文件元数据并通过 HandlerRegistry 匹配处理器。
1. 若为文本，先检查大小上限，再执行编码识别与读取。
1. 若为 Excel/PDF/DOCX，按需加载对应解析组件。
1. 并行检查同目录是否存在“完整文件名.qnote”；存在则加载批注。
1. 创建 DocumentSession，UI 根据 capabilities 决定是否显示保存按钮、定位型批注等能力。

### 4.3 新建文件夹 / 新建文档

- 在“文档”分区新建文档：默认落盘到 文档/quickedit/（系统“文档”目录下的 quickedit 子目录），目录不存在时自动创建。
- 在工作区/文件夹节点新建：新文件夹/文档直接在该节点对应的磁盘目录下创建。
- 新建只产生空文件/模板文件与元数据，不触发整树重扫；完成后将新 WorkspaceNode 插入树的对应层级，并展开父节点。
## 5. FileHandler 设计

Handler 是扩展文件格式的唯一入口。主工作区只关心统一能力，不感知具体文件类型。

```typescript
interface FileHandler {
  id: string
  extensions: string[]
  canEdit: boolean
  canAnnotate: boolean

  load(path): DocumentModel
  save?(path, model): SaveResult
  getAnnotationContext?(viewState): Locator | null
  dispose?(session): void
}
```

### 5.1 TextHandler

- 读取前检查 FileInfo.size；默认上限 1 MB。
- 编码策略建议：BOM → UTF-8 严格验证 → GB18030/GBK 等配置候选；不要用永不失败的编码静默吞掉乱码。
- 编辑模型直接使用字符串；保存默认保持原编码，若编码未知则明确选择 UTF-8。
- 批注定位 V1 至少 general；后续可记录 selection 起止偏移与片段摘要。
### 5.2 SpreadsheetHandler

- V1 仅承诺 .xlsx；工作簿加载为 WorkbookModel / SheetModel / CellModel。
- UI 表格必须虚拟化；不要一次创建巨量 DOM 单元格。
- 保存库必须通过 round-trip PoC：修改少量值后，未编辑 Sheet、公式、样式应尽可能保持。
- 若库无法安全 round-trip，则应明确限制“值编辑”范围，而不是静默重建整个工作簿。
- 批注 locator 可使用 {sheet, cell:"B3"}。
### 5.3 PdfHandler

- 只读。推荐前端 PDF 阅读组件按页渲染，避免自己实现 PDF 编辑。
- 页面缩放、翻页、文本选择属于阅读能力；保存按钮禁用。
- 批注 locator 以 page 为基础；后续可增加 selectionRect/textQuote。
### 5.4 DocxHandler

- 只读。将 OOXML 内容转为 HTML/阅读模型，优先保证文字、标题、列表、表格可读。
- 不承诺与 Word 像素级排版一致；复杂文档必须保留“使用系统程序打开”入口。
- 旧 .doc 首版不内置解析，可走 Unsupported/ExternalOpen。
## 6. 批注系统设计

批注与原文件完全解耦，通过同目录伴生 .qnote 文件持久化。所有 Handler 共享同一个 AnnotationService。

### 6.1 文件命名与扫描规则

```text
report.pdf      <-> report.pdf.qnote
report.docx     <-> report.docx.qnote
README.md       <-> README.md.qnote
```

- 文件夹扫描默认排除 *.qnote，避免它们作为普通工作区文件出现。
- 用户直接打开 .qnote 时，V1 可提示“这是 QuickEdit 批注文件”，不进入普通编辑器。
- 如果 .qnote 存在但目标文件不存在，视为孤儿批注；V1 不自动删除。
### 6.2 qnote Schema

```json
{
  "version": 1,
  "target": {
    "name": "report.pdf",
    "size": 1839201,
    "modifiedTime": "2026-09-15T15:50:00+08:00"
  },
  "updatedAt": "2026-09-15T16:28:00+08:00",
  "annotations": [
    {
      "id": "01J...",
      "scope": "page",
      "locator": { "page": 2 },
      "text": "这里需要复核。",
      "createdAt": "2026-09-15T16:20:00+08:00",
      "updatedAt": "2026-09-15T16:20:00+08:00"
    }
  ]
}
```

- target.size + modifiedTime 作为低成本一致性提示，不在每次打开时计算全文件哈希。
- 如果文件被外部替换且元数据差异明显，UI 可提示“批注可能对应旧版本”，但仍允许用户查看。
- 写入 qnote 时采用 temp 文件写入并原子替换，防止中断产生半截 JSON。
## 7. 单文件重命名设计

重命名属于文件系统操作，不应直接由 UI 调用 rename。统一交给 RenameService 处理目标文件、qnote、冲突检查和工作区状态更新。

### 7.1 正常流程

1. UI 提交 oldPath + newName。
1. 校验 Windows 文件名非法字符、保留名、空名称、路径长度等。
1. 计算 newPath 与 oldQnote/newQnote。
1. 预检查 newPath 是否已存在；若 oldQnote 存在，同时检查 newQnote 冲突。
1. 要求当前 Handler 释放会阻止 rename 的文件句柄。
1. 重命名目标文件。
1. 若 qnote 存在：更新 qnote.target.name，安全写回，然后重命名 qnote。
1. 更新 WorkspaceNode.path/name、DocumentSession、最近文件记录并刷新 UI。
### 7.2 异常与回滚

- 目标文件重命名失败：不动 qnote，直接返回错误。
- 目标文件已改名但 qnote 更新/改名失败：优先尝试将目标文件回滚到旧名称；回滚也失败时进入“部分成功”状态并给出两个实际路径。
- 不得静默覆盖已存在的目标文件或 qnote。
- V1 仅重命名单个文件，不修改父目录。
## 8. 配置与持久化

应用级配置、工作区状态和日志与用户文档分离；只有 .qnote 与目标文档同目录。

### 8.1 路径建议

```text
%LOCALAPPDATA%/QuickEdit/
  config.json
  workspace.json
  logs/

%USERPROFILE%/Documents/quickedit/    ← “文档”分区默认落盘目录
  note.txt

<workspace-folder>/
  report.pdf
  report.pdf.qnote
```

### 8.2 config.json 示例

```json
{
  "version": 1,
  "editor": {
    "maxTextFileSizeMB": 1,
    "confirmBeforeCloseUnsaved": true
  },
  "handlers": {
    "text": { "enabled": true, "extensions": [".txt", ".md", ".json"] },
    "spreadsheet": { "enabled": true, "extensions": [".xlsx"] },
    "pdf": { "enabled": true, "extensions": [".pdf"] },
    "docx": { "enabled": true, "extensions": [".docx"] }
  },
  "annotations": {
    "enabled": true,
    "extension": ".qnote"
  },
  "workspace": {
    "restoreLastSession": true
  },
  "shell": {
    "contextMenu": true,
    "openWith": true
  }
}
```

### 8.3 workspace.json 树形结构

workspace.json 从单层文件列表升级为树形持久化：记录“文档”分区成员、各工作区根路径、嵌套文件夹结构与各节点展开状态；恢复时只重建树形引用与展开状态，不预读正文。

```json
{
  "version": 2,
  "docsSection": {
    "expanded": true,
    "files": [
      "C:\\Users\\LinU\\Documents\\quickedit\\c.json"
    ]
  },
  "workspaces": [
    {
      "name": "工作区A",
      "path": "C:\\Users\\LinU",
      "expanded": true,
      "children": [
        {
          "kind": "folder",
          "name": "文件夹B",
          "expanded": true,
          "children": []
        },
        { "kind": "file", "path": "C:\\Users\\LinU\\b.md" }
      ]
    }
  ]
}
```

- “文档”分区不持有 path 根，成员是散列文件引用；新建文档默认写入 文档/quickedit/。
- 文件夹节点按需保存子级引用；磁盘目录被外部删除时，恢复阶段将该节点标记为缺失并提示，不静默丢弃。
- 恢复流程只读取引用与展开状态；与 NFR-PERF-001“启动不解析文档”一致。

## 9. Windows 集成与单实例

Windows 集成分为“安装时注册”和“运行时接收路径”两部分，避免把 Shell 逻辑耦合进文件解析器。

### 9.1 命令行入口

```text
QuickEdit.exe "D:\Notes\README.md"
QuickEdit.exe "D:\Notes"
QuickEdit.exe --open "D:\Notes\README.md"
```

### 9.2 单实例 IPC

1. 主实例启动后创建命名互斥体/单实例锁，并监听 Named Pipe 或等价本地 IPC。
1. 第二实例收到 path 参数后检测已有主实例。
1. 若主实例存在，将“OpenPath”消息发送给主实例，然后立即退出。
1. 主实例将文件加入当前工作区并激活窗口。
### 9.3 Explorer 集成

- V1 优先采用普通文件/文件夹 Shell Verb：“使用 QuickEdit 打开”。
- 注册 Open With / 应用能力，使 QuickEdit 可由用户选择为特定扩展名的默认应用。
- 应用本身不得静默抢占用户默认文件关联。
- Shell 入口只负责启动/转发路径，绝不在 Explorer 进程内解析文件正文。
## 10. 性能设计

性能预算通过“减少工作”实现，而不是依赖微优化。

| 场景 | 策略 |
| --- | --- |
| 启动 | 不扫描目录、不恢复正文、不加载 Excel/PDF/DOCX 解析器；只读 config/workspace 索引。 |
| 工作区 | WorkspaceNode 只存元数据；树形列表虚拟化，深层目录可懒展开；目录枚举异步分批更新。 |
| 文本 | 默认 1MB 硬上限；一次性读取即可，不引入大文件分页复杂度。 |
| Excel | Workbook 首次选中时解析；Sheet/行列 UI 虚拟化；无后台全表计算。 |
| PDF/DOCX | 首次选中时才加载对应模块；离开会话后允许释放重资源。 |
| 批注 | qnote 通常很小；按当前文档加载，不做全磁盘索引。 |
| 日志 | 异步、滚动、小体积；默认不记录文件正文和批注文本。 |

## 11. 保存、并发与外部修改

文件工具最容易出问题的不是“打开”，而是保存时覆盖用户在其他程序中的修改。

- DocumentSession 加载时记录文件 modifiedTime + size。保存前重新 stat；若发生变化，提示“文件已被外部修改”。
- 文本保存：先写同目录临时文件，再替换原文件；保留原编码信息。
- qnote 保存：同样使用临时文件 + 原子替换。
- Excel 保存：由 SpreadsheetHandler 负责生成安全输出，并在替换前完成完整写入。
- V1 不做复杂三方合并；冲突时允许“重新加载 / 另存为 / 强制覆盖（需明确确认）”。
## 12. 错误处理与可观测性

错误必须局部化、可理解，并给出下一步动作。

| 错误 | 用户体验 | 日志 |
| --- | --- | --- |
| 不支持扩展名 | 显示“不支持内置打开”，提供系统程序打开。 | 记录 handler miss，不记录正文。 |
| 文本超过上限 | 显示实际大小与当前 1MB 限制。 | info。 |
| 解析失败 | 当前内容区显示错误卡片，工作区继续可用。 | error + handler + path（可脱敏）。 |
| 保存冲突 | 提示外部修改，要求用户选择重新加载/覆盖/另存。 | warn。 |
| 重命名部分失败 | 展示当前真实文件名和 qnote 名称，并提供重试。 | error + rollback 结果。 |
| qnote JSON 损坏 | 保留原文件，提示备份并新建；不覆盖损坏文件。 | error。 |

## 13. 测试策略

V1 测试重点不是 UI 截图，而是文件 round-trip、异常恢复和操作语义。

- 单元测试：HandlerRegistry、扩展名匹配、qnote 命名、非法文件名、配置迁移、工作区树形结构（workspace.json）的序列化与恢复。
- 集成测试：文本编码读写、qnote 原子保存、单文件 + qnote 重命名事务、外部修改检测。
- Round-trip：准备包含公式、样式、多 Sheet 的 xlsx 样本，修改一个单元格后对比未编辑内容。
- 阅读器回归：PDF 多页、扫描型 PDF、复杂 DOCX 表格/图片/列表。
- 性能基准：冷启动、100/1000/5000 条目录枚举、首次打开 xlsx/pdf/docx 的耗时和内存。
- Shell 测试：右键打开文件/文件夹、已有实例转发、带空格/中文路径、无权限路径。
## 14. 实施顺序

建议按“文件闭环 → 批注 → Office 阅读 → Windows 集成”的顺序开发，避免先做外围功能。

| 阶段 | 目标 | 交付内容 |
| --- | --- | --- |
| P0 | 骨架闭环 | 窗口/UI、config、工作区、TextHandler、保存、移除、基础错误处理。 |
| P1 | 文件操作 | AnnotationService + .qnote、RenameService、外部修改检测。 |
| P2 | 格式扩展 | SpreadsheetHandler、PdfHandler、DocxHandler、系统程序打开兜底。 |
| P3 | 系统集成 | 单实例 IPC、命令行、Explorer 右键、Open With、安装器。 |
| P4 | 优化验收 | 虚拟化、懒加载优化、round-trip 测试、性能基准、异常恢复。 |

## 15. 需要在开发 PoC 阶段验证的技术点

这些不是产品需求不确定，而是实现库需要通过样本验证。

- 选定的 .xlsx 库是否满足“修改少量单元格且尽可能保持未编辑内容”的 round-trip 要求。
- DOCX 阅读转换方案在中文字体、表格、图片和列表上的还原程度与启动开销。
- PDF 阅读组件在本地文件、大页数文件上的内存占用。
- Tauri WebView 冷启动与基础内存是否达到产品预算；若不达标，可保留切换到原生 Windows UI 宿主的空间。
- Windows 11 右键菜单首层集成是否值得在 V1 做现代扩展；基础 Shell Verb 可以先交付。
