# @vetta/runtime-tools

Vetta 平台无关的 Coding Tool 协议包。包根与 `@vetta/runtime-tools/coding` 暴露同一套合同。

## 本包拥有

- `CodingToolRegistration`、Scope、Category 与 Side Effect 元数据
- `CodingToolCatalog`、Registry、Turn-bound Binding 与 Revoke 语义
- 工具激活、选择、可用性校验和结果策略
- `CodingToolsFeature`、`CodingToolExecutableResolver`、命令进程、后台任务和前台命令 Operations Port

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
