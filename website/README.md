# 星轨 Astravia 官网

官网源码。产品与下载信息以仓库根 [README.md](../README.md) 为准。

## 技术栈

- **Vite 7 + React 19 + TypeScript**：四个页面是组件，不是四份 HTML
- 客户端路由（History API）：一个 `index.html` 渲染 `/`、`/features`、`/download`、`/about`
- 样式集中在 `src/style.css`，用 CSS 变量做主题与尺度；没有 CSS 框架
- 构建产物输出到 `website/dist`（仓库根 `.gitignore` 已忽略 `dist/`，不入库）

## 路由

| 路径 | 页面 | 内容 |
| --- | --- | --- |
| `/` | `pages/home.tsx` | 首屏（文案 + 角色）、**应用真实截图段**（深浅主题各一张）、隐私承诺、真实任务走查（竖向时间线 + 应用窗口）、技能与插件生态、知识库、FAQ、收尾（自我介绍 + 五张角色拼贴） |
| `/features` | `pages/features.tsx` | Work / Coding 两档切换（默认 Work）：工作场景 tab + 邮件 mock；Work 下有丰富回答/批量队列/能力广场；Coding 下有内置 Git/插件生态 + SDK；两档共用并行工作流、主动澄清、工具箱 |
| `/download` | `pages/download.tsx` | 居中首屏：服务商图标弧 + 大字「下载」+ 描边胶囊 + 版本 + 其他版本；其下平台矩阵、手机端、安装说明 |
| `/about` | `pages/about.tsx` | 「大家好，我叫毛毛虫」开场 + 四个编号长文段（含行内引语）+ 千人千个 Agent + 收尾 CTA |
| 文档 | 外链 | `https://docs.astravia.dev` |

路由表、标题与描述集中在 `src/app/router.ts`；新增页面要同时登记 `ROUTES`（运行时校验）与
`vite.config.ts` 的 `ROUTES`（开发与预览服务器回落）。

## 常用命令

```bash
bun install        # 安装依赖
bun run dev        # 本地开发（http://localhost:5173）
bun run build      # 生产构建 → dist/
bun run preview    # 本地预览构建产物（http://localhost:4173）
bun run typecheck  # tsc --noEmit
bun run test       # 组件渲染契约 + 资源守卫
```

## 目录结构

```text
website/
├── index.html          # 唯一入口：主题预设 + <div id="root">
├── vite.config.ts      # React 插件、单入口构建、无扩展名路由回落
├── public/             # 原样复制的静态资源（截图、二维码、插件图标、字体）
├── src/
│   ├── main.tsx        # 挂载 + 按路由选页面
│   ├── app/
│   │   ├── router.ts   # 路由表、标题描述、navigate、useRoutePath
│   │   ├── theme.ts    # 深浅主题（localStorage + 系统偏好）
│   │   ├── ui.tsx      # Link / ExternalLink / 图标集 / 滚动显现
│   │   └── layout.tsx  # 页头（胶囊导航）、页脚（链接 + 社群二维码）
│   ├── pages/          # home / features / download / about
│   ├── lib/            # 下载平台解析、手机端链接（纯函数，便于单测）
│   └── style.css       # 设计令牌与全部样式
└── test/               # 渲染契约、路由、资源守卫
```

新增页面：在 `pages/` 加组件 → 在 `router.ts` 的 `ROUTES` / `ROUTE_META` 登记 → 在 `main.tsx` 加分支 →
在 `vite.config.ts` 的 `ROUTES` 同步。

## 设计参考

- 视觉语言：深色优先（`#0a0a0a` 底 + 近白正文），冷色半透明描边，卡片圆角 10–18px，四周一圈极淡环境光
- 字阶：H1 52px / H2 36px / 小标题 14px，字重 600，行高 1.12；正文 16px / 28px；大标题下半段用渐变淡出（`background-clip: text`），避免整块死白压住版面
- 字体：标题 Hanken Grotesk（变量字重 300–800），代码与数字 IBM Plex Mono，两者都随包提供
- 动效克制：滚动显现 14px 位移；分段切换只做 0.16s 淡入；首屏服务商条是 30s 循环跑马灯；`prefers-reduced-motion` 下全部关闭
- 主题切换不做颜色过渡（半透明表面逐层插值会闪白）
- **主题是站点级 store**：`app/theme.ts` 用 `useSyncExternalStore`，所有 `useTheme()` 共享同一份状态；切主题会同步 `data-theme`、`<meta name=theme-color>`、localStorage 与依赖主题的图片（走查里的产品截图、页脚社群海报）。新增主题相关图片时不要再各自 `useState`
- 首页模块节奏对齐参考站：首屏 688px、承诺段两栏（文案 535 / 三列 681）、走查段左栏 284 + 右栏窗口 640、生态段左文案 + 中心角色 + 右三段面板、知识库右栏文件卡 + 角色、收尾左文右拼贴
- 角色素材：原图是奶油底的工作室照片，**在生成阶段就抠成透明并裁掉留白**，页面上只负责加投影与背后一圈暖光；不要退回「整块奶油色卡片」的旧做法
- 品牌图标：统一取 `brand-logo/v1/icon.png`（暗色星环 + 吉祥物），同样先裁掉透明留白再按 512/180/128/32 输出；导航、页脚、favicon、apple-touch-icon、聊天头像与轨道中心用同一张

## 内容维护

- **文案**：改对应页面里的数据常量（如 `pages/home.tsx` 的 `JOURNEY` / `FAQ` / `PROMISES`），不要散落在 JSX 里
- **角色素材**：全部来自 `Desktop/maomaochong-pet/maomao_covers/…/astravia_replica`（白底照片，非透明），产物在 `public/mascot/`：`hero.webp`（700×1470，**保留石台**，首屏用）、`laptop / headphones / tea / dumbbell / sleep` 各 560px（收尾拼贴）、`icon.webp` 256（轨道中心与头像）。
  抠图流程（已在 1024 原尺寸上验证，不要再自己写颜色阀值）：
  ① 上传到免登录的 [iloveimg 抠图](https://www.iloveimg.com/remove-background)（无登录、无水印、免费），拿回 1024 宽透明 PNG；
  ② 本地用页内 canvas 找 alpha bbox → 加 2% 边距 → 按目标宽度缩成 webp。
  为什么不自己算：影棚地面与石台都接近白底/深底，颜色阀值要么留下地板要么把石台削掉；模型抠图能分清半透明边、毛发与石台。
  源图与脚本不落户仓库；新增或删除图片必须同步更新引用，`test/no-zombie-assets.test.ts` 会拦住没人用的图
- **分段切换**：页面内用 `useState` 控制，只切内容不换路由；新增分段要同时更新可访问属性（`role="tab"` / `aria-selected`）
- **品牌叙事（重要）**：官网**不得出现**任何竞品名称或「基于某产品改造」「源于 / 复用某产品」等表述。星轨定位为独立自研产品。这条由 `test/site-sections.test.ts` 的品牌口径用例守着
- **品牌图标**：统一用 `Desktop/maomaochong-pet/brand-logo/v2/icon-1024.png`（暗底圆角 + 角色），导出 `banner-rounded.png`（128，导航与页脚）、`favicon.png`（512）、`favicon-32.png`、`apple-touch-icon.png`（180）与 `mascot/icon.webp`（256，轨道中心、问答头像）。
- **收尾拼贴**：`3 + 2` 马赛克，`grid-template-rows` 必须写 px（用 1fr/auto 时 `img{height:100%}` 会退回自身 520px 把行撑开）；角色用 `object-fit: contain`，卡片底色是一圈暖光而不是实底
- **升级版本号**（发版后）：由 `desktop-release` 自动跑 `scripts/release/bump-website-version.mjs`，改齐 4 个文件
  （`src/pages/download.tsx` 的 `DOWNLOAD_VERSION` 与产物链接、`package.json` 的 `version`、
  `test/download-target.test.ts` 的 `VERSION`）。只有手工补发时才需要自己跑（`--check` 可校对）
- **下载链接**：指向 R2 直链 `https://dl.astravia.dev/app/v<版本>/<产物名>`，必须在产物上传完成后再改版本号，
  否则链接 404。顺序见 [docs/deploy/launch/installer-r2-distribution.md](../docs/deploy/launch/installer-r2-distribution.md) 第 4 节

## 部署

静态产物目录为 `website/dist`，但**需要托管方把未知路径回落到 `index.html`**（SPA 必须）。
Cloudflare Pages：构建命令 `cd website && bun install && bun run build`，输出目录 `website/dist`；
在 Pages 里配置 `/*  /index.html  200` 的重写规则，或直接在 `dist` 里放 `_redirects`（当前构建脚本尚未生成）。
详见 [docs/deploy/launch/cloudflare-setup-checklist.md](../docs/deploy/launch/cloudflare-setup-checklist.md)。

## 质量

- `bun run test`：组件渲染后的结构契约、路由表、下载链接一致性、资源与类名守卫
- `bun run typecheck`：本地类型检查
- 仓库根 `bun run check`
