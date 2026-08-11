# 实施日志：行为兼容性纠偏

本文件记录行为兼容性纠偏的实施与验证。

## 2026-07-26：行为兼容性纠偏

### 问题

准备迁移 read 时，最初实现把旧 read 缩减成“工作区内纯文本读取”，并改变了路径、编码、
图片、二进制、锚点、Schema 和输出 details。该方向把功能重构夹带进架构重写，不符合
“保留外部行为，只替换内部结构”的迁移目标。

同时复查第一个 `current_time` Runtime Tool，发现首次实现也改变了：

- 完整模型可见描述。
- JSON Schema 对额外字段的宽容度。
- 已取消 Signal 下直接执行工具的行为。

### 处理

- 撤下不兼容的 read Runtime Tool、Workspace-only Path Policy 和相关导出。
- read 重新标记为“未迁移”，旧生产工具保持不变。
- 恢复 `current_time` 的旧描述、旧 Schema 和旧直接执行语义。
- 新增旧新差分测试，直接比较 current_time 的定义与固定时间执行结果。
- 将工具调整为独立 `tools/current-time/` 目录，模型描述放在 `description.ts`。
- 旧实现使用 `description.txt` 再在构建期生成 TS；新实现直接使用 TS 常量，避免重复生成链路，
  差分测试保证最终描述文本不变。
- 新增行为兼容性审计文档，逐项记录已实施模块的切换阻断差距。
- 测试策略增加强制差分 Gate：同名能力必须同时运行旧新合同测试。
- runtime-tools 开发规则增加“架构调整不能缩减功能”的约束。

### 审计结果

- `current_time`：工具定义和执行结果已兼容；Profile scope/category 尚未迁移。
- read：未迁移，必须保留绝对路径、`~`、模糊路径、GB18030、图片、二进制提示、锚点、
  截断 details 和完整模型描述。
- AgentSession：活动 Turn 输入仍采用拒绝策略，尚未兼容旧 queue/follow-up/steering。
- AgentCoreTurnEngine：尚未向 Kernel/Host 输出完整流式观察事件。
- Conversation Repository：旧格式 importer、Snapshot 加载、分支和恢复尚未完成。
- Context Strategy：旧 compaction 行为尚未迁移。
- MCP、Skill、Knowledge、Subagent 和各宿主 Adapter 尚未迁移。

这些差距没有影响当前生产入口，因为生产仍使用旧实现；但全部属于切换阻断项。

### 测试

- `packages/runtime-tools`
  - `bun run test`
  - 2 个测试文件、5 个测试通过。
- current_time 差分覆盖：
  - name、label、完整 description 和 TypeBox Schema。
  - 固定系统时间下的 content 与 details。
  - 额外模型参数的旧 Schema 宽容度。
  - 已取消 Signal 下直接调用的旧执行语义。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 下一步

1. 把旧 read 行为用例整理成可复用的差分合同。
2. 同一组 fixture 同时运行旧 read 和新 read。
3. 只有文本、GB18030、图片、二进制、路径、锚点、截断、取消和自定义 Operations 全部
   等价后，才重新公开新 read。
4. 对 Session、事件和存储采用同样的旧新差分 Gate，不以“已有新实现”代替兼容验收。
