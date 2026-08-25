# Runtime Core 多主 Agent Definition Registry

## 状态

Accepted

## 背景

ADR-0077 已明确 `runtime-core` 拥有产品无关的 Session、Turn 和资源所有权，Coding Agent 只拥有产品定义；
ADR-0069 建立了 Turn-bound generation，但把产品 revision capture 暂时留在 Coding Agent。当前 Runtime
仍只有单 Session 的能力组合，没有多个平级主 Agent 的动态定义、来源同步、revision 或 lease 合同。宿主若各自
维护配置 Map，会让文件配置、代码配置、Plugin 和远端控制面形成不同发布路径，并重复实现失败保持和资源回收。

同时，产品 `Profile` 只是 Prompt 预设。把它作为 Kernel 或 Agent Registry 的基础概念会让 Runtime 依赖
Coding 产品语义，阻碍不同 Agent 自定义 Tool、MCP、Prompt、模型与扩展。

## 决策

不新增 workspace 包，在 `@vetta/runtime-core/agents` 建立产品无关的多主 Agent 控制面：

- `RuntimeAgentDefinition` 是可执行 Agent 的工厂合同；它按 Instance 创建独立的能力定义、模型绑定、
  Session Extension 和资源释放边界。简单 Agent 可直接返回静态组合，Coding Agent 可执行复杂的实例装配。
- `RuntimeAgentRegistry` 按 `agentId` 管理多个平级 Definition。每次成功发布产生不可变
  `RuntimeAgentRevision`；获取方持有幂等 `RuntimeAgentRevisionLease`。
- 普通替换、retire 和 remove 立即阻止旧 revision 的新租约，但不改变已有 lease。旧 revision 在最后一个
  lease 释放后才 dispose；物理资源故障仍按原错误传播。
- `RuntimeAgentDefinitionSource` 只提供已经解析的完整 Source Snapshot。Runtime Core 不读取文件、动态加载
  模块、访问数据库或网络。文件、代码、Plugin 和远端配置都由宿主适配为同一 Source Port。
- Source 全量刷新先完成结构校验和来源冲突检查，再原子替换该 Source 的完整 Agent 集；任一候选失败零发布，
  保留 last-known-good。快速连续刷新按 newest-wins 收敛。
- 一个 `agentId` 同时只允许一个 Source 拥有。跨 Source 覆盖必须由上层显式合并，不在基座内引入隐藏优先级。
- `Profile`、Mode、Persona 和 MCP 协议字段不进入 Registry。上层在 Definition 工厂内把它们解析为普通
  Instruction、Feature、Tool、Provider 和 Extension。

Agent revision 默认只影响之后创建的 Instance。已有 Instance 是否从下一 Turn rollout 到新 revision，由独立、
显式的 Instance 策略决定；当前 Turn 始终继续使用已经取得的 Runtime Snapshot lease。安全撤权仍使用独立的
hard-revocation 合同，不复用普通 revision retirement。

本决策将 ADR-0069 中“Coding Agent 拥有产品 revision capture”的阶段性归属收敛为：Runtime Core 拥有通用
Agent Definition revision 与租约，Coding Agent 只拥有其 Definition 内容及产品内状态 revision。

## 备选方案

### 继续由每个宿主维护 Agent Map

否决。来源冲突、失败保持、动态删除、lease 和关闭语义会在 Desktop、CLI、服务端和 SDK 中重复实现。

### 把 Agent Registry 合并进 RuntimeCapabilityComposition

否决。前者是进程级 Agent Definition 控制面，后者是单 Session 的 Runtime Snapshot generation；合并会混淆
生命周期并使 Kernel 认识上层实例策略。

### 把 Profile 作为 Definition 的必填字段

否决。Profile 是具体产品的 Prompt 预设，不能向下传递。Runtime 只消费上层已经解析出的通用能力。

### 普通更新立即使旧 Agent 失效

否决。已经运行的 Instance 和 Turn 会出现 schema、handler、Prompt 与模型跨代漂移。安全收紧必须走显式撤权。

## 后果

- Runtime 可以承载多个完全不同、可动态发布的主 Agent，而不绑定 Coding 场景。
- 配置文件与代码配置共享同一发布和校验路径；具体解析、安全校验和 I/O 仍由宿主负责。
- 更新期间可能短暂并存多个 Agent revision，需要后续 Observation Port 记录 revision、lease age、retirement 和
  dispose failure，但不得记录 Prompt 正文、Tool 参数、凭证或用户内容。
- Coding Agent 已通过 execution-compatible `RuntimeAgentDefinition` 接入生产 Composition；默认可自建 Host，Desktop
  使用应用级共享 Host。复杂 Session 装配仍保留在产品包，能力只由 `RuntimeAgentSession` 编译一次。
