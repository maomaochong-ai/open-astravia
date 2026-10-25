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
├── index.html          # 首页（全部文案与结构）
├── vite.config.ts      # 构建配置（outDir: dist）
├── tsconfig.json
├── public/             # 原样复制的静态资源
│   ├── app/            # 产品真实界面截图（见下方「素材」）
│   ├── download/       # 下载区块服务商图标
│   ├── plugins/        # 11 个预装插件图标
│   ├── fonts/
│   ├── banner.png
│   ├── favicon.png
│   ├── screenshot.webp       # 深色首屏产品截图（2560×1602）
│   ├── screenshot-light.webp # 浅色首屏产品截图（2560×1602）
│   └── robots.txt
└── src/
    ├── main.ts         # 交互（导航滚动、移动菜单、滚动显现、活动锚点、年份）
    ├── story.ts        # 「产品故事」逐步滚动联动（右侧窗格为手写 HTML 模拟，不引图片）
    └── style.css       # 设计系统
```

## 素材

首屏一对产品截图是 `docs/assets` 的 WebP 副本，靠 `data-theme` 切换显示：深色 `public/screenshot.webp`、浅色 `public/screenshot-light.webp`，均为 2560×1602。
两张必须取自同一代界面（当前深色取自 `docs/assets/ai-chat-baseline-left.png`，浅色取自 `docs/assets/screenshot-main-light.png`），否则切主题时侧栏入口和按钮会跳成两代 UI。

`public/app/` 放 1680 宽的 WebP 衍生图，供后续区块直接引用（当前首页只用了首屏那一对）：

| 文件 | 内容 | 源图 |
| --- | --- | --- |
| `app-dark.webp` | 会话工作区整体界面（深色） | `docs/assets/ai-chat-baseline-left.png` |
| `app-light.webp` | 会话工作区整体界面（浅色） | `docs/assets/screenshot-main-light.png` |
| `capabilities.webp` | 能力面板 | `docs/assets/capabilities.png` |
| `ui-design-canvas.webp` | UI 设计画布 | `docs/assets/ui-design-canvas.png` |

注意事项：

- **深色截图放进浅色卡片会拼成「两截」。** `capabilities` 与 `ui-design-canvas` 都是深色界面，若把它们放进浅色卡片，卡片固定用 `--shot-bg: #101019` 深色底（两种主题下都成立），不要改回 `var(--elev)`
- **「产品故事」窗格用 `object-fit: contain`。** 窗格比例比截图窄，改成 `cover` 会横向裁掉 26%–41% 的界面内容；`contain` 预留的上下缝隙由窗格底色 `#131313` 补齐，与截图自身背景 `#111` 几乎同色，肉眼不可见
- 新增截图沿用 1680×1050，并同时给出 `width` / `height` 属性，避免懒加载导致布局跳动
- `public/plugins/` 的 11 个图标对应仓库 `packages/plugins/presets/` 的预装插件；若那边增删插件，这里需同步

## 设计参考

- 主参考 [OpenAI Codex 官网](https://openai.com/zh-Hans-CN/codex/)（仅内部设计参考）：浅色极简、黑白单色强调、大圆角窗口、发丝分隔线、紧凑字距标题
- 设计系统 v6 要点：默认浅色白底 `#ffffff` + 首屏淡紫光带 `#efeefe`；主色为纯黑 `--accent: #000000`（黑色胶囊主按钮 + 白底发丝描边次按钮）；标题字体 Hanken Grotesk、标签字体 IBM Plex Mono；深色仍可切换（`#0d0d0d`，次要形态），代码窗与品牌示意图恒为暗色；克制动效（滚动显现 16px 位移 + 卡片 2px 悬停）
- 官网文案不得出现任何竞品名称或「基于某产品改造」「源于某产品」等表述（见下文品牌叙事）

## 内容维护

- **新增/修改区块**：直接改 `index.html`，交互类效果在 `src/main.ts`，样式在 `src/style.css`
- **品牌叙事（重要）**：官网**不得出现**任何竞品名称或「基于某产品改造」「源于 / 复用某产品」等表述，也不得把产品定位为任何现有产品的衍生。星轨定位为**独立自研**产品，文案一律按自研叙事撰写（如「独立自研」「自主设计」「不依赖既有产品代码」）。FAQ 中涉及与其他产品关系的回答同样按此口径，不承认基于任何竞品改造。仅可作为内部设计参考，不得写进官网文案
- **升级版本号**（发版后）：**由 `desktop-release` 自动完成**——`publish-website` job 在 R2 上传成功后跑 `node scripts/release/bump-website-version.mjs --version <新版本>`，改齐 5 个文件（`index.html` 里下载相关的链接与版本标签、`src/download-links.ts` 的 `DOWNLOAD_VERSION`、`package.json` 的 `version`、`test/download-target.test.ts` 与 `test/download-entry.test.ts` 的 `VERSION` 常量），推 `release/website-v<版本>` 分支并开一个到 `dev` 的 PR，再从该分支部署站点。只有手工补发时才需要自己跑这个脚本（`--check` 可校对当前是否对齐），改完在 `website/` 目录跑 `bun run test`
- **下载链接**：三平台按钮与「其他版本」列表都指向 R2 直链 `https://dl.astravia.dev/app/v<版本>/<产物名>`，所以官网版本号必须在 `upload-release-to-r2.yml` 把该版本产物上传完成后再改，否则链接 404。`desktop-release` 的 `publish-r2 → publish-website → deploy-website` 就是按这个顺序串的，不要拆开；手工补发时同样先跑 R2 再改版本号。细节见 [docs/deploy/launch/installer-r2-distribution.md](../docs/deploy/launch/installer-r2-distribution.md) 第 4 节

## 部署

 静态站，产物目录为 `website/dist`。Cloudflare Pages：连接仓库后构建命令 `cd website && bun install && bun run build`，输出目录 `website/dist`（详见 [docs/deploy/launch/cloudflare-setup-checklist.md](../docs/deploy/launch/cloudflare-setup-checklist.md)）。

## 质量

- `bun run typecheck`：本地类型检查
- 仓库根 `bun run check`：Biome 已纳入 `website/` 的 TS/CSS/HTML（见根 `biome.json`）
