---
status: accepted
---

# 插件 i18n：NLS `%key%` 占位符 + 宿主加载 sidecar catalog + locale 跟随宿主

desktop 自身 i18n 已落地（[[0031-desktop-i18n-i18next-semantic-keys-main-owned-language]]），但插件系统（preset 系统插件 + external 外置插件）面向用户的文案全是裸字符串、不随宿主语言切换。本 ADR 定义插件 i18n 的承载形态、加载/同步路径与 SDK 表面。一旦定型，`%key%` 约定与 SDK i18n API 即成为第三方插件的对外契约，极难回退，故记此 ADR。

范围：**全套**——`plugin.json` 静态文案 + 插件运行期组件文案。**排除** agent 面向串（`registerTool` 的 description、`agent.systemPrompt`、skills），它们是喂给模型的，比照 [[0031-desktop-i18n-i18next-semantic-keys-main-owned-language]] 的「发给 LLM 的不抽」一致保持原样。

## 决定

- **承载 = NLS 占位符 + sidecar catalog（VSCode `package.nls.json` 风格）**：宿主渲染的插件串里用 `%key%` 占位，真正译文放插件包内 `locales/<lang>.json`（扁平 `key → 译文`）。否决「字段内联 `{zh,en}` map」——它改变字段类型（现有插件全是裸串，需兼容）、且无法与运行期组件文案共用同一套 catalog。与 0031「语义 key + 独立 catalog」哲学一致。
- **`%key%` 是全局统一 marker**：贯穿 `plugin.json` 全部用户可见字段（`name` / `description` / `contributes.settings[].title|description` / enum option label / `guidingWords`）、`ctx.ui.register*()` 的 `label`、以及任何**由宿主渲染**的插件串。宿主检测到 `%...%` 即查 catalog，否则当字面量——**向后兼容现有裸串**。插件**自己** React 组件内渲染的文字不走占位符，直接用 SDK 的 `t()` / hook。
- **一套 catalog 服务两端**：同一份 `locales/<lang>.json` 同时供 manifest 占位符解析与运行期组件 `t()` 消费。
- **宿主加载 catalog，而非插件自带 i18next**：manifest 在 **main 进程**解析（`parseManifest`），故 catalog 必须由 main 读取；main 加载插件时**一次读齐全部语言**，作为 `InstalledPlugin` 的一部分**一次性**送到 renderer。切语言不再发 IPC、renderer 本地切。否决「插件 bundle 自带 i18next + 自 import catalog」（与 manifest catalog 重复加载、样板多、不统一）与「插件 catalog 注册进宿主 i18next namespace」（耦合紧、污染宿主实例、跨 MF 版本风险）。
- **运行期 SDK 表面**：`ctx.i18n.t(key, params?)` / `ctx.i18n.locale` / `ctx.i18n.onChange(listener)`，外加 React hook `useTranslation()`（返回 `{ t, locale }`，locale 变即重渲染，沿用 `useActiveConversation` 的 globalThis store 模式）。解析、`{{param}}` 插值与 fallback 由 **SDK 内一个轻量 resolver** 完成，**不**把 i18next 拉进插件运行时、**不**污染宿主 i18next 实例。
- **locale 跟随宿主、全程实时**：插件「当前语言」永等于宿主当前语言（语言 SoT 仍是 main 的 `desktop-config.json`，见 0031）。宿主切语言时三类文案全部实时重渲染、**无需 reload / 不重跑 `activate`**：插件 React 组件（经响应式 hook）、manifest 派生展示（catalog 已在 renderer，展示处响应式解析）、`register*` 的 `%key%` label（宿主存原始 `%key%`，渲染时按当前 locale 解析、locale 变则重渲染）。
- **fallback 链**：当前 locale → 插件 `defaultLocale` catalog → 裸 key（去掉 `%`，作为开发期缺译信号）。插件不强制覆盖宿主全部语言，但须保 `defaultLocale` 完整。
- **manifest 声明**：catalog 路径固定为 `locales/<lang>.json`（不可配）；支持语言由实际存在的文件推断；`plugin.json` 加一个可选 `defaultLocale` 字段，省略则默认 `zh`（与宿主 fallback 一致）。
- **加载期校验**：`%key%` 引用了 catalog 不存在的 key → `pluginLog.warn` 告警但**不拒载**（回退裸 key）。
- **落地节奏**：建机制（SDK + 宿主解析/传输 + 打包拷贝 `locales/`）的同时，把 `presets/` 下全部系统插件的用户可见文案一次迁成 `%key%` + `locales/{zh,en}.json`。

## 关键取舍

**宿主加载 catalog，刻意不让插件自带 i18next。** 表面上「插件自包含 i18n」更解耦，但 manifest 必须在 main 解析、main 本就要读 catalog；再让插件 bundle 自带一套 i18next + 自 import json，等于同一份译文加载两次、且 manifest 与运行期分裂成两套机制。让宿主成为 catalog 的唯一加载者、一次读齐全部语言随 `InstalledPlugin` 下发，manifest 与运行期共用、切语言零 IPC，是单一真相源。代价：插件作者交译文即可、但拿不到 i18next 的复数/上下文等高级特性（SDK resolver 只做查表 + `{{param}}` 插值，够用）。

**复用 `%key%` 做全局统一 marker，而非 tagged 对象或独立字段。** `plugin.json` 是纯 JSON，承载不了 `loc("key")` 这类对象标记；若 manifest 用占位符、register label 用对象、组件用别的，就碎成三套约定。统一成 `%key%` 字符串后，「宿主渲染的插件串」处处同形，且无 `%` 即字面量，天然兼容存量裸串。代价：label 里若真要出现字面 `%`，须转义（`%%`），属罕见边界。

**排除 agent 面向串。** tool description / systemPrompt / skills 是喂给模型的，随 UI 语言切换会让模型看到的提示词漂移，比照 0031「发给 LLM 的不抽」。i18n 只管真正给用户看的 UI。

## 后续若改变主意

- 若插件需要 i18next 级能力（复数/嵌套/上下文），可把 SDK resolver 换成内嵌的轻量 i18next 实例，`%key%` 约定与下发路径不变；
- 若要服务端下发插件译文（随插件市场更新多语言包），catalog 可扩为「插件内置 + 服务端合并」两源，参照 0031 后续条款的同款思路；
- 若第三方插件作者需要 `%key%` 的编译期类型检查，可在 plugin-vite 加 codegen 从 `locales/<defaultLocale>.json` 生成 key 联合类型，属 DX 增强、不改运行时契约。
