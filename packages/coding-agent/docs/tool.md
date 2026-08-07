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

## 替换旧实现

合同测试覆盖：name/label/description/schema、scope/requires、结果与错误文案、取消/进度/副作用、CLI/SDK/RPC 激活。旧代码仅可作测试 oracle，验证后删除。

```bash
cd packages/runtime-tools
bunx vitest --run test/coding/<tool-name>.test.ts
```
