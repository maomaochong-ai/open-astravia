# ADR-0063: 先建设 Vetta 原生 Extension Contribution，再映射 Pi 行为子集

## 状态

Accepted

## 背景

Vetta 的 Coding Extension 源自早期 Pi，但当前执行架构已经拆分为 Coding Agent 产品组合、Runtime Tool、Agent Kernel、Model Runtime 和多宿主 Port。Pi current 在 Extension loader、Tool authoring、动态注册、状态事件和 Provider 生命周期上继续演进，也形成了有价值的包生态。

直接把 Pi 包名 alias 到 Vetta API，或在 `pi-compat` 中补一套 Tool 目录、事件和 Provider 生命周期，会造成 native Extension 与 Pi Extension 两套行为。当前 Extension factory 又直接写多个 mutable Map，Provider registration 只有 pending queue，缺少统一 owner 和 reload 回滚。

仓库已由 ADR-0062 接受 `DynamicContributionCatalog<T>`：它提供 generation-safe lease、原子 source replacement、稳定排序快照和在途 dispatch 隔离。新的 Extension 生命周期应复用该能力，而不是建立第二个通用 Catalog。

## 决策

1. 采用 Vetta native-first：有独立产品价值的能力先形成 Vetta 原生合同和 fixture，再由 Pi Anti-Corruption Layer 映射。
2. Extension Tool、Event、Command、Flag、Provider、Prompt 和 native-only host presentation 通过 typed domain adapter 接入现有 `DynamicContributionCatalog<T>`；不新增另一套通用 Catalog。
3. `runtime-core` 只增加产品无关的窄 Port，例如 Runtime Tool `validateInput`；Pi、TypeBox 1 和 compatibility profile 不进入 Runtime 包。
4. Vetta native Tool 增加 input normalization 和结构化 prompt contribution。Pi `prepareArguments`、`promptSnippet`、`promptGuidelines` 只映射到这些 native 合同。
5. 新增状态事件必须先定义为 Vetta 已发生事实，例如 settled、session metadata changed、thinking level changed；不得从近似 Pi 事件伪造。
6. Provider 首期只支持双方可表达的配置字段交集，并建立 generation owner、unregister 和 built-in restore。OAuth、native Provider、动态 refresh 和 request hooks 不在首期。
7. Pi TUI、Theme、Component、renderer、terminal shortcut 不兼容。Vetta 现有 shortcut/message renderer/tool renderer 作为 native-only host contribution 保持行为，Pi adapter 不得生成。
8. Pi loader 只支持明确 allowlist 的 current/legacy namespace 和 TypeBox facade。Compatibility report 区分 lossless、adapted、host-dependent、excluded、unsupported；存在展示剥离时不得宣称完全兼容。

## 依赖与所有权

```text
Vetta native Extension API ---> typed contribution adapters ---+
                                                              |
Pi module/facade -----------> Pi ACL --------------------------+--> DynamicContributionCatalog
                                                                     |
                                                                     +--> existing Runtime/Host ports
```

- Catalog、Extension lifecycle、prompt contribution 和 Pi ACL 属于 `@vetta/coding-agent`。
- 通用 Tool validator Port 属于 `@vetta/runtime-core`，实际输入校验由 Agent engine 既有能力执行。
- Provider wire/stream 协议仍属于 `@vetta/ai`。
- Desktop/CLI/RPC 只适配结构化交互和 native-only presentation，不理解 Pi 类型。

## 生命周期语义

- Factory 阶段只写本地 draft；失败时零发布。
- Activation 后动态注册创建新的 owner-scoped transaction，不重新打开初始 draft。
- register/unregister/reload 对下一 model-call/dispatch boundary 可见；已开始调用持有稳定 snapshot/binding。
- 新 generation 发布成功后才 retire 旧 generation；失败保留上一 generation。
- Tool、Provider、event subscription、command 和 host binding 都有 generation owner，teardown 幂等。

## 考虑过的方案

- **Pi compat 先实现缺失能力**：短期 fixture 更快，长期形成双目录、双事件和双 Provider 生命周期，否决。
- **直接依赖 Pi coding-agent/runner**：生态表面覆盖高，但恢复两套 Agent/Session/Tool 核心并违反依赖边界，否决。
- **新建 Extension 专用通用 Catalog**：与 ADR-0062 的 `DynamicContributionCatalog<T>` 重复，否决。
- **一次性 Extension API v2 重写**：迁移范围和行为风险过大，采用兼容演进的 optional 字段、新方法和 typed adapter。

## 后果

- Pi 兼容必须等待对应 native contract 通过测试，初期交付速度较慢，但不会形成永久兼容执行路径。
- Native Extension 将逐步获得原子注册、动态可见性、stale generation、Tool prompt/input 和 Provider 撤销能力。
- Pi profile 只覆盖宿主中立行为子集，UI-only Extension 会被拒绝或报告展示剥离。
- 每个能力需要 native fixture、catalog/port contract test 和 Pi projection/differential fixture 三层证据。
