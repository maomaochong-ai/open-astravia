# 第 260 阶段：Composition 公共边界治理

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

第 259 阶段完成 CLI Runtime Host 拆分后，`@vetta/coding-agent/composition` 成为 CLI 与 Desktop 直接使用的产品组合边界。初始引用统计显示 39 个导出中只有 14 个被生产代码直接导入，但进一步审计发现，很多未直接导入的类型仍构成公开类、工厂和回调的参数或返回合同，不能按引用数机械删除。

本阶段只移除能够证明是包内实现的 5 个符号，并冻结剩余 34 个完整公开签名。这样既收窄公共面，也避免为了追求较小数字破坏宿主可使用的类型合同。

## 实施内容

- 从 `composition/index.ts` 删除原始 Setup Seed 执行函数及其输入类型；CLI 继续使用拥有明确生命周期的 Seed Initializer 工厂。
- 从公共 Composition 入口删除 `CodingToolsRuntimeComposition`、Options 和创建工厂；这些对象仍是 `coding-agent` 组合根内部实现。
- 将 Coding Tools Composition 的 9 个行为用例从 `cli-app` 迁入 `coding-agent`，继续覆盖默认工具顺序、按场景激活、显式 fail-closed 工具和外部工具探测行为。
- 保留公开类和工厂签名所依赖的 Active Session、Runtime controls、Knowledge Processing 与 Session Host 合同；没有根据仓库内直接引用数删除必要类型。
- 重写进度守卫使用 TypeScript AST 收集 `composition/index.ts` 的具名导出，冻结 34 个允许项和精确基线。
- 守卫覆盖 CLI 测试，并禁止 Coding Agent 包外通过 `@vetta/coding-agent/composition/*` 深层导入实现。
- 未引入 TypeBox 或 Zod：本阶段校验的是 TypeScript 模块导出和静态依赖，不涉及不可信运行时输入。

## 旧实现依赖变化

- Composition 公共导出：`39 -> 34`。
- 仅由 CLI 测试维持的 Coding Tools Composition 公共入口：`3 -> 0`。
- 原始 Setup Seed 内部入口的公共导出：`2 -> 0`。
- Coding Agent 包外 Composition 深层导入：`0`。
- Coding Agent 旧实现文件、旧实现依赖、Runtime 反向依赖、compat 导出和旧执行入口继续保持 `0`。

重写进度守卫升级到 version 10。新增导出不能仅通过刷新 baseline 合法化；必须同时进入代码内的明确允许清单。删除既有稳定导出也会触发 stale baseline，要求变更者显式审查兼容性。

## 行为兼容性验证

- 迁移后的 Coding Tools Composition 定向测试：1 个文件、9 个测试通过。
- 重写治理测试：1 个文件、18 个测试通过。
- CLI 和 Desktop 独立类型检查通过。
- `packages/coding-agent` 全包测试：128 个文件通过、1 个文件跳过；890 个测试通过、17 个跳过。
- `packages/cli-app` 全包测试：34 个文件、185 个测试全部通过。
- 测试迁移前后两个包的通过用例总数保持 `1075`，没有删除行为场景。
- `bun run check:quick` 通过。
- 根 `bun run check` 通过，覆盖 Biome、monorepo、CLI、Desktop、Admin 类型检查和全部质量守卫。
- 实际架构扫描：Composition 公共导出 `34`，外部深层导入 `0/0`，旧实现相关指标继续全部为 `0/0`。

## 尚未完成的替换

- 包根 `src/index.ts` 仍以 245 行聚合 Extension、Compaction、Theme、Shell 和宿主工具；需要区分稳定 Extension/SDK 合同与内部便利导出。
- Composition 公共面仍包含 `Greenfield` 命名和具体宿主类。只有在定义了真实、可替换的宿主合同并迁移消费者后才能继续收窄，不能通过增加无行为价值的接口或别名完成数字优化。
- 下一阶段应审计包根每个导出的真实 Extension、SDK、示例和外部宿主需求，优先将稳定能力导向已有 `./sdk`、`./extensions` 等子路径，并为包根内部对象建立不可恢复的零目标守卫。
