# QuickEdit 待开发文档（v2.0+ Backlog）

版本：v1.2
日期：2026-09-24
状态：v2.0 / v2.1 探索版已实现到 Phase 8（详见 §11 状态总表），两轮复验待办 9 条已全部实现（§12）；Phase 9 MCP Bridge 尚未开始
依据：

- `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md`（v2.0+ 需求设计与演进规划）
- `设计文档/QuickEdit_V2_Exploration_Overnight_Implementation_Design.md`（v2 探索版需求与实施设计，Phase 0–9，已实现部分的直接依据）
- `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md`（Annotation V2 需求设计）
- `设计文档/QuickEdit_Annotation_V2_1_Content_First_Requirements_Design.md`（Annotation V2.1 内容优先批注设计，已实现）
- `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`（Agent Change Review & MCP Bridge 需求设计）
- `docs/QuickEdit_V1_Stable_V2_Plan_v1.md`（V1 计划，V2 排期以上述设计文档为准）

> 本文是 v2.0+ 待开发项的单一入口。设计文档（Draft）调整时先更新设计文档，再同步本文；启动任一条目前须走开发阶段闸门（需求确认 → 方案确认 → Demo → 完整测试）。
>
> 旧版 `docs/QuickEdit_Undeveloped_v1.md` 已废弃，仅作 V2 排期前历史参考。

---

## 1. 产品定位与总体方向

v2.0+ 不改变基础版已验证的方向：**快速打开文件、快速查看、查找、简单编辑、批注、保存**。主要补齐三类能力：

1. 更多常用格式的"足够好"查看能力；
2. 更可靠的编辑、恢复、冲突与批注能力；
3. 为 Agent / MCP 提供极薄的审阅和 UI 联动边界。

总体优先级：

```text
启动速度 / 小文件响应 > 查看与简单编辑 > 数据安全与可恢复 > 批注与查找 > 格式覆盖 > 大文件降级 > Agent 联动 > 复杂工程能力
```

产品终态：QuickEdit 负责 **查看、定位、批注、审阅、确认**；复杂分析、Agent Planning、Shell Execution 交给 Claude Code / Codex 等专业工具。

## 2. 非目标（v2.0+ 仍不默认演进为）

IDE；完整 Office 套件；Web 项目运行器；全量项目索引平台；Build/Debug/Test 系统；Git GUI；Agent 自主执行平台；插件市场；超大文件分析器。

## 3. 功能总览（目标版本 × 优先级）

| 模块 | 目标版本 | 优先级 | 定位 |
|---|---|---|---|
| PreviewCapability 统一 | v2.0 | P0 | Markdown / HTML 统一预览入口 |
| HTML 静态安全预览 | v2.0 | P1 | 单文件静态查看，不运行 JS |
| 崩溃恢复 | v2.0 | P0 | 防止未保存内容丢失 |
| 自动保存恢复草稿 | v2.0 | P0 | 不直接覆盖原文件 |
| 冲突检测 / 简单合并 | v2.0 | P1 | 处理外部修改 |
| Annotation V2 | v2.0 | P0 | 批注真正显示在源内容上 |
| 批注管理 | v2.0 | P1 | 搜索 / 标签 / 状态 / 导出 |
| 图片只读 Viewer | v2.1 | P1 | 常用文件快速查看 |
| XLSX 虚拟化 | v2.1 | P0 | 保证表格可用性 |
| 大文件 OpenMode | v2.1 | P1 | normal / lazy / readonly / external |
| PDF 大文件按页策略 | v2.1 | P1 | 不长时间冻结 |
| PPTX 只读 Viewer | v2.2 | P2 | Slide 级快速查看 |
| 工作区搜索增强 | v2.2 | P2 | 轻量、可取消、无长期索引 |
| Change Review | v2.2 | P1 | Agent / 外部修改审阅 |
| MCP Bridge | v2.2 | P2 | UI 联动与审阅状态反馈 |
| Hunk 级审批 | v2.3+ | P3 | 有实际需求再做 |
| PDF Range Reader | v2.3+ | P3 | 极端 PDF 再优化 |

## 4. 里程碑

| 里程碑 | 内容 | 退出条件 |
|---|---|---|
| M1 基础可靠性 | PreviewCapability；Recovery Draft；自动恢复草稿；External Conflict UI；Annotation V2 Text Anchor | 崩溃后未保存文本可恢复；批注能明显显示在文本内容上；Markdown/HTML Preview 共用 Capability |
| M2 阅读与批注体验 | HTML 安全 Preview；图片 Viewer；Annotation Manager；标签/搜索/导出；PDF/XLSX 批注 Decoration | — |
| M3 大文件与 XLSX | OpenMode；PDF Page Window；XLSX Sheet Lazy；Row Virtualization；Readonly fallback | — |
| M4 Agent Review | ChangeSet；Baseline；Diff Review；Approve/Rollback；Audit Record；MCP `review.*`；`document.get_active_context/open/reveal` | — |
| M5 后续格式与工作区增强 | PPTX Viewer；Workspace Search；Annotation Workspace Search；DOCX/PPTX Search；MCP Annotation tools | — |

## 5. 推荐开发顺序

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

理由：数据可靠性和批注体验属于 QuickEdit 本体；Agent 联动必须建立在本体足够稳定之后。

## 6. 分条待开发项（摘要 + 设计文档指针）

### 6.1 v2.0

| 条目 | 要点 | 设计依据 |
|---|---|---|
| PreviewCapability 统一 | 格式能力统一为 `DocumentCapabilities{editable, searchable, replaceable, annotatable, preview?, paged?, spreadsheet?}`，主 UI 只判断 `capabilities.preview`；描述"是否有第二种阅读视图"，不负责文件 IO | v2_plus §4 |
| HTML 静态安全预览 | `.html/.htm` 保持 TextHandler（编辑/Ctrl+F/H/保存/批注）+ 静态 Preview；安全模型 `DOMPurify → sandbox iframe（禁止 allow-scripts）`；禁止 JS/iframe/表单/导航/fetch/XHR/WebSocket；V2.0 默认不保证外部 CSS/本地相对图片/网络图片/字体/多页面跳转 | v2_plus §5 |
| 崩溃恢复 | dirty 文档保存 `RecoveryDraft{documentPath, baseSize, baseModifiedTime, content, createdAt, updatedAt}` 到 `%LOCALAPPDATA%/QuickEdit/recovery/`；启动发现草稿 → 比较原文件状态 → 提示"恢复/查看差异/丢弃"；默认不自动覆盖原文件 | v2_plus §11 |
| 自动保存恢复草稿 | 定位是"自动保存恢复草稿"而非自动覆盖；dirty 后约 2 秒 debounce；优先 Text/Markdown/HTML；Ctrl+S 成功后删除对应 Draft | v2_plus §12 |
| 冲突检测与简单合并 | 内存 dirty + 磁盘外部修改时保存四选一（重新加载/查看差异/另存为/仍然覆盖）；Text 可做 Base/Local/Disk 三方合并，无冲突生成 merged 待确认，有冲突可视化冲突块；XLSX/PDF/DOCX/PPTX 不做通用三方合并 | v2_plus §13 |
| Annotation V2 | 见 §7；v2.0 核心：Schema V2、Text Range Anchor + re-anchor、源内容 inline decoration、orphaned 处理 | Annotation V2 全文 |
| 批注管理 | 当前文件批注搜索（text/tag/status）；标签（自由文本，快捷标签 TODO/问题/确认/重要/Agent）；状态 open/resolved（resolve/reopen）；导出 Markdown（阅读）+ JSON（Agent/迁移）；不引入负责人/截止日期/权限流 | v2_plus §15–17 |

### 6.2 v2.1

| 条目 | 要点 | 设计依据 |
|---|---|---|
| 图片只读 Viewer | PNG/JPG/JPEG/WEBP/GIF/BMP：打开、自适应、原始尺寸、缩放、旋转视图（不改文件，可选）、批注、系统打开；不做裁剪/滤镜/涂鸦/OCR/内容编辑 | v2_plus §6 |
| XLSX 虚拟化 | 打开流程：Workbook → Sheet Names → 选择 → 加载当前 Sheet → 只渲染可视区；Row Virtualization（视口约 40~80 行 + buffer，禁止全量 DOM）；Column Virtualization 暂缓；大工作簿降级 normal→lazy→readonly→external（readonly 仍支持 Sheet 切换/Ctrl+F/批注/系统打开） | v2_plus §10 |
| 大文件 OpenMode | 统一 `OpenMode = normal/lazy/readonly/external`，每个 Handler 返回 `OpenDecision{mode, reason?}`；核心原则"宁可多次短等待，不允许一次长时间冻结"；UI 可响应 > 首批内容出现 > 完整加载 | v2_plus §9 |
| PDF 大文件按页策略 | 在现有连续页面流基础上按页/视口窗口化，极端文件降级 external | v2_plus §9 |

### 6.3 v2.2

| 条目 | 要点 | 设计依据 |
|---|---|---|
| PPTX 只读 Viewer | 快速浏览幻灯片：Slide 列表、上/下页、Slide Preview、文本提取、Ctrl+F、批注、系统打开；`.ppt` 交系统程序；不做编辑/动画/SmartArt/母版/图表编辑/像素级一致 | v2_plus §7 |
| 工作区搜索增强 | 轻量 Workspace Search（当前文档 Ctrl+F 仍是主能力）；默认扫描 TextHandler 文本/Markdown/HTML/JSON/XML/YAML/LOG，可选 XLSX 文本，后续已提取文本；默认排除 `.qnote`/二进制/`node_modules`/`.git`；按需扫描 + 渐进返回 + 可取消，**无长期索引**（不做 SQLite FTS 常驻索引）；**仍不做跨文件替换** | v2_plus §8 |
| Change Review | 见 §8；核心：ChangeSet、Baseline、整轮审批（确认/回滚）、Audit 与 Rollback 分离、Crash-safe pending | Agent Change Review 全文 |
| MCP Bridge | 见 §8；第一批工具：`document.get_active_context/open/reveal`、`review.begin/capture/get/history`、`annotations.list/create/update/resolve/reveal`；不提供文件/Shell/git/审批工具 | v2_plus §19–20 |

### 6.4 v2.3+

| 条目 | 要点 |
|---|---|
| Hunk 级审批 | Accept/Reject Line/Hunk；rollback 组合复杂，P3 再评估 |
| PDF Range Reader | 极端 PDF 的 Range 读取优化 |

## 7. Annotation V2（摘要）

目标：**批注必须显式附着在内容上**（Text / Cell / Page / Slide / Region），不只是右侧备注列表。核心设计见 `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md`。

- **Schema V2**：`.qnote` 增加 `version: 2`；每条批注含 `scope`（general / text-range / cell / page / slide / region）、`locator`（如 offset 或 Sheet+Cell）、`anchor`（quote/prefix/suffix）、`text`、`tags?`、`status`（open/resolved）、`source`（user/agent）、时间戳。
- **Text Anchor 与 re-anchor**：offset 之外保留 quote + prefix/suffix；打开文件时校验原 offset → quote 匹配 → 搜索消歧 → 更新运行时 locator；失败标记 `orphaned`（UI 提示"无法定位到原内容"，仍可查看/手动重关联/删除/导出，不得静默丢弃）；不自动改写 `.qnote`。
- **展示**：Text 轻量 Highlight + gutter marker + hover popover + Panel 卡片；点击源码 Marker 打开批注、点击卡片 reveal 源码。Markdown 编辑模式直接标源文本；Preview 模式 V2.0 不要求精确 DOM→Source 映射，能映射则显示，否则 Panel 保留 + 点击切回 Edit 定位。XLSX 单元格右上 Marker；PDF 页边缘 marker + 跳页（region 归一化坐标为 V2.1+ 增强）。
- **AnnotationService**：`list/create/update/resolve/reopen/delete/search/export` 统一服务；`AnnotationRenderer` 按视图实现（Text/Spreadsheet/Pdf/Pptx/Image），Service 不关心 DOM/Canvas。
- **性能**：只加载当前文件 `.qnote`；Workspace 批注搜索按需执行、渐进返回、可取消；Decoration 按 viewport 渲染；启动不扫 `.qnote`。
- **权限边界**：记录 `source: user/agent`；Agent 可读/建/resolve，**不得默认删除用户批注**，删除优先保留给用户 UI。
- **实施阶段**：P0 Schema/Text Anchor/inline decoration/orphaned/Panel reveal；P1 Tags/Search/Resolve/Export/XLSX/PDF Marker；P2 Workspace 搜索/MCP tools/DOCX/PPTX markers；P3 Region/advanced re-anchor/Image region/Preview 精确映射。
- **验收（9 条）**：文本局部批注重开可定位；前方插入后 re-anchor；失败显示 orphaned；XLSX 定位 Cell；PDF 跳页；Panel 搜索过滤 text/tag/status；导出 Markdown/JSON；`.qnote` 不修改源文件；Agent 可读但不得自动删用户批注。

## 8. Agent Change Review & MCP Bridge（摘要）

定位：**QuickEdit 不内置 Agent Runtime**。推荐 `Workspace Terminal → Claude Code / Codex / 其他 CLI Agent`；Agent 负责分析/计划/修改/执行，QuickEdit 负责**修改审阅、回滚、用户决策记录、UI 联动、批注**，用户做最终决定。核心设计见 `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`。

- **ChangeSet**：`{id, source: agent|external, agentSessionId?, status: recording|pending|approved|rejected|conflict, files: FileChange[], summary?, decision?}`；`FileChange{path, action: modified|created|deleted|renamed, beforeHash/afterHash, hunks}`。
- **为什么需要 review.begin**：Agent 先改盘则 QuickEdit 只有 after、无 before，无法可靠回滚；所以 `review.begin(paths)` 先存 baseline（验证路径在允许 Workspace 内，建 recording ChangeSet）→ Agent 用自己工具修改 → `review.capture` 比较生成 Diff，转 pending 并打开 Review UI。
- **Audit 与 Rollback 分离**：Audit Record 长期轻量保留（id/时间/文件/hunk 元数据/决策/reject reason/session）；Rollback Payload（before snapshot 等）临时保存。**Approve 或 Rollback 之后都删除 Rollback Payload，保留 Audit Record**。审计保留建议最近 100 条或 30 天（需确认）。
- **Review UI**：第一版整轮审批（本轮 N 个文件 + 文件级 Diff 展开 + 确认/回滚）；**不做 Hunk 级**（P3 再评估）；Agent 修改与用户内存编辑同时发生时 `status=conflict`，不得自动 approve/rollback，由用户选保留版本。
- **Agent 不得审批自己**：MCP 不提供 `review.approve/reject`，审批只来自 QuickEdit UI；Agent 只能 `review.get`（读决策/拒绝原因）与 `review.history`（轻量 metadata，按状态/path/session/时间过滤）。
- **MCP 工具边界**：只提供 QuickEdit 独有能力（UI 联动 + 审批状态 + 批注）；不重复 `read_file/write_file/apply_patch/delete_file/run_terminal/git_*` 等 CLI Agent 已有工具；`document.reveal` 统一 Locator（text/pdf/spreadsheet/slide）。
- **Transport**：推荐 `Claude Code → stdio MCP quickedit-mcp → local IPC → QuickEdit`，可复用 Windows 单实例通信（Named Pipe/Local IPC）。
- **安全边界**：只访问当前允许 Workspace；不提权；不自动批准；不绕过外部修改保护；不暴露无关本地路径；mutation 工具记录来源。
- **与 Recovery Draft 关系**：Recovery Draft 保护 QuickEdit 内部未保存修改，Change Review 保护 Agent/外部磁盘修改，两者不合并。
- **实施阶段**：P0 ChangeSet/baseline/begin/capture/Review UI/Approve-Rollback/crash-safe；P1 get/history/reject reason/document.*；P2 Annotation MCP/external review/richer Diff/多 agent 会话；P3 Hunk 审批/selective rollback/richer audit query。
- **验收（11 条）**：begin 后修改可完整捕获；UI 显示文件+Diff；Approve 删 payload 留 audit；Rollback 恢复 baseline 且 audit 为 rejected；Agent 可读拒绝原因；Agent 无法自批；崩溃后 pending 可恢复；reveal 可定位四种视图；MCP 不承担 Shell/文件编辑权限体系。

## 9. 明确不排期项（Future Considerations）

- IDE、代码补全、调试器、项目构建系统
- Terminal Task Runner、Build/Run 按钮、Debugger、Git UI
- Web 项目运行、DSH/Web/Browser Host
- 云同步、多人协作、在线账号
- 完整 Office 替代能力；PDF 原文编辑、Word 级 DOCX 编辑、完整 Excel 样式/宏编辑、PPTX 编辑
- 全量项目索引、SQLite FTS 常驻索引、后台全文索引服务
- 插件市场、超大文件分析器
- 跨文件替换（除非重新确认安全模型和撤销策略）

## 10. 启动前需确认事项

| # | 事项 | 说明 |
|---|---|---|
| 1 | 数据目录迁移 | 设计文档建议 v2.0+ 数据目录 `%LOCALAPPDATA%/QuickEdit/`（recovery/、reviews/audit、reviews/rollback、logs/）；当前 V1 实际为 `%APPDATA%\com.quickedit.desktop\`。需确认迁移/兼容策略（平移、双读、还是沿用现状），影响 Recovery/Change Review 落地 |
| 2 | MCP Transport 可行性 | Named Pipe/Local IPC 复用单实例通道的技术验证（Windows 实现、生命周期、多实例） |
| 3 | 审计保留策略 | 默认 100 条或 30 天，二选一或自定义 |
| 4 | HTML 预览外部资源 | 默认不保证外部 CSS/图片/字体；是否逐项扩展按需评估 |
| 5 | 主题边界 | 浅色 / 深色 / 跟随系统已实现；待确认的是终端是否跟随主题（当前固定深底，因控制台程序沿用 Windows 深色调色板）与壁纸、磨砂是否立项（§13.2） |

## 11. 状态总表

| 优先级 | 条目 | 目标版本 | 状态 |
|---|---|---|---|
| P0 | Annotation V2（Anchor + Inline Decoration） | v2.0 | 已完成（v2.1.0，V2.1 内容优先方案） |
| P0 | PreviewCapability / HandlerRegistry | v2.0 | 已完成（`DocumentCapabilities` + 懒加载注册表） |
| P0 | 工程化分层（前端 + Rust） | v2.0 | 已完成（视图代码不再堆在 `main.ts` / `lib.rs`） |
| P0 | XLSX 虚拟化 | v2.1 | 部分完成：按 200 行分段浏览、只渲染当前 Sheet；列虚拟化与 SheetJS Worker 解析未做 |
| P0 | Recovery / Auto Draft | v2.0 | 待开发 |
| P1 | HTML 静态安全预览 | v2.0 | 已完成（保留原页面样式，脚本不执行、外链不抓取，可与文本编辑切换） |
| P1 | 批注管理（搜索 / 标签 / 状态 / 导出） | v2.0 | 部分完成：标签、状态、未解决过滤已做；批注搜索与 Markdown/JSON 导出未做 |
| P1 | 图片 Viewer | v2.1 | 已完成（适应窗口、指针锚点缩放、拖拽平移、双击切换适应/100%、旋转、系统打开、Blob 释放） |
| P1 | 大文件 OpenMode | v2.1 | 部分完成：文本分块只读、二进制分段 IPC、XLSX/PDF 分段；超大 CSV 分段加载未做 |
| P1 | PDF 按页策略 | v2.1 | 已完成（当前页窗口外的画布释放为占位高度） |
| P1 | Change Review（ChangeSet / Baseline / Diff / 确认 / 回滚 / 审计） | v2.2 | 已完成（P0/P1 范围，审计与回滚数据分离） |
| P1 | 通用对象信息页 + Header Run | v2.1 | 已完成（含 `.exe`、过大、加载失败、未支持格式「以文本方式打开」） |
| P1 | CSV 预览与编辑 | v2.1 | 已完成（引号/逗号/BOM/CRLF 往返一致，虚拟滚动 + 粘顶表头） |
| P1 | 脚本运行与自定义 Runner | v2.1 | 已完成（BAT/CMD/PS1/EXE + 占位符 Runner，不绕过执行策略） |
| P1 | 重新加载与文档切换 | v2.1 | 已完成（右键菜单/`F5` 重新加载文档与文件夹，`Alt+↑` / `Alt+↓` 切换上/下一个文档） |
| P1 | 复验待办 9 条（2026-09-22 / 2026-09-24） | v2.1 | 已完成，待桌面端复验（§12） |
| P1 | 冲突检测 / 三方合并 | v2.0 | 待开发（现有仅外部修改拒绝保存，无合并 UI） |
| P2 | PPTX Viewer | v2.2 | 部分完成：逐页正文 + 翻页；缩略图与图片渲染不做（文字抽取方案） |
| P2 | `.doc` / `.ppt` 阅读 | v2.2 | 已按降级方案完成：尽力抽取正文文字 + 系统打开 |
| P2 | 工作区搜索增强 | v2.2 | 待开发 |
| P2 | MCP Bridge（stdio + 本地 IPC） | v2.2 | 待开发（Phase 9；审批动作仍只在 UI） |
| — | 完整暗色主题 | v2.1 | 已完成（浅色 / 深色 / 跟随系统 + 语义变量 + 终端深底），原「暂缓不排期」结论已作废 |
| P3 | Hunk 级审批 | v2.3+ | 待评估 |
| P3 | PDF Range Reader | v2.3+ | 待评估 |

## 12. 复验待办（2026-09-22 / 2026-09-24，共 9 条，已全部实现）

| # | 条目 | 实现 | 类型 | 状态 |
|---|---|---|---|---|
| 1 | 设置 · 文本大小上限 | 打开设置回填已保存值，保存后长期生效；该上限同时真正参与大文件判定 | 缺陷 | 已完成，待桌面复验 |
| 2 | 脚本运行按钮位置 | 运行图标移到编辑区工具栏 UTF-8 编码标签左侧；不可编辑的文件（如 `.exe`）在信息页提供「在终端运行」 | 增强 | 已完成，待桌面复验 |
| 3 | 左侧文件栏宽度 | 右边缘可拖拽调整（200–560px，随窗口收窄），宽度记在本机；双击边缘恢复默认 | 增强 | 已完成，待桌面复验 |
| 4 | 暗色下应用名称 | 品牌区文字改用主题语义变量，深色下对比达标 | 缺陷 | 已完成，待桌面复验 |
| 5 | 重命名不显示原名 | 重命名输入框预填当前名称并选中主名（不含后缀） | 缺陷 | 已完成，待桌面复验 |
| 6 | 上一个 / 下一个文档 | `Alt+↑` / `Alt+↓` 在可见文档间循环切换，不加界面按钮 | 增强 | 已完成，待桌面复验 |
| 7 | 重新加载文件夹和文档 | 右键菜单「重新加载」与 `F5`：文档重新读盘（有未保存修改先确认），文件夹/工作区重新扫描子项 | 增强 | 已完成，待桌面复验 |
| 8 | Ctrl+F 结果错位 | 查找偏移与编辑器坐标同一空间，忽略大小写改为按位置精确匹配；匹配处在正文高亮，当前匹配单独配色 | 缺陷 | 已完成，待桌面复验 |
| 9 | 图片放大缩小交互 | 滚轮以指针为锚点缩放、按住拖动平移（放大后不平移空白、图像不会丢失）、双击切换适应/100% | 增强 | 已完成，待桌面复验 |

附带修复：编辑保存保留文件原有的 CRLF/LF 换行风格，不再把 CRLF 文件整体改成 LF。

## 12.1 下一轮复验关注点

- 侧栏宽度记忆是全局的（按本机记录，不区分工作区），如需按工作区记忆要另行排期；
- 图片平移夹取在低倍率下会吃掉部分锚点位移（图像尺寸接近舞台时属正常表现）；
- `confirmBeforeCloseUnsaved` 设置项目前没有生效路径，切换文档不提示未保存，需要单独立项。

## 13. 探索方向（未排期，需要先出对比样例）

### 13.1 批注呈现方案

现状：文本行内高亮 + 悬浮卡 + 右侧 Panel；表格单元格角标；PDF 页边缘 marker；Markdown 预览高亮。候选方案与评价维度：

| 方案 | 做法 | 适合场景 | 代价 |
|---|---|---|---|
| A 行内高亮（现状） | 源文/预览着色 + 悬浮 + Panel | 批注少到中、需要看到原文语境 | 批注密时花、导出纯文本会残留 |
| B 装订线标记列 | 左侧 gutter 放标记，悬停出内容，正文不着色 | 长文、代码，正文要保持干净 | 需要编辑器 gutter 支持 |
| C 页边批注块 | Word 风格：正文不动，右侧页边块 + 连接线 | 阅读型长文档、打印/导出 | 布局宽度与响应式成本高 |
| D 折叠色带 | 批注处只留一条细色带，点击展开内容 | 批注极多（几十上百条）的文档 | 一眼看不出内容，需悬停/展开 |
| E diff 式提示 | re-anchor 失败时显示"原位置已变动"卡 + 手动重关联 | 文档频繁被改动的协作/Agent 场景 | 需要保留 anchor 历史 |

评价维度统一为：可读性、对排版的侵入、re-anchor 稳健度、大量批注下的性能、导出与 Agent 可读性。选定前先各做一份可交互 Demo 再比较。

### 13.2 视觉美化

- 工作区壁纸 / 背景图：内容区加深半透明蒙版保证对比度，并与暗色主题、终端深底统一；
- 磨砂 / 亚克力：`backdrop-filter: blur()` 在 WebView2 上有滚动掉帧风险，只在侧栏、面板、弹窗使用，正文与表格区不做；
- 间距与描边 token 化，提供紧凑 / 舒适 / 护眼三套预设；
- 主题强调色可自定义 1–2 个色值，语义 token 结构不变。

约束：不影响启动与滚动性能；正文对比度不低于现有水平；新增视觉一律走 CSS 变量，不再散落硬编码色值。
