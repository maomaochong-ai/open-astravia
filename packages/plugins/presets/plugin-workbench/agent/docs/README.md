# 工作台 Agent 文档

| 路径 | 内容 |
| --- | --- |
| [checklist.md](./checklist.md) | 极简速查 |
| `../cli/vetta-plugin-cli.js` | 内置的插件 CLI（构建期从 `@vetta-org/plugin-cli` 产物拷入） |

**插件开发手册不在这里。** 它随 `@vetta-org/plugin-sdk` 装进被编辑工程自己的 `node_modules`，
因此与该工程实际编译的 SDK 版本一致。拿路径：

```bash
node "<workbenchRoot>/agent/cli/vetta-plugin-cli.js" docs --json
```

Agent 请从 skill `plugin-workbench` 进入，索引见 `agent/skills/plugin-workbench/references/doc-index.md`。
