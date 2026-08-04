# 插件工作台（plugin-workbench）

系统插件：帮助用户通过对话 + 面板自举 Vetta 用户插件。

## Agent 文档（关键）

完整插件开发手册内嵌于包内（生产 App 不带 monorepo `docs/plugin`）：

```text
agent/docs/plugin/     ← 与仓库 docs/plugin 同源
```

- **Desktop 构建会自动同步**：`packages/desktop-app` 的 `bun run build:presets` / `build:presets:dev`（dev 与 dist 都走）在构建前调用 `scripts/sync-plugin-docs.mjs`，把 monorepo `docs/plugin` 拷进本包；一般**不必**再手跑 sync。
- 本地单独构建本包时：`bun run sync-docs` 或 `prebuild` 仍会跑。
- Skill：`agent/skills/plugin-workbench/SKILL.md` 强制 agent 先 `read` 上述手册再实现。
- 索引：`agent/skills/plugin-workbench/references/doc-index.md`

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/scaffold.mjs` | 脚手架 |
| `scripts/build-and-pack.mjs` | bump + npm install + build + `vetta-plugin pack` |
| `scripts/check-manifest.mjs` | 委托 `vetta-plugin validate` 校验清单 |
| `scripts/sync-plugin-docs.mjs` | 同步 docs/plugin |

## 硬隔离

输入栏「插件工作台」toggle 默认关；关闭时本插件 skills / prompt / Activity Tab 不暴露（ADR-0041）。

## 相关 ADR

- ADR-0041 插件贡献硬隔离
- ADR-0042 install-from-path + 安装时授权
