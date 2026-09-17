# QuickEdit v2.0+ 需求设计与演进规划

*QuickEdit v2.0+ Requirements, Architecture & Roadmap*

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Draft |
| 版本 | v2.0+ |
| 日期 | 2026-09-17 |
| 所属项目 | QuickEdit |
| 技术栈 | Tauri v2 + Vite + Vanilla TypeScript / HTML / CSS + Rust |
| 产品定位 | 轻量、本地、快速的通用文件工作台 |

---

## 1. 总体定位

QuickEdit v2.0+ 不改变基础版已经验证成功的方向：

> **快速打开文件、快速查看、查找、简单编辑、批注、保存。**

v2.0+ 主要补齐三类能力：

1. 更多常用格式的“足够好”查看能力；
2. 更可靠的编辑、恢复、冲突与批注能力；
3. 为 Agent / MCP 提供极薄的审阅和 UI 联动边界。

总体优先级：

```text
启动速度 / 小文件响应
>
查看与简单编辑
>
数据安全与可恢复
>
批注与查找
>
格式覆盖
>
大文件降级
>
Agent 联动
>
复杂工程能力
```

---

## 2. 非目标

即使进入 v2.0+，QuickEdit 仍不默认演进为：

- IDE；
- 完整 Office 套件；
- Web 项目运行器；
- 全量项目索引平台；
- Build / Debug / Test 系统；
- Git GUI；
- Agent 自主执行平台；
- 插件市场；
- 超大文件分析器。

---

## 3. v2.0+ 功能总览

| 模块 | 目标版本 | 优先级 | 定位 |
| --- | --- | --- | --- |
| PreviewCapability 统一 | v2.0 | P0 | Markdown / HTML 统一预览入口 |
| HTML 静态安全预览 | v2.0 | P1 | 单文件静态查看，不运行 JS |
| 崩溃恢复 | v2.0 | P0 | 防止未保存内容丢失 |
| 自动保存恢复草稿 | v2.0 | P0 | 不直接覆盖原文件 |
| 冲突检测 / 简单合并 | v2.0 | P1 | 处理外部修改 |
| Annotation V2 | v2.0 | P0 | 批注真正显示在源内容上 |
| 批注管理 | v2.0 | P1 | 搜索 / 标签 / 状态 / 导出 |
| 图片只读 Viewer | v2.1 | P1 | 常用文件快速查看 |
| XLSX 虚拟化 | v2.1 | P0 | 保证表格可用性 |
| 大文件 OpenMode | v2.1 | P1 | normal/lazy/readonly/external |
| PDF 大文件按页策略 | v2.1 | P1 | 不长时间冻结 |
| PPTX 只读 Viewer | v2.2 | P2 | Slide 级快速查看 |
| 工作区搜索增强 | v2.2 | P2 | 轻量、可取消、无长期索引 |
| Change Review | v2.2 | P1 | Agent / 外部修改审阅 |
| MCP Bridge | v2.2 | P2 | UI 联动与审阅状态反馈 |
| Hunk 级审批 | v2.3+ | P3 | 有实际需求再做 |
| PDF Range Reader | v2.3+ | P3 | 极端 PDF 再优化 |

---

## 4. PreviewCapability 统一

将格式特定能力：

```ts
markdownPreview: boolean;
htmlPreview: boolean;
```

统一为：

```ts
type PreviewType = "markdown" | "html";

interface PreviewCapability {
  type: PreviewType;
}

interface DocumentCapabilities {
  editable: boolean;
  searchable: boolean;
  replaceable: boolean;
  annotatable: boolean;

  preview?: PreviewCapability;
  paged?: boolean;
  spreadsheet?: boolean;
}
```

主 UI 只判断：

```ts
if (capabilities.preview) {
  showPreviewToggle();
}
```

PreviewCapability 只描述“是否有第二种阅读视图”，不负责文件 IO。

---

## 5. HTML 静态安全预览

### 5.1 定位

`.html / .htm` 继续使用 `TextHandler`：

```text
TextHandler
↓
DocumentSession
↓
编辑 / 预览
```

支持：

- HTML 源码编辑；
- Ctrl+F / Ctrl+H；
- 保存；
- 批注；
- 静态 Preview；
- 文档内 `<style>`。

### 5.2 安全模型

HTML 一律视为不可信内容。

```text
HTML Source
↓
DOMPurify
↓
sandbox iframe
↓
Static Preview
```

使用：

```html
<iframe sandbox=""></iframe>
```

不得启用 `allow-scripts`。

禁止：

- JavaScript；
- iframe；
- 表单提交；
- 页面导航；
- fetch / XHR；
- WebSocket；
- 外部 JS；
- Web 项目运行。

### 5.3 外部资源

V2.0 默认不保证：

- 外部 CSS；
- 本地相对图片；
- 网络图片；
- 外部字体；
- 多页面跳转。

只有实际需求充分时再逐项扩展。

---

## 6. 图片只读 Viewer

建议支持：

```text
.png
.jpg
.jpeg
.webp
.gif
.bmp
```

第一版能力：

- 打开；
- 自适应窗口；
- 原始尺寸；
- 放大 / 缩小；
- 旋转视图（不修改文件，可选）；
- 批注；
- 系统打开。

不做：

- 裁剪；
- 滤镜；
- 涂鸦；
- OCR；
- 图片内容编辑。

---

## 7. PPTX 只读 Viewer

### 7.1 定位

QuickEdit 只做：

> **快速浏览幻灯片内容。**

V2.2 可支持 `.pptx`，旧 `.ppt` 交给系统程序。

### 7.2 能力

- Slide 列表；
- 上一页 / 下一页；
- Slide Preview；
- 文本提取；
- Ctrl+F；
- 批注；
- 系统打开。

不做：

- PPTX 编辑；
- 动画；
- SmartArt 编辑；
- 母版编辑；
- 图表编辑；
- PowerPoint 像素级一致。

---

## 8. 工作区搜索增强

### 8.1 定位

当前文档 Ctrl+F 仍是主搜索能力。

v2.2+ 可以增加**轻量 Workspace Search**：

> 快速在当前 Workspace 中临时查找文本。

不是百万文件 IDE 索引系统。

### 8.2 搜索范围

默认扫描：

- TextHandler 可识别文本；
- Markdown；
- HTML；
- JSON / XML / YAML / LOG；
- 可选 XLSX 当前工作簿文本；
- 后续 PDF / DOCX / PPTX 已提取文本。

默认排除：

- `.qnote`；
- 二进制文件；
- `node_modules`；
- `.git`；
- 可配置忽略目录；
- 超过 Handler 搜索限制的文件。

### 8.3 无长期索引

V2.2 默认：

```text
按需扫描
+
渐进返回
+
可取消
```

不做：

- SQLite FTS 常驻索引；
- 后台全文索引服务；
- 启动预扫描；
- 全工作区自动维护索引。

### 8.4 不做跨文件替换

仍不提供：

```text
Workspace Replace All
```

复杂批量修改继续交给专业工具或 Agent。

---

## 9. 大文件策略

统一：

```ts
type OpenMode =
  | "normal"
  | "lazy"
  | "readonly"
  | "external";
```

每个 Handler 自己返回：

```ts
interface OpenDecision {
  mode: OpenMode;
  reason?: string;
}
```

核心原则：

> **宁可多次短等待，不允许一次长时间冻结。**

优先级：

```text
UI 可响应
>
第一批内容出现
>
完整文件全部加载
```

示例：

```text
Text
小文件     → normal
超过限制   → external

PDF
普通       → lazy
很大       → lazy
极端       → external

XLSX
小         → normal
较大       → lazy
超大       → readonly
极端       → external
```

---

## 10. XLSX 虚拟化

打开流程：

```text
Workbook
↓
Metadata / Sheet Names
↓
用户选择 Sheet
↓
加载当前 Sheet
↓
只渲染当前可视区域
```

### 10.1 Row Virtualization

例如 100000 行：

```text
实际 DOM：
当前视口约 40~80 行
+
上下 buffer
```

禁止全部 Row / Cell 同时创建 DOM。

### 10.2 Column Virtualization

V2.1 第一版可暂缓。

只有列数导致明显性能问题时再增加。

### 10.3 大型工作簿降级

```text
Normal
↓
Lazy
↓
Readonly
↓
External
```

Readonly 仍支持：

- Sheet 切换；
- Ctrl+F；
- 批注；
- 系统打开。

---

## 11. 崩溃恢复

### 11.1 目标

QuickEdit 崩溃、系统重启或进程被杀后：

> 未保存文本修改尽可能恢复。

### 11.2 Recovery Draft

默认不自动覆盖原文件。

为 dirty 文档保存：

```text
Recovery Draft
```

建议目录：

```text
%LOCALAPPDATA%/QuickEdit/recovery/
```

模型：

```ts
interface RecoveryDraft {
  documentPath: string;

  baseSize: number;
  baseModifiedTime: string;

  content: string;

  createdAt: string;
  updatedAt: string;
}
```

### 11.3 启动恢复

```text
发现 Recovery Draft
↓
比较原文件状态
↓
提示恢复
```

UI：

```text
发现 2 个未保存文档

README.md
[恢复] [查看差异] [丢弃]

config.json
[恢复] [查看差异] [丢弃]
```

---

## 12. 自动保存

### 12.1 定位

QuickEdit 默认的“自动保存”不是自动覆盖原文件，而是：

> **自动保存恢复草稿。**

### 12.2 触发

例如：

```text
dirty 后 2 秒 debounce
```

只保存恢复数据。

优先支持：

- Text；
- Markdown；
- HTML。

XLSX 自动保存原工作簿不是 V2.0 默认能力。

### 12.3 正常保存后

Ctrl+S 成功：

```text
删除对应 Recovery Draft
```

---

## 13. 外部修改冲突与简单合并

### 13.1 基础冲突 UI

```text
QuickEdit 内存 dirty
+
磁盘文件被外部修改
```

保存时：

```text
文件已被外部修改

[重新加载磁盘版本]
[查看差异]
[另存为]
[仍然覆盖]
```

### 13.2 Text 三方合并

V2.0+ 可对 Text：

```text
Base
QuickEdit Local
Disk Remote
```

执行简单 three-way merge。

无冲突：

```text
生成 merged content
↓
用户确认
```

有冲突：

```text
可视化冲突块
```

不为 XLSX / PDF / DOCX / PPTX 设计通用三方合并。

---

## 14. Annotation V2

Annotation V2 的目标：

> **批注必须显式附着在内容上，而不是只存在右侧备注列表。**

具体设计见：

`QuickEdit_Annotation_V2_Requirements_Design.md`

核心能力：

- Text Range Anchor；
- 源内容 Highlight / Marker；
- Excel Cell Marker；
- PDF Page / Overlay Marker；
- 批注管理；
- 搜索；
- 标签；
- 状态；
- 导出；
- MCP 读取 / 更新。

---

## 15. 批注搜索

支持：

```text
当前文件批注搜索
```

v2.1+：

```text
当前 Workspace 批注搜索
```

搜索字段：

- annotation text；
- tag；
- target file；
- status；
- createdAt / updatedAt。

按需扫描 `*.qnote`，不在启动时全量扫描。

---

## 16. 批注标签

Annotation 增加：

```ts
tags?: string[];

status:
  | "open"
  | "resolved";
```

标签示例：

```text
TODO
问题
确认
重要
Agent
```

不引入负责人、截止日期、权限流等项目管理概念。

---

## 17. 批注导出

优先支持：

```text
Markdown
JSON
```

Markdown 面向阅读。

JSON 面向：

- Agent；
- 数据迁移；
- 外部工具链。

---

## 18. Agent Change Review

目标：

> **QuickEdit 成为 Agent 文件修改后的审阅与回滚层。**

具体见：

`QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`

核心对象：

```text
ChangeSet
```

状态：

```text
recording
pending
approved
rejected
conflict
```

用户确认后：

```text
保留 Audit Record
删除 Rollback Payload
```

用户回滚后：

```text
恢复 baseline
保留 rejected Audit Record
删除已消费 Rollback Payload
```

---

## 19. MCP Bridge

MCP 不重复 Claude Code 已有文件工具。

不优先提供：

- read_file；
- write_file；
- run_shell；
- delete_file；
- git。

MCP 主要提供：

```text
QuickEdit UI 联动
+
审批状态
+
批注
```

第一批工具：

```text
document.get_active_context
document.open
document.reveal

review.begin
review.capture
review.get
review.history

annotations.list
annotations.create
annotations.update
annotations.resolve
annotations.reveal
```

Agent 不允许调用：

```text
review.approve
review.reject
```

审批只能由用户在 QuickEdit UI 操作。

---

## 20. Change Review 与 CLI Agent

推荐方式：

```text
QuickEdit Terminal
↓
claude / codex / 其他 CLI Agent
```

Agent 使用自己的：

- Read；
- Edit；
- Write；
- Shell。

QuickEdit MCP 负责：

- baseline；
- ChangeSet；
- UI 定位；
- 批注；
- 审批结果。

不复制 Agent 自己的权限系统。

---

## 21. v2.0+ 数据目录建议

```text
%LOCALAPPDATA%/QuickEdit/
├── config.json
├── workspace.json
├── recovery/
├── reviews/
│   ├── audit/
│   └── rollback/
└── logs/
```

Sidecar：

```text
target.ext.qnote
```

仍保留在目标文件同目录。

---

## 22. 里程碑

### M1 — 基础可靠性

- PreviewCapability；
- Recovery Draft；
- 自动恢复草稿；
- External Conflict UI；
- Annotation V2 Text Anchor。

退出条件：

```text
崩溃后未保存文本可恢复
批注能明显显示在文本内容上
Markdown / HTML Preview 共用 Capability
```

### M2 — 阅读与批注体验

- HTML 安全 Preview；
- 图片 Viewer；
- Annotation Manager；
- 标签 / 搜索 / 导出；
- PDF / XLSX 批注 Decoration。

### M3 — 大文件与 XLSX

- OpenMode；
- PDF Page Window；
- XLSX Sheet Lazy；
- Row Virtualization；
- Readonly fallback。

### M4 — Agent Review

- ChangeSet；
- Baseline；
- Diff Review；
- Approve / Rollback；
- Audit Record；
- MCP `review.*`；
- `document.get_active_context/open/reveal`。

### M5 — 后续格式与工作区增强

- PPTX Viewer；
- Workspace Search；
- Annotation Workspace Search；
- DOCX / PPTX Search；
- MCP Annotation tools。

---

## 23. 推荐开发顺序

```text
1. Recovery / Auto Draft
2. Annotation V2 Anchor + Inline Decoration
3. PreviewCapability
4. HTML Static Preview
5. XLSX Virtualization
6. PDF / Large File OpenMode
7. Annotation Manager + Tags + Export
8. Image Viewer
9. Change Review
10. MCP Bridge
11. Workspace Search
12. PPTX Viewer
```

理由：

> 数据可靠性和批注体验属于 QuickEdit 本体；Agent 联动必须建立在本体足够稳定之后。

---

## 24. 总结

QuickEdit v2.0+ 的方向不是加入越来越多专业工具能力，而是：

> **把“文件工作台”本身做得更可靠、更清楚、更容易与外部工具协作。**

最终形成：

```text
QuickEdit
├── 快速 Viewer / Editor
├── Preview
├── Search
├── Recovery
├── Annotation
├── Change Review
└── MCP UI Bridge
```

复杂分析、Agent Planning、Shell Execution 仍交给 Claude Code / Codex / 其他专业工具。

QuickEdit 负责：

> **查看、定位、批注、审阅、确认。**
