# 阶段 34：Session 观察事件与 Greenfield 宿主适配

## 目标

把“补齐旧会话事件特征基线”和“Greenfield 事件适配到现有 `SessionEvent`”作为同一阶段完成，
建立旧后端与新内核共享的事件反腐层，同时保持生产 RuntimeHost 默认使用旧会话后端。

## 分析结论

事件需要区分两类：

- text/thinking delta、工具进度和生命周期属于瞬时观察事件，只应推送给宿主；
- 最终消息、Turn 终态和 compaction 记录属于持久事件，需要进入 Conversation Repository。

如果把所有流式 delta 写入会话仓储，会显著放大 JSONL、增加恢复复杂度并把 UI 节流细节固化为
数据协议。因此本阶段建立独立 observation envelope，经 `EventSink` 发布但不持久化。

## 已实施

1. 新增 `RuntimeSessionObservationEvent`：
   - 不依赖旧 `AgentSessionEvent`；
   - 覆盖生命周期、文本/思考增量、toolcall、工具生命周期、usage/error、MCP、Todo、后台任务、
     子代理和 compaction；
   - 不包含由宿主生成的 sessionId、eventId 和 schemaVersion。
2. 重构旧事件适配：
   - `AgentSessionEvent` 先转换为 observation；
   - observation 再封装成现有 `SessionEvent`；
   - 保留 assistant timing 落盘、usage 上下文占用、provider error、abort 和所有现有事件字段。
3. 扩展 Greenfield Turn Engine：
   - 输出 agent/turn lifecycle；
   - 输出 text/thinking delta、toolcall start；
   - 输出工具 start/update/phase/end；
   - 最终消息仍走原有 `message` 事件。
4. 扩展 Turn Pipeline：
   - 将瞬时 observation 包装成 `session.observation`；
   - 只调用 `EventSink.publish()`，不写入 Repository，也不通知持久事件 Observer。
5. 新增 Greenfield Kernel Event Adapter：
   - observation 映射到现有 `SessionEvent`；
   - assistant `message.appended` 映射为 final、usage、error/aborted；
   - cancel/failure/compaction 映射为现有终态事件。
6. 修正 `CompletingTurnEngine` 测试桩的判别联合返回类型，使其遵循正式
   `TurnEngineEvent` 合同。

## 特征测试覆盖

- 旧生命周期与 assistant timing 持久化。
- text/thinking/toolcall 流式事件。
- assistant final、usage、provider error 和 abort。
- 工具 start/update/phase/end 全字段。
- Todo、后台任务、子代理、compaction、MCP reload 和 retry。
- Greenfield observation envelope 的 source/timestamp/payload。
- Greenfield 最终消息、usage、错误、取消、失败与 compaction 适配。
- 瞬时 observation 会进入 EventSink，但不会进入 Conversation Repository。

## 明确未修改

- 没有切换 Desktop、CLI、Scheduler、Batch、RPC 或 IM 生产入口。
- 没有实现活动 Turn 的 steer、follow-up 或输入队列。
- 没有迁移旧 JSONL、分支、锁或异常恢复。
- 没有实现 Greenfield MCP、Skill、Knowledge、Todo、后台任务或子代理 Feature。
- 没有把流式 delta 写入持久化事件。

## 验证

- `bun run test:pkg runtime-core`：通过，8 个测试文件、37/37。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：本阶段源码与测试的 Biome、类型和架构守卫通过；全量检查仍被既有问题阻断：
  - `packages/capability-runtime/test/registry.test.ts` fixture 缺少
    `workspacePath` / `archivedProjects`；
  - 若干 `packages/runtime-tools/test/**` 旧差分测试存在 `AgentTool` 参数方差错误。
  阶段 33 记录的 `turn-pipeline.test.ts` 判别联合类型错误已随本阶段正式事件合同修正。

## 已知差距与下一步

Greenfield Repository 尚不能提供旧 `getContextUsage()` 等价信息，因此 Greenfield usage 暂时用
`contextPercent: null` 和 `contextWindow: 0` 表示未知；成功 `context.compacted` 目前只能产生
compaction end，无法重建旧 compaction start 时机。

下一阶段应整体迁移活动 Turn 的输入并发语义：steer、follow-up、队列模式、自然结束出队、
abort/error 保留队列，并通过旧新差分测试验证；不要在此之前切换生产 Session Backend。
