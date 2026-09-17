# QuickEdit V1 基础稳定版与 V2 排期计划

版本：v1.2  
状态：V1-A/B/C/D 已实现并进入候选验收；V1-E 待版本号确认后定版；V2 排期自 v1.2 起以 2026-09-17 三份 v2.0+ 设计文档为准（见 §4）  
日期：2026-09-17  
依据：

- `设计文档/QuickEdit_Requirements_Specification.md`
- `设计文档/QuickEdit_HTML_Terminal_Requirements_Design.md`
- `设计文档/QuickEdit_Post_Markdown_Requirements_Design.md`
- `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md`（v2.0+ 需求设计与演进规划，Draft）
- `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md`（Annotation V2，Draft）
- `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`（Change Review & MCP，Draft）
- 当前 QuickEdit P0–P5 实现与实测记录
- 用户新增外部终端与路径复制交互要求

---

## 1. 计划目标

在当前已完成的 QuickEdit V1/P5 基础上，再增加一个“V1 基础稳定版”阶段：

> **查找/替换可用、终端可用、设置和主题稳定、安装包可交付。**

完成后形成可独立维护的稳定基线；后续 HTML 预览、更多格式和大文件能力进入 V2，不阻塞 V1 封包。

---

## 2. 当前状态与核实结论

| 项目 | 当前状态 | 结论 |
|---|---|---|
| 工作区/文本/批注/重命名 | P0–P5 已实现 | 保持回归，不重做核心数据模型 |
| Markdown Preview | 已实现，含安全降级 | 继续沿用 TextHandler |
| PDF | 已改为连续纵向滚动 | 纳入 V1 回归 |
| Ctrl+F | 用户反馈已有查询体验；源码未发现显式应用级 Ctrl+F 状态流 | V1 稳定化时实现为 QuickEdit 自有能力，不依赖 WebView 默认行为 |
| Ctrl+H | 尚未实现 | V1 新增 |
| Workspace Terminal | 尚未实现 | V1 新增 |
| 设置弹窗 | 可用，但信息密度/分组/滚动仍需优化 | V1 优化 |
| 日间主题 | 当前为默认浅色 | V1 稳定化并持久化；深色入口仅提示暂不支持 |
| MSI/NSIS | 已有隔离构建和 Shell 钩子 | V1 重新封包并做发布验收 |
| HTML 静态预览 | 设计已确认但当前未实现 | 默认排入 V2 |

---

## 3. V1 基础稳定版范围

### V1-1 查找与替换

- `Ctrl+F`：当前文档查找，不做工作区搜索。
- `Ctrl+H`：当前文本源代码替换。
- 支持下一个/上一个、匹配大小写、全部替换前确认。
- 文本/Markdown/HTML 源码统一使用文本查找层。
- PDF/DOCX/XLSX 不在本阶段承诺完整替换。
- 搜索状态不写入原文件，不影响 dirty 状态。

### V1-2 外部 Workspace Terminal

- `Ctrl+`` 或文件/工作区菜单直接启动外部 `cmd.exe`；若后续确认 Windows Terminal 可用，可优先调用 `wt.exe`。
- 当前文件属于 Workspace 时，cwd 为 Workspace Root。
- 固定“文档”区域文件，cwd 为文件所在目录。
- 无当前文件时，cwd 使用 `%USERPROFILE%`。
- 外部窗口负责输入、输出、Ctrl+C、复制、粘贴、Resize 和关闭；QuickEdit 不嵌入 PTY、不维护 Terminal Panel。
- 启动失败只显示错误 Toast，不得导致 QuickEdit 主窗口退出。
- 不做 Task Runner、Build、Debugger、Git UI、SSH、AI/Agent 操作。

### V1-3 设置弹窗布局

- 按“编辑器 / 文件处理器 / 批注 / 工作区 / Windows 集成 / Terminal / 外观”分组。
- 长表单保持单一滚动区域，底部操作按钮稳定可见。
- 输入项提供当前值、默认值和错误提示。
- 保存失败时保留用户输入，不关闭弹窗。
- 取消操作恢复打开前状态。
- 清理过期文案，避免出现“P1 阶段启用”等历史提示。

### V1-4 日间主题与深色占位

- 日间主题作为 V1 稳定默认，保存到 `config.json`。
- 设置中展示浅色/深色主题卡片；深色卡片点击提示“暂不支持，已排入 V2”，不写入 dark 配置。
- 设置/帮助/编辑器/Markdown/PDF/DOCX/XLSX/批注保持浅色视觉一致。
- 完整 dark 语义色覆盖、系统主题跟随和全组件回归移入 V2。

### V1-5 封包与稳定发布

- 重新生成 MSI 与 NSIS x64 安装包，包含最新 P5、Terminal、查找替换和主题。
- 保留 NSIS 安装/卸载 Shell 注册钩子。
- 安装、升级、卸载、右键/Open With 清理形成验收记录。
- 生成版本说明、已知风险和测试样本说明。
- 创建稳定基线标签/提交，后续可独立维护。
- 版本号默认建议从当前 `0.1.0` 升为 `1.0.0`；这是发布前唯一需要用户确认的版本决策。

---

## 4. V2 排期（v1.2 起以 v2.0+ 设计文档为准）

2026-09-17 三份 v2.0+ 设计文档已取代本节原有的 V2-0~V2-5 草案排期；**单一入口改为 `docs/QuickEdit_Undeveloped_v2.md`**，本计划不再维护 V2 明细：

- `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md`：v2.0+ 总体规划（功能总览、里程碑 M1–M5、推荐开发顺序、非目标）。
- `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md`：Annotation V2（Schema V2、Text Anchor/re-anchor、inline decoration、标签/状态/搜索/导出、orphaned、MCP 边界）。
- `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`：Agent Change Review & MCP Bridge（ChangeSet、baseline/捕获、整轮审批、Audit 与 Rollback 分离、MCP 工具与安全边界）。

原 V2 草案中仍生效的条目映射：HTML 预览/PreviewCapability → v2.0；图片/PPTX 只读 → v2.1/v2.2；搜索扩展（仍不做跨文件替换）→ v2.2；大文件策略 → v2.1；崩溃恢复/自动保存/冲突合并 → v2.0。原 V2-0"完整暗色主题"未列入三份设计文档排期，保持用户确认的暂缓状态（见 `docs/QuickEdit_Undeveloped_v2.md` §10）。

---

## 5. 明确不排期项

以下内容不进入 V1 或 V2 当前排期，保留为 Future Considerations：

- IDE、代码补全、调试器、项目构建系统。
- Terminal Task Runner、Build/Run 按钮、Debugger、Git UI。
- AI/Agent/MCP/插件系统。
- DSH/Web/Browser Host。
- 云同步、多人协作、在线账号。
- 完整 Office 替代能力。
- PDF 原文编辑、Word 级 DOCX 编辑、完整 Excel 样式/宏编辑。

---

## 6. V1 实施顺序

| 阶段 | 内容 | 前置 | 完成标志 |
|---|---|---|---|
| V1-A | 查找/替换状态层与文本 UI | 当前 TextHandler | Ctrl+F/H、替换、dirty/保存回归通过 |
| V1-B | 设置弹窗分组与日间主题 | V1-A 可独立进行 | 参考图布局、浅色保存恢复、深色占位提示、弹窗滚动通过 |
| V1-C | 外部 Terminal 启动（原 PTY 方案按用户决定简化为直接调用） | V1-A/B 不阻塞 | Ctrl+`/右键拉起 cmd.exe、cwd 正确、release 存活 ≥3s ✅ |
| V1-D | 全量回归与发布包 | V1-A/B/C | 查找/替换、设置、主题、路径复制实测通过；候选 MSI/NSIS 已生成 ✅ |
| V1-E | 稳定基线 | V1-D | 版本号确认（建议 1.0.0）→ 重新打包 + 版本说明 + Git 标签 |

---

## 7. V1 验收标准

- **AC-V1-001**：文本/Markdown 打开后 `Ctrl+F` 显示应用内查找状态，不依赖浏览器原生查找。
- **AC-V1-002**：`Ctrl+H` 可在当前文本源中替换一次或全部替换，并正确维护 dirty 状态。
- **AC-V1-003**：`Ctrl+`` 或文件/工作区菜单启动外部终端窗口，窗口可交互输入并显示输出。
- **AC-V1-004**：外部终端 cwd 按 Workspace Root/单文件目录/默认目录规则确定。
- **AC-V1-005**：外部终端启动失败只显示错误提示，不导致 QuickEdit 主窗口退出；右键复制路径可将完整路径写入系统剪贴板。
- **AC-V1-006**：设置弹窗分组清晰、窄窗口可滚动、保存失败保留输入。
- **AC-V1-007**：浅色主题保存后重启保持；点击深色主题时明确提示暂不支持，不进入半成品 dark 状态。
- **AC-V1-008**：MSI/NSIS 安装、升级、卸载和 Shell 注册/清理均有 Windows 本机证据。
- **AC-V1-009**：P0–P5 原有文件、批注、格式、单实例、异常和性能回归通过。
- **AC-V1-010**：生成稳定版本说明和可独立维护的 Git 基线。

---

## 8. 风险与待确认项

1. 当前源码未发现显式 Ctrl+F 实现；V1 必须实现应用级查找，不能把 WebView 默认行为当作验收证据。
2. Windows PTY 方案需在实现前确认 Rust crate/Windows ConPTY 兼容性；若 PTY 依赖风险过高，先做 PowerShell 交互最小 Demo 再扩展。
3. HTML Preview 默认排入 V2；如果希望 HTML 也进入 V1，需要重新调整 V1 封包范围和工期。
4. 稳定版版本号建议 `1.0.0`，等待发布前确认。
5. 完整暗色主题移入 V2；V1 只保证浅色稳定和深色占位提示。Terminal 面板高度采用固定默认值，后续再评估记忆。
6. V1 封包后是否独立维护，建议以 Git tag、安装包、路线图和变更日志作为交接边界。

---

## 9. 本计划明确不实现

本文件仅完成 V1/V2 需求对齐、范围冻结、实施顺序和验收设计。除读取文档、核对现状和写入本计划外，本轮不修改 QuickEdit 源码、不新增 Terminal、不实现替换、不改主题、不重新打包。
