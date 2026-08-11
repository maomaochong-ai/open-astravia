# 第 262 阶段：Extension 独立产物入口闭环

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

第 261 阶段把包根收口为 Extension 作者门面，但独立可执行产物只验证了不依赖 Vetta 公共模块的外部 Extension。普通 RPC 测试又把 Jiti 打进单文件 `.mjs` 后交给外部 Bun 执行，这不是实际发布形态，并在 Windows 上稳定触发 Bun 段错误，掩盖了真正需要验证的公共入口兼容性。

本阶段把测试责任重新对齐：普通 RPC 产物只验证运行时行为，真实 `bun build --compile` 安装产物负责验证零外部依赖和外部 Extension 加载。功能与协议不变。

## 实施内容

- 为独立产物中的 Extension 虚拟模块补齐 `@vetta/coding-agent/extensions`，与包根共享同一稳定 Extension facade。
- 扩展现有 installed-artifact 回归：外部 TypeScript Extension 同时从包根和 `./extensions` 子路径导入并执行 `createEventBus`，之后继续验证事件、工具、命令、原生会话创建、恢复和不兼容失败。
- 普通 RPC 测试 bundle 将 Jiti 保持为外部测试依赖，并把临时文件放入 `node_modules/.cache`；这避免测试一个不发布的 bundled-Jiti `.mjs` 组合。
- installed-artifact 的 metafile 断言继续要求发布二进制外部导入为 `0`，因此测试夹具的 external 设置不会降低真实产物的独立性要求。
- 未引入 TypeBox 或 Zod：新增边界是静态模块标识映射，输入集合由代码定义，不需要运行时结构校验。

## 旧实现依赖变化

- Coding Agent 生产代码仅增加一个稳定 Extension 公共子路径映射，没有新增旧实现文件或旧实现依赖。
- 包根仍只转发 Extension 门面；SDK、RPC、Host、Resource 等领域仍通过显式子路径公开。
- Runtime 反向依赖、compat 导出、旧执行入口和旧实现依赖目标继续保持 `0`。

## 行为兼容性验证

- 修复前，真实安装产物加载同时导入包根和 `./extensions` 的 Extension 后缺少已注册命令，回归测试失败；补齐子路径虚拟映射后通过。
- installed-artifact Extension Profile 定向测试通过：1 个测试通过，12 个未命中筛选而跳过。
- RPC Runtime selection 全文件通过：11 个测试通过；Extension 事件、工具、命令、UI-only 能力和前向不兼容失败均保持原行为。
- Coding Agent Resource Loader 与 Extension Runner 定向测试通过：2 个文件、38 个测试通过。
- CLI 全包测试通过：34 个文件、185 个测试通过；此前 bundled-Jiti `.mjs` 引发的 Bun 段错误和临时目录 `EBUSY` 级联均未再出现。
- 独立安装产物仍由真实编译二进制运行，且 metafile 外部导入断言保持为 `0`。
- `bun run check:quick` 通过；重写扫描中旧实现文件、旧实现依赖、Runtime 反向依赖、compat 导出和旧执行入口继续全部为 `0/0`，包根非 Extension 导出为 `0/0`。
- 根 `bun run check` 通过，覆盖 Biome、monorepo、CLI、Desktop、Admin 类型检查和全部质量守卫。

## 尚未完成的替换

- Composition 公共面仍需按消费者证据继续收窄；本阶段不提前修改该边界。
- Extension loader 仍需要 Jiti 支持外部 TypeScript 与虚拟依赖。是否进一步抽成独立模块执行端口，应由跨运行时需求和可替换实现测试驱动，不能只为规避测试运行时缺陷新增抽象。
- 普通 RPC 测试 bundle 不是发布物，后续不得用它替代 installed-artifact 的独立性验证。
