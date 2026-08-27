# 浏览器操作（Browser Use）

Browser Use 是 Desktop 宿主浏览器能力的官方产品适配插件。它为 Agent 注册一个低上下文的 Skill 和一个结构化 `browser_operate` 工具，并提供运行时安装与状态面板。

架构决策见 [ADR-0088](../../../../docs/adr/0088-browser-automation-as-a-foundation-capability.md)。旧的 Skill + CLI shim 设计见 ADR-0079，仅作为迁移背景。

## 边界

```text
Agent -> browser_operate -> ctx.browser -> Plugin Capability Adapter
      -> cap.foundation.vetta.browser.* -> Desktop BrowserAutomationService
      -> BrowserEngine adapter -> agent-browser
```

- 插件不执行 `npm` 或 `agent-browser` 命令，不持有 profile 物理路径。
- 宿主拥有运行时、进程、session、profile、策略、取消和结构化日志。
- 公共工具只提供导航、快照、文本读取和类型化动作，不提供 eval、文件上传、下载、Cookie 或 token 导出。
- QuickJS 不在支持范围内。

## 多账号

`browser_operate` 的 `profileId` 是稳定的账号隔离键。媒体账号管理插件或 Agent 应为每个账号选择不同 ID，例如 `youtube-brand-a`、`youtube-brand-b`。托管模式为每个 ID 使用独立的持久 profile；复用 ID 会复用登录态，关闭 session 不会删除登录态。

不要把邮箱、密码、Cookie、token 等敏感内容写进 `profileId`。

## 域名范围

`plugin.json#browser.allowedHosts` 是插件可请求的最大授权。Browser Use 作为官方通用浏览器插件声明 `*`，用户设置中的 `allowedDomains` 会在创建 session 时收窄该范围；第三方插件不能通过 session 参数扩大 manifest 授权。

当前引擎会在显式导航前拒绝越界 URL，并在不透明动作完成后复核实际 URL，发现越界会关闭 session。该边界限制顶层导航，不等价于页面子资源的网络防火墙。

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
