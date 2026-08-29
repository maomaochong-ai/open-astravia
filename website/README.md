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
├── index.html          # 唯一页面（全部文案与结构）
├── vite.config.ts      # 构建配置（outDir: dist）
├── tsconfig.json
├── public/             # 原样复制的静态资源（图标、截图、robots.txt）
│   ├── banner.png
│   ├── favicon.png
│   ├── screenshot.png  # 首屏产品截图
│   └── robots.txt
└── src/
    ├── main.ts         # 交互（导航滚动、移动菜单、滚动显现、活动锚点、年份）
    └── style.css       # 设计系统
```

## 设计参考

- 主参考 Linear 风格 + [openvetta.com](https://www.openvetta.com/)（仅内部设计参考，不写入官网文案）：暗色优先、发丝线、靛紫渐变点缀、居中首屏 + 应用窗口截图
- 设计系统 v4 要点：默认暗色 `#08080a` / 浅色可切换；`--accent: #7c8aff`（浅色 `#5e6ad2`）；mono 标签、紧字距标题、克制动效（滚动显现 16px 位移 + 卡片 2px 悬停）
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
