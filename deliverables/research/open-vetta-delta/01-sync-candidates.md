# 01 · 值得从 open-vetta 同步过来的改动

> 第二次对比结果（首次对比有遗漏与事实错误，本次已修正，见文末「对比方法修正」）。
> 分档依据：**同步成本** × **防退化价值**。P0 是「今天就能做、且能防止代码继续腐化」的护栏类改动，优先级最高。

---

## 前提修正：两个仓库的真实关系

首次对比把 astravia 暗示为「落后于上游一大截」，**这个判断不准确**。实际证据：

| 证据 | 说明 |
|---|---|
| open-vetta `packages/runtime-knowledge` = `0.55.3`；astravia `packages/desktop-app` = `0.55.33` | 两边共用同一套 **0.55.x** 版本体系，是**同期**代码 |
| astravia 19 个纯库 ⊂ open-vetta 26 个纯库，**一一对应** | astravia **一个包都没删**，只是没跟上 open-vetta 新增的 7 个 |
| git 历史：astravia 108 提交（首条为「首次初始化提交」，历史被 squash）；open-vetta 3188 提交但日期全压在同一天 | 提交数**两边都不可用于判新旧**，只能比代码内容 |

正确的心智模型：**同一时期的两个分支，open-vetta 往「云 + 远程 + 多端 + 工程化」走，astravia 往「本地 + 数据库 + 品牌」走。** 差距不是版本落后，是路线分岔叠加上游持续投入。

---

## P0 · 架构护栏（成本低、立刻能防退化）

### 1. cloud 边界守卫测试 —— 本次新发现，价值最高的一项

open-vetta 的 `apps/desktop/src/cloud-boundary.test.ts` 用**测试强制架构边界**，文件头注释即规范：

> cloud 模块边界守卫：宿主代码不得直接依赖 cloud 内部实现，否则 lite 构建（`VETTA_CLOUD_ENABLED=false`）的死代码消除会失效。
> 允许的接触面：renderer 走 `@shared/components/cloud-slots`（懒加载槽位）与 `import type`；main 走 `cloud-bridge.ts`（运行期挂载点）+ 动态 import。

配套物理隔离 `apps/desktop/src/main/cloud/`：`auth/` + `auth-session.ts` + `gateway.ts` + `index.ts`。

**astravia 现状**：在 `packages/desktop-app/src` 下检索 `CLOUD_ENABLED` / `cloud-slots` / `cloud-bridge` → **零命中**，完全没有这套机制。

**为什么值得同步（即使 astravia 现在没有云代码）**：
- 这不是「云功能」，是**防止死代码消除失效的架构测试**——一种可复用的护栏模式。
- astravia 已有能力市场（见能力页 ADR-0049），迟早要接账号/订阅；**现在立边界成本最低**，等代码散落后再隔离就是重走上弯路。
- 落地只是一个 vitest 文件 + 一个 `main/cloud/` 空壳约定。

### 2. shared 层补测试与身份收敛

open-vetta `src/shared/` 比 astravia 多出的一批，都带 `.test.ts` 或属边界收敛：

| 文件 | 作用 |
|---|---|
| `app-identity.ts` / `app-identity.test.ts` | 应用身份单一来源 |
| `session-access.ts` / `session-access.test.ts` | 会话访问权限收敛 |
| `plugin-ipc.ts` / `plugin-ipc.test.ts` | 插件 IPC 契约 |
| `projects-ipc.ts` | 项目 IPC |
| `sentry-privacy.ts` / `telemetry.ts` | 遥测与隐私（lite 构建排除项） |

astravia 的 `shared/` 只有 IPC 定义、无对应测试。**优先搬 `app-identity`**——对 fork 项目，`appId` / `productName` 散落是长期痛点（rebrand 已踩过一次）。

### 3. CI 补打包与升级回归

open-vetta `.github/workflows/` 多三个：

```
desktop-packaged.yml     # 打包产物 E2E
desktop-upgrade-e2e.yml  # 升级回归（旧版本 → 新版本）
mobile.yml
```

astravia 只有 `desktop-release.yml` / `im-gateway.yml` / `quality.yml`。
**`desktop-upgrade-e2e` 对桌面端最有价值**：升级链路断裂是桌面应用最难发现、用户伤害最大的故障类型；astravia 发版密集（0.55.x 已到 33 个 patch），无升级回归是真实风险。

---

## P1 · 工程组织

### 4. turborepo 接管任务图

open-vetta 有 `turbo.json`（ADR `0079-turborepo-owns-typescript-workspace-task-graph`）；astravia 仍是 `pnpm-workspace.yaml` + 根 `tsconfig`。

astravia 的 `bun run check` 要并行跑 Biome / tsgo / desktop-app 的 tsc / 质量守卫（见根 `AGENTS.md`），这套编排正是 turborepo 的靶心。**收益**：缓存 + 任务图并行 + 增量。

### 5. `apps/` + `packages/` 拆分

`packages/desktop-app` → `apps/desktop`、`packages/cli-app` → `apps/cli-host`、`packages/im-gateway` → `apps/im-gateway`。

**顺序依赖**：这会动所有 CI 路径、构建脚本、`astravia-mono.code-workspace`，且**必须在 turborepo（#4）之后做**，否则任务图要配两遍。建议 #4 与 #5 排进同一 PR 序列。

### 6. bun 版本对齐

astravia `bun@1.3.4` vs open-vetta `bun@1.3.14`。差异不大，但 `bun.lock` 会随之变化，建议跟 CI 一起升。

---

## P2 · 能力补齐

### 7. 新增 7 个包（astravia 全部缺失）

| 包 | 判断 |
|---|---|
| `markdown` | **建议同步**——共享 markdown 渲染，astravia `AbilityMarkdownBody` 等处大概率各写各的 |
| `runtime-knowledge` | **建议同步**——astravia renderer 有 `knowledge-base` 领域，应有对应运行时 |
| `runtime-subagents` | 视 subagent 规划而定 |
| `runtime-node` / `runtime-desktop` | 环境实现，配合 ADR `platform-runtime-owns-environment-implementations` |
| `remote-control` / `remote-desktop` | **不建议**——属远程控制产品线，astravia 无此规划，强上只增负担 |

### 8. `plugin-cli`（npm 分发插件）

`@vetta-org/plugin-cli`，bin 为 `vetta-plugin-cli`，描述 "Install npm-distributed plugins into Vetta Desktop"，配套 ADR `0067-npm-is-a-distribution-envelope-for-desktop-plugins`。

astravia `packages/plugins/` 只有 `plugin-sdk` / `plugin-vite` / `presets` / `externals`，**缺 `plugin-cli`，也缺上游的 `docs/` 目录**（另有 `tenants.json`）。
**判断**：若想让插件生态走出「本地 zip 导入」，`plugin-cli` 是最短路径；否则可暂缓。

### 9. 插件预设补 3 个

open-vetta 多 `browser` / `comfyui-media-provider` / `remotion-renderer`。
`browser` 配套 ADR `0079-browser-automation-runtime-and-action-gating`，是完整能力，优先级高于另两个（另两个偏媒资链路，取决于是否需要 ComfyUI / Remotion）。

### 10. 渲染层补两个独立领域

open-vetta 多 `renderer/domains/skills/`（独立技能管理页）与 `message/`（独立通知中心）：

- **`skills/`**：当前 skill 入口藏在 abilities 里，随用户自建 / 市场拉取 / 版本回滚增长，需要独立 workflow。
- **`message/`**：通知中心与 toast 是两套东西（持久化、过滤、跨页面订阅），不抽出来 chat / abilities 都会踩坑。

（astravia 的 `database` 领域**不**属此类，见 `02-astravia-advantages.md`。）

---

## P3 · 产品线（长期，慎选）

### 11. VETD 设计文档格式 —— 本次新发现

open-vetta 有 4 个 `vetd-*` ADR（0055 / 0066 / 0068 / 0069），定义了「设计文档作为单一 bundle 目录 + 内置 git 历史 + 设计级 npm 依赖 + frames 作为真实路由」的完整格式。astravia 的 ADR-0053 也提到「`.vetd` frame 的工程路线」，说明 astravia **知道这个概念但没铺完整产品线**。

**判断**：这是 open-vetta 的差异化产品线，不是基础设施，**不建议同步**，除非明确要做设计工具。

### 12. `apps/docs-site` / `apps/mobile` / `apps/remote-relay`

- `docs-site`：astravia 已有 `website/` 目录，需先判断是重复建设还是可迁移。
- `mobile`（Kotlin Multiplatform）：投入巨大，非基础设施。
- `remote-relay`：依附远程控制产品线。

**均不建议**作为同步项。

### 13. lite / full 双构建

open-vetta：`VETTA_CLOUD_ENABLED` 控制 full/lite，`VETTA_CONFIG_DIR` 切数据根。

**注意**：astravia 当前**没有云代码**（检索零命中），本身就是事实上的 lite。所以这里要同步的不是「开关」，而是**#1 的边界约定**——先把边界立起来，等真有云代码时开关才有意义。顺序上是 #1 先于 #13。

---

## P4 · 文档

### 14. ADR 缺口 —— 修正后的真实数字

astravia **45** 个 vs open-vetta **81** 个。按主题名精确 diff（忽略编号前缀）：

- open-vetta 有 / astravia 无：**36 个主题** + `README.md`
- astravia 有 / open-vetta 无：**3 个**，其中 2 个仅 `vetta-` → `astravia-` 改名，真正独有仅 1 个

**首次对比的错误**：只说「缺 0051–0082 新增的一段」。实际缺口**从早期编号就存在**：

```
0015-preset-provider-templates
0018-in-app-notification-distinct-from-os-notification
0021-model-runtime-contracts
0025-plugin-marketplace-flat-no-version-history
```

低编号缺失说明 astravia 缺的不止「上游新增」，也包含分叉时就没同步的部分。

**同步建议（按价值而非数量）**：
1. `0015-preset-provider-templates`、`0025-plugin-marketplace-flat-no-version-history` —— 与能力页/市场直接相关，**优先**
2. `0076-session-extension-composition`、`0077-agent-runtime-product-ownership`、`0080-runtime-observation-port`、`0082-hierarchical-runtime-observation-hub` —— 运行时演进主线
3. `vetd-*` / `remote-*` / mobile 相关 —— 不同步

---

## 建议执行顺序

```
第一批（护栏，互不依赖）：
  #1 cloud 边界守卫测试
  #2 shared 层 app-identity + 测试
  #3 CI 升级回归

第二批（工程组织，#4 → #5 有顺序依赖）：
  #4 turborepo  →  #5 apps/ 拆分  →  #6 bun 升级

第三批（能力，按需）：
  #7 markdown + runtime-knowledge
  #8 plugin-cli
  #9 browser 预设
  #10 skills / message 领域

第四批（文档）：
  #14 ADR 按价值挑，不整段搬
```

---

## 对比方法修正（相对首次对比）

首次对比靠目录 `ls` 加主观归类，导致 2 处事实错误、6 处遗漏。本次改用「包版本号对账 + 按主题名 diff + 关键文件 grep 验证」，修正如下：

| 项 | 首次说法 | 本次修正 |
|---|---|---|
| 版本关系 | 暗示 astravia 落后一大截 | 两边同为 0.55.x，**同期** |
| 是否删包 | 隐含 astravia 删了东西 | 19 个纯库与上游一一对应，**零删除**，仅缺新增 7 个 |
| `file-preview` | 说是 astravia 独有 | **两边都有**（首次已在 02 修正） |
| ADR 缺口 | 「缺 0051–0082」 | 实为缺 **36 个主题**，且含 0015/0018/0021/0025 等早期编号 |
| astravia 独有 ADR | 说 0053/0054/0055 是自加 | 实际仅 **0055 品牌图标** 独有；0053 是改名、0054 两边都有 |
| lite/full | 当作待同步功能 | astravia 无云代码，本身就是 lite；真正缺的是**边界约定**（#1） |

**本次新增发现（首次完全未覆盖）**：cloud 边界守卫测试与 `main/cloud/` 隔离、turborepo、CI 三件套、`plugin-cli`、VETD 产品线、`packages/plugins/tenants.json`、shared 层 `app-identity` / `session-access` / `plugin-ipc` / `telemetry`。
