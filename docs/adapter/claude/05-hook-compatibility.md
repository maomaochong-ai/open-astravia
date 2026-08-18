# Claude Code Hook 首期兼容分析

## 文档状态

- 分析日期：2026-07-17
- 外部基线：`rube-de/cc-skills@f5359d9821055d7d95d1c914c63546e545932965`（2.6.2）
- 目标：先兼容 `cc-skills` 实际使用的 Hook，并为低依赖 Skill 提供可运行基础
- 非目标：首期实现 Claude Code 全部 Hook 事件和全部 handler 类型

## 结论

Claude Code 官方当前提供 30 个 Hook 事件和 `command`、`http`、`mcp_tool`、`prompt`、`agent` 五类 handler。`cc-skills` 实际只定义了 5 组事件配置，去重后仅涉及：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `Stop`

这些配置全部是同步 `command` handler。因此，Vetta 首期不需要追求官方全量兼容；应先新增独立的 Claude Hook profile，复用现有 dispatcher/executor，精确实现上述四个事件、同步命令执行、matcher、stdin/stdout/stderr、退出码和最小结构化决策。

需要明确：Hook 协议兼容不等于插件功能完整兼容。`council` 的 `SessionStart` 预检可以独立工作；`cdt` 的三个阻断 Hook 和 `Stop` Hook 都依赖 Agent Teams、团队工具和团队状态，即使能正确加载，也只能给出能力诊断，不能让 CDT 完整运行。

## Claude Code 官方 Hook 事件

### 会话、初始化和配置

| 事件 | 触发时机 |
| --- | --- |
| `Setup` | `--init-only`、`--init` 或维护初始化流程 |
| `SessionStart` | 会话启动、恢复、清空或压缩后恢复 |
| `InstructionsLoaded` | `CLAUDE.md` 或 `.claude/rules/*.md` 被载入上下文 |
| `ConfigChange` | 会话期间配置发生变化 |
| `CwdChanged` | 工作目录发生变化 |
| `FileChanged` | 受监控文件发生变化 |
| `SessionEnd` | 会话终止 |

### 用户输入、消息和通知

| 事件 | 触发时机 |
| --- | --- |
| `UserPromptSubmit` | 用户提交提示词后、模型处理前 |
| `UserPromptExpansion` | 用户直接调用的命令或 Skill 展开后、进入模型前 |
| `MessageDisplay` | 助手消息文本显示期间 |
| `Notification` | Claude Code 发出权限、空闲或其他通知时 |

### 工具与权限

| 事件 | 触发时机 |
| --- | --- |
| `PreToolUse` | 工具执行前，可以允许、拒绝、询问或延迟 |
| `PermissionRequest` | 权限确认界面出现时 |
| `PermissionDenied` | 自动权限分类器拒绝工具调用后 |
| `PostToolUse` | 工具执行成功后 |
| `PostToolUseFailure` | 工具执行失败后 |
| `PostToolBatch` | 一批并行工具全部完成、下一次模型调用前 |

### 子代理、任务和团队

| 事件 | 触发时机 |
| --- | --- |
| `SubagentStart` | 子代理启动时 |
| `SubagentStop` | 子代理准备结束时 |
| `TaskCreated` | 任务即将创建时 |
| `TaskCompleted` | 任务即将标记完成时 |
| `TeammateIdle` | Agent Team 成员即将空闲时 |

### 响应、压缩、Worktree 和 MCP

| 事件 | 触发时机 |
| --- | --- |
| `Stop` | 主代理准备结束当前响应时 |
| `StopFailure` | API 错误导致当前轮次结束时 |
| `PreCompact` | 上下文压缩前 |
| `PostCompact` | 上下文压缩完成后 |
| `WorktreeCreate` | 创建工作树时 |
| `WorktreeRemove` | 删除工作树时 |
| `Elicitation` | MCP Server 请求用户输入时 |
| `ElicitationResult` | 用户回答后、结果返回 MCP Server 前 |

## Hook 配置和运行协议

Claude Hook 配置分为三层：事件、matcher group、handler。插件配置位于 `hooks/hooks.json`；此外还可以来自用户、项目和本地 settings，以及 Skill 或 Agent frontmatter。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/check.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

首期只读取插件的 `hooks/hooks.json`。用户级、项目级 settings 和 Skill/Agent frontmatter Hook 后续再接入，避免一开始同时处理配置合并、优先级和动态生命周期。

### 输入

同步命令从 stdin 接收 JSON。公共字段至少包括：

```json
{
  "session_id": "session-id",
  "transcript_path": "path/to/session.jsonl",
  "cwd": "project/path",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse"
}
```

事件再增加自身字段：

| 事件 | 首期事件字段 |
| --- | --- |
| `SessionStart` | `source`、`model`，可选 `agent_type` |
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`、`tool_input`、`tool_use_id` |
| `Stop` | `stop_hook_active` |

### 输出和退出码

首期应保留以下 Claude 行为：

- exit 0：命令正常完成，解析 stdout；无输出代表无决策。
- exit 2：按照事件语义阻止操作；主要反馈读取 stderr。
- 其他退出码：记录非阻断 Hook 错误，默认继续原操作。
- `SessionStart` 和 `UserPromptSubmit` 的普通 stdout 可以作为附加上下文。
- JSON stdout 可以携带 `decision`、`reason` 或事件专用输出。
- 多个匹配 handler 都要执行；只要存在拒绝结果，最终决策就是拒绝。

`WorktreeCreate` 对非零退出码有特殊语义，但它不属于首期范围。

## cc-skills 实际 Hook

### council

`plugins/council/hooks/hooks.json` 只注册一个 `SessionStart` handler：

```text
scripts/preflight.sh
```

脚本检查 `codex`、`qwen`、`omp`、`opencode` 是否存在。如果存在缺失项，它向 stdout 输出提醒但仍返回成功。这是最适合首个验收用例的 Hook：不修改状态、不阻止用户操作，也不依赖 Vetta 工具映射。

### cdt

`plugins/cdt/hooks/hooks.json` 注册以下行为：

| 事件 | matcher | 脚本 | 行为 |
| --- | --- | --- | --- |
| `SessionStart` | 无 | `check-agent-teams.sh` | 未启用 Agent Teams 时返回 exit 2；该事件本身不可阻止，只产生警告 |
| `UserPromptSubmit` | 无 | `block-cdt-without-teams.sh` | 检测 `/cdt`，以 `decision: "block"` 阻止提示词 |
| `PreToolUse` | `TeamCreate` | 两个脚本 | 检查 Teams，并写入分支级团队状态 |
| `PreToolUse` | `SendMessage` | 一个脚本 | 检查 Teams 是否启用 |
| `PreToolUse` | `TeamDelete` | 两个脚本 | 检查 Teams，并清除团队状态 |
| `Stop` | 无 | `check-wave-gate-handoff.sh` | 返回 `decision: "block"`，要求主代理检查未交接任务 |
| `Stop` | 无 | `set-session-title.sh` | 直接向 Claude transcript 追加自定义标题事件 |

CDT 的 `Stop` 兼容尤其需要谨慎：Vetta 必须在 Hook 阻止停止后继续模型循环，并在重入时发送 `stop_hook_active: true`。否则同一个 Hook 会反复阻止停止。`set-session-title.sh` 直接依赖 Claude transcript JSONL 私有格式，不能在 Vetta 中原样视为有效功能；应诊断为“脚本可执行，但目标 transcript 协议不兼容”，未来改用 Vetta 会话标题 API。

## Vetta 首期兼容范围

### H0：加载与安全边界

在 `ecosystem-adapter` 中新增独立 Claude Hook profile：

- 读取插件 `hooks/hooks.json`。
- 校验事件、matcher group 和 handler schema。
- 将 `${CLAUDE_PLUGIN_ROOT}` 展开为已验证的插件绝对路径。
- 注入 `CLAUDE_PLUGIN_ROOT` 和 `CLAUDE_PROJECT_DIR`。
- 只允许显式启用且经过用户信任确认的插件执行命令。
- 未支持事件和字段产生诊断，不静默丢弃。
- 不复用或扩展 Codex profile 的 wire schema。

### H1：四个事件

| 事件 | 首期必须支持的语义 | 可暂缓 |
| --- | --- | --- |
| `SessionStart` | source matcher、stdin、stdout context、非阻断错误 | `CLAUDE_ENV_FILE` 持久环境更新 |
| `UserPromptSubmit` | prompt 输入、附加上下文、`decision: block` | `sessionTitle` |
| `PreToolUse` | 工具名 matcher、exit 2 拒绝、结构化 deny | 修改输入、ask、defer、权限规则更新 |
| `Stop` | `decision: block`、reason、继续模型循环、重入标记 | prompt/agent handler |

### H2：常用低风险事件

四个基线事件稳定后，可以增加：

- `PostToolUse`（已实现）
- `PostToolUseFailure`（已实现：工具 `execute` 抛错后触发；exit 2 反馈 / `additionalContext`；不可撤销失败）
- `Notification`
- `SubagentStart`（已实现：coordinator spawn 后首轮 prompt 前；可阻断；additionalContext 注入任务消息）
- `SubagentStop`（已实现：自然结束可续跑 ≤8 次；interrupt/failed best-effort 不续跑）
- `PermissionRequest`（已实现：沙箱权限 UI 前；allow/deny 短路）
- `PreCompact`（已实现）
- `PostCompact`（已实现）
- `SessionEnd`（已实现：宿主用 Vetta `SessionEndCause`（`new_session` / `switch_session` / `fork_session` / `dispose`）；Claude profile 映射为 stdin/matcher 的 `reason`（`clear` / `resume` / `other` 等）；不可阻断拆会话）

其中 `PostToolUse` 和 `PostToolUseFailure` 适合格式化、审计和反馈，是普通 Skill/插件最常见的扩展点；它们不应被宣称可以撤销已经发生的工具副作用。

### 首期不支持

- `http`、`mcp_tool`、`prompt`、`agent` handler。
- async Hook。
- Agent Teams、Task、Teammate Hook。
- Worktree 和 MCP Elicitation Hook。
- settings 多来源合并与 managed policy。
- Claude transcript 私有格式写入。
- Claude 工具名和 Vetta 工具名的完整一一映射。

## Matcher 兼容建议

首期支持三种模式：

1. `"*"`、空字符串或缺省：全部匹配。
2. 简单名称以及 `|`/`,` 分隔：精确名称集合。
3. 含其他特殊字符：JavaScript 正则表达式。

`PreToolUse` 不能直接拿 Claude 工具名匹配 Vetta 内部实现名。应在 Claude profile 中维护稳定的兼容工具名，例如把 Vetta 的命令执行、文件读取、文件写入和子代理入口映射为 Claude 侧 `Bash`、`Read`、`Write`/`Edit`、`Agent`。无法可靠映射的工具必须显示诊断。

## Windows 运行边界

本基线六个 Hook 脚本全部是 `.sh`，还依赖 Bash、`jq`、`grep`、`sed`、`stat` 和 `git`。Vetta 当前 Windows Hook runner 使用 `cmd.exe`，不能原样执行。

首期采用以下策略：

1. 根据 shebang 和扩展名选择运行器，禁止把 `.sh` 交给 `cmd.exe`。
2. 检测 Git Bash 或系统 Bash，并检测脚本声明或实际依赖的命令。
3. 缺少 Bash、`jq` 等运行条件时，插件仍可安装，但 Hook 标记为不可运行并显示原因。
4. 不自动将 Bash 转译为 PowerShell。
5. 后续若 Vetta 提供托管 POSIX runtime，仍通过同一 executor 接口接入。

## 建议模块边界

```text
packages/ecosystem-adapter/src/claude-code/hooks/
├── schema.ts
├── loader.ts
├── matcher.ts
├── adapter.ts
├── tool-name-map.ts
└── diagnostics.ts
```

- `ecosystem-adapter`：Claude JSON 解析、matcher、wire contract、工具名映射和诊断。
- `coding-agent`：在真实生命周期节点发出事件，应用 block/context 决策，并处理 `Stop` 重入。
- `desktop`：插件信任、命令权限、运行环境检测和用户可见诊断；所有文案走 i18n。

命令执行继续复用通用 executor，不在 Claude adapter 内再实现一套进程管理。

## 验收标准

### 协议验收

- 能加载 `council` 和 `cdt` 的原始 `hooks/hooks.json`，无需修改上游文件。
- CRLF 和 LF 配置/脚本都能识别。
- 不支持的事件、handler 和字段都有结构化诊断。
- 插件路径包含空格时，`${CLAUDE_PLUGIN_ROOT}` 仍能安全展开。
- Hook 收到的 stdin 是合法 JSON，公共字段和事件字段符合约定。
- exit 0、exit 2、其他退出码、超时和无效 JSON 分别有测试。
- 多 handler 场景中拒绝结果优先。

### 行为验收

- `council` 启动时能运行 preflight，并把缺失 CLI 提醒加入上下文或诊断。
- `UserPromptSubmit` 能阻止匹配提示词，未匹配提示词不受影响。
- `PreToolUse` matcher 只作用于映射后的目标工具。
- `Stop` 被阻止后模型继续执行；下一次 Stop 输入包含 `stop_hook_active: true`。
- 没有 Agent Teams 时，CDT 明确显示功能不兼容，而不是报告插件完整可用。
- Windows 缺少 Bash 时不会回退到 `cmd.exe` 错误执行 `.sh`。

### 安全验收

- 未经信任的插件不能执行 Hook 命令。
- 插件根目录变量不能通过 `..` 或符号链接逃逸到未授权目标。
- Hook 超时后进程及其子进程被终止。
- stdout/stderr 大小受限，避免插件耗尽宿主内存。
- 日志不会泄露完整环境变量或密钥。

## 推荐实施顺序

```text
Claude plugin Hook loader
  → 同步 command handler
  → SessionStart
  → UserPromptSubmit
  → PreToolUse
  → Stop
  → PostToolUse / PostToolUseFailure
  → 其余官方事件和 handler
```

首个可验证成果应是 `council` 的非阻断 `SessionStart` 预检。随后再接入会改变 Agent 控制流的阻断事件，避免一开始同时调试插件发现、命令运行和模型循环重入。

## 参考资料

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Automate workflows with hooks](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [`cc-skills` Hook 资源盘点](./01-cc-skills-inventory.md)
- [Vetta 兼容性矩阵](./02-compatibility-matrix.md)
- [Vetta 目标架构](./03-target-architecture.md)
