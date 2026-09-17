# QuickEdit

QuickEdit 是一个 **Windows 优先、轻量、本地、快速的文件编辑与阅读工作区**。

它不是为了替代完整的 WPS、Microsoft Office 或 VS Code，也不是一个大而全的 IDE，而是为“打开本地文件、快速查看、简单编辑、批注和保存”这类高频任务提供一个更轻、更快、更集中的入口。

## 为什么需要 QuickEdit

在日常使用 WPS、VS Code 等工具时，从零启动应用并打开一个 Excel、DOCX、PDF 或 Markdown 文档，通常需要等待较长时间，才能进入正常的编辑或阅读状态；当应用已经打开后，继续打开新文档的体验也常常伴随较重的加载过程。

QuickEdit 的核心目标，就是降低这类高频操作的启动成本：

- **从零打开**：在开发者本机的实际使用体验中，打开 Excel、DOCX、PDF、Markdown 等文件，通常不超过 5 秒即可进入编辑或渲染状态
- **连续打开**：QuickEdit 已启动的情况下，继续打开新的文档通常不到 1 秒
- **按需加载**：先加载工作区和文件元数据，选中文件后才加载正文或对应解析器
- **低干扰工作流**：不需要为了查看一个文件启动一整套重量级应用

> 以上时间是当前开发者本机的实际体验描述，不是对所有电脑、文件大小和文件复杂度的统一性能承诺。实际耗时会受到硬件、文件大小、文档结构和解析复杂度影响。

## 产品定位

QuickEdit 可以概括为：

> **一个面向 Windows 的本地资料工作台，用于快速查看、定位、批注、编辑和保存文件。**

它更适合以下场景：

- 管理一个包含文档、脚本、笔记、表格和资料的本地 Workspace
- 快速浏览和筛选文件，而不是启动完整办公套件
- 对文本和 Markdown 进行高频小规模编辑
- 快速查看或修改 XLSX 表格
- 阅读 PDF 和 DOCX，并在文件旁保存批注
- 在同一个窗口内完成文件管理、查找替换、阅读、编辑和终端调用

QuickEdit 更像是“本地文件工作台”，而不是传统意义上的办公软件、写作软件或开发 IDE。它关注的是：**让本地文件更快被打开、更快被理解，也更快被处理。**

## 核心设计原则

### 本地优先

文件直接在本机处理，不依赖云端同步、在线账号或网络服务。文件系统读写统一经过 Rust command 层，尽量保证操作路径清晰、稳定、可控。

### 轻量快速

性能重点不是盲目追求复杂解析的极限速度，而是避免不必要的工作：

- 启动时不解析文档正文
- 打开工作区时优先读取文件元数据
- 选中文件后才加载对应内容
- Excel、PDF、DOCX 等解析能力按需启用
- 大目录支持异步枚举和懒加载思路

核心原则是：

> **宁可多次短等待，也不允许一次长时间冻结。**

### 单窗口工作流

文本、Markdown、Excel、PDF 和 DOCX 尽量使用同一套工作区入口完成，减少在多个应用之间切换的成本。

### 简单、可靠、低侵入

QuickEdit 不直接把批注写入原文件，而是使用同目录伴生的 `.qnote` 文件保存批注；保存时关注外部修改检测、原子写入和文件内容安全，尽量不破坏用户原有文件。

## 主要能力

### Workspace / 文件管理

- 打开本地工作目录
- 只读取文件元数据构建工作区
- 选中文件后再加载正文
- 搜索和过滤文件列表
- 从列表移除文件但不删除磁盘文件
- 使用 `F2` 重命名文件或文件夹
- 复制完整文件路径

### 文本与 Markdown

- 支持 UTF-8、UTF-8 BOM、UTF-16
- 文本编辑、保存和外部修改检测
- Markdown 编辑与预览双模式
- 预览不会修改原始 Markdown 内容
- `Ctrl+F` 查找、`Ctrl+H` 替换
- 支持上一个/下一个、大小写匹配、单次替换和全部替换

### Excel / XLSX

- Sheet 切换
- 基础单元格编辑
- 保存回写
- 显示当前 Sheet 与单元格位置

### PDF / DOCX

- 本地只读阅读
- PDF 翻页和当前页状态
- DOCX 内容渲染
- 支持批注
- 复杂编辑场景可交给系统程序处理

### 批注

- 批注保存为原文件同目录的伴生 `.qnote` 文件
- 不直接修改原文件
- 支持全文、文本选区、PDF 页面、Excel 单元格和 Markdown 预览选区

### Windows 集成

- 单实例运行和命令行参数转发
- 资源管理器右键菜单 / Open With
- 外部 `cmd.exe` 终端
- 根据 Workspace、当前文件或用户目录设置终端工作路径

## V1 与 V2

QuickEdit 的版本规划不是简单地“不断堆叠功能”，而是先建立稳定基础，再验证新的文件能力和工作流。

### V1：稳定基础版本

V1 定位为 QuickEdit 的 **稳定基础版本**。

当前已有功能已经能够覆盖日常约 80% 的基础使用需求，因此 V1 后续重点不是持续增加复杂功能，而是维护和完善现有能力，包括：

- 稳定性优化
- 性能改进
- 打开和保存体验优化
- 交互细节调整
- 兼容性改进
- Bug 修复
- 安装包和 Windows 集成的持续维护

除非出现非常明确且必要的需求，V1 不再轻易引入新的复杂功能，尽量保持：

> **简单、轻量、稳定，并长期作为可靠的基础版本持续维护。**

V1 主要覆盖：

- Workspace 文件管理
- 文本与 Markdown 编辑/预览
- XLSX 基础编辑
- PDF / DOCX 阅读
- 文件批注
- 查找与替换
- 文件重命名和路径复制
- 外部终端
- 单实例、命令行和资源管理器集成

### V2：改进版与实验版本

V2 定位为 QuickEdit 的 **改进版与实验版本**，用于承载新的设计、新的文件能力，以及一些尚未经过充分验证的功能。

V2 前期会更重视功能探索和快速实现，优先验证：

- 新功能是否真正有价值
- 是否符合 QuickEdit 的整体定位
- 是否能改善“快速查看、简单编辑、批注和审阅”工作流
- 新的文件格式能力是否值得长期维护

因此，V2 前期不会把主要精力投入到每项新功能的深度优化和细节修复上，而是允许部分功能处于实验和验证状态。

待主要功能逐渐成熟后，V2 将进入收敛阶段：

- 删除价值有限或不符合定位的功能
- 统一交互和架构
- 集中处理稳定性、性能和 Bug
- 完善数据恢复、冲突处理和批注体验
- 最终封装为可以长期持续维护的正式 V2 版本

V2 计划方向包括：

- HTML 静态安全预览
- 崩溃恢复和自动保存恢复草稿
- 外部修改冲突检测与简单合并
- Annotation V2：让批注真正附着在文本、单元格或页面内容上
- 批注搜索、标签、状态和导出
- 图片只读 Viewer
- XLSX 虚拟化和大文件降级策略
- PDF 大文件按页加载
- PPTX 只读 Viewer
- 轻量 Workspace 搜索
- Agent Change Review 和 MCP UI Bridge

V2 仍然不会默认演进为：

- IDE
- 完整 Office 套件
- Git GUI
- Build / Debug / Test 系统
- Agent 自主执行平台
- 云同步或多人协作平台
- 超大文件分析器

QuickEdit 的长期边界是：

> **QuickEdit 负责查看、定位、批注、审阅和确认；复杂分析、Agent Planning 和 Shell Execution 交给专业工具。**

## 技术栈

- Tauri v2
- Vite
- TypeScript
- HTML / CSS
- Rust

前端负责界面和交互，Rust 负责本地文件系统访问、编码处理、命令封装、原子写入和 Windows 集成。

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
├── src/                    # 前端代码
│   ├── main.ts             # UI / 状态逻辑
│   ├── styles.css          # 样式
│   └── QuickEdit_Config_Help.md
├── src-tauri/              # Rust 后端与桌面集成
│   ├── src/lib.rs
│   ├── tauri.conf.json
│   └── windows/
├── docs/                   # 开发与版本计划文档
├── 设计文档/                # 需求与设计文档
└── README.md
```

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/QuickEdit_Development_v1.md` | V1 架构、命令清单、实现和验证流程 |
| `docs/QuickEdit_V1_Stable_V2_Plan_v1.md` | V1 稳定版范围与 V2 规划原则 |
| `docs/QuickEdit_Undeveloped_v2.md` | v2.0+ 待开发项的单一入口 |
| `docs/QuickEdit_Execution_Roadmap_v1.md` | P0–P5 执行路线图 |
| `设计文档/QuickEdit_Requirements_Specification.md` | 需求规格 |
| `设计文档/QuickEdit_Design_Document.md` | 总体设计与架构文档 |
| `设计文档/QuickEdit_v2_Plus_Requirements_Design_Roadmap.md` | v2.0+ 需求设计与演进路线 |
| `设计文档/QuickEdit_Annotation_V2_Requirements_Design.md` | Annotation V2 设计 |
| `设计文档/QuickEdit_Agent_Change_Review_MCP_Requirements_Design.md` | Agent Change Review 与 MCP Bridge 设计 |

## 版本状态

- 当前版本：`0.1.0`
- V1：稳定版候选，现有核心能力已基本完成，后续以维护、优化和修复为主
- V2：改进版与实验版本，需求设计已形成，功能将按验证结果逐步推进

## 一句话总结

**QuickEdit 是一个面向 Windows 的本地文件工作台：用更低的启动成本，快速打开、查看、编辑、批注和保存 Excel、DOCX、PDF、Markdown 以及其他常用文件。**
