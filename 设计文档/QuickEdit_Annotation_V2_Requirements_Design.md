# QuickEdit Annotation V2 需求设计文档

*Annotation V2 Requirements & Design*

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Draft |
| 版本 | v2.0 |
| 日期 | 2026-09-17 |
| 所属项目 | QuickEdit |

---

## 1. 背景

现有 `.qnote` 已经解决：

```text
批注如何独立于源文件保存
```

但仍存在明显缺陷：

> **批注没有充分显示在源内容上。**

尤其局部内容批注，如果只在右侧 Annotation Panel 中展示，很容易退化成“文件备注”，而不是真正的“内容批注”。

Annotation V2 的目标是：

> **让批注明确附着在 Text / Cell / Page / Slide / Region 上，并且可以快速搜索、定位、管理和导出。**

---

## 2. 总体原则

- 不修改源文件；
- `.qnote` 继续作为 sidecar；
- Decoration / Overlay 仅属于 UI；
- Locator + Anchor 尽量稳定；
- 文件内容变化后尽可能 re-anchor；
- 失效批注不得静默消失；
- 批注管理保持轻量，不发展成 Jira / 评论协作平台。

---

## 3. Annotation Schema V2

建议：

```json
{
  "version": 2,
  "target": {
    "name": "README.md",
    "size": 12345,
    "modifiedTime": "..."
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
      "text": "这里需要确认。",
      "tags": ["TODO", "Agent"],
      "status": "open",
      "source": "user",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 4. Annotation Scope

```ts
type AnnotationScope =
  | "general"
  | "text-range"
  | "cell"
  | "page"
  | "slide"
  | "region";
```

---

## 5. Text Range Anchor

### 5.1 Locator

```ts
interface TextRangeLocator {
  start: number;
  end: number;
}
```

### 5.2 Anchor

仅有 offset 不够稳定，增加：

```ts
interface TextAnchor {
  quote: string;
  prefix?: string;
  suffix?: string;
}
```

### 5.3 Re-anchor

打开文件时：

```text
1. 检查原 offset
2. quote 是否仍匹配
3. 不匹配则搜索 quote
4. 多个匹配时用 prefix / suffix 消歧
5. 成功 → 更新运行时 locator
6. 失败 → 标记 orphaned
```

不自动改写 `.qnote`，除非用户保存或系统确认重新关联。

---

## 6. Text / Code 批注展示

建议视觉：

```text
23  const timeout = 30;
          ───────────
               ①
```

UI 可组合：

- 文本轻量 Highlight；
- gutter marker；
- hover popover；
- 右侧 Panel 卡片。

点击源码 Marker：

```text
打开批注
```

点击右侧卡片：

```text
reveal source
```

---

## 7. Markdown / HTML

### 编辑模式

使用：

```text
text-range
```

直接标记源文本。

### Preview 模式

V2.0 不要求建立精确：

```text
Preview DOM → Source Offset
```

如果能可靠映射则显示 decoration；否则：

```text
Panel 中保留批注
+
点击切回 Edit 并定位
```

避免为 Preview 批注映射引入过度复杂度。

---

## 8. XLSX 批注展示

Scope：

```text
cell
```

Locator：

```json
{
  "sheet": "Sheet1",
  "cell": "B3"
}
```

UI：

- Cell 右上角 Marker；
- 选中 Cell 时显示批注图标；
- 批注 Cell 可轻量边框；
- 点击 Panel 自动切换 Sheet + reveal Cell。

---

## 9. PDF 批注展示

V2.0：

```text
page scope
```

UI：

- 页边缘 marker；
- page badge；
- 右侧批注 Panel；
- 点击批注跳对应页。

V2.1+ 可增加：

```text
region
```

页面相对坐标：

```ts
interface PageRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
```

坐标归一化到 `0..1`，避免 zoom 变化。

---

## 10. PPTX / Image Region

后续：

```text
PPTX → slide
Image → region
```

第一版只要求：

```text
slide / page / general
```

Region Annotation 作为 P3 增强。

---

## 11. Annotation 状态

```ts
type AnnotationStatus =
  | "open"
  | "resolved";
```

支持：

- resolve；
- reopen。

不增加：

- assignedTo；
- priority workflow；
- deadline；
- multi-user approval。

---

## 12. 标签

```ts
tags?: string[];
```

支持：

- 创建标签；
- 添加 / 删除标签；
- 按标签过滤。

默认可提供快捷标签：

```text
TODO
问题
确认
重要
Agent
```

标签本身是自由文本。

---

## 13. Annotation Manager

右侧 Panel：

```text
批注

[搜索____________]
[全部] [未解决] [已解决]

标签：
[TODO] [重要] [Agent]

① line 23
   这里需要确认
   TODO

② Sheet1!B3
   金额异常
   Agent
```

操作：

- reveal；
- edit；
- resolve；
- reopen；
- delete。

---

## 14. 批注搜索

### 当前文件

P1：

```text
annotation text
tag
status
```

### Workspace

P2：

按需扫描：

```text
*.qnote
```

不在启动时扫描。

结果渐进返回，可取消。

---

## 15. 批注导出

### Markdown

```markdown
# README.md 批注

## Line 23

标签：TODO

这里需要确认。
```

### JSON

保留结构化信息：

```text
file
locator
text
tags
status
timestamps
source
```

用途：

- Agent；
- 迁移；
- 外部备份。

---

## 16. Orphaned Annotation

当定位失败：

```text
status 不变
runtimeState = orphaned
```

UI：

```text
⚠ 无法定位到原内容
```

仍允许：

- 查看批注；
- 手动重新关联；
- 删除；
- 导出。

不得静默丢弃。

---

## 17. AnnotationService

```ts
interface AnnotationService {
  list(documentId: string): Annotation[];

  create(input: CreateAnnotationInput): Promise<Annotation>;

  update(
    id: string,
    patch: AnnotationPatch
  ): Promise<void>;

  resolve(id: string): Promise<void>;

  reopen(id: string): Promise<void>;

  delete(id: string): Promise<void>;

  search(query: AnnotationQuery): Promise<AnnotationSearchResult[]>;

  export(
    scope: AnnotationExportScope,
    format: "markdown" | "json"
  ): Promise<string>;
}
```

---

## 18. Renderer Adapter

每种 View 只负责“如何画出 Annotation”。

```ts
interface AnnotationRenderer {
  render(
    annotations: Annotation[],
    session: DocumentSession
  ): void;

  reveal(annotation: Annotation): Promise<void>;

  clear(): void;
}
```

实现：

```text
TextAnnotationRenderer
SpreadsheetAnnotationRenderer
PdfAnnotationRenderer
PptxAnnotationRenderer
ImageAnnotationRenderer
```

AnnotationService 不关心 DOM / Canvas。

---

## 19. MCP Annotation Tools

推荐：

```text
annotations.list
annotations.create
annotations.update
annotations.resolve
annotations.reveal
```

Agent 可以：

- 读取用户批注；
- 按批注执行任务；
- 创建解释性批注；
- 将已处理批注标记 resolved。

---

## 20. 权限边界

批注建议记录来源：

```ts
source:
  | "user"
  | "agent";
```

Agent 不得默认删除用户批注。

删除优先保留给用户 UI。

---

## 21. qnote 写入安全

继续使用：

```text
temp file
↓
atomic replace
```

命名保持：

```text
target.ext.qnote
```

---

## 22. 性能

- 当前文件只加载当前 `.qnote`；
- Workspace Annotation Search 按需执行；
- Annotation Decoration 数量较大时按 viewport 渲染；
- PDF / XLSX 只渲染当前可见范围 marker；
- 不在启动时全 Workspace 扫描 `.qnote`。

---

## 23. 实施阶段

### P0

- Schema V2；
- Text Anchor；
- Text inline decoration；
- orphaned；
- Annotation Panel reveal。

### P1

- Tags；
- Search；
- Resolve / Reopen；
- Export；
- XLSX Cell Marker；
- PDF Page Marker。

### P2

- Workspace Annotation Search；
- MCP tools；
- DOCX / PPTX markers。

### P3

- Region Annotation；
- advanced re-anchor；
- Image region；
- Preview DOM precise mapping。

---

## 24. 验收标准

1. 文本局部批注重新打开后仍可定位；
2. 文件前方插入文本后，批注能尽量 re-anchor；
3. re-anchor 失败时显示 orphaned；
4. XLSX 批注可定位 Cell；
5. PDF 批注可跳页；
6. Panel 搜索可过滤文本 / 标签 / 状态；
7. 可导出 Markdown / JSON；
8. `.qnote` 仍不修改源文件；
9. Agent 可读取批注但不得自动删除用户批注。

---

## 25. 总结

Annotation V2 的核心不是增加更多字段，而是：

> **让批注从侧栏备注升级为真正附着在内容上的交互对象。**

这是 QuickEdit v2.0 最重要的本体增强之一。
