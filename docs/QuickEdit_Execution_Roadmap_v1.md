# 需求路线图：QuickEdit V1 本地文件工作区

版本：v1.16 ｜ 用户确认：本轮 ｜ 依据：`设计文档/QuickEdit_Requirements_Specification.md`、`设计文档/QuickEdit_Design_Document.md`、`设计文档/QuickEdit_Markdown_Preview_Requirements_Design.md`、`设计文档/QuickEdit_HTML_Terminal_Requirements_Design.md`、V1 稳定版计划 `docs/QuickEdit_V1_Stable_V2_Plan_v1.md`（v1.2）、v2.0+ 设计文档（`QuickEdit_v2_Plus_Requirements_Design_Roadmap.md`、`QuickEdit_Annotation_V2_Requirements_Design.md`、`QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md`）、待开发文档 `docs/QuickEdit_Undeveloped_v2.md`、P5 交互审查意见

## 1. 需求一句话（≤3 行）

> 原话：“阅读设计 /req-doc-writer 准备开始执行开发小工具”。
> 规范表述：在当前空工作区新建并交付 Windows 优先的 QuickEdit 完整 V1 桌面文件工作区，采用 Tauri v2 + Vite + vanilla TypeScript/HTML/CSS + Rust；按阶段先完成可演示闭环。（用户已确认本轮）

## 2. 术语对齐表（≤10 行）

| 用户说 | 项目里是 | 位置锚点（文档/Demo 静态命中；P0–P5 实体与部署证据已验证） |
|---|---|---|
| 小工具 / QuickEdit | Windows 本地文件工作区 | PRD §1；Design §1 |
| 打开文档 | Logo 菜单的多文件选择用例，归入“文档”分区 | PRD FR-WS-001/007；Demo 443–450（仅内存演示） |
| 新增工作区 | 目录选择并建立工作区根节点 | PRD FR-WS-002；Design §4.1 |
| 文档分区 | 固定、不可移除的 `docsSection` | PRD FR-WS-006/008；Demo 154–159 |
| 工作区 / 文件夹 | `WorkspaceNode` 的 workspace/folder 节点 | Design §2.2、§3；Demo 147–177 |
| 文档 | `WorkspaceNode` file + `DocumentSession` | Design §2.2；Demo 144–146 |
| Handler | `FileHandler Registry`、Text/Markdown Preview、Spreadsheet/PDF/DOCX Handler | PRD §2.2；Design §5；Markdown Preview §2/§9 |
| 批注 | 同目录“完整文件名 + `.qnote`”的 `AnnotationDocument` | PRD FR-ANN-001–005；Design §6 |
| 配置 | `%APPDATA%\com.quickedit.desktop/config.json` 的 `AppConfig` | PRD FR-CFG-001/002；Design §8 |
| Windows 打开 | CLI、单实例 IPC、Explorer Shell Verb/Open With | PRD FR-SHL-001–004；Design §9 |

## 3. 核实记录（≤10 行）

- 流程实测：✅ P0–P4 原有闭环、P5 交互 Demo、V1 稳定版新功能均已实测；V1 稳定版覆盖 Ctrl+F/H 查找替换、设置弹窗重做、只读帮助、浅色主题与深色占位、路径复制、当前行显示、预览选区批注、内置 Terminal。
- 性能基准（P4 实测）：500 文件目录枚举 45ms；文本打开 4ms；保存 169ms（含写穿落盘）；元数据 3ms；界面全程响应。
- 异常恢复（P4/P5 实测）：损坏 config.json → `INVALID_JSON`；损坏 qnote → 原文件备份并新建；打开文件被外部删除 → `STAT_FAILED` 且页面存活；外部修改保存 → `EXTERNAL_MODIFICATION`。
- 交互修复：✅ Markdown 默认预览且可返回编辑；PDF 改为连续纵向滚动；窗口控制区顶部贴边；批注浮标随面板开关；后缀正则、文件夹重命名、搜索/排序、原生右键等均已修复/落地。
- 交互修复（2026-09-17 本轮）：✅ 右键/新建菜单改为在鼠标位置弹出（不再固定于行下方）；新建文档默认编辑模式；设置页勾选框改为开关样式；修复编辑模式"当前选区"批注在点击文档后重置为全文的 bug（编辑选区快照：选区折叠时保留、重新选择时更新、编辑内容后失效）；应用内帮助同步更新。均经 dev CDP 实测。
- 交互修复（2026-09-17 本轮②）：✅ 消息 Toast 移到内容区顶部"编辑|预览"工具条行内水平居中（原右下角位置会遮住批注浮标/终端按钮），并新增 × 关闭按钮、取消 2.6s 自动消失；批注浮标 `bottom: 18px → 50px`（上移一个状态栏行），不再遮挡内置终端按钮。均经无头 CDP 布局断言实测（Toast 行内居中 0px 偏差、与终端/批注按钮零重叠）。
- 功能现状：P0–P5 已完成；V1 稳定版新功能（查找替换/设置/帮助/浅色主题/路径复制/当前行/预览选区批注/内置 Terminal）已实现并实测，候选 MSI/NSIS 已生成；v2.0+ 排期已改为以 2026-09-17 三份设计文档为准（Recovery/Annotation V2/PreviewCapability → v2.0；图片/XLSX 虚拟化/OpenMode → v2.1；PPTX/工作区搜索/Change Review/MCP → v2.2），完整暗色主题保持用户确认的暂缓状态；单一入口见 `docs/QuickEdit_Undeveloped_v2.md`。
- 可修改性：✅ 工作区可写；源码位于 `src/`、`src-tauri/`；Git 提交已建立并推送，当前稳定 tag 为 `v1.1.0`。
- 可测试性：✅ Node/pnpm、MSVC Build Tools、WebView2、Tauri CLI 和 Rust MSVC toolchain 已具备；`cargo check`、8 项 `cargo test`、P0–P5 `pnpm build` 和隔离 P5 `pnpm tauri build` 均通过；终端显示修复与交互回归有证据。MSVC rustfmt 组件仍未安装，格式检查由 GNU rustfmt 完成。

## 4. 执行路线（模块级，≤15 行）

| # | 模块 | 方向 | 完成标志 |
|---|---|---|---|
| 1 | 工程骨架 | 创建 Tauri v2/Vite 工程、命令边界、基础窗口与配置加载 | `pnpm tauri dev` 能启动，配置可读写 |
| 2 | 基础设施 | Rust 文件系统、元数据、路径校验、原子写入、错误映射 | 单元/集成测试覆盖读写与错误 |
| 3 | 工作区 | 文档分区、多工作区/嵌套树、懒枚举、展开状态、新建、移除 | 树层级正确且未选中文件不读正文 |
| 4 | 文本闭环 | Handler Registry、编码识别、1MB 限制、编辑、Ctrl+S、外部修改检测 | 文本 round-trip 与超限/乱码提示通过 |
| 5 | 批注与重命名 | `.qnote` 原子保存/加载、定位字段、单文件重命名与 qnote 事务 | 批注恢复；改名同步；冲突可提示/回滚 |
| 6 | 格式扩展 | Markdown 编辑/预览；`.xlsx` 基础单元格/Sheet 编辑；PDF/DOCX 按需只读阅读 | Markdown 安全降级、Excel round-trip、只读能力有证据 |
| 7 | Windows 集成 | CLI 路径打开、单实例转发、运行时 Shell 注册与 NSIS 安装钩子 | 单实例/CLI/注册表开启清理/安装包构建全部有证据 ✅ |
| 8 | 优化验收 | 虚拟化/懒加载、性能基准、异常恢复、完整回归 | 基准/恢复/四格式回归全部有证据 ✅ |
| 9 | P5 交互优化 | 批注定位、连续 PDF、搜索排序、窗口/右键/树交互、错误恢复 | 核心交互 Demo、批注定位、qnote 恢复、P5 包有证据 |

**行动原则**：按“文件闭环 → 批注/重命名 → Office 阅读 → Windows 集成 → 优化验收”执行；每阶段先做可演示验证，未确认前不扩大到下一阶段。UI 不直接读写磁盘，所有文件操作经 Rust/Application 边界。

## 5. 测试要求（≤10 行）

- 测什么：工作区树、滚动/懒加载、文本编码/1MB 边界、Markdown 编辑/预览安全降级、保存冲突、Excel round-trip、PDF/DOCX 只读、qnote、重命名回滚、移除语义、CLI/单实例/Shell。
- 在哪测：Windows 本机实际运行/打包应用；无测试站、账号或网络后端。
- 数据准备：使用临时目录和覆盖公式/样式/多 Sheet 的样本；临时输入、日志和测试产物放 `.dsh/scratch/`，测试后清理或恢复。
- 执行方式：Rust/TypeScript 单元测试 + 文件集成测试 + 本机桌面手工链路；当前无浏览器 MCP，不声称已完成浏览器验证。
- 回归影响：保存、重命名、工作区恢复、批注和 Shell 均共享路径/状态服务；每次阶段回归文件安全、错误局部化和无正文上传。

## 6. 完成标准（≤10 行）

> 验收环境：Windows 10/11 本机运行或安装包；测试文件使用独立临时夹具。

- AC-1：Logo 菜单仅显示“打开文档/新增工作区”；多选文件进入固定“文档”分区，目录选择建立工作区。
- AC-2：打开工作区只枚举元数据；多级树可展开/折叠、增建文件夹/文档，选中文档才加载正文。
- AC-3：文档分区新建文件落到 `%USERPROFILE%/Documents/quickedit/`；工作区/文件夹新建落到对应目录。
- AC-4：文本可编辑、Ctrl+S/保存可写回；超过配置上限或编码不可靠时明确阻止/提示。
- AC-5：`.xlsx` 可切换 Sheet、编辑单元格并保存；重开修改保留，未编辑内容无明显破坏。
- AC-6：PDF/DOCX 可阅读且原文保存禁用；解析失败可局部提示并可用系统程序打开。
- AC-7：任一已打开文件可添加批注，生成同目录 `完整文件名.qnote`，重开自动恢复且扫描默认忽略 qnote。
- AC-8：单文件重命名校验非法字符/重名/占用；存在 qnote 时同步改名、更新 target，失败有回滚或明确部分成功。
- AC-9：移除只改变列表引用，不删除磁盘文件/qnote；配置可控制后缀、文本上限和会话恢复，启动不预读正文。
- AC-10：CLI/右键可打开文件或文件夹；已有实例接收路径不重复开进程；性能、异常、隐私和原子写入测试有证据。
- 判定：第 4 节所有完成标志达成且 AC-1～AC-10 全部通过 = V1 完成。

## 7. 环境速查（≤10 行）

- 工程结构：源码位于 `src/`、`src-tauri/`，路线图位于 `docs/`；Git master 已推送，稳定 tag 为 `v1.1.0`。
- 需求材料：`设计文档/QuickEdit_Requirements_Specification.md`、`设计文档/QuickEdit_Design_Document.md`、`设计文档/QuickEdit_Markdown_Preview_Requirements_Design.md`、`设计文档/QuickEdit_Post_Markdown_Requirements_Design.md`、`设计文档/quickedit_demo_single_fixed.html`。
- 技术栈：Tauri v2 + Vite + vanilla TypeScript/HTML/CSS + Rust；用户已确认。
- 工具链：Node v24.18.0 ｜ pnpm 11.7.0 ｜ Rust MSVC 1.98.1 ｜ Tauri CLI 2.11.4 ｜ WebView2 ｜ VS Build Tools 2022；已实测可用。
- 启动/构建：`pnpm build` ✅；P5 `pnpm tauri dev` ✅；P5 `pnpm tauri build` ✅（隔离 target 生成含 NSIS Shell 钩子的 MSI/NSIS x64，标准 target 被旧 release 进程锁定）。
- 数据路径：配置/工作区索引实际位于 `%APPDATA%\com.quickedit.desktop\`（config.json / workspace.json）；文档分区默认 `%USERPROFILE%/Documents/quickedit/`。
- 批注路径：目标文件同目录，命名为 `<完整文件名>.qnote`；采用设计对象格式并兼容旧字符串 target。
- 验收：本机桌面应用 + 临时夹具；无测试 URL/账号；桌面 UI 以实际运行、截图/录屏和脚本证据为准。

## 8. 风险与未确认项（≤10 行）

- ✅ MSVC/Windows SDK 已安装并验证；Tauri P0–P4 dev、build、test 全部通过。MSVC rustfmt 组件仍未安装，但不阻塞运行构建。
- ⚠️ 四格式与 P5 PDF 连续阅读已用最小样本实测；复杂 DOCX/Excel 未编辑内容保真、大 PDF/Excel 内存表现建议日常使用中继续观察。
- ✅ 无边框主窗体样式包含 `WS_THICKFRAME`/`WS_MAXIMIZEBOX`，控制区顶部贴边；原生文件选择器完整链路仍建议日常手感确认。右键菜单已实测注册表写入/清理，资源管理器实际显示以系统为准。
- 📌 后续需求（Post-Markdown 文档，低优先级未排期）：图片/PPTX 只读、Capability 模型、Ctrl+F/H 当前文档查找替换、大文件 normal/lazy/readonly/external 分级。
- 📦 历史发布包（v0.1.0 P5）：`.dsh\scratch\sessions\20260915-quickedit-v1\working\target-p5\release\bundle\` 下 MSI 与 NSIS 安装包；安装版默认写入右键/Open With，卸载自动清理。当前稳定版已升级为 `v1.1.0`，以 GitHub Release 为准。

---
