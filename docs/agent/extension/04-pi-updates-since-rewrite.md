# Pi 在重写基线后的关键更新

本文件从近似历史基线 `v0.14.2` 到 current `0.84.1` 汇总与扩展性直接相关的变化。版本号用于定位上游演进，不表示 Vetta 必须按相同顺序实现。

## 时间线

| Pi 版本 | 关键变化 | 对 Vetta 的意义 |
| --- | --- | --- |
| `0.16` | JSON/RPC 重新设计 | 可复核 Vetta RPC 的关联、事件和错误合同 |
| `0.26` | SDK | Pi 开始把终端 harness 变成可嵌入会话；Vetta 已走得更远 |
| `0.35` | hooks/custom tools 统一到 ExtensionAPI | 形成 Pi 单一扩展作者模型 |
| `0.38` | async factories、custom editor/UI、runtime split | 扩展初始化与 TUI 注入显著增强 |
| `0.47` | input interception | Extension 可改变用户输入流 |
| `0.50` | Pi Packages | 把 Extension、Skill、Prompt、Theme 变成可分发组合 |
| `0.60` | 显式 package update | 安装与更新语义开始分离 |
| `0.62` | 统一 `sourceInfo` | 资源/工具/命令可追溯到包与路径 |
| `0.65` | `AgentSessionRuntime` | 重建 cwd-bound 服务，会话替换边界更清楚 |
| `0.69` | stale session protection、`withSession()`、TypeBox 1 | 解决旧 context 在 replacement 后误操作新会话的问题 |
| `0.70` | lifecycle invalidation/teardown 修复 | reload、事件订阅和清理更可靠 |
| `0.78` | 私有临时 Extension、安全 git path | 强化 package/Extension 文件系统边界 |
| `0.79` | project trust | 项目本地配置/包/Extension 加载前获得批准 |
| `0.80.4` | project-local config、`agent_settled`、Provider headers、inline Extension、entry renderer | 生命周期、Provider 和嵌入式扩展增强 |
| `0.80.7–0.80.9` | cache-friendly dynamic tools、live model catalogs、deferred tool loading | 运行时热变更和大工具目录更成熟 |
| `0.81` | full native Provider extensions | Extension 能提供完整 Provider，而不只是静态模型配置 |
| `0.82` | constrained tool sampling | 工具参数生成可以被约束/定制 |
| `0.83` | scoped models、pending stop reason | 模型选择与停止状态更可组合 |
| `0.84` | remote CBOR protocol/client/server、Markdown transformer、typed telemetry、Extension cleanup、delta-only JSON/RPC | 协议、可观测与输出复杂度均有升级 |
| `0.84.1` | blocked tool call 可返回 `terminate` | 工具策略可显式终止本轮 |

## 最值得采纳的已发布变化

### 1. Extension lifecycle generation

Pi 把“Extension 被 reload”当成代际切换：旧 runtime/context 变为 inactive，继续调用会明确报 stale；event bus subscription 由 runtime 跟踪并在 teardown 取消。会话 new/switch/fork/import 时，通过 fresh callback 获取新 context，而不是让旧闭包隐式指向新 session。

这是正确性问题，不是 API 装饰。Vetta 的 Coding Extension 应优先补齐同等语义，并直接复用底层 versioned registry 思路。

### 2. Project trust

Pi 在读取项目本地 settings、packages、extensions 等可影响代码执行的输入前做 trust 决策，并为非交互模式提供显式行为。它只解决“是否允许该项目参与配置/加载”，不解决获批代码的隔离。

Vetta 同时有 CLI、Desktop、SDK、IM，不能照搬一个终端 prompt。应定义宿主无关 `ProjectTrustDecisionPort`，再由 Desktop UI、CLI flags 和非交互 policy 适配。

### 3. 动态工具与 Provider

Pi current 明确支持 runtime tool refresh、Provider register/unregister、live model catalog 和完整 native Provider。Vetta 底层 Runtime 已有接近或更强的动态目录，但 Coding Extension 的外部 API 未完整映射。优先统一“何时可见、in-flight 如何处理、同名替换如何处理、卸载后旧调用如何失败”四个语义。

### 4. 结构化来源

Pi 将来源附着在对象上，使工具列表、命令列表、RPC、错误和包管理界面都能回答“这是谁贡献的”。Vetta 现有 `extensionPath`、package source map 和 plugin identity 可以汇入统一结构，例如：

```ts
interface ContributionSourceInfo {
  kind: "builtin" | "extension" | "plugin" | "package" | "mcp" | "skill" | "hook";
  id: string;
  displayName?: string;
  path?: string;
  packageSpec?: string;
  revision?: string;
  trust?: "builtin" | "global" | "project-approved";
}
```

这只是方向示例；正式合同需同时覆盖隐私、跨平台路径和 RPC 序列化。

### 5. Package manager hardening

值得吸收的不是“Pi Package”品牌，而是 install-and-persist 事务、configured package 列表、pinned/reconcile 规则、失败回滚、私有临时目录、安全 git path、自定义 npm command 和项目/全局配置增量。Vetta 应保留 Bun/现有目录语义，不照搬上游命令实现。

### 6. Provider interception 与 typed telemetry

请求前、headers 前和响应后 hook 便于代理、企业认证、缓存与观测；typed telemetry 让不同 exporter 共享稳定 schema。两者都可能暴露 prompt、response、token 或认证信息，Vetta 必须把授权、redaction、采样和错误隔离作为合同的一部分。

### 7. Delta-only streaming

Pi `0.84` 的 JSON/RPC `message_update` 只发送 delta，不再重复累计 partial，避免长输出产生二次方级传输和拼接开销。Vetta 当前 RPC 仍转发 `assistantMessageEvent`；应先确认其具体 payload 是否累计，再决定增加协议版本还是在兼容字段旁新增 delta。

## 实验能力：可以研究，但不能按已交付评审

### Remote protocol/client/server

Pi 新增 strict versioned framed CBOR 协议、transport-neutral client、lease/ownership、authoritative snapshot 和 server listener 边界。设计适合远程、多客户端和断线重连，但上游仍标记 experimental，未知字段策略和版本兼容也可能继续变化。

Vetta 可以复用设计原则，不应直接替换已有 JSON RPC 或把 experimental package 作为生产依赖。

### AgentHarness v2

AgentHarness v2 的目标包括：

- durable runs/responses 和 append-only tree；
- named parallel lanes、lane records 与 global facts；
- crash recovery、single writer；
- 注入式 effect boundary 与 manual deterministic drive；
- events 只观察、hooks 才能改变行为；
- 原子 snapshot 与无缝 live events；
- storage backends 和 typed telemetry。

这些方向对 Vetta 的 long-running agent、subagent 和可复现测试很有价值。但当前 scaffold 的主要 run/drive 操作仍未实现，设计文档还有多组未完成 work package，生产 `coding-agent` 也未迁移到它。建议设置跟踪门槛：等上游完成核心 harness、recovery、observer/storage 合同并实际接入 production 后，再做第二轮差分评审。

## 不应采纳的部分

- 不把 Pi 集中的 `coding-agent/src/core` 搬回 Vetta。
- 不在 Vetta 稳定 SDK 中暴露具体 Manager/Registry 作为默认扩展面。
- 不把 TUI concrete types 放入宿主无关 Runtime 根合同。
- 不复制“获批 Extension 即拥有整个用户进程权限”的安全模型。
- 不直接依赖 Pi experimental protocol 或未完成 AgentHarness scaffold。
- 不新增与现有 Runtime 并行的第二套 tool/session execution path。

