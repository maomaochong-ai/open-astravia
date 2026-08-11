# 第 222 阶段：稳定 SDK 合同闭包与旧产品 Core 解耦

## 阶段目标

第 221 阶段已经用真实示例验证了稳定 SDK，但公共 Session 合同仍通过类型别名引用
`core/session/types.ts`。本阶段只修正类型和依赖边界，不改变包根兼容 API、模型调用、事件名称、Prompt 字段或工具执行语义：

1. Prompt、Session 事件和自定义工具使用独立公共合同；
2. `public-api/sdk/**` 不再导入 Coding Agent 内部源码；
3. 自定义工具继续保留 TypeBox、取消、进度、常用 UI、压缩、权限和渲染能力；
4. 旧包根 `createAgentSession()` 与完整 Extension API 保持不变；
5. 架构守卫和行为测试共同阻止类型泄漏回归。

## 实施前发现

### 稳定名称仍引用旧类型事实源

`CodingAgentPromptOptions`、`CodingAgentSessionEvent` 和 `CodingAgentSessionToolDefinition` 原先只是
`PromptOptions`、`AgentSessionEvent` 和 `AgentSessionCustomToolDefinition` 的别名。源码表面没有具体管理器名称，
但生成声明仍会引用 `../../core/session/types.js`，因此删除或移动旧 Core 会直接破坏稳定 SDK。

### 自定义工具存在传递泄漏

旧 `ToolDefinition` 的执行上下文包含 Session、Model 和 Extension 的具体对象，渲染回调也引用产品 Theme 与 UI
Component。原有边界测试只扫描公共源码中的禁用名称，没有检查类型别名继续指向内部文件，因此没有发现该问题。

### 新内核合同可以作为稳定依赖

Prompt 引用、附件、上下文占用、压缩结果、后台任务、Todo 和 Subagent 已在 `runtime-core` 中有中立合同。
`agent-core`、`ai` 和 `runtime-core` 是目标架构允许的基础依赖，不需要在 Coding Agent 中再次复制业务实现。

## 架构决策

### 公共合同按职责拆分

新增三个合同文件：

- `sdk-prompt-contract.ts`：Prompt 输入、资源引用、附件、来源与 metadata；
- `sdk-event-contract.ts`：Agent 内核事件与 Coding Agent 产品事件联合；
- `sdk-tool-contract.ts`：TypeBox 工具定义、窄执行上下文和结构化渲染合同。

`sdk-session-contract.ts` 只组合这些合同。公共 barrel 使用显式导出清单，不重新导出内部 Adapter。

### 工具上下文使用窄能力而不是具体管理器

`CodingAgentToolExecutionContext` 保留工具实际可用的常见能力：

- cwd、当前模型和空闲/队列状态；
- abort、shutdown、上下文占用、压缩和系统提示词；
- select、confirm、input、notify 等常用 UI；
- Ecosystem permission 请求。

它不公开具体 Session/Model 管理器或 Extension 注册表。Host Adapter 在执行时把现有完整 Extension Context
投影为该结构合同，运行时对象和调用顺序不变。

### 自定义渲染保持功能但解除实现类型

稳定工具合同继续支持 `renderCall` 和 `renderResult`。Theme 和 Component 改为公共结构接口，Host Adapter
用当前产品 Theme 调用这些回调。旧包根 ToolDefinition 仍走原兼容 Adapter，因此没有移除 UI 渲染功能。

### TypeBox 继续位于不可信工具输入边界

工具注册仍用 `TypeGuard.IsSchema` 检查 Schema，模型调用输入仍用 `Value.Check` 检查实际参数。Prompt、事件和
上下文都是同进程 TypeScript 值，不新增 Zod 或重复运行时 Schema。

## 实施内容

### 公共 API

- 新增 Prompt、事件和工具独立合同；
- Session 与创建合同改为导入同目录公共类型；
- `@vetta/coding-agent/sdk` 显式导出新增稳定类型；
- Prompt 的旧/新类型增加双向编译兼容约束，旧 Session 事件可赋给新事件联合；
- 编译期断言稳定工具上下文不存在具体 Session/Model 管理器属性。

### 产品 Host 与事件 Adapter

- 保留旧 ToolDefinition 的 `adaptCodingAgentSdkCustomTools()`；
- 新增稳定合同专用 `adaptPublicCodingAgentSdkCustomTools()`；
- 公共创建参数不再先伪装成旧 `customTools`，而是在产品 Host 边界独立适配；
- 初始注册与 `reconfigureCustomTools()` 都复用同一公共 Adapter；
- Runtime 执行观察映射函数直接返回稳定 `CodingAgentSessionEvent`。

### 架构守卫

公共 SDK 目录测试固定新的合同文件集合，并拒绝任何向两级以上内部相对路径的导入。根级
`legacy-execution` 守卫同步拒绝 `public-api/sdk/**` 回接 Coding Agent 内部产品源码，因此该约束不依赖测试套件才生效。
`sdk-compatibility` 产品 Core 预算同时从 2 收紧为 0，后续不能用“仍在预算内”重新引入内部依赖。

本阶段完成后，Greenfield 产品 Core 边从 95 条降为 94 条，其中 SDK 分类从 1 条降为 0 条：

| 分类 | 数量 |
| --- | ---: |
| product-adapter | 85 |
| composition-wiring | 5 |
| rpc-host-adapter | 4 |
| sdk-compatibility | 0 |

## 功能兼容性

本阶段没有：

- 修改包根 `createAgentSession()` 或旧 `AgentSession`；
- 修改 Prompt 字段、Session 事件名称或 payload；
- 修改工具 Schema、调用参数、Signal、更新回调或 Extension Context 的运行时对象；
- 修改工具 Overlay、Model Call Frame 或动态替换生效时序；
- 删除自定义工具渲染回调；
- 修改 Skill、MCP、压缩、存储或 Extension 业务实现。

## 测试与验证

- SDK 定向测试：4 个文件、17 项通过；
- 架构守卫单测：9 项通过；
- 根 `tsgo --noEmit -p tsconfig.json`：通过；
- `bun run check:quick`：通过；
- 根 `bun run check`：通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查与全部 guards；
- `legacy-execution` 报告：0 条执行边、8 个保留格式边界、94 条产品 Core 边，SDK 内部依赖为 0。

当前环境中 `bunx vitest` 的 Bun worker 分别出现 `File URL path must be an absolute path` 和
`port.addListener is not a function`。为避免把运行器兼容问题当作测试通过，最终使用工作区已安装的同一 Vitest Node
入口执行定向文件，并取得上述明确的测试数量和通过结果；没有修改 Vitest 配置。

## 阶段结论

稳定 SDK 现在形成了真正的声明闭包：公开类型只依赖同目录合同和目标架构允许的基础包，不再把旧 Coding Agent Core
路径写入调用方声明图。旧产品实现仍由 Host/Adapter 复用，因此这是依赖方向调整，不是功能重写。

下一阶段可以处理动态 Skill/Extension 的贡献与策略合同。应优先表达“贡献什么”和“何时刷新”，不能重新公开完整
Resource Loader、Extension factory 注册表或任意覆盖回调；认证和设置继续留在独立 Host Service。
