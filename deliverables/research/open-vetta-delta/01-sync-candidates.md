# 01 · 值得从 open-vetta 同步过来的改动

> 第三次对比结果（第二次对比有 6 处事实错误，本次已基于目录扫描 + 主题名 diff 重写）。
> 分档依据：**同步成本** × **防退化价值 / 能力补齐价值**。P0 是「今天就能做、且能防止代码继续腐化」的护栏类改动；P2 是 open-vetta 已铺好、astravia 缺的能力。

---

## 前提：两个仓库的真实关系（修正版）

**错误说法**："astravia 19 纯库 ⊂ open-vetta 26 纯库，一一对应，零删除"——不准确。

**实际**：

| 维度 | astravia | open-vetta | 差异说明 |
|---|---|---|---|
| 工作区包总数 | **22**（packages/ 下） | **29**（packages/ 下） | open-vetta 多 `agent-team` + `markdown` + 5 个 `runtime-*` 包 + `remote-*` + `ssh-transport` |
| 应用布局 | packages/ 扁平（cli-app / desktop-app / im-gateway 都在 packages/） | apps/ + packages/ 分离（apps/desktop / apps/cli-host / apps/docs-site / apps/im-gateway / apps/mobile / apps/remote-relay / apps/ssh-helper） | 结构不同，不是"删包" |
| renderer/domains | **16** 个 | **20** 个 | open-vetta 多 agent-teams / bottom-panel / command-menu / message / skills；astravia 多 database |
| main/ 子目录 | **41** 个 | **58** 个 | open-vetta 多 cloud / agent-modes / agent-observability / agent-teams / browser-automation / clipboard / jobs / markdown / media-generation / message-annotations / proxy / remote-control / speech-input / ssh / telemetry / terminal |
| shared/ 文件数 | **7** | **~60** | 差距极大（见 #2） |
| presets 数量 | **10** | **15** | open-vetta 多 5 个（browser / build-apple-apps / comfyui-media-provider / preset-agent / remotion-renderer） |
| ADR 主题数 | **7** 独有的（见 02） | **74** 独有的（本文件同步候选） | 见 P4 |

**正确的心智模型**：**同一时期的两个分支，open-vetta 往「云 + 远程 + 多端 + 工程化」纵深发展，astravia 往「本地 + 数据库 + 品牌」走另一条路。** 差距不是版本落后，是路线分岔叠加上游持续投入——但上游有些能力（cloud 边界、工程组织、独立 domains）与路线无关，是通用护栏。

---

## P0 · 架构护栏（成本低、立刻能防退化）

### 1. cloud 边界守卫测试 —— 价值最高的一项

open-vetta 的 `apps/desktop/src/main/cloud-boundary.test.ts` 用**测试强制架构边界**，文件头注释即规范：

> cloud 模块边界守卫：宿主代码不得直接依赖 cloud 内部实现，否则 lite 构建（`VETTA_CLOUD_ENABLED=false`）的死代码消除会失效。
> 允许的接触面：renderer 走 `@shared/components/cloud-slots`（懒加载槽位）与 `import type`；main 走 `cloud-bridge.ts`（运行期挂载点）+ 动态 import。

配套物理隔离 `apps/desktop/src/main/cloud/`：`auth/` + `auth-session.ts` + `gateway.ts` + `index.ts`。

**astravia 现状**：`packages/desktop-app/src` 下检索 `CLOUD_ENABLED` / `cloud-slots` / `cloud-bridge` → **零命中**，完全没有这套机制。

**为什么值得同步（即使 astravia 现在没有云代码）**：
- 这不是「云功能」，是**防止死代码消除失效的架构测试**——一种可复用的护栏模式。
- astravia 已有能力市场，迟早要接账号/订阅；**现在立边界成本最低**，等代码散落后再隔离就是重走上弯路。
- 落地只是一个 vitest 文件 + 一个 `main/cloud/` 空壳约定。

### 2. shared 层补边界收敛 —— 差距比上次想象的大得多

**真实差距**：

| 维度 | astravia shared/ | open-vetta shared/ |
|---|---|---|
| 文件数 | 7（pet-* + projects-ipc + shortcuts） | ~60 |
| 身份收敛 | **无** | app-identity.ts（单一 appId/productName 来源） + .test.ts |
| 会话权限 | **无** | session-access.ts + .test.ts |
| 插件 IPC | **无** | plugin-ipc.ts + .test.ts |
| 遥测/隐私 | **无** | telemetry.ts + sentry-privacy.ts |
| 云槽位 | **无** | cloud-slots（renderer 懒加载） |
| 浏览器策略 | **无** | browser-policy.ts |
| 其他 | — | conversation-tags.ts / message-annotations.ts / session-pins.ts / session-search.ts / clipboard.ts / plugin-capability-ipc.ts 等 |

**优先同步 `app-identity`**——对 fork 项目，`appId` / `productName` 散落是长期痛点（rebrand 已踩过一次）。其次 `plugin-ipc`（插件 IPC 契约收敛）和 `session-access`（会话权限收敛）。

### 3. CI 补打包与升级回归

open-vetta `.github/workflows/` 比 astravia 多 6 个：

```
desktop-packaged.yml       # 打包产物 E2E
desktop-upgrade-e2e.yml    # 升级回归（旧版本 → 新版本）
docs-site.yml              # 文档站部署
mobile-apple.yml / kotlin.yml  # 移动端
desktop-cache.yml          # 构建缓存
```

astravia 只有 `desktop-release.yml` / `im-gateway.yml` / `quality.yml`。

**`desktop-upgrade-e2e` 对桌面端最有价值**：升级链路断裂是桌面应用最难发现、用户伤害最大的故障类型；astravia 发版密集（0.55.x 已到 33+ patch），无升级回归是真实风险。

---

## P1 · 工程组织

### 4. turborepo 接管任务图

open-vetta 有 `turbo.json`（ADR `turborepo-owns-typescript-workspace-task-graph`）；astravia 仍是 `pnpm-workspace.yaml` + 根 `tsconfig`。

astravia 的 `bun run check` 要并行跑 Biome / tsgo / desktop-app 的 tsc / 质量守卫（见根 `AGENTS.md`），这套编排正是 turborepo 的靶心。**收益**：缓存 + 任务图并行 + 增量。

### 5. `apps/` + `packages/` 拆分（可选）

open-vetta: `packages/desktop-app` → `apps/desktop`、`packages/cli-app` → `apps/cli-host`、`packages/im-gateway` → `apps/im-gateway`。

**注意**：这是**结构变更而非功能同步**。astravia 保持 packages/ 扁平结构也能工作，只是 apps/ 分离更清晰。**不是阻塞项**，可在 turborepo 之后按需做。

### 6. bun 版本对齐

astravia `bun@1.3.4` vs open-vetta `bun@1.3.14`。差异不大，但 `bun.lock` 会随之变化，建议跟 CI 一起升。

---

## P2 · 能力补齐（open-vetta 有、astravia 缺）

### 7. renderer/domains 缺失的独立领域（4 个）

| open-vetta 领域 | 说明 | astravia 现状 |
|---|---|---|
| `agent-teams/` | 多智能体协作：蓝图、团队成员、共享工作区、session catalog、活动面板适配 | **完全缺失**（无 agent-team 包、无 renderer 领域、无 main 子目录） |
| `bottom-panel/` | 底部面板：终端 host、split view、插件槽位 | **完全缺失** |
| `command-menu/` | 命令菜单：全局触发、分组、模糊匹配、最近会话 | **完全缺失** |
| `message/` | 独立通知中心：持久化、过滤、跨页面订阅 | **完全缺失**（toast 分散在各模块） |

**优先级**：
- `command-menu` — 用户入口效率提升明显，且不依赖其他模块
- `message` — 通知中心与 toast 是两套东西（持久化、过滤、跨页面订阅），不抽出来 chat / abilities 都会踩坑
- `agent-teams` — 投入大，依赖 `agent-team` 包（见 #11），但属于 open-vetta 的重点投入方向
- `bottom-panel` — 终端能力可先在 activity-panel 里逐步演进

> astravia 有而 open-vetta 没有的领域：`database`（全栈内置，见 02）——**这不是同步项，是 astravia 的差异化**。

### 8. main/ 缺失的子系统

open-vetta main/ 有但 astravia **完全缺失**的：

| 子系统 | 说明 | 建议 |
|---|---|---|
| `cloud/` + `cloud-bridge.ts` | 云架构（auth + gateway + 运行期桥接） | 不做，但边界约定要建（见 #1） |
| `agent-teams/` | 多智能体协作主进程层 | 跟 #7 agent-teams 同步 |
| `browser-automation/` | 浏览器自动化（profile registry + session management + policy） | 跟 #10 browser preset 同步 |
| `telemetry/` | 产品事件 + 错误监控 | 按需（astravia 现状无遥测需求） |
| `clipboard/` | 用户消息剪贴板同步 | 独立小模块，可按需 |
| `jobs/` | 后台作业管理器 | 独立小模块，可按需 |
| `markdown/` | 主进程 markdown 渲染服务 | 跟 #11 markdown 包同步 |
| `media-generation/` | AI 图片生成后端 | 按需 |
| `message-annotations/` | 消息注解系统（问题标注等） | 按需 |
| `proxy/` | AI API 代理 | 按需 |
| `remote-control/` | 远程控制主进程 | 不做（不同产品线） |
| `speech-input/` | 语音输入（speech-input-host） | 按需 |
| `ssh/` | SSH 远程开发（ssh-transport 包 + main/ssh） | 按需 |
| `terminal/` | 终端主进程服务 | 跟 #7 bottom-panel 同步 |

### 9. shared 层缺失的关键收敛文件

在 #2 中列出的全量清单，**补充具体文件名与价值判断**：

| 文件 | 价值 | 判断 |
|---|---|---|
| `app-identity.ts` + `.test.ts` | 单一 appId/productName 来源，防分叉散落 | **优先** |
| `plugin-ipc.ts` + `.test.ts` | 插件 IPC 契约收敛 | **优先** |
| `session-access.ts` + `.test.ts` | 会话权限收敛 | **优先** |
| `browser-policy.ts` | 浏览器自动化安全策略 | 跟 browser preset 同步 |
| `conversation-tags.ts` + `.test.ts` | 会话标签系统 | 按需 |
| `message-annotations.ts` | 消息注解 | 按需 |
| `session-pins.ts` + `.test.ts` | 会话置顶 | 按需 |
| `telemetry.ts` + `sentry-privacy.ts` | 遥测 + 隐私（lite 构建排除） | 等有云/遥测需求时 |
| `cloud-slots/` | 云懒加载槽位 | 等 #1 边界约定建完 |

### 10. 插件预设补 5 个

open-vetta 比 astravia 多的 preset：

| Preset | 配套 ADR | 价值 | 判断 |
|---|---|---|---|
| `browser` | `browser-automation-runtime-and-action-gating` | 完整浏览器自动化能力（profile、policy、runtime manager），是独立产品线入口 | **最高优先** |
| `build-apple-apps` | — | Apple 平台（Mac App Store）打包工具 | 按需 |
| `comfyui-media-provider` | — | ComfyUI 媒资接入 | 按需（媒资链路） |
| `preset-agent` | — | 预设 agent 配置分发 | 按需 |
| `remotion-renderer` | — | Remotion 视频渲染 | 按需（媒资链路） |

### 11. 缺失的 packages（按价值排序）

open-vetta 有但 astravia 缺失的 package：

| 包 | 价值 | 判断 |
|---|---|---|
| `markdown` | 共享 markdown 渲染（`MarkdownView.tsx` + CSS + test），astravia `AbilityMarkdownBody` 等处可能各写各的 | **建议同步** |
| `agent-team` | 多智能体协作核心（blueprints + collaboration + domain + contracts + 12 test 文件） | 跟 #7 agent-teams 同步 |
| `runtime-knowledge` | 知识库运行时（writer + storage + query + domain + 9 test 文件），astravia renderer 有 knowledge-base 领域，应有对应运行时 | **建议同步** |
| `runtime-subagents` | 子 agent 运行时 | 视 subagent 规划而定 |
| `runtime-desktop` / `runtime-node` / `runtime-core` | 环境实现，配合 ADR `platform-runtime-owns-environment-implementations` | 按需 |
| `runtime-ssh` | SSH 传输层 | 跟 #8 ssh 同步 |
| `remote-control` / `remote-desktop` | 远程控制产品线 | **不建议**——属远程控制产品线，astravia 无此规划，强上只增负担 |

### 12. `plugin-cli`（npm 分发插件）

open-vetta `packages/plugins/` 比 astravia 多：

| 目录 | 说明 |
|---|---|
| `plugin-cli/` | npm 分发插件的 CLI（bin `vetta-plugin-cli`，描述 "Install npm-distributed plugins into Vetta Desktop"），配套 ADR `npm-is-a-distribution-envelope-for-desktop-plugins` |
| `docs/` | 插件开发文档（module-federation.md 等） |
| `tenants.json` | 租户配置 |

**判断**：若想让插件生态走出「本地 zip 导入」，`plugin-cli` 是最短路径；否则可暂缓。

---

## P3 · 产品线（长期，慎选）

### 13. VETD 设计文档格式

open-vetta 有 4 个 `vetd-*` ADR（`vetd-design-document-as-a-single-bundle-directory` / `vetd-design-history-as-in-bundle-git-repository` / `vetd-design-level-npm-dependencies` / `vetd-frames-as-real-routes-not-canvas-addressing`），定义了「设计文档作为单一 bundle 目录 + 内置 git 历史 + 设计级 npm 依赖 + frames 作为真实路由」的完整格式。

**判断**：这是 open-vetta 的差异化产品线，不是基础设施，**不建议同步**，除非明确要做设计工具。

### 14. apps/ 应用（mobile / remote-relay / docs-site / ssh-helper）

| 应用 | 说明 | 判断 |
|---|---|---|
| `apps/docs-site` | Next.js 文档站（Nextra） | **与 astravia `website/` 完全不同**——website/ 是官网（page 框架，品牌展示），docs-site/ 是产品文档站。astravia 目前无文档站，可按需建 |
| `apps/mobile` | Kotlin Multiplatform 移动端 | 投入巨大，非基础设施 |
| `apps/remote-relay` | 依附远程控制产品线 | 不做 |
| `apps/ssh-helper` | SSH 辅助 | 按需 |

**均不建议**作为同步项，docs-site 例外——但那是新建而非"同步"。

### 15. lite / full 双构建

open-vetta：`VETTA_CLOUD_ENABLED` 控制 full/lite，`VETTA_CONFIG_DIR` 切数据根。

**astravia 现状**：**没有云代码**（检索零命中），本身就是事实上的 lite。所以这里要同步的不是「开关」，而是**#1 的边界约定**——先把边界立起来，等真有云代码时开关才有意义。顺序上是 #1 先于 #15。

---

## P4 · 文档

### 16. ADR 主题缺口 —— 按主题名 diff 后的真实数字

astravia **7** 个独有主题（见 02），open-vetta **98** 个独有主题。按主题名去重 diff（忽略编号前缀和 vetta/astravia 改名），open-vetta 独有的 98 个主题按价值分层（以下仅列出建议同步的，其余 70+ 个属不同产品线或平台特定）：

#### 第一层（跟 P0-P2 直接相关，建议同步）

| 主题名 | 对应同步项 |
|---|---|
| `turborepo-owns-typescript-workspace-task-graph` | #4 |
| `npm-is-a-distribution-envelope-for-desktop-plugins` | #12 |
| `browser-automation-runtime-and-action-gating` | #10 |
| `platform-runtime-owns-environment-implementations` | #11 |
| `preset-provider-templates` | preset 体系基础 |
| `plugin-marketplace-flat-no-version-history` | 市场设计 |
| `plugin-marketplace-releases-are-versioned-artifacts` | 市场设计 |
| `runtime-configuration-registry` | 运行时基础 |
| `plugin-ipc-providers-and-ability-setup-slots` | #2 shared 层 |
| `plugin-cli-providers-and-ability-setup-slots` | #12 |
| `session-extension-composition` | 运行时演进 |
| `agent-runtime-product-ownership` | 运行时演进 |
| `runtime-observation-port` | 运行时演进 |
| `unified-conversation-messages-and-agent-team-conversations` | agent-teams 基础 |
| `agent-team-product-layer` | agent-teams 基础 |
| `agent-team-session-catalog-and-shared-workspace` | agent-teams 基础 |

#### 第二层（独立 domains 基础，建议同步）

| 主题名 | 对应同步项 |
|---|---|
| `session-bottom-panel-and-interactive-terminal` | bottom-panel |
| `quickjs-worker-runtime-with-host-rendered-ui` | 插件 runtime |
| `plugin-workspace-views-and-customizable-sidebar-nav` | 插件体系 |
| `plugin-agent-presets-are-declarative` | preset 体系 |
| `ability-presentation-policy` | ability 展示 |
| `ability-unify-storage-and-presentation-not-installation` | ability 体系（两边都有同名） |
| `plan-mode-is-an-orthogonal-permission-axis` | 权限模型 |
| `trusted-renderer-plugins-and-governance-permissions` | 插件安全 |
| `plugin-install-activates-immediately` | 插件生命周期 |
| `plugin-managed-local-services-and-owned-model-providers` | 插件模型管理 |
| `ocr-provider-protocol-and-batch-foundation` | OCR 能力 |
| `work-mode-agent-narrated-progress-groups` | 工作模式（两边都有同名） |

#### 第三层（不同产品线，不建议同步）

vetd-*、remote-control-*、webrtc-*、agent-team-* 深层主题（若不同步 agent-teams 产品线则不需要）、windows-local-streaming-speech-input（平台特定）、ssh-remote-*（按需）。

---

## 建议执行顺序

```
第一批（护栏，互不依赖）：
  #1 cloud 边界守卫测试（main/cloud/ 空壳 + cloud-boundary.test.ts）
  #2 shared 层 app-identity + plugin-ipc + session-access
  #3 CI desktop-upgrade-e2e.yml

第二批（工程组织，#4 → #5 有顺序依赖）：
  #4 turborepo  →  #5 apps/ 拆分（可选）  →  #6 bun 升级

第三批（能力补齐，按需排序）：
  #10 browser preset（+ 对应 main/browser-automation）
  #11 markdown + runtime-knowledge 包
  #12 plugin-cli（若想走 npm 分发）
  #7 command-menu / message 独立领域
  #8 main/ 按需子系统（clipboard / jobs / markdown）

第四批（大型产品线，慎选）：
  #7 agent-teams（依赖 #11 agent-team 包）
  #14 docs-site 文档站（新建）

第五批（文档）：
  #16 ADR 按第一层 → 第二层优先级同步
```

---

## 对比方法修正（相对第二次对比）

第二次对比靠目录 ls + 主观归类，导致 6 处事实错误。本次改用「包列表对账 + 主题名 diff + 关键文件精确 grep + 目录数量统计」，修正如下：

| 项 | 第二次说法 | 本次修正 |
|---|---|---|
| 包数量关系 | "19 纯库 ⊂ 26 纯库，一一对应，零删除" | astravia **22** vs open-vetta **29**；结构不同（packages/ 扁平 vs apps/ + packages/ 分离），不是"零删除" |
| database 功能 | open-vetta "走 office-viewer 插件适配" | **open-vetta 完全没有 database**（主进程和渲染层均无 database/ 目录） |
| `file-preview` | 隐含为 astravia 独有 | **两边都有**，一一对应 |
| shared 层差距 | "只有 IPC 定义、无测试" | astravia **7 文件** vs open-vetta **~60 文件**，差距极大 |
| preset 缺口 | "多 3 个" | **多 5 个**：browser / build-apple-apps / comfyui-media-provider / preset-agent / remotion-renderer |
| ADR 缺口 | "缺 36 个主题" | 按主题名精确 diff 为 **98 个** open-vetta 独有主题 |
| website/ vs docs-site | "需判断是重复建设还是可迁移" | **两个完全不同的产品**：website/ 是官网，docs-site/ 是文档站 |

**本次新增发现**：open-vetta renderer/domains 多 4 个（agent-teams / bottom-panel / command-menu / message）、main/ 多 16 个子系统、packages 多 7 个（agent-team / markdown / runtime-knowledge / runtime-subagents / runtime-desktop / runtime-node / runtime-ssh + remote-control / remote-desktop）、shared 层差距远比想象的大、presets 多的是 5 个不是 3 个。
