# Team: Desktop Runtime

> 本包是 Desktop 平台宿主层，不属于宿主无关的 `runtime-*` 协议包。

## 职责

- 拥有 Desktop Agent Runtime 的进程生命周期、平台组合、会话目录策略和宿主适配。
- 可以依赖 `@vetta/coding-agent` 的明确公开子入口以及 Runtime 协议包。
- 不得依赖 `@vetta/desktop` 或深度导入任何应用包；应用服务必须通过窄 Port 注入。
- 不拥有 Agent Loop、Turn Kernel、Coding Agent 产品策略或通用协议。
- 环境相关实现应按 storage、tools、mcp、model、interaction 等职责组织，禁止形成万能平台服务对象。

## 测试

- 生命周期与资源所有权覆盖创建、重复访问、启动失败、正常释放、重复释放和释放失败。
- Desktop 平台实现必须运行对应协议包提供的合同测试。
- 影响真实 Session 行为时还要运行 `desktop` 的 Runtime Host 功能测试。
