# 平台 Runtime 拥有环境实现

## 背景

`runtime-storage`、`runtime-tools`、`runtime-mcp` 和 `runtime-core` 此前同时包含公开合同与 Node 环境实现。Desktop 的 Runtime 组合、进程生命周期、会话目录策略和历史导入又位于 `desktop` 内部。这样的依赖图无法证明 Agent Kernel 可在其他平台运行，也使平台行为只能通过具体应用源码复用。

## 决策

Runtime 分为协议/Kernel 与平台 Runtime 两类：

- `runtime-core` 拥有平台无关的 Session、Turn、Queue、Snapshot、Recovery 和 Port 编排。
- `runtime-storage`、`runtime-tools`、`runtime-mcp` 拥有各自的合同、Schema、错误模型、纯状态转换和一致性测试，不拥有环境 I/O。
- `runtime-node` 实现多个 Node Host 可共享的文件系统、进程、锁、本地持久化与工具适配器。
- `runtime-desktop` 拥有 Desktop 进程生命周期、平台组合、会话目录策略和 Electron/Desktop 专属适配。
- 后续平台使用独立 Runtime 包实现同一协议；当前不实现 `runtime-web`。

协议包可以包含执行协议不变量所需的纯函数和状态机，但不得直接访问文件系统、进程、数据库、凭证、Electron 或宿主全局状态。具体实现需要多个平台共享时，应提升到明确的平台基础包，而不是放回协议包。

当前生产依赖方向为：

```text
desktop -> runtime-desktop -> coding-agent
             |                 |-> runtime-node
             |                 `-> runtime-core + runtime protocols
             `-------------------> runtime-node

runtime-node -> runtime-core + runtime protocols
runtime-core -> agent/ai protocols
```

这里的可移植闭包是 `runtime-core`、`runtime-storage`、`runtime-tools`、`runtime-mcp` 及其下层 Agent/AI 协议，而不是当前整个 `coding-agent` 包。`coding-agent` 是现有 Node 产品组合，会选择 `runtime-node` 的默认实现；未来非 Node Host 应复用协议与 Kernel，并提供自己的平台实现和产品组合入口，而不是加载 `runtime-node`。

平台 Runtime 不得反向依赖具体应用。应用配置、Logger、交互 Broker 和 Plugin 集成通过窄 Port 或显式组合参数注入。`runtime-desktop` 可以组合 `coding-agent` 和 `runtime-node`，但不得把 Electron 或 Desktop App 类型泄漏回可移植闭包。

## 迁移策略

迁移按行为保持阶段进行：

1. 建立 `runtime-desktop`，迁入现有 Desktop Runtime 的生命周期和无应用反向依赖的组合职责。
2. 将 Storage、Tool、MCP 合同迁回各自协议包并反转依赖。
3. 将共享 Node 实现迁入 `runtime-node`，将 Desktop 专属实现迁入 `runtime-desktop`，同时用协议合同测试验证。
4. 清除 `runtime-core` 的 Node I/O，并增加可移植性编译和依赖门禁。

迁移期间不得引入第二套 Agent 执行路径；CLI、Desktop、SDK、RPC 和 IM 继续使用同一生产 Kernel。

## 后果

- Desktop App 只负责应用生命周期、UI 和应用服务注入，不再拥有 Agent Runtime 实现。
- 协议包成为平台实现的稳定依赖方向和合同测试所有者。
- 新平台可以实现 Storage、Tool、MCP 和 Host Port，而无需复制 Agent Loop 与 Turn Kernel。
- 当前 `coding-agent` 仍是 Node 产品组合；把完整产品组合移植到 Web 需要另行拆分或新增非 Node Composition Root，不在本次迁移范围内。
- 平台包数量增加，但环境依赖、资源所有权和可测试边界变得明确。
