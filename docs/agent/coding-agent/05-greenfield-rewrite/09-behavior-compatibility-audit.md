# 行为兼容性审计

## 1. 审计原则

本次工作是架构重写，不是产品功能重写。默认迁移合同为：

> 允许改变包、类、依赖方向、生命周期和组合方式；不允许静默改变用户、模型、宿主或持久化数据能够观察到的行为。

行为不仅指最终文本，还包括：

- Tool 名称、模型可见描述和 JSON Schema。
- 成功 content、details、错误消息和重试提示。
- 文件、进程、网络与存储副作用。
- 路径、编码、图片、截断、取消和平台语义。
- Profile、scope、权限和默认启用条件。
- Session 事件顺序、输入排队、恢复和分支。
- 旧持久化数据的读取结果。

更严格的参数校验、更小的可访问路径、更少的文件格式或不同的取消行为都属于功能变化。

## 2. 本轮发现与处理

### 2.1 `current_time`

首次新实现存在三个差异：

| 行为 | 旧实现 | 首次新实现 | 处理 |
| --- | --- | --- | --- |
| 模型描述 | 完整使用指引 | 简短一句话 | 已恢复旧描述 |
| JSON Schema | 未声明 `additionalProperties: false` | 拒绝额外字段 | 已恢复旧 Schema |
| 已取消 Signal 下直接调用 | 仍返回时间 | 在时间源调用前抛出 | 已恢复旧直接执行语义 |

现已增加旧新差分合同，直接比较名称、label、完整描述、Schema、固定时间执行结果、
已取消直接调用、update、phase、`scope_use` 和 `category`。全部旧会话场景还会分别运行
旧 `resolveActiveToolNames` 与新注册选择器，比较最终激活工具集合。

注册元数据没有加入通用 `RuntimeToolDefinition`。新 `CodingToolRegistration` 在 Coding
能力层持有 `scopeUse` 和 `category`，组合根把会话场景传给 `CodingToolsFeature`。这避免
Kernel 绑定 Coding 场景词汇，也避免把 Agent Profile ID 错当作会话场景。

因此 `current_time` 可以认定为工具定义、执行和注册行为兼容；但完整 Coding Tools Feature
仍缺少其他旧工具，不能整体切换生产入口。

### 2.2 `read`

尝试实现的工作区纯文本 read 与旧工具存在以下功能差异：

- 旧工具允许基于 cwd 的相对路径、绝对路径和 `~`；尝试实现限制为 Workspace Root。
- 旧工具包含 macOS 空格、NFD、弯引号及 CJK 文件名空格模糊匹配；尝试实现没有。
- 旧工具支持 UTF-8 失败后按 GB18030 解码；尝试实现只按 UTF-8 解码。
- 旧工具按文件内容魔数识别 jpg/png/gif/webp，并返回 Image Content；尝试实现拒绝所有二进制。
- 旧工具支持图片自动缩放及关闭自动缩放；尝试实现没有。
- 旧工具对已知二进制扩展返回对应 Skill 提示；尝试实现直接抛错。
- 旧工具为每一文本行生成 edit 可使用的锚点；尝试实现返回原始文本。
- 旧工具使用既有 `TruncationResult` details 和既定提示文案；尝试实现改变了 details 结构和提示。
- 旧 Schema 对 offset/limit 使用 Number 且没有新增边界约束；尝试实现改成正整数约束。
- 旧工具的完整模型描述包含 read/edit/grep/PDF/文档协作规则；尝试实现只保留一句说明。

结论：该实现属于缩减功能，已撤下，`read` 仍标记为未迁移。后续实现必须让
`packages/coding-agent/test/tools.test.ts` 中的 read 行为用例以及路径模糊、图片处理、
锚点相关测试同时运行在旧新实现上。

现已提取参数化 Read Behavior Contract，并先由旧实现作为 Oracle 运行。基线覆盖：

- 完整定义关键字段、scope 和 category。
- UTF-8、GB18030、空文件与不存在文件。
- 相对、绝对、`~`、Unicode 空格、CJK 空格模糊匹配。
- macOS AM/PM 窄空格、NFD、弯引号及组合路径。
- offset、limit、行锚点、行数截断、字节截断和 continuation notice。
- 图片魔数、默认 Photon 处理、关闭自动缩放和伪图片扩展。
- 已知扩展与无扩展二进制提示。
- 自定义 Read Operations、调用顺序、提前取消和执行中取消。

合同运行时确认了 Windows 下 `~` 展开会保留 `/` 的旧混合分隔符。该细节暂时作为行为基线
保留，不能在架构迁移中顺手标准化。

现已在 `runtime-tools/coding/tools/read` 完成独立 Runtime 实现。生产源码不导入旧
`coding-agent`，路径解析、文本解码、锚点和截断位于包内纯行为模块；文件系统与 MIME 检测
通过 `ReadOperations` 注入，图片处理通过 `ReadImageProcessor` 注入。默认实现仍使用
`file-type` 和 Photon/WASM，不以抽象为由删除图片能力。

兼容性证据：

- 旧实现和新实现同时运行同一组 18 项 Read Behavior Contract。
- 旧新 name、label、完整 description、TypeBox Schema、scope 和 category 完全比较。
- 锚点、行截断、字节截断和二进制提示执行结果进行逐字节比较。
- 默认图片处理、关闭自动缩放、伪图片扩展和可注入图片处理器均有测试。
- 新 read 已通过真实 `AgentCoreTurnEngine` Tool Loop 读取相对路径文件。

新 read 已加入 Greenfield Coding Tools Feature；包根旧 `createReadTool` 和当前生产入口仍
保持不变。工具模块运行时行为已完成迁移，但独立可执行宿主的 Photon WASM 复制/定位尚未
进行产物级验证，因此仍是未来生产宿主切换的门禁，不能仅凭模块测试删除旧打包链路。

### 2.3 `ls`

旧 `ls` 不只是本地 `readdir` 包装，还包含以下可观察合同：

- 基于 cwd 的相对路径、绝对路径、`~`、Unicode 空格与模糊路径解析。
- macOS AM/PM 窄空格、NFD、弯引号及组合路径 fallback。
- 大小写不敏感排序、dotfile 保留和目录 `/` 后缀。
- 默认 500 项、自定义 Number limit 和 50KB 头部截断。
- entry limit 与 byte limit 的既定提示及 `LsToolDetails`。
- 单项 stat 失败时跳过、目录读取失败时的错误包装。
- 自定义 `LsOperations` 调用顺序。
- 提前取消和执行中取消。

现已完成独立 Runtime 实现，并让旧、新实现同时运行同一组 15 项 Ls Behavior Contract。
另有差分测试逐字段比较完整定义、注册元数据、所有场景的最终激活集合和典型执行结果；显式
选择的 Runtime ls 已通过真实 `AgentCoreTurnEngine` Tool Loop。

审计确认旧 `ls.scope_use` 是空数组。按旧 fail-closed 语义，它表示工具存在于可用工具集，
但默认不在任何场景激活。新 `LS_TOOL_SCOPES` 保持空数组，Coding Tools Feature 即使持有该
注册也不会把 `ls` 放入默认 Snapshot。将它改成全场景会扩大模型能力，属于功能变化。

旧实现还有一个非理想但已存在的取消行为：执行中取消会先拒绝调用 Promise，但已经开始的
Operations 仍会继续运行。新实现按合同保留该行为。若未来要让取消真正停止 Operations，
必须单独设计可取消 Port 并作为行为变更处理，不能夹带在本轮架构迁移中。

### 2.4 动态 Coding Tool Catalog

此前 `CodingToolsFeatureOptions` 逐项暴露 `currentTime`、`read` 和 `ls` Options，导致每迁移
一个工具都必须修改 Feature，并让能力编排层绑定具体实现。这一结构已替换为：

```text
Tool Factory + Tool Options
  -> CodingToolRegistration
  -> CodingToolRegistry
  -> versioned Catalog Snapshot
  -> Activation
  -> CodingToolsFeature
  -> ModelCallContributionProvider
  -> Model Call Frame
```

`CodingToolCatalog` 暴露成员 `snapshot()` 和执行前只读查询 `resolve()`；
`CodingToolRegistry` 才暴露 `register()` 和 `unregister()`。Feature 依赖只读接口，因此
不能在 prepare/contribute 中改变全局工具目录。

激活支持：

- scope 默认集合。
- scope 默认集合加显式工具名。
- 完全显式工具名集合。

未知名称不会绕过注册表。`ls` 现在可以通过显式激活进入 Feature 和真实 Tool Loop，同时空
scope 的默认不激活行为保持不变。

原设计让 Feature prepare 绑定 Catalog 成员，并要求每次工具变化都重新编译整个 Profile。
这会重新 prepare 所有 Feature，也会让当前 Turn 通过旧函数引用继续执行已注销工具。现已
修正为：

- Feature prepare 只创建一个长生命周期 `ModelCallContributionProvider`。
- 每次模型调用前读取最新 Catalog 并生成不可变 Model Call Frame。
- Catalog 变化不重新编译 Runtime Snapshot，不重新初始化未变化的 Feature。
- 模型已经看到工具后，如果工具在执行前被删除，调用返回错误 Tool Result。
- 同名工具被替换时，旧 Schema 产生的调用不会路由到新实现。
- 下一次模型调用立即看到新工具清单。

一次已经发出的模型请求仍然使用发送时的提示词和 Tool Schema，这是不可消除的物理边界。
Skill、提示词和 MCP Tool 可以通过同一动态 Provider 合同在后续模型调用刷新；但对应具体
Feature 尚未迁移，不能把通用合同误记为 Skill/MCP 功能已经完成。

上一阶段执行前校验以 `resolve(toolName)` 返回的 registration 对象引用判断定义是否变化。
对象引用不是跨 Adapter、序列化或重建 Catalog 后稳定的能力身份，也无法表达 deactivate 与
revoke 的不同语义。现已改为：

- Model Call Frame 捕获 `sourceId + capabilityId + revision` 稳定绑定。
- Catalog Snapshot、Frame 和执行 Guard 即使复制 Entry，也按绑定值判断同一版本。
- Catalog `execute()` 原子完成实时状态校验与 in-flight 登记，不把 TOCTOU 竞态留给
  Feature。
- deactivate 只停止后续暴露和新执行，普通 unregister 不终止已开始操作。
- revoke 明确表示权限/安全撤销，轮换 revision 并协作取消所有在途执行。
- revoke 后即使底层实现忽略取消并返回，Catalog 也丢弃结果；已经产生的外部副作用仍不能
  自动回滚。

能力不可用错误现在保留稳定 `code`、`retryable` 和 `metadata`，经 runtime-core Adapter
传到 Agent Tool Result。普通工具错误仍保持旧文本和空 details，不把所有异常强行分类。

对应合同覆盖稳定绑定副本、deactivate/activate、revoke、unregister、注销后同名重注册、
执行中生命周期变化和结构化错误端到端桥接。以上变化只改变能力编排和错误表达，不修改
current_time、read、ls 的模型描述、Schema、输出、路径、取消或副作用合同。

### 2.5 `grep`

旧 grep 依赖 `coding-agent` 的工具下载器、ripgrep 子进程和本地文件读取，但这些依赖不应
成为 Runtime Tools 的包边界。迁移采用以下拆分：

```text
GrepToolOptions.rgPath
GrepOperations.isDirectory / readFile
  -> Runtime grep
  -> CodingToolRegistration
  -> Catalog / Model Call Frame
  -> AgentCoreTurnEngine Tool Loop
```

已保留的可观察合同包括：

- 完整模型描述、TypeBox Schema、`scope_use` 和 `category`。
- 单文件/目录路径格式、相对路径、regex、literal、ignoreCase、glob。
- 上下文行的锚点格式、匹配行锚点哈希和匹配限制提示。
- ripgrep 的空结果、非零错误、路径错误和取消语义。
- 文件读取失败时的 `(unable to read file)` 输出。
- 匹配结果的字节截断、单行截断和 `GrepToolDetails`。

Runtime 实现不导入旧 `coding-agent`，默认使用宿主 PATH 中的 `rg`，也允许组合根通过
`rgPath` 指定已管理的可执行文件。这样下载、版本选择和权限由宿主负责，Runtime 只拥有
搜索和结果格式化合同。远程文件场景可以注入 `GrepOperations.readFile`，不改变模型可见
结果格式。

证据：

- 旧实现与 Runtime 实现定义和注册元数据逐字段比较。
- 同一临时文件使用相同 pattern、context 和 limit 比较完整结果。
- Runtime grep 已通过真实 Agent Core Tool Loop。
- 取消在 Runtime Tool 边界生效，未把取消处理移入宿主下载器。

### 2.5.1 宿主可执行文件解析

审计发现旧 `ensureTool` 把三个职责混在一起：

```text
PATH / managed-bin discovery
  + download / version selection
  + user-facing logging
```

Runtime grep/find/tree 只需要第一项的结果，不应导入旧下载器。因此新增通用
`CodingToolExecutableResolver`：

```text
Host resolver
  -> Promise<string | undefined>
  -> Runtime grep/find/tree
  -> spawn rg/fd
```

Runtime 提供的本地 Adapter 只检查受管 bin 目录和 PATH，不下载、不修改文件、不输出日志。
宿主如果仍需要自动下载，可以在 Composition Root 实现同一 Port 并委托旧下载器；下载策略
不会进入 Runtime Tool。当前已在 `coding-agent` 增加
`createToolExecutableResolver`，以 `silent: true` 委托旧 `ensureTool`，形成不改变旧下载
行为的结构适配。适配器位于 `adapters/runtime-tools`，并通过
`@vetta/coding-agent/host` 作为组合层稳定入口提供；
旧的 `core/host` 子路径保留为迁移期转发入口。

`grep/find/tree` 在注入解析器时于每次执行解析 `rg`/`fd`，因此宿主可以在运行时替换或移除可执行
文件，而不需要重建 Runtime Snapshot。未注入解析器时仍使用原有 `rg`/`fd` 默认命令名，
保证迁移期间的直接调用行为不变。

证据：

- 本地 Adapter 覆盖受管 bin 优先、PATH fallback、Windows 后缀和不可用返回。
- grep/find/tree 合同测试确认解析器分别收到 `rg`/`fd`，不可用时保留原错误文本。
- coding-agent Adapter 测试确认每次解析静默委托 `ensureTool`，并透传路径或 `undefined`。
- `ensureToolWithDependencies` 行为测试确认受管路径优先、离线/Termux 不下载、下载成功
  透传路径以及下载失败返回 `undefined`；测试不触发真实网络。
- Runtime Host Resolver 测试确认受管文件移除后会回退到 PATH，再次移除 PATH 工具后返回
  `undefined`；grep/find 执行合同确认每次执行都会重新调用 Resolver，不依赖旧解析结果。
- 宿主下载计划合同覆盖 fd/rg 在 macOS、Linux、Windows 下的版本、架构、扩展名、归档
  路径和 GitHub 下载 URL；不触发网络或解压。
- `installToolArchive` 合同覆盖 tar.gz/zip 分支、嵌套二进制定位、Unix chmod、Windows
  不 chmod，以及成功和失败时的归档/临时目录清理。
- 网络边界合同覆盖 GitHub 版本响应解析、HTTP 503、瞬时 TypeError 重试、HTTP 404 不重试；
  本地真实 tar.gz 产物验证覆盖实际归档、安装二进制内容和 staging 清理。
- `cli-app` 已建立过渡 Composition Root，使用 coding-agent Adapter 创建 Runtime Resolver，
  注册 current_time/read/ls/glob/grep/find/tree/bash/shell，并通过 FeatureCompiler 生成新 Profile；旧
  CLI 入口仍未切换。
- Runtime 源码没有新增 `coding-agent` 或下载器导入。

### 2.6 `find`

旧 find 的重要行为不是“默认激活”，而是注册存在但 `scope_use: []`。Runtime 迁移保留这一
fail-closed 语义：

```text
Find Registration
  scopeUse = []
  -> 所有 scope 默认不暴露
  -> explicit activation 才进入 Model Call Frame
```

实现拆分为：

- `FindOperations.exists`：路径存在检查。
- `FindOperations.glob`：本地 glob、远程搜索或沙箱搜索的替换边界。
- `FindToolOptions.fdPath`：宿主管理的 fd 可执行文件路径。
- Runtime find：路径解析、相对化、结果限制、截断和标准结果。

已保留的可观察合同包括：

- 完整描述、TypeBox Schema、`scope_use: []` 和 `category: "core"`。
- glob pattern、默认路径和 limit。
- 绝对路径转换为搜索根下的相对路径。
- 隐藏文件和 `.gitignore` 过滤交由 fd/Operations 遵守。
- 空结果 `No files found matching pattern`。
- 结果上限提示、字节截断 details 和路径错误。
- explicit activation 后通过真实 Agent Core Tool Loop。

Runtime find 不导入 `coding-agent` 的 fd 下载器，也没有因为迁移方便而把空 scope 改成
全场景默认激活。当前实现已经完成 Tool 级差分和新 Kernel 链路验证，但生产宿主仍需要
单独完成 fd 的下载、版本、打包和定位测试。

### 2.7 `glob`

旧 glob 比 find 更依赖路径和输出细节。Runtime 迁移保留以下行为：

- 完整模型描述、TypeBox Schema、全 scope `scope_use` 和 `category: "core"`。
- 绝对 glob pattern 的静态前缀拆分，以及基于搜索根的相对 pattern 执行。
- 相对路径输出、目录结果尾部 `/`、重复结果去重和 limit 截断。
- 隐藏文件包含、`.git` 排除、层级 `.gitignore` 匹配和取消传递。
- 空结果、路径不存在、非目录路径、50KB 头部截断和 `GlobToolDetails`。

实现拆分为：

```text
GlobOperations.isDirectory / glob
  -> Runtime glob
  -> CodingToolRegistration
  -> Catalog / Model Call Frame
  -> AgentCoreTurnEngine Tool Loop
```

Runtime glob 直接声明 `glob` 和 `ignore`，不再通过 `coding-agent` 的传递依赖或下载器
取得实现。组合根仍可注入 `GlobOperations`，用于远程、沙箱或受限文件系统；默认实现只
负责本地 glob、`.gitignore` 过滤和结果格式化。

证据：

- 旧实现与 Runtime 实现定义、注册元数据和自定义 Operations 结果逐字段比较。
- 临时工作区验证绝对 pattern、目录标记、去重和 `.gitignore`。
- Runtime glob 已通过真实 Agent Core Tool Loop，并保持全 scope 暴露行为。
- 取消语义按旧实现保留：自定义 Operations 收到已取消 Signal；默认 glob 在执行层处理取消。

### 2.8 Tool Profile 差分门禁

过渡 Composition Root 不能只验证默认 CLI 场景，因为工具可见性由场景决定。现已把旧
`resolveActiveToolNames` 作为迁移 Oracle，对 `ALL_SCENARIOS` 中的 7 个场景逐一比较：

```text
旧 Tool Factory
  -> scope_use
  -> resolveActiveToolNames
  -> active names

新 Tool Registration
  -> scopeUse
  -> CodingToolsFeature
  -> Model Call Contribution
  -> active names
```

当前已迁移的 `current_time/read/ls/glob/grep/find/tree/write/edit` 在所有场景的最终激活集合完全一致。
`current_time/read/glob/grep/tree/write/edit` 保持全场景默认激活，`ls/find` 保持空 scope，且后两者仍可由
新 Composition Root 显式激活。比较发生在模型调用贡献层，而不是只比较 Registry 元数据，
因此能发现 Feature 编排、默认 scope 或 Provider 输出造成的可观察差异。

同时审计了 `@vetta/runtime-tools` 包根：仓库内源码和测试当前没有直接消费者，但包根仍是已
发布的公共入口，并继续转发旧工具 Factory 和单例。Coding 子路径已有独立 tree/write/edit，但
产品 Composition Root 尚未切换，直接删除或改写根导出仍会造成公开 API 和生产功能缺失。因此本阶段
保留兼容导出，不用“仓库内无人引用”替代公共兼容性判断。只有产品 Composition Root
能够提供等价 Profile，并形成明确迁移窗口后，才能拆除该入口。

### 2.9 `requires` 与会话能力激活

旧 Runtime Manager 在按场景解析工具后，还会根据会话能力过滤工具。例如后台任务关闭时，
`task_output` 和 `task_stop` 不应进入普通 scope 的 Model Call Frame。此前新
`CodingToolRegistration` 只有 `scopeUse`，无法表达这一层合同。

现已补充：

- Registration 的可选 `requires` 能力列表。
- scope 激活的 `capabilities` 集合。
- 每次 Model Call 重新读取 capabilities，因此不需要重编译 Runtime Snapshot。
- `additionallyEnabledToolNames` 和 explicit activation 继续绕过 requires，保持旧的显式
  工具选择语义。
- Catalog Snapshot 冻结 requires 数组，避免注册对象被外部修改。

除合成测试外，Runtime `task_output/task_stop` 现已使用 `requires: ["bg-tasks"]` 注册并进入
过渡 Composition Root。合同覆盖以下行为：

- 没有能力时，scope 激活不暴露工具。
- 增加能力后，下一次 Model Call 立即暴露工具。
- 移除能力后，下一次 Model Call 立即隐藏工具。
- explicit 和 additionally-enabled 仍可选中工具。
- `bg-tasks` 可用时，7 个场景的新旧 Tool Profile 都包含相同的 task 工具。
- 能力不可用或自定义 Command Executor 未提供后台 Service 时，不注册脱离命令执行器的孤立
  task 工具。

`task_output/task_stop` 的定义、Schema、增量读取和停止结果已迁到 Runtime。任务 ID、状态、
waiter、事件节流、读取游标和通知仲裁现在也由 Runtime 生命周期引擎负责；宿主只提供进程与
日志 I/O，不再把旧 `BackgroundTaskManager` 适配给新 Composition Root。

### 2.10 `bash/shell` 命令执行 Port、前台执行器与后台协调

旧 `bash` 不是单纯的 `spawn` 包装。它同时拥有命令前缀、环境覆盖、路径修正、输出更新、
尾部截断、完整输出文件、超时/取消、受保护目录检查、后台任务和自动转后台。直接在
Runtime Tools 重写其中一部分会形成新的功能实现，而不是架构迁移。

迁移先以 Anti-corruption Adapter 建立完整 Port，再由差分合同把前台行为移入 Runtime：

```text
Runtime bash/shell Definition + Registration
  -> CommandToolExecutor Port
  -> Runtime ForegroundCommandExecutor / BackgroundCommandExecutor
  -> Runtime BackgroundCommandService lifecycle
  -> ForegroundCommandOperations / BackgroundCommandHost Ports
  -> coding-agent Host Adapters
```

Runtime Tools 现在独立拥有：

- bash/shell 各自的工具目录、TypeBox Schema、TypeScript description 和 Registration。
- `CommandToolExecutor` Port，不导入 coding-agent。
- 命令前缀、spawn context、路径修正、流式 update、GB18030 fallback、尾部截断、完整输出临时
  文件、退出码与超时/取消错误文本。
- 受保护 skill/scene 目录的前后快照、变化检测和告警文本。
- 显式后台结果、软等待自动提升、后台完成内联结果、事件到流式 update 的映射。
- 后台通知 XML 的纯格式化合同。
- `task_output/task_stop` 的独立目录、TypeScript description、TypeBox Schema 和 Registration。
- Windows 默认 shell、其他平台默认 bash 的互斥 scope。
- Runtime 执行上下文到 Port 的转发。

coding-agent 的新宿主适配器只负责本地进程能力：选择 shell、补齐受管 bin 环境、加入
PowerShell UTF-8 前缀、spawn 子进程以及在超时/取消时终止进程树。CLI 过渡 Composition Root
默认组合该 Adapter 与 Runtime 前台执行器，不再调用旧 `createBashTool/createShellTool`。
`LegacyCommandToolExecutor` 仍作为迁移期兼容入口保留；旧产品 CLI 入口也仍未切换。

后台路径已经完成两层拆分：上层 Tool 只依赖 `BackgroundCommandService`；该 Service 的独立
Runtime 实现负责任务 ID、状态迁移、waiter、软等待提升、事件节流、读取游标、停止原因和通知
仲裁。coding-agent Adapter 只实现 shell 选择、命令前缀、spawn、进程树终止，以及日志文件的
create/append/read/close。新 Composition Root 不再实例化或依赖旧 `BackgroundTaskManager`。

旧 `BackgroundTaskManager` 仍保留在尚未切换的旧 `AgentSession`、旧 bash/shell 和 UI 任务
路径中，并继续作为差分测试 Oracle。这里删除的是新 Runtime 对旧 Manager 的过渡适配，不是
提前删除仍在生产路径使用的旧功能。

兼容性证据：

- bash/shell 的 name、label、完整 description、TypeBox Schema、category 和当前平台 scope
  与旧工具逐字段相等。
- 成功输出、details、流式 update、命令前缀、spawn hook 和环境覆盖逐项比较。
- 非零退出、显式超时、取消和无后台能力时的错误逐项比较。
- CJK 空格路径修正、2000 行尾部截断和受保护目录告警逐项比较。
- Windows/Unix scope 矩阵验证同一时刻只默认暴露一个命令工具。
- 真实本地前台命令通过 Runtime Definition、独立前台执行器和本地进程 Adapter 执行成功。
- 显式后台、短命令内联完成、软等待自动提升、失败退出和行数截断与旧实现逐项比较。
- 完成通知、内联完成时通知抑制、提升后通知和通知 XML 与旧实现相等。
- `task_output` 定义、Registration、完整读取、增量游标和无新增输出结果相等。
- `task_stop` 对运行中、已完成和不存在任务的结果、停止原因与旧实现相等。
- Runtime 生命周期单元合同覆盖输出游标、完成通知抑制/提升、失败映射、user/dispose 停止
  原因和重复停止。
- 7 个旧会话场景的 Composition Root Tool Profile 差分继续为零。

当前新 Runtime 已拥有前台行为、后台协调和后台任务生命周期；宿主只持有不可避免的本地
进程与文件系统能力。旧 `AgentSession` 尚未切换，因此旧 bash/shell 和
`BackgroundTaskManager` 仍不可删除，后续只能在完整生产 Profile 与会话事件适配完成后移除。

### 2.11 `dir_tree`

旧 `dir_tree` 不是文件系统递归包装。它分别执行 fd 目录扫描和文件扫描，再在内存中重建树，
因此其行为合同同时包含扫描参数与渲染算法：

- 完整 TypeScript description、TypeBox Schema、全场景 scope 和 `core` category。
- 路径模糊解析、存在性检查和目录类型检查。
- fd 的目录/文件双扫描、`.gitignore` 默认语义、hidden 开关和额外 exclude pattern。
- 目录优先、同类名称不区分大小写排序，以及 `[D]/[F]`、即时子目录/文件计数和 node type tag。
- `maxDepth`、node limit、scan limit 和 50KB output limit 的独立 details 与组合提示。
- directory-only 模式、fd 不可用、非零/null 退出和提前取消错误文本。

新实现拆分为：

```text
Tree Tool / TypeBox Schema / Registration
  -> TreeOperations.exists / stat / runFd
  -> CodingToolExecutableResolver.resolve("fd")
  -> tree model parse / rebuild / sort / render
  -> Runtime truncation and details
```

纯树模型与 Tool 编排分别位于独立模块。Runtime 不导入旧 `ensureTool`；Composition Root 注入
现有宿主 Resolver，并在每次执行重新解析 fd，所以运行时移除或恢复 fd 不要求重编译 Snapshot。
描述已由 `.txt` 迁为 TypeScript 常量，但内容、Schema 和模型可见工具名没有变化。

兼容性证据：

- 旧、新定义与 Registration 元数据逐字段比较。
- 同一 Operations fixture 比较完整结果和每次 fd 参数。
- 合同覆盖层级、排序、计数、node tag、directory-only、参数取整和四类限制。
- 路径不存在、非目录、fd 不可用、目录/文件扫描失败和提前取消错误相等。
- 7 个场景的 Composition Root Tool Profile 加入 tree 后差分继续为零。

### 2.12 `write`

旧 `write` 不只是一次 `writeFile`。它还负责路径归一化、模糊路径重定向、父目录创建、Skill/Scene
保护、知识库 Wiki 保护、取消传播和稳定结果文本。迁移必须完整保留这些可观察行为，但不能让独立
Runtime 反向依赖 Coding Agent 的业务策略。

本阶段将职责拆为三层：

```text
Runtime write
  -> resolveToCwd / resolveWritablePath
  -> required WritePathPolicy
  -> WriteOperations.mkdir / writeFile

Coding Agent host adapter
  -> legacy Skill/Scene protection
  -> legacy Knowledge Wiki protection
```

Runtime 保留 TypeBox schema、路径解析和模糊重定向、执行顺序、取消检查、错误传播以及通用结果封装；
宿主适配器注入原有路径保护规则及拒绝文本；`WriteOperations` 隔离真实文件系统副作用。`WritePathPolicy` 是
必需依赖，不提供静默放行的默认值，避免其他 Composition Root 直接创建工具时意外绕过宿主保护。
该 Port 只返回通用的拒绝原因，不向 Runtime 暴露 Skill、Scene 或 Knowledge Wiki 概念。

兼容性证据：

- 工具名、描述、参数 schema、scope 和 core 标记与旧实现一致。
- 相对路径、绝对路径、`~`、Unicode 内容、模糊目标重定向及重定向提示保持一致。
- 仍先递归创建父目录，再原样写入内容；成功文本继续使用 JavaScript `content.length`，没有借重构改变
  旧有的 UTF-16 code unit 计数语义。
- `.vetta/skills`、`.agents/skills`、Scene 和知识库 Wiki 保护继续返回原有工具结果，不改为抛错。
- 执行前、创建目录后和文件写入中的取消行为，以及 mkdir/write 错误传播均由合同测试覆盖。
- Runtime Tools 全量测试 166 项通过；CLI Composition Root 9 项通过；7 个场景的 Tool Profile 差分为零。

### 2.13 `edit`

旧 `edit` 同时承载锚点批量编辑和精确文本替换，不能简化为 `String.replace`。迁移识别出的完整合同
包括：

- 锚点解析、纯哈希降级、漂移找回、歧义与 stale 判定。
- 多编辑原子校验、范围重叠检查、行号增量补偿和新鲜锚点回执。
- 防止无意丢弃 `}`、`]`、JSX/Fragment 关闭行的结构闭合保护。
- 精确匹配优先，以及尾部空白、智能引号、Unicode 横线和特殊空格的模糊匹配。
- 文本唯一性、无变化检测、UTF-8 BOM、LF/CRLF 保持和既有 unified diff details。
- 现有路径模糊解析、Skill/Scene 与 Knowledge Wiki 保护、文件访问顺序和协作式取消。

实现拆分为：

```text
Edit Tool / TypeBox Schema / Registration
  -> anchor-edit pure engine
  -> exact-text transformation + diff
  -> EditOperations.access / readFile / writeFile
  -> required EditPathPolicy

Coding Agent host adapter
  -> legacy path protection + rejection messages
```

共享锚点模块在原有 read/grep 哈希与渲染能力上补齐 parse、validate、漂移恢复和区域回执；编辑算法不
依赖文件系统。Runtime 的 `EditPathPolicy` 只接收通用拒绝原因，不感知 Skill、Scene 或 Knowledge
Wiki；该 Port 与 write 一样是必需依赖，没有静默放行默认值。`diff` 作为 Runtime Tools 的直接依赖
声明，不再依赖旧 Coding Agent 的传递安装。

兼容性证据：

- 22 项旧/新差分合同逐字段比较定义、schema、scope、成功结果、错误文本、文件内容和 Operations。
- 29 项旧锚点测试继续通过；既有 tools 测试中的 edit、模糊匹配、BOM 和换行相关用例均通过。
- Runtime Tools 全量测试 17 个文件、188 项通过；CLI Composition Root 9 项通过。
- 7 个场景的 Tool Profile 加入 edit 后差分继续为零。

### 2.14 Session 观察事件与 Greenfield 宿主适配

旧 `RuntimeHost` 原先直接把 `AgentSessionEvent` 映射成宿主 `SessionEvent`，Greenfield Kernel
则只输出最终消息，导致 Desktop 所需的 text/thinking delta、工具生命周期和回合生命周期没有
稳定迁移边界。本阶段改为：

```text
旧 AgentSessionEvent ─┐
                      ├─> RuntimeSessionObservationEvent ─> SessionEvent
Greenfield TurnEngine ┘               │
                                      └─ transient EventSink envelope（不落盘）
Greenfield Stored KernelEvent ─────────────────────────────> SessionEvent
```

已固定和实现的合同：

- 旧事件特征测试覆盖生命周期与 timing 落盘、text/thinking/toolcall delta、assistant final、usage、
  provider error、abort、工具 start/update/phase/end、Todo、后台任务、子代理、compaction、MCP reload
  和 retry。
- `RuntimeSessionObservationEvent` 不依赖旧 `coding-agent.AgentSessionEvent`，也不包含宿主生成的
  `eventId/sessionId/schemaVersion`。
- `AgentCoreTurnEngine` 输出 agent/turn 生命周期、文本与思考增量、toolcall start 和工具执行
  生命周期；最终 assistant/toolResult 仍使用 `message` 事件交给 Pipeline 持久化。
- `TurnPipeline` 把 observation 包装为 `session.observation` 并只发布到 `EventSink`，不会写入
  `ConversationRepository` 或 Snapshot。
- Greenfield Adapter 将 observation、持久化 assistant message、cancel/failure 和 compaction
  结果统一转换为现有 `SessionEvent`，宿主消费者不需要直接理解 Kernel 内部事件。

后续阶段已经把 Greenfield 会话装配到真实 `RuntimeHost`，并补齐 Context、MCP、Todo、后台任务和
子代理观察来源。第 112 轮进一步以完整 Tool Loop 事件序列做旧新差分，确认
`message.delta/final`、`usage.update`、Tool 生命周期、Turn 生命周期和 MCP reload 的来源、顺序与
语义一致；usage 的 context 百分比继续按既有“本次模型 usage / context window”口径计算，不使用
压缩策略的阶段性估算值替代宿主事件合同。

### 2.15 活动 Turn 输入并发

旧实现将活动 Turn 的输入分为 steering 与 follow-up 两类。前者在模型/工具循环检查点进入上下文，
后者只在自然响应结束后触发后续调用；assistant 以 aborted/error 结束时不会继续消费 follow-up。
两类队列默认逐条 FIFO，也都支持一次消费全部。

Greenfield 实现没有把队列塞入 Turn Pipeline 或具体 Provider，而是拆为：

```text
AgentSession -> SessionInputQueue -> TurnInputQueue Port -> AgentCoreTurnEngine
```

Session 拥有 enqueue、clear、模式和生命周期；Engine 只能在 Agent Core 已有检查点消费。排队回执不是
持久事件，只有实际消费的 user message 才由 Engine 输出并经 Pipeline 写入 Repository。cancel/error
保留未消费队列，close 清空队列。空闲状态携带 `streamingBehavior` 仍正常启动 Turn，活动状态未携带
该字段仍返回 `SESSION_BUSY`。

合同覆盖两类队列隔离、FIFO、one-at-a-time/all、运行时模式切换、活动 Turn 回执、取消保留、关闭清理、
真实 Agent Core 的 steer 优先和自然结束 follow-up，以及 error 终态不消费 follow-up。本阶段没有引入
TypeBox/Zod，因为输入已经越过外部协议边界并成为受信任的 Kernel 类型；运行时校验应放在后续 Backend
Adapter 的外部 payload 边界。

### 2.16 Greenfield Session Backend 与 Continue Turn

审计确认阶段 33 的 `RuntimeSessionBackend` 只是返回旧 AgentSession 的创建工厂，并不是 prompt、事件、
状态和外围能力的完整后端。RuntimeHost 仍直接依赖旧会话的模型、历史、Todo、后台任务、子代理、插件和
分支接口。让 Greenfield 用类型断言或空实现满足该别名会隐藏功能缺失，因此没有这样接线。

本阶段将创建工厂泛型化，并新增独立 `GreenfieldRuntimeSessionBackend`：

```text
PromptRequest -> required PromptAdapter -> Kernel Session
KernelEvent -> per-session EventSink -> existing SessionEvent
RuntimeFactory -> AgentSession + Repository + disposer
```

Greenfield 门面已经覆盖 prompt、continue、abort、事件订阅、状态/消息读取和释放。Prompt Adapter 与
Runtime Factory 都是必需依赖，因此 Backend 不会自行猜测或忽略 PromptRef、附件、Skill、metadata、
模型或 Profile。监听器失败被隔离，状态和消息来自 Repository；活动 Turn 的排队和 abort 保留沿用阶段
35 合同。

阶段 50 进一步增加同步 Greenfield Session Projection：create/resume 完成后先从 Repository 初始化，
后续只在 `message.appended` 已持久化并发布时更新。阶段 51/52 补齐 Conversation Document 的树形读取、
写命令和真实 History Reader/Controller。阶段 53 新增独立 Model Runtime：Model Controller、Model View、
State Reader 与 Turn Pipeline 共享同一事实源，切模通过轻量冻结 binding 只影响后续 Turn，不重建
Capability Snapshot。能力矩阵目前仍把 Host Interaction、Execution、Configuration、Todo 和 Background
Work 标记为未实现，所以 Greenfield Backend 仍不能直接注入完整 RuntimeHost。

Kernel 新增真正的 continue Turn：它从已存上下文继续运行，只写 `turn.started`，不追加伪 user message；
Context Provider 通过可选 input 区分 prompt 和 continue。测试确认一次 prompt 加一次 continue 的消息角色
为 user/assistant/assistant。

未完成 Turn 的恢复边界也已固定：create/resume 必须显式分离；resume 识别无终态的 started Turn 后以乐观
版本追加 interrupted 终态；禁止自动重放模型或工具、禁止恢复进程内队列、禁止合成 user message；多个
未闭合 Turn、顺序错误或版本冲突 fail closed。恢复执行器和真实文件 Repository 集成已经实现并验证；
当前切换阻断来自完整历史图、旧 JSONL 兼容和外围 Assembly 能力，而不是 resume 本身。

### 2.17 Session-local Ecosystem Hook Runtime

旧 Greenfield 组合只有 Stop Hook 局部 invoker，没有保证 Prompt、Tool、Stop 与 Session lifecycle 共享
同一 Runtime。该结构会割裂 SessionStart pending 状态、Stop continuation 计数和 Hook 配置。本阶段改为：

```text
one EcosystemHookRuntime per Session
  -> Prompt SessionStart / UserPromptSubmit
  -> final Model Call Tool surface
  -> Stop continuation
  -> SessionEnd dispose
```

Tool Hook 包装发生在动态插件、MCP、Todo 等能力完成调用级组合之后，因此运行时新增或撤销工具会在下一次
Model Call 自然生效。Greenfield wrapper 复用旧 `wrapToolsWithEcosystemHooks()`，并用差分合同验证输入改写、
MCP descriptor、Post feedback、additional context、真实执行失败和 Pre 阻断，没有复制第二套 Hook 语义。

Tool Hook additional context 不直接写 Repository。Runtime Core 新增 Session-local append-only context
边界，Turn Pipeline 在 toolResult 等持久消息之后、Turn 终态之前，以同一 revision 序列追加
`context.appended`。记录只有在持久化成功后才从 Buffer 移除，Turn 结束清理残留，避免跨 Turn 泄漏。与旧
运行语义一致，这些内容不会倒灌到已执行中的 Tool Loop，而会对下一个外部 Turn 可见。

Prompt 合同覆盖 SessionStart/UserPromptSubmit 顺序、阻断与空闲/排队注入顺序；CLI 真实组合覆盖
create/resume source、静态及动态工具、Stop continuation、context 持久化和幂等 SessionEnd。尚未接入
Pre/PostCompact、PermissionRequest、SubagentStart/SubagentStop，以及只有真实宿主切换操作才能表达的
`new_session`/`switch_session`/`fork_session` SessionEnd 原因。

### 2.18 Session-local Context Runtime 与原生压缩

早期 Greenfield `ContextStrategy` 只是 passthrough，`context.compacted` 也只保存消息计数，无法确定
活动分支切点或在重开后重建模型上下文。本阶段把持久压缩事实改为：

```text
exact summary message
  + firstKeptEntryId
  + tokensBefore / details / reason
  -> Conversation Document compaction node
  -> summary + kept tail model projection
```

完整聊天投影继续保留所有 user/assistant 消息。旧计数记录仍通过 TypeBox 联合 Schema 读取，但只推进
journal，不改变分支。原生记录关闭并重开后恢复相同模型输入，摘要消息保存实际内容而不是按当前代码重新
生成。

Kernel 将可持久化的 Turn Context Strategy 与逐模型调用 transient Transformer 分开。Coding Agent 的
Session-local Context Runtime 复用旧 threshold、prefire、摘要、microcompact 和 circuit breaker 算法；
Pre/PostCompact 使用第 68 轮的同一 Hook Runtime。microcompact 每次模型调用执行且不改写 Repository，
阈值摘要经 Pipeline 提交后才执行 Post Hook。成功 end 由持久 `context.compacted` 统一映射，避免重复事件。

当前输入仍与 `turn.started` 原子写入；压缩决策使用写入前的 Document/历史，因此不把新 Prompt 摘入旧
上下文。即时模型视图再补回 Provider 与当前输入 tail。Context Runtime 同时作为 Document Participant 与
Observer，在 create/resume 时从投影恢复用量，运行中采用有效 assistant usage，CLI 状态不再返回未知比例。

第 70 轮已把 Layer 2 threshold/prefire 与 provider overflow 自动恢复接入模型调用检查点，详见下一节。
第 71 轮已补齐手动压缩和 Extension 自定义压缩，详见 `2.20`。第 72 轮建立通用的跨
Conversation Turn 续接事务，详见 `2.21`；memory-mode 的 flush、触发策略和 JOURNAL 仍未
迁移，因此完整长会话生产路径仍不可切换。

### 2.19 模型调用级 Compaction Orchestrator

审计确认 Agent Core 的 EventStream 是非背压队列。Tool Result 事件先 `push` 不等于 Repository 已完成
append；如果直接在下一次 `transformContext` 中持久压缩，会产生“模型已使用新摘要、日志尚未提交摘要”
的崩溃窗口。

本阶段增加默认关闭的请求—应答检查点：

```text
Agent Loop pause
  -> AgentCoreTurnEngine bridge
  -> Turn Pipeline persist prior messages
  -> ContextStrategy.prepare
  -> context.compacted commit
  -> PostCompact
  -> Agent Loop resume
```

Kernel 只定义暂停/应答、消息视图和恢复次数，不解释 Coding Agent 压缩算法。Coding Agent
Session-local Context Runtime 继续拥有 threshold、prefire、summary、circuit breaker、同模型 overflow
识别和 Pre/PostCompact。普通 Agent Loop 默认不启用检查点，旧生产 `AgentSession` 行为不变。

已恢复的旧行为包括：

- 同一 Tool Loop 的 assistant/toolResult 先持久化，再判断下一次模型调用是否跨阈值。
- 自然结束 assistant 根据最终 usage 执行 threshold 压缩，但不自动重放成功响应。
- 同模型 error pattern overflow 先保存错误，再压缩并从重试上下文移除错误。
- input usage 超过 context window 的 silent overflow 走相同恢复路径。
- 同一外部 Agent Loop 最多恢复一次，防止持续 overflow 无限重试。
- PostCompact 请求停止时保留已提交摘要但不重试。
- 压缩期间到达的 steering 在重试模型调用前注入；follow-up 继续在自然停止后消费。
- Provider transient context 在 Document 重投影后重新插入，不因摘要提交丢失。
- 取消/检查点失败不会放行额外模型调用。

检查点和 Strategy 输入都是进程内已类型化对象，不新增 TypeBox/Zod；持久 compaction record 继续使用
既有 TypeBox Schema。

### 2.20 Session 手动压缩与 Extension 兼容

旧手动压缩在开始前中止活动 Agent 操作，并在两个 Turn 之间直接追加 compaction entry。它不会发送
`auto_compaction_start/end`，但必须保留自定义摘要指令、Pre/PostCompact、Extension 覆盖/取消、
`session_compact` 回调、自动压缩开关和既有错误文本。

Greenfield 没有把该操作塞进 Turn Pipeline，也没有暴露 Repository 给宿主，而是新增：

```text
RuntimeSessionContextController
  -> ManualContextCompactionRuntime
  -> ContextCompactionCommitter
```

Controller 负责取消活动 Turn、压缩忙碌态、Snapshot lease、乐观版本和显式取消；Coding Agent Context
Runtime 负责压缩算法、Hook 与 Extension；Committer 被 Turn-start、model checkpoint 和 manual 三条路径
共用。手动 `context.compacted` 不携带伪 `turnId`，恢复策略只允许它出现在 Turn 外；threshold/overflow
记录仍必须处于活动 Turn。

Extension Runner 通过窄 Adapter 留在 Coding Agent：`session_before_compact` 可以取消或提供摘要，成功
提交后才发送 `session_compact`。TypeBox 只在持久事件 Schema 边界放宽可选 `turnId`，进程内 Controller
输入继续使用 TypeScript 合同。

合同覆盖持久化重开、恢复协议、并发拒绝、显式取消、Extension 覆盖/取消、自定义指令、提交后回调、
自动压缩开关、无额外手动 SessionEvent，以及 CLI 真实 Composition Root。旧 `AgentSession.compact()`
生产路径保持不变。

### 2.21 跨 Conversation Turn 续接

旧 memory-mode 会在自动压缩完成后立刻创建新会话文件，并让当前 Tool Loop 继续写入新文件。
该行为不能实现为第二个 `turn.started`，也不能只替换路径。第 72 轮建立以下通用协议：

```text
source: context.compacted -> turn.transferred
target: continuation seed -> turn.continued -> same Turn terminal
```

源 transfer 是终态，目标 continued 是同一 `turnId/snapshotId` 的活动起点。Storage 在源
version 与文件锁下提取最近 compaction 和 kept tail，使用 TypeBox 校验 seed，并保存
`parentSessionPath/parentEntryId`。Pipeline 在事务成功后更新共享 Session Identity，后续模型调用、
工具、Policy、Prompt Provider、Observer 和终态都读取目标 ID。

Greenfield 投影先用 target seed 替换事实源，再应用已落盘的 `turn.continued`；宿主收到
`session.path_changed`，Lifecycle path、History 命令和 Document Participant 同步切换。恢复策略
不会自动重放任何一侧的模型或工具：source transfer 已闭合，未闭合 target 只会被标记为
interrupted。

本轮只迁移通用事务边界，没有启用 memory-mode，没有改变压缩阈值，也没有迁移 MEMORY flush、
memory tool、JOURNAL 或日期 cwd。旧生产 `SessionManager.rolloverToNewFile()` 保持不变。

### 2.22 Memory Rollover 产品 Orchestrator

第 73 轮在 Coding Agent Adapter 层新增 Session-local Memory Rollover Orchestrator，复用旧 memory
store、flush、journal 和 Tool，并只向 Runtime Core 提供压缩设置调整与通用 continuation directive：

```text
memory-mode Session
  -> frozen MEMORY prompt snapshot
  -> existing memory Tool
  -> 70% auto-compaction policy
  -> best-effort MEMORY flush
  -> generic cross-Conversation continuation
  -> completed-turn / rollover JOURNAL
```

已恢复的旧行为：

- Session 启动时冻结 MEMORY 内容，运行期 Tool 修改只影响后续 Session。
- memory Tool 的描述、TypeBox Schema、文件操作与字符限制继续使用既有实现。
- 自动压缩使用 `minFreePercent >= 30` 和 `reserveTokens >= ceil(contextWindow * 0.3)`；手动压缩不应用
  memory 阈值、flush 或 rollover。
- flush 输入是即将被摘要丢弃的消息前缀，失败不阻止压缩。
- rollover 通过第 72 轮事务保持同一 Turn；源文件以 `turn.transferred` 结束，目标文件从
  `turn.continued` 继续。
- 每个成功 Turn 写一条 JOURNAL，成功 rollover 写摘要段落；文件副作用失败不改变 Turn 结果。
- `memoryMode` 默认关闭，未启用 Session 不增加工具、提示词或 JOURNAL。

Kernel 和 Storage 没有新增 MEMORY/JOURNAL 概念。内部编排继续使用 TypeScript 合同；memory Tool
参数和 continuation 持久数据沿用既有 TypeBox 校验，没有在受信任内部对象上重复引入 Zod。

仍有三个切换阻断项：

1. 旧 RPC/IM 的主动 `flush_memory` 能力尚未形成 Greenfield 宿主 Port。
2. 旧实现会先完成 rollover，再运行 Extension committed 回调和 PostCompact Hook；当前 Greenfield
   continuation 在 `onCompactionCommitted()` 返回后才执行，因此回调相对 Conversation 切换的顺序仍有
   差异。
3. 默认生产 Desktop/RPC/IM/CLI 入口仍使用旧 `AgentSession`，本轮只为并行 Greenfield 组合增加显式
   memory-mode 配置。

### 2.23 Rollover 后置时序与主动 Memory Flush

第 74 轮先从旧 `CompactionController` 固定真实顺序：

```text
context.compacted
  -> rollover JOURNAL
  -> Conversation rollover / path changed
  -> Extension session_compact
  -> PostCompact
  -> retry decision
```

Runtime Core 的 `ContextStrategy` 现在可以分别观察通用 continuation 事务成功和失败。成功回调只在
Storage 事务、Session identity、投影和宿主路径完成重绑定后执行；它返回的 `continueExecution` 会成为
overflow retry 的最终依据。失败通知是 best-effort，不能替换 Store 的原始错误。该合同没有 Memory、
JOURNAL、Extension 或 Hook 字段。

Coding Agent Memory Orchestrator 在 continuation 前写 JOURNAL；Context Runtime 在 continuation 成功后
从目标 seed document 解析重写后的 compaction entry，再执行 Extension committed、PostCompact 和熔断
成功记录。Store 失败时不执行成功回调并记录熔断失败。合同覆盖成功顺序、Store 失败和 PostCompact stop。

主动 flush 新增独立 `CodingAgentGreenfieldMemoryController`。它读取当前活动 Conversation 的模型投影、
当前模型和对应凭据，并复用 Orchestrator 的 `flushMessages()`；CLI Greenfield Composition Root 以
`flushMemory(sessionId)` 暴露给宿主。非 memory-mode 和 rollover 后失效的旧 id 返回 `0`，新 id 继续
可用。该 Controller 没有加入 Runtime Core Assembly。

本轮没有新增 TypeBox/Zod：新增合同均为进程内 TypeScript 对象；外部 RPC 命令仍需在后续真实宿主
Adapter 接入时使用现有协议校验边界。

仍未完成的是默认生产 RPC/IM/CLI 接线和旧新宿主差分，而不是 Memory Orchestrator 内部时序。

### 2.24 RPC 宿主反腐层与 Legacy 协议基线

生产 RPC 原先在单个 `runRpcMode()` 内同时处理 JSONL、命令、Extension UI、Host Bridge、Tool 注册、
进程生命周期和旧 `AgentSession` 字段。该入口无法直接接受 Greenfield Session；仅把
`flushMemory(sessionId)` 塞进 switch 分支会重新形成具体实现耦合。

第 75 轮将协议路径改为：

```text
JSONL Transport
  -> TypeBox inbound frame validation
  -> command dispatcher
  -> grouped RpcSessionCapabilities
  -> LegacyRpcSessionAdapter
```

Extension UI 与 Host Bridge 各自持有 request correlation 和关闭清理。全部命令 Schema 由受
`RpcCommand["type"]` 约束的单一 Map 提供，TypeBox 只校验外部 JSONL；内部仍为 TypeScript 合同。
`runRpcMode(session)` 和生产 `main()` 保持原签名与 Legacy 默认路径。

无模型合同覆盖完整命令面、prompt 延迟失败、Memory、非法/未知 Frame、UI/Host timeout/dispose、
JSONL 边界、事件透传、关闭清理和 Legacy 委托。现有真实 provider RPC 测试继续保留，但不再是重构的
唯一验证手段。

本轮只建立宿主接入缝，没有实现 Greenfield RPC Adapter。稳定 `SessionEvent` 到旧 wire event 的映射、
IM Host Bridge Tool、恢复/rollover identity 和外围 Capability 仍是显式 opt-in 的阻断项。

### 2.25 MCP Runtime-native 迁移与切换差分门禁

第 98～106 轮已把 MCP 从旧 `McpManager` 单体职责中拆出，并形成以下边界：

```text
模型数据面
  -> McpRuntimeToolSource / Synchronizer / Deferred Controller

宿主控制面
  -> 文件配置、OAuth 交互、Server Supervisor、Client/Transport

Legacy 兼容面
  -> McpManager / LegacyMcpManagerRuntimeToolSource
```

Greenfield CLI、Desktop 和 IM 的生产候选组合已经使用 Runtime-native 文件 MCP Source；插件 MCP 使用
Session-local Runtime；子代理只在创建或重开时捕获父 Session 的只读 Tool Binding，不创建第二套 Source、
Supervisor 或 Client。Legacy Adapter 目前只被兼容测试使用，但仍是已发布入口的一部分，因此不能根据仓库内
生产消费者数量直接删除。

第 107 轮新增同输入、同变更序列的切换差分门禁，直接运行旧 `McpManager + AgentTool Adapter` 与新
`McpServerSupervisor + Runtime Tool Source` 两条完整路径，比较：

- Ready、Error、Needs Auth、Disabled 和工具发现失败状态；
- Tool 名称、label、描述、TypeBox Schema 与 Ecosystem Hook 来源元数据；
- 文本、图片、Resource 成功结果和调用失败结果；
- 文件 Server 的稳定复用、新增、替换、删除和 Client close；
- 配置加载失败时保留当前 Tool Surface 与现有连接；
- Shutdown 后的 Client 关闭集合。

核心差分没有发现需要修改生产实现的行为偏差。插件动态替换、`agent_mode`、渐进披露、提示词工具索引、
子代理投影和父 Session 生命周期所有权继续由第 105、106 轮的 Composition 集成测试覆盖，不在同一个测试中
复制第二套产品组合。

本轮没有新增外部配置或协议边界，因此没有引入新的 TypeBox/Zod Schema。MCP 配置、持久 OAuth 状态和 Tool
输入继续使用既有校验边界。

### 2.26 生产 Model Call Frame 与 Profile 切换准备度

第 108 轮不再从低层 Registration 推断生产兼容性，而是让相同 Desktop `RuntimeHost` 请求分别进入 Legacy 与
Greenfield Backend，并从真实 OpenAI Responses HTTP 边界捕获最终模型请求。矩阵覆盖全部 7 个会话场景；另一个
同 Session 双 turn 合同覆盖插件重配、Agent Mode 切换、用户提问处理器移除和 `knowledgeMode`。

共同能力已经满足以下合同：Provider model/reasoning/token/store/stream 参数一致；去除能力清单与 turn 时间后的
消息和系统指令一致；共同 Tool 的名称、描述和完整 JSON Schema 一致；插件 Prompt/Tool 与
`ask_user_question` 均在相同 turn 边界增删。

门禁同时发现真实生产差距。Greenfield 全场景缺少 `doc_to_pdf`、`html_to_pdf`、
`extract_text_from_pdf`、`extract_text_from_img`、`render_pdf_page`、`progress` 和 `invoke_skill`；
`kb-processing` 另缺 `kb_write_page`。共同 Tool 的最终 Provider 数组顺序也尚未与 Legacy 对齐。以上差异不会
通过旧 Tool Factory 整体注入、Golden Snapshot 或扩大归一化规则隐藏，而是作为默认 selector 切换阻断项。

差分以 Provider 请求体为模型可观察事实源。`RuntimeHost.getState().activeToolNames` 是会话能力视图，未必包含
`knowledgeMode` 等调用级过滤，因此不能替代最终 Frame。机器本地 `mcp_*` Tool 属于外部动态输入，继续由第
107 轮 MCP 差分和产品组合测试验证，不进入固定缺失清单。

解决顺序固定为：先迁移文档/OCR Tool，再迁移 `progress`、Session-local `invoke_skill` 和 Knowledge 写能力，
最后在 Profile Compiler 对齐确定性 Tool 顺序。只有缺失清单和顺序差异都清零，才能把同一门禁扩展到
CLI/RPC/IM 并讨论默认 Runtime 切换。本轮没有改变任何 selector 默认值。

### 2.27 生产 Tool Surface 缺口闭合与动态能力激活

第 109 轮闭合第 108 轮发现的 8 项模型可观察能力缺口。Greenfield 生产候选组合现在显式注册 5 个文档/OCR
Tool、`progress` 和 `kb_write_page`；`invoke_skill` 则由独立 Session-local Feature 在每次模型调用前刷新
Skill/Scene，并在执行时再次解析当前资源。它不会把删除的本地 Skill 永久冻结在 Session 或全局 Snapshot 中。

为保持既有 Agent Mode 语义，`agentModes` 已成为通用 `CodingToolRegistration` 激活轴，并与 scope、requires
一样在模型调用边界读取当前 Session 配置。Catalog Snapshot 只冻结 Registration 值，不冻结运行期是否激活；
因此 mode、能力和资源的小范围变化不要求重建整个 Snapshot。显式激活继续保留绕过过滤的旧语义。

5 个文档/OCR Tool、`progress` 和 `kb_write_page` 当前通过一个逐项声明的产品反腐适配器复用既有实现。该适配器
不注入 `createAllTools()`、旧 Registry 或 Runtime Manager，也不复制简化逻辑，但仍属于迁移债务：这些工具的
定义、TypeScript 描述和执行 Port 尚未归入 Runtime Tools，后续必须逐项原生迁移并删除适配项。

最终 Tool 顺序在 `CodingAgentModelCallFrameComposer` 产品边界按 Legacy 顺序确定；通用 Runtime Core、Feature
Compiler 和 Provider Adapter 均不认识产品 Tool 名称。未知 Plugin/MCP Tool 保持来源相对顺序。Desktop 差分
测试已删除允许缺失清单，改为比较最终 Provider Tool 数组的顺序、名称、描述和完整 Schema。

本轮针对性动态激活、Tool Adapter、产品工具和排序合同共 29 项通过，`bun run check:quick` 与完整
`bun run check` 通过。Desktop 精确差分源码已升级；由于仓库任务规则禁止运行 build，而测试运行器会解析旧
workspace `dist`，本轮未宣称产物级差分已执行。默认 selector 继续保持 Legacy。

### 2.28 Runtime-native 产品工具与通用模型顺序合同

第 110 轮消除了第 109 轮的产品工具迁移债务。`doc_to_pdf`、`html_to_pdf`、
`extract_text_from_pdf`、`extract_text_from_img`、`render_pdf_page` 和 `progress` 的定义、TypeBox
Schema、TypeScript 描述、执行编排与 Registration 现由 Runtime Tools 独立拥有；`kb_write_page` 在 Coding
Agent 产品域内通过 `KnowledgePageWriterPort` 成为原生 Runtime Tool。Greenfield 不再把这些旧 AgentTool
Factory 转换成 Runtime Tool，迁移期 `greenfield-product-tool-adapter.ts` 已删除。

Desktop 定位/执行、`pdfinfo`、`pdftoppm`、Office/WPS 和 OCR 并发限制分别通过窄 Host Port 注入。外部
`desktop-config.json`、Desktop CLI JSON 和 OCR 结构化结果使用 TypeBox 校验；进程内 Port、activation 和顺序
合同不重复引入 Zod。Legacy 默认路径仍保留旧 Factory，本轮没有提前删除生产功能。

产品 Registration 改为按 Session cwd 创建，并在每次 Model Call 读取当前 activation。不同会话不再共享
Composition Root cwd；agent mode、capability 和显式选择变化仍在下一调用生效。

工具顺序不再由 Composer 按具体名称识别。`RuntimeToolDefinition.modelOrder` 是通用可选元数据，Runtime Core
稳定排序已声明值，并保持未声明 MCP/外部 Tool 的来源相对顺序。Session-local Plugin Tool 由 Coding Agent
产品策略写入位于 `ask_user_question` 之后、MCP 之前的统一顺序值；产品名称与 Legacy 数值映射只存在于
Coding Agent 组合策略中。

110 阶段重新验收时修复了 Desktop Vitest 未将 `@vetta/runtime-composition` 指向源码的问题，并将全局 Agent
配置隔离到临时目录，避免个人 MCP 配置污染差异门禁。修正后，Desktop 全部场景及动态重配置的最终 Provider
Tool 数组逐项相等；CLI/RPC/IM 的真实 Agent RPC Provider 差分也通过。

Runtime Core、Runtime 产品工具及 Coding Agent 定向合同共 23 项、Desktop 源码组合合同 14 项、CLI/RPC/IM
真实进程合同 5 项通过。`bun run check:quick` 与完整 `bun run check` 均通过，后者包含 Biome、root tsgo、
CLI、Desktop、Admin 和质量守卫。默认 selector 保持 Legacy；标准安装产物和剩余多宿主完整 Tool 数组仍是
切换阻断项。

### 2.29 真实宿主 Provider Frame 与多会话 cwd 隔离

第 111 轮把 CLI/RPC/IM 差分提升为完整 Provider 请求合同。测试从真实 `agent-rpc-cli.ts` 构建临时可执行
文件，分别启动 Legacy 和 `greenfield-im` 子进程，并逐项比较 input、系统提示词和最终 Tool 数组。只归一化
缓存键、临时根路径和回合时间，不再只用事件结果推断模型实际看到的能力。

完整差分暴露并修复了两项漂移。Greenfield IM 过去按 Composition 默认值启用了 Subagent，额外暴露 7 个
控制工具；现在由 IM Composition Root 显式关闭。Legacy IM 还保留“系统提示词公布知识库检索工具、实际
Tool Frame 按本轮能力过滤”的既有合同；Greenfield 通过 `systemPromptAdvertisedToolNames` 在 Composer
边界显式保留提示词合同，但没有重新开放 Tool 执行能力。`--no-tools` 和显式 `--tools` 不受影响。

多会话隔离在真正能够由一个宿主持有多个 Session 的 Desktop RuntimeHost 中验证。两个不同 cwd 的 Greenfield
Session 通过真实 Provider Tool Loop 调用相对路径 `render_pdf_page`，第二次 Provider 请求的 Tool Result
分别只包含各自 cwd 的绝对路径。该合同覆盖 RuntimeHost、Backend Pool、Session-local Product Feature 和
Runtime Tool 完整链路，证明产品工具没有回退到 Composition Root 的共享 cwd。

Coding Agent Composer 8 项、Greenfield Composition 14 项、CLI/RPC/IM 真实进程 6 项、Desktop Provider
Frame 与多会话合同 9 项通过；`bun run check:quick` 与完整 `bun run check` 均通过。没有新增外部反序列化
边界，因此没有新增 TypeBox/Zod；默认 Runtime selector 继续保持 Legacy。

### 2.30 真实宿主生命周期与动态能力边界

第 112 轮把源码门禁从最终 Provider Frame 扩展到完整 RuntimeHost 生命周期。相同的真实 OpenAI Responses
fixture 分别运行 Legacy 与 Greenfield：首轮执行真实 `read` Tool Loop，随后释放整个 RuntimeHost 和
Greenfield Backend Pool，再仅凭已持久化的 session path 在新宿主实例恢复并继续会话。差分逐项比较
SessionEvent 类型、source、稳定语义字段、消息角色、Tool 结果、会话身份和 Provider 恢复输入。

门禁暴露并修复了三个架构边界问题：

- Greenfield EventSink 的映射循环变量遮蔽 Kernel Event 参数，异常被安全发布边界隔离后造成“状态已落盘、
  观察事件缺失”；现已恢复完整事件投递，且保留监听器故障隔离。
- Greenfield usage 事件曾读取 Context Runtime 的阶段性估算值；现在只从实时状态取得 context window，
  百分比按当前 assistant usage 计算，与 Legacy 事件合同一致。
- Prompt 边界现在产生既有 `mcp.reload.start/end` 观察事件；Prompt 已完成的刷新由首个 Model Call 一次性
  复用，避免重复访问 MCP Source，Tool Loop 后续 Model Call 仍重新读取运行时能力。

动态 Skill 门禁在同一 Session 内依次验证“不存在、新增、内容修改、删除”，每次都从下一 Model Call 的
真实系统提示词观察结果。审计发现原 ResourceLoader 只指纹化启动时已存在的 Skill 路径，因此 Session
启动后首次创建 `.vetta/skills` 根目录不会触发刷新。现在默认用户/项目 Skill 根即使尚不存在也参与拓扑
指纹；变化时只重载 Skill 资源，不重建 Session、Runtime Snapshot 或其他 Feature。

本轮没有改变 Tool 名称、描述、Schema、执行语义、selector 默认值或持久化格式。新增数据均为进程内
TypeScript 合同，Skill Markdown 继续使用既有 frontmatter 解析，MCP/持久化边界继续使用原有 TypeBox
校验，因此没有引入 Zod 或重复 Schema。

### 2.31 标准安装产物与运行时动态能力收口

第 113 轮复用仓库唯一的 `compile-standalone.mjs` 和 `verify:artifact:installed` 标准流程，将生成的单文件
CLI 复制到与源码树隔离的安装目录，并删除编译期仓库路径后再启动真实 OS 进程。门禁不依赖 workspace
源码 alias 或预先存在的 `dist`，因此验证的是用户实际安装后能够运行的边界。

同一份安装产物分别以 Legacy 和 `greenfield-im` 启动 `im-claw` RPC 会话。测试从真实 OpenAI Responses
HTTP 边界捕获完整 Provider 请求，只归一化安装 fixture 路径、回合时间和非稳定缓存键；消息、系统提示词、
Tool 名称、顺序、描述及 Schema 必须逐项相等。RPC 侧继续使用既有宿主消费合同比较 agent/turn 生命周期、
累计 text delta、final message、Tool 结果和 session path change；不把 Legacy 为兼容旧 wire consumer
额外发出的 progress 噪声误升格为新的原始 Frame 等价合同。

标准产物还完成两组生命周期验证：

- 第一个 OS 进程执行真实 read Tool Loop 后退出并释放 owner lock；第二个独立进程仅凭 session path 恢复
  同一 session identity，继续执行 MCP Tool Loop，并保留完整历史。
- 同一 Greenfield Session 在不重建进程、Session 或 Runtime Snapshot 的情况下，依次观察默认项目 Skill
  的新增、内容修改和删除，以及 MCP Server 的新增和移除；变化均从下一 Model Call 生效。

门禁暴露了一个安装产物真实缺陷：顶层 CLI 只为 Greenfield 安装 RPC stdout guard，Legacy RPC 加载 Skill
时会把日志写入 stdout，破坏 JSONL wire。现在顶层入口在任何 `--mode rpc` 路径安装同一 guard；Legacy
非 RPC 路径不受影响。

本轮明确没有把 Desktop 源码的 7 场景矩阵搬到安装产物 Greenfield CLI。`greenfield-im` 的公开合同目前只
接受 `im-claw`，扩大其场景范围属于功能变更；7 场景 Provider 差分继续由 Desktop RuntimeHost 源码门禁
负责。默认 selector、工具功能、持久化格式和公开能力范围均未改变。

没有新增 TypeBox/Zod。安装 metafile 等外部 JSON 边界继续使用既有 Zod 校验；Provider 请求和 RPC Frame
在测试进程内已经由现有协议类型约束，不重复增加 Schema。

### 2.32 生产切换控制面与 Legacy 会话迁移边界

第 114 轮没有切换默认 Runtime，而是先把“选择了什么”和“会话如何迁移”变成显式、可验证的控制面。

启动边界完成以下收口：

- `createAgentCliBootstrap()` 成为中性宿主准备入口；既有 `createLegacyAgentBootstrap()` 保留为弃用兼容
  转发，不删除外部功能。
- Runtime selector 在每次选择时产生 `requestedBackend/effectiveBackend/fallbackReason` 决策；CLI、独立 RPC
  和 Desktop RPC 子进程统一把稳定诊断写入 stderr，stdout JSONL wire 不变。
- 新建 Greenfield 会话时 effective Runtime 明确为 `greenfield-im`；已有 Legacy 会话仍按既有策略回退，
  并给出稳定 `legacy-session` 原因。
- Greenfield CLI/RPC 产品模块及 Runtime Composition 被结构守卫禁止重新引用
  `createLegacyAgentBootstrap` 或 `runLegacyAgentWithBootstrap`；显式回退只留在 selector 边界。

Legacy 会话没有被启动路径自动改写。`runtime-storage` 新增显式 `migrateLegacySessionToV2()`：

```text
Legacy source（只读）
  -> V1/V2/V3 reader + format provenance
  -> TypeBox conversation.import.seed
  -> 完整 V2 codec/document 校验
  -> 同目录临时文件
  -> 原子、拒绝覆盖地发布目标文件
```

导入 seed 保存源格式、路径、session id、版本、完整 entries、active leaf 和会话名。目标 V2 能继续追加真实
Turn；源文件字节保持不变。目标已存在、源目标相同、旧消息不受 V2 Schema 支持或持久文档无效时均 fail
closed，不创建或覆盖目标文件。该 API 是显式迁移能力，不会在 resume、catalog 或 selector 中自动执行。

持久化导入记录属于不受信任文件边界，因此使用 TypeBox；Runtime 决策观察和迁移调用参数属于进程内已类型化
合同，没有重复引入 Zod。

标准安装产物门禁确认新增 stderr 决策信号没有污染 stdout RPC Frame，既有 Provider Frame、跨进程恢复及动态
Skill/MCP 合同继续通过。默认 selector、Tool 功能、公开 Legacy 入口和旧会话源文件均未改变。

### 2.33 Composition 所有权与依赖图收口

第 115 轮审计发现 `runtime-composition` 实际持有的是 Coding Agent 产品级装配，而不是可供多个产品复用的
中立 Runtime 组合。它直接选择 Coding Prompt、Knowledge、Subagent Profile、产品 Tool 顺序及宿主适配器，
却以一个看似底层的独立包存在，导致所有权和依赖方向不一致。

产品实现现已迁入 `@vetta/coding-agent/composition`：

```text
runtime-tools/coding ─┐
runtime-storage/conversation ─┼─> coding-agent/composition
runtime-core 等稳定 Runtime 包 ─┘             │
                                               ├─> CLI
                                               └─> Desktop

runtime-composition -> 无包装兼容转发 -> coding-agent/composition
```

CLI 和 Desktop 已直接消费新的所有者入口。`runtime-composition` 只保留 artifact manifest 和原引用转发，
同名导出仍是同一函数/类引用，没有复制实现或增加行为包装。结构守卫禁止该包重新出现产品实现文件。

依赖审计还暴露两个既有兼容环：`runtime-tools` 包根转发旧 Coding Tool Factory，
`runtime-storage` 包根转发旧 Coding Agent 会话/设置能力；与此同时 Coding Agent 已直接消费二者的独立
`coding` / `conversation` 子路径。为保留已发布根入口而不伪造无环依赖，构建改为：

```text
runtime-tools build:runtime + runtime-storage build:runtime
  -> coding-agent
  -> runtime-tools build:compat + runtime-storage build:compat
  -> runtime-composition compatibility package
```

两个 Runtime 包把 Coding Agent 声明为兼容面的 peer/dev dependency，而不是独立子路径的生产依赖。
根构建和 Desktop 前置构建均识别分段脚本；构建顺序守卫不会把 peer compatibility edge 错判为源码依赖。
新增 manifest truth 守卫要求受审计包的生产源码所引用 workspace 包必须在
dependencies、optionalDependencies 或 peerDependencies 中声明，防止再次依靠 hoist 或旧 dist 隐藏依赖。

本轮没有改变 Tool 名称、描述、Schema、顺序、执行结果、动态 Skill/MCP 刷新、会话格式、selector 默认值或
Legacy 兼容入口。Composition 移动后的关键 CLI、Desktop、RuntimeHost、Subagent、安装产物合同均继续通过。
没有新增反序列化边界，因此未增加 TypeBox/Zod Schema；`zod` 只随既有实现所有权迁移改为 Coding Agent 的
显式直接依赖。

### 2.34 公开子路径与兼容根入口治理

第 116 轮没有收缩 `@vetta/coding-agent` 已发布根入口，而是先把仓库内消费者从“从一个聚合根取得所有能力”
迁移为“按所需职责依赖显式子路径”。新增的公开边界为：

```text
@vetta/coding-agent/bootstrap
@vetta/coding-agent/config
@vetta/coding-agent/knowledge
@vetta/coding-agent/profile
@vetta/coding-agent/resources
@vetta/coding-agent/rpc
```

这些子路径只转发现有实现和类型，不复制实现、不增加包装，也不创建第二份运行时状态。合同测试同时比较根入口
与子路径的关键导出引用，并校验 package export map 指向对应声明和 JavaScript 产物。

CLI、RPC、Desktop 的中性 Bootstrap、RPC、Profile、配置、Knowledge 和资源加载消费者已经迁移。仓库内受治理
生产源码的精确根入口引用由 18 处降为 5 处；剩余项均有明确兼容职责：

- CLI Runtime selector 持有显式 Legacy 启动回退。
- Desktop 旧 Runtime 服务和 Knowledge Poller 仍消费 `AgentSession` 等 Legacy 能力。
- `runtime-tools`、`runtime-storage` 包根继续为既有外部消费者转发已发布兼容 API。

包边界守卫禁止 CLI、Desktop、Runtime Tools 和 Runtime Storage 的生产源码新增精确根入口引用，仅对上述
5 个文件做带原因的路径级允许。测试源码不受该规则限制，以便继续运行根入口与子路径兼容合同。守卫不会禁止
显式子路径，也不会把根入口从 package exports 中移除。

本轮没有改变 Tool、Prompt、Skill、MCP、Knowledge、会话、RPC wire、持久化或 selector 行为；默认 Runtime
继续为 Legacy。新增内容是编译期模块边界和进程内 TypeScript 转发，因此没有外部反序列化输入，不需要新增
TypeBox/Zod Schema。

### 2.35 Legacy 边界隔离与 Knowledge Processing 反腐层

第 117 轮继续处理第 116 轮剩余的 5 个生产根入口允许项，但没有用一个新的 `legacy` 聚合根掩盖差异。
CLI 启动、Desktop 具体 Host Service 和两个 Runtime 包根分别改用用途明确的迁移期边界：

```text
@vetta/coding-agent/legacy/cli
@vetta/coding-agent/legacy/host-services
@vetta/coding-agent/compat/runtime-storage
@vetta/coding-agent/compat/runtime-tools
```

`runtime-storage` 和 `runtime-tools` 的外部根导出没有删除或改名，只是其内部转发不再依赖 Coding Agent
聚合根。Legacy/Compat 子路径直接转发现有实现引用，不复制 Tool Factory、Session Manager 或 Host Service。
通用 `createLimiter` 通过独立 `concurrency` 子路径复用原实现；本轮没有移动其所有权或重写调度算法。

Knowledge Poller 不是普通 import 迁移。它此前直接读取 `AgentSession.modelRegistry`、`todoStore`，
订阅 `AgentSessionEvent` 并注入旧 `ToolDefinition`。现由 Coding Agent Composition 提供
`KnowledgeProcessingSessionFactory` 与 `KnowledgeProcessingSession`：

```text
Desktop Knowledge Poller
  -> KnowledgeProcessingSessionFactory
  -> KnowledgeProcessingSession
       run / abort / subscribeUsage / dispose
  -> Legacy AgentSession Adapter
```

Legacy Adapter 内部继续保持原行为：复用 Desktop 共享 ModelRegistry，先刷新远程模型再解析配置模型，
先 `setModel` 后设置 reasoning，按文件建立并以 `scene` 锁定 Todo，使用轮级共享 `KbWriteSession` 创建
`kb_write_page`，以 `agent_end` 或 prompt settle 完成等待，归一化 usage，并透传 abort/dispose。
Poller 已不再认识 `AgentSession`、`AgentSessionEvent`、`SessionManager`、`ToolDefinition`、`modelRegistry`
或 `todoStore`。

本轮没有强行让 Poller 使用现有 RuntimeHost。RuntimeHost 尚不能表达 Todo `createMany + lock("scene")`
以及同一加工轮跨多个并发 Session 共享写页索引；直接接入会失去强制逐文件完成、并发去重或 O(N²) 优化，
属于功能变化。Greenfield 实现必须在同一 Port 下补齐这些合同后再切换。

CLI、Desktop、Runtime Tools 和 Runtime Storage 的生产源码现已没有精确
`@vetta/coding-agent` 根入口引用，结构守卫因此删除全部路径允许项；测试仍可使用根入口验证兼容性。
默认 Runtime、公开根导出、Tool/Prompt/Skill/MCP、RPC wire 和持久化格式均未改变。

新增 Port、usage 投影和 export map 都是进程内已类型化边界，没有新的外部输入或持久化记录，因此没有新增
TypeBox/Zod Schema。

### 2.36 Greenfield Knowledge Processing 纵向实现

第 118 轮在第 117 轮的稳定 Port 后实现 Greenfield Adapter，没有扩展通用 RuntimeHost。Coding Agent
产品 Session Options 现在可以注入 `KnowledgePageWriterPort` 和初始 Todo 锁来源；产品工具注册优先使用
会话 Writer，普通会话继续使用原 `knowledgeRoot` 默认实现。

Knowledge Processing Adapter 为每个 Port Session 组合并持有一个 Greenfield Composition，使用
`kb-processing` Profile、关闭后台任务和 Subagent，并在 Session 释放后同步释放 Composition。Poller
传入的同一个轮级 `KbWriteSession` 不会被 Adapter 替换；会话包装只转发 `write()`，绝对 wiki 路径由
Coding Agent Knowledge Store 解析。因此多个并发批仍共享 PageIndex 和串行提交边界。

Todo 在 Composition 创建时按原顺序建立并以 `scene` 锁定。Todo Runtime 还会在 Document Participant
初始化时捕获预填状态的首个快照，解决了“首个 Turn 没有 Todo mutation 时重开丢失初始 Todo/锁”的
Greenfield 缺口。宿主仍只能读取和执行受锁保护的 clear，没有获得可写 Store。

Greenfield Factory 的 `run()` 保留远程模型刷新、模型解析、选择和 reasoning；缺失模型继续使用原错误。
稳定 `usage.update` 被投影到 Knowledge Processing usage，Turn failed 被转换为 rejection，abort 直接委托
Session。Port 的 `dispose()` 变为可等待的幂等异步合同，Legacy Adapter 与 Desktop Poller 同步适配，避免
Greenfield Repository、Tool Catalog 或 Hook 资源在后台批结束后遗留。

真实 Tool Loop 已验证目标模型/reasoning、最终 `kb_write_page`、锁定 Todo 拒绝 clear、写页结果绝对路径、
usage、缺失模型和释放；独立恢复合同验证首次 Turn 前关闭并重开仍保持 Todo 内容、顺序和锁。默认 Poller
仍使用 Legacy Factory，因此本轮没有改变生产 Runtime、Tool/Prompt、批次规划、写页实现或持久格式。

新增边界均为进程内 TypeScript 类型；Todo 持久数据继续使用既有 TypeBox Schema，不增加 Zod。

### 2.37 Knowledge Poller Greenfield opt-in 与多批写入差分

第 119 轮没有新增 Knowledge 专用 Runtime 配置，而是复用 Desktop 已有进程级
`VETTA_DESKTOP_AGENT_RUNTIME` selector。缺省、空值和 `legacy` 继续选择 Legacy；只有显式
`greenfield` 才让 Knowledge Poller 组合 Greenfield Factory。环境变量解析留在 Desktop 进程边界，
Coding Agent Composition 只接收已经类型化的选择结果和共享 ModelRegistry 来源。

Desktop 新增独立 Knowledge Processing Factory Resolver。它只在 Legacy/Greenfield 两个既有 Port
实现间选择，不读取配置、不持有 Session，也不修改 Poller 的批次、锁、缓存或记录逻辑。Poller 记录实际
选择，默认行为不变。

多批合同启动两个独立的真实 Greenfield Tool Loop，并向它们注入同一个真实 `KbWriteSession`。确定性
Provider 让不同 source 并发调用原生 `kb_write_page` 写入相同目标 path；两个 Session 结束后等待各自
Composition 释放，再重建缓存。最终 wiki frontmatter/正文、manifest 和 tags 与既有 Writer 基线相等，
只归一化随机 page id、由 id 产生的冲突路径后缀和时间。
合同同时确认共享 Writer 调用数、usage 观察和每 Session Composition 释放。

该证据闭合了 Greenfield 多 Composition 共享轮级 PageIndex/串行提交器的关键风险，但没有把 Poller 的
processing record、failure reconciliation、通知、raws lock 与 abort 收尾全部纳入差分。因此默认值仍不
切换；下一阶段应在 Poller 产品边界补齐这些轮级副作用合同。

本轮没有新增外部配置格式或持久化记录；复用既有 selector 联合类型，进程内 Factory Resolver 不需要新增
TypeBox/Zod Schema。

### 2.38 Knowledge Round Controller 与轮级副作用合同

第 120 轮将 Knowledge Poller 中的单轮状态机抽为 Desktop 产品级 `KnowledgeRoundController`。它不进入
Runtime Core，也不重新抽象 Knowledge 算法：

```text
Poller 配置 / scheduler / Desktop Composition
  -> KnowledgeRoundController
       -> KnowledgeProcessingSessionFactory（Legacy | Greenfield）
       -> 真实 diff / batch / KbWriteSession / cache / failure
       -> processing record / notification / raws lock / temporary directory
```

Poller 的原有导出继续委托 Controller，配置读取、环境变量、定时任务和 Electron 广播仍由 Desktop 所有。
Controller 只注入 Session Factory、知识库根、轮级副作用、raws 锁、临时目录和日志，没有制造覆盖所有
Knowledge 函数的巨型操作 Port，也没有绑定具体 Legacy/Greenfield 实现。

真实文件系统合同使用 21 个 raws 文件产生两个批次，并让两个批次写入同一语义 wiki path。合同验证轮级共享
Writer、最终 21 个 wiki 页、manifest、失败记录清除、usage、processing result、Snapshot、状态通知、
raws lock、临时目录和 Session 释放。失败合同确认第二批抛错后首批 20 个写入保留，所有资源仍清理；中止
合同使用 41 个文件、3 个批次和并发度 2，确认两个活动 Session 都被中止、第三批不创建 Session、不写入且
不计失败。

审计同时固定一项既有行为：Provider/批次直接抛错时，整轮不会进入最终 `reconcileRoundFailures()`，因此
已尝试文件不累计失败次数，processing result 和最终 Snapshot 也不会产生。这不是本轮引入的偏差；是否让
异常轮执行部分成功对账涉及重试和隔离语义，必须作为独立功能决策，不能夹带在架构重构中。

本轮没有改变默认 selector、批次/并发算法、Prompt、Todo、Tool、Writer、持久化格式或记录时序。新增 Port
都是进程内 TypeScript 合同，没有新的外部反序列化边界，因此不增加 TypeBox/Zod Schema。

### 2.39 真实 Desktop Knowledge 生命周期 Canary

第 121 轮把 Knowledge 验证从进程内 Controller 合同提升到真实生产边界。隔离 Desktop 通过显式
Greenfield selector 启动，安装后的 `vetta.exe` 经 Action RPC 调用 `knowledge.manage`，Renderer 展示并
确认真实审批对话框。Canary 覆盖首次扫描成功、扫描中退出、Desktop 重启、Action Provider 重注册、
Provider HTTP 失败和最终退出。

Poller 关闭现在具有幂等异步所有权：先禁止新任务并停止 scheduler，再中止和等待活动轮、释放 raws lock，
最后由 Desktop 关闭本地 RPC。该顺序避免 Action 尚在等待加工结果时 RPC 提前关闭，也保证退出后没有后台
Session/Composition 遗留。真实复跑确认 Desktop 进程发生重启、旧会话继续可用、raws lock 和 Session lock
均释放，最终 endpoint、Provider 与 Desktop 均停止。

真实 CLI 同时暴露并修复了 `knowledge.manage.scan-now` 空输入 schema：`Type.Unsafe` 无法被 TypeBox Value
解码，现改为拒绝额外属性的空 `Type.Object`，不改变接受输入集合。Zod 只校验 Canary 的跨进程 CLI、
Provider、状态文件和 Monitor JSON。隔离 prerequisite build 还补齐了 `runtime-mcp` 对 Web API 类型所需的
DOM lib，没有删除或弱化类型。

实测进一步固定既有失败语义：Provider HTTP 失败时 Action 仍成功完成，`failures.json` 写入一次失败记录，
已有 wiki 保留；Monitor `filesFailed` 仍为 0。Canary 明确断言这个观察差异，而没有夹带修改统计或 Action
结果语义。默认 selector 继续为 Legacy。

### 2.40 真实 Desktop Knowledge Runtime 差分门禁

第 122 轮让同一确定性 fixture 分别运行真实 Legacy 与 Greenfield Desktop，而不是继续从 Greenfield
单边 Canary 推断兼容性。两次运行均使用安装后的 `vetta.exe`、Action RPC、真实审批 UI、三类扫描和一次
Desktop 重启，再把产品可观察结果归一化为独立 Knowledge 合同。

合同逐项比较成功/中止/Provider 失败结果、wiki/manifest/tags、失败账本、Monitor、Renderer 通知、
processing record 数量和退出清理。默认拒绝全部差异，只允许：

- `runtimeMode` 不同，因为它就是被比较的 selector 轴；
- processing record 的内部文件名格式不同：Legacy 为普通 `.jsonl`，Conversation V2 为
  `.conversation.jsonl`。

文件名差异没有放宽 record 数量或生命周期要求；两边都必须产生 3 条记录，并在重启和最终退出时释放
Session lock。真实结果的 `blockingDifferences` 为空，两个 Runtime 的通知均为 processing true、两次
statuses、processing false，其余归一化字段完全相同。

验证驱动复用了 verify:ui 已有浏览器级 Playwright 会话，并通过独立页面级 CDP 重新发现当前主 Renderer。
这样审批和 preload 通知 API 作用于真实 Vetta Desktop 页面，又不会在 Electron 重启时争用浏览器级
WebSocket。跨进程/CDP/报告边界使用 Zod；产品实现和进程内 Knowledge Port 没有新增 Schema。

本轮没有修改默认 selector，也没有改变两项既有失败语义：Provider/批次直接抛错仍不进入最终对账；
Provider HTTP 失败仍写入 `failures.json` 且 Monitor `filesFailed` 为 0。差分门禁证明 Greenfield 与
Legacy 当前行为相同，不代表这些既有产品语义已经被重新设计。

### 2.41 Session replacement / continuation 四象限合同

第 163 轮把会话连续性拆成两个不能混同的语义轴，并在真实 Vetta RPC CLI 中分别运行 Legacy 与
Greenfield：

```text
identity replacement: new_session
  -> 旧 Conversation 资源静默
  -> 新 Todo / Background / ownership identity

storage continuation: memory rollover
  -> 同一运行 Session 与能力资源继续存在
  -> Conversation document path / ownership 原子重绑定
```

合同使用真实 Todo 与 Shell Tool 种下状态。replacement 要求后台进程停止、源锁释放、目标锁持有、目标
Todo 为空；rollover 要求后台进程继续、Todo 保留、源/目标文件均存在、ownership 转移并只产生一次
`session_path_changed`。两条路径在 CLI 关闭后都必须等待后台进程和目标锁真正释放。

矩阵发现 Greenfield `BackgroundCommandService.dispose()` 只发出 stop、没有等待宿主进程退出；Session
随后释放 ownership，Windows fixture 因仍被后台 shell 占用而出现 `EBUSY`。Runtime Tools 现保留同步
`dispose()` 并新增 `shutdown()` 可等待静默点；Greenfield Session Execution Runtime、Session disposer 和
Composition 总释放路径逐层等待该 Promise，ownership 只在后台进程退出后释放。

稳定 Active Session 事件转发也补齐逐 listener 异常隔离。该修复只影响观察者故障传播，不改变事件类型、
顺序或 payload。新增边界均为进程内 TypeScript 合同，没有新增外部 Schema，因此不引入 TypeBox/Zod。

本轮只用 `new_session` 覆盖 replacement 的主路径；真实 `switch_session`、`fork`、目标 Todo 恢复和失败回滚
仍应作为下一阶段矩阵扩展，不能仅凭单元事务合同认定全部切换路径已经收口。

## 3. 已实施模块审计

| 模块 | 当前状态 | 与旧行为的差距 | 切换结论 |
| --- | --- | --- | --- |
| `current_time` Tool | 定义、执行和注册行为已差分验证 | 无已知 Tool 级差距 | Tool 级迁移完成；Feature 仍不可整体切换 |
| `read` Tool | 独立实现、旧新行为合同和真实 Tool Loop 已通过 | 独立可执行宿主的 Photon WASM 产物打包尚未验证 | 工具模块迁移完成；生产宿主不可切换 |
| `ls` Tool | 独立实现、旧新行为合同、空 scope 和 Feature 显式激活 Tool Loop 已通过 | 生产宿主尚未装配新 Profile | 工具模块迁移完成；默认不激活 |
| `glob` Tool | 独立实现、绝对 pattern、`.gitignore` 和真实 Tool Loop 合同已通过 | 生产宿主尚未装配新 Profile | 工具模块迁移完成；全 scope 暴露保持旧语义 |
| `dir_tree` Tool | 独立 Runtime Tool、树模型、fd Operations/Resolver、限制合同和全场景 Profile 差分已通过 | 旧 AgentSession 和生产入口仍使用旧 Tool Factory | 工具模块迁移完成；旧生产入口尚不可删除 |
| `write` Tool | 独立 Runtime Tool、WriteOperations、必需的宿主 WritePathPolicy、路径/取消/错误合同和全场景 Profile 差分已通过 | 旧 AgentSession 和生产入口仍使用旧 Tool Factory | 工具模块迁移完成；旧生产入口尚不可删除 |
| `edit` Tool | 独立 Runtime Tool、双模式纯编辑引擎、EditOperations、必需的宿主 EditPathPolicy、22 项差分合同和全场景 Profile 差分已通过 | 旧 AgentSession 和生产入口仍使用旧 Tool Factory | 工具模块迁移完成；旧生产入口尚不可删除 |
| `bash/shell` Tool | Runtime Definition、Registration、前台执行器、后台协调、独立后台生命周期、task 工具、通知格式、低层 Host Adapter、平台 scope 和过渡 Composition Root 已通过；后台 Service 具备可等待 `shutdown()`，Greenfield Session 释放会等待真实进程退出 | 旧 AgentSession 仍使用旧工具/Manager；同步 `dispose()` 兼容入口仍保留 | 新 Runtime 工具链与异步关闭合同已完成；旧生产兼容路径尚不可删除 |
| 宿主可执行文件解析 | Runtime Port、本地 PATH/managed-bin Adapter、grep/find 注入合同、旧 ensureTool 适配、网络/归档合同和 cli-app Composition Root 已通过 | 真实 GitHub 网络、最终独立可执行发布物和完整 Tool Profile 迁移尚未完成；包根兼容导出必须继续保留 | 新 Profile 可并行验证；旧宿主仍不可切换 |
| Coding Tools Feature | 只依赖版本化 Catalog，按 Model Call 动态解析 scope、agent mode、explicit 激活和 requires/capabilities，使用稳定 binding 和原子 Catalog 执行仲裁，并支持 deactivate/revoke/unregister；产品工具按 Session cwd 创建，文档/OCR/progress 已由 Runtime Tools 原生拥有，模型顺序由通用 `modelOrder` 稳定物化；Desktop 与 CLI/RPC/IM 源码 Provider Frame 已精确差分，安装产物 `im-claw` Provider Frame 与有序 Tool Surface 也已验证 | 安装产物 Greenfield CLI 仍只支持 `im-claw`；默认 selector 尚未切换 | 模型调用级工具面与 Runtime-native 所有权已闭合；进入默认切换准备度审计 |
| Composition Root 与依赖图 | 产品装配已归属 `@vetta/coding-agent/composition`；CLI/Desktop 直接消费；`runtime-composition` 无包装兼容转发；Runtime 子路径与旧根兼容面采用分段构建；manifest truth 和 forwarding-only 守卫已接入 | `runtime-tools`、`runtime-storage` 包根仍需为外部消费者保留 Coding Agent 兼容转发；默认 selector 仍是 Legacy | 产品所有权和 clean build 顺序已收口；兼容根入口只能在外部迁移窗口后删除 |
| Coding Agent 公开 API | Bootstrap、Config、Knowledge、Profile、Resources、RPC 已有显式子路径；Legacy CLI/Host Service 与 Runtime 包根使用用途明确的迁移期入口；受治理生产源码的精确根入口消费者已归零 | Legacy/Compat 子路径仍转发具体实现，外部消费者迁移窗口尚未建立；根入口仍是已发布兼容面 | 仓库内依赖不再经过聚合根；兼容入口只能按各自迁移合同逐项删除 |
| Knowledge Processing Session | Legacy/Greenfield Factory 均实现稳定 Port；Desktop Poller 已复用进程级 selector 提供显式 Greenfield opt-in；真实 Tool Loop、共享轮级 Writer、Round Controller 副作用合同、Desktop 生命周期 Canary 和完整 Legacy/Greenfield 产品差分均已通过 | 默认仍为 Legacy；直接抛错不进入失败对账、失败记录与 Monitor `filesFailed` 口径不一致是两边共同的既有产品语义 | 0 项阻断差异；默认切换可以进入独立阶段，但不得同时删除 Legacy 或夹带修改失败语义 |
| `AgentSession` | 新状态机、活动 Turn 输入队列、无伪 user message 的 continue、显式 resume 与同 Turn 持久化身份重绑定已实现 | 尚缺旧外围能力的 Greenfield 实现 | 内核 Turn/恢复语义已具备；生产入口不可切换 |
| Turn Pipeline | 固定阶段、模型调用请求—应答检查点、持久化压缩提交、跨 Conversation 续接及成功/失败 finalization、非持久化 observation、输入队列、continue、recovery、独立 Turn Model Binding 和 Session-local 运行期 Context 串行持久化已实现 | 完整生产 Composition Root 尚未接入 | 不可切换 |
| `AgentCoreTurnEngine` | 模型和 Tool Loop 闭环、动态 Model Call Frame、完整观察事件、输入队列、Context checkpoint 桥接和 Turn model binding 已接入真实 Greenfield Composition 与 RuntimeHost | 默认生产选择仍是 Legacy | 内核执行与候选宿主接线完成；等待整体默认切换门禁 |
| Greenfield Session Backend | 独立门面、可重绑定投影、显式 resume、Session-local Todo/Hook/Context/Subagent Runtime，以及完整 RuntimeHost Core/外围 Ports 均已交付；真实 CLI 已验证 `new_session` replacement 与 memory rollover continuation 的 Todo、后台进程、路径和 ownership 合同 | `switch_session` / `fork` 的同级真实 CLI 资源矩阵仍待补齐；Legacy 兼容入口仍保留 | Assembly 与两类主连续性语义 Ready；完成剩余 replacement 路径后再评估删除兼容实现 |
| Runtime Snapshot | 编译、冻结、lease、原子交换和动态 Model Call Provider 已实现 | Coding Profile 的完整默认能力与 scope 尚未装配 | 不可替代旧工具注册 |
| Conversation Repository | V2 create/load/append/save、树形 Document 读写、活动分支、fork、跨实例文件锁、跨 Conversation seed/transfer/continued 事务、Legacy importer，以及带来源证明、拒绝覆盖的显式 Legacy→V2 迁移已实现 | Legacy/V1 历史结构写命令继续只读；迁移不自动触发；跨文件崩溃 orphan reconciliation 与模型配置异步持久化尚未实现 | 已具备安全显式迁移能力；不可直接替代全部旧会话写路径 |
| Context Strategy | Session-local Runtime 已接入原生摘要持久化、重开投影、外部/同 Turn threshold/prefire、逐模型调用 microcompact、error/silent overflow 单次恢复、手动/Extension 压缩、Pre/PostCompact 和 usage 状态；Coding Agent Memory Orchestrator 已接入冻结 Prompt、既有 Tool、70% 策略、自动/主动 flush、通用 rollover、JOURNAL 与 rollover 后置 finalization | 默认生产 RPC/IM 尚未接入 Greenfield Controller | memory-mode 内部链路可并行验证；生产宿主仍不可切换 |
| MCP | 协议、配置、Client/Transport、OAuth、Supervisor、Runtime-native Tool Source、插件动态 Server、渐进披露、Hook 元数据和子代理 Binding 投影均已完成；第 107 轮旧新端到端差分通过；Prompt reload 观察事件和每次 Model Call 刷新已与 Legacy 对齐 | 旧 `AgentSession` 和公开兼容 API 仍保留 `McpManager`；默认 Runtime 尚未切换 | Greenfield MCP 迁移验证完成；旧兼容入口随整体生产切换移除 |
| Skill / Knowledge | Session 级 Skill/Scene Prompt、Session-local invoke_skill、Knowledge Tool Source 与 kb-processing 写能力已进入动态组合；Skill 根目录运行中新增、内容修改、删除和 Agent Mode 变化均在下一 Model Call 生效且不重建 Session；标准安装产物已复验项目 Skill 的新增、修改和删除；kb_write_page 已通过 `KnowledgePageWriterPort` 成为原生 Runtime Tool | 默认 selector 和旧公开消费者尚未完成切换审计 | 动态能力边界已闭合；暂不删除 Legacy 来源或切换默认入口 |
| Subagent | Session-local Runtime、Explorer/Workflow、Hook、Todo、增量状态日志、恢复、通知去重及父 MCP Binding 投影已实现 | 默认 Legacy Backend 尚未切换 | Greenfield 能力已完整接入；随整体宿主切换启用 |
| Ecosystem Hook Runtime | 每 Session 唯一实例已贯通 Prompt、最终动态 Tool Surface、Stop、SubagentStart/SubagentStop、运行期 Context、自动/手动 Pre/PostCompact 和 dispose | PermissionRequest Hook 与宿主切换原因仍需纳入完整生产 Profile 差分 | 并行组合已验证；默认生产入口不变 |
| Desktop / CLI / RPC / IM Adapter | RuntimeHost 稳定 Ports、Greenfield RPC/IM Adapter、显式 Runtime selector、requested/effective/fallback 决策观察、IM Sidecar、Desktop Backend Pool、真实进程 Canary、独立安装产物和跨进程恢复均已完成；真实 CLI 四象限合同已覆盖 `new_session` 与 memory rollover 的资源连续性和最终关闭 | `switch_session` / `fork` 的真实资源矩阵、公开 API 和旧存储消费者仍需最终审计 | Greenfield 主路径已具备差分证据；继续补齐剩余 replacement 操作，不提前删除 Legacy |
| Runtime 启动与选择 | 中性 Bootstrap、显式 selector 决策合同、三类产品入口 stderr 诊断及 Greenfield 禁用 Legacy 启动符号守卫已完成 | Legacy 仍是默认值；selector 边界继续持有兼容回退实现 | 控制面已收口；默认值只能在剩余依赖审计清零后单独切换 |

上述差距目前没有影响生产，因为旧入口仍在使用旧实现。但它们是切换阻断项，不能因为新模块
已有单元测试就视为功能迁移完成。

## 4. 新的迁移 Gate

每项能力按以下顺序实施：

1. 从旧实现和旧测试提取可观察行为矩阵。
2. 建立参数化合同测试，同一 fixture 同时运行旧实现和新实现。
3. 再进行 Port、Adapter、Feature 和文件结构调整。
4. 比较 Schema、描述、结果、错误、副作用和事件。
5. 任何差异默认修复；确需改变时单独提交决策，不夹带在架构重写中。
6. 差分测试全部通过后，才在实施日志中标记“已迁移”。

工具最低差分矩阵：

```text
definition
  name / label / description / schema / default exposure
execution
  success / failure / cancel / progress
input edges
  optional fields / extra fields / invalid values
environment
  Windows / Unix / cwd / absolute path / home path
output
  content / details / truncation / actionable notices
side effects
  filesystem / process / network / persistence
```

## 5. 下一步

第 163 轮已闭合 `new_session` replacement 与 memory rollover continuation 的真实 CLI 四象限合同，并修复
Greenfield 可等待资源关闭缺口。下一阶段继续收敛同一会话边界，不扩充 Runtime Core：

1. 把 replacement 轴扩展到真实 CLI `switch_session` 与 `fork`，同时运行 Legacy/Greenfield。
2. 验证目标 Todo 按目标分支恢复、源后台任务静默、目标 ownership 接管、失败时源资源与 identity 回滚。
3. 覆盖切换排队期间 Prompt、Todo、Background 和 Subagent 命令的目标 identity 归属，避免只验证最终状态。
4. 全部差分通过后再合并重复的 Legacy-only 资源测试；不得先删 Oracle 再补新测试。
5. Legacy 入口、持久化格式、Tool/Prompt/Skill/MCP 功能和 selector 决策不与该阶段捆绑修改。

TypeBox/Zod 继续只用于外部 RPC、配置和持久化反序列化边界；Session 生命周期与资源静默点是已经类型化的
进程内合同，不为其重复增加 Schema。
