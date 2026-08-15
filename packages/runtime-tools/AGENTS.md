# Team: Runtime

> 本包属于 Runtime 能力域，提供平台无关的工具协议与 Coding Tools Feature。

## 职责范围

协议、共享 Schema、注册元数据、Catalog、激活选择和纯状态逻辑位于 `src/coding/`，由包根和
`@vetta/runtime-tools/coding` 暴露。访问环境的工具实现位于 `@vetta/runtime-node/coding`；包含产品
规则但不访问环境的工具由对应产品包拥有。

## 注意事项

- `src/index.ts` 只转发独立 Coding Tool API，不得增加产品兼容导出
- 不得导入 `node:*`、平台 Runtime、文件系统、进程、网络或宿主全局状态
- Tool Definition 只表达执行能力；场景和分类元数据放在注册对象
- Catalog、激活与选择逻辑不得持有 Session 或绕过 Runtime Tool Policy
- 架构调整必须保持注册、激活、绑定、撤销和结果策略语义
- 生产代码、测试、配置和包清单均不得依赖 `@vetta/coding-agent`
- 具体工具与 Host 适配测试属于平台 Runtime；本包验证平台无关合同

## 测试要求

- 使用 Vitest Node 测试，并在 Runtime Port 边界提供窄 fake；不得调用用户 shell、真实工作目录、网络或产品 Host 完成单元测试。
- 注册、激活选择、可用性、绑定租约或结果策略变化必须覆盖允许、拒绝、不可用、撤销和重复名称等分支。
- 具体 Tool 的 Schema、描述、输出、错误、取消、路径和副作用合同由对应平台 Runtime 测试覆盖。
