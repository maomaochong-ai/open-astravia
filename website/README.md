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
│   ├── screenshot.png       # 深色首屏产品截图
│   ├── screenshot-light.png # 浅色首屏产品截图
│   └── robots.txt
└── src/
    ├── main.ts         # 交互（导航滚动、移动菜单、滚动显现、活动锚点、年份）
    ├── story.ts        # 「产品故事」逐步滚动联动（含步骤 04-05 切换真实截图）
    └── style.css       # 设计系统
```

## 素材

产品真实截图放在 `public/app/`，全部为 1680×1050 左右的 WebP，单张 28–72KB：

| 文件 | 内容 | 用在哪 |
| --- | --- | --- |
| `app-dark.webp` | 会话工作区整体界面（深色） | 「产品故事」步骤 04-05 |
| `app-light.webp` | 会话工作区整体界面（浅色） | 备用（浅色主题可选） |
| `capabilities.webp` | 能力面板 | 「能力」区块截图卡 |
| `ui-design-canvas.webp` | UI 设计画布 | 「能力」区块截图卡 |

注意事项：

- **深色截图放进浅色卡片会拼成「两截」。** `capabilities` 与 `ui-design-canvas` 都是深色界面，因此 `.shot` 卡片固定用 `--shot-bg: #101019` 深色底（两种主题下都成立），不要改回 `var(--elev)`
- **「产品故事」窗格用 `object-fit: contain`。** 窗格比例比截图窄，改成 `cover` 会横向裁掉 26%–41% 的界面内容；`contain` 预留的上下缝隙由窗格底色 `#131313` 补齐，与截图自身背景 `#111` 几乎同色，肉眼不可见
- 新增截图沿用 1680×1050，并同时给出 `width` / `height` 属性，避免懒加载导致布局跳动
- `public/plugins/` 的 11 个图标对应仓库 `packages/plugins/presets/` 的预装插件；若那边增删插件，这里需同步

## 设计参考

- 主参考 [OpenAI Codex 官网](https://openai.com/zh-Hans-CN/codex/)（仅内部设计参考）：浅色极简、黑白单色强调、大圆角窗口、发丝分隔线、紧凑字距标题
- 设计系统 v6 要点：默认浅色白底 `#ffffff` + 首屏淡紫光带 `#efeefe`；主色为纯黑 `--accent: #000000`（黑色胶囊主按钮 + 白底发丝描边次按钮）；标题字体 Hanken Grotesk、标签字体 IBM Plex Mono；深色仍可切换（`#0d0d0d`，次要形态），代码窗与品牌示意图恒为暗色；克制动效（滚动显现 16px 位移 + 卡片 2px 悬停）
- `openvetta.com` 仅作内部参考，官网文案不得出现「基于 open-vetta / openvetta」等表述（见下文品牌叙事）

## 内容维护

- **新增/修改区块**：直接改 `index.html`，交互类效果在 `src/main.ts`，样式在 `src/style.css`
- **品牌叙事（重要）**：官网**不得出现**「基于 open-vetta / openvetta 改造」「源于 / 复用 open-vetta」等表述，也不得把产品定位为任何现有产品的衍生。星轨定位为**独立自研**产品，文案一律按自研叙事撰写（如「独立自研」「自主设计」「不依赖既有产品代码」）。FAQ 中涉及与 Vetta 关系的回答同样按此口径，不承认基于 open-vetta。`openvetta.com` 仅可作为内部设计参考，不得写进官网文案
- **升级版本号**（发版后）：改 `index.html` 中「下载」区块的三处文件名（`astravia-<版本>-mac.dmg` 等）与版本说明，并同步 `package.json` 的 `version`
 - **下载链接**：三平台按钮当前指向 GitHub Releases `releases/latest`（R2 直链 `https://dl.astravia.dev/app/v<版本>/astravia-<版本>-<平台>.<扩展名>` 在对应版本上传前不可用，勿切）。R2 上传完成后，按 [docs/deploy/launch/installer-r2-distribution.md](../docs/deploy/launch/installer-r2-distribution.md) 第 4 节替换为 dl 直链

## 部署

 静态站，产物目录为 `website/dist`。Cloudflare Pages：连接仓库后构建命令 `cd website && bun install && bun run build`，输出目录 `website/dist`（详见 [docs/deploy/launch/cloudflare-setup-checklist.md](../docs/deploy/launch/cloudflare-setup-checklist.md)）。

## 质量

- `bun run typecheck`：本地类型检查
- 仓库根 `bun run check`：Biome 已纳入 `website/` 的 TS/CSS/HTML（见根 `biome.json`）
