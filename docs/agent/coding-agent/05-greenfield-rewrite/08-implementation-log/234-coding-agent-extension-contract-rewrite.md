# 第 234 阶段：Coding Agent Extension 合同与事件协议重写

## 阶段目标

在 `coding-agent` 包内建立稳定的 `src/extensions` 领域，承接 Extension 对外合同、事件协议、UI 结构类型、会话视图和宿主动作绑定。Extension 属于 Coding Agent 的产品能力，不新建 workspace 包；本阶段只替换边界和依赖方向，不重写动态发现、模块加载、Runner 调度或 Tool 拦截行为。

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

Extension 是围绕 Agent 内核组合 Tool、事件、资源和宿主交互的产品协议，不应由旧 `core/extensions` 目录同时承担公共类型、UI 类型、Loader、Runner 和 Wrapper。新领域以结构合同表达宿主能力；具体 `SessionManager`、`ModelRegistry`、EventBus 和 Tool 实现留在组合/适配侧。

本阶段没有把 Loader、Runner 或 Wrapper 直接改名搬入新目录。三者仍是下一阶段待替换的旧运行时岛；新目录只持有可以独立于旧实现存在的合同和绑定逻辑，并由绝对质量守卫禁止重新导入 `core/*`。

## 实施内容

- 新增 `src/extensions/contracts.ts`，保留既有 Extension API 名称、事件联合、TypeBox ToolDefinition 和注册协议。
- 新增 `infrastructure.ts`，用结构类型描述 EventBus、exec、footer、键位、Slash Command 和 User Bash 结果。
- 新增 `session-contracts.ts`，定义 Extension 只读会话视图、写入端口和事件需要的 Session Entry 值合同；旧 `setup(SessionManager)` 回调继续保持可赋值。
- 新增 `ui-primitives.ts`，承接已经退役 TUI 后仍由 RPC/Desktop 和 HTML export 使用的最小 UI 结构。
- 新增 `runtime-bindings.ts`，原位绑定 Loader 创建的共享 Runtime，保持 Extension factory 长期保存 API 对象的语义。
- Tool 事件输入和详情改为复用 `@vetta/runtime-tools/coding` 的独立类型；Tool 名称、Schema、结果和拦截顺序不变。
- 生产消费者切换到 `src/extensions`；删除旧 `core/extensions/types.ts`、`ui-types.ts` 和 `execution-host.ts`，不保留转发文件。
- 重写进度守卫新增绝对规则：`src/extensions` 即使被写入基线，也不得依赖旧 `core/*`。

## 旧实现依赖变化

| 指标 | 第 233 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 148 | 128 | 0 |
| Extensions 域旧依赖 | 26 | 6 | 0 |
| Tool 域旧依赖 | 0 | 0 | 0 |
| Knowledge 域旧依赖 | 0 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 156 | 153 | 0 |
| 旧 SDK 示例 | 0 | 0 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

Extension 旧依赖从 26 条降到 6 条。剩余 4 条指向旧 Runner，另外 2 条是包根和公共 Extension façade 对旧运行时聚合入口的兼容导出；稳定 `src/extensions` 自身到旧实现的依赖为零。

## 行为兼容性验证

- 迁移前 15 个 Extension/Greenfield 定向测试文件、93 项测试通过，冻结事件、命令、工具、压缩和资源发现行为。
- 迁移后 Extension、Greenfield、SDK 定向测试中的 17 个文件、108 项测试通过；覆盖动态加载、Runner、input、tool_call/tool_result、命令、压缩、分支、运行时控制、SDK 自定义工具和 Session 切换。
- 重写治理测试 7 项通过，证明稳定 Extension 合同即使被写入统计基线也不能重新依赖旧实现。
- `bun run check:quick` 与全仓 `bun run check` 通过；Extension 合同不再含 `any`、inline type import 或旧 `core` 导入。
- 额外执行 `resource-loader.test.ts` 时有 5 项既有 `.pi`/`.vetta` 目录断言偏差；本阶段未修改资源加载逻辑，不以改变实现来迎合该无关结构断言。

## 尚未完成的替换

- 仍有 128 条生产代码到旧实现的精确依赖，目标为零；当前高依赖域为 Session 17、Session Manager 14、Resource Loader 9、Settings Manager 9、Model Registry 8 和 Extensions 6。
- 旧 `core/extensions/loader.ts`、`runner.ts`、`wrapper.ts` 与聚合 `index.ts` 仍存在；下一阶段应按 discovery/loading、event dispatch、tool interception 三个职责重写，不能整体搬迁。
- 包根与 `public-api/extensions.ts` 仍为旧 Extension 运行时保留兼容导出；只有新运行时行为闭环后才能删除，不能提前造成 Extension 动态加载或事件功能退化。
- Session Entry 值合同当前为兼容 JSONL 形状；未来 Session 领域重写时应收敛为稳定 Session 合同，并由独立旧格式迁移器读取历史数据。
