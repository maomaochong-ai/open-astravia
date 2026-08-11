# Session 创建与存储边界

## 本轮目标

继续移除 `RuntimeHost` 对旧 `coding-agent` 具体实现的直接依赖，把会话创建、离线会话管理、文件历史读取和进程级模型刷新收敛为 Runtime 自有合同，同时保持现有功能与行为不变。

## 已实施

### 1. Runtime-owned 创建请求

新增 `RuntimeSessionCreateRequest`，只包含 Runtime 能理解的创建数据与能力：

- 工作目录、agent 目录、会话路径和会话目录；
- 模型、thinking level、场景和执行模式；
- system prompt、环境变量、插件调用器和沙箱路径；
- `ask_user_question` 能力及延迟获取 sessionId 的回调。

该请求不允许携带 `SessionManager`、旧 `customTools` 或 `ModelRegistry`。这些旧实现对象只在兼容适配器内部组装。

### 2. Legacy 创建适配

`LegacyCodingAgentSessionBackend` 和 create-only Backend 兼容适配器负责把 Runtime 请求转换为旧 `CreateAgentSessionOptions`：

- `sessionPath` 存在时调用 `SessionManager.open`，否则调用 `SessionManager.create`；
- sandbox 模式继续构建原有沙箱工具，full-access 模式不注入这些自定义工具；
- 继续使用组合根传入的共享 `ModelRegistry`；
- `ask_user_question` 继续通过回调读取创建完成后的 sessionId，不提前固化空值。

### 3. 进程级服务合同

新增三个独立合同：

- `RuntimeSessionCatalog`：列举项目/会话、离线重命名和删除会话产物；
- `RuntimeSessionFileHistoryReader`：从会话文件投影 Runtime 历史；
- `RuntimeSharedModelController`：更新服务端 token 和后台刷新远程模型。

`RuntimeHost` 只依赖这些合同，不再直接操作静态 `SessionManager`、JSONL 解析函数或具体 `ModelRegistry`。

### 4. Legacy 服务适配器

新增 Legacy Adapter 并保持原行为：

- 项目与会话列表继续沿用旧分组、排序和字段映射；
- 离线重命名通过打开 SessionManager 修改名称，并保证关闭；
- 删除同时清理会话 JSONL 和对应 `.lock` 文件；
- 文件历史继续使用旧 entries 加载、分支选择和 History 转换链；
- 共享模型刷新继续委托给同一个 `ModelRegistry`。

### 5. RuntimeHost 依赖方向

`runtime-host.ts` 已不再导入 `@vetta/coding-agent`。默认组合仍使用 Legacy Adapter，因此生产默认行为不变。

`RuntimeHostOptions.modelRegistry` 暂时保留为向后兼容输入，由组合阶段立刻适配成 `RuntimeSharedModelController`；它不再进入 Runtime 创建请求或 SessionHandle。

### 6. 架构守卫

包边界检查新增精确规则：

- `runtime-host.ts` 禁止导入 `@vetta/coding-agent`；
- `session-services.ts` 禁止导入 `@vetta/coding-agent`；
- Legacy Adapter 文件仍允许依赖旧包，明确作为兼容边界。

## 测试

新增或补充以下测试：

- 创建请求的结构门禁，验证不会回流 `sessionManager`、`customTools`、`modelRegistry`；
- create/open 两条 Legacy 映射路径；
- sandbox/full-access 工具注入差异；
- `ask_user_question` 的 sessionId 延迟绑定；
- 自定义 Catalog、文件历史和共享模型服务的委托；
- 真实临时 JSONL 的列表、历史、重命名、删除及 `.lock` 清理；
- 包边界规则自身的回归测试。

验证命令及结果：

- `bunx vitest --run test/runtime-host/session-creation.test.ts test/runtime-host/session-backend.test.ts test/runtime-host/session-services.test.ts`：3 个文件、15 个测试通过；
- `bunx vitest --run test/quality-gates.test.mjs`（`scripts/quality`）：22 个测试通过；
- `bun run test`（`packages/runtime-core`）：20 个文件、95 个测试通过；
- `bun run check:quick`：通过；
- `bun run check`：Biome、monorepo/desktop 类型检查与质量守卫全部通过。

## TypeBox / Zod 评估

本轮边界都是进程内 TypeScript 对象，不接收 JSON、配置文件或网络等不可信输入。静态类型足以约束依赖方向，引入运行时 Schema 不会增加有效安全性，因此本轮不引入 TypeBox 或 Zod。未来若创建请求跨 IPC、插件或持久化边界，再在该外部入口增加 Schema 校验。

## 明确未修改

- 没有改变会话创建、恢复、列举、历史、重命名和删除的用户行为；
- 没有改变工具集合、工具描述或执行权限；
- 没有把 Greenfield Backend 伪装成已具备 Legacy 全能力；
- 没有删除现有 `modelRegistry` 兼容入口。

## 下一步

建立 Legacy 与 Greenfield Session Assembly 的能力对照表和可执行合同测试，逐项补齐 Greenfield Backend 缺失能力。只有能力真实实现并通过差分验证后，才允许组合根切换；不使用 no-op Adapter 掩盖缺失能力。
