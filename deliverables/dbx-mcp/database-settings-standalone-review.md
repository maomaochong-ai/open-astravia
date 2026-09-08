# 数据库设置区（Preferences → 数据库）单机语境收敛与工具偏好补全：问题分组 · 决策 · 实现方案

> 关联先例：[database-workbench-ux-restructure.md](database-workbench-ux-restructure.md)（工作台三栏界面重构）
> 对照基准：dbx 桌面版顶部栏「设置」对话框（`apps/desktop/src/components/editor/EditorSettingsDialog.vue`）
> 产品语境：本仓库为「本地优先、单机、BYOK」的开源版；企业版走独立代码库、基线复制（见 `deliverables/enterprise-blueprint.md`）。因此**收敛手段是展示层分组、空态与默认值，不砍能力**——单机版保持功能完整，企业差异只在企业版仓库叠加。

---

## 一、反馈 → 主题映射

| 反馈原文要点 | 拆解出的问题 | 主题 |
| --- | --- | --- |
| 「数据库侧边栏点击后进入的设置项，在单机模式非企业版下部分功能可能没有必要」 | ①「数据库」设置页的**全局配置区以 AI 为中心**（AI 数据库感知 + 感知范围 + AI 访问数据库 + 连接级 AI 白名单），未配置 AI 时整区空转、占版面；②三级授权体系（安全执行模式 + 生产写授权 + 连接级 AI 白名单 + AI 总开关）带「团队治理」假设，单机本机场景叠床架屋；③少量文案带企业/权限语义 | 主题 A（单机语境收敛）<br>主题 B（授权体系就近化、文案去企业假设） |
| 「数据库设置缺少 dbx 顶部栏设置按钮点击后的一些必要数据库工具相关设置项」 | ④SQL 编辑器/格式化、结果网格默认、连接树导航行为、隧道/高级、SQL 片段等「工具体验偏好」无设置入口或硬编码（如行数上限 100 写死）；⑤工作台内的会话级控件（每页行数、自动刷新）无法沉淀为用户默认设置 | 主题 C（补全数据库工具偏好）<br>主题 D（入口与心智模型） |

---

## 二、现状盘点（代码证据）

### 2.1 Astravia 数据库相关设置现状

| 载体 | 代码位置 | 现有设置项 |
| --- | --- | --- |
| 设置中心侧栏「数据库」tab | `src/renderer/domains/settings/registry.ts`（`SETTINGS_TABS` 含 database 条目） | — |
| 设置页数据库面板壳 | `src/renderer/domains/settings/components/DatabaseSettings.tsx` | 直接复用 `DatabaseConnectionsWorkspace`（注释明示：仅连接配置管理；三栏工具界面在活动面板） |
| 连接管理页（设置 tab 与 `/database` 路由共用） | `src/renderer/domains/database/components/DatabaseConnectionsWorkspace.tsx`（variant=page 大标题） | 头部动作：打开工作台 / 连接管理助手(`SettingsAiAssist`) / 新增连接 |
| 全局配置区（页内 Section） | 同上 | AI 数据库感知（开关 + 感知范围子面板：全部连接/指定连接/指定表）、AI 访问数据库、安全执行模式（strict/relaxed）、结果行数上限（默认 100）、查询超时；两条 Notice（引擎说明、凭据与生产禁写提示） |
| 连接详情（右栏） | `DatabaseConnectionDetails.tsx` / `database-details-shared.tsx` | 连接信息、dev/prod 环境、测试/删除、「允许生产写」授权、连接级「允许 AI 访问」（按 env 生效/继承默认） |
| 连接表单 | `DatabaseConnectionForm.tsx` | dbtype/host/file/port/database/ssl/user/pwd——无隧道、无高级区 |
| 活动面板「数据库」tab | `DatabaseWorkspace.tsx`（variant=toolbar 紧凑工具条，头部复用 `DatabaseWorkspaceHeader.tsx`） | 会话级控件已存在：每页行数、自动刷新、对象类型过滤、只看已连接、查询历史等，**均无用户级默认值设置** |
| 状态持久化 | `useDatabaseWorkspaceModel.ts` + 主进程 desktop-config（`window.astravia.config.set` 的 `database.*`） | schemaInjection / schemaInjectionScope / prodWriteApproved / safetyMode / rowLimit / queryTimeout … |

i18n：`src/shared/i18n/locales/zh|en/settings.json` 的 `database*` 键已覆盖上述行文案（`databaseSchemaInjection`、`databaseDbxToolAccess`、`databaseSafetyMode`、`databaseRowLimit`、`databaseQueryTimeout`、`databaseEngineNote`、`databaseCredentialRiskNote`、`databaseConnectionAssistant`、`databaseOpenWorkbench` 等），新增文案一律在此扩展。

### 2.2 dbx 顶部栏「设置」对话框分类（参照物）

入口：顶部栏齿轮按钮 → `EditorSettingsDialog.vue`（桌面端左侧分类导航，14 个分类中桌面展示 13 项）：

`appearance`(外观) / `editor`(编辑器) / `sqlFormatter`(SQL 格式化) / `navigation`(导航) / `data`(数据/结果网格) / `backups`(本地备份) / `tunnels`(隧道) / `shortcuts`(快捷键) / `snippets`(代码片段) / `sync`(同步) / `ai`(AI) / `mcp` / `jdbc` / `security` / `about`

其中与「数据库工具使用体验」直接相关、而 Astravia 目前缺失的必要项集中在：

| dbx 分类 | 代表性设置（参考 `zh-CN.ts` settings.* 文案键） | Astravia 现状 |
| --- | --- | --- |
| `editor` | 编辑器字号/字体、自动补全、SQL 关键字高亮、诊断 | 无入口（编辑器能力在活动面板工作台内） |
| `sqlFormatter` | 格式化方言、关键字大小写、缩进规则 | 无 |
| `data` | 打开表默认每页行数、网格默认列宽/行号、批量导出分片大小、危险 SQL 执行确认 | 行数上限 100 硬编码；其余无 |
| `navigation` | 对象树显示系统 schema、双击行为、排序 | 无（活动面板有会话级过滤控件） |
| `tunnels` | 连接隧道（SSH/JDBC 驱动选项） | 无（连接表单无隧道字段） |
| `shortcuts` | 数据库动作（执行/格式化/切结果视图…）快捷键表 | 全局快捷键已有体系，数据库动作未接入 |
| `snippets` | SQL 片段 | 无 |
| `backups` | 引擎本地数据备份 | 无 |

> 注：`ai / mcp / jdbc / security / sync / appearance / about` 属「AI 与账号体系」或通用能力，Astravia 已有对等归属（设置中心 Models/Agent、MCP、通用外观等），不在本次「数据库工具」补齐范围。

---

## 三、主题 A：全局配置区的单机语境收敛（反馈 ①③）

### 3.1 现状（代码证据）

- 「数据库」设置页打开即见「全局配置」区，4 行设置中 2 行 + 1 个子面板 + 连接详情内白名单全部围绕 **AI 对话访问数据库**（schemaInjection / 感知范围 / dbxToolAccess / 连接级 aiAccess）。
- 用户把 Astravia 当纯 SQL 客户端用（未配置任何 AI 模型）时：这些开关不产生任何效果，却占据设置页第一屏；引擎说明 Notice 与 AI 区混排，连接管理的核心任务被稀释。
- 感知范围子面板（全部连接/指定连接/指定表）与「连接级允许 AI」构成**双层范围配置**，语义面向多连接/多人最小权限，单机本机信任边界下属于过度配置。

### 3.2 决策

1. **「数据库」设置页重组为三个语义分区，顺序固定：连接管理 → 工具偏好（主题 C 新增）→ AI 协作。**
   - 「连接管理」与「工具偏好」常显；「AI 协作」在未配置 AI 提供方时**整组折叠为一条空态提示**（引导去 Models 设置），不渲染开关。
   - 判定函数：读取模型/Agent 配置是否至少存在一个可用 provider（与 AI 对话总开关一致）；无则折叠。折叠不丢配置——已配置值保留，配置 AI 后自动展开。
2. **感知范围子面板与连接级白名单保留，但只作为「AI 协作」分区的二级内容（渐进披露），默认收起**；单机默认体验 = 感知范围「全部连接」+ 连接级继承全局，不强制用户逐连接配置。
3. **收敛不改企业差异路径**：schemaInjection / prodWriteApproved 等 desktop-config 键、IPC、默认值一律不动；只动渲染层（registry section 结构 + 组件分组 + 空态）。

### 3.3 实现方案

| 步骤 | 落点 | 要点 |
| --- | --- | --- |
| A-1 | `settings/registry.ts` | database tab 的 sections 注册拆分：`database-connections`（连接管理）、`database-tooling`（工具偏好，新）、`database-ai`（AI 协作）；对齐 registry 既有 section 机制 |
| A-2 | `DatabaseConnectionsWorkspace.tsx` | 按分区渲染；AI 区读取 provider 可用态（新 hook `useHasAiProvider`，从 models 域取），无 provider → 渲染空态条（i18n 新键，含「前往模型设置」动作） |
| A-3 | `database-details-shared.tsx` / `DatabaseConnectionDetails.tsx` | 连接级 AI 白名单折叠为连接详情「AI 协作」细分组（仍走既有 env 生效逻辑）；文案不变 |
| A-4 | zh/en `settings.json` | 新键：`databaseSectionConnections`（可复用现有）、`databaseSectionTooling`、`databaseSectionAi`、`databaseAiNeedsModel`、`databaseAiNeedsModelGoToModels`（走 i18n，禁止硬编码中文） |
| A-5 | 验收 | ①无模型配置时：AI 区不出现任何开关，仅一条空态；②配置模型后：AI 区完整展开且既有值原样保留；③企业版对照：desktop-config 键与 IPC 无任何改动 |

---

## 四、主题 B：授权体系就近化与文案去企业假设（反馈 ① 内嵌）

### 4.1 现状（代码证据）

- 安全执行模式（strict/relaxed）在全局区；「允许生产写」授权在连接详情；AI 访问先过全局总开关再过连接级白名单——同一写保护语义分散三层，单机用户需理解「为什么全局开了连接还要开」。
- 设置页 Notice 中的凭据明文/生产禁写提示是必要的安全告知，但位于 AI 区下方，与「连接管理」分离。

### 4.2 决策

1. **写保护语义归一**：安全执行模式 + 生产写授权合并到「连接管理」分区的连接详情内（就近原则：哪个连接写、就在哪个连接配）；全局区只留默认值语义的入口（`safetyMode` 全局默认 strict 保留，供新连接继承）。
2. **文案去企业假设**：把「授权/审批/白名单」系文案在单机语境改写为「保护本机数据/允许/阻止」直白表述（如连接级 AI 白名单改「此连接允许 AI 读取吗」），不改任何存储键。
3. 本主题为**纯渲染层与文案调整**，风险最低，可与 A 合并实施。

### 4.3 实现方案

| 步骤 | 落点 | 要点 |
| --- | --- | --- |
| B-1 | `DatabaseConnectionsWorkspace.tsx` | 全局配置区删除「安全执行模式」行；safetyMode 全局默认改为只出现在「新连接默认」上下文（如有）或保持隐藏默认 strict |
| B-2 | `database-details-shared.tsx` / `DatabaseConnectionDetails.tsx` | 连接详情内组织：连接信息 → 环境与写保护（dev/prod + 允许生产写 + 执行模式覆盖）→ AI 协作（允许 AI 读取） |
| B-3 | zh/en `settings.json` | 涉及授权语义的既有键文案校准（如 `databaseSafetyMode*` → 面向单机措辞）；新增键走 i18n |
| B-4 | 验收 | ①不配置任何连接也能看懂写保护默认行为；②全局区第一屏不再出现授权开关；③既有 config 键读写兼容 |

---

## 五、主题 C：补全「数据库工具」偏好设置（反馈 ②④⑤）

### 5.1 决策

1. **新增「工具偏好」分区**（主题 A 的第二个分区），承载数据库工具使用体验的用户级默认值，字段统一落 `desktop-config database.toolPrefs.*`（避免污染 `database.*` 既有键）。
2. 首期只做**工作台已有行为可控、有明确默认值**的项（低风险、无引擎依赖）；编辑器/格式化/片段等依赖编辑器与引擎能力评估的项列为 Phase 2，先给 UI 骨架 + 能力标记，不空转。
3. 工作台会话级控件改为「首次取 toolPrefs 默认值、会话内可临时覆盖」——与 dbx 工作台一致：临时调整不清空默认，重开工作台回到默认。

### 5.2 首期（Phase 1）设置项与默认值

| i18n 键前缀（建议） | 设置项 | 默认值 | 消费点（现状硬编码处） |
| --- | --- | --- | --- |
| `databaseTooling.defaultPageSize` | 结果默认每页行数 | 100 | 结果网格分页初值（对齐现 rowLimit 语义、解耦） |
| `databaseTooling.autoRefreshEnabled` | 结果自动刷新默认 | 关 | 工作台自动刷新控件初值 |
| `databaseTooling.onlyConnectedObjects` | 对象树默认只看已连接 | 关 | 对象树过滤控件初值 |
| `databaseTooling.hideSystemSchemas` | 默认隐藏系统 schema | 开 | 对象树 schema 展示 |
| `databaseTooling.rowLimitHard` | 最大可取行数（防呆） | 1000（比每页大） | 服务端/引擎 fetch 上限（替换写死值处） |
| `databaseTooling.queryHistoryRetention` | 查询历史保留条数 | 50 | 查询历史面板 |
| `databaseTooling.confirmDangerousSql` | 危险 SQL 执行前确认 | 开（strict 语义继承） | 写操作确认弹窗（对齐 dbx data.confirmDangerousSqlExecution） |
| `databaseTooling.formatKeywordCase` | SQL 格式化关键字大小写 | 大写 | Phase 2 若引擎带格式化则启用 |

### 5.3 实现方案

| 步骤 | 落点 | 要点 |
| --- | --- | --- |
| C-1 | `useDatabaseWorkspaceModel.ts` | 扩展 model：`toolPrefs` 状态 + 默认值表 + `window.astravia.config` 读写（沿用既有 database config 通道）；导出 `applyToolDefaults(prefs)` 供工作台控件消费 |
| C-2 | `DatabaseWorkspace.tsx` 及结果网格/对象树/历史组件 | 控件初值改读 toolPrefs；修改控件仅更新会话态（sessionOverride），不改默认 |
| C-3 | `DatabaseConnectionsWorkspace.tsx`（工具偏好分区） | 渲染 8 个设置行（复用既有 Row/开关/输入组件样式，参考 `database-details-shared.tsx` 行模式） |
| C-4 | zh/en `settings.json` | 新增 `databaseTooling.*` 文案（含说明），禁止硬编码 |
| C-5 | 类型与默认值测试 | `database.toolPrefs` 合并采用浅合并 + 白名单，缺省回默认；写单测覆盖「未配置 / 部分配置 / 非法值」三态 |
| C-6 | 验收 | ①设置页改默认 → 重开活动面板生效；②会话内调整 → 重开回到新默认；③旧 config 无 toolPrefs 时平滑取默认 |

---

## 六、主题 D：入口与心智模型（反馈 ②⑤ 外延）

### 6.1 现状（代码证据）

- Astravia 数据库设置有**两个承载面**：设置中心 tab（连接管理页，page 变体）与活动面板工作台（toolbar 变体）；`DatabaseWorkspaceHeader` 注释明确两者职责划分。
- 工作台内无「偏好」齿轮直达设置（需求中缺失项的诱因之一）；dbx 采用顶部栏唯一设置入口 + 工作台内不另设第二设置中心。

### 6.2 决策

1. **不新增第二设置中心**：工具偏好统一放设置中心「数据库」tab（与 dbx「顶部栏设置 = 唯一入口」心智一致），避免双入口分裂。
2. **工作台头部增加一个「偏好」轻量动作**（toolbar actions 区齿轮）：点击后**定位**到设置中心 → 数据库 → 工具偏好分区（复用既有 flyTo 侧栏会话/导航机制，先例见 `ai-assist/flyToSidebarSession.ts` 模式），而非打开第二个对话框。
3. Phase 2 项（编辑器字号/自动补全、格式化方言、SQL 片段、隧道/高级、快捷键接入）**依赖编辑器与引擎能力评估**，先以「能力标记」登记，引擎侧确认后再放 UI，避免空转开关。

### 6.3 Phase 2 能力依赖清单（登记不实现）

| 设置项 | 前置依赖 | 判定/落点 |
| --- | --- | --- |
| SQL 编辑器字号/补全/高亮 | 编辑器组件能力（活动面板 SQL 编辑器是否支持主题/字号注入） | 编辑器组件 + toolPrefs |
| SQL 格式化方言/规则 | 主进程是否携带格式化引擎（对齐 dbx sqlFormatter） | 引擎 IPC |
| SQL 片段库 | 编辑器/引擎是否支持 snippet 展开 | 编辑器组件 |
| 连接隧道/高级（SSH、驱动选项） | 连接模型与引擎是否支持 tunnel（现连接表单无此字段） | `DatabaseConnectionForm.tsx` + 引擎能力标记 |
| 数据库动作快捷键 | 现有快捷键体系是否暴露应用级动作注册 | shortcuts 设置 tab 接入 |
| 引擎本地数据备份 | 引擎层备份能力（对齐 dbx backups） | 引擎侧 |

---

## 七、实施顺序与排期

| 阶段 | 内容 | 影响面 | 验证 |
| --- | --- | --- | --- |
| Phase 1a（本次） | 主题 B（文案/就近化）→ 主题 A（分区 + AI 空态） | registry + DatabaseConnectionsWorkspace + i18n | A-5/B-4 验收 |
| Phase 1b（本次） | 主题 C 首期 8 项 toolPrefs + 工作台消费 | model + 工作台控件 + 设置分区 | C-6 验收 |
| Phase 2 | 主题 D 能力依赖项（编辑器/格式化/隧道/片段/快捷键/备份） | 编辑器与引擎侧评估后单独立项 | 各能力标记通过 |

---

## 八、决策与风险记录

| # | 决策 | 理由 | 风险/缓解 |
| --- | --- | --- | --- |
| D1 | 收敛只做渲染层，不动 desktop-config 键与 IPC | 企业版独立仓库基线复制；单机功能不丢 | 无 |
| D2 | 「数据库」设置页三分区且 AI 区按可用性折叠 | 纯 SQL 客户端用户不被 AI 项绑架；配置不丢 | provider 判定与对话总开关语义需一致；写单测 |
| D3 | 写保护就近到连接详情 | 单机单一信任边界下减少三层理解负担 | 全局默认仍 strict，新连接继承，无安全降级 |
| D4 | 工具偏好落 `database.toolPrefs.*`，会话控件可临时覆盖 | 与 dbx 一致：默认可设、会话可调、互不污染 | 控件初值读取路径改造点较多，逐步替换 |
| D5 | 不新增第二设置中心，工作台齿轮仅做「定位跳转」 | 单一入口心智；避免偏好两处可改 | 跳转目标需稳定（registry section id） |

---

## 九、验收总清单（跨主题冒烟）

1. 无 AI 模型配置：设置 → 数据库 仅见「连接管理 + 工具偏好」，AI 区为空态条；配置模型后 AI 区完整展开且值保留。
2. 连接详情聚合：信息/写保护/AI 读取三级就近组织；全局区第一屏无授权开关。
3. 工具偏好改「每页行数 = 200」→ 重开活动面板结果网格以 200 行分页；会话内切回 100 不影响默认。
4. 旧用户升级：无 `toolPrefs` 键时全部走默认值，无报错、无额外写入。
5. 全部新文案来自 zh/en settings.json，无硬编码中文。
6. 企业版对照：`git diff` 不含任何 desktop-config 键、IPC、schemaInjection/prodWriteApproved 逻辑改动。
