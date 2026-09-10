# 官网升级方案：浅色纸感 Apple 风换肤

> 配套决策：[ADR-0059](../adr/0059-official-website-light-apple-design.md)
> 参考稿：`docs/website/cankao.html`（内部设计参考，不随站发布、不进官网文案）
> 状态：已实施（v5 设计系统）

## 一、目标

把官网默认观感从「Linear 深色优先」升级为参考稿的「浅色纸感 Apple 风」，**内容零删改、文案口径不变、下载链接不变**；深色保留为手动切换形态。

三个已确认走向：

| 走向 | 决策 | 理由 |
| --- | --- | --- |
| 默认观感 | 浅色纸感（Apple 风），保留深色切换 | 不丢 v4 深色资产与既有用户；视觉向参考稿对齐 |
| 字体 | 自托管 latin woff2（约 65KB） | 本地优先叙事；不上 Google Fonts CDN |
| 内容 | 全保留换肤，不精简重构 | 文案均已定稿；本次只做视觉语言 |

## 二、新旧视觉语言对照

| 维度 | v4（深色 Linear 风） | v5（浅色 Apple 纸感风） |
| --- | --- | --- |
| 默认画布 | `#08080a` | `#fbfbfd` |
| 纸面 / 卡片 | `#0c0c0f` / `#101014` | `#f5f5f7` / `#ffffff` |
| 正文墨色 | `#e9e9ec` | `#1d1d1f` |
| 强调色 | 靛紫 `#7c8aff` | Apple 蓝 `#0071e3`（深蓝 hover `#0058c2`） |
| 渐变 | `#7c8aff → #b28cff` | `#2e5bff → #0a84ff → #4fc3f7` |
| 光晕 | 紫 `rgba(178,140,255,.12)` | 蓝 `rgba(10,132,255,.16)`（`--halo`） |
| 标题字体 | 系统栈 | Hanken Grotesk（自托管） |
| 等宽标签 | 系统等宽 | IBM Plex Mono（自托管） |
| 主按钮 | 靛紫/反色块钮 | 蓝底白字 + 蓝投影胶囊（999px） |
| 卡片圆角 | 12px | 16px |
| 暗色形态 | 默认 | `[data-theme="dark"]` 手动切换（原 v4 值完整保留） |

## 三、实施步骤与文件对照

### 1. 字体自托管 → `website/public/fonts/`

| 文件 | 说明 |
| --- | --- |
| `hanken-grotesk-latin-var.woff2` | Hanken Grotesk 可变体 400–800，latin 子集 |
| `ibm-plex-mono-latin-400.woff2` | IBM Plex Mono Regular |
| `ibm-plex-mono-latin-500.woff2` | IBM Plex Mono Medium |
| `ibm-plex-mono-latin-600.woff2` | IBM Plex Mono SemiBold |

构建时随 `public/` 复制进 `dist/fonts/`，URL `/fonts/*.woff2`。中文回退 PingFang / Noto Sans SC 系统栈。

### 2. `website/src/style.css`（主改动面）

- 文件头部：注释升级为 v5；新增 4 条 `@font-face`（`font-display: swap` + latin `unicode-range`）。
- `:root`：原暗色值 → **浅色 Apple 令牌**（bg/tint/elev/ink/muted/line/accent/grad/nav-bg/shadow 全量），新增 `--accent-deep`、`--halo`；`--font-sans`/`--font-mono` 插入自托管字体名；`--radius: 16px`。
- `:root[data-theme="dark"]`：承接原暗色全部变量（靛紫 accent/渐变原样），新增 `--accent-deep`、`--halo` 暗色值。
- `.btn`：`border-radius: 999px` 胶囊。
- `.btn--primary`：蓝底白字 + 蓝投影；`:hover` 加深至 `--accent-deep`。
- `.btn--ghost`：浅底蓝字发丝边；`:hover` 蓝字 + `--accent-soft` 底。
- `.btn--lg`：胶囊 + 13px/24px 内距。
- 暗色主按钮反转：`:root[data-theme="dark"] .btn--primary { background: var(--ink); color: var(--bg) }`。
- 3 处 hero/story 区 radial 紫光晕 → `var(--halo)`；4 处卡片 hover 黑投影 → `var(--shadow-hover)`。

### 3. `website/index.html`（仅头部微调）

- `<html data-theme="light">`（原硬编码 `dark`）。
- `theme-color` meta → `#fbfbfd`。
- 头部主题引导脚本：默认 `light`，仅 `localStorage === "dark"` 时暗色。
- 主题按钮初始 `aria-label="切换到深色模式"`、`aria-pressed="false"`。
- 其余：**导航、hero、跑马灯、产品故事、能力卡、流程、模型、生态、隐私、下载（v0.55.35）、FAQ、开源、页脚全部原样**。

### 4. `website/src/main.ts`（微调）

- 主题切换逻辑不动；`applyThemeToggleState` 增加 `theme-color` meta 联动与按钮 `aria-label` 同步。

### 5. 验证

- `bunx biome check website/src/style.css website/src/main.ts website/index.html`（通过）。
- `bun run build` → `website/dist`（`dist/fonts/` 已含字体）。
- 桌面渲染器自检首页文本/结构正常；视觉细调建议在浏览器 + 部署预览进行。

## 四、信息架构与内容保持对照（HTML 未删改的区块）

| 区块 | 内容锚点（v0.55.35 现状） | 本次处理 |
| --- | --- | --- |
| 导航 | 能力/模型/生态/隐私/下载/开源 + 主题切换 | 仅按钮初始 aria 微调 |
| Hero | 「你的 AI 助手,住在你的电脑里」+ 下载/源码双 CTA + 截图 | 不动 |
| 跑马灯 | 能力关键词轮播 | 不动 |
| 产品故事 | 5 步交互演示（story） | 仅光晕令牌化 |
| 能力卡 | 8 张 | 不动 |
| 流程 | 4 步 | 不动 |
| 模型 | BYOK | 不动 |
| 生态/插件 | — | 不动 |
| 隐私/网络 | 隐私承诺 + 网络名单 | 不动 |
| 下载 | macOS arm64 `.dmg` / Windows x64 `.exe`（v0.55.35，`dl.astravia.dev/app/v0.55.35/…`）+ Linux 即将推出 | **链接与文件名一律不动** |
| FAQ | 6 条（含星轨与 Vetta 关系口径） | 不动（品牌红线） |
| 开源/页脚 | — | 不动 |

## 五、风险与边界

- **品牌红线**：本方案不触碰任何文案；`cankao.html`/`openvetta.com` 仅出现在内部文档（ADR/方案/README），官网产物与文案不含参考稿来源表述。
- **下载链接**：维持 GitHub Releases `releases/latest` 与 `dl.astravia.dev/app/v0.55.35/…` 现状，不切 R2 未就绪资源。
- **浅色可读性**：所有组件引用令牌，仅翻一层变量即得浅/深两套观感；个别 hardcode 光晕/阴影已令牌化，无残留死色。
- **产物上传**：`website/dist` 由用户自行上传（Cloudflare Pages / R2），本方案不执行上传。
