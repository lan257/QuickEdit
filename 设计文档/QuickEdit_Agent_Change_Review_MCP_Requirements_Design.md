# QuickEdit Agent Change Review & MCP Bridge 需求设计文档

*Agent Change Review & MCP Bridge Requirements & Design*

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Draft |
| 版本 | v2.2 |
| 日期 | 2026-09-17 |
| 所属项目 | QuickEdit |

---

## 1. 定位

QuickEdit 不内置完整 Agent Runtime。

推荐使用：

```text
Workspace Terminal
↓
Claude Code / Codex / 其他 CLI Agent
```

QuickEdit 负责：

> **文件修改审阅、回滚、用户决策记录、文档 UI 联动和批注。**

Agent 负责：

> **分析、计划、文件修改、命令执行。**

---

## 2. 核心目标

建立类似现代 Agent IDE 的修改审阅体验：

```text
Agent 修改文件
↓
QuickEdit 捕获本轮 ChangeSet
↓
展示修改文件 + Diff
↓
用户：
[确认]
或
[回滚]
↓
记录决策
↓
Agent 可读取决策结果
```

---

## 3. ChangeSet

```ts
type ChangeSetStatus =
  | "recording"
  | "pending"
  | "approved"
  | "rejected"
  | "conflict";

interface ChangeSet {
  id: string;

  source:
    | "agent"
    | "external";

  agentSessionId?: string;

  createdAt: string;
  completedAt?: string;

  status: ChangeSetStatus;

  files: FileChange[];

  summary?: string;

  decision?: {
    decidedAt: string;
    reason?: string;
  };
}
```

---

## 4. FileChange

```ts
interface FileChange {
  path: string;

  action:
    | "modified"
    | "created"
    | "deleted"
    | "renamed";

  oldPath?: string;

  beforeHash?: string;
  afterHash?: string;

  hunks: ChangeHunk[];
}
```

---

## 5. Audit 与 Rollback 分离

Change Review 必须拆成：

```text
Audit Record
+
Rollback Payload
```

### Audit Record

长期轻量保留：

- ChangeSet id；
- 时间；
- 文件；
- hunk metadata；
- approved / rejected；
- reject reason；
- agent session。

### Rollback Payload

临时保存：

- before snapshot；
- created/deleted file payload；
- rename source info。

---

## 6. 用户确认

```text
pending
↓
Approve
↓
approved
```

之后：

```text
Audit Record      保留
Rollback Payload  删除
```

确认意味着：

> QuickEdit 不再承担本轮回滚责任。

---

## 7. 用户回滚

```text
pending
↓
Rollback
↓
恢复 baseline
↓
rejected
```

之后：

```text
Audit Record      保留
Rollback Payload  删除
```

可以记录：

```text
reason
```

例如：

```text
不要修改这个配置名称
```

---

## 8. 为什么需要 review.begin

如果 Agent 先修改磁盘，QuickEdit 后观察，只能看到 after，未必拥有 before。

因此无法可靠回滚。

推荐：

```text
review.begin(paths)
↓
保存 baseline
↓
Agent 使用自己的编辑工具
↓
review.capture()
↓
计算 before vs current disk
```

---

## 9. review.begin

MCP：

```text
review.begin
```

输入：

```json
{
  "paths": [
    "config.json",
    "src/app.ts"
  ],
  "summary": "调整缓存配置"
}
```

QuickEdit：

- 验证路径位于允许 Workspace；
- 保存 baseline；
- 建立 `recording` ChangeSet；
- 返回 `changeSetId`。

---

## 10. review.capture

Agent 修改完成：

```text
review.capture(changeSetId)
```

QuickEdit：

1. 读取当前磁盘；
2. 与 baseline 比较；
3. 计算 FileChange；
4. 生成 Diff；
5. 状态改为 `pending`；
6. 打开 Review UI。

---

## 11. Review UI

第一版只做整轮审批。

```text
本轮修改 4 个文件

▼ config.json          +3 -2
▼ src/app.ts           +8 -4
▼ README.md            +2 -0

[确认本轮修改]
[回滚本轮修改]
```

文件展开：

```diff
- "timeout": 10
+ "timeout": 30
```

---

## 12. V1 不做 Hunk 级审批

V1 不提供：

- Accept Line；
- Reject Line；
- Accept Hunk；
- Reject Hunk。

原因：

- rollback 组合复杂；
- 文件状态重新组合复杂；
- 与产品核心价值相比优先级低。

P3 再评估。

---

## 13. Agent 不得审批自己

MCP 不提供：

```text
review.approve
review.reject
```

审批行为只来自 QuickEdit UI。

Agent 只能：

```text
review.get
review.history
```

---

## 14. review.get

返回：

```json
{
  "id": "...",
  "status": "rejected",
  "decision": {
    "reason": "不要修改配置名称"
  }
}
```

这样 Agent 下一轮可以理解：

- 哪些修改被接受；
- 哪些被拒绝；
- 为什么。

---

## 15. review.history

用于读取最近审阅记录。

支持过滤：

```text
approved
rejected
path
agentSessionId
time range
```

默认只返回轻量 metadata，不返回完整历史文件内容。

---

## 16. 未追踪外部修改

普通脚本或编辑器可能未调用 `review.begin`。

这类：

```text
source = external
```

如果 QuickEdit 有可用 baseline，可以生成 Diff。

否则只能提示 external modification，不承诺可靠 rollback。

---

## 17. Crash Safety

`recording / pending` ChangeSet 必须落盘。

建议：

```text
%LOCALAPPDATA%/QuickEdit/reviews/
```

结构：

```text
reviews/
├── audit/
└── rollback/
```

QuickEdit 崩溃后：

```text
Pending Review 仍可恢复
```

---

## 18. 与 Recovery Draft 的关系

Recovery Draft：

```text
保护 QuickEdit 内部未保存修改
```

Change Review：

```text
保护 Agent / 外部程序磁盘修改
```

两者不合并为同一机制。

---

## 19. 冲突

如果 Agent 修改期间用户又在 QuickEdit 内编辑同一个文件：

```text
baseline
+
agent disk
+
QuickEdit dirty memory
```

ChangeSet：

```text
status = conflict
```

不得自动 approve / rollback。

UI 要求用户：

```text
查看冲突
选择保留版本
```

---

## 20. MCP Bridge 定位

MCP 只提供：

```text
QuickEdit 独有能力
```

不重复 Agent 已有文件 / Shell 工具。

---

## 21. MCP Tools

### Document

#### `document.get_active_context`

返回：

- active file；
- view mode；
- selection；
- locator；
- workspace root。

示例：

```json
{
  "path": "src/app.ts",
  "selection": {
    "text": "timeout = 30"
  },
  "locator": {
    "kind": "text",
    "line": 38,
    "column": 7
  }
}
```

#### `document.open`

让 QuickEdit 打开文件，只影响 UI。

#### `document.reveal`

统一 Locator：

```ts
type Locator =
  | {
      kind: "text";
      line: number;
      column?: number;
    }
  | {
      kind: "pdf";
      page: number;
    }
  | {
      kind: "spreadsheet";
      sheet: string;
      cell: string;
    }
  | {
      kind: "slide";
      slide: number;
    };
```

---

### Review

```text
review.begin
review.capture
review.get
review.history
```

---

### Annotation

```text
annotations.list
annotations.create
annotations.update
annotations.resolve
annotations.reveal
```

---

## 22. 不提供的 MCP

不优先提供：

```text
read_file
write_file
apply_patch
delete_file
rename_file
run_terminal
workspace_search
git_*
approve_change
reject_change
```

原因：

- CLI Agent 已有文件 / Shell 能力；
- QuickEdit 不重复权限模型；
- Agent 不应该审批自身修改。

---

## 23. Annotation + Agent

典型工作流：

```text
用户在 Excel Sheet2!F18 加批注：
“这里金额不对，帮我检查”

↓
Agent:
annotations.list(status="open")

↓
分析 / 修改

↓
Agent:
annotations.resolve(id)

↓
QuickEdit UI 显示 resolved
```

---

## 24. Change Review + Annotation

Agent 完成修改后，可以创建说明批注：

```text
此处由 Agent 根据税率配置调整。
```

来源：

```text
source = agent
```

用户可以：

- 保留；
- resolve；
- 删除。

---

## 25. MCP Transport

推荐：

```text
Claude Code
↓ stdio MCP
quickedit-mcp
↓ local IPC
QuickEdit
```

可复用 QuickEdit Windows 单实例通信能力：

```text
Named Pipe / Local IPC
```

Command：

```text
Open
Reveal
GetActiveContext
ReviewBegin
ReviewCapture
ReviewGet
AnnotationList
...
```

---

## 26. 安全边界

MCP 必须限制：

- 只访问 QuickEdit 当前允许 Workspace；
- 不通过 MCP 获得管理员权限；
- 不自动批准；
- 不绕过 QuickEdit 外部修改保护；
- 不暴露无关本地路径；
- Mutation tools 记录来源。

---

## 27. 审计保留

建议 approved / rejected metadata 默认保留有限时间或有限数量。

例如：

```text
最近 100 条
或
30 天
```

不默认长期保存完整 before/after 文件内容。

---

## 28. 实施顺序

### P0

- ChangeSet model；
- rollback baseline；
- review.begin；
- review.capture；
- Review UI；
- Approve / Rollback；
- Crash-safe pending review。

### P1

- review.get；
- review.history；
- reject reason；
- document.get_active_context；
- document.open / reveal。

### P2

- Annotation MCP；
- external change review；
- richer Diff；
- multiple agent sessions。

### P3

- Hunk approve/reject；
- selective rollback；
- richer audit query。

---

## 29. 验收标准

1. `review.begin` 后 Agent 修改可被完整捕获；
2. Review UI 能显示本轮修改文件与 Diff；
3. Approve 后 rollback payload 被删除；
4. Audit Record 仍保留 approved；
5. Rollback 可恢复 baseline；
6. Rollback 后 Audit Record 为 rejected；
7. Agent 可读取拒绝原因；
8. Agent 无法通过 MCP 自己 approve；
9. QuickEdit 崩溃后 pending ChangeSet 可恢复；
10. `document.reveal` 可定位 Text / PDF / XLSX / PPTX；
11. MCP 不承担 Shell / 文件编辑权限体系。

---

## 30. 总结

QuickEdit 的 Agent 集成边界：

```text
Agent
负责修改

QuickEdit
负责展示、审阅、定位、批注

用户
负责最终决定
```

这比内置完整 Agent 更轻，也更符合 QuickEdit 的产品定位。
