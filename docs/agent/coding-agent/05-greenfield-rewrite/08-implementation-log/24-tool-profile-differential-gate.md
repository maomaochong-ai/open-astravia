# Tool Profile 差分门禁与兼容导出审计

## 目标

验证过渡 Runtime Composition Root 在所有旧会话场景下都保持相同的工具可见性，并判断
`@vetta/runtime-tools` 包根兼容导出是否已经具备拆除条件。

## 修改范围

- 在 CLI Composition Root 测试中同时实例化旧 Tool Factory 和新 Tool Registration。
- 对旧系统 `ALL_SCENARIOS` 的 7 个场景逐一比较最终模型可见工具名。
- 保留已有的默认 CLI 和显式激活测试，覆盖空 scope 的 `find/ls`。
- 审计仓库内 `@vetta/runtime-tools` 包根消费者及根导出内容。

## 实施结果

当前迁移的 6 个工具在全部场景中差分为零：

- `current_time/read/glob/grep`：全部场景默认激活。
- `ls/find`：全部场景默认不激活。
- `ls/find`：通过显式激活可进入新 Model Call Contribution。

差分比较使用旧 `resolveActiveToolNames` 的实际结果和新 `CodingToolsFeature` 在模型调用时
生成的 Contribution，不只是静态比较 `scope_use` 与 `scopeUse`。

仓库内当前没有直接导入 `@vetta/runtime-tools` 包根的源码或测试，但该入口仍公开转发
`bash/edit/write/tree` 等未迁移工具。仓库内无消费者不代表可以破坏公共 API；直接删除根
导出还会让新 Profile 缺失功能。因此本轮没有修改或删除兼容导出。

## 明确未修改

- 没有切换旧 CLI、Desktop、RPC 或 IM 生产入口。
- 没有改变任何工具的名称、描述、Schema、输出、错误或副作用。
- 没有扩大 `ls/find` 的默认 scope。
- 没有删除 `@vetta/runtime-tools` 包根公共 API。
- 没有把尚未迁移的旧工具伪装成已完成。

## 验证

在 `packages/cli-app` 运行：

```text
bunx vitest --run test/runtime-tools-composition.test.ts
```

结果：1 个测试文件、9 个测试全部通过，其中 7 个参数化用例分别覆盖全部旧会话场景。

## 下一步

先按行为合同迁移完整 Profile 中缺失的工具，优先处理会阻断 Coding 基本闭环的进程执行和
文件修改能力。每个工具继续遵循“旧行为 Oracle、独立 Runtime 实现、真实 Tool Loop”三层
门禁。完整 Profile 差分为零后，再设计包根兼容入口的弃用或子路径迁移，不提前删除旧能力。
