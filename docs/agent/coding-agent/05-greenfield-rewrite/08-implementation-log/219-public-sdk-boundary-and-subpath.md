# 第 219 阶段：公共 SDK 边界与独立子路径

## 阶段目标

本阶段把已经闭合的 Greenfield SDK 能力提升为正式、独立的产品 API，同时避免立即替换旧根入口：

1. 增加 `@vetta/coding-agent/sdk` 公共子路径；
2. 公共命名不再携带 Greenfield 迁移术语；
3. 创建参数只接受值对象、存储意图和窄宿主能力；
4. 创建结果不暴露 Extension Runtime 或产品管理器；
5. 通过真实 memory/file-resume 生命周期验证新入口；
6. 包根 `createAgentSession`、CLI 和 Desktop 行为保持不变。

## 实施前问题

### Greenfield 工厂位于错误的公共入口

`createGreenfieldAgentSession` 只能从 `@vetta/coding-agent/bootstrap` 使用。Bootstrap 是宿主装配入口，不应成为
普通 SDK 消费者的依赖路径。

### 创建合同仍继承 Legacy 对象图

候选工厂为了兼容迁移继续接受旧 `CreateAgentSessionOptions`，其中包含 `SessionManager`、`SettingsManager`、
`ModelRegistry`、`ResourceLoader` 等具体对象。直接公开该签名会把已从 Session 门面移除的对象重新泄漏到创建边界。

### 创建结果暴露 Extension Runtime

候选工厂返回旧 `LoadExtensionsResult`。该对象除错误列表外还包含 Extension 实例和可变 Runtime，不适合作为公共
SDK 结果合同。

## 架构决策

### 双入口迁移

新增 `@vetta/coding-agent/sdk`，公开 `createCodingAgentSession`。新入口使用产品名称，内部仍委托现有 Greenfield
Host Adapter 和 Composition Root。

包根旧 `createAgentSession` 不改名、不包装、不切换返回类型。需要旧具体管理器注入的调用方继续使用兼容入口，
新消费者使用独立 SDK 子路径。

### 公共创建合同只描述意图

`CreateCodingAgentSessionOptions` 包含：

- cwd、agentDir、模型、思考等级、场景和模式等值对象；
- memory/file-create/file-resume 三类原生存储意图；
- 按名称选择的内置工具和 Session 私有动态工具；
- Prompt、Skill、Memory、MCP、Subagent、Tracing 和 Plugin 配置；
- 实时用户提问等窄宿主能力。

合同不包含 Auth、Model、Settings、Resource 或 Session 具体管理器。产品 Host Adapter 负责把值对象转换成既有产品
实现，再装配 Runtime Composition。

### 工具选择停留在产品边界

公共 API 接受 `activeTools: string[]`。Host Adapter 使用当前 cwd 创建内置工具目录并校验名称，然后把实际工具定义
交给既有 Greenfield 工具激活逻辑。未知名称抛出稳定的 `coding_agent_sdk_invalid_active_tool` 错误，不进入 Kernel。

动态自定义工具继续沿用第 214 阶段的 Session 私有注册和 TypeBox 输入校验。

### 创建结果使用只读诊断

`CreateCodingAgentSessionResult` 只返回：

- 稳定 `CodingAgentSession`；
- 脱离 Extension Runtime 的只读诊断数组；
- 可选模型回退提示。

Extension 加载错误投影为 `extension_load_failed` 诊断，调用方无法获得 Runner、Extension Runtime 或内部注册表。

### TypeBox/Zod 决策

本阶段新增的是进程内 TypeScript 创建合同和已判别的存储意图，没有新增 JSON/协议输入，因此不增加 TypeBox 或
Zod。存储目标继续由既有解析器做语义校验；不可信的自定义工具调用输入继续使用 TypeBox。

## 实施记录

### 公共 API

- 新增公共创建合同、Session 产品别名、存储目标、提问能力、诊断和创建错误；
- 新增 `createCodingAgentSession` 薄入口；
- `package.json` 增加 `./sdk` 的 JS 和声明文件导出目标；
- 公共子路径测试明确要求新工厂与根入口旧工厂不是同一引用。

### 产品 Host Adapter

- 保留 `createGreenfieldAgentSession` 兼容包装；
- 抽出共同的内部创建过程；
- 新入口把公共值对象适配为产品装配输入；
- 原生存储目标直接进入 Greenfield SDK Factory，不再构造 Legacy `SessionManager`；
- Extension 具体结果只在 Host Adapter 内部存在，对外只投影错误诊断；
- 无模型错误映射为稳定的公共 SDK 错误代码。

### 编译期边界

测试通过 `@ts-expect-error` 固定以下成员不能进入新创建合同：

- `sessionManager`；
- `resourceLoader`；
- `modelRegistry`。

若未来误把这些属性加入公共接口，类型检查会因未使用的 `@ts-expect-error` 失败。

## 测试与验证

测试覆盖：

- memory Session 创建和关闭；
- file-create 写入及 file-resume 恢复；
- 创建结果不含 `extensionsResult`；
- Session 不暴露产品管理器；
- Extension 加载失败只返回脱离 Runtime 的诊断；
- 未知内置工具在产品边界拒绝；
- 包导出目标和双入口关系；
- 既有 Host Adapter、活动 Session 和兼容清单回归。

验证结果：

- 定向测试：5 个文件、36 项测试通过；
- monorepo `tsgo --noEmit`：通过；
- `bun run check:quick`：通过；
- 根级 `bun run check`：通过。

仓库规则禁止直接执行构建命令，因此本阶段没有生成或覆盖工作区 `dist`。导出目标由 manifest 测试、源码子路径测试、
完整类型检查和 standalone 架构门禁共同验证；独立发布产物的实际安装验证应在正式发布流水线执行。

## 刻意保留的边界

- 包根旧 `createAgentSession` 和 `AgentSession` 仍存在；
- 旧 SDK 文档和示例本阶段不迁移；
- 需要具体管理器注入的高级兼容场景没有伪装成新公共合同；
- 新 SDK 暂不从包根重导出，调用方必须显式选择 `@vetta/coding-agent/sdk`；
- 之前的方案文档不更新，本文件只记录本阶段实际实施过程。

## 阶段结论

Coding Agent 现在拥有一个独立、无 Legacy 管理器泄漏的正式 SDK 入口。下一阶段应迁移官方示例和文档，并用这些
真实消费者识别仍需补充的窄 Port；在消费者迁移完成前，不应切换或删除包根兼容工厂。
