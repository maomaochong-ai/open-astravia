# ADR-0171：从外部应用打开改用宿主外部应用能力（与上游的形态差异）

## 状态

已接受。对应 ADR-0157 登记表 B11 的 `8h4q`、`r6ne`、`cttc`。

## 背景

上游 `40b803e70` 的做法是：插件自己 `command.run("open", ["-Ra", appName])` 静默探测
应用是否安装，从而「始终列出全部应用、没装的置灰」。这套做法有三个前提：探测命令可用、
应用清单由插件维护（Finder / VS Code / Cursor / Zed / Xcode / Terminal）、平台只有 macOS。

本仓落地时宿主已经有了更底层的能力：`apps/desktop/src/main/external-apps.ts` 按平台
（macOS 的 LaunchServices、Windows 的注册表 shell verb、Linux 的 `.desktop` 条目）
枚举**本机真实可用来接手某个目录的应用**，并通过 `ctx.shell` 暴露给插件：
`listExternalApplications` / `openPathWithApplication` / `openPathWithDefaultApplication`，
权限 `shell.open-external-app`，Plugin API `2.10.0`。

如果插件仍自己拼 `open -Ra`，同一个「本机装了哪些能开目录的应用」会有两份实现，
且 Windows / Linux 上只能置灰一长串永远不可用的条目。

## 决策

1. **插件只用 `ctx.shell`，不自建探测与启动路径。** 菜单内容是宿主实际找到的应用
   （宿主按目录语义筛过），末尾固定一格「用系统默认应用打开」走
   `openPathWithDefaultApplication`。
2. **因此不存在「列出全部应用、未安装的置灰」这一形态。** 宿主只回报可用应用，
   置灰逻辑无处可挂。这是**有意的形态差异**，不是漏做：在只有 macOS 的世界里
   「全列 + 置灰」能让用户知道「这个应用我该去装」；在跨平台枚举下它变成一串平台
   永远不支持的噪音，且置灰项的图标还取不到。
3. 菜单项上限沿用宿主对顶栏动作的硬上限 20 项，应用列表留一格给「默认应用」，
   避免恰好 20 个应用时把默认项静默裁掉（`header-actions/normalize.ts` 的
   `raw.slice(0, 20)`）。
4. 插件权限只声明 `ui.slot.header-action` 与 `shell.open-external-app`；
   `ctx.command.appIcon` 不再使用（宿主在应用枚举里已经带上图标）。
5. 激活清理只释放本次登记的那份 `ctx.shell` 接口（`releaseHostApis` 比对同一对象），
   不无条件清空——与 `cttc` 同一条约束，热重载时新激活可能先于旧清理完成。

## 备选方案

- **照抄上游的 `open -Ra` 探测**：功能等价但只对 macOS 成立，且在宿主已有跨平台枚举后
  属于第二份事实源。
- **保留「全列 + 置灰」，由插件维护跨平台应用清单**：清单要随每个平台的安装路径变化维护，
  且「装没装」在多平台上的判据各不相同（注册表 verb / `.desktop` 条目 / bundle 是否存在）。
- **让宿主也回报「已知但未安装」的应用**：宿主没有「已知应用」的概念，它的枚举就是
  文件系统事实；为了置灰而在宿主里内置一份候选清单，等于把产品判断塞进能力层。

## 后果

- 正面：一个跨平台的应用枚举与启动实现；插件只有菜单组装逻辑；Windows / Linux 上不是
  一串死条目；图标来自宿主同一处。
- 代价：与上游的行为不完全一致——用户在本仓看不到「未安装的应用」（上游能看见但点不了）。
  这一条要写进 ADR-0157 的状态列，不能记成「已对齐」。
- 兼容性：依赖 Plugin API `2.10.0`，旧宿主打开该插件时按版本拒绝（明确报错，不是静默失效）。
- 已知限制：远程（`ssh://`）项目不显示该动作——远端目录不在这台机器上，交给本机应用打开
  没有意义。

## 验证

- `packages/plugins/presets/open-in-app/test/`：宿主未回报应用时动作返回 `null`（不占位）、
  应用列表 + 末尾默认项的顺序、经宿主打开、SSH 与无 cwd 返回 `null`、`releaseHostApis`
  不误清新接口、20 项上限下默认项存活；`bun run test` 实测 15 条通过。
- 插件清单实校：`parsePluginManifest` 对 `pluginApiVersion ^2.10.0` 与两个权限通过。
- 打包：`bun run build` 产出 `.astraviapkg`，归档内 `plugin.json` 版本一致；
  `tenants.json` 的 development / production 都含 `open-in-app`，`prepare-pack.js` 按
  profile 解析自动带上（非显式枚举）。
