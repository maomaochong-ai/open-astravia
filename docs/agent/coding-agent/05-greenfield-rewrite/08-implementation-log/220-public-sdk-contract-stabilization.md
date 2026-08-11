# 第 220 阶段：公共 SDK 合同去迁移化与边界固化

## 阶段目标

第 219 阶段已经提供 `@vetta/coding-agent/sdk`，但公开 Session 类型仍间接使用迁移期命名，且
`public-api/sdk` 同时存放公共合同与内部 Adapter、Binding。本阶段只整理架构边界：

1. 公共 SDK 类型全部使用稳定的 `CodingAgent*` 命名；
2. 迁移期实现退出公共 API 目录；
3. 公共入口只导出产品合同、创建函数、诊断与错误；
4. 增加自动守卫，阻止迁移名称和具体管理器重新泄漏；
5. 保持包根兼容工厂和全部 Session 行为不变。

## 实施前发现

### 公开类型仍是迁移类型别名

`CodingAgentSession` 原先只是内部活动 Session 类型的别名。Session 的模型循环、工具信息、统计、Memory、Bash、
树导航等返回类型也继续使用迁移期名称。调用方虽然可以正常使用，但声明文件和编辑器提示仍会暴露内部迁移术语。

### 公共目录混入运行时实现

`public-api/sdk` 原先同时包含：

- 创建合同和 Session 合同；
- 固定 Session Adapter；
- 活动 Session Adapter；
- Runtime Binding；
- 执行观察事件映射。

这会让公共合同目录同时承担 API、Adapter 和 Composition 三类职责，也使内部 barrel 容易意外重导出运行时实现。

## 架构决策

### 公共合同使用独立稳定命名

公共 Session 合同现在显式定义：

- `CodingAgentSessionCore`；
- `CodingAgentSessionCapabilities`；
- `CodingAgentActiveSessionCapabilities`；
- `CodingAgentSession`；
- Prompt、事件、工具、模型、统计、Memory、Bash、Session setup 和树导航等配套 `CodingAgent*` 类型。

公开创建合同直接引用这些稳定类型，不再通过迁移期类型别名构造公共 API。

### 内部 Runtime Port 留在 Composition

内部固定 Session Port、活动 Session Port 和 Runtime Session Port 迁移到
`composition/greenfield-sdk-runtime-contract.ts`。该文件允许保留迁移期命名，因为它只服务内部 Adapter 和
Composition，不属于 package 公共子路径。

为降低纯架构调整的行为风险，内部合同使用类型别名连接稳定公共值类型，既有实现逻辑没有复制或重写。

### Adapter 与 Binding 回到所属层

- 固定/活动 Session Adapter 和事件映射移动到 `adapters/runtime-core`；
- Runtime Binding 移动到 `composition`；
- `public-api/sdk` 只剩公开 barrel、创建合同和 Session 合同。

### 公共入口使用显式导出清单

`@vetta/coding-agent/sdk` 的运行时导出固定为：

- `createCodingAgentSession`；
- `CODING_AGENT_SESSION_CREATE_ERROR_CODES`；
- `CodingAgentSessionCreateError`。

其余均为显式类型导出。内部 Adapter、Binding、Runtime Port 和事件映射不再经过公共 barrel。

## 质量守卫

新增两层保护：

1. SDK 包测试检查公共目录只包含三个合同文件，并固定运行时导出 allowlist；
2. 根级 `legacy-execution` 守卫扫描 `public-api/sdk.ts` 与 `public-api/sdk/`，拒绝迁移期名称以及
   `ModelRegistry`、`ResourceLoader`、`SessionManager`、`SettingsManager` 等具体管理器。

内部事件 Adapter 移入 `adapters/runtime-core` 后，一条既有产品 Core 依赖从 `sdk-compatibility` 重新分类为
`product-adapter`。依赖总数仍为 95：adapter 从 84 变为 85，sdk 从 2 变为 1，Composition 和 RPC 数量不变。
因此本阶段只修正依赖归属，没有增加产品 Core 依赖。

## 功能保持

本阶段没有：

- 切换或包装包根 `createAgentSession`；
- 删除旧 `AgentSession` 或具体管理器；
- 修改模型调用、Prompt、Skill、MCP、工具、压缩、存储、Extension 或 Subagent 行为；
- 改变 memory/file-create/file-resume 语义；
- 引入 TypeBox 或 Zod。当前变化仍是进程内 TypeScript 合同，不需要新增运行时 Schema。

## 测试与验证

验证结果：

- SDK 定向测试：7 个文件、44 项测试通过；
- 架构守卫单测：9 项测试通过；
- `bunx tsgo --noEmit`：通过；
- `bun run check:quick`：通过；
- 根级 `bun run check`：通过；
- 架构守卫报告：0 条旧执行边、8 个保留格式边界、95 条产品 Core 边。

仓库规则禁止直接运行构建命令，因此没有生成或覆盖 `dist`。

## 阶段结论

`@vetta/coding-agent/sdk` 现在具备独立、稳定且不包含迁移术语的公共类型面；迁移实现已回到 Adapter 和
Composition 层。下一阶段可以开始迁移官方 SDK 文档和示例，并通过真实消费者决定是否需要补充会话目录与资源注入的
窄公共 Port。在完成消费者迁移前，包根兼容工厂继续保留。
