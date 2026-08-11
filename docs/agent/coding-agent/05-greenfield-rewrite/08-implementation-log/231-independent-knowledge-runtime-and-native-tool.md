# 第 231 阶段：独立 Knowledge Runtime 与原生知识 Tool

## 阶段目标

把知识存储、查询、写入和批处理能力从 `coding-agent/src/core/knowledge` 迁入独立的 `runtime-knowledge` 包，并把 `kb_write_page` 迁为 `runtime-tools` 原生 Tool。`coding-agent` 只负责产品组合、默认目录解析和端口注入。本阶段只重构所有权与依赖方向，不改变知识页面格式、索引、标签、处理流程、工具名称、描述、Schema、scope、输出或错误语义。

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

Knowledge 是围绕 Agent 内核组合的独立能力域，不属于内核，也不属于某个具体 Tool。现在存储、查询、页面写入、索引、差分和处理批次均由 `runtime-knowledge` 持有；`kb_write_page` 的模型合同和 Runtime Tool 由 `runtime-tools` 持有。`coding-agent` 不再导出 Knowledge 公共子路径，只在产品组合边界把默认知识目录和具体操作注入 Session。

旧 `core/tools/kb_write_page`、`kb_list_tags` 和 `kb_filter_by_tags` 仍作为旧 `AgentSession` 的功能兼容入口存在，但它们已改为消费 `runtime-knowledge`，不再拥有知识领域实现。它们属于后续旧 Tool/Session 结构退役范围，不能被视为新架构入口，也不能反向决定 `runtime-knowledge` 的合同。

## 实施内容

- 新增 `@vetta/runtime-knowledge` 包，按 domain、storage、query、writer 和 processing 分层承载原知识能力，并建立独立公共入口、构建配置、README、CHANGELOG 和行为测试。
- 删除 `coding-agent/src/core/knowledge` 全部 15 个实现文件以及 `@vetta/coding-agent/knowledge` 导出；Desktop、Canary 和 Coding Agent 组合改为直接依赖 `runtime-knowledge`。
- 新增 Runtime 原生 `kb_write_page` Tool，保持旧工具名称、描述、TypeBox Schema、scope、能力需求、输出和错误语义，通过 `KbWritePageOperations` 注入写入副作用。
- 将默认知识目录解析收敛到 Coding Agent 产品组合边界；`runtime-knowledge` 不读取 Coding Agent 设置，也不反向依赖 `coding-agent`。
- 删除只负责桥接旧知识实现的 Greenfield Adapter，生产组合直接注入独立 Runtime 合同。
- 增加包边界审查，禁止恢复 `coding-agent/src/core/knowledge`、`@vetta/coding-agent/knowledge` 和对应 Manifest 导出。
- 更新重写基线和受影响包的 Changelog；保留既有知识页面、索引、锁、批处理和差分行为测试作为兼容性依据。

## 旧实现依赖变化

| 指标 | 第 230 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 181 | 175 | 0 |
| Tool 域旧依赖 | 0 | 0 | 0 |
| Knowledge 域旧依赖 | 6 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 181 | 166 | 0 |
| 旧 SDK 示例 | 0 | 0 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

Knowledge 域 6 条旧依赖和 `core/knowledge` 的 15 个旧实现文件已全部删除。新增 Runtime 包不存在到 `coding-agent` 的反向依赖；包边界守卫会拒绝旧目录、旧导入和旧 Manifest 子路径回流。

## 行为兼容性验证

- `runtime-knowledge` 9 个测试文件、67 项测试通过，覆盖页面写入、Frontmatter、标签、差分、索引、缓存重建、摄取决策、只读输入合同和失败记录。
- Runtime Tools 2 个测试文件、9 项测试通过，覆盖原生 `kb_write_page` 元数据、写入调用和能力 Tool 兼容性。
- Coding Agent 4 个测试文件、7 项测试通过，覆盖产品 Tool 组合、知识处理 Session/批次和公共子路径退役。
- Desktop/Canary 2 个测试文件、9 项测试通过，覆盖知识处理副作用与新旧差分结果。
- 重写治理和质量守卫 4 个测试文件、71 项测试通过；`bun run check:quick` 与完整 `bun run check` 均通过，Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫无错误。

## 尚未完成的替换

- 仍有 175 条生产代码到旧实现的精确依赖，目标为零；Knowledge 域已经归零，不应再次成为 Coding Agent 内部实现。
- 旧 `AgentSession` 仍持有三个知识 Tool 兼容入口；其工具行为已经由独立 Runtime 能力承载，但旧入口要随 Session/Tool 工厂退役一起删除。
- 明确登记的旧实现文件仍有 166 个，下一阶段应按剩余高依赖域选择可完整闭环的迁移对象，避免只移动类型或增加包装层。
- 8 个旧格式边界及其中 3 条旧实现依赖仍需独立审计；旧数据兼容必须与旧执行代码分离。
