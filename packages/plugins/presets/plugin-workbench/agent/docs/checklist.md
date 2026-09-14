# 极简速查（细节以全文手册为准）

**完整开发手册**：随工程的 `@vetta-org/plugin-sdk` 装在它自己的 `node_modules` 里。
先拿路径：`node <workbenchRoot>/agent/cli/vetta-plugin-cli.js docs --json` → `manualDir`。

创建/改插件前请按 skill 要求用 read 打开（相对 `manualDir`）：

1. `README.md`
2. `getting-started.md`
3. `manifest.md` + `permissions.md`
4. 按扩展点：`ui-slots.md` / `conversation-and-agent.md` / …

## 最小可安装

- `plugin.json` + `dist/mf-manifest.json` + remoteEntry
- 起工程：内置 CLI `init`
- 构建：`scripts/build-and-pack.mjs`
- 安装：面板「应用到 Vetta」（不弹审批 sheet）

## 用户工程依赖

`@vetta-org/plugin-sdk` / `@vetta-org/plugin-vite` 使用 **registry semver**，禁止 `workspace:*`。
