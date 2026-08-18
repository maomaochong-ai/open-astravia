# Team: Runtime

> 本包属于 **Runtime Team**，是 Node.js 平台共享实现层。

## 职责范围

- 实现 `runtime-storage`、`runtime-tools`、`runtime-mcp` 等协议包定义的 Node.js 适配器。
- 拥有文件系统、进程、子进程和 Node 网络资源的生命周期与错误映射。
- 不拥有 Desktop 应用配置、Electron IPC、UI 或产品策略。

## 依赖边界

- 可以依赖协议包与 `runtime-core`，不得依赖 `desktop`、`cli-host`、`admin`、`site` 或 `runtime-desktop`。
- 公共入口必须是实际实现所有者，不得只做应用源码的转发层。
- Node 实现必须由对应协议的合同测试覆盖。
