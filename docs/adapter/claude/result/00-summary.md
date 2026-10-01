# Claude Code Hook 适配成果摘要

- 日期：2026-07-18
- Profile：`claude-code-hooks/2.1.211`
- 范围：Astravia 宿主已支持的 Hook 事件子集 + 同步 `command` handler
- 非目标：Agent Teams、custom agent 全量、http/prompt/agent handler、完整 marketplace 安装器

## 结论

**Astravia 已支持的 Claude Hook 首期协议适配完成，并通过单元测试与 Desktop 真机会话验收。**

| 验收项 | 结果 |
| --- | --- |
| 独立 Claude profile（不污染 Codex） | 通过 |
| 配置源隔离：`.codex/hooks.json` vs `.claude/settings*.json` / 插件 `hooks/hooks.json` | 通过 |
| SessionStart plain stdout → additional context | 通过（unit + desktop） |
| UserPromptSubmit `decision:block` | 通过（unit + desktop `/cdt`） |
| PreToolUse `permissionDecision:deny` + matcher | 通过（unit + desktop Write） |
| Stop `decision:block` + `stop_hook_active` 重入 | 通过（unit） |
| 原样加载 `cc-skills` council/cdt `hooks/hooks.json`（占位符展开） | 通过（load 级） |
| 原样执行 council/cdt `.sh`（Windows 无 Git Bash） | **未通过运行**，已明确诊断策略 |
| Agent Teams / TeamCreate 等工具 | **不在本轮**；cdt PreToolUse matcher 可加载但宿主无对应工具 |

## 实现落点

```text
packages/ecosystem-adapter/src/claude-code/hooks/
  adapter.ts
  config.ts / config-schema.ts
  command-executor.ts
  event-semantics.ts
  input-codec.ts
  matcher.ts
  output-parser.ts / output-schemas.ts
  placeholders.ts
  profile.ts
  tool-mapper.ts
  index.ts
```

默认随 `createEcosystemHookRuntime()` 注册，coding-agent / desktop 无需新增 `xxHooks` 字段。

## 配置入口

| 来源 | 路径 / 条件 |
| --- | --- |
| 官方用户/项目 | `~/.claude/settings.json`、`<cwd>/.claude/settings.json`、`settings.local.json`（`"hooks"` 字段） |
| 插件 | 显式 `HookConfigSource`：`path=.../hooks/hooks.json` + `CLAUDE_PLUGIN_ROOT` 或 `profileId=claude-code-hooks/*` |
| Codex | 官方 `.codex/hooks.json`；`profileId` / 路径过滤器隔离，不会吃 Claude settings |
| 已移除 | Astravia `agentDir` / `.astravia` 下的 `claude-hooks.json` / `hooks.json` |

## 相关文档

1. [验证报告](./01-verification-report.md)
2. [支持矩阵与缺口](./02-supported-matrix-and-gaps.md)
3. [如何本地复验](./03-how-to-reverify.md)
4. [应用内可见会话复测](./04-ui-visible-retest.md)（cwd=已登记项目 `astravia-mono`，侧栏可见）
5. Fixture：[`../fixtures/hook-smoke`](../fixtures/hook-smoke)
