# 第 238 阶段：Resource Package Lifecycle 与 Session Resource Runtime 重写

## 阶段目标

在不改变资源功能的前提下，把旧 `core/package-manager.ts` 与 `core/resource-loader.ts` 拆解为独立合同、资源包生命周期、纯资源投影、会话资源状态和宿主组合根；迁移全部生产调用方并删除两个旧实现文件，不保留转发壳。

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

资源发现和安装是围绕 Agent 内核组合的能力，不应成为 Session 内核或单个 Manager 的内部细节。本阶段没有把两个大类原样搬到 `resources`，而是按变化原因拆成资源来源、文件投影、外部副作用、生命周期和 Session 状态五组模块。`resources` 领域只依赖窄端口；具体 `SettingsManager` 只在产品 Host Composition Root 绑定。

## 实施内容

### 1. 资源来源与生命周期合同

- 新增 `resources/contracts/resource-source.ts`，定义设置快照、资源来源、解析结果、路径元数据、进度事件、命令端口和 npm Registry 端口。
- 新增 `resources/packages/source-spec.ts`，独立处理 npm、Git、SSH、HTTPS、本地路径、安装位置和来源身份归一化。
- 新增 `resources/packages/package-effects.ts`，封装子进程执行、npm 版本查询、HTTP 错误和十秒超时。
- 新增 `resources/packages/package-lifecycle.ts`，处理 npm/Git 安装、删除、普通更新、强推恢复、无 upstream 更新和临时 Git 刷新。
- 新增 `resources/packages/package-source-runtime.ts`，只负责编排设置来源、缺失来源策略、生命周期、投影与进度通知。

### 2. 纯资源发现与投影

- `resource-discovery.ts` 负责 ignore、symlink、manifest、约定目录、多文件 Extension 入口和向上扫描 `.agents/skills`。
- `resource-patterns.ts` 负责 include、exclude、force-include、force-exclude；路径先归一化为跨平台形式，Windows 与 POSIX 行为一致。
- `resource-projection.ts` 负责 package manifest、约定目录、顶层设置、自动发现、项目优先级和启用状态，不执行网络或命令。
- 项目资源目录统一使用 `CONFIG_DIR_NAME`，测试不再写死历史 `.pi`。

### 3. Session Resource Runtime

- 新增 `resources/contracts/resource-runtime.ts`，以 `SessionResourceRuntime` 表达 Session 只需要的资源读取、扩展路径、reload 和 Skill 指纹刷新能力。
- `resources/runtime` 分别持有 Context、Theme、Extension、资源元数据、Skill/Prompt 状态和总编排。
- Extension Event Bus 由 Session Runtime 在构造时持有，重复 reload 不会悄悄替换总线。
- 系统提示词、追加提示词、覆盖函数、Extension 冲突、动态 Skill/Prompt/Theme 贡献和路径元数据行为保持不变。

### 4. 宿主组合与调用方迁移

- `host/coding-agent-resource-runtime.ts` 是唯一的产品组合位置，负责把 `SettingsManager` 与默认命令、Registry、资源包 Runtime、Session Resource Runtime 连接起来。
- CLI、SDK、Host Bootstrap、Greenfield Prompt/Extension Adapter 和 Desktop Skill Service 全部切换到新合同。
- `@vetta/coding-agent/resources` 改为显式 `public-api/resources.ts`；desktop TypeScript path map 同步指向源码入口。
- 包根不再导出 `DefaultPackageManager` 和 `DefaultResourceLoader`，测试验证这两个旧内部对象不会重新暴露。
- 删除 `core/package-manager.ts` 与 `core/resource-loader.ts`，没有兼容转发文件。

## TypeBox / Zod 判断

本阶段只在持久化 `package.json#pi` manifest 这一外部、不可信输入边界使用 TypeBox。Schema 保留未知字段兼容，同时要求四类资源条目为字符串数组。内部已类型化的端口、路径和运行时状态不再重复做运行时校验，因此没有引入 Zod，也没有把校验散布到业务编排中。

## 行为兼容性验证

- 原有 PackageManager 测试改为验证 `ResourcePackageRuntime` 公共合同；来源解析和身份归一化直接验证纯函数，不再通过 `as any` 耦合私有方法。
- 命令、npm Registry 和失败路径使用显式端口注入，测试不会为了制造错误而访问真实不存在的 npm 包。
- 保留本地 Git 仓库测试，验证普通更新、多提交、detached HEAD、强推、完整历史重写、固定 ref、临时来源和 scope-aware update。
- 保留 Session 资源行为测试，覆盖 Skill、Prompt、Theme、Context、系统提示、Extension 冲突、覆盖函数与动态贡献。
- 本阶段 8 个定向测试文件共 114 项全部通过。
- 完整 coding-agent 包回归执行结果为 1095 项通过、45 项跳过、51 项失败；失败集中在 9 个本阶段未改动行为的既有测试文件，主要是 Windows 路径/Shell 假设、旧 `.pi` 断言、缺失内置模型数据、图片 fixture 和既有初始化 profile 漂移。它们不影响本阶段 113 项资源行为基线，但仍是仓库测试债务，不能记为全包通过。
- 根 `check:types`、`check:quick` 与完整 `bun run check` 全部通过；完整检查包含 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 旧实现依赖变化

| 指标 | 第 237 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 118 | 107 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 146 | 144 | 0 |
| 兼容包导出 | 0 | 0 | 0 |

本阶段删除两个旧大文件并移除所有 `package-manager`、`resource-loader` 生产依赖。资源宿主组合新增一条到现有 `SettingsManager` 的显式依赖，因此净减少 11 条旧依赖边；稳定 `resources` 领域本身仍保持零 `core` 回接。该宿主依赖将在 Settings 域重写时一起消除，不应下沉或隐藏到资源领域。

## 尚未完成的替换

- 全仓仍有 107 条生产代码到旧实现的依赖和 144 个旧实现文件，最终目标尚未完成。
- 当前最大剩余域是 Session（17）、SessionManager（14）与 SettingsManager（10）。下一阶段应优先重写 Settings 读取、合并、持久化与变更观察合同，使资源 Host Composition Root 不再依赖旧 `SettingsManager`；不要继续扩展 Session 旧类。
- 旧文档和只记录历史 API 的说明不作为新架构约束；后续阶段继续只新增实施记录，不反复改写既有过程文档。
