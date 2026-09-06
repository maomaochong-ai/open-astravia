# 02 · astravia 自有更优 / 分叉差异

> 范围：astravia 走**与上游不同路线**的选择。这些**不**同步给上游，要评估的是「astravia 更合理」还是「fork 期临时路径、未来需再决断」。
> 第二次对比修订：修正首次的 `file-preview` 误判，补充 `database` 的真实深度（主进程+渲染层双层）、无云依赖的真实代价。

---

## 1. `database/` 全栈内置 —— 首次低估了深度

首次只说了渲染层。实际 astravia 是**双层**：

| 层 | astravia | open-vetta |
|---|---|---|
| 渲染层 | `renderer/domains/database/` | 无（走 `office-viewer` 插件适配） |
| 主进程 | `main/database/` | 无（主进程列表 `credentials` 之后直接到 `debug-writer.ts`，无 database 段） |

**这不是「一个页面」，是一条完整能力链**，与 astravia 的 git 历史互相印证：

```
feat(capability-sdk): B2.8 数据库应用能力链（agent 直接管理连接）
fix(desktop-app): P7 数据库集成收尾
feat(desktop-app): 数据库结果网格新增「让 AI 解读此查询」反向入口
feat(db): B3.2/B3.3 数据编辑与自由 SQL 可编辑性
feat(desktop-app): AI 感知范围可配置 + 生产写保护
```

外加 `deliverables/dbx-mcp/` 下 6 份评估/设计/集成文档。

**判断：保留，且应视为核心差异化而非技术债。**
理由：DBX MCP 是 astravia 相对上游最大的能力增量；若做成插件，配置漂移与 `docker exec` 行为变更会直接影响主仓稳定性。上游把它交给插件，是因为数据库不是它的主战场——对 astravia 恰恰相反。

---

## 2. 品牌资产体系 —— astravia 唯一真正独有的 ADR

按主题名 diff 后确认：astravia **真正独有的 ADR 只有 1 个**（首次说「0053/0054/0055 三个自加」是错的——0053 只是 `vetta-` → `astravia-` 改名，0054 两边都有）：

```
0055-p5-brand-icon-handcrafted-star-track-with-safe-area.md
```

内容是「星轨意象（astra 星 + via 路）手工设计 + safe-area 规范，弃用 AI 生成占位」，并明确 `padding = 边长 × 12.5%`、16px 下最小笔画 1.5px、产出 `ICON-SPEC.md` 作为可复用品牌基线。

**价值**：这是唯一一条上游没有、且对 astravia 长期有效的决策——它把「品牌视觉」从一次性产物变成了**有规范、可校验的资产**。
**配套**：`rebrand/` 下 15 个一次性脚本（`rename-vetta.mjs` / `gen-bins.mjs` / `dedupe-changelogs.mjs` 等）是这套体系的工程侧沉淀。

**待决断**：`rebrand/` 放在主仓会让新人误以为是常规维护脚本。**建议迁到 `.workbuddy/tools/rebrand/`**，并在根 `AGENTS.md` 加指引，历史 commit 不动。

---

## 3. 桌面 UI 自验体系（astravia 工程实践优于上游）

```
verify:ui:start / :status / :attach / :pw -- <args> / :debug -- <args> / :detach / :stop
```

open-vetta 只有 `verify:ui:start` / `:status` / `:stop`。astravia 把「长驻 + 接入已有 dev 进程 + playwright 调试 + 分离」做齐了。

**判断**：自有即可，不强制回灌；若要回灌，单独开 PR 成本很低。

---

## 4. 无云依赖 —— 当下的简单，未来的债

`packages/desktop-app/src` 下检索 `CLOUD_ENABLED` / `cloud-slots` / `cloud-bridge` **零命中**；`shared/` 也没有上游的 `telemetry.ts` / `sentry-privacy.ts`。

**当下的好处**：
- 天然就是 lite，无死代码消除失效风险，无需维护双构建。
- 无遥测上报，私有化/离线交付场景少一层合规负担。

**代价（必须记下）**：
- 上游的 lite/full 不只是「开关」，配套的是 **`main/cloud/` 物理隔离 + `cloud-boundary.test.ts` 测试守卫**（见 `01-sync-candidates.md` #1）。
- astravia 现在**没有任何边界约定**。等真要接账号/订阅/云市场时，要么临时硬塞（散落各处、难拆），要么回头重做隔离——正是上游已经付过的学费。

**结论**：不要因为「现在没云」就跳过边界约定。正确顺序是**先立边界（空壳 + 测试），再谈开关**。

---

## 5. 平台打包与更新校验

astravia 桌面独有：

```
prepare:windows / prepare:windows:dev
verify:updates:windows / verify:updates:mac
prepare:dbx-mcp
```

上游无对应项（走 `electron-updater` 在线升级）。

**判断**：fork 私有化交付要求「不连外网也能校验升级」，属**场景性保持**，不强求与上游对齐。但需与 `01` 的 #3（CI 升级回归）搭配看——有 `verify:updates:*` 脚本但 CI 里没有 upgrade E2E，是覆盖缺口。

---

## 6. `deliverables/` 决策文档分层

astravia 沉淀出 `deliverables/<主题>/<编号>-<角度>.md` 的归档格式（`dbx-mcp/` 6 份 + `research/open-vetta-sidebar-design/` 2 份 + 本目录 2 份）。上游未见对应结构。

配合 git 历史里的文档归位动作（「归位散落文档，调研/商业/插件/草稿移出 docs 目录」「统一中文文件名为英文 kebab-case」），说明这是**有意识的知识管理**，不是随手堆 md。

**判断**：保留。新增集成（国产库适配、离线包）应照此模板走。

---

## 优先级总览

```
已固化（保留，无需动作）：
  ├── #1 database/ 全栈内置（核心差异化）
  ├── #2 0055 品牌图标 ADR + rebrand 脚本沉淀
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
| 数据库 | — | 全栈内置，保留 |
| cloud | 同步**边界约定与测试**（#1） | 无云代码本身是现状，非优势 |
| 桌面脚本 | 补 CI 升级回归（#3） | 保留 verify:ui:* / verify:updates:* |
| ADR | 按价值挑 36 个缺口 | 保留 0055 品牌图标（唯一独有） |
| 插件预设 | 补 browser 等 | 保留 astravia-* 命名 |
| 文档 | — | 保留 deliverables/ 格式 |

下一步建议：**先做 #4 对应的边界约定（即 01 的 #1）**——它是唯一一项「现在不做、以后必还」的债；其余已固化项保持现状即可。
