# 能力（Ability）统一存放与呈现，不统一物理安装

Skill / Scene / MCP Server / Plugin 收敛为单一概念 [[Ability（能力）]]：服务端合为一张 `abilities` 表靠 `type` 判别，desktop 合为一个「能力」页与一套详情页。新增 `type = bundle` 表达[[bundle（能力套装）]]。**统一只发生在「数据存放」与「概念呈现」两层——物理分发与安装刻意保持三轨不变。** MCP Ability 后续增加的声明式受管运行时仍属于 MCP 安装轨道，不把三种运行时合成一个万能安装器，见 [ADR-0092](./0092-declarative-managed-runtimes-for-mcp-abilities.md)。

## 背景

三者此前是三张表、三套 handler/service/dto/vo、三条市场接口、desktop 三个列表页，但对用户而言是同一件事：「给 agent 加点本事」。差异全是技术形态，不是用户心智。

三张表的字段还严重不对称：plugin 无图标、mcp 无版本无下载计数、只有 skill 有受管分类。其中 **mcp 无版本**是一个真 bug 面——admin 改了市场 MCP 的 `config`，已安装用户永远收不到更新，因为客户端把 config 原样写进 `mcp.json` 后再也不看。

desktop 已经先走了半步：`useCapabilitiesModel` 把 skill 与 MCP connector 合并为 `CapabilityItem`，但 plugin 仍是平行的另一套卡片与详情。

## 决策与理由

### 统一的边界

统一 **存放**（一张表）与 **呈现**（一个列表、一套详情页、一套图标口径、一套分类）；**不统一安装**——skill 装 `~/.vetta/skills/`、scene 装 `~/.vetta/scene/`、plugin 装 `~/.vetta/plugins/`、mcp 写进 `mcp.json` 的一个 key；声明了受管运行时的 MCP 还会在 `~/.vetta/abilities/mcp/` 保存版本化可执行产物。三条轨道是三种不同的运行时机制，合并它们只会造出一层无收益的抽象。

scene 是这一模式的既有先例：服务端与 skill 同表同归档，仅客户端目录不同——本决策是把这个先例推广到全部四种形态。

### 标识与版本

`UNIQUE(type, slug)`，引用形式 `"skill:figma-ui"`。不做全局唯一 slug：存量三张表各自表内唯一、跨表可重名，全局唯一会强迫人工改名，而改名会打断已安装客户端的匹配。这个复合键也与 desktop 现有的 `skill:` / `connector:` 前缀 id 天然同构。

全 type 必有 `version`。mcp 改 `config`、bundle 改成员清单均由服务端自动 `patch+1`（沿用 skill 既有的 `bumpPatch`），从而让"客户端比对本地版本与市场版本"成为**唯一**一套更新检测逻辑，顺手补上 mcp 收不到更新的洞。

### permissions 是 ADR-0019 的刻意例外

ADR-0019 定「管理字段以 DB 为唯一真相源，包内 metadata 仅作导入兜底」。`permissions` 反向：**manifest 为准，admin 只读不可改**。理由是客户端授权时读的是本地 `plugin.json`，admin 在后台改权限列表不会改变实际授权行为，只会让市场页展示的权限与真实申请的权限不一致——那是安全误导，不是管理灵活性。

`icon` 则新增到 `PluginManifest`，取值口径与 skill 对齐三态（包内相对路径 / `solar:` Iconify / http(s) 外链）。它必须由 admin 与 desktop **两边**解析：系统插件（ADR-0024）、从路径安装（ADR-0042）、dev 热更新的插件根本不经过市场，图标只能由客户端从安装目录读。

### bundle 的克制

`type = bundle` 恒无产物，成员以 `(type, slug)` 引用已上架行；仅 mcp 允许私有内联（它本就无产物）。**不允许内联带产物的成员**，否则 bundle 要长出自己的打包格式、校验与解包逻辑——而那正是 plugin 内聚（ADR-0040）已经做过的事。**不允许 bundle 嵌套 bundle**，成员集合恒为一层。

bundle 与 plugin 内聚的判据：bundle 是**松散**组合，成员对用户可见、可单独安装卸载启停；plugin 内聚是**紧耦合**，成员对用户不可见、随插件生死。要发「不单独上架的 skill/MCP」，答案是打进 plugin。

bundle **不进[[能力安装台账]]**，`installed` / `enabled` / `needsUpdate` 全部由成员派生。没有独立状态就没有漂移，成员清单变更也自然表现为「可更新」。

### raw 与详情

固定列之外只留一个 `raw jsonb`，内部按「谁读、谁写、什么时候变」分三个命名空间：`raw.config`（客户端运行时读）、`raw.detail`（详情页读、运营随时改）、`raw.source`（上传快照、无人读，排错用）。不再在 raw 里重复 `name` / `description` / `author` ——那正是 ADR-0019 踩过的双源坑。

`raw.detail` = `{ showcases: [], content: <markdown>, i18n: { en: {...} } }`。正文取 markdown 而非声明式 section 体系，换取 admin 编辑成本最低；代价是 `CapabilityDetailSections` 的 featureList / scenarios / permissions / reviews 结构化渲染作废。`showcases` 单独保留为结构化数组，因为它不是正文而是头图，markdown 画不出 `ShowcaseChatOverCanvas` 那类宿主呈现模板。

首期文案单语言，`raw.detail.i18n` 预留 locale 覆盖块，客户端 `i18n[locale] ?? 默认`。

### 分类

`ability_categories` 去掉 `scope`，五种 type 共用一套**用途**分类；`type` 降为正交的第二筛选轴。用户按用途找东西（设计/开发/写作），不按技术形态找——形态只是卡片上的 badge。

### 内置能力

`skill-presets` 与系统插件（ADR-0024）不来自市场、无市场行，展示在「我的」下、`readonly`、不进台账。其 slug 采用**不会与市场冲突的命名空间**，因此不需要任何去重或优先级逻辑。

### 存量

产品未正式上线，存量数据可弃。迁移中直接 drop `skills` / `skill_categories` / `plugins` / `mcp_servers` 及其旧接口，不做双写与兼容期（沿用 `migrate.go` 中 `dropZenArtifacts()` 的既有惯用法）。

## 考虑过的备选

- **三表保留，只在 desktop 合并展示**：改动最小，但 mcp 无版本、plugin 无图标、分类只有 skill 有这些不对称会永久留在数据层，desktop 得一直靠适配层抹平，且新增 bundle 无处安放。
- **Ability 直接定义为组合包**（一行含多个制品）：与最初提案的 `skills[] / mcps[] / plugins[]` 一致，但会让最常见的「单个 skill」也被迫套一层包装，且组合语义与 plugin 内聚重复。改为「单制品为主 + bundle 作为一种 type」后，组合能力仍在，代价只落在真正需要它的那一种 type 上。
- **详情用声明式 section 体系**：保住上周落地的结构化渲染与 showcase 模板，但运营写一篇介绍要拼 JSON。选择 markdown 正文 + showcase 结构化数组的折中。
- **命名沿用 Capability**：desktop 零重命名，但与 `@vetta/capability-runtime` 的授权契约层彻底同名，代码里无法靠名字分辨两个完全不同的东西。改为市场条目叫 Ability、授权层中文让出「能力」一词。

## 影响

难回退的是**结构而非数据**：一旦 desktop 删掉 `/plugins` 路由与整套 plugin 卡片/详情组件、admin 合成单一列表、服务端 drop 三张旧表，要退回分离形态等于重做一遍。

未来读者会困惑的两处，本 ADR 即为解释：其一，为什么「统一」了却还有三个安装目录；其二，为什么 `permissions` 和其它管理字段的真相源方向相反。
