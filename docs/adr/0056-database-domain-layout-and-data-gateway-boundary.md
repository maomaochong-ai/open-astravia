# 数据库域文件规划：components/hooks/lib 分层 + main 侧 data-gateway 提取边界

数据库工作台此前以 dbx 上游（Vue 桌面应用）与 activity-panel「内置浏览器」面板（`BrowserPanel`/`useBrowserPanelModel`）为蓝本渐进实现。P0–P2 落地后盘点发现，`renderer/domains/database` 的文件堆放偏离了本仓库成熟域的既定惯例：**7 个状态模型 hook（`useDatabase*`）与展示组件混放在 `components/`**，纯函数文件（`database-layout.ts`、`database-type-catalog.ts`）也堆在组件目录；而仓库内 activity-panel / file-explorer / chat 域一律是「展示组件在 `components/`、状态模型在 `hooks/`、纯逻辑在 `lib|services/`」。同时 `src/main/database` 内 `database-service.ts`、`dbx-mcp-client.ts` 直连 Electron（config-store / logger），与企业版蓝图 §8.3「dbx 提取为纯 Node 服务端模块 data-gateway」的可提取性要求相悖。需要定下文件规划基线，使单机版结构自洽、云端企业版可拆分。

## Decision

**renderer 侧：database 域对齐仓库成熟域惯例，拆为三层 + barrel。**

```
renderer/domains/database/
  components/  展示组件 + 共享 JSX 渲染片段（DatabaseWorkspace / DatabaseExplorerTree /
               DatabaseResultGrid / DatabaseQueryPanel / DatabaseQueryHistoryPopover /
               database-details-shared.tsx …）
  hooks/       面板状态模型（useDatabaseExplorerModel / useDatabaseQueryModel /
               useDatabaseWorkspaceModel / useDatabaseAnalyzeResult /
               useDatabaseAnalyzeSql / useDatabaseAnalyzeTable）
  lib/         纯逻辑（database-api / database-tree / query-tabs / query-history /
               result-grid / result-summary / sql-dialect / ai-anchor / catalog-family /
               database-layout / database-type-catalog / …）
  index.ts     barrel：对外导出组件与 hooks 入口
```

迁移为**纯结构搬移**：`git mv` 保留历史，逐一修正相对 import，不改任何组件逻辑、props、样式与交互——数据库工作台整体设计零变化。具体动作：

1. `components/useDatabase{ExplorerModel,QueryModel,WorkspaceModel,AnalyzeResult,AnalyzeSql,AnalyzeTable}.ts` → `hooks/`；
2. `components/database-layout.ts`（+ `database-layout.test.ts`）、`components/database-type-catalog.ts` → `lib/`；
3. `components/database-details-shared.tsx` **留在 components/**：它导出含 JSX 的共享渲染片段（连接详情/上下文开关等 UI 片段），角色与 `DatabaseBadge`、`DatabaseSurface` 同类，不是纯逻辑；
4. `lib/` 命名**保留**，不改名 `services/`——chat 域同样使用 `lib/` 存放纯逻辑（`chat/lib/chat-session-anchor.ts`），`lib/` 是本仓库可接受命名；改名只会制造无收益 churn。

**main 侧：`src/main/database` 物理位置不变，确立 data-gateway 提取边界。**

企业版 §8.3 的提取动作（整树复制后在企业仓库抽成 `enterprise/packages/data-gateway`）决定了开源侧的义务是**保证可提取性**，而非现在就拆包。因此本决策确立分层与依赖纪律：

- `database-catalog.ts`、`sql-safety.ts`、`schema-context-injection.ts`、`dedupe-connections.ts` 等为**纯 Node 层**：不 import Electron，可整体复制进 data-gateway；
- `database-service.ts`、`dbx-mcp-client.ts` 为**服务编排层**：其对 Electron 的依赖（desktop-config-store、logger、路径）收口为**最小 host 注入接口**（构造时传入 config/logger/paths），使同一编排代码可在纯 Node 宿主（云端代理）复跑；
- 主进程数据库文件保持平铺于 `src/main/database/`（含 `.test.ts` 同级），不设子目录——域小、检索友好，企业整树复制时目录映射简单。

**transport 边界（单机/云端共用 UI）**：renderer 一律经 `lib/database-api.ts` 类型化 facade 访问数据库（其下是 preload `api-types/database.ts` 定义的通道）。云端企业版换 transport 实现（HTTP/WS 代理）时，UI 与状态模型零改动，只替换 facade 的注入源。此边界已成立，本决策将其确立为**不可破坏的约束**：任何新数据库能力不得在 components/hooks 里直接触碰 IPC 细节。

## Considered Options

- **O1 维持现状（components/lib 混放）**：驳回。hooks 与展示组件混淆，与 activity-panel/file-explorer/chat 全部域的 `hooks/` 惯例相悖；新成员按惯例找 `hooks/` 会落空；纯函数堆在组件目录拉低可读性。
- **O2 完整对齐 file-explorer 三层（lib → services 改名）**：驳回。`lib/` 在 chat 域同样被使用，是仓库既有可接受命名；`lib/` → `services/` 纯改名无行为收益，制造大 diff 与历史噪音。
- **O3 本决策（components/hooks/lib + main 侧边界收口）**：采纳。对齐仓库惯例的最小迁移面，同时用文档与纪律把云端可提取性锚定。
- **O4 现在就建独立 `@astravia/data-gateway` 包**：驳回。企业 §8.3 明确提取动作发生在**企业仓库内**（版本自治、不依赖开源发布）；开源仓库只保证"整树复制后能抽"，提前拆包与 monorepo 现状及发布策略冲突。

## 校准与推翻

- **docs/adr 无旧决策被推翻**：检索全部 55 篇 ADR，无任何一篇规定 database 域文件结构（0027 为文件协议、0053/0054/0055 为 UI 设计引擎/插件/品牌，均非本域）。
- **正式校准的对象是"渐进实现的默认堆放"**：数据库工作台参照 dbx 上游与 activity-panel 浏览器面板实现时，hook 随组件同放 `components/` 属实现便利，从未成文。本决策将其校准为仓库域惯例，是**对既有实现的第一份成文规划基线**。
- **deliverables/dbx-mcp/adr-ai-database-integration.md 不冲突**：其术语与约束（AiAnchor/AiAsk/ApplySql/sql-safety/schema 只读/IPC 纪律）均不涉目录；将同步在其「相关链接」补本 ADR 引用，并更新实施完成度记录。

## 影响与验收

- 影响面：`renderer/domains/database` 内部 import 路径、activity-panel `builtins/database-tab.tsx` 与 settings 对数据库组件入口的引用（若指向被移文件则同步改）。外部引用 components/use* 的代码经核查为**零**。
- 验收标准（DoD）：
  - [ ] database 域呈现 components/hooks/lib 三层，无 hook 遗留在 components/，无纯函数遗留在 components/（含 JSX 的共享片段除外）；
  - [ ] 全部迁移经 `git mv`，import 修正后 desktop-app 全量 tsc exit 0、biome 0 问题；
  - [ ] 行为零变化：不改组件逻辑/props/样式/交互，数据库工作台整体设计不变；
  - [ ] `database-api.ts` facade 纪律写入本决策，主进程 Electron 依赖收口方向明确；
  - [ ] deliverables/dbx-mcp/adr-ai-database-integration.md 与 ai-database-integration-plan.md 已同步引用本 ADR。
