# `cc-skills` 上游组成与运行依赖

## 1. 基线与取证原则

本文以本机仓库 `C:\develop\github\cc-skills` 的提交 `f5359d9821055d7d95d1c914c63546e545932965` 为准。GitHub 固定链接使用同一提交：

- [marketplace.json](https://github.com/rube-de/cc-skills/blob/f5359d9821055d7d95d1c914c63546e545932965/.claude-plugin/marketplace.json)
- [根 README](https://github.com/rube-de/cc-skills/blob/f5359d9821055d7d95d1c914c63546e545932965/README.md)
- [插件 authoring guide](https://github.com/rube-de/cc-skills/blob/f5359d9821055d7d95d1c914c63546e545932965/docs/PLUGIN-AUTHORING.md)

README 用于理解意图，实际目录、frontmatter、`hooks.json` 和脚本才是兼容实现的事实来源。

## 2. 总体清单

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| Marketplace 插件 | 10 | `council`、`cdt`、`pm`、`plugin-dev`、`temporal`、`doppler`、`oasis-dev`、`ci-review`、`jules-review`、`dlc` |
| `SKILL.md` | 26 | 包括用户可调用 Skill 和后台 reference Skill |
| `commands/*.md` | 7 | `cdt` 5 个，`plugin-dev` 2 个 |
| `agents/*.md` | 20 | `council` 8 个、`ci-review` 11 个、`cdt` 1 个 |
| `hooks/hooks.json` | 2 | `council`、`cdt` |
| `scripts/` 文件 | 15 | Hook、GitHub、验证和辅助脚本 |
| `.claude-plugin/plugin.json` | 1 | 只有 `ci-review` 显式提供；Claude manifest 本来就是可选的 |
| `.mcp.json` | 0 | 当前快照中不存在 |

## 3. 插件逐项组成

| 插件 | Skills | Commands | Agents | Hooks | 关键外部依赖 | 主要兼容难点 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `temporal` | 1 | 0 | 0 | 0 | Web、Temporal CLI/SDK | 基本是 reference Skill，接近直接可用 |
| `doppler` | 1 | 0 | 0 | 0 | Web、Doppler CLI | 基本是 reference Skill，命令审批需保留 |
| `oasis-dev` | 1 | 0 | 0 | 0 | Web、Oasis CLI/SDK | 基本是 reference Skill |
| `pm` | 5 | 0 | 0 | 0 | `gh`、Web、交互问答 | `Skill`/`Task` 名称、GitHub 权限、参数语义 |
| `plugin-dev` | 2 | 2 | 0 | 0 | Bun、Shell | legacy command；产物本身是 Claude 插件格式 |
| `dlc` | 10 | 0 | 0 | 0 | `gh`、Git、项目测试工具 | `Task`/`Skill`、Cron、PushNotification、自动修改/发 PR |
| `jules-review` | 1 | 0 | 0 | 0 | `gh`、`council` | `context: fork`、`agent: general-purpose`、逻辑依赖未声明 |
| `council` | 3 | 0 | 8 | 1 | `codex`、`qwen`、`omp`、`opencode` | custom agents、模型路由、Hook 根路径、外部 CLI |
| `ci-review` | 1 | 0 | 11 | 0 | `gh`、GitHub Actions | 11 个 agent、并发、confidence scoring、原子 PR review |
| `cdt` | 1 | 5 | 1 | 1 | Agent Teams、`gh`、`jq`、Shell | 共享任务图、peer messaging、Team/Task 工具、Hook guard |

## 4. 上游实际使用的 Claude 组件

### 4.1 Skills

26 个 Skill 均使用 YAML frontmatter，除了 Agent Skills 标准字段，还出现以下 Claude 扩展：

- `user-invocable`
- `allowed-tools`
- `argument-hint`
- `context: fork`
- `agent`
- `disable-model-invocation`
- `compatibility`

正文还依赖：

- `Skill` / `Task` / `Agent` 等 Claude 工具名；
- `CronList` / `CronDelete` / `PushNotification`；
- `$ARGUMENTS`；
- `/plugin:command`、`/skill-name`、`/loop`、`/schedule` 等调用形式；
- `gh`、Git、项目脚本和外部模型 CLI。

标准 `SKILL.md` 目录结构本身与 Astravia 兼容，差异主要在调用期语义，而不是 Markdown 读取。

### 4.2 Legacy commands

Claude 官方已把 custom commands 合并到 Skills，但仍兼容 `commands/*.md`。本快照仍有 7 个 legacy command：

- `cdt`: `plan-task`、`dev-task`、`full-task`、`auto-task`、`bugfix`
- `plugin-dev`: `create`、`develop`

这些文件不是 Shell command。它们是带 frontmatter 的提示词工作流，依赖 `$ARGUMENTS`，在 Claude 中形成 slash command。Astravia `plugin.json.commands` 则表示允许插件进程执行的二进制名，两者绝不能按字段名直接映射。

### 4.3 Custom agents

20 个 agent 定义的共同结构是 Markdown body + YAML frontmatter，使用字段包括：

- `name`、`description`
- `tools`、`disallowedTools`
- `model`、`maxTurns`
- `permissionMode`
- `skills`
- `memory`
- `color`
- `mcpServers`（`cdt/researcher` 声明 `context7`）

它们不是普通 Skill。Claude 会用 description 自动路由，并为 agent 创建独立上下文、模型和工具面。把 Markdown body 追加到当前会话不能保留这些边界。

### 4.4 Hooks

实际 `hooks.json` 使用范围很窄：只有同步 `type: command` handler。

`council`：

| 事件 | matcher | 命令 |
| --- | --- | --- |
| `SessionStart` | 全部 | `${CLAUDE_PLUGIN_ROOT}/scripts/preflight.sh` |

`cdt`：

| 事件 | matcher | 行为 |
| --- | --- | --- |
| `SessionStart` | 全部 | 检查 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` |
| `UserPromptSubmit` | 全部 | 在 `/cdt...` 提交时阻止未启用 Teams 的运行 |
| `PreToolUse` | `TeamCreate` / `SendMessage` / `TeamDelete` | 检查 Teams、写入或删除 branch-scoped team state |
| `Stop` | 全部 | wave-gate 安全检查、写 Claude transcript custom-title |

因此，**`cc-skills` 首版 Hook 兼容只需 command + sync + 4 个事件**。这不代表可以把 Claude profile 永久限制在这 4 个事件；只是可以把完整官方 Hook parity 放到后续。

### 4.5 Agent Teams

`cdt` 不是“多开几个 agent”。它依赖：

- lead 与 teammate 的独立会话；
- `TeamCreate` / `TeamDelete`；
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`；
- task owner、dependency、blocked 状态；
- `SendMessage` peer mailbox；
- teammate idle、wave gate 和 handoff；
- `~/.claude/teams`、`~/.claude/tasks` 以及项目 `.dev/cdt/<branch>` 状态。

Claude 官方也明确区分 subagent 与 Agent Teams：前者把结果返回 caller，后者有共享任务表和队友直连消息。Astravia 的 root → child 子代理不能直接冒充 Teams。

## 5. 上游自身存在的漂移

实现时需要以文件事实为准，不能只按 README：

1. `council/README.md` 描述了 `PostToolUse` JSON validator，但当前 `council/hooks/hooks.json` 只注册了 `SessionStart`；`validate-json-output.sh` 没有接线。
2. `cdt/README.md` 的 badge 写 4 个 commands，实际目录已有 5 个（包含 `bugfix.md`）。
3. `cdt/SKILL.md` 声称 Context7 MCP 由插件 `.mcp.json` 自动提供，但当前仓库没有任何 `.mcp.json`。
4. 根 authoring guide 对 SKILL 格式的示例不完整，而实际 validator 和所有主要 Skill 都使用 YAML frontmatter。
5. marketplace 的 `requires` 字段未声明实际逻辑依赖，例如 `jules-review` 会调用 `council`。
6. 在 Windows 上运行 `bun scripts/validate-plugins.mjs` 时，marketplace schema、10 个 source path 和 orphan 检查均通过，但 26 个 Skill 全被误报为“missing YAML frontmatter”。实际 frontmatter 存在；原因是 validator 的正则只接受 LF，而当前文件为 CRLF。

这些问题应进入兼容诊断：缺失组件或逻辑依赖要明确警告，不能由 Astravia 静默补猜。
Claude importer 必须先规范化 CRLF/LF 再解析 frontmatter，并保留对应的跨平台 fixture。

## 6. 兼容优先级

### A：接近直接承载

- `temporal`
- `doppler`
- `oasis-dev`

只要 Skill 被发现、相对 references 正确、工具名能被模型理解，主体工作流即可运行。

### B：需要 Skill 调用适配

- `pm`
- `plugin-dev`
- `dlc` 的大部分子 Skill
- `jules-review` 的非 fork 路径

需要 slash alias、参数替换、Claude 工具别名、命令审批和依赖诊断。

### C：需要 custom agent runtime

- `council`
- `ci-review`
- `jules-review` 完整路径

没有 agent loader、agent 级模型/工具/turn 限制和并发结果聚合时，只能运行降级路径。

### D：需要 Agent Teams

- `cdt`

这是独立宿主能力，不应通过 prompt rewrite 或普通 subagent 模拟后标记为完整兼容。
