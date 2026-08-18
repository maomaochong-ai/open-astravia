# Claude Code 生态适配分析

## 文档状态

- 分析日期：2026-07-17
- 外部仓库：`C:\develop\github\cc-skills`
- 外部基线：`rube-de/cc-skills@f5359d9821055d7d95d1c914c63546e545932965`（2.6.2）
- Vetta 基线：`f8e17931cb0586419929283d7076a434202b37b9`
- 官方规范：分析日期当天的 Claude Code 官方文档
- 范围：分析与目标方案，不表示 Claude Code 插件兼容已经实现

## 结论

`cc-skills` 不是一组可以直接复制到 Vetta 的 `SKILL.md`。它包含：

- 10 个 Claude Code 插件；
- 26 个 Agent Skill；
- 7 个 legacy command；
- 20 个 custom agent；
- 2 份 Hook 配置和 15 个辅助脚本；
- 一个依赖 Claude Code Agent Teams 的完整协作工作流。

Vetta 已经具备三块可复用基础：标准 Agent Skill 发现、可扩展的 root → child 子代理运行时、以及 `@vetta/ecosystem-adapter` 的通用 Hook 调度内核。但当前只能直接承载 skills-only 插件的主体内容，不能无损运行 `council`、`ci-review` 和 `cdt`：

1. Claude 与 Vetta 的插件清单不是同一种格式，`commands` 字段甚至具有不同含义。
2. Vetta 会忽略 `user-invocable`、`context: fork`、`agent`、`allowed-tools` 等 Claude Skill 扩展语义，也不展开 `$ARGUMENTS` 或 Claude 的动态命令上下文语法。
3. Vetta 已有子代理 registry，但默认只有 `explorer`，尚不能从 `agents/*.md` 注册 agent，也不支持 agent 级模型、turn limit、memory、worktree 等配置。
4. Vetta 子代理是 root 协调模型，不等同于 Agent Teams；缺少共享任务图、队友间 mailbox、`TeamCreate` / `TaskCreate` / `Teammate` 等工具。
5. 现有 Hook profile 是版本固定的 Codex 协议，不应被当成 Claude profile。Claude 官方当前 Hook 面也明显大于现有 10 个通用事件。
6. `cc-skills` Hook 脚本依赖 Bash、`jq`、`${CLAUDE_PLUGIN_ROOT}`；Vetta Windows Hook runner 当前使用 `cmd.exe`，不能原样运行。

推荐建设一条独立的 **Claude Code compatibility profile**，而不是把 Claude 插件伪装成 Vetta 原生插件，也不是继续扩大 Codex profile：

- `ecosystem-adapter` 负责 Claude marketplace/plugin/resource 的纯解析、版本化 Hook wire contract 和工具名映射。
- `coding-agent` 负责 Skill 调用语义、custom agent 注册、子会话以及未来的 Agent Teams 运行时。
- `desktop` 负责安装、信任、权限、插件根路径、托管命令环境和 UI 诊断。
- Vetta 原生插件清单继续保持自身语义；Claude `plugin.json` 先解析成中立资源图，再进入宿主，不直接互读字段。

## 交付边界

首要目标是精确兼容本次基线中的 `cc-skills`，不是一次性复制 Claude Code 的所有现行功能。

| 范围 | 本次方案中的定位 |
| --- | --- |
| Skills、legacy commands、agents、command hooks、scripts | 必须适配 |
| Agent Teams | `cdt` 完整可用的必需能力，单独里程碑 |
| Claude 插件 MCP | 架构预留；本基线没有 `.mcp.json` |
| HTTP / MCP tool / prompt / agent Hook handler | 官方兼容扩展；不是 `cc-skills` 首版前置 |
| LSP、monitors、themes、output styles、channels | 不在 `cc-skills` 精确适配范围 |

## 文档索引

1. [上游组成与运行依赖](./01-cc-skills-inventory.md)
2. [Vetta 能力与兼容差距](./02-compatibility-matrix.md)
3. [目标架构与协议映射](./03-target-architecture.md)
4. [实施路线与验收标准](./04-roadmap-and-acceptance.md)
5. [Hook 首期兼容分析](./05-hook-compatibility.md)
6. [实施结果与验收](./result/00-summary.md)（含验证报告、支持矩阵、复验步骤）

## 核心决策

1. **版本固定**：Claude Hook profile 必须绑定经过契约测试的 Claude Code 版本，不使用无含义的 `latest`。
2. **清单隔离**：Claude `.claude-plugin/plugin.json` 与 Vetta 根 `plugin.json` 分别解析，禁止按同名字段直接转换。
3. **资源优先**：允许无 UI、无 Module Federation 入口的 resource-only compatibility bundle，避免给每个 Claude 插件制造空壳前端。
4. **Agent 原生化**：把 `agents/*.md` 编译为 Vetta `SubagentTypeDefinition`，不靠提示词模拟 agent。
5. **Teams 不降格**：Agent Teams 不能映射成普通并行 subagent；`cdt` 在 Teams 可用前应明确显示不兼容，而不是宣称完整运行。
6. **Hook 独立 profile**：复用通用 dispatcher/executor，但 Claude 输入、输出、matcher、事件和 handler schema 独立实现。
7. **宿主强制权限**：Agent 工具白名单、只读约束、Hook 信任和命令路径必须由宿主执行，不能只依靠上游 prompt。
8. **无业务硬编码**：Vetta 核心不出现 `council`、`cdt`、`pm` 等插件专用分支；兼容问题通过通用资源和协议层解决。

## 主要依据

本地实现依据：

- [`ecosystem-adapter` README](../../../packages/ecosystem-adapter/README.md)
- [通用 Hook runtime](../../../packages/ecosystem-adapter/src/hooks/runtime.ts)
- [Codex Hook adapter](../../../packages/ecosystem-adapter/src/codex/hooks/adapter.ts)
- [Skill loader](../../../packages/coding-agent/src/core/skills.ts)
- [Skill command expansion](../../../packages/coding-agent/src/core/session/skill-expansion.ts)
- [子代理类型与 factory](../../../packages/coding-agent/src/core/subagents/types.ts)
- [默认子代理 registry](../../../packages/coding-agent/src/core/subagents/index.ts)
- [Vetta 插件清单](../../plugin/manifest.md)

官方规范依据：

- [Claude Code Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code Skills](https://code.claude.com/docs/en/slash-commands)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
