# @vetta/runtime-tools

Runtime 拥有的通用 Agent 工具实现与 Coding Tools Feature。

包根和 `@vetta/runtime-tools/coding` 暴露同一套独立 Runtime 工具接口。

## 本包拥有

- 基于 TypeBox 的 Runtime Tool 定义
- `read`、`write`、`edit`、`bash`、`grep`、`find` 等通用工具实现
- 工具注册元数据、目录和场景选择
- 动态 `CodingToolsFeature`
- 工具执行依赖的 Port，例如可执行文件解析、路径策略和命令执行

## 本包不拥有

- Agent 会话与产品状态
- 应用权限 UI
- 模型与 Provider 选择
- 宿主可执行文件的下载和更新
- 产品级路径、凭证或用户交互策略

Runtime Tools 的生产代码、测试、配置和包清单均不得依赖 `@vetta/coding-agent`。
产品宿主在自己的组合根中实现并注入所需 Port。

## 主要入口

- 独立工具工厂，例如 `createReadTool`、`createBashTool` 和 `createTreeTool`
- `createCodingToolsFeature`
- 工具注册工厂，例如 `createReadToolRegistration` 和 `createLsToolRegistration`
- `InMemoryCodingToolRegistry`
- `selectCodingTools` 与 `selectCodingToolsForScope`

每个工具位于独立的 `src/coding/tools/<tool-name>/` 目录。模型可见描述放在工具目录的
`description.ts`，工具 Schema 使用 TypeBox，Coding 场景元数据放在注册对象而不是工具定义中。

## 组合示例

```ts
const registry = new InMemoryCodingToolRegistry([
	createCurrentTimeToolRegistration(),
	createReadToolRegistration(cwd, readOptions),
	createLsToolRegistration(cwd, lsOptions),
]);

createCodingToolsFeature({
	catalog: registry,
	activation: { mode: "scope", scope: "project" },
});
```

工具专有依赖属于注册组合根，不属于 `CodingToolsFeatureOptions`。例如宿主把自己的
`CodingToolExecutableResolver` 注入 grep/find；Runtime 只消费解析结果，不下载或更新二进制文件。

## 动态注册语义

Registry 支持 `register()` 和 `unregister()`。Feature 保持长期存在的模型调用贡献 Provider，
并在每次模型调用前读取最新的版本化工具成员关系，因此工具变化不会重建 Runtime Snapshot，
也不会重新初始化无关 Feature。

模型看到的工具会在执行前再次按当前 Catalog 解析。工具被移除时返回可恢复的工具错误；
同名工具替换不会把旧 Schema 的调用路由到新实现。下一次模型调用会收到更新后的工具列表。

## 行为兼容

架构迁移不得改变工具功能。Schema、描述、结果、错误、副作用、路径语义、取消和截断行为
由 Runtime 合同测试保护；`coding-agent` 只测试其真实 Host Port 适配，不作为 Runtime 测试依赖。
