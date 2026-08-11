# 第 119 轮：Knowledge Poller Greenfield opt-in 与多批写入差分

## 目标

- 让 Desktop Knowledge Poller 可以显式选择 Greenfield Knowledge Processing Factory。
- 默认值继续保持 Legacy，不在同一阶段切换生产默认实现。
- 用真实 Greenfield Tool Loop 验证多个并发加工 Session 共享轮级 Writer。
- 比较最终 wiki 真相源和缓存，而不是只验证 Factory 或 Writer 的 mock 调用。

## 实施判断

Desktop 已有进程级 `VETTA_DESKTOP_AGENT_RUNTIME` selector，并且缺省、空值和 `legacy` 都解析为
Legacy。Knowledge Poller 再新增一套环境变量或持久配置会产生两个可能互相冲突的 Runtime 决策源。

因此本轮复用既有 selector：

```text
VETTA_DESKTOP_AGENT_RUNTIME
  -> resolveDesktopAgentRuntimeBackend()
  -> Desktop Knowledge 产品 Factory Resolver
  -> Legacy Factory | Greenfield Factory
  -> Knowledge Poller
```

环境变量解析仍只在 Desktop 进程边界发生。Coding Agent Composition 不认识 Desktop 配置，也没有新增
Knowledge 专用 selector。

## 修改

### Desktop 产品 Factory Resolver

新增 `createDesktopKnowledgeProcessingSessionFactory()`，输入已经校验的
`DesktopAgentRuntimeBackend` 和共享 `ModelRegistry` 来源：

- `legacy` 组合既有 Legacy Knowledge Processing Adapter。
- `greenfield` 组合第 118 轮新增的 Greenfield Adapter。
- Resolver 只负责产品装配，不读取环境变量、不持有 Session，也不修改 Factory 合同。

Knowledge Poller 在模块初始化时通过既有 Desktop selector 选择 Factory，并记录实际选择。未显式设置
`VETTA_DESKTOP_AGENT_RUNTIME=greenfield` 时仍使用 Legacy。

### 多批真实写入差分

新增真实 Greenfield 多 Session 合同：

1. 创建两个独立 Greenfield Knowledge Processing Session。
2. 两个 Session 注入同一个真实 `KbWriteSession`。
3. 使用确定性 Provider Frame，让两个批以不同 source 并发写入相同目标 path。
4. 等待各自 Tool Loop 自然完成并收集 usage。
5. 等待两个 Session 和各自 Composition 完整释放。
6. 重建缓存后，将 wiki page、正文、manifest 和 tags 与既有 Writer 串行基线比较。

比较时只归一化随机 page id、由 id 产生的冲突路径后缀和执行时间；source、source path/hash、标题、摘要、
标签、正文、语义 wiki path、orphan 状态、manifest 反查和 tags 关联必须相等。

该合同验证的是 Poller 最关键的并发写入边界：多个 Greenfield Composition 没有创建或替换轮级 Writer，
而是共享同一个 PageIndex 和串行提交器。它没有把 Legacy Agent Loop 的内部事件实现复制成第二个测试
Oracle。

## 明确未修改

- 没有切换 Desktop Runtime 或 Knowledge Poller 的默认值。
- 没有增加 Knowledge 专用环境变量、设置项或 UI。
- 没有修改批次规划、并发限制、raws 锁、临时目录、缓存重建、失败隔离或 processing record。
- 没有修改 Tool 名称、描述、Schema、顺序、结果或错误文案。
- 没有扩展 Runtime Core、RuntimeHost 或 Knowledge Processing Port。
- 没有共享 Greenfield Composition；仍保持每个加工 Session 独占并负责释放自己的 Composition。

## TypeBox / Zod 判断

本轮直接复用已校验的 `DesktopAgentRuntimeBackend` 联合类型。新增 Resolver、Factory 选择和差分快照都属于
进程内 TypeScript 边界，没有新的 RPC、配置文件或持久化反序列化输入，因此不增加 TypeBox/Zod Schema。

## 验证

- Coding Agent Greenfield Knowledge Processing：2 个文件、3 项测试通过。
- Desktop Runtime selector 与 Knowledge Factory Resolver：2 个文件、5 项测试通过。
- `bun run check:quick` 通过。
- `bun run check` 通过，覆盖 Biome、Root/CLI/Desktop/Admin 类型检查和结构守卫。

完整类型检查曾发现测试使用 ES2023 `toSorted()`，而仓库目标为 ES2022；已改为复制数组后 `sort()`，
重新执行完整门禁后通过。

## 下一步

下一阶段应验证 Poller 轮级副作用，而不是继续扩充 Session Factory：

1. 为 Poller 的记录、通知、锁和知识库根建立最小可注入测试边界，不改写现有轮询算法。
2. 用相同 raws fixture 分别运行 Legacy/Greenfield，比较 processing record、usage、failure reconciliation、
   cache 和通知顺序。
3. 覆盖 Provider 失败、用户 abort、并发批部分完成和最终 raws unlock。
4. 确认所有 Session/Composition 均释放后，再单独评审 Knowledge Poller 默认值切换。
