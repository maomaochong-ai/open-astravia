# 第 256 阶段：Runtime Host 公共出口退役

## 阶段目标

在不改变 CLI、Desktop、SDK、RPC、IM 的 Agent 功能与协议的前提下，删除 `@vetta/coding-agent/runtime-host` 和 `@vetta/coding-agent/runtime-host/greenfield` 两个过渡公共出口，使宿主和测试只依赖用途明确的稳定合同；同时验证运行中 MCP、Tool 与 Skill 资源变化仍能在后续模型调用中生效。

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

- 第 255 阶段已使生产宿主对 `runtime-host` 的直接依赖归零，本阶段继续删除仍可被外部使用的包导出、TypeScript/Vitest 别名和测试依赖，避免过渡入口重新成为事实公共 API。
- `runtime-host` 内仍被 Coding Agent 产品组合根使用的实现保留为包内私有实现；本阶段不把“公共出口退役”误解为删除有效功能。
- Tool 实现继续归属 `runtime-tools`；Coding Agent 只组合 Tool Source、MCP、Skill、资源和 Session 能力。
- 动态资源验证遵循 Turn 级装配原则：运行时变化在下一次模型调用前刷新，不冻结为 Session 级全量快照。

## 本阶段实施内容

### 1. 删除过渡公共出口

- 从 `packages/coding-agent/package.json` 删除 `./runtime-host` 与 `./runtime-host/greenfield` 两个 exports。
- 删除根 TypeScript、Desktop TypeScript、CLI/Desktop/Runtime Core/Runtime Storage Vitest 中专用于这两个出口的路径别名。
- 公共 API 测试显式断言两个子路径不再导出，防止后续误恢复。

### 2. 测试迁移到稳定合同

- CLI 与 Desktop 测试中的模型、MCP、Hook、Extension 和 Plugin 依赖迁移到 `host-services`、`runtime`、`hooks` 等用途明确的公共入口。
- Memory 与 Continuation 的实现级测试移动到 Coding Agent 包内，使内部实现测试留在实现所有者中。
- Runtime Core 的 Session Service 上层集成测试移动到 Coding Agent 包内，消除下层 Runtime Core 测试对上层 Coding Agent 的反向依赖。
- 子代理行为测试显式设置 `enableSubagents: true`，不再依赖宿主默认配置。
- MCP 提示词测试改为断言模型实际可见的公共文本与 Tool 合同，不再调用私有提示词渲染器生成期望值。

### 3. 保持动态 Skill 行为

- Session Resource Runtime 每次 Skill 更新都会重新考虑项目和用户默认 Skill 根目录，因此会话启动时尚不存在的 `.vetta/skills` 目录在后续创建后也能被发现。
- Resource Runtime 通过中性 `ResourceSettingsPort` 读取同一份 Settings Runtime，动态发现仍遵循原有禁用规则和项目级覆盖优先级。
- 新增同一会话内“目录缺失、创建、修改、删除”的测试，验证下一 Turn 的 Skill 投影依次为无、v1、v2、无。

### 4. 修正真实 CLI 验证边界

- Desktop 的 Vetta CLI canary 将工作目录修正为仓库根目录，使独立 CLI 进程通过真实 workspace 配置解析稳定 Coding Agent 子路径。
- canary 继续验证创建会话、继续会话和持久化会话列表，不以直接调用内部工厂替代产品入口。

### 5. 防回退质量门禁

- Package Boundary Guard 新增退役 `runtime-host` 子路径审查，覆盖源码/测试 import、TypeScript/Vitest alias 和 package exports。
- Quality Gate 增加反例，验证旧测试导入、旧别名和旧 manifest export 会失败，而稳定 `@vetta/coding-agent/runtime` 入口继续允许。
- Coding Agent 重写进度基线新增 Runtime Host export 指标，固定为 0。

## 旧实现依赖变化

| 指标 | 本阶段前 | 本阶段后 | 说明 |
| --- | ---: | ---: | --- |
| Coding Agent `runtime-host` 公共 exports | 2 | 0 | 删除两个过渡子路径 |
| 外部测试直接导入 `runtime-host` 的文件 | 20 | 0 | 改用稳定合同或移动到实现所有者 |
| Runtime Core 对 Coding Agent 的上层测试依赖 | 1 | 0 | 集成测试移动到 Coding Agent |
| 专用于退役子路径的 TS/Vitest alias | 存在 | 0 | 删除所有解析旁路 |
| CLI/Desktop 生产 `runtime-host` 导入文件 | 0 | 0 | 保持归零 |
| Legacy execution edge | 0 | 0 | 保持归零 |
| Runtime backedge | 0 | 0 | 保持归零 |
| Greenfield product-core edge | 0 | 0 | 保持归零 |
| 用户可见功能变更 | 0 | 0 | 仅修复动态 Skill 的既有行为 |

## 行为兼容性验证

- Coding Agent 组合与公共 API 定向测试：4 个文件，11 项通过。
- Coding Agent 资源加载测试：1 个文件，18 项通过，覆盖动态 Skill 创建、修改、删除、禁用覆盖和项目优先级。
- CLI 相关定向测试：11 个文件，35 项通过，覆盖 Subagent、动态 MCP、Plugin MCP、Extension、Hook、Todo 与 Session Host。
- Desktop 相关定向测试：6 个文件，25 项通过，覆盖模型调用帧差异、后端池、能力、历史行为差异和真实 Vetta CLI 会话 canary。
- 质量门禁定向测试：3 个文件，84 项通过。
- `bun run check:quick` 通过，确认 Runtime Host exports、外部 Runtime Host 导入、旧实现边和 Runtime 反向依赖均为 0。
- 根 `bun run check` 通过，覆盖全仓 Biome、根/CLI/Desktop/Admin 类型检查与全部质量守卫。

## 尚未完成的替换

- `runtime-host` 目录当前是 Coding Agent 产品组合根使用的包内实现，不再是公共 API；下一阶段应审计目录内的命名与职责，仅删除不再被组合根使用的文件，不能机械删除有效实现。
- `rpc` 公共入口仍包含部分 `GreenfieldRpc*` 命名，需要按“稳定协议合同”与“具体实现别名”分类后再收口。
- 仍需继续审计包内大聚合模块和实现命名，但不得以文件改名代替依赖方向与职责边界的真实改善。
