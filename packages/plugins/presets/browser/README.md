# 浏览器操作（Browser Use）

Browser Use 为 Agent 提供低上下文的 `agent-browser` CLI Skill，并提供运行时安装与状态面板。插件代码仍可通过 Desktop 的 `ctx.browser` API 使用宿主浏览器能力；Agent CLI 与 Plugin API 不共享活跃 session。

Plugin API 的宿主能力决策见 [ADR-0088](../../../../docs/adr/0088-browser-automation-as-a-foundation-capability.md)，Agent 独立 CLI 决策见 [ADR-0090](../../../../docs/adr/0090-agent-browser-cli-uses-agent-owned-sessions.md)。

## 边界

```text
Agent -> shell -> agent-browser CLI -> agent-browser daemon / Chrome

Plugin -> ctx.browser -> Plugin Capability Adapter
       -> cap.foundation.vetta.browser.* -> Desktop BrowserAutomationService
       -> BrowserEngine adapter -> agent-browser
```

- Desktop 通过托管 npm 前缀锁定 `agent-browser` 版本，Agent shell 直接使用该 CLI。Skill 会先检查版本与浏览器健康状态；缺失时在确认 Vetta 私有 npm prefix 后自动安装，插件面板保留为人工安装与诊断兜底。
- 每个 Coding Agent Session 获得唯一的 `VETTA_AGENT_SESSION_ID`；Skill 要求所有浏览器与页面状态操作用它作为 upstream `--session`，安装、诊断和内置手册读取不绑定 session。
- Agent CLI 的 daemon、页面状态和 profile 不属于 `BrowserAutomationService`，也不与 `ctx.browser` API 共享。
- `ctx.browser` 公共 API、namespace 隔离和宿主生命周期保持不变。

## 多账号

同一 Agent 任务内的连续 CLI 命令复用它自己的 session。需要同时操作多个媒体账号时，在 `VETTA_AGENT_SESSION_ID` 后追加稳定账号键，并为每个账号使用不同的 `--restore` 键，例如 `youtube-brand-a`、`youtube-brand-b`。关闭活跃 session 不会删除 `--restore` 保存的状态。

不要把邮箱、密码、Cookie、token 等敏感内容写进 `profileId`。

Agent CLI 使用 upstream 的完整命令面和配置；Browser Plugin 不再用设置页代理 CLI 参数。需要限制输出、窗口模式或域名时，由 Skill/Agent 使用 upstream 的 `--max-output`、`--headed`、`--allowed-domains` 等参数。Plugin API 的授权和域名范围仍由原 Capability 合同负责。

## 登录态迁移

首次创建 `default` profile 时，宿主会把旧版 Browser 插件的 profile 复制到新的宿主管理目录。目标已存在时绝不覆盖；迁移日志只包含脱敏 profile 标识，不包含路径、Cookie 或页面数据。

## 开发验证

```bash
cd packages/plugins/presets/browser
bun run test
bun run check
bun run build
```

单元测试使用 fake `ctx.browser`，不启动真实浏览器、不读取用户 profile。
