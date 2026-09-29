# 脚本（scripts）

随 Vetta Desktop 发布的系统插件。在项目会话的底部面板里列出可运行的脚本，点一下就在内置终端里跑。

- 递归扫描会话目录下所有 `package.json` 的 `scripts` 与 `Makefile` / `makefile` / `GNUmakefile` 的目标，monorepo 的每个子包各成一组。
- 不进入 `node_modules`、`.git`、`dist`、`build` 等宿主默认忽略的目录，另外跳过 `vendor`、`bower_components`、`Pods`。
- 包管理器从脚本所在目录往上找：先看 `packageManager` 字段，再看锁文件（`bun.lock(b)`、`pnpm-lock.yaml`、`yarn.lock`、`package-lock.json`），都没有按 npm。
- 再点同一个脚本会切回上次为它开的终端，不会重复起 dev server；行尾的按钮总是新开一个终端。
- 命令敲进用户自己的 shell，本地与 `ssh://` 远程项目都能用。

权限：`ui.slot.bottom-panel`、`terminal.run`、`fs.read`，要求 Plugin API `^2.8.0`。

```bash
bun run build   # 生成 dist/ 与 release/scripts-<version>.vettapkg
bun run test
bun run check
```
