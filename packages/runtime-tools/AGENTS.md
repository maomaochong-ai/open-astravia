# Team: Runtime

> 本包属于 Runtime 能力域，提供通用 Agent 工具实现与 Coding Tools Feature。

## 职责范围

工具实现位于 `src/coding/`，由包根和 `@vetta/runtime-tools/coding` 暴露。
产品宿主通过 Port 注入进程、路径和可执行文件等环境能力。

## 注意事项

- `src/index.ts` 只转发独立 Coding Tool API，不得增加产品兼容导出
- 每个工具位于独立的 `src/coding/tools/<tool-name>/` 目录
- 模型可见描述使用独立 `description.ts`
- Tool Definition 只表达执行能力；场景和分类元数据放在注册对象
- 新工具参数使用 TypeBox，并实现 `RuntimeToolDefinition`
- 工具不得持有 Session 或绕过 Runtime Tool Policy
- 架构调整必须保持 Schema、描述、输出、错误、副作用和路径语义
- 生产代码、测试、配置和包清单均不得依赖 `@vetta/coding-agent`
- 产品 Host 适配测试属于产品包；本包使用本地合同夹具验证 Port 行为

## 测试要求

- 使用 Vitest Node 测试，并在 Runtime Port 边界提供窄 fake；不得调用用户 shell、真实工作目录、网络或产品 Host 完成单元测试。
- 新增或修改 Tool 时必须覆盖输入 Schema、模型可见描述、成功输出、结构化错误、取消、路径边界和实际副作用合同；文件/进程工具使用临时目录或受控 fake 验证。
- Tool Policy、激活选择或注册变化必须覆盖允许、拒绝、不可用和重复名称等分支。产品级启用策略和宿主接线由 Coding Agent 或对应 App 的合同测试负责。
