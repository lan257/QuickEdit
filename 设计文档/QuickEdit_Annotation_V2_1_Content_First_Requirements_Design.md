# QuickEdit Annotation V2.1 需求与设计文档

*Content-first Annotation Redesign*

| 项目 | 内容 |
| --- | --- |
| 状态 | Draft |
| 版本 | v2.1 |
| 日期 | 2026-09-18 |
| 依据 | `lan257/QuickEdit` 当前 `master` |
| 审阅快照 | tree `88949a497a6ae760f41b414dfef1cecde9b4b657` |

> 本文档针对当前 V1.1.0 已实现的 `.qnote` 批注系统做交互重构。保留现有存储、Rust 原子写、损坏恢复、重命名同步和 stale 检测，只重做“批注如何附着、如何显示、如何定位、如何创建”。

---

## 1. 当前实现评估

当前系统已经完成了完整的数据闭环：

```text
选择范围 / 页 / 单元格
→ AnnotationEntry
→ .qnote
→ Rust load/save/recover
→ 右侧批注列表
→ 点击列表定位源内容
```

当前代码中：

- `src/main.ts` 约第 18 行定义 `AnnotationScope`；
- 约第 75 行定义 `AnnotationEntry`；
- 约第 989 行捕获 Markdown Preview 选区；
- 约第 1024 行生成当前 Annotation Context；
- 约第 1087 行 `focusAnnotation()`；
- 约第 1125 行 `renderNotes()`；
- 约第 1228 行加载批注；
- 约第 1256 行保存批注；
- `index.html` 约第 88–95 行定义整个批注 Panel；
- `src/styles.css` 约第 96–125 行定义 Panel、Card、Composer；
- `src-tauri/src/lib.rs` 约第 137 行起定义 Annotation 数据；
- 约第 878/937 行提供 `load_annotations` / `save_annotations`。

因此当前问题不是“批注功能不存在”，而是：

> **数据存在，但正文里几乎看不见。**

### 1.1 当前最主要的体验问题

**Text：** 点击批注只是：

```ts
textEditorElement.setSelectionRange(start, end)
```

用户下一次点击以后，视觉标记立即消失。

**Markdown Preview：** 当前使用：

```ts
source.indexOf(quote)
```

重复文本时可能绑定到第一次出现的位置，而不是用户真正选中的位置。

**XLSX：** 点击批注能跳到 Cell，但 Cell 本身没有持续 Marker。

**PDF：** 点击批注能跳到 Page，但 Page 本身没有“这里有批注”的持续标记。

**Panel：** 当前交互以右侧 Panel 为中心，用户需要主动打开 Panel 才知道文件是否、在哪里存在批注。

---

## 2. V2.1 核心目标

本轮只解决四件事：

### G1 — 看得见

关闭批注 Panel 后，正文仍然能看到批注存在。

### G2 — 找得到

普通文本编辑后，局部批注尽可能继续跟随原内容。

### G3 — 点得通

正文 Marker 与右侧批注 Card 双向定位。

### G4 — 不打扰

没有批注时不占正文空间；创建批注不要求手动理解和选择 Scope。

---

## 3. 核心交互改为 Content-first

当前：

```text
打开批注 Panel
→ 选择“全文 / 当前选区 / 当前页 / 当前单元格”
→ 输入
→ 添加
```

V2.1：

```text
先操作正文
→ QuickEdit 自动识别 Context
→ 添加批注
```

规则：

| 当前上下文 | 自动 Scope |
| --- | --- |
| Text 有选区 | `text-range` |
| XLSX 有活动 Cell | `cell` |
| PDF 当前页 | `page` |
| 无局部上下文 | `general` |

Scope Dropdown 不再作为主要入口。

---

## 4. Text 批注体验

### 4.1 创建

用户选中文字后出现轻量入口：

```text
┌────────┐
│ + 批注 │
└────────┘
```

点击后显示 Composer：

```text
┌──────────────────────────┐
│ “timeout = 30”           │
│                          │
│ 输入批注…                │
│              取消  添加  │
└──────────────────────────┘
```

可选快捷键：

```text
Ctrl + Alt + M
```

### 4.2 持续展示

创建后，即使取消文本 Selection、关闭 Panel：

```text
const timeout = 30;
      └────────┘ ①
```

仍然显示：

- 轻量 Highlight；
- 或细下划线；
- gutter / margin Marker。

### 4.3 Hover / Click

Hover：

```text
这里需要确认超时设置
L23 · TODO
```

Click Marker：

```text
activeAnnotationId = id
→ 打开 Panel
→ 对应 Card 高亮
```

Click Card：

```text
→ Editor reveal range
→ 对应 Highlight 激活
```

---

## 5. Text Editor 技术决策

### 推荐：Minimal CodeMirror 6

当前原生 `<textarea>` 不适合做持久 Range Decoration。

继续做 textarea mirror overlay 会要求长期同步：

- 字体；
- line-height；
- Tab；
- wrapping；
- 横向/纵向滚动；
- IME；
- resize；
- WebView2 渲染。

因此 V2.1 推荐将文本编辑器替换为**最小配置 CodeMirror 6**。

只启用：

- 普通文本编辑；
- selection；
- undo/redo；
- Decoration；
- gutter marker；
- scroll/reveal；
- transaction change mapping。

明确不启用：

- 自动补全；
- LSP；
- lint；
- minimap；
- diagnostics；
- folding；
- Git decoration；
- 项目索引。

使用 CodeMirror 的目的只有：

> **得到可靠的 Selection、Range Decoration 和位置映射。**

这不改变 QuickEdit 的“轻量文件工作台”定位。

---

## 6. 文本 Anchor V2

V1：

```json
{
  "start": 1024,
  "end": 1036,
  "quote": "timeout = 30"
}
```

V2：

```json
{
  "scope": "text-range",
  "locator": {
    "start": 1024,
    "end": 1036
  },
  "anchor": {
    "quote": "timeout = 30",
    "prefix": "const ",
    "suffix": ";"
  }
}
```

推荐：

- `prefix`: 24–48 chars；
- `quote`: 原选区；
- `suffix`: 24–48 chars。

---

## 7. Re-anchor 算法

重新打开文件时，每条 Text Annotation：

### Step 1 — 原 Offset

检查：

```ts
source.slice(start, end) === anchor.quote
```

成功即 `resolved`。

### Step 2 — Quote 唯一搜索

Quote 只出现一次：

```text
resolved
```

### Step 3 — Context 消歧

Quote 出现多次时，比较：

```text
prefix + quote + suffix
```

选择上下文匹配度最高的候选。

### Step 4 — Ambiguous

多个候选无法可靠区分：

```text
ambiguous
```

不得像当前 `indexOf()` 一样直接绑定第一个。

### Step 5 — Orphaned

找不到：

```text
orphaned
```

Panel 显示：

```text
⚠ 原位置已无法定位
```

不得静默删除。

---

## 8. 编辑过程中的自动跟随

采用 CodeMirror 后，Annotation Decoration 应随 Editor Transaction 移动。

例如：

```text
批注原位置：100~112
用户在文件开头插入 20 字符
```

运行时位置自动成为：

```text
120~132
```

不需要立即重新全文搜索 Quote。

Ctrl+S 成功后，再把运行时位置更新到 `.qnote`。

---

## 9. stale 语义调整

当前 Rust 的 `target.name/size/modifiedTime` stale 检测继续保留。

但 V2.1 中：

```text
Document stale
≠
所有 Annotation stale
```

收到 `stale=true` 后逐条 Resolve：

```text
文件已变化
✓ 5 条已重新定位
⚠ 1 条无法定位
```

而不是只显示：

```text
所有批注可能对应旧版本
```

---

## 10. Markdown

### Edit 模式

Markdown 和普通 Text 使用同一套：

```text
CodeMirror + text-range Decoration
```

### Preview 模式

V2.1 不实现复杂 Source Map。

如果 `anchor.quote` 在 Preview 可见文本中能够唯一、安全匹配，可以轻量 Highlight。

否则：

```text
不猜位置
```

点击 Card：

```text
切回 Edit
→ reveal source anchor
```

彻底取消“重复文本用第一次 `indexOf()` 定位”的行为。

---

## 11. XLSX 批注展示

当前 Cell 定位能力保留，增加持久 Marker。

示例：

```text
┌──────────────┐
│  1234       ●│
└──────────────┘
```

要求：

- Marker 来自 `.qnote`；
- 不写入 XLSX；
- active Cell 有轻量强调；
- 同一 Cell 多条批注显示数量；
- 点击 Marker 显示该 Cell 批注；
- 点击 Panel Card 继续切 Sheet + scroll Cell。

---

## 12. PDF 批注展示

V2.1 保持 Page Scope，不急着做文字区域批注。

有批注页面：

```text
Page 17                         ●2
┌───────────────────────────────┐
│                               │
│              PDF              │
│                               │
└───────────────────────────────┘
```

Marker 放在 Page Host 边缘。

关闭 Panel 后仍可见。

点击 Marker：

```text
打开该页批注
```

真正 PDF 文本 Range / Rect Annotation 等有 text layer 后再做。

---

## 13. Annotation Panel 新定位

Panel 不再是“唯一展示地点”，而是：

> **批注管理器。**

### Header

建议：

```text
批注 4
README.md

[全部] [未解决]
```

`.qnote` 完整路径放 Tooltip / 更多菜单，不占主要视觉空间。

### Card

建议：

```text
┌─────────────────────────────┐
│ L23–L24                TODO │
│ “timeout = 30”              │
│                             │
│ 这里需要确认                │
│                             │
│ 2 分钟前                ··· │
└─────────────────────────────┘
```

信息优先级：

1. 在哪里；
2. 原文是什么；
3. 批注是什么；
4. 状态 / 标签；
5. 时间 / 操作。

不要继续让“当前选区”成为最显眼的信息。

---

## 14. Composer 改造

当前 Composer 永久占据 Panel 底部。

V2.1 改为按需出现：

- Text 选区点“批注”；
- Cell Marker / Add；
- PDF Page Add；
- Panel 顶部“+ 文件批注”；
- 编辑已有批注。

默认阅读状态下 Composer 隐藏。

---

## 15. Schema V2

建议：

```json
{
  "version": 2,
  "target": {
    "name": "app.ts",
    "size": 12544,
    "modifiedTime": 1789700000000
  },
  "updatedAt": "...",
  "annotations": [
    {
      "id": "01J...",
      "scope": "text-range",
      "locator": {
        "start": 1024,
        "end": 1036
      },
      "anchor": {
        "quote": "timeout = 30",
        "prefix": "const ",
        "suffix": ";"
      },
      "text": "这里需要确认",
      "status": "open",
      "tags": [],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 16. V1 兼容

现有 V1 `.qnote` 必须继续打开。

V1：

```text
scope = selection
locator.quote
locator.preview
```

运行时迁移为：

```text
scope = text-range
anchor.quote = locator.quote
```

如果当前文件仍可定位，则补算 `prefix/suffix`。

只有用户真正修改批注或保存更新后的 Anchor 时，才原子写为 Schema V2。

不得在“仅打开文件”时静默改写旧 qnote。

---

## 17. Status 与 Tags

P1 增加：

```ts
status: "open" | "resolved";
tags?: string[];
```

默认快捷标签可以有：

```text
TODO
问题
确认
重要
Agent
```

但不要求每条批注打标签。

不增加：

- 负责人；
- Deadline；
- 权限；
- 评论 Thread；
- Workflow。

---

## 18. 前端架构重构

当前 `src/main.ts` 已超过 100 KB，同时承担 Workspace、文件格式、Markdown、查找、批注、Terminal 等逻辑。

Annotation V2.1 不应继续堆进 `main.ts`。

建议：

```text
src/
├── annotations/
│   ├── types.ts
│   ├── annotation-service.ts
│   ├── annotation-state.ts
│   ├── migration.ts
│   ├── text-anchor.ts
│   ├── renderers/
│   │   ├── text-renderer.ts
│   │   ├── spreadsheet-renderer.ts
│   │   └── pdf-renderer.ts
│   └── ui/
│       ├── annotation-panel.ts
│       ├── annotation-card.ts
│       └── annotation-composer.ts
└── editor/
    └── text-editor.ts
```

`main.ts` 最终只协调：

```text
annotationController.attachSession(...)
annotationController.detachSession(...)
annotationController.togglePanel()
```

---

## 19. AnnotationService

负责数据，不负责 DOM：

```ts
interface AnnotationService {
  load(path: string): Promise<AnnotationState>;
  create(input: CreateAnnotationInput): Promise<AnnotationEntry>;
  update(id: string, patch: AnnotationPatch): Promise<void>;
  remove(id: string): Promise<void>;
  resolve(id: string): Promise<void>;
  reopen(id: string): Promise<void>;
  persist(): Promise<void>;
}
```

---

## 20. Renderer Adapter

每种格式只负责：

> 批注在这个 View 上怎么画、怎么定位。

```ts
interface AnnotationRenderer {
  render(annotations: ResolvedAnnotation[]): void;
  setActive(id: string | null): void;
  reveal(annotation: ResolvedAnnotation): Promise<void>;
  clear(): void;
}
```

实现：

```text
TextAnnotationRenderer
SpreadsheetAnnotationRenderer
PdfAnnotationRenderer
```

---

## 21. Runtime 状态

增加：

```ts
let activeAnnotationId: string | null = null;
```

以及：

```ts
type AnnotationResolution =
  | "resolved"
  | "ambiguous"
  | "orphaned";
```

Resolution 不写入 `.qnote`，它是当前文件内容下的运行时结果。

---

## 22. Rust 层

保留现有：

```text
load_annotations
save_annotations
recover_annotations
rename_document
```

只扩展 `AnnotationEntry`：

- anchor；
- status；
- tags；
- source（可选，为未来 MCP/Agent 预留）。

Rust 继续负责：

- Schema 兼容；
- 原子写；
- qnote recovery；
- rename transaction；
- target stale。

Text Re-anchor 和 View Decoration 不放到 Rust。

---

## 23. 保存顺序

文本保存：

```text
Editor Runtime Range 已随编辑移动
→ Ctrl+S 保存源文件
→ 文件保存成功
→ 更新 Annotation locator
→ 保存 qnote
```

若源文件成功、qnote 失败：

```text
文件已保存，但批注位置更新失败。
批注文件仍保留旧位置，可稍后重新定位。
```

不得为了 qnote 失败回滚已经成功保存的用户文档。

---

## 24. 性能边界

不做复杂批注索引。

要求：

- 只加载当前文件 `.qnote`；
- Text Decoration 只处理当前文档；
- XLSX 只装饰当前 Sheet 可见 Cell；
- PDF 只装饰已创建的 Page Host；
- 切换文档时 `renderer.clear()`；
- 启动不扫描 Workspace；
- Workspace Annotation Search 留到后续。

---

## 25. 实施阶段

### Phase 1 / P0 — Text 体验先验收

只做：

1. Annotation 模块拆分；
2. V1/V2 schema adapter；
3. Minimal CodeMirror；
4. Text Anchor；
5. Re-anchor；
6. Persistent Highlight / Marker；
7. Marker ↔ Card 双向定位；
8. Context-aware Composer；
9. orphaned / ambiguous。

**必须先人工验收再继续。**

### Phase 2 / P1 — 非文本 Marker

- XLSX Cell Marker；
- PDF Page Marker；
- Markdown Preview 安全映射；
- open / resolved；
- tags。

### Phase 3 / P2 — 管理增强

- 当前文件批注搜索；
- Markdown / JSON 导出；
- Workspace Annotation Search；
- DOCX/PPTX/Image 后续 Renderer；
- MCP Annotation Tools。

---

## 26. 第一阶段唯一关键验收流程

Coding Agent 必须先证明：

```text
打开 .txt
→ 选中一句话
→ 添加批注
→ 点击别处
→ 那句话仍然明显带有批注标记
→ 关闭批注 Panel
→ 标记仍存在
→ 点击标记
→ 对应批注立即出现
→ 在该批注前插入几行
→ 批注仍跟随原内容
→ 保存并重新打开
→ 批注仍定位正确
```

如果这一流程体验不好：

> **不得继续做标签、搜索、PDF、Excel 等扩展。**

---

## 27. 验收标准

### Text

- 取消 Selection 后 Annotation 仍可见；
- Panel 关闭后 Marker 仍可见；
- 点击 Marker 打开正确 Card；
- 点击 Card reveal 正确 Range；
- 前方插入内容后 Range 自动移动；
- 重开文件后可重新定位；
- Quote 删除后显示 orphaned；
- 重复 Quote 不得误绑第一个。

### XLSX

- 有批注 Cell 永久显示 Marker；
- Marker 不写入 XLSX；
- 点击 Marker 可读批注；
- 点击 Card 能切 Sheet 并定位 Cell。

### PDF

- 有 Page Annotation 的页面显示 Marker；
- Panel 关闭后 Marker 仍可见；
- 点击 Marker 显示该页批注；
- 不要求本轮实现文字级坐标。

### qnote

- V1 文件兼容；
- 原子写保留；
- rename 同步保留；
- damaged qnote recovery 保留；
- stale 检测保留；
- orphaned 不删除；
- 源文件绝不写入批注数据。

---

## 28. 本轮明确禁止顺手开发

实现本需求时不要同时加入：

- MCP；
- Agent Review；
- Workspace 全文搜索；
- Recovery；
- HTML Preview；
- PPTX；
- 图片 Viewer；
- Excel Virtualization；
- Theme 重构。

这次只把 Annotation UX 做对。

---

## 29. 最终判断标准

Annotation V2.1 成不成功，不看：

```text
Schema 多复杂
抽了多少 Service
支持多少 Scope
```

只看：

> **用户不打开批注面板时，能不能一眼知道“这里有批注”，并且点一下就知道批注是什么。**

这应该成为本轮开发的最高验收标准。
