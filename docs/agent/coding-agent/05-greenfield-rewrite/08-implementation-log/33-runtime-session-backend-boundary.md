# 阶段 33：Runtime Session Backend 创建边界

## 目标

在不切换 Greenfield Kernel、不改变现有会话功能的前提下，为生产 `RuntimeHost`
建立可注入的会话创建边界，使旧 `coding-agent` 会话成为默认兼容适配器，而不是
继续把 `createAgentSession` 固定写在宿主编排内部。

## 分析结论

`RuntimeHost` 当前不仅负责创建会话，还直接使用旧 `AgentSession` 的模型、事件、
历史、插件、Todo、后台任务和子代理能力。本轮若一次性把这些能力合并成统一接口，
只会产生一个新的 God Interface。因此本阶段只隔离创建入口，后续再按事件、历史和
外围能力分别收窄会话合同。

## 已实施

1. 新增 `runtime-host/session-backend.ts`：
   - 定义 `RuntimeSessionBackend`；
   - 定义当前兼容期使用的 `RuntimeSession` 与创建参数别名；
   - 实现默认 `LegacyCodingAgentSessionBackend`，继续委托旧
     `@vetta/coding-agent.createAgentSession`。
2. `RuntimeHostOptions` 新增可选 `sessionBackend` 注入点。
3. `RuntimeHost` 不再直接调用 `createAgentSession`，统一通过注入后端创建会话；未注入
   时自动使用旧兼容后端。
4. 新增特征测试，固定以下行为：
   - `SessionConfig` 到当前创建参数的关键语义保持不变；
   - `cli` 场景仍启用子代理；
   - 创建后仍绑定扩展 UI Context 并安装永久流缓冲订阅；
   - 销毁会话仍释放订阅并调用底层 session dispose。
5. 从 `@vetta/runtime-core` 根入口导出后端合同与旧兼容实现，供宿主组合根显式注入。

## 明确未修改

- 没有把 Desktop、CLI、Scheduler 或 Batch 切换到 Greenfield Kernel。
- 没有修改工具、Skill、MCP、提示词、上下文压缩或会话存储行为。
- 没有修改现有 `SessionFacade` 与 `SessionEvent` 对外协议。
- 没有尝试把旧 `AgentSession` 的全部能力一次性抽象为统一接口。

## 验证

- `bunx vitest --run test/runtime-host/session-backend.test.ts`：通过，4/4。
- `bun run test:pkg runtime-core`：通过，6 个测试文件、27/27。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Biome 与架构守卫通过；全量类型检查仍被本轮开始前已有问题阻断：
  - `packages/capability-runtime/test/registry.test.ts` 的 fixture 缺少
    `workspacePath` / `archivedProjects`；
  - `packages/runtime-core/test/kernel/turn-pipeline.test.ts` 的测试 Turn Engine 返回值
    未保持 `TurnEngineEvent` 判别联合；
  - 若干 `packages/runtime-tools/test/**` 旧差分测试存在 `AgentTool` 参数方差错误。
  本阶段新增和修改的源码、测试未产生新的类型、Biome 或架构守卫错误。

## 下一步

在这一创建边界上补齐旧会话事件的特征测试，然后定义独立于旧
`AgentSessionEvent` 的 Runtime Session 观察事件合同，并建立 Greenfield 事件到现有
`SessionEvent` 的映射。持久化历史与外围能力继续保持独立迁移，不进入事件接口。
