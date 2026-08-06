# Team: Coding Agent

> 本包是产品组合层。上接 CLI、Desktop、IM 等宿主，下接 AI、Agent Core 和各 Runtime 能力域。

## 职责范围

负责产品级 Runtime Composition Root、会话宿主、资源与扩展编排，以及 Runtime Port 的产品适配。
通用 Kernel、工具、存储、MCP、知识库、子 Agent 和观测实现分别由对应 Runtime 包拥有。

## 关键模块

- `src/composition/`：产品 Composition Root 与会话装配
- `src/adapters/`：Runtime Port 的产品宿主实现
- `src/session/`：会话产品行为与历史格式边界
- `src/extensions/`：扩展合同、加载和产品编排
- `src/configuration/`：配置读取与边界校验
- `src/resources/`：Skill、提示词和上下文资源发现
- `src/public-api/`：稳定子路径入口
- `src/modes/rpc/`：RPC 产品适配

## 依赖方向

- Apps 可以依赖本包公开入口
- 本包可以依赖 `@vetta/runtime-*`、`@vetta/ai` 和 `@vetta/agent-core`
- Runtime 包的生产代码、测试、配置和包清单不得依赖本包
- 应用不得深度导入本包内部文件

## 实施约束

- 架构重写必须保留既有功能行为，不能以删功能换取结构收敛
- 不得恢复旧执行入口、双执行路径、Legacy 回退或迁移转发器
- 工具实现属于 `runtime-tools`；本包只提供进程、路径、下载等 Host Port 适配
- MCP 协议与通用生命周期属于 `runtime-mcp`；本包只组合产品 OAuth、路径和交互
- Conversation Repository 属于 `runtime-storage`；本包只决定会话产品流程
- 动态能力在模型调用边界读取最新目录，不创建长期冻结的全局能力快照
- TypeBox 用于工具 JSON Schema；外部配置和边界数据按现有约定使用 Zod 或专用解析器
- 新增公开导出前必须确认真实跨包消费者，并同步更新公开面守卫
- 修改组合、会话提交或回滚语义时必须覆盖成功、失败、中止和释放路径

## 验证

- 定向测试位于 `test/`
- 快速反馈使用仓库根目录 `bun run check:quick`
- 完成一轮代码变更后运行仓库根目录 `bun run check`
- 跨宿主行为使用仓库 Agent Host 验证脚本，不新增临时旧架构入口
