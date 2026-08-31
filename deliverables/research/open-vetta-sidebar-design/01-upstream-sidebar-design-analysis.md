# open-vetta 侧边栏设计功能实现分析

> 目标:彻底弄清 open-vetta 桌面端「设计」工作台(侧边栏 Design 入口 + 设计体系模板库)是如何实现的,为 astravia 移植提供依据。
> 调查对象:`/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta`(上游,commit 0b7a6324f)
> 日期:2026-08-22

---

## 1. 总览

open-vetta 的「设计」功能不是桌面端内置页面,而是**一个独立插件** `@vetta/plugin-vetta-ui-design`(目录 `packages/plugins/presets/vetta-ui-design/`),通过 `definePlugin` 注册进桌面宿主。它由**两条并行链路**组成:

| 链路 | 触发点 | 做什么 |
| --- | --- | --- |
| **画布链路(apply)** | 画布内的「设计体系」对话框 | 把某套设计体系**套用到当前正在编辑的 `.vetd` 设计工程**(零 frame 时直写 `theme.css`,有 frame 时写 `DESIGN.md` + 发起 restyle 让 agent 全量重设) |
| **画廊链路(start-from-system)** | 会话宫格「从风格开工」 | 从某套体系**开工建新项目**:把整套参考资源落到 `design-resources/<slug>/`,开新会话,agent 按 SKILL 协议消费 |

两条链路的**数据源是同一个**:远端仓库 `openvetta/vetta-design-templates` 的 `.vetta/design-templates.json` 目录清单。

---

## 2. 侧边栏入口(activity tab + workspace view)

插件在 `src/index.tsx` 的 `definePlugin` 里注册(文件:[index.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/index.tsx)):

| 注册项 | 值 | 说明 |
| --- | --- | --- |
| activity tab | id **`"canvas"`**(定义于 [src/tab-ids.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/tab-ids.ts) 的 `CANVAS_TAB_ID`),label 走 i18n `%tab.label%`(Design / 设计),`initiallyVisible: false` | 这就是**活动面板(侧边栏)里的「设计」tab**,由插件按当前工作区是否有 `.vetd` 决定是否上栏 |
| workspace view | id **`"gallery"`**(`GALLERY_VIEW_ID`) | 整页「设计体系画廊」,宿主在**左侧主导航栏**固定一个入口(见 §6) |
| 全局插槽 | `export-mockup-dialog` | 导出 mockup 对话框 |
| 其他 | 截图卡片渲染器、`.vetd` 文件预览、画布右键菜单、`registerDesignTools(ctx)` | agent 工具注册 |

`activate(ctx)` 时立刻调用 `refreshDesignCatalog(ctx)` 拉一次清单(见 §3);agent 工具在 `src/tools.ts` 注册:`vetd_create` / `vetd_screenshot` / `vetd_status` / `vetd_install` / `vetd_notes`(label/描述全走 i18n `%tool.vetd_*%`)。

**权限声明**(plugin.json)是这条链路能跑起来的先决条件:

```jsonc
{
  "permissions": [
    "network.fetch",          // 拉清单 + 按需下载二进制资源
    "storage.read", "storage.write", // 缓存目录(ETag/TTL)
    "ui.slot.workspace-view", // 注册整页画廊
    "ui.slot.activity-tab",   // 注册 Design tab
    "capture.offscreen", "shell.openExternal",
    "ui.shortcuts.register", "ui.file-explorer.*", "conversation.*"
  ],
  "network": { "allowedHosts": ["cdn.jsdelivr.net", "raw.githubusercontent.com"] }
}
```

`network.allowedHosts` **只放行两个 host**——它们与清单双源、二进制资源 URL 一一对应。

---

## 3. 模板目录拉取链路(catalog-sync)

核心文件:`src/design-systems/catalog-sync.ts`、`remote-catalog.ts`、`registry.ts`(整个 `design-systems/` 目录共 9 个文件,是模板库的大脑)。

### 3.1 清单 URL(确切值)

```ts
DESIGN_CATALOG_SOURCES = [
  "https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json", // 首选
  "https://cdn.jsdelivr.net/gh/openvetta/vetta-design-templates@main/.vetta/design-templates.json",        // 兜底
]
CATALOG_PATH_IN_REPO = ".vetta/design-templates.json"
```

### 3.2 刷新策略

- 缓存键 `CACHE_KEY = "design-catalog/latest"`,存在插件的持久化存储里。
- `REFRESH_TTL_MS = 5 * 60 * 1000`(5 分钟 TTL);`REQUEST_TIMEOUT_MS = 15_000`(15 秒超时)。
- **ETag 条件请求**:请求带 `If-None-Match`;返回 **304** 时只刷新 `fetchedAt` 不重写正文(命中则继续用本地缓存内容)。
- `refreshDesignCatalog(ctx, now, { force })`:`force` 由用户在设计页点「刷新」触发,绕过 TTL;首源失败自动切 jsDelivr 兜底(jsDelivr 对 `@main` 有 12 小时分支解析缓存,所以只作兜底)。

### 3.3 清单结构校验(`parseRemoteCatalog`,remote-catalog.ts)

- 顶层必须 `schemaVersion === 1` 且 `templates` 为数组。
- 逐条过滤:**未知 `kind` 跳过**;slug 必须匹配 `/^[a-z0-9][a-z0-9-]{0,63}$/`;资源 `role` 限 `spec | theme | demo | cover | preview | package`。
- **文本 vs 二进制**:文本资源内容**内联在清单里**(`encoding: "text"` + `content`);二进制资源只在清单里存**同 host 的 https URL**(`encoding: "binary"` + `url`,host 必须是白名单内的两个),**用户选中后才下载**。
- 必填约束:必须有 `spec`(DESIGN.md 正文,且**不能以 `---` 开头**,避免与 frontmatter 混淆)和 `theme`(必须含 `@theme`)。
- 上限:200 条目 / 每条目 60 资源 / 单资源 8MB / spec 64KB / theme 32KB。

### 3.4 运行时注册表(`registry.ts`)

- 挂在 `globalThis.__vettaUiDesignSystemRegistry__` 上,带 `loading / ready / failed` 三态。
- React 侧通过 `useDesignSystems()` / `useCatalogState()` 消费。

### 3.5 清单真实结构(实测拉取)

```jsonc
{
  "schemaVersion": 1,
  "name": "vetta-design-templates",
  "displayName": "Vetta Design Templates",
  "repository": "https://github.com/openvetta/vetta-design-templates",
  "minPluginVersion": "0.4.0",
  "templates": [
    {
      "kind": "design-system",
      "slug": "linear",
      "name": "Linear",
      "version": "1.1.0",
      "order": 10,
      "category": "dev",
      "vibe": "dark",
      "tags": ["dev", "dark"],
      "blurb": "Dark, dense, engineered dev-tool calm; …",          // 给模型做推荐,不展示
      "tagline": { "en": "…", "zh": "暗色高密度,工程师的冷静秩序" },  // 双语必填
      "license": "MIT",
      "origin": { "type": "curated", "upstream": "https://github.com/VoltAgent/awesome-design-md", "note": "…" },
      "collectedAt": "2026-08-11",
      "assets": { "spec": "DESIGN.md", "theme": "theme.css", "demo": "demo.html" },
      "resources": [
        { "path": "DESIGN.md", "role": "spec", "bytes": 2200, "encoding": "text", "content": "# Linear — Vetta Edition…" },
        { "path": "demo.html", "role": "demo", "bytes": 23865, "encoding": "text", "content": "<!doctype html>…" },
        { "path": "theme.css", "role": "theme", "bytes": 600, "encoding": "text", "content": "@theme { … }" },
        { "path": "screenshots/home.webp", "role": "cover", "bytes": 48112, "encoding": "binary", "url": "https://raw.githubusercontent.com/…/templates/linear/screenshots/home.webp" }
      ]
    }
  ]
}
```

---

## 4. 展示 UI(gallery 组件族)

| 组件 | 文件 | 要点 |
| --- | --- | --- |
| GalleryView | [src/gallery/GalleryView.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/gallery/GalleryView.tsx) | home/projects 两种视图、刷新按钮、`onCreateFromSystem` |
| DesignSystemGrid | [src/gallery/DesignSystemGrid.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/gallery/DesignSystemGrid.tsx) | 3 列宫格、hover 激活 demo 播放、6 个 loading 骨架、离线重试按钮 |
| DesignSystemDetailDialog | [src/gallery/DesignSystemDetailDialog.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/gallery/DesignSystemDetailDialog.tsx) | `parsePreviewTokens` 解析 theme.css 出**配色条**、demo 自动滚动、资源数/许可/来源展示、`Use {{name}}` 按钮 |
| DesignSystemTileContent | [src/cards/DesignSystemTileContent.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/cards/DesignSystemTileContent.tsx) | 宫格卡片 |
| DesignSystemDemo | [src/gallery/DesignSystemDemo.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/gallery/DesignSystemDemo.tsx) | iframe `sandbox="allow-same-origin"`(**仅此一项,无脚本权限**)、`srcDoc`、`DEMO_WIDTH=1280`、transform 缩放、CSS animation 滚动 110px/s、**进视口才挂载** |
| TemplateGalleryDialog | [src/cards/TemplateGalleryDialog.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/cards/TemplateGalleryDialog.tsx) | 画布入口 + 会话「更多」菜单共用;点卡选中、底部「应用」;经 `PluginPortal` 逃出消息列表;`appliedId` 打「当前」徽标 |
| 画布侧入口 | [src/canvas/DesignSystemDialog.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/canvas/DesignSystemDialog.tsx) | 复用 TemplateGalleryDialog,restyle / overwrite / restore 三种二次确认 |
| open-demo | [src/gallery/open-demo.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/presets/vetta-ui-design/src/gallery/open-demo.ts) | demo HTML 经 `command.run("node", …)` 写系统临时目录再用默认浏览器打开(HTML 走 env 不进 argv) |

**注意**:demo 所在的 sandbox iframe 不给脚本执行权,因此内容仓库对 `demo.html` 有硬校验:不许 `<script>`、不许外链样式表/图片、不许 `@import`、不许 `src/href="https://…"`。

---

## 5. 落盘链路

### 5.1 画廊「从风格开工」(`src/gallery/start-from-system.ts`)

```
用户点「Use {{name}}」→ createDesignProject(建项目)→ writeResources()
  → 写入 design-resources/<system.id>/          // 目录名 = 清单 slug
     · 文本资源直接写盘;spec 角色额外拼 frontmatter(见下)
     · 二进制资源经 ctx.network.request(url, { responseType: "base64" }) 下载(20s 超时)
       只发生在用户选中该体系之后
  → 写 INDEX.md(RESOURCE_INDEX_FILE,按角色附英文使用提示)
  → navigation.open({ target: "new-session", draft })
    draft 前缀 = "@skill:vetta-ui-design "       // 见 src/gallery/open-project.ts
```

### 5.2 frontmatter 拼接(`designMdWithFrontmatter()`,src/design-systems/apply.ts)

写盘时给 `DESIGN.md` 补上 YAML frontmatter,**四个字段**:

| 字段 | 值 |
| --- | --- |
| `system` | 体系 slug |
| `name` | 体系 name |
| `source` | 缺省 `https://github.com/VoltAgent/awesome-design-md`,manifest 的 `origin.upstream` 优先 |
| `license` | 缺省 `MIT`,manifest 的 `license` 优先 |

### 5.3 画布 apply(`applyDesignSystem`,src/design-systems/apply.ts)

- **备份**:先把工作区拷到 `.snapshots/design-system-backup`(scope:`theme.css` / `DESIGN.md` / `frames/` / `components/`)。
- **direct 模式**:工作区零 frame → 直接把 `theme.css` 写为工作区主题。
- **restyle 模式**:有 frame → 写 `DESIGN.md`,并经 `buildRestylePrompt()` 构造 prompt 发给 agent 全量重设(中/英双语文案)。

### 5.4 agent 消费协议(`agent/skills/vetta-ui-design/SKILL.md`)

`design-resources/<slug>/` 参考包协议(约 239 行起):先读 `INDEX.md` → `DESIGN.md`;`vetd_create` 后把 `theme.css` 拷入设计;首帧前读 demo HTML / 截图;**只作视觉参考,不抄代码**。

---

## 6. 宿主侧支撑(workspace-view 插槽)

「设计体系画廊」是**整页 workspace view**,需要宿主提供完整插槽基础设施(open-vetta 在 `apps/desktop/src/renderer/`):

| 宿主文件 | 职责 |
| --- | --- |
| [domains/plugins/runtime/workspace-view-registry.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/plugins/runtime/workspace-view-registry.ts) | 注册表:导航 key、路由 path(`/workspace/<pluginId>/<viewId>`)、查找 |
| [domains/plugins/components/PluginWorkspaceViewRoute.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/plugins/components/PluginWorkspaceViewRoute.tsx) | 路由渲染 + 错误边界 + loading/missing 文案 |
| [domains/plugins/components/PluginGlobalSlotHost.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/plugins/components/PluginGlobalSlotHost.tsx) | 汇总所有插件的 `plugin.workspaceViews` 进 atom |
| [domains/plugins/components/WorkspaceViewHeaderSlot.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/plugins/components/WorkspaceViewHeaderSlot.tsx) | 页面头部插槽(标题/左/右侧/隐藏) |
| [domains/project/components/sidebar/useSidebarModel.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/project/components/sidebar/useSidebarModel.ts) | **workspace view → 侧边栏导航项**;`DEFAULT_PINNED_NAV_KEYS = ["/abilities", workspaceViewNavKey("vetta-ui-design", "gallery")]` —— 画廊**默认钉在左侧主导航** |
| [shared/store/plugin-atoms.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/shared/store/plugin-atoms.ts) | `pluginWorkspaceViewsAtom`、`pluginWorkspaceViewHeadersAtom`、`workspaceViewHeaderKey()` |
| [shared/app-shell/page-header/usePageHeaderModel.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/shared/app-shell/page-header/usePageHeaderModel.ts) | 头部读取 workspaceViewHeader |
| [root-layout/RootLayoutView.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/root-layout/RootLayoutView.tsx) | immersive 头部叠加 |
| [domains/abilities/lib/plugin-permission-labels.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/apps/desktop/src/renderer/domains/abilities/lib/plugin-permission-labels.ts) | 权限展示文案 `ui.slot.workspace-view` |
| 插件 SDK [plugin-sdk/src/ui.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/open-vetta/packages/plugins/plugin-sdk/src/ui.ts) | `registerWorkspaceView()` API(缺 `ui.slot.workspace-view` 权限 = warn+noop) |

对应 i18n:`shared/i18n/locales/{en,zh}/abilities.json`(workspaceView 权限说明)、`project.json`(`workspaceView.loading/missing/failed`)。

---

## 7. 完整数据流(一图流)

```
[打开侧边栏 Design tab / 启动 app]
   → activate → refreshDesignCatalog(ctx)
   → GET raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json
        (ETag 条件请求;TTL 5min;失败切 jsDelivr 兜底)
   → parseRemoteCatalog schema 校验(schemaVersion=1, slug/role/必填 spec+theme, 尺寸上限)
   → 写 globalThis.__vettaUiDesignSystemRegistry__ + 持久缓存 "design-catalog/latest"
   → useDesignSystems() 驱动 GalleryView / DesignSystemGrid(骨架 → 宫格)

[展示] 卡片 hover → DesignSystemDemo iframe(srcDoc, sandbox 仅 allow-same-origin)播放 demo
       DetailDialog → parsePreviewTokens(theme.css)渲染配色条;「用浏览器打开」走 open-demo.ts

[挑选] 两条分支:
  A. 「从风格开工」→ createDesignProject → 落盘 design-resources/<slug>/:
       文本直写+spec 补 frontmatter(system/name/source/license)
       二进制走 ctx.network.request(base64) → 写 INDEX.md
       → navigation.open 新会话,draft="@skill:vetta-ui-design 请按「Name」风格…"
  B. 画布侧 DesignSystemDialog(复用 TemplateGalleryDialog)→ applyDesignSystem:
       备份 .snapshots/design-system-backup → 零 frame 直写 theme.css(direct)
       有 frame 写 DESIGN.md + buildRestylePrompt → agent 全量重设(restyle)

[agent 参考] SKILL.md 协议:INDEX.md → DESIGN.md → vetd_create 后拷 theme.css → 首帧前看 demo/截图
```

---

## 8. 关键结论(移植时直接引用)

1. 侧边栏「设计」入口 = activity tab id **`canvas`**;模板库画廊 = workspace view id **`gallery`**,默认钉在主导航。
2. 清单 URL 的 owner/repo/分支 = **`openvetta/vetta-design-templates`** + **`main`**,路径 `.vetta/design-templates.json`;raw 首选、jsDelivr 兜底。→ astravia 需把 owner/repo 换成 `maomaochong-ai/astravia-design-system-templates`。
3. 插件权限是链路先决条件:`network.fetch` + `storage.read/write` + `network.allowedHosts`(两个 CDN host)+ `ui.slot.workspace-view`。
4. frontmatter 四字段 `system/name/source/license`;`design-resources/<slug>/` 是「从风格开工」产物,不是 apply 产物。
5. demo.html 必须通过 4 条 sandbox 硬校验(无 script / 无外链 / 无 @import / 无 https 引用),这是内容仓库侧的关键合规约束。
6. 宿主 workspace-view 插槽是一整套基础设施(注册表/路由/侧边栏/头部/权限文案),**astravia 已整体删除,需按上游清单恢复**。
