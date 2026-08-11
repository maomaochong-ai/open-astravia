# 第 251 阶段：旧 Core 最终退役

## 阶段目标

在不改变 CLI、SDK、RPC、IM、Extension、Hook、图片预算、并发限制和公开子路径行为的前提下，删除 `packages/coding-agent/src/core` 的最后 11 个文件，并把生产代码到旧实现的 10 条依赖边收敛为零。

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

- `src/core` 不再是无边界的实现集合；每项保留行为都有明确所有者。
- `coding-agent` 继续提供现有包根 Event Bus、`./hooks` 和 `./concurrency` 公共入口，但入口只指向稳定职责模块，不再暴露深层 Core 路径。
- Hook 配置由 `ecosystem-adapter` 拥有，CLI 宿主直接依赖能力所有者；`coding-agent/hooks` 保留为外部消费者的稳定入口。
- 本阶段没有新增 TypeBox 或 Zod 校验边界；现有 Hook Tool 参数继续使用原 TypeBox schema，内部静态合同不重复做运行时校验。

## 本阶段实施内容

### 1. 收敛 Extension 合同与运行时

- Slash Command 类型统一使用 `extensions/infrastructure` 中的稳定合同，删除重复的 `core/slash-commands.ts` 和未使用的内置命令常量。
- 包根 `ReadonlyFooterDataProvider` 改为导出稳定 Extension 合同；删除没有生产消费者的旧 Git watcher 实现。
- 包根 `createEventBus`、`EventBus` 和 `EventBusController` 继续保留，但直接复用 `extensions/runtime/event-bus.ts`，新增测试固定订阅、取消、清理和监听器错误隔离语义。

### 2. 迁移真实横切行为

- Ecosystem Hook Tool 包装迁入 `extensions/runtime/ecosystem-hook-tool-wrapper.ts`，保留输入改写、附加上下文、前后置阻断、结果反馈、失败反馈、中止识别和事件顺序。
- `@vetta/coding-agent/hooks` 改指向 `public-api/hooks.ts`；旧公开签名保持不变。
- 图片预算迁入 `model-context/image-budget.ts`，保留“未看过图片不驱逐”、已看图片按最近顺序预算、占位文本和不修改原数组的语义。
- 并发限制器迁入独立 `concurrency` 领域，包根和 `@vetta/coding-agent/concurrency` 保持相同 API；新增 FIFO 与异常释放容量测试。

### 3. 删除无生产消费者的旧实现

- 删除只被结构性测试引用的旧 Keybindings Manager；Extension Runner 测试改用其真实输入合同 `ExtensionKeybindingsConfig`，继续验证可配置保留键、重绑定和多键冲突。
- 删除旧同步 Session Lock 及其内部测试。当前生产会话独占由 `runtime-storage` 的 `FileConversationOwnershipManager` 负责，并通过 ownership lease 行为测试验证冲突、恢复和释放。
- 删除没有输出调用方的旧启动 timing 累加器及两个无可观察效果的 `time()` 调用。
- 删除旧 `core/index.ts` 聚合入口和全部剩余 Core 文件。

### 4. 修正源码消费与测试入口

- 更新 package exports、根/CLI/Desktop TypeScript path maps 和 Vitest aliases，使 `hooks`、`concurrency`、`resources` 解析到新的稳定入口。
- CLI Greenfield Runtime Host 改为直接从 `@vetta/ecosystem-adapter` 取得 Hook 配置层构造器，避免通过产品包反向中转能力合同。
- 补齐 CLI Vitest 对已有 Host Services、HTML Export 和 Runtime Knowledge 源码入口的解析，使真实宿主测试不依赖残留 `dist`。

### 5. 建立旧 Core 零回流基线

- 重写基线现在记录 `oldImplementationEdges = 0`、`oldImplementationFiles = 0`。
- 现有治理脚本会扫描整个 `packages/coding-agent/src/core/`；重新创建任何文件、生产代码重新依赖该目录或恢复深层 `core/*` 包导出都会失败，不能通过普通基线变化静默恢复。

## 旧实现依赖变化

| 指标 | 第 250 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 10 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 11 | 0 | 0 |
| `src/core` TypeScript 文件 | 11 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 0 | 0 | 0 |
| 退役 Tool 路径/生成链引用 | 0 | 0 | 0 |

## 行为兼容性验证

- `coding-agent` 定向测试 9 个文件、43 项通过，覆盖并发限制、Event Bus、图片预算、Extension 快捷键、Slash Command、Model Call 消息最终化和 Hook Tool 全部关键语义。
- `runtime-storage` ownership lease 定向测试 1 个文件、4 项通过，覆盖当前会话独占实现。
- CLI 真实 Greenfield Runtime Host 测试 1 个文件、17 项通过，覆盖新建/恢复会话、迁移、Extension、Hook、资源重载和生命周期。
- `bun run check:quick` 通过；`bun run check` 的全仓 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫通过。
- 重写守卫当前报告：旧实现依赖边 `0/0`、旧实现文件 `0/0`、Runtime 反向依赖 `0/0`、兼容导出 `0/0`、深层 Core 导出 `0/0`。
- 额外执行的 `check:types:build-surfaces` 仍读取工作区中迁移前的 `dist` 声明，因本阶段按开发规则不执行构建而报告旧声明缺少当前导出；该结果未计为通过项，源码类型面已由标准 `bun run check` 覆盖。

## 尚未完成的替换

- 旧 `src/core` 与新生产代码到旧实现的替换已经完成，不再有待迁移的旧 Core 文件或依赖边。
- 全面重写仍保留 8 个明确登记的旧会话格式读取边界；它们只允许迁移历史数据，不能重新参与新会话执行。
- 下一阶段应进行最终架构验收：逐项审计这 8 个格式边界是否仍是必要迁移器，刷新独立构建产物后复核 build-surface 类型，并用安装产物执行 CLI 新建、恢复、动态 Extension/Skill/Tool 变化和会话持久化的端到端验证。
