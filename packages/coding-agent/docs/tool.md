# 内置 Tool

实现归属 **`@vetta/runtime-tools/coding`**。`coding-agent` 只做产品组合、宿主适配与激活策略，不定义/再导出具体 Tool 工厂。

## 新增 Tool

在 `packages/runtime-tools/src/coding/tools/<name>/`：

| 文件 | 内容 |
|------|------|
| `description.ts` | 模型可见描述常量 |
| `*-tool.ts` | TypeBox schema、Tool 定义、Operations 端口 |
| `registration.ts` | scope、capability、category、order |
| `index.ts` | 工具局部公开面 |

- 可依赖 Runtime 合同与注入的 Operations；**禁止** import `coding-agent`。
- 从 `packages/runtime-tools/src/coding/index.ts` 导出；产品组合根注册到动态 catalog。
- 注册/移除影响后续模型调用，不重建整个 Runtime；进行中的调用保持已绑定能力。

## 模型侧投影

Tool Definition 是执行合同，不应为了产品 UI 或模型提示而在每个工厂重复追加宿主字段。Coding Agent 会在
Plugin、MCP、Extension 与 Catalog Tool 完成组合后，通过 `RuntimeToolProjectionPipeline` 生成最终模型侧副本。

- 可选的调用级 `description` 由产品默认投影统一提供，Tool 无需声明或向下透传。
- Tool 确实拥有同名业务参数时，显式 Schema 优先，不会被默认字段覆盖。
- 模型专用参数会先按最终 Schema 校验，再映射回原 Tool 输入；原 validator/handler 无需感知。
- 需要读取外部配置的投影通过 `bindForTurn()` 固定快照；更新从下一 Turn 生效。
- 工具增删使用 Catalog，执行配置使用 `withCodingToolConfiguration()`，权限使用 Tool Policy；这些职责不进入投影链。

新增其它模型侧变化时，在 `runtime-tools` 的受限投影合同上实现小型 Projector，并在 Coding Agent 产品策略中装配，
不要增加贯穿各个工具工厂、MCP 或 Plugin 注册链的通用 Options。

## 替换旧实现

合同测试覆盖：name/label/description/schema、scope/requires、结果与错误文案、取消/进度/副作用、CLI/SDK/RPC 激活。旧代码仅可作测试 oracle，验证后删除。

```bash
bun scripts/quality/run-vitest.mjs --run packages/runtime-tools/test/coding/<tool-name>.test.ts
```
