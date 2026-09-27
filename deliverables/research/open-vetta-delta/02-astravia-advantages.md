# 02 · astravia 自有更优 / 分叉差异

> 范围：astravia 走**与上游不同路线**的选择。这些**不**同步给上游，要评估的是「astravia 更合理」还是「fork 期临时路径、未来需再决断」。
> 第三次对比修订：重写 01/02 的交叉错误。核心修正——open-vetta **完全没有 database 功能**（不是"走 office-viewer 插件适配"）；`file-preview` 两边都有，不是 astravia 独有；包数量从 19/26 修正为 22/29；preset 差异从 3 个修正为 5 个；shared 层差距比原文暗示的大 10 倍。

---

## 修正前提：上次对比的 6 处事实错误

| 项 | 上次说法 | 本次修正 |
|---|---|---|
| open-vetta database 渲染层 | "无（走 office-viewer 插件适配）" | **open-vetta 主进程和渲染层均无 database/ 目录**，完全没有数据库功能。office-viewer 只是 office 文件预览插件，与 database 无关 |
| `file-preview` | 隐含为 astravia 独有 | **两边都有**——渲染层 `file-preview/` 目录 + 主进程对应逻辑一一对应 |
| 包数量 | "astravia 19 纯库 ⊂ open-vetta 26 纯库" | astravia **22** 个 vs open-vetta **29** 个（open-vetta 多 `agent-team`、`runtime-*` 系列、`markdown` 等；astravia 把 `cli-app`/`desktop-app`/`im-gateway` 放在 packages/ 下，open-vetta 放在 apps/ 下） |
| preset 缺口 | "open-vetta 多 browser / comfyui / remotion 共 3 个" | open-vetta 多 **5 个**：`browser`、`build-apple-apps`、`comfyui-media-provider`、`preset-agent`、`remotion-renderer` |
| shared 层差距 | "astravia shared 只有 IPC 定义、无测试" | astravia shared/ **仅 7 个文件**（pet 相关 + projects-ipc + shortcuts），open-vetta shared/ **~60 个文件**（含 app-identity、session-access、plugin-ipc、telemetry、browser-policy 等完整边界层） |
| website/ vs docs-site | "astravia 已有 website/，需判断是重复建设还是可迁移" | 两者**完全不同**——`website/` 是 astravia 官网（page 框架，品牌展示），`apps/docs-site/` 是 open-vetta 的 Next.js 文档站。不存在重复问题 |

---

## 1. `database/` 全栈内置 —— astravia 独有的核心差异化

### 真实对比

| 层 | astravia | open-vetta |
|---|---|---|
| 渲染层 | `renderer/domains/database/`（完整的数据库工作区、连接管理、表结构浏览器、查询编辑器、查询结果网格、@mention 注入） | **无** |
| 主进程 | `main/database/`（database-service、连接管理、SQL 执行、schema 上下文、agent 访问守卫） | **无** |
| IPC | `main/ipc/database.ts`（list-connections / add-connection / test-connection / execute-query / get-schema-context 等 10+ channel） | **无** |
| 能力链配套 | `deliverables/dbx-mcp/` 下 6 份评估/设计/集成文档；git 历史里有 B2.8 数据库应用能力链、B3.2/B3.3 数据编辑与自由 SQL、生产写保护等决策 | **无**（数据库不是 open-vetta 的主战场，完全未进入其产品路线） |

**关键澄清**：open-vetta **根本不做数据库**，不存在"走 office-viewer 插件适配"这种替代方案。office-viewer preset 仅处理 Office 文件预览（docx/xlsx/pptx/pdf），与数据库连接管理、SQL 查询、schema 注入毫无关系。

**判断**：保留，视为**核心差异化而非技术债**。DBX MCP 是 astravia 相对上游最大的能力增量；若做成插件，配置漂移与 `docker exec` 行为变更会直接影响主仓稳定性。上游把它留给了自己的产品线——对 astravia 恰恰相反。

---

## 2. 品牌资产体系 —— astravia 唯一真正独有的 ADR

按主题名 diff 后确认：astravia **真正独有的 ADR 有 7 个主题**（上次说 1 个是低估）：

```
p5-brand-icon-handcrafted-star-track-with-safe-area.md
database-domain-layout-and-data-gateway-boundary.md
database-workspace-icon-standardization.md
sidebar-icon-differentiation.md
official-website-light-apple-design.md
astravia-file-static-protocol-pathname-carries-path.md
astravia-ui-design-vite-engine-over-pure-runtime.md
```

其中：
- `0055-p5-brand-icon-handcrafted-star-track-with-safe-area`：星轨意象（astra 星 + via 路）手工设计 + safe-area 规范，弃用 AI 生成占位，产出 `ICON-SPEC.md` 作为可复用品牌基线。**这是 astravia 唯一一条上游没有、且对长期有效的品牌决策**。
- `database-*` 两个：数据库领域的架构边界与 UI 规范。
- `sidebar-icon-differentiation`、`official-website-*`、`astravia-*-pathname`、`astravia-ui-design-*`：品牌分叉后的配套规范。

**配套**：
- `rebrand/` 下 15 个一次性脚本（`rename-vetta.mjs` / `gen-bins.mjs` / `dedupe-changelogs.mjs` 等）是品牌分叉的工程侧沉淀。
- 主题系统：astravia 多了 `packages/themes/builtin/xianxia/`（仙侠主题，含 artifact-library 页面、品牌化 input-bar 背景等），open-vetta 无对应内置主题。
- 官网：`website/`（@astravia/website，page 框架），与 open-vetta 的 `apps/docs-site/`（Next.js 文档站）是**两个完全不同的产品**。

**待决断**：`rebrand/` 放在主仓会让新人误以为是常规维护脚本。**建议迁到 `.workbuddy/tools/rebrand/`**，并在根 `AGENTS.md` 加指引，历史 commit 不动。

---

## 3. 桌面 UI 自验体系

astravia 独有脚本链：

```
verify:ui:start / :status / :attach / :pw -- <args> / :debug -- <args> / :detach / :stop
```

open-vetta 只有 `verify:ui:start` / `:status` / `:stop`。astravia 把「长驻 + 接入已有 dev 进程 + playwright 调试 + 分离」做齐了。

**判断**：自有即可，不强制回灌；若要回灌，单独开 PR 成本很低。

---

## 4. 无云依赖 —— 当下的简单，未来的债

### 真实对比

| 项 | astravia | open-vetta |
|---|---|---|
| main/cloud/ | **无** | 有（`auth/` + `gateway.ts` + `auth-session.ts` + `index.ts`） |
| main/cloud-bridge.ts | **无** | 有（运行期挂载点 + 动态 import） |
| shared/cloud-slots | **无** | 有（renderer 懒加载槽位） |
| shared/telemetry.ts / sentry-privacy.ts | **无** | 有（lite 构建排除项） |
| main/telemetry/ | **无** | 有（`product-events.ts` + `error-monitoring.ts` + `bootstrap.ts`） |
| cloud-boundary.test.ts | **无** | 有（测试强制架构边界） |
| lite/full 双构建 | **无开关** | 有（`VETTA_CLOUD_ENABLED=false` 控制死代码消除） |

**当下的好处**：
- 天然就是 lite，无死代码消除失效风险，无需维护双构建。
- 无遥测上报，私有化/离线交付场景少一层合规负担。

**代价（必须记下）**：
- astravia 现在**没有任何边界约定**。等真要接账号/订阅/云市场时，要么临时硬塞（散落各处、难拆），要么回头重做隔离——正是上游已经付过的学费。

**结论**：不要因为「现在没云」就跳过边界约定。正确顺序是**先立边界（空壳 + 测试），再谈开关**。见 01 的 #1。

---

## 5. 平台打包与更新校验

astravia 桌面独有脚本：

```
prepare:windows / prepare:windows:dev
verify:updates:windows / verify:updates:mac
prepare:dbx-mcp
```

上游走 `electron-updater` 在线升级，无对应项。

**判断**：fork 私有化交付要求「不连外网也能校验升级」，属**场景性保持**，不强求与上游对齐。但需与 01 的 #3（CI 升级回归）搭配看——有 `verify:updates:*` 脚本但 CI 里没有 upgrade E2E，是覆盖缺口。

---

## 6. `deliverables/` 决策文档分层

astravia 沉淀出 `deliverables/<主题>/<编号>-<角度>.md` 的归档格式（`dbx-mcp/` 6 份 + `research/open-vetta-delta/` 2 份 + 本目录 2 份）。上游未见对应结构。

配合 git 历史里的文档归位动作（「归位散落文档，调研/商业/插件/草稿移出 docs 目录」「统一中文文件名为英文 kebab-case」），说明这是**有意识的知识管理**，不是随手堆 md。

**判断**：保留。新增集成（国产库适配、离线包）应照此模板走。

---

## 优先级总览

```
已固化（保留，无需动作）：
  ├── #1 database/ 全栈内置（核心差异化）
  ├── #2 品牌体系（ADR-0055 + 主题 + 官网）
  ├── #3 verify:ui:* 体系
  └── #6 deliverables/ 归档格式

待决断（短期应处理）：
  └── #2 附带：rebrand/ 迁到 .workbuddy/tools/

需要警惕（不是优势，是待补的债）：
  └── #4 无云边界约定 → 见 01 的 #1

覆盖缺口（有脚本无 CI）：
  └── #5 verify:updates:* 有，但缺 upgrade E2E → 见 01 的 #3
```

---

## 跟 01 的对应关系

| 差异点 | 01（同步） | 02（自有） |
|---|---|---|
| database | — | 全栈内置，保留（open-vetta 根本不做） |
| cloud | 同步**边界约定与测试**（#1） | 无云代码本身是现状，非优势 |
| desktop-app vs apps/ | 按价值挑同步项 | 保持 packages/ 布局（open-vetta 用 apps/） |
| shared 层 | 同步 app-identity 等边界（#2） | 现状 7 文件 vs 上游 ~60 文件，差距大 |
| 桌面脚本 | 补 CI 升级回归（#3） | 保留 verify:ui:* / verify:updates:* |
| preset 差异 | 补 browser 等 5 个上游 preset | 保留 astravia-* 命名 |
| ADR | 按价值挑上游独有主题同步 | 保留 astravia 独有 7 个主题 |
| 主题系统 | — | 仙侠主题内置，保留 |
| 官网 vs 文档站 | — | 两个不同产品，website/ 是官网（保留） |
| 文档 | — | 保留 deliverables/ 格式 |

下一步建议：**先做 #4 对应的边界约定（即 01 的 #1）**——它是唯一一项「现在不做、以后必还」的债；其余已固化项保持现状即可。
