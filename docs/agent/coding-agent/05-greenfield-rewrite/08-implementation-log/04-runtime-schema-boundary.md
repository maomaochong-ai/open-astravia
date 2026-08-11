# 实施日志：运行时 Schema 边界

本文件记录运行时 Schema 边界的实施与验证。

## 2026-07-26：运行时 Schema 边界

### 目标

明确 TypeScript 静态类型与运行时数据校验的边界，并修复 Conversation JSONL 只做浅层手写判断的问题。

### 分析结论

- Tool 参数需要向模型暴露 JSON Schema，现有 `ai` 和 `agent-core` 已使用 TypeBox/AJV，因此继续使用 TypeBox。
- Conversation 文件来自磁盘，属于不可信输入；仅检查 `message.role` 是字符串、`stopReason` 是字符串不足以构造可靠领域对象。
- Zod 在仓库的 UI、CLI 和部分生态适配器中已有使用，但新 Kernel 没有 preprocess、transform 或 Zod 生态互操作需求。
- 在底层同时维护 TypeBox 与 Zod 会制造重复 Schema 和错误映射，因此本轮不向 Kernel/Storage 引入 Zod。

最终规则：

```text
模型 Tool / MCP / 持久化协议 -> TypeBox / JSON Schema
Host 表单和复杂配置转换      -> 确有转换需求时可使用 Zod
通过边界后的 Kernel 内部对象 -> TypeScript 合同
```

### 修改范围

- `runtime-storage` 增加 TypeBox 直接依赖。
- 新增 `record-schema.ts`，定义：
  - User、Assistant、Tool Result Message。
  - Text、Image、Thinking 和 Tool Call Content。
  - Usage、Cost 和 StopReason。
  - 六类 Stored Session Event。
  - Conversation Header、Event Record 和 Snapshot。
- `FileConversationRepository`：
  - append 前校验完整 Event 结构。
  - saveSnapshot 前校验完整 Snapshot 结构。
  - load 时使用完整 Record Schema 替换浅层手写 type guard。
  - 保留 Session ID、sequence 和 optimistic version 的显式领域校验。

### 错误语义

- 调用方提交非法 Event 或 Snapshot：`conversation_invalid_event`。
- 文件包含合法 JSON、但不符合版本化领域 Schema：`conversation_corrupt`。
- Schema 校验不替代 Session ID、事件顺序和版本冲突检查。

### 数据兼容影响

- Conversation schema version 仍为 1，写入格式没有改变。
- 过去能够被浅层校验错误接受的非法记录现在会明确报损坏。
- Schema 使用 `additionalProperties: false`；格式新增字段时必须显式更新 Schema，并按兼容性决定是否提升 schema version。
- 旧生产会话格式仍未接入新 Repository。

### 测试

- `packages/runtime-storage`
  - `bun run test`
  - 1 个测试文件、9 个测试通过。
- 新增验证：
  - Repository 写入边界拒绝非法 Message role，且不改变 conversation version。
  - JSONL 中 StopReason 非法时，即使 JSON 与基础 Record 字段完整，仍判定为 corrupt。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- 新会话存储不再把浅层结构检查当作领域校验。
- Tool 和持久化边界统一使用 JSON Schema 语义，避免为 Kernel 引入第二套等价 Schema。
- Zod 的适用范围被限制在确实需要解析转换的宿主边界，而不是作为默认依赖扩散。

### 下一步

1. Snapshot 加载与旧格式 importer 必须复用相同的 Schema-first 边界。
2. 新 Coding Tools 使用 TypeBox 定义参数，并由 AgentCoreTurnEngine/agent-core 统一校验。
3. RPC Adapter 重写时为 wire payload 建立独立版本化 Schema，不能直接信任 TypeScript DTO。
# 实施日志：Coding Tools Feature

本文件记录 Coding Tools Feature 首切片、行为兼容性纠偏与工具注册边界相关实施。
