# 插件工作台（plugin-workbench）

系统插件：帮助用户通过对话 + 面板自举 Vetta 用户插件。

## Agent 文档（关键）

**手册不在本包里。** 它随 `@vetta-org/plugin-sdk` 装进被编辑工程自己的 `node_modules`，
因此与该工程实际编译的 SDK 版本一致——随 App 发版的内嵌副本做不到这一点，而且等于把同一批
知识维护两遍。

工作台内置 `@vetta-org/plugin-cli` 的单文件产物，由它解析手册位置：

```bash
node <workbenchRoot>/agent/cli/vetta-plugin-cli.js docs --json
```

- **构建期自动内置**：`scripts/bundle-cli.mjs`（`prebuild` 钩子；`apps/desktop` 的 `build:presets`
  会先构建 `plugin-cli` 再调它）。产物在 `agent/cli/`，已 gitignore。
- 内置而不是 `npx`：工作台是系统插件、随 App 发版，内置让版本关系确定，也不受首次拉包的网络影响。
- Skill：`agent/skills/plugin-workbench/SKILL.md`；索引：`references/doc-index.md`。
- 起工程用 CLI 的 `init`，它会同时落一份 `AGENTS.md`——在 Vetta 外用别的 Agent 打开这个工程时，
  那份是唯一的说明书，与本 skill 同源。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/build-and-pack.mjs` | bump + npm install + build + `vetta-plugin pack` |
| `scripts/check-manifest.mjs` | 委托 `vetta-plugin validate` 校验清单 |
| `scripts/bundle-cli.mjs` | 内置 plugin-cli 产物到 `agent/cli/` |

## 硬隔离

输入栏「插件工作台」toggle 默认关；关闭时本插件 skills / prompt / Activity Tab 不暴露（ADR-0041）。

## 相关 ADR

- ADR-0041 插件贡献硬隔离
- ADR-0042 install-from-path + 安装时授权
