# Astravia 能力与 Claude Code 兼容差距

## 1. 当前 Astravia 可复用基础

### 1.1 Skills

Astravia 已实现 Agent Skills 的核心加载模型：

- 递归发现子目录 `SKILL.md`；
- 支持用户、项目、`.agents/skills` 与显式 `skillPaths`；
- 只把 name/description 放进系统提示，命中后通过 `invoke_skill` 加载完整正文；
- 支持 `disable-model-invocation`；
- 保留 Skill 目录并提示相对资源按目录解析。

依据见 [skills.ts](../../../packages/coding-agent/src/core/skills.ts)、[skill-expansion.ts](../../../packages/coding-agent/src/core/session/skill-expansion.ts) 和 [invoke-skill](../../../packages/coding-agent/src/core/tools/invoke-skill/index.ts)。

### 1.2 Subagents

Astravia 已有可扩展的 `SubagentTypeRegistry` 和独立 child session：

- root 可 `spawn_agent`、`wait_agent`、`list_agents`、`interrupt_agent`、`send_message`、`followup_task`；
- child 有独立 transcript、usage 和生命周期状态；
- registry 可横向注册新 type；
- 默认只注册只读 `explorer`；
- child 默认不能继续 spawn；
- root MCP 工具可按 type 选择继承。

依据见 [subagents/types.ts](../../../packages/coding-agent/src/core/subagents/types.ts)、[session-factory.ts](../../../packages/coding-agent/src/core/subagents/session-factory.ts) 和 [subagents/index.ts](../../../packages/coding-agent/src/core/subagents/index.ts)。

### 1.3 Hooks

`@astravia/ecosystem-adapter` 已把通用 runtime 与 Codex wire profile 分开：

- 通用层管理 session/turn、adapter 聚合、Stop continuation 安全阀；
- dispatcher 管理 matcher、并发 handler、命令执行和 effect 聚合；
- profile 负责输入编码、输出解释、事件语义与工具名映射；
- `HookConfigSource` 可携带 plugin env 和 plugin id；
- Codex adapter 只读取宿主显式提供的配置源。

这一结构适合追加 Claude adapter，但当前通用事件联合和 effect 仍明显受 Codex 10 事件塑形。

## 2. 总体兼容矩阵

| Claude Code 能力 | Astravia 当前状态 | `cc-skills` 影响 | 结论 |
| --- | --- | --- | --- |
| 目录式 `SKILL.md` | 已支持 | 26 个 Skill 可被发现 | 可复用 |
| Plugin skills 自动发现 | 通过 Astravia `agent.skillPaths` 支持 | 需要先包装/导入 Claude plugin | 需 importer |
| `/skill-name` | Astravia 标准为 `/skill:name` | 上游文档和 commands 使用 `/name` | 需输入 alias |
| `$ARGUMENTS` | 不替换，只把 args 另行附加 | 7 个 commands 直接依赖 | 需兼容展开器 |
| 动态命令上下文 | 未实现 | 当前仓库使用较少，但属于 Claude Skill 语义 | 后续 profile |
| `user-invocable` | parser 忽略 | background reference Skill 可能错误出现在菜单 | 需保留字段 |
| `allowed-tools` | parser 忽略 | 既不预授权，也不形成限制 | 需权限映射，不可只提示 |
| `context: fork` / `agent` | parser 忽略 | `jules-review` 不能按原语义隔离运行 | 需 Skill runner |
| `commands/*.md` | 无 Claude command loader | 7 个 slash workflow 不可见 | 转换为 Skill contribution |
| `agents/*.md` | 无资源 loader | 20 个 agent 不注册 | 编译到 subagent registry |
| agent 模型/maxTurns/memory | type 定义不具备完整字段 | review 成本、能力和停止边界丢失 | 扩展 type/factory |
| Claude `Agent` / `Task` | 只有 Astravia `spawn_agent` schema | 上游工具调用名与参数不匹配 | 兼容 facade |
| Agent Teams | 未支持 | `cdt` 核心不可运行 | 新建一等运行时 |
| Claude command hooks | 通用执行器可复用 | 两份 Hook 配置可作为首批目标 | 新 Claude profile |
| `${CLAUDE_PLUGIN_ROOT}` | 未作为 Claude 变量解析 | 所有 Hook 命令找不到脚本 | importer 注入并跨平台展开 |
| Bash + `jq` Hook | Windows runner 是 `cmd.exe` | `.sh` 不能运行 | 托管 POSIX 或明确平台限制 |
| Claude marketplace | 未支持 | 不能直接添加 `cc-skills` marketplace | 新 marketplace importer |
| Astravia plugin zip | 已支持，但清单语义不同 | 不能把 Claude plugin.json 当 Astravia 清单 | 必须隔离解析 |
| MCP | Astravia 插件 MCP 已支持 | 本快照无 `.mcp.json`，CDT 文档却声明存在 | 预留并诊断缺失 |
| Hook 可观测性 | 已有 run summary/info | 可复用 | 增加来源与权限展示 |

## 3. 插件清单存在硬冲突

Claude 与 Astravia 都有名为 `plugin.json` 的文件，但不是同一协议：

| 项目 | Claude Code | Astravia |
| --- | --- | --- |
| 路径 | `.claude-plugin/plugin.json`，可选 | zip 根 `plugin.json`，必需 |
| 最小字段 | manifest 存在时只要求 `name` | `id/name/version/pluginApiVersion/runtime/entry` 等 |
| 无 manifest | 自动发现默认组件目录 | 不可安装为插件 |
| `commands` | Markdown workflow 文件/目录 | 可执行二进制 allowlist |
| `skills` | Claude component path | `agent.skillPaths` |
| `agents` | custom subagent 定义 | 当前无等价 manifest 字段 |
| `hooks` | Claude lifecycle handlers | 当前无 Astravia 原生插件清单字段 |
| runtime/entry | 不需要前端运行时 | 当前 Astravia 插件必须提供 |

因此不能做“字段改名后写一个 Astravia plugin.json”的浅转换。尤其不能把 Claude `commands` 写进 Astravia `commands`，否则会把 Markdown 路径误当成可执行文件授权。

推荐 importer 先生成中立的 resource graph；Astravia 安装元数据与 Claude 原始 manifest 并存，分别保留原始哈希和来源。

## 4. Skill 语义差距

### 4.1 调用名和命名空间

Claude plugin skill 有插件命名空间，并提供 `/name` 风格入口；Astravia 当前以全局 Skill name 去重，先加载者胜，并显式使用 `/skill:name`。

如果直接加载 10 个插件：

- 同名 Skill 只能留下第一份；
- 用户照上游文档输入 `/council`、`/pm:next` 不会进入 Astravia Skill expansion；
- plugin 内的 `Skill(...)` 引用无法稳定解析到同插件资源。

兼容层需要内部 canonical id，例如 `claude:<marketplace>:<plugin>:<skill>`，同时维护用户入口 alias。只有在 alias 无冲突时才暴露短名；冲突时必须要求 scoped name。

### 4.2 参数

Astravia `invoke_skill({ name, args })` 会在 Skill 正文后附加 `User arguments`，但不会替换正文中的 `$ARGUMENTS`。Claude legacy commands 和 Skill 明确依赖占位符替换。

需要在读取原始正文后、注入模型前执行一次确定性 substitution：

1. 替换 `$ARGUMENTS`；
2. 支持 Claude 已定义的按位置参数（若目标 profile 声明）；
3. 若正文没有占位符，按 Claude 规则追加 arguments；
4. 不对替换结果再次扫描，避免注入产生二次模板执行。

### 4.3 权限与 fork

`allowed-tools` 在 Claude 中是 Skill 活跃期的预授权，不是工具 allowlist；Astravia 当前完全忽略。`context: fork` 和 `agent` 决定 Skill 在隔离 agent 中执行，也不是普通描述字段。

这三者必须进入结构化 Skill runtime，不能只留在注入文本中。

## 5. Custom agent 差距

Astravia 现有 registry 是正确落点，但需补字段与资源加载：

| Claude agent 字段 | Astravia 当前承载 | 缺口 |
| --- | --- | --- |
| `name` / `description` | registry id/description | 支持 plugin scoped id |
| Markdown body | `systemPromptAddon` | 可映射 |
| `tools` | `createBuiltinTools` | 需要 Claude → Astravia 工具解析和 MCP 精确选择 |
| `disallowedTools` | prefix deny | 需要精确 tool policy，不只 prefix |
| `model` | child 继承 parent model | 需要 type/调用级 model resolver |
| `maxTurns` | 无 | 需要 child turn budget |
| `skills` | 无预加载字段 | 需要按 scoped id 注入 Skill 正文 |
| `memory` | 无 | 需要定义是否支持、路径和读写权限 |
| `background` | Astravia spawn 默认后台 | 需保留显式策略 |
| `isolation: worktree` | 无 | 后续能力；本基线不是核心依赖 |
| `permissionMode` | child 继承 session config | 需要宿主权限收窄规则 |

此外，Claude `Agent`/旧 `Task` tool schema 与 Astravia `spawn_agent` 不同。兼容 facade 应在 adapter 层归一参数，实际执行仍调用统一 coordinator，不复制第二套 child runtime。

## 6. Agent Teams 不能由 subagent 替代

Astravia 当前 child：

- 由 root 创建；
- 结果和通知返回 root；
- root 可以给 child 发消息；
- child 没有 subagent control tools，不能发现或联系 sibling；
- 没有共享 task dependency graph。

Agent Teams 则要求 lead、teammate、共享 task list、owner/dependency 自动解锁、peer mailbox 和 idle lifecycle。把 `TeamCreate` 映射成多次 `spawn_agent` 会丢失 CDT 的 wave gate 和 handoff 不变量。

最低可接受实现是复用 child session factory，但新增 team coordinator、共享 task store、mailbox 和 teammate 工具面；不是写几个 alias。

## 7. Hook 差距

### 7.1 不能复用 Codex wire profile

现有 Codex profile 固定到 `codex-hooks/fca51f6`，已经把输入、输出、matcher、exit code 和聚合行为封装在独立目录。这正说明 Claude 应新增自己的版本化 profile。

可以复用：

- `HookDispatcher`
- `NodeHookCommandExecutor` 或其接口
- `ConfiguredHookHandler` 的一部分字段
- runtime 的 adapter 聚合与 Stop 安全阀

不能复用为同一实现：

- Claude 配置 schema；
- Claude tool 名和 matcher；
- Claude 当前事件集合；
- handler type 和 async/HTTP/MCP/prompt/agent 语义；
- 每个事件的 JSON output；
- exit code 2 对不同事件的效果。

### 7.2 官方当前面大于 Astravia 事件联合

Claude 官方当前文档列出约 30 个事件，包括 `Setup`、`UserPromptExpansion`、`PostToolUseFailure`、`PostToolBatch`、`PermissionDenied`、`TaskCreated`、`TaskCompleted`、`TeammateIdle`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate/Remove`、`SessionEnd`、MCP elicitation 等。

`cc-skills@2.6.2` 实际只使用 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`Stop`。首版应以精确子集交付，但 profile schema 和 diagnostic 必须明确报告 unsupported event，不能静默忽略。

### 7.3 脚本环境

本快照的 Hook 使用 `${CLAUDE_PLUGIN_ROOT}` 和 `.sh`。当前 Astravia：

- `HookConfigSource.env` 可以注入变量；
- Unix shell 可展开 `${CLAUDE_PLUGIN_ROOT}`；
- Windows executor 使用 `cmd.exe /C`，不会按 Bash 语法展开，也不能直接运行 Bash 脚本；
- 托管运行时当前只保证 Node/Python，不保证 Bash、`jq`、coreutils。

若目标是上游文件零改动，Windows 必须增加受控 POSIX runtime。若不增加，就必须在安装时标记这些插件为 platform-incompatible，而不是运行到一半失败。

## 8. `cc-skills` 插件可用性判断

| 插件 | 直接加载 Skill | 补 Skill adapter 后 | 补 custom agent 后 | 补 Agent Teams 后 |
| --- | --- | --- | --- | --- |
| `temporal` / `doppler` / `oasis-dev` | 主体可用 | 完整度高 | 不变 | 不变 |
| `pm` | 部分 | 主体可用 | 不变 | 不变 |
| `plugin-dev` | validation Skill 可用 | commands 可用，但产物需 Claude importer | 不变 | 不变 |
| `dlc` | 部分 | 大部分可用 | Task 型检查可原生化 | 不变 |
| `jules-review` | 部分 | 非 fork 路径可用 | 完整度高 | 不变 |
| `council` | 降级 | 外部 CLI 路径可用 | 主要功能可用 | 不变 |
| `ci-review` | 不完整 | 仍不完整 | 主要功能可用 | 不变 |
| `cdt` | 不可用 | 仍不可用 | 仍不可用 | 完整目标 |

## 9. 安全边界

Claude 插件目录可以包含自动执行的 Hook 和任意脚本。导入器必须在首次启用和内容哈希变化时展示：

- 所有 Hook 事件、matcher、handler 类型、命令和 timeout；
- 所需可执行文件；
- custom agent 的工具、模型、写权限、memory/worktree；
- Teams、Cron、通知和 GitHub 写操作；
- MCP/LSP/monitor（未来若存在）。

必须由宿主强制：

- 插件路径不能逃出安装根；
- Hook cwd 被限制到当前项目；
- agent tool policy 不能通过 Bash 绕过；
- 未信任 Hook 不进入 config layers；
- stdout/stderr/output limit/timeout/取消都可观察；
- 插件升级后命令或权限面变化需重新授权。
