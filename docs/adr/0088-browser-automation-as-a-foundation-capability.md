---
status: accepted
---

# 浏览器自动化由宿主 Foundation Capability 拥有

## 背景

ADR-0079 为首个 Browser 系统插件选择了 Skill + CLI shim：插件自己安装和调用 `agent-browser`，shim 持有动态策略，daemon 配置提供纵深防御。该方案解决了单一内置插件的上下文成本与交付问题，但它不是通用扩展边界：其他插件只能重复命令编排或依赖 Browser 插件；策略依赖模型走 shim；profile 只有一个固定目录；session 由 workspace 哈希推导；直接调用 PATH 中二进制可以绕过策略。

产品需要让多个独立插件在明确授权后复用登录态浏览器，例如媒体账号管理、后台运营和网页工作流。浏览器进程、登录态、策略、生命周期与审计是宿主资源，不应由任一可卸载插件拥有。

## 决策

1. Desktop 宿主提供 `cap.foundation.vetta.browser.*`。Capability SDK 定义结构化会话、导航、快照、读取、截图、动作与运行时合同；具体引擎通过宿主内部 `BrowserEngine` 端口适配，首个实现继续使用锁定版本的 `agent-browser`。
2. Plugin SDK 提供 `ctx.browser` facade。插件不能传 namespace、物理 profile 路径或任意引擎 argv。插件身份由 Capability Adapter 注入，会话/profile 在宿主 registry 中按 namespace 隔离。
3. 权限拆分为 read、interact、persistent profile、attach 与 runtime manage。请求浏览器权限的 manifest 必须声明 `browser.allowedHosts`；session 只能请求该授权的子集。宿主在显式导航前执行策略，并在目标不透明的动作完成后复核实际 URL，越界时关闭 session。attach 和 runtime manage 仅 official 插件可用。
4. 快照携带 revision，动作可声明其依据的 revision；宿主拒绝过期引用。公共 v1 不提供 JavaScript eval、任意命令执行、Cookie/token 导出或物理路径访问。
5. Browser 系统插件降为宿主能力的产品适配器：保留设置、安装引导和 Agent Skill/工具体验，但不再拥有跨插件运行时。迁移期间只保留一次性数据兼容，不长期并行维护 shim 与 Capability 两条执行路径。
6. QuickJS 不进入本能力的支持范围。

本决策替代 ADR-0079 中“插件 shim 拥有危险动作门禁”和“workspace 哈希拥有 session”的长期架构结论；ADR-0079 仍作为旧实现的背景与迁移依据。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| Browser 插件提供插件间 RPC | 基础能力依赖可卸载插件；权限、生命周期和版本协商形成第二套框架 |
| 公共 API 暴露 agent-browser argv | 引擎锁定、无法稳定校验、权限只能做粗粒度命令过滤 |
| 每个插件自行集成 Playwright/CDP | 重复下载、profile、策略和进程管理，登录态与审计不可统一 |
| 只提供 MCP 工具 | 适合 Agent，不适合插件 UI/后台任务；工具 schema 不是宿主资源合同 |
| 继续用 Skill + shim 并要求插件复用 | shim 仍可绕过，且调用者必须知道包内路径与 CLI 细节 |

## 后果

- Desktop 新增浏览器运行时与磁盘资源所有权，需要明确关闭、并发、安装失败与迁移测试。
- Capability 的 `AbortSignal` 必须传播到浏览器子进程；取消 Agent 调用时宿主终止对应进程，不能只丢弃返回值。
- Plugin SDK/manifest 增加公共 API 与权限，需维护生产者、消费者和 IPC 合同测试。
- Browser 插件的设置和 Agent 体验可以独立演进，但策略事实源必须迁入宿主。
- 新引擎通过 adapter 接入；如果未来新增远程浏览器，公共合同不因 provider 参数而膨胀。
- 初始版本不支持 eval、下载/上传与 cookie 导出；需要这些能力时必须新增窄合同、权限和审计，而不是开放 raw command。
