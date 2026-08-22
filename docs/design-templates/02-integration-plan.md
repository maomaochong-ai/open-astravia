# astravia 侧边栏设计功能:整合方案与实施计划

> 目标:在 astravia 中恢复「侧边栏设计」完整功能 —— 用户能从 Design 工作台选择风格模板(来自**自己的**模板仓库),「从风格开工」建设计项目,或在画布上套用设计体系。
> 文档编号:02 · 前置阅读:同目录 [`01-upstream-sidebar-design-analysis.md`](01-upstream-sidebar-design-analysis.md)
> 日期:2026-08-22

---

## 1. 决策记录(用户已确认)

| # | 决策点 | 结论 |
| --- | --- | --- |
| D1 | 内容仓库基底 | 新建本地仓库 `/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia-design-system-templates`(已存在,origin 已指向 `https://github.com/sikongyue/astravia-design-system-templates.git`),**以 vetta-design-templates 为基底**,把 brands-design-md 的 69 个品牌改造并入 |
| D2 | 重叠品牌 | 11 个与 vetta 24 模板 slug 重叠的品牌(airbnb、apple、duolingo、figma、linear、notion、shopify、slack、spotify、stripe、vercel)**以 brands-design-md 版本为准**,覆盖 vetta 原条目 |
| D3 | 应用侧集成 | **方案 B:全量对齐上游** —— 恢复宿主 workspace-view 插槽基础设施 + 插件侧模板库,与上游形态一致(侧边栏主导航固定「设计体系」入口) |

---

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│ 内容仓库:astravia-design-system-templates(新,GitHub 远端)        │
│   templates/<slug>/{meta.json, DESIGN.md, theme.css, demo.html} │  ← 唯一事实源
│   scripts/build-catalog.mjs  →  .vetta/design-templates.json     │  ← 生成物,CI 校验
└──────────────────────────────┬─────────────────────────────────┘
                               │ raw.githubusercontent.com(首选)
                               │ cdn.jsdelivr.net(兜底)
┌──────────────────────────────▼─────────────────────────────────┐
│ astravia 桌面端(monorepo)                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 宿主侧(desktop-app)                                      │  │
│  │  · workspace-view 插槽基础设施(注册表/路由/侧边栏/头部)     │  │  ← 按上游恢复
│  │  · 权限展示文案 + i18n(abilities/project 文案)             │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│  ┌──────────────────────▼───────────────────────────────────┐  │
│  │ 插件侧(astravia-ui-design 插件)                          │  │
│  │  · design-systems/(目录拉取/校验/缓存/apply)              │  │  ← 按上游恢复 + 改名
│  │  · gallery/ + cards/(画廊 UI/详情/开工)                   │  │
│  │  · catalog URL → sikongyue/astravia-design-system-templates│  │
│  │  · plugin.json 权限补齐 + i18n key 补齐                    │  │
│  │  · SKILL.md 补 design-resources 协议                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**两个工作仓库互不依赖**:内容仓库改了模板,应用侧 5 分钟 TTL(或手动刷新)后即可看到;应用侧代码改动与内容无关。

---

## 3. 第一部分:内容仓库 `astravia-design-system-templates`

### 3.1 基底搭建(拷贝 vetta-design-templates 机制)

在空仓库目录内执行(保持空 history,全新提交):

```
astravia-design-system-templates/
├── AGENTS.md                  ← 照搬 vetta-design-templates(作者手册,每条规则对应硬校验)
├── README.md                  ← 改写:Astravia 版,中文说明 + 指向 vetta-design-templates 与 brands-design-md 两个来源
├── LICENSE                    ← 照搬(MIT)
├── scripts/build-catalog.mjs  ← 照搬(聚合 + 硬校验脚本)
├── .github/workflows/catalog.yml ← 照搬(CI 跑 node scripts/build-catalog.mjs --check,Node 22)
├── .vetta/design-templates.json  ← 生成物(禁止手改,CI --check 校验与 templates/ 同步)
└── templates/
    └── <slug>/{meta.json, DESIGN.md, theme.css, demo.html}
```

### 3.2 品牌转换:brands-design-md(69) → templates/

写一次性转换脚本 `scripts/convert-brands.mjs`(只读 brands-design-md → 生成 `templates/<slug>/`),逐品牌产出 4 个文件:

#### 3.2.1 meta.json(字段映射)

brands-design-md 的 `registry.json` 提供 11 个字段,8 个字段新增/需决策:

| meta.json 字段 | 来源 | 说明 |
| --- | --- | --- |
| `schemaVersion: 1` | 固定 | |
| `slug` | 目录名 | **5 个带点目录需改名**(见 §3.3) |
| `name` | registry `name` | |
| `version` | 固定 `1.0.0` | 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` |
| `order` | 新增 | 非负整数全局唯一,与现有条目交错(10 间隔),**不与 vetta 24 条冲突** |
| `category` | registry 自由文本 → 归一化 | 映射为 12 个单值:dev/fintech/playful/editorial/retro/ai/media/consumer/creative/productivity/premium/commerce |
| `vibe` | 从 theme.css 主背景亮度推断 | light/dark 二选一 |
| `tags` | registry tags → 规范 | 小写字符串数组 |
| `blurb` | 新增 | 英文一句摘要,给模型推荐用 |
| `tagline` | en 新增 / **zh 需翻译** | 双语必填,zh 为 69 条人工/AI 翻译 |
| `license` | 新增,**决策点** | 建议统一 `MIT`(仓库自身内容),见 §7 风险 3 |
| `origin` | 新增 | `{ type: "curated", upstream: "https://github.com/sikongyue/brands-design-md", note: "from brands-design-md" }`;对 "Inspired" 变体在 note 注明改编自原品牌 |
| `assets` | 固定 | `{ spec: "DESIGN.md", theme: "theme.css", demo: "demo.html" }` |
| `collectedAt` | 新增 | 转换日期 `2026-08-22` |

#### 3.2.2 文件转换(每个品牌)

| 品牌文件 | 目标 | 改造 |
| --- | --- | --- |
| `DESIGN.md` | `DESIGN.md` | 去除 YAML frontmatter(如品牌文件有);检查乱码字符;可选按 vetta 章节结构评审重写(不强求,先保内容完整) |
| `theme.css` | `theme.css` | **必须补 7 个基础 token**(`--color-primary` / `--color-primary-foreground` / `--color-surface` / `--color-surface-foreground` / `--color-muted` / `--color-accent` / `--color-danger`)+ `@theme` 块。现状:primary 46 个品牌已有、muted 19、surface 4、accent/danger 各 2、两个 foreground 0 —— 需按品牌语义半自动补全(`previewColors` + 已有 `--color-*` 命名映射) |
| `preview.html` | `demo.html` | 合规化改造(4 条 sandbox 硬校验):删 `<script>`、删外链 `<link rel=stylesheet>`、删 `src/href="https://…"`(品牌真实链接量大)、删 `@import`;自动化删减 + 人工抽查。可选增强:封面用最典型产品界面 + off-style 对照 + 移动端小节(vetta 规范建议,不强求) |
| `tokens.json` / `variables.css` / `cover_*.webp` / `favicon.*` | 自动并入 resources | 无需声明,文本 ≤256KB 内联、二进制按需下载,自动进目录 |
| — | `INDEX.md` 不需要 | INDEX.md 是客户端落盘时生成的,仓库里没有 |

#### 3.2.3 重叠 11 个品牌(D2)

跳过 vetta 的 11 条同名目录,直接以 brands 版本覆盖(改名后的 slug 不同则同时保留两个)。注意:brands 版本若在 vetta 里不存在 slug 冲突,无需改名。

### 3.3 slug 处理

- 5 个带点目录(如 `facebook.com` 类)→ 改成 `^[a-z0-9][a-z0-9-]{0,63}$` 格式,并在 `origin.note` 注明原名。
- 15 个 "Inspired" 变体:建议统一规范为「品牌名」+ `origin.note` 注明改编(而不是 `stripe-inspired` 这类 slug),避免风格库出现 15 对相似条目。
- 全部 69+24 条 `order` 全局唯一。

### 3.4 目录生成与 CI

1. 转换脚本产出全部 `templates/<slug>/`。
2. `node scripts/build-catalog.mjs` 生成 `.vetta/design-templates.json`(catalogVersion 自动递增为 `2026.08.22-01`)。
3. 本地 `node scripts/build-catalog.mjs --check` 通过(等价 CI 门槛)。
4. 首次提交 + `git push -u origin main` 推送到 `sikongyue/astravia-design-system-templates.git`。
5. 后续每次模板改动:改 `templates/` → 重新生成 catalog → 提交两者 → CI 校验。

### 3.5 内容仓库验证

- `node scripts/build-catalog.mjs --check` 零错误。
- 抽查 3-5 个品牌:浏览器直接打开 `demo.html` 无脚本报错、无外链请求。
- 用脚本模拟 `parseRemoteCatalog` 校验(尺寸上限、slug/role 白名单、spec 无 frontmatter、theme 含 @theme + 7 token)。

---

## 4. 第二部分:astravia 应用侧集成(方案 B:全量对齐上游)

### 4.0 现状差异(已核实)

| 模块 | 上游(open-vetta) | astravia 现状 |
| --- | --- | --- |
| `design-systems/`(9 文件:catalog-sync/remote-catalog/registry/apply/labels/preview-tokens/types…) | ✅ | **整块删除**,全仓库 grep `design-templates`/`design-resources` 零命中 |
| `gallery/`(22 文件:GalleryView/DesignSystemGrid/DetailDialog/start-from-system…) | ✅ | **整块删除** |
| `cards/TemplateGalleryDialog` 等 | ✅ | **删除** |
| history/、notes/、preview-mode/、12 个 vetd 工具 | ✅ | **删除** |
| 插件 plugin.json 权限 | 齐全 | 缺 `network.fetch`/`storage.read`/`storage.write`/`ui.slot.workspace-view` 等 |
| 宿主 `ui.slot.workspace-view` 插槽 | ✅ 完整 | **零实现**(registry/route/sidebar/header/atom 全缺) |
| i18n `gallery.*`/`controlbar.designSystems`/`ds.*` | ✅ 完整 | **零 key** |
| 相关测试 | 75 个 | 0 个 |

### 4.1 宿主侧恢复(desktop-app,包 `packages/desktop-app`)

按上游文件映射移植到 astravia 对应位置(两边 `renderer/domains/` 结构一致,主要是 `plugins/`、`project/`、`shared/`、`root-layout/`):

| 上游文件(apps/desktop/src/renderer/…) | astravia 目标(packages/desktop-app/src/renderer/…) | 说明 |
| --- | --- | --- |
| `domains/plugins/runtime/workspace-view-registry.ts` (+test) | 同路径 | 注册表:导航 key / 路由 `/workspace/<pluginId>/<viewId>` |
| `domains/plugins/components/PluginWorkspaceViewRoute.tsx` | 同路径 | 路由渲染 + 错误边界 |
| `domains/plugins/components/WorkspaceViewHeaderSlot.tsx` (+test) | 同路径 | 头部插槽 |
| `domains/plugins/components/PluginGlobalSlotHost.tsx`(workspaceViews 汇总段) | 同路径(若已存在则增量) | 汇总 `plugin.workspaceViews` → atom |
| `domains/project/components/sidebar/useSidebarModel.ts`(workspace-view 段) | 同路径(增量合并) | workspace view → 侧边栏导航项;`DEFAULT_PINNED_NAV_KEYS` 加 `workspaceViewNavKey("astravia-ui-design", "gallery")` |
| `shared/store/plugin-atoms.ts`(workspace atoms) | 同路径(增量) | `pluginWorkspaceViewsAtom`、`pluginWorkspaceViewHeadersAtom`、`workspaceViewHeaderKey()` |
| `shared/app-shell/page-header/usePageHeaderModel.ts`(header 读取段) | 同路径(增量) | 头部标题/左侧/隐藏 |
| `root-layout/RootLayoutView.tsx`(immersive 段) | 同路径(增量) | 头部叠加 |
| `domains/abilities/lib/plugin-permission-labels.ts`(workspace-view 段) | 同路径(增量) | 权限展示文案 |
| `shared/i18n/locales/{en,zh}/abilities.json`(workspaceView 段) | 对应 astravia i18n 文件 | `ui.slot.workspace-view` 权限说明 |
| `shared/i18n/locales/{en,zh}/project.json`(workspaceView.*) | 对应 astravia i18n 文件 | `workspaceView.loading/missing/failed` |
| plugin-sdk `ui.ts` `registerWorkspaceView()` | 若 astravia SDK 已删则恢复 | 无 `ui.slot.workspace-view` 权限 = warn+noop |

> 注:astravia 的 desktop-app 与上游包布局不同(`packages/desktop-app` vs `apps/desktop`),但 renderer 内部域结构一致。逐文件核对上游实现,把删除/缺失的段落增量合并回 astravia 对应文件;不要整文件覆盖,避免覆盖 astravia 已改过的部分(dbx 集成、AI 侧边栏等)。

### 4.2 插件侧恢复(astravia-ui-design 插件)

插件目录:`packages/plugins/presets/astravia-ui-design/`(位于 astravia monorepo)。按上游 `packages/plugins/presets/vetta-ui-design/` 恢复并改名:

| 恢复项 | 上游文件 → astravia | 改名/适配点 |
| --- | --- | --- |
| design-systems/ | 9 文件整体恢复 | `@skill:vetta-ui-design` → `@skill:astravia-ui-design`(draft 前缀) |
| gallery/ | 22 文件整体恢复 | 同上 |
| cards/(TemplateGalleryDialog/DesignSystemTileContent/SwiperShell) | 恢复 | 同上 |
| plugin-portal.tsx | 恢复 | — |
| tab-ids.ts | 已有(canvas) | 保持 `canvas` 不变 |
| tools.ts(vetd_* 工具) | 已有 | 追加画廊所需(若有新增) |
| ability.json / engine routes | 恢复 | 插件路由注册 |
| SKILL.md(agent/skills/astravia-ui-design/) | 补 design-resources 协议段 | 对应 §5.4 上游协议 |
| test/ 75 个 | 恢复并适配 | 改插件 id/label/i18n key 断言 |

**关键改动点(改名之外)**:

1. **清单 URL**(design-systems/catalog-sync.ts):
   ```ts
   DESIGN_CATALOG_SOURCES = [
     "https://raw.githubusercontent.com/sikongyue/astravia-design-system-templates/main/.vetta/design-templates.json",
     "https://cdn.jsdelivr.net/gh/sikongyue/astravia-design-system-templates@main/.vetta/design-templates.json",
   ]
   ```
2. **plugin.json 权限补齐**(先决条件):
   ```jsonc
   {
     "permissions": [ "network.fetch", "storage.read", "storage.write", "ui.slot.workspace-view", /* 其余照上游 */ ],
     "network": { "allowedHosts": ["cdn.jsdelivr.net", "raw.githubusercontent.com"] }
   }
   ```
3. **i18n key 补齐**:照上游 `gallery.*`、`ds.*`、`tool.vetd_*`、`controlbar.designSystems` 整套补进 astravia 插件 locale(en + zh)。**注意 `ds.tagline.<id>` 是动态 key**,新增体系不需要动 key,但文案本身在清单里。
4. **运行时注册表改名**:`globalThis.__vettaUiDesignSystemRegistry__` → `__astraviaUiDesignSystemRegistry__`(保持单例语义即可,不强求)。

### 4.3 端到端验证

- `bun run check`(含 desktop-app tsc)零错误。
- `bun run verify:ui:*`(隔离入口)手工走查:
  1. 侧边栏主导航出现「设计体系」入口(workspace-view 画廊);
  2. 画廊加载出新仓库目录(69+ 条),卡片 hover 播 demo;
  3. 详情对话框配色条正确;
  4. 「从风格开工」→ 新会话 draft 前缀 `@skill:astravia-ui-design`,`design-resources/<slug>/` 落盘正确(frontmatter 四字段);
  5. 画布侧 DesignSystemDialog apply:direct(零 frame)/ restyle(有 frame)/ 备份与恢复;
  6. 断网/首源失败 → jsDelivr 兜底;TTL 与手动刷新正常。
- 插件侧测试 `bun run test:pkg`(涉及插件包时按包脚本)。

---

## 5. 实施计划(阶段与任务)

### 阶段 P1:内容仓库改造(独立,可先行)

| 任务 | 验证 |
| --- | --- |
| P1.1 拷贝 vetta-design-templates 机制(AGENTS/README/LICENSE/build-catalog.mjs/CI) | 目录结构完整 |
| P1.2 写 `scripts/convert-brands.mjs`(读 brands-design-md registry + 品牌目录 → 生成 templates/) | 69 个 slug 目录 + 4 文件齐 |
| P1.3 逐品牌转换:theme.css 补 7 token、preview.html → demo.html 合规化、meta.json 生成、tagline.zh 翻译 | 抽样检查 + 全量 `--check` |
| P1.4 重叠 11 个品牌以 brands 覆盖;5 个带点 slug 改名;Inspired 变体规范 | 无 slug 冲突、order 唯一 |
| P1.5 `node scripts/build-catalog.mjs` 生成目录 + `--check` 通过 | CI 等价门槛 |
| P1.6 首提 + push 到 sikongyue/astravia-design-system-templates.git | GitHub 可见,CI 绿 |
| P1.7 用 `parseRemoteCatalog` 同款规则自测清单 | 模拟校验零错误 |

### 阶段 P2:宿主 workspace-view 插槽恢复

| 任务 | 验证 |
| --- | --- |
| P2.1 移植 workspace-view-registry + PluginWorkspaceViewRoute + 路由接线 | 手动访问 `/workspace/astravia-ui-design/gallery` 可渲染 |
| P2.2 移植 PluginGlobalSlotHost 汇总段 + plugin-atoms workspace atoms | atom 有数据 |
| P2.3 侧边栏 useSidebarModel workspace-view 导航项 + 默认钉住 | 侧边栏出现「设计体系」入口 |
| P2.4 头部插槽 WorkspaceViewHeaderSlot + usePageHeaderModel + RootLayout immersive | 画廊页头部正确 |
| P2.5 权限文案 + i18n(abilities/project) | 权限详情页显示 workspaceView 说明 |
| P2.6 恢复 SDK `registerWorkspaceView`(若缺失) | 插件注册不 warn |

### 阶段 P3:插件侧模板库恢复

| 任务 | 验证 |
| --- | --- |
| P3.1 恢复 design-systems/ + gallery/ + cards/(含测试)并改名 astravia 化 | 编译 + 单测通过 |
| P3.2 catalog URL 改指向新仓库 + plugin.json 权限补齐 | 画廊拉到新目录 |
| P3.3 i18n key 补齐(en/zh) | 无硬编码文案 |
| P3.4 SKILL.md 补 design-resources 协议 | agent 消费正常 |
| P3.5 端到端走查(§4.3 六步) | verify:ui 通过 |

### 阶段 P4:收尾

| 任务 | 验证 |
| --- | --- |
| P4.1 `bun run check` 全绿 + CHANGELOG 补记 | check 零错误 |
| P4.2 更新文档(本计划落地情况、README) | 一致 |
| P4.3 视需要发 release | 版本统一 |

### 工作量粗估

| 阶段 | 相对量 | 说明 |
| --- | --- | --- |
| P1 内容仓库 | 大 | 机械但量大:69 份 meta/token/翻译/合规化;一次性转换脚本后多为半自动 |
| P2 宿主插槽 | 中 | 增量合并 ~10 个文件 + i18n + 测试 |
| P3 插件模板库 | 中 | 恢复 + 改名,文件多但多为拷贝适配 |
| P4 收尾 | 小 | check + 文档 |

---

## 6. 执行顺序建议

1. **先 P1(内容仓库)**:它独立、可立即开始,且是应用侧联调的前提(画廊要拉新仓库目录才有内容)。
2. **P2 与 P3 可并行**(宿主与插件不同包,改动文件无交集);并行时注意**不要动对方文件**。
3. P3.2 依赖 P1.6(URL 对应的远端仓库必须已有内容);若 P1 未完成,可先指向本地/临时分支验证。

---

## 7. 风险与待决策事项

| # | 事项 | 建议 | 状态 |
| --- | --- | --- | --- |
| 1 | brands-design-md **无 LICENSE 文件**,69 品牌内容许可未声明(自述 unofficial/inspired,部分为抓取来源) | 仓库自产内容统一 MIT;每个条目的 `origin.note` 注明来源;涉及第三方素材的条目在 meta.origin 里写明 upstream | **需用户拍板** |
| 2 | 15 个 "Inspired" 变体入库策略 | 规范为品牌名 + note 注明改编,不单独成 slug | 已建议,可再确认 |
| 3 | 5 个带点 slug 改名 | 自动规范化,note 注明原名 | 已建议 |
| 4 | demo.html 合规化后视觉质量下降(删了 script/外链) | 第一版接受,后续按 vetta 规范逐条重写封面 | 接受 |
| 5 | tagline.zh 69 条翻译质量 | AI 批量翻译 + 人工抽查 | 接受 |
| 6 | 宿主移植与 astravia 既有改动(dbx、AI 侧边栏)冲突 | 增量合并而非整文件覆盖;P2 单独验证 | 计划内 |
| 7 | `minPluginVersion` 兼容校验在宿主端 | 确认 astravia 插件加载器是否校验;不行则同步 bump | 待核实 |
| 8 | 新仓库 CI(GitHub Actions)首次运行需 Node 22 | workflows/catalog.yml 照搬即含 | 无风险 |

---

## 8. 附录:上游关键文件索引

内容仓库(vetta-design-templates):
- `templates/<slug>/`、`scripts/build-catalog.mjs`、`AGENTS.md`、`.github/workflows/catalog.yml`

插件(open-vetta/packages/plugins/presets/vetta-ui-design/):
- `src/index.tsx`(注册)、`src/tab-ids.ts`(canvas)、`src/tools.ts`(vetd_*)、`src/design-systems/`(catalog-sync/remote-catalog/registry/apply)、`src/gallery/`(22 文件)、`src/cards/`、`plugin.json`、`agent/skills/vetta-ui-design/SKILL.md`

宿主(open-vetta/apps/desktop/src/renderer/):
- §6 表格所列 workspace-view 全套

---

## 9. 定义/术语

| 术语 | 含义 |
| --- | --- |
| activity tab | 活动面板(侧边栏左侧图标栏)内的页面,如「设计」(id=canvas) |
| workspace view | 插件贡献的整页视图,宿主给独立路由 `/workspace/<pluginId>/<viewId>` + 侧边栏导航项 |
| catalog | 模板目录清单 `.vetta/design-templates.json`,生成物 |
| design-resources | 「从风格开工」时客户端落盘的参考资源目录 `design-resources/<slug>/` |
| apply / start-from-system | 画布套用 / 开工建项目,两条消费链路 |
