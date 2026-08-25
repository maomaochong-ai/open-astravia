# @vetta/runtime-tools

Vetta 平台无关的 Coding Tool 协议包。包根与 `@vetta/runtime-tools/coding` 暴露同一套合同。

## 本包拥有

- `CodingToolRegistration`、Scope、Category、Side Effect 与可选 Configuration 关联元数据
- `CodingToolCatalog`、Registry、Turn-bound Binding 与 Revoke 语义
- 工具激活、选择、可用性校验和结果策略
- `CodingToolsFeature`、`CodingToolExecutableResolver`、命令进程、后台任务和前台命令 Operations Port
- 不访问环境的并发执行 Gate
- 可选的 Coding Tool Catalog 观测 Publisher；仅发布操作、工具名与版本，不发布撤销原因或调用内容
- Turn-bound Configuration Decorator；组合原生或 Legacy Tool 的既有 binding/release，而不要求所有 Tool 实现配置协议

本包不拥有具体工具、TypeBox 输入 Schema、模型可见工具描述，也不访问文件系统、进程、
网络、Electron 或宿主全局状态。Node 环境中的 `read`、`write`、`edit`、`bash`、
`grep`、PDF/OCR 与子进程实现由 `@vetta/runtime-node/coding` 提供。

## 组合示例

```ts
const registry = new InMemoryCodingToolRegistry(platformRegistrations);

createCodingToolsFeature({
	catalog: registry,
	activation: { mode: "scope", scope: "project" },
});
```

平台 Runtime 创建具体 Registration 并注入 Host Port；产品组合根只选择平台实现与产品策略。
普通 Registry 变化只影响后续 Turn，活动 Turn 使用已租赁的稳定 Binding；显式 hard revoke
会使旧 Binding 失效并协作取消在途执行。

Tool 配置是可选能力：没有配置项的 Tool 保持原注册路径；可修改定义的 Tool 使用 `native`，
旧实现通过 `adapter` 在执行边界转换，无法修改的 MCP/黑盒 Tool 可由 Host 使用 `host-policy`
控制暴露、输入整形或执行策略。三种方式都使用 `withCodingToolConfiguration()` 捕获同一个
Turn 配置快照，并与 Tool 自身的 lease 一起释放；Registration 元数据只负责发现，不进入模型 Schema。
