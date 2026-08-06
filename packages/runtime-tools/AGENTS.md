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
