---
status: accepted
---

# desktop i18n：i18next + 语义 key + main 持有语言 SoT

desktop 原本全量中文硬编码（renderer ~237 文件、main ~73 文件含中文）。本次目标**只搭框架 + 抽离**：接入 i18n 框架、把用户可见中文抽成 key、做到「中文走 key、可切换」，en 译文后续再填（验收标准不是「英文完整」）。框架一旦定型，库选型与 key 形态都极难回退（换库 / 重新 key 化 310 文件成本以人月计），故记此 ADR。

## 决定

- **库**：`i18next` + `react-i18next`。renderer 用 hooks（`useTranslation` / `<Trans>`），main 进程用同一个 i18next core 实例（纯 Node 可用），两侧共享同一套 JSON catalog。否决 react-intl（ICU API 更重、main 复用不顺）与轻量自建（复数/插值/工具链都得自己造，310 文件规模不划算）。
- **key 形态**：**语义 key 路径**（`t("chat:newSession")`），非「中文原文即 key」。可维护性优先、改文案不断 key；代价是逐条取名需人判断，纯自动 codemod 不可行。
- **namespace**：按 renderer domain 切 ns（`chat` / `settings` / `project` …）+ 共用基础件走 `common` + main 进程（菜单/通知/dialog）走 `main` ns。与 `src/renderer/domains/*` 目录同构、减少多人合并冲突。
- **catalog 加载**：locale JSON 放共享目录（`src/shared/i18n/locales/{lang}/{ns}.json`），main 与 renderer 都用**顶层静态 import**，由 Vite 打进各自 bundle 喂 i18next `resources`。**零运行时 fs、零 async、不闪**。刻意不走 i18next-fs/http-backend 懒加载——那正会撞上 [[人设]] 记录的「打包后 `__dirname` 读盘失效」坑。代价：加语言要重新构建（2-3 语言无所谓）。
- **语言 SoT**：**main 持有**，存 `~/.vetta/desktop-config.json` 的 `language` 字段（`DesktopConfig`，与 `notificationsEnabled` 同文件，复用 `readDesktopConfig`/`writeDesktopConfig`，且有现成同步读 `readConfigSync`）。**刻意不放 `~/.vetta/agent/settings.json`**——那是 agent/server token 配置；语言是 desktop UI 偏好，归属 desktop-config。main 启动 `readConfigSync().language` **同步读**→首次就用对的语言建托盘菜单；renderer 经 preload `sendSync("vetta:i18n:get-initial-language")` 同步拿初值防闪；切换走 renderer→`vetta:i18n:set-language`→main 持久化 + `rebuildTrayContextMenu` + 广播 `vetta:i18n:language-changed`→各 renderer `changeLanguage`。原生通知/托盘构造时经 `mainT()` 读 main 的独立 i18next 实例（`defaultNS=main`）。
- **fallback / 默认**：`fallbackLng=zh`——en 未填时回退中文，**绝不露原始 key**（对「框架先行、en 后填」至关重要）。**默认语言 = zh**（`desktop-config.language` 未设置时 `initAppLanguage` 直接取 `FALLBACK_LANGUAGE`，不跟随系统 locale），之后以用户在「外观」页手选为准。（早期曾设计为首启跟随 `app.getLocale()`，后改为恒定默认中文。）
- **抽离节奏**：框架先行（i18n init / settings 管道 / preload 初值 / 语言切换器 / `common` + `main` 两 ns 跑通），再一个 domain 一个 domain 增量抽，可验收、可中途停。
- **抽离边界**：仅抽 **renderer 用户可见 UI 文案** 与 **main 原生 UI（菜单/通知/dialog）**。代码注释、日志（`*.warn("...")`）、回传 LLM 的 agent 提示词/协议串**不抽**。**用户可见错误/状态文案本次暂不纳入**（如「服务器不可达」留中文），增量回访时再补。

## 关键取舍

**语言 SoT 走 main-owned desktop-config.json，刻意不照搬主题的 renderer-localStorage-owned。** 这是本 ADR 最易让后来者困惑的一处不对称：主题只需把 dark/light **布尔**推给 main 做原生 vibrancy，纯 UI 偏好放 renderer localStorage 即可；而语言在 **app ready、尚无任何渲染窗口时**就要用于构建原生托盘菜单，localStorage 那时读不到。故语言必须是 main 能在启动同步读到的值——`desktop-config.json` 已有 `readConfigSync` 同步读、且本就装 `notificationsEnabled` 这类 desktop UI 偏好，是单一真相源、首屏菜单不闪。renderer 防闪靠 preload 的 `sendSync`（本仓首次引入同步 IPC，仅此一处、仅取初值），与 `applyInitialTheme` 同步读 localStorage 同构。

**静态打包 catalog 换掉懒加载。** 懒加载省 bundle、可不重构加语言，但要解决打包后路径问题（[[人设]] 已踩过 `__dirname` 失效）并带首帧 async 闪。2-3 语言下全量打进 bundle 的体积可忽略，换来同步 init、零 fs、不闪——与 [[人设]] codegen 内联同一思路（凡打包后场景一律避免运行时读盘）。

**语义 key 换掉「中文原文即 key」。** 后者包 `t()` 即走、零命名摩擦，对 310 文件诱惑很大；但改中文文案就断 key、key 冗长。选语义 key 以保可维护性，承担逐条取名的人工成本，这也正是「纯自动 codemod 不可行、必须框架先行 + 人工增量抽」的根因。

## 后续若改变主意

- 若语言增长到需「不重构热加切语言」，再引 i18next backend 懒加载，须一并解决打包路径（参照 [[人设]] codegen 思路），SoT 与切换流不变；
- 用户可见错误/状态文案纳入时，按本 ADR 的 ns/边界规则继续，无需改框架；
- 若未来要服务端下发译文（如随预设/技能下发多语言文案），catalog 可扩为「内置静态 + 服务端合并」两源，参照 [[预设模板]] 的在线合并/离线快照模式。
