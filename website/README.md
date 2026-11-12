# 星轨 Astravia 官网

官网源码（纯 TypeScript 静态站）。产品与下载信息以仓库根 [README.md](../README.md) 为准。

## 技术栈

- [Vite 7](https://vite.dev) + TypeScript：所有源码均为 `.ts`，无运行时依赖、无框架
- 构建产物输出到 `website/dist`（仓库根 `.gitignore` 已忽略 `dist/`，不入库）

## 常用命令

```bash
bun install        # 安装依赖（vite + typescript）
bun run dev        # 本地开发（http://localhost:5173）
bun run build      # 生产构建 → dist/
bun run preview    # 本地预览构建产物（http://localhost:4173）
bun run typecheck  # tsc --noEmit 类型检查
```

## 目录结构

```
website/
├── index.html          # 首页（全部文案与结构，单页静态标记）
├── vite.config.ts      # 构建配置（outDir: dist）
├── tsconfig.json
├── public/             # 原样复制的静态资源
│   ├── app/            # 首屏深浅两版应用截图
│   ├── community/      # 社群二维码与海报
│   ├── download/       # 下载区块的服务商图标
│   ├── fonts/          # Hanken Grotesk 变量字体 + IBM Plex Mono 400/500
│   ├── plugins/        # 11 个预装插件图标
│   ├── favicon*.png    # 圆角图标（32 / 512）
│   ├── apple-touch-icon.png
│   ├── banner-rounded.png  # 导航与页脚品牌图（圆角）
│   ├── banner.png      # og:image
│   └── robots.txt
└── src/
    ├── main.ts         # 交互装配：导航、主题、滚动显现、工作台视图、下载区、FAQ
    ├── download-links.ts / download-target.ts   # 按系统与芯片选产物
    ├── mobile-install.ts                        # 手机端入口
    ├── external-links.ts                        # 外链统一新窗口
    └── style.css       # 设计令牌与全部样式
```

## 素材

首屏是一对应用截图，靠 `data-theme` 切换：深色 `public/app/app-dark.webp`、浅色 `public/app/app-light.webp`，均为 2400 宽、同一代界面。渲染时给 `width` / `height`，比例与原图一致（1.6），所以不会拉伸变形。

图标必须是圆角版：`favicon.png`（512）、`favicon-32.png`、`apple-touch-icon.png`（180）都由原图加圆角遮罩导出；导航与页脚的品牌小图用 `banner-rounded.png`。直角图标在浏览器标签页上会显得很硬，不要换回未裁切的方图。

`public/plugins/` 的 11 个图标对应仓库 `packages/plugins/presets/` 的预装插件；那边增删插件时这里同步。

## 资源与选择器的守卫

`test/no-zombie-assets.test.ts` 会把三类僵尸钉成失败：

- `public/` 下存在没有任何引用的文件（构建期不报错，会一直跟着部署包上线）
- 样式表里有类选择器没有任何元素在用，或页面里的类既无样式也不是脚本钩子
- 页面里的 id 既不被脚本引用，也不是导航锚点或 SVG defs

新增或删除资源时直接跑 `bun run test`，不用手工翻目录。

## 设计参考

- 视觉语言：深色优先（`#000` 底 + 近白正文），冷色半透明描边 `rgba(214,235,253,.10)`，16px 卡片圆角，四周一圈极淡环境光而不是投影
- 字体：标题 Hanken Grotesk（变量字重 300–800），代码与数字 IBM Plex Mono，两者都随包提供
- 动效克制：滚动显现 14px 位移动画、同容器按 60ms 错层；视图切换 0.42s；`prefers-reduced-motion` 下全部关闭
- 官网文案不得出现任何竞品名称或「基于某产品改造」「源于某产品」等表述（见下文品牌叙事）

## 内容维护

- **新增/修改区块**：直接改 `index.html`，交互类效果在 `src/main.ts`，样式在 `src/style.css`
- **工作台三视图**：`data-view` 与 `data-stage-view` 一一配对，切换由 `initWorkbenchTabs()` 处理；新增一块要同时补 tab、面板和 `role`/`aria-controls`
- **主题**：`data-theme` 走 `light` / `dark` 两个令牌组，首屏截图与社群海报都按主题换图（`applyAppShot` / `applyCommunityPosters`）
- **品牌叙事（重要）**：官网**不得出现**任何竞品名称或「基于某产品改造」「源于 / 复用某产品」等表述，也不得把产品定位为任何现有产品的衍生。星轨定位为**独立自研**产品，文案一律按自研叙事撰写（如「独立自研」「自主设计」「不依赖既有产品代码」）。FAQ 中涉及与其他产品关系的回答同样按此口径，不承认基于任何竞品改造。仅可作为内部设计参考，不得写进官网文案
- **升级版本号**（发版后）：**由 `desktop-release` 自动完成**——`publish-website` job 在 R2 上传成功后跑 `node scripts/release/bump-website-version.mjs --version <新版本>`，改齐 5 个文件（`index.html` 里下载相关的链接与版本标签、`src/download-links.ts` 的 `DOWNLOAD_VERSION`、`package.json` 的 `version`、`test/download-target.test.ts` 与 `test/download-entry.test.ts` 的 `VERSION` 常量），推 `release/website-v<版本>` 分支并开一个到 `dev` 的 PR，再从该分支部署站点。只有手工补发时才需要自己跑这个脚本（`--check` 可校对当前是否对齐），改完在 `website/` 目录跑 `bun run test`
- **下载链接**：三平台按钮与「其他版本」列表都指向 R2 直链 `https://dl.astravia.dev/app/v<版本>/<产物名>`，所以官网版本号必须在 `upload-release-to-r2.yml` 把该版本产物上传完成后再改，否则链接 404。`desktop-release` 的 `publish-r2 → publish-website → deploy-website` 就是按这个顺序串的，不要拆开；手工补发时同样先跑 R2 再改版本号。细节见 [docs/deploy/launch/installer-r2-distribution.md](../docs/deploy/launch/installer-r2-distribution.md) 第 4 节

## 部署

 静态站，产物目录为 `website/dist`。Cloudflare Pages：连接仓库后构建命令 `cd website && bun install && bun run build`，输出目录 `website/dist`（详见 [docs/deploy/launch/cloudflare-setup-checklist.md](../docs/deploy/launch/cloudflare-setup-checklist.md)）。

## 质量

- `bun run test`：8 个测试文件（DOM 契约 + 资源守卫 `test/no-zombie-assets.test.ts`）
- `bun run typecheck`：本地类型检查
- 仓库根 `bun run check`：Biome 已纳入 `website/` 的 TS/CSS/HTML（见根 `biome.json`）
