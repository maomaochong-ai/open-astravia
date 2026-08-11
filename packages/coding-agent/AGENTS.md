# Team: Coding Agent

> 本包是 Coding Agent 的产品组合层。所有修改必须同时服从仓库根 `AGENTS.md`；本文件只补充本包的架构与长期演进约束。

## 架构定位

`@vetta/coding-agent` 上接 CLI、Desktop、IM 和 SDK 等宿主，下接 AI、Agent Core 与各 Runtime 能力域。它负责把稳定合同和独立能力组合成 Coding Agent 产品，但不拥有这些能力的通用底层实现。

本包拥有：

- 产品级 Runtime Composition Root 与默认 Profile。
- Session 创建、恢复、切换、提交、回滚和释放的产品编排。
- Prompt、Skill、MCP、Plugin、Memory、Compaction 和工作状态的产品策略与能力装配。
- Runtime 事件、Port 与宿主服务之间的产品适配。
- SDK、RPC、历史会话等稳定产品入口。

本包不拥有：

- 模型 Provider 协议与流式实现，属于 `@vetta/ai`。
- Agent Kernel、Turn Pipeline 和通用 Port，属于 `@vetta/runtime-core` / `@vetta/agent-core`。
- 通用 Coding Tool 实现，属于 `@vetta/runtime-tools`。
- Conversation Repository，属于 `@vetta/runtime-storage`。
- MCP 协议、传输和通用生命周期，属于 `@vetta/runtime-mcp`。
- 通用知识库、Subagent 和观测实现，属于对应 `@vetta/runtime-*` 包。
- CLI、Desktop 或 IM 自身的进程入口、UI 和传输协议。

## 依赖方向

- Apps 只能依赖本包在 `package.json#exports` 中声明的公开入口，不得深度导入 `src/`。
- 本包可以依赖 `@vetta/runtime-*`、`@vetta/ai` 和 `@vetta/agent-core`；这些下层包不得反向依赖本包。
- `runtime-contracts/`、`composition/contracts/` 和其他合同文件不得依赖 Composition、Host、Adapter 或 Public API 实现。
- 产品能力域不得依赖 `composition/` 实现、`adapters/` 或 Public API facade。
- Adapter 可以依赖稳定合同，但不得反向控制 Composition，也不得复制 Runtime 域实现。
- `src/core/`、`src/compat/` 和旧执行入口属于退役架构，不得恢复。
- 历史格式兼容只能位于 `sessions/legacy/` 等明确的数据边界，不得成为活动 Agent 执行路径。

## 关键目录

- `src/composition/`：产品 Composition Root、Session 装配和生命周期事务。
- `src/composition/contracts/`、`src/runtime-contracts/`：稳定产品合同与依赖倒置边界。
- `src/sessions/`：会话产品语义、投影、迁移和历史格式隔离。
- `src/extensions/`、`src/plugins/`、`src/resources/`：扩展、Plugin、Skill 和 Prompt 的产品域。
- `src/model-context/`、`src/compaction/`、`src/memory/`、`src/work-state/`：产品级上下文与工作状态策略。
- `src/mcp/`：Coding Agent 的 MCP 路径、OAuth 和宿主组合；通用 MCP 实现仍属于 `runtime-mcp`。
- `src/adapters/`、`src/host/`：Runtime Port 的产品适配和有副作用的宿主实现。
- `src/public-api/`：稳定公开入口；入口文件只导出，不承载业务实现。

## 编码前必须分析

非平凡修改不得直接开始写实现。先完成以下分析，并在工作计划或实施说明中给出结论：

1. **目标与不变量**：明确要改变的行为、必须保持的旧功能、错误/取消/并发/释放语义，以及可验证的完成标准。
2. **职责所有者**：确认代码应属于 Coding Agent 产品策略、Runtime 通用能力、Host Adapter 还是具体 App；位置不对时先调整设计，不在错误层级补丁式实现。
3. **变化点**：识别真正可能变化的维度，例如 Provider、存储、策略算法、宿主环境或动态能力，而不是假设所有代码未来都会替换。
4. **候选方案**：至少比较当前直接方案与一个合理替代方案，说明依赖方向、复杂度、兼容风险和测试成本；优先选择能满足当前需求的最简单方案。
5. **抽象与模式**：说明是否需要设计模式。使用时写清它解决的变化点；不使用时保持直接、局部和可读的实现。
6. **验证策略**：在编码前确定单元、合同、差分或宿主测试分别验证什么，行为修改必须先有可运行的失败场景或明确基线。

若需求存在多个会显著改变合同或用户行为的解释，应先向用户说明，不得静默选择。若只是局部、无分支、无外部边界的简单修改，可以简化上述记录，但仍须确认职责位置和验证方式。

## 设计原则

### 面向长期迭代

- 围绕稳定职责组织模块，不围绕一次需求、页面或临时调用者组织代码。
- 稳定合同与易变实现分离；业务语义通过领域类型表达，不使用通用 `Record`、字符串约定或共享 metadata 隐藏依赖。
- 组合优于继承。具体实现只在 Composition Root 选择，领域代码依赖窄 Port。
- 动态 Tool、MCP、Skill、Plugin 和 Prompt 在模型调用边界读取最新状态；不要把可删除、可注册的能力冻结成长期全局快照。
- Turn 级一致性绑定只固定本次执行需要稳定的对象，不阻止后续调用观察合法的运行时变化。
- ConversationDocument 和持久化事件是 canonical 事实；上下文裁剪、图片预算和 microcompact 应优先实现为模型调用视图的纯投影。
- 公共合同按兼容方式演进；需要破坏性变化时，使用显式版本和迁移器，不以双执行路径或永久 Adapter 掩盖迁移。
- 一次架构修改只解决一个清晰问题。不要顺带重写无关模块或改变用户可观察功能。

### 可维护性与易读性

- 一个文件只承担一个可描述的职责；入口文件保持薄，只做注册、导出和装配。
- 当文件要求读者同时理解多个独立状态、协议或副作用时，按职责拆分，而不是仅按代码行数机械拆分。
- 使用能表达领域含义的文件和类型名称，避免新的 `Manager`、`Service`、`Helper`、`Utils` 或 `Common` 大杂烩。
- 控制函数和构造参数规模。配置项属于哪个对象就由哪个对象拥有，不把所有依赖汇总成不断增长的 Options 对象。
- 副作用集中在 Adapter/Host 边界；选择、校验、状态转换和投影逻辑尽量保持纯函数并独立测试。
- 错误使用稳定类型或判别联合表达；不要依赖解析自然语言错误文本决定控制流。
- 不通过注释解释混乱结构。先改善命名、职责和控制流，只为非显然约束保留简短注释。

## 设计模式使用准则

设计模式是解决已识别结构问题的工具，不是代码质量指标。只有当模式能减少耦合、明确所有权或稳定真实变化点时才使用。

适合本架构的常见模式：

- **Strategy**：Compaction、上下文裁剪、重试、Tool Result 投影等存在可替换产品策略时使用。
- **Ports and Adapters / Adapter**：隔离文件系统、进程、网络、模型、存储、MCP SDK、Legacy 格式和宿主 API。
- **Composition Root / Factory**：集中选择具体实现、组装依赖和定义资源所有权；Factory 不得隐藏全局状态。
- **State Machine**：Session、Turn、取消、切换、关闭和资源生命周期存在合法状态迁移时使用。
- **Typed Pipeline**：固定的 Turn 阶段需要有序编排时使用；不要开放可任意修改共享上下文的万能 Middleware。
- **Repository**：会话持久化需要原子追加、版本、分支和恢复等领域语义时使用，不退化为通用键值存储。
- **Registry/Catalog**：动态能力需要注册、撤销、revision 和在途执行仲裁时使用；读取面与修改面应分离。
- **Decorator**：在不改变 Tool/Port 核心实现的前提下增加 Hook、观测、权限或结果策略时使用。
- **Observer**：观察已发生事件且失败不得影响主流程时使用；Observer 不得修改 Turn 结果。
- **Anti-Corruption Layer**：适配旧格式或第三方协议时使用，转换结果必须进入当前稳定领域合同。

以下情况通常不要引入模式或接口：

- 只有一个实现、没有外部边界且测试不需要替换的局部逻辑。
- 简单计算、规范化、排序或状态转换可以由命名清晰的纯函数完成。
- 只是为了减少几行重复，或为了“以后可能需要”而增加 Factory、Builder、事件总线或插件系统。
- 用抽象隐藏尚未理解的业务差异，或让调用者依赖大量可选参数和运行时约定。

新增抽象后必须能够回答：它稳定了哪个合同、隔离了哪个变化点、删除它会造成什么真实耦合。无法回答时，使用更直接的实现。

## 执行与动态能力约束

- Turn 使用固定阶段的 Typed Pipeline；Tool Loop 是 Execution 阶段内的循环，不得伪装成一次性线性 Stage。
- 不引入公开的 `next()` Middleware 让任意 Feature 修改 messages、tools、instructions 或终止结果。
- 新上下文来源使用 Context Provider；模型调用级动态能力使用 Contribution Provider；上下文预算使用 Context Strategy；权限使用 Tool Policy；非关键后处理使用 Observer。
- Feature 不得持有可变 Session 内部对象，不得通过共享对象互相通信，不得静默覆盖同名 Tool 或资源。
- 注册、移除或替换动态能力必须定义下一次模型调用何时可见，以及在途调用如何完成、拒绝或取消。
- 失败、取消和关闭必须沿 `AbortSignal` 与生命周期合同传播；资源创建与释放必须成对并可在部分初始化失败时回滚。

## 功能兼容与数据边界

- 当前工作是架构演进，不是功能重写。Tool Schema、描述、结果、错误、副作用、路径语义和事件顺序必须保持，除非用户明确批准行为变化。
- 不得通过删除功能、降低校验、吞掉错误或回退旧执行路径修复架构问题。
- 旧实现只能作为行为 Oracle 或显式数据迁移输入，不能被新生产代码调用。
- 来自模型、磁盘、网络、MCP、Plugin、Extension 或 RPC 的数据必须在首次进入领域边界时运行时校验。
- Tool 参数和需要发送给 Provider 的 JSON Schema 使用 TypeBox；复杂外部配置在确有 preprocess/transform 需求或既有约定时使用 Zod；已经校验的内部对象只使用 TypeScript 合同，不重复维护两套 Schema。
- Schema 只验证结构，Session 身份、事件顺序、版本和权限等领域不变量由明确代码验证。

## 测试要求

- 行为修改必须随代码提供测试；架构重构必须通过现有行为测试或差分测试证明功能未变。
- 纯策略、选择、校验和状态转换优先使用表驱动单元测试。
- Port、协议、Schema、公开 API、持久化事件和 Tool 输入输出使用合同测试。
- Session、Composition 和生命周期修改至少覆盖成功、失败、中止、部分初始化回滚和最终释放。
- 动态能力修改至少覆盖新增、删除、替换、未变化、在途执行和下一模型调用可见性。
- 跨 CLI、Desktop、IM 的真实环境行为使用现有 Agent Host 验证入口，不新增临时执行路径或硬编码超时绕过问题。
- 测试断言可观察合同，不锁定私有类、文件布局、偶然调用顺序或实现细节。

从仓库根目录执行：

```bash
bun run check:quick
bunx vitest --run <相关测试文件>
bun run check
```

`bun run check` 不运行测试；定向测试和完整质量门禁都必须单独执行。文档或注释修改无需为了形式新增测试，但必须运行适当的格式和链接检查。

## 完成前审查

提交结果前逐项确认：

- 代码是否位于正确所有者，依赖方向是否单向。
- 是否存在更简单且同样满足需求的实现。
- 使用的抽象或设计模式是否对应真实变化点，而非形式化包装。
- 是否引入重复事实源、隐藏全局状态、万能 Options 或新的大文件职责混合。
- 是否保持原有功能、动态能力语义和数据兼容性。
- 测试是否覆盖本次决策和失败路径，而不只是覆盖代码行。
- `bun run check:quick`、相关测试和代码变更后的 `bun run check` 是否全部通过。

固定重写目标见 [`REWRITE-CHARTER.md`](../../docs/agent/coding-agent/05-greenfield-rewrite/08-implementation-log/REWRITE-CHARTER.md)。架构守卫以 `scripts/quality/check-coding-agent-architecture.mjs` 和包边界守卫为准。
