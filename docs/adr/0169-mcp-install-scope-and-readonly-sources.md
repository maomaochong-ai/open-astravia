# ADR-0169：MCP 安装层级、只读来源与安装技能

## 状态

已接受。对应 ADR-0157 登记表 B12 的 `dqpd`、`ro8e`（文档部分）与 B13 的 `4b7x`、`6d2h`。

## 背景

`ro8e` 的代码已经落地：项目层读取会把仓库根目录的 `.mcp.json` 并进
`.astravia/mcp.json`，同名整体替换、`.mcp.json` 永不被改写（`FileMcpConfigSource`）。
但这条能力对上层是**不可见**的：

- 能力合同里没有「这一条装在哪一层」的概念。`mcp.manage` 只有一个扁平的名字空间，
  不传层级就等于「碰全局」；用户与模型都看不出某个 server 来自全局、项目还是只读的
  `.mcp.json`。
- 合并发生在 `loadProject()` 里，合并后条目失去来源身份——想对 `.mcp.json` 的条目
  「拒绝写入」已经没有信息可用。
- `install-ability` skill 因此无法教模型「先问装到哪一层」，也无法教它「查看已装内容
  用查询动作而不是读配置文件」。后者是安全问题：配置文件里有明文密钥，读进上下文就
  等于发给模型供应商。

## 决策

### 1. 层级是一等公民，不是可选参数

能力合同（`capability-sdk/src/domain/mcp.ts`）为 `list` / `get` / `upsert` /
`set-enabled` / `remove` 增加 `scope?: "global" | "project"` 与项目定位 `cwd?`；
`mcpServerSummary` / `mcpServerDetail` 增加输出字段 `scope` 与 `readOnly`。

语义（三条都要有用例）：

- **不传 `scope` = 只碰全局**，与今天的默认行为完全一致，老调用方不受影响；
- **`scope: "project"` 必须带本机 `cwd`**，远程（`ssh://`）项目直接拒绝——远端目录
  不在这台机器上，写进去的配置谁也读不到；
- **全局与项目同名时必须指明 `scope`**，否则报错（不替用户猜「他大概是指项目那份」）；
- 来自 `.mcp.json` 的条目 `readOnly: true`，任何写操作拒绝并给出可读原因。

### 2. 合并时记住来源，而不是事后反推

`FileMcpConfigSource` 在 `loadProject()` 合并时给每条打上来源标记
（`native` / `compat`），`readOnly` 由来源决定。**不**在写路径上重新读一遍文件反推
来源：那样每个写操作都要多一次 I/O，且两次读取之间文件可能已变。

合并规则保持不变：同名整体替换、`${VAR:-default}` 与 `${PROJECT_ROOT}` 展开、
`.mcp.json` 只读。

### 3. 审批弹窗显示落点并原样回传

写操作走审批，审批界面必须显示「这一条装在全局还是这个项目」，并把 `scope` 原样带回
主进程。否则用户批准的是一个他没看见的落点——尤其是「同名 server 在两个层各有一份」
时，批准哪一份是实质性差异。

### 4. 三层顺序：能力 → skill → 文档

- `dqpd` 先给合同加字段、加来源标记与审批落点；
- `4b7x` 才能在 skill 里写「没说清且有项目时先问层级」「项目层密钥只允许 `${VAR}` 引用」
  「同名必须指明 `scope`」；
- `6d2h` 的两条约束独立于层级，但「用查询动作查看已装内容」依赖 `mcp.query` 返回的
  脱敏视图里已经带上 `scope`，所以放在 `dqpd` 之后。

顺序不可颠倒：先写 skill 会让模型传一个被 `additionalProperties: false` 拒掉的字段，
表现为「模型说要装，但每次都报参数错误」。

### 5. 文档站补齐 `.mcp.json` 的可见说明

`apps/docs-site/content/docs/product/mcp.mdx` 补一节：项目层会并入根目录 `.mcp.json`、
同名以 `.astravia/mcp.json` 为准、`.mcp.json` 不被改写、`${VAR:-默认值}` 可用、
**只在信任的仓库使用**——打开含 `.mcp.json` 的仓库等于按别人的配置启动本机命令。

## 备选方案

- **用单独的能力方法表达层级**（`mcp.manage-project`）：两套方法各自演进，调用方仍要
  记住「项目层的那个叫什么」，比一个 `scope` 字段更容易漏。
- **把 `.mcp.json` 的条目复制进 `.astravia/mcp.json` 再统一管理**：等于改写用户的文件，
  也让「上游仓库更新 `.mcp.json`」失效。
- **只在 UI 里显示层级、能力合同不变**：模型侧仍然只能装全局，「帮我装到项目里」这个
  最常见的诉求做不到。

## 后果

- 正面：装到哪一层是显式选择；`.mcp.json` 的条目不会被误改；模型能通过一个查询动作
  看到全部层级并正确追问；skill 不会再把明文密钥读进上下文。
- 代价：能力合同新增两个字段、五个输入 schema 与两个输出 schema 都要改，能力目录
  （`docs/capabilities/catalog.json` 与相关快照）必须用生成脚本重出，不能手改；
  主进程 `mcp-settings-service` 要从「一份合并视图」拆成「按层读写 + 冲突检测」；
  三个审批弹窗与 i18n（中英）都要加落点文案。
- 兼容性：不传 `scope` 的行为与现状完全一致；插件 SDK 的
  `official.mcp.upsert(name, data, target?)` target 为可选，旧调用签名继续可用。
- 已知限制：市场安装的 skill 目前只能装全局，skill 里要写明这一点，不要承诺不支持的事。

## 验证

- `mcp-settings-service` 的层级读写：同名冲突、`scope: "project"` 缺 `cwd` 被拒、
  远程项目被拒、`.mcp.json` 条目写操作被拒（`readOnly`）。
- `FileMcpConfigSource` 的来源标记：合并后 `.mcp.json` 与 `.astravia/mcp.json` 条目
  各自的 `scope` / `readOnly` 正确，同名时以 native 为准。
- 审批链路：弹窗显示落点，批准后主进程收到的 `scope` 与弹窗一致。
- 能力目录重生成后快照测试通过；`docs-site` 中英两篇链接与命令核对。
- skill 内容评审：`SKILL.md` 里出现的每个字段都在 `mcp.manage` / `mcp.query` 的 schema
  里真实存在。
