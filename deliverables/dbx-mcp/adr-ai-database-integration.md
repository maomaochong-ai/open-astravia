# ADR:AI 与数据库工作台的集成方式(对齐 dbx 水准)

- 状态:待评审(Draft)
- 日期:2026-09-06
- 领域:desktop-app · Database Explorer · AI 对话
- 决策者:用户 / Astravia Database Explorer 主程
- 关联决策:V7(per-tab 执行连接)、sql-safety clamp、schema-context injection、dbx-mcp(Rust)

## 1. 背景与问题

Astravia 已具备两块独立的 AI 能力:

1. **全局 AI 对话界面**(`renderer/domains/chat`):通用聊天,与普通对话一致。
2. **顶部「问数」悬浮按钮**(`SettingsAiAssistButton` 及 DatabaseWorkspace 顶栏入口):点击后把当前 Database 会话的 **schema summary**(通过 `database-details-shared` 维护的开关注入)作为 instruction/上下文交给 AI 对话,引导模型产 SQL。

用户希望这两块与「数据库 Explorer / 查询执行」**按 dbx 的方式集成**——dbx 的 AI 不是独立聊天窗,而是**内嵌在 SQL 编辑器旁的 AI Assistant**(`AiAssistant.vue`),能做到:

- 针对「当前打开的查询/表/连接」给出可执行的上下文;
- 生成/改写/解释 SQL,并可直接回填编辑器或作为「新查询」执行;
- 结果区/历史条可一键「让 AI 分析这份查询/结果」;
- 上下文来自真实 catalog(表结构、schema、方言、连接),而非手打。

**问题**:我们现在已有通用对话 + 问数按钮,但缺少 dbx 那种「AI 与单条查询/单张表/历史记录深度咬合」的交互闭环;上下文注入是单向静态的,产出的 SQL 也没有「一键落回编辑器并执行」的通道。

## 2. 决策考量

候选方案:

- **A. 维持现状**:保留全局对话 + 问数按钮,只增强 prompt。
  - 优点:改动最小。
  - 缺点:交互断层——AI 结果与编辑器/结果网格没有连接点;达不到 dbx 水准;用户明确要求对齐。
- **B. 移植 dbx 的 AiAssistant**:在 SQL 编辑器区嵌入独立 AI 侧栏,完整复刻 dbx 交互。
  - 优点:与 dbx 观感一致。
  - 缺点:与 Astravia 现有全局 chat 域重复;维护两套对话 UI;工程量大;与产品既有 AI 域割裂。
- **C.(推荐)在现有 chat/问数链路上加「数据库咬合层」**:保留全局 chat 与问数按钮作为统一入口,但新增三类**上下文+动作**能力:
  1. **会话锚点(anchor)**:对话可携带/切换一个 `DatabaseAiAnchor`(连接 + 库/模式 + 打开表或编辑器 SQL 或历史记录),锚点决定 schema 注入范围与目标方言;
  2. **可执行动作**:模型产出(或被用户指定)的 SQL 通过「应用」按钮走既有 sql-safety guard → 新查询 tab 或当前 tab 执行;
  3. **就近入口**:在查询编辑器工具栏、结果页脚、历史条目上提供「问 AI」入口,把对应锚点交给对话。
  - 优点:复用 chat 域与 dbx-mcp 上下文,不重复造对话 UI;补齐 dbx 的咬合交互;可增量落地;与 sql-safety/schema-context 既有管线完全一致。
  - 缺点:需要定义锚点数据流与 IPC 通道(小);部分 UI 布局需微调(中)。

## 3. 决策

**采用方案 C:在现有 AI 对话(chat)+ 问数按钮链路上实现「Database AI 锚点 + 可执行 SQL 回填」咬合层**,对齐 dbx `AiAssistant.vue` 的能力子集:

1. **新增领域概念 `DatabaseAiAnchor`**(连接名、库/模式、可选表、可选 SQL 文本、来源类型 table|editor|history|selection),作为对话与数据库之间的「当前上下文」。
2. **schema 注入升级**:问数按钮/就近入口调用时,注入范围从「整连接 summary」细化为「锚点表结构 + 方言 + 连接显示名 + 已有 SQL」,并在对话中置顶一条系统说明(仅当该锚点生效)。
3. **SQL 回填通道**:对话消息中可提取到的 SQL(模型建议或用户点「用 AI 生成」)显示「在新查询中打开/执行」操作,走现有 IPC 查询执行管线(sql-safety 前置),复用 rebind/历史记录逻辑,不在 chat 域重复造执行器。
4. **就近入口(按里程碑逐步加)**:
   - 编辑器工具栏:把当前编辑器 SQL 作为锚点「问 AI」(对齐 dbx 编辑器 Ask AI 按钮);
   - 结果页脚/历史条目:对「这份结果/这条历史」发起 AI 分析(对齐 dbx QueryHistory 的 analysis / AiAssistant 结果上下文)。
5. **不新建第二套聊天 UI**;chat 域保持唯一对话宿主,新增的是「把数据库上下文塞进对话」的入口与「把对话结论放回数据库」的出口。

### 明确不做(超出本决策范围)
- 不做服务端 SQL 结果训练/数据上传——schema 只传结构摘要,不传行数据明文(除用户显式选中的分析目标)。
- 不做 dbx 的全量 prompt 复刻;prompt 策略由 chat 域自己的 instruction 体系决定,本决策只定义上下文边界与动作通道。
- 不做 LLM 供应商/模型管理——沿用项目既有 AI 配置。

## 4. 领域建模要点(对齐 domain-modeling)

统一术语(建议写入 CONTEXT):
- `AiAnchor`:上述上下文锚点。
- `AiAsk(connection/table/sql/scope)` → 事件:把锚点发给当前对话并切换到 database 会话。
- `ApplySql(sql, mode)` → sql-safety 校验 → `runConfirmed`/新 tab 执行。
- `AiAnalysis(target)`:对结果集/历史条发起解释性分析(只读 + 摘要)。

约束/不变式:
- 任何由 AI 文本落到数据库的 SQL 必须过 `sql-safety`(与手写 SQL 同权,不豁免)。
- schema 注入只读 catalog,不触碰数据行(默认)。
- 锚点切换需清理旧的系统级说明,防止串上下文。
- 事件全部走既有 IPC/preload types,renderer 不直接访问数据库。

## 5. 备选方案驳回理由

- A 驳回:交互断层,达不到用户要求的 dbx 水准。
- B 驳回:重复 UI、双对话宿主、违背 Astravia 单一 AI 入口取向;且 dbx AiAssistant 的维护成本高于其收益。

## 6. 影响与风险

| 影响面 | 说明 | 缓解 |
| --- | --- | --- |
| chat 域 | 需支持「外部注入锚点/系统说明/从消息提取 SQL」协议 | 由 chat 域提供轻量注入 API(事件),不改内部消息环 |
| database 域 | 新增 anchor 建模 + 就近入口按钮 | 复用 DatabaseQueryHistoryPopover / 编辑器工具栏槽位 |
| IPC/preload | 新增 1-2 个通道(apply-sql 复用现有 query 通道,可能仅需扩展类型) | 最小扩展 |
| i18n | 新增文案双份 | 沿用 settings.json 纪律 |

## 7. 验收标准(DoD)

- [ ] 编辑器工具栏存在「问 AI」入口,点击后对话自动带上当前 SQL + 连接锚点;
- [ ] 对话内产出的 SQL 可一键「在新查询打开/执行」,且 DDL/危险 SQL 被 sql-safety 拦截(danger 需确认);
- [ ] 结果页脚与历史条目可发起「AI 分析」,注入内容为对应锚点摘要;
- [ ] 无第二套聊天 UI;AI 配置仍走既有体系;
- [ ] 新文案 en/zh 同步;操作记录 `recordSettingsUsage`。

## 8. 相关链接
- 本决策配套实施方案:见 `ai-database-integration-plan.md`。
- dbx 参考:`components/editor/AiAssistant.vue`、`components/editor/QueryHistory.vue`(analysis 动作)、`lib/ai/*`。
- 现有管线:`schema-context-injection.ts`、`sql-safety.ts`、`database-details-shared` 的 db 工具/上下文开关。
