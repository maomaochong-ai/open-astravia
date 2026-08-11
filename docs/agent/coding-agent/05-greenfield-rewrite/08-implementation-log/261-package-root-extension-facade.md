# 第 261 阶段：包根 Extension 门面收口

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

第 260 阶段确认 `src/index.ts` 仍把 Extension、Auth、Compaction、CLI Bootstrap、RPC、Profile、Skill 和工具函数聚合成一个 245 行包根。该结构让消费者无法从导入路径判断所有权，也允许内部便利对象重新扩张为事实公共 API。

本阶段把包根定义为稳定 Extension 作者门面。SDK、RPC、Host、Settings、Profile、Resource 等能力没有删除，继续由既有显式子路径提供；执行实现、运行时组合和用户可观察行为均未调整。

## 实施内容

- 将 `src/index.ts` 从 245 行多领域聚合入口收口为对 `public-api/extensions.ts` 的唯一转发。
- Extension 门面保留完整 Extension 合同与 Runtime，并保留扩展文档和示例实际依赖的 `convertToLlm`、`serializeConversation`、事件总线及主题辅助 API。
- 公共面测试改为断言包根与 `./extensions` 门面运行时导出完全一致，同时验证 SDK、RPC、Bootstrap、Host Services、Settings、Profile、Resource、历史会话等显式子路径仍可用。
- 删除过时的包根 SDK 文档内容，改为稳定 SDK 和各公共子路径的入口说明；README 与 CHANGELOG 同步声明边界变化。
- 重写进度守卫升级到 version 11，冻结包根唯一导出边；新增任何其他模块边或改变导出形式都会失败，不能仅通过刷新 baseline 合法化非 Extension 导出。
- 未引入 TypeBox 或 Zod：本阶段处理 TypeScript 模块静态边界，不存在不可信运行时数据校验需求。

## 旧实现依赖变化

- 包根入口：`245 -> 2` 行。
- 包根模块导出边：`21 -> 1`，唯一目标为 `./public-api/extensions.js`。
- 包根非 Extension 导出边：`0/0`。
- SDK、RPC、Host、Settings、Profile、Resource 等实现和 package export 子路径未删除。
- Coding Agent 旧实现文件、旧实现依赖、Runtime 反向依赖、compat 导出和旧执行入口继续保持 `0`。

## 行为兼容性验证

- 公共面、Extension Event Bus 与自定义 Compaction 示例定向测试：3 个文件、7 个测试通过。
- 重写治理测试：1 个文件、19 个测试通过。
- `packages/coding-agent` 全包测试：128 个文件通过、1 个文件跳过；891 个测试通过、17 个跳过。
- 首次全包测试发现 `createEventBus` 未进入新门面，2 个测试失败；该 API 被确认属于 Extension 能力并恢复，随后定向和全包测试均通过。
- `packages/cli-app` 的 `package-entrypoints`、CLI intent 及非 Extension RPC 用例通过；CLI 全包测试在 Bun 1.3.9 编译的 RPC Extension 子进程中两次复现固定地址段错误，之后产生 18 个临时目录 `EBUSY`/超时级联失败。CLI 生产代码不存在包根导入边，根级 CLI 类型检查和 standalone 构建守卫通过，因此记录为测试运行时残余风险，不归因于本阶段模块边界变更。
- `bun run check:quick` 通过。
- 根 `bun run check` 通过，覆盖 Biome、monorepo、CLI、Desktop、Admin 类型检查和全部质量守卫。
- 实际架构扫描：包根导出边 `1`、非 Extension 导出 `0/0`，旧实现相关指标继续全部为 `0/0`。

## 尚未完成的替换

- Composition 公共面仍有 34 个导出并保留 `Greenfield` 命名；只有在宿主合同和消费者迁移证据充分时才能继续收窄。
- `public-api/extensions.ts` 仍同时承载 Extension 合同、Extension Runtime 和少量作者辅助 API。它们属于同一扩展公共面，但后续若增长，应拆成明确的 Extension 子路径而不是重新扩张包根。
- CLI RPC Extension 测试使用的 Bun 1.3.9 可执行产物存在稳定段错误，需要在独立阶段确认 Bun 版本或测试可执行产物生成方式；不得借此改变 Agent 功能或降低现有测试断言。
