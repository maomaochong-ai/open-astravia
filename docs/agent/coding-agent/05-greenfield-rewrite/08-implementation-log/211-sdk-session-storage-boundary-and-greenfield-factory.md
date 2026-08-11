# 第 211 阶段：SDK Session 存储边界与 Greenfield Factory

## 阶段目标

本阶段不切换公开 `createAgentSession`，只闭合 Greenfield SDK 的存储与内部创建链路：

1. Composition 不再直接绑定文件仓储；
2. 提供正式的进程内 Conversation Repository；
3. 明确 SDK 内存、新建文件、恢复文件三种存储目标；
4. 建立内部 SDK Composition Root；
5. 显式报告尚未接入的既有 SDK option；
6. 用真实 Runtime create、prompt、close、resume 与失败回滚验证行为。

## 实施前问题

`createGreenfieldRuntimeComposition` 原先同时依赖 `FileConversationRepository` 的三类责任：

- Kernel Repository、Conversation Document Store、Continuation Store；
- Composition 内部用于关联资源的 Conversation 地址；
- SDK/宿主可见且可恢复的文件路径。

这三类责任被同一个具体类和同一个字符串表达，使内存会话无法正确返回
`sessionFile === undefined`，也使 SDK Factory 无法在不修改 Composition 的情况下选择存储策略。

此外，现有 SDK 兼容清单虽然能在编译期覆盖全部 option，但尚未提供运行时准入判断；若直接切换
公开工厂，尚未适配的 option 存在被静默忽略的风险。

## 架构决策

### 1. 持久化端口属于 Composition Root

新增 `GreenfieldConversationPersistence`，组合以下中立端口：

- `ConversationRepository`；
- `ConversationDocumentStore`；
- `ConversationContinuationStore`；
- 内部 `resolveConversationPath`；
- 对外 `resolveSessionPath`；
- Composition 级 `dispose`。

`resolveConversationPath` 始终可用，内存实现返回 `memory://` 虚拟地址；
`resolveSessionPath` 只代表可恢复持久化文件，内存实现返回 `undefined`。进程级所有权锁只绑定后者。

Composition 接受 `createConversationPersistence` 工厂，而不是共享仓储实例。这样每个 Composition
拥有独立生命周期，Child Composition 继承工厂时也会创建自己的仓储。

### 2. 内存仓储是正式 Storage Adapter

`InMemoryConversationRepository` 位于 `runtime-storage/conversation`，同时实现 Kernel、Document 与
Continuation 三个合同。它保留版本冲突、Document revision、fork、compaction continuation 与关闭后
拒绝访问等语义，不依赖 `coding-agent`。

### 3. SDK 存储目标不暴露 SessionManager

Greenfield SDK 使用独立存储意图：

- `memory`：创建不可恢复的进程内会话；
- `file-create`：在原生 Conversation 目录创建会话；
- `file-resume`：只恢复该目录拥有的原生 Conversation V2 文件。

旧 `SessionManager` 仍属于兼容边界。Legacy JSONL 的识别与迁移不会塞进 Composition；后续应由
SDK 产品适配层先迁移为原生 V2，再提交 `file-resume` 目标。

### 4. Factory 只消费已解析的产品资源

`createGreenfieldSdkSession` 是内部 Composition Root，输入为：

- 已解析的中立 Composition options；
- Session options；
- 明确的存储目标。

它负责：

1. 解析存储目标；
2. 创建 Composition；
3. 选择 Backend `create` 或 `resume`；
4. 绑定 Greenfield SDK 门面；
5. 让 `session.close()` 按 Session、Composition 顺序释放资源；
6. 初始化失败时逆序回滚。

模型发现、认证、Resource Loader、Extension、MCP 等产品资源仍由后续 SDK Host Adapter 解析，
不下沉进此工厂。

### 5. 未适配 option 必须结构化拒绝

新增 `assessSdkCreateOptionsCompatibility`。当前只有已闭合的 `greenfield-core` 字段可通过；任何显式
配置的 `runtime-capability`、`product-adapter` 或 `legacy-concrete` 字段都会返回
`greenfield_sdk_option_not_wired` issue。公开工厂切换前必须逐项减少这些 issue，不能绕过门禁。

### 6. 本阶段不新增 TypeBox/Zod schema

SDK 存储目标是进程内 TypeScript 判别联合，不是文件、网络或插件的不可信输入；为它重复维护运行时
schema 只会制造双份合同。因此本阶段使用穷尽分支和结构化错误。原生 Conversation 文件读取仍继续
使用 runtime-storage 已有的 TypeBox/codec 校验；后续公开 SDK 若接收 JSON/RPC 配置，再在产品输入
边界增加 schema，而不是把校验下沉到 Repository 或 Kernel。

## 本阶段修改

### runtime-storage

- 新增正式 `InMemoryConversationRepository`；
- 从 `@vetta/runtime-storage/conversation` 导出；
- 新增内存仓储行为测试。

### coding-agent Composition

- 新增 Conversation Persistence 端口及文件/内存实现装配；
- 注入持久化工厂时，`conversationDir` 只作为工厂上下文，不再决定具体仓储；
- Runtime 内部路径与对外 Session 路径分离；
- 所有权管理器拒绝绑定无持久化路径的会话；
- 新增 SDK 存储目标解析器；
- 新增内部 `createGreenfieldSdkSession` Factory；
- SDK 门面关闭失败后允许重试清理，同时保持会话准入关闭。

### SDK 兼容门禁

- 保留 36 个 option 的穷尽式编译期分类；
- 增加显式 option 的运行时兼容评估；
- 公开 `createAgentSession` 签名与执行路径保持不变。

## 验证

已覆盖以下场景：

- 内存仓储 create、append、Document mutation、版本错误和 close；
- Greenfield SDK 内存会话真实 prompt，且 `sessionFile` 为 `undefined`；
- 原生文件会话 create、prompt、close、resume、继续 prompt；
- Session 初始化失败后回滚 Composition，并可使用同一身份重新创建；
- SDK 显式未接入 option 返回完整结构化 issue；
- SDK close 清理失败后可重试；
- 既有文件 Composition 集成路径保持通过。

验证命令与最终结果：

- `bunx vitest --run test/conversation/in-memory-conversation-repository.test.ts`：2 项通过；
- `bunx vitest --run test/sdk/sdk-compatibility-inventory.test.ts test/sdk/greenfield-sdk-session-adapter.test.ts test/sdk/greenfield-sdk-session-integration.test.ts`：11 项通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查与架构门禁。

## 阶段结论与后续边界

第 211 阶段闭合后，SDK 核心创建链路不再依赖文件仓储或 `SessionManager` 具体实现，但公开 SDK 尚未
切换。下一阶段应实现 SDK Host Adapter：把现有认证、模型解析、Resource/Settings、Extension/MCP
结果转换成 Factory 的 Composition options，并用 `assessSdkCreateOptionsCompatibility` 作为切换门禁。

Legacy SessionManager 文件恢复必须继续走独立格式分析与迁移边界，不能让 Greenfield Composition
读取旧格式，也不能原地改写用户源文件。
