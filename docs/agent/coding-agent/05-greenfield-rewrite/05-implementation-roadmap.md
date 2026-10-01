# 实施路线

## 阶段 0：冻结迁移合同

目标：明确“重写后什么必须继续工作”。

工作：

1. 盘点所有 `coding-agent` 导出和 deep import。
2. 按调用方记录 CLI、Desktop、runtime、IM 和测试的依赖。
3. 将每个依赖分类为：
   - 新稳定合同。
   - 移动到正确所有权包。
   - 删除且不兼容。
4. 记录所有持久化格式和版本。
5. 建立功能验收矩阵。

产物：

- External Contract Matrix。
- Persistence Format Matrix。
- Feature Inventory。
- Breaking Change 清单。

退出条件：

- 每个下游导入都有明确去向。
- 每份用户数据都有保留、迁移或明确删除决定。
- 不再以“旧类能否继续导出”作为兼容标准。

## 阶段 1：建立行为基线

目标：让旧实现成为可执行规格，而不是新实现的依赖。

工作：

1. 将现有测试分成行为测试和实现测试。
2. 为以下主链路补充黑盒测试：
   - 文本对话。
   - 单工具和多工具循环。
   - 工具失败。
   - 取消。
   - 输入排队。
   - Session 恢复和分支。
   - Compaction。
   - MCP 工具。
   - Skill 指令。
   - 知识检索。
   - RPC。
3. 记录事件序列和持久化结果为 golden fixture。

退出条件：

- 关键产品行为不依赖读取旧内部字段即可验证。
- 失败、取消和恢复都有基线。

## 阶段 2：先打破包依赖环

目标：让新实现有正确的生长方向。

工作：

1. 在 `runtime-core` 定义新的稳定端口。
2. 移除 `runtime-core -> coding-agent` 的概念依赖。
3. 让 storage、tools、MCP 逐步拥有自己的实现。
4. 旧代码通过临时 Adapter 实现新端口，保持生产入口不变。
5. 增加 import guard，禁止下层重新导入 `coding-agent`。

注意：

- 临时 Adapter 只用于隔离，不作为最终 API。
- 本阶段不改产品行为。

退出条件：

```text
runtime-core       -X-> coding-agent
runtime-storage    -X-> coding-agent
runtime-tools      -X-> coding-agent
runtime-mcp        -X-> coding-agent
```

## 阶段 3：实现全新 Kernel

目标：在不连接真实产品能力的情况下完成最小闭环。

工作：

1. 实现 Session 状态机。
2. 实现固定阶段的 Typed Turn Pipeline。
3. 实现 Pipeline 的持久化检查点。
4. 适配 `@astravia/agent-core` 的 Tool Loop。
5. 实现不可变 Runtime Snapshot。
6. 实现统一 Tool Runtime。
7. 实现取消、事件和 Conversation Repository 端口。
8. 实现 `ContextStrategy` 和 `ContextSummarizer` 端口。

测试只使用：

- Fake Model。
- Fake Tool。
- In-memory Repository。
- Deterministic Clock / ID。

退出条件：

- Kernel 测试不导入 Coding、MCP、Skill、知识库和 Desktop。
- 状态、并发、取消和资源释放测试全部通过。
- Pipeline 阶段顺序固定且具有明确输入输出。
- 不存在通用 `pipeline.use()` 或可写共享 metadata。

## 阶段 4：实现 Feature Compiler

目标：所有扩展能力通过一个确定性的编译入口进入 Agent。

工作：

1. 实现 Feature Definition、Instance、Contribution。
2. 实现依赖排序、冲突校验和生命周期。
3. 实现快照原子切换。
4. 实现失败回退到上一个有效快照。
5. 加入工具命名冲突和重复资源检测。

退出条件：

- 不存在运行期直接修改 Session 工具列表的 API。
- 不存在第二套 instructions、tools 或 lifecycle 注入通道。

## 阶段 5：逐个重建 Agent Feature

建议顺序：

1. Coding Tools。
2. System Instructions / Profile。
3. Conversation Storage。
4. Context Strategy / Compaction。
5. Skill。
6. MCP。
7. Knowledge / Memory。
8. Subagent。

每个 Feature 都必须满足同一合同测试：

- 创建。
- 贡献。
- 冲突。
- 取消。
- dispose。
- 重载失败回退。
- 不污染其他 Session。

一个 Feature 未通过测试时，不迁移下一个同类 Feature。

## 阶段 6：重写宿主适配器

顺序：

1. SDK。
2. RPC。
3. CLI。
4. Desktop RuntimeHost。
5. IM。

适配器只允许：

- 转换输入。
- 订阅事件。
- 映射错误。
- 管理协议连接。

禁止：

- 修改内核状态。
- 直接注册工具。
- 自己决定上下文和 Compaction。
- 读取 Session 内部属性。

IM 应成为最纯粹的验收样例：

```text
IM Message
-> SessionInput
-> session.send()
-> SessionEvent
-> IM Reply
```

## 阶段 7：影子对比与整仓切换

在测试和离线回放中，对旧实现与新实现执行同一场景，比较：

- 消息序列。
- Tool Call 与 Tool Result。
- 停止原因。
- Session 持久化。
- 取消结果。
- 关键事件顺序。

不要求自然语言文本完全相同；模型调用应使用 Fake Model 或录制响应。

切换方式：

1. 保持旧生产入口不变，直到新实现通过整仓验收。
2. 用一个组合根开关切换实现，不在业务代码中散布 Feature Flag。
3. 所有 monorepo 调用方在同一切换周期迁移到新 API。
4. 完成一次完整检查和目标测试。

退出条件：

- Desktop、CLI、RPC、IM 均只使用新 Session API。
- 新实现不导入旧 `src/core`。
- 旧实现已无生产引用。

## 阶段 8：删除旧代码

删除前必须满足：

- `rg` 证明生产代码不再引用旧目录和旧导出。
- 持久化迁移测试通过。
- 新旧差异清单中的每一项已经批准。
- 整仓类型检查和目标测试通过。
- 回滚策略已验证。

然后一次性删除：

- 旧 `src/core`。
- 旧 Extension / Manager / Registry。
- 旧兼容 Adapter。
- 只验证内部实现的旧测试。
- 旧 deep export。
- 临时 Feature Flag。

删除后再将临时 `v2` 目录改为最终职责名称，代码库中不保留 `legacy`、`new`、`v2` 这种永久命名。
