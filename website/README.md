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
| `/` | `pages/home.tsx` | 首屏、隐私承诺、真实任务走查、技能与插件生态、知识库、FAQ、收尾 CTA |
| `/features` | `pages/features.tsx` | Work / Coding 两个场景：四条日常事务、多形态回答、批量任务、能力广场、内置 Git、插件生态、并行工作流、主动澄清、工具箱 |
| `/download` | `pages/download.tsx` | 居中首屏推荐产物、其他版本、桌面三平台、手机端安装、安装说明 |
| `/about` | `pages/about.tsx` | 关于页：四个编号段落 + 截图带 + 收尾 CTA |
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
- 字阶：H1 52px / H2 36px / 小标题 14px，字重 600，行高 1.12；正文 16px / 28px
- 字体：标题 Hanken Grotesk（变量字重 300–800），代码与数字 IBM Plex Mono，两者都随包提供
- 动效克制：滚动显现 14px 位移；分段切换只做 0.16s 淡入；`prefers-reduced-motion` 下全部关闭
- 主题切换不做颜色过渡（半透明表面逐层插值会闪白）

## 内容维护

- **文案**：改对应页面里的数据常量（如 `pages/home.tsx` 的 `JOURNEY` / `FAQ` / `PROMISES`），不要散落在 JSX 里
- **分段切换**：页面内用 `useState` 控制，只切内容不换路由；新增分段要同时更新可访问属性（`role="tab"` / `aria-selected`）
- **品牌叙事（重要）**：官网**不得出现**任何竞品名称或「基于某产品改造」「源于 / 复用某产品」等表述。星轨定位为独立自研产品。这条由 `test/site-sections.test.ts` 的品牌口径用例守着
- **主题**：`app/theme.ts` 写 `data-theme`，样式里用两套令牌；截图与社群海报按主题换图
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
