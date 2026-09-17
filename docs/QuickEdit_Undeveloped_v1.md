# QuickEdit 待开发文档（V2 Backlog）

> **deprecated**：本文基于旧 V2 排期（V2-0~V2-5），已被 `docs/QuickEdit_Undeveloped_v2.md`（基于 2026-09-17 三份 v2.0+ 设计文档）取代，仅作历史参考，不再更新。

版本：v1.0
日期：2026-09-16
状态：V1 稳定版候选完成后的待开发清单
依据：`docs/QuickEdit_V1_Stable_V2_Plan_v1.md` v1.1 §4/§5、`docs/QuickEdit_Execution_Roadmap_v1.md` v1.14

> 本文是 V2 及后续需求的单一待开发入口。计划调整时先更新 `QuickEdit_V1_Stable_V2_Plan_v1.md`，再同步本文。

---

## 1. V2 排期项（按优先级）

### V2-0 完整暗色主题

| 项 | 说明 |
|---|---|
| 内容 | 完整覆盖编辑器、阅读器（Markdown/PDF/DOCX/XLSX）、批注、设置、帮助、Toast、滚动条和状态色的 dark 语义色 |
| 触发 | 设置中"深色/系统"主题卡片目前点击仅弹"暂不支持"提示（V1 决策，半成品样式不可用） |
| 依赖 | 无硬性前置；建议 V2 首项 |
| 验收要点 | light/dark 视觉回归截图基线；系统主题跟随（如确认需要）；不破坏浅色默认 |
| 备注 | `styles.css` 已保留 `:root[data-theme="dark"]` 部分覆盖骨架，但不可交付 |

### V2-1 HTML 静态预览与 PreviewCapability

依据 `设计文档/QuickEdit_HTML_Terminal_Requirements_Design.md`：

| 项 | 说明 |
|---|---|
| 内容 | HTML/HTM 保持 TextHandler 可编辑 + 新增只读预览模式（Edit/Preview 双模式，预览用内存内容） |
| 安全模型 | `DOMPurify + sandbox iframe + srcdoc`；禁止 JavaScript、外部脚本、iframe、导航、fetch/XHR、WebSocket、表单提交；不加载本地相对图片、外部 CSS、网络资源和字体 |
| 架构 | Markdown/HTML 统一抽象为 `PreviewCapability`，不再按后缀继续堆判断 |
| 查找 | HTML 源码支持 Ctrl+F/H（复用现有查找层）；预览只考虑可见文本查找，不做反向源码定位 |
| 依赖 | 需引入 `dompurify` 依赖；PreviewCapability 抽象涉及 Markdown 渲染路径小重构 |

### V2-2 图片与更多只读格式

| 项 | 说明 |
|---|---|
| 内容 | PNG/JPG/WEBP/GIF/BMP 只读查看（缩放）+ 批注；PPTX 只读查看 + 当前文档查找 + 批注 |
| 边界 | 不做 PPTX 编辑 |
| 依赖 | 预览能力可部分复用 V2-1 的 PreviewCapability |

### V2-3 搜索能力扩展

| 项 | 说明 |
|---|---|
| 内容 | 当前文档搜索/替换增强（历史、整词、正则——正则需单独确认）；工作区搜索；跨文件搜索 |
| 边界 | **跨文件替换默认不做**，除非重新确认安全模型和撤销策略 |
| 依赖 | 现有查找层（`refreshFindMatches` 等）可扩展；跨文件需要后端批量读取命令 |

### V2-4 大文件与格式性能

| 项 | 说明 |
|---|---|
| 内容 | 大文本 `normal / lazy / readonly / external` 策略；XLSX Sheet Lazy + 表格虚拟化 + 只读降级；PDF 按页/视口进一步优化；DOCX 过大时建议系统程序打开；启动与首屏性能基准自动化 |
| 现状 | 文本默认 1MB 上限（有单测锁定），超限直接拒绝 |

### V2-5 稳定性与恢复增强

| 项 | 说明 |
|---|---|
| 内容 | 崩溃恢复草稿；自动保存（需明确恢复/覆盖语义）；文件变更监听与冲突合并；孤儿 `.qnote` 管理工具；批注搜索/标签/导出 |
| 现状 | 已有保存前冲突检测（`expectedSize`/`expectedModifiedTime`）与 `.qnote` stale 恢复，但无自动保存与孤儿管理 |

---

## 2. 明确不排期项（Future Considerations）

以下内容不进入 V1/V2 当前排期，保留为远期备选（重新立项需单独确认）：

- IDE、代码补全、调试器、项目构建系统
- Terminal Task Runner、Build/Run 按钮、Debugger、Git UI
- AI / Agent / MCP / 插件系统
- DSH / Web / Browser Host
- 云同步、多人协作、在线账号
- 完整 Office 替代能力
- PDF 原文编辑、Word 级 DOCX 编辑、完整 Excel 样式/宏编辑

---

## 3. 状态与入口

| 优先级 | 条目 | 状态 | 备注 |
|---|---|---|---|
| 1 | V2-0 暗色主题 | 待开发 | V1 中仅占位 Toast |
| 2 | V2-1 HTML 预览 + PreviewCapability | 待开发 | 设计已确认（设计文档） |
| 3 | V2-2 图片/PPTX 只读 | 待开发 | — |
| 4 | V2-3 搜索扩展 | 待开发 | 跨文件替换需重新确认 |
| 5 | V2-4 大文件/性能 | 待开发 | — |
| 6 | V2-5 稳定性/恢复 | 待开发 | 自动保存语义需先定 |

启动任一条目时：先更新计划文档 → 按开发阶段闸门（需求确认 → 方案确认 → Demo → 完整测试）推进 → 更新本文状态。
