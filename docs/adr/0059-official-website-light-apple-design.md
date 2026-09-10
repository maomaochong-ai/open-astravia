# 官网升级：浅色纸感 Apple 风为默认视觉语言

## Status

Accepted

## Context

官网（`website/`，纯 TypeScript 静态站，Vite 构建 → `website/dist`，部署 Cloudflare Pages）自 v4 起采用 **Linear 风格深色优先**设计：默认暗色 `#08080a`、靛紫渐变 `#7c8aff → #b28cff`、发丝线、克制动效，并提供浅色手动切换。此方向此前在 `website/README.md` 中表述为「Linear 风格 + 内部参考稿观感」。

`docs/website/cankao.html`（内部设计参考稿，不随站发布、不进文案）提供了另一套完整、经过打磨的视觉语言：**浅色纸感（`#FBFBFD` 画布 / `#F5F5F7` 纸面）**、墨色正文 `#1D1D1F`、**Apple 蓝主强调 `#0071E3`**、青蓝渐变 `#2E5BFF → #0A84FF → #4FC3F7`、Hanken Grotesk 标题 + IBM Plex Mono 标签、1120px 版面、大圆角卡片与胶囊按钮、居中首屏 + 产品窗口演示。

用户决策：**「参考 `docs/website/cankao.html` 设计，做官网升级的决策 ADR 与升级方案，并据此升级官网」**，并确认三条走向：

1. **默认浅色 + 保留深色手动切换**（不抛弃现有深色用户）；
2. **字体自托管到 `public/fonts/`**（保持本地优先、零第三方运行时请求的品牌叙事，不上 Google Fonts CDN）；
3. **内容全保留、整体换肤**（产品故事/跑马灯/能力卡/流程/模型/生态/隐私/下载/FAQ/开源等板块文案均已定稿，只重做视觉语言与节奏，不删内容、不改文案口径）。

约束（源自 `website/README.md`，与本次决策正交但必须遵守）：

- 品牌叙事红线：官网文案不得出现「基于 open-vetta / 改造 / 源于」等表述，星轨定位独立自研；`openvetta.com` 与 `cankao.html` 仅作内部设计参考，不进官网文案。
- 下载链接维持现状（GitHub Releases `releases/latest` 与已就绪的 `dl.astravia.dev/app/v0.55.35/…` 直链），不擅自切换。
- FAQ 口径、`public/` 静态资源（截图/横幅/图标）不变。

## Decision

**官网默认主题由「深色优先」翻转为「浅色纸感 Apple 风」（参考 `cankao.html` 设计语言），深色保留为手动切换的次要形态；通过令牌层（CSS 自定义属性）整体换肤，内容与文案零删改。**

具体决策：

1. **默认浅色，深色可切换**。`:root` 成为浅色令牌（画布 `#fbfbfd`、纸面 `#f5f5f7`、墨 `#1d1d1f`、Apple 蓝 `#0071e3`、深蓝 `#0058c2`、渐变 `#2e5bff→#0a84ff→#4fc3f7`、发丝线 `#e8e8ed`）；原暗色值整体迁入 `:root[data-theme="dark"]`（靛紫 `#7c8aff→#b28cff` 保留为暗色下品牌色）。`index.html` 头部引导脚本默认 `light`，仅当 `localStorage["astravia-theme"] === "dark"` 时覆盖；`theme-color` meta 随主题联动。组件一律引用令牌，浅/深两套观感由一层变量翻转完成。
2. **光晕与投影跟随主题**。新增令牌 `--halo`（浅色为蓝 `rgba(10,132,255,.16)`、暗色为紫 `rgba(178,140,255,.12)`）与 `--shadow-hover`；替换 3 处 hardcode 的靛紫 radial-gradient 光晕与 4 处卡片 hover 黑影。代码窗（产品内模拟 UI）与 story 产品窗口恒为产品本色，不受主题影响。
3. **按钮 Apple 化**。`.btn` 基座、`.btn--primary`（蓝底白字 + 蓝投影，hover 加深）、`.btn--ghost`（浅底蓝字发丝边）、`.btn--lg` 统一 999px 胶囊；暗色下主按钮反转以维持对比。参考稿为 100px 全宽大钮的入口形态保留在 HTML（hero/下载区现有主 CTA 即主按钮变体，不新增全宽大钮）。
4. **圆角提升**。`--radius` 由 12px → 16px，贴近参考稿大圆角卡片；按钮用 999px 胶囊。
5. **字体自托管**。下载 Hanken Grotesk 可变体（400–800）与 IBM Plex Mono（400/500/600）latin 子集 woff2 至 `website/public/fonts/`（合计约 65KB），CSS 头部 `@font-face` 声明（`font-display: swap`），`--font-sans`/`--font-mono` 优先引用；中文回退 PingFang/Noto Sans SC 系统栈，正文汉字观感不受影响。零运行时第三方请求。
6. **内容零删改**。`index.html` 全部信息架构、区块顺序、文案、FAQ 口径、下载文件名与链接原样保留；仅头部 meta/theme 脚本与主题按钮初始 `aria-*` 随默认主题翻转微调。`src/main.ts` 主题切换逻辑不变，仅补 `theme-color` meta 联动与按钮 `aria-label` 同步。

### 不做的（Out of Scope）

- 不引入系统主题跟随（`prefers-color-scheme`），维持「默认浅色 + 手动切换」的确定性，避免部署后观感随访客 OS 漂移。
- 不改版式骨架/板块结构、不删 hero 截图与产品故事交互、不改任何文案。
- 不上 Google Fonts CDN，不引入外部运行时依赖。
- 不切下载链接、不上传 R2（产物由用户自行上传）。

## Considered Options

- **O1 参考稿全量浅色、移除深色切换**：与参考稿观感最一致、令牌层最简，但会丢弃 v4 积累的深色品牌资产与既有深色用户偏好，且「产品窗口恒暗色」与全站浅色对比更突兀。用户未选择。
- **O2 保持深色优先，仅吸收参考稿气质**：改动最小，但参考稿核心观感（浅色纸感 + Apple 蓝）体现不出来，与「参考 cankao.html 升级」的意图不符。用户未选择。
- **O3 直接引用 Google Fonts CDN**：实现最快，但每次访问向 Google 发起请求，与「本地优先、无遥测、无外部依赖」的品牌叙事冲突。用户未选择。
- **O4 精简重构为参考稿式板块**：删跑马灯/滚动故事等自有板块，信息架构向参考稿靠拢；涉及文案取舍，超出「升级视觉」范围。用户未选择。
- **O5 本决策（浅色默认 + 深色保留 + 令牌层换肤 + 字体自托管 + 内容全保留）**：采纳。视觉向参考稿全面对齐，深色资产不丢，零文案删改，构建产物仅新增约 65KB 自托管字体。

## Consequences

- 官网默认观感由「深色 Linear」变为「浅色纸感 Apple 风」；深色作为手动切换保留，v4 深色变量完整迁入暗色块，无资产丢失。
- 视觉决策收敛在令牌层与按钮/字体/圆角 4 个面上，`index.html` 仅头部微调 → 后续改版成本低、回归风险小。
- 内容零删改 ⇒ FAQ 口径、下载文件名/链接、品牌叙事红线不受影响；`public/` 资源原样随构建复制。
- 自托管 latin 子集字体使站内英文标题/等宽标签与参考稿一致；中文回退系统字体，加载零第三方请求，代价是 dist 增大约 65KB。
- 局限：非 latin 字形仍用系统栈，与参考稿混排效果不可能逐像素一致；PDF/截图类无 JS 环境观感与浏览器一致（换肤纯 CSS）。
- 质量自查：Biome（CSS/HTML/TS）+ Vite 构建通过；视觉验收由用户在浏览器/部署后执行，产物 `website/dist` 由用户自行上传（R2/Cloudflare Pages）。

## Related

- `docs/website/cankao.html`（内部设计参考，仅开发参考、不进官网文案）
- `website/README.md`（构建、结构、设计参考与品牌红线）
- 升级方案与区块对照：`docs/website/website-redesign-upgrade-plan.md`
