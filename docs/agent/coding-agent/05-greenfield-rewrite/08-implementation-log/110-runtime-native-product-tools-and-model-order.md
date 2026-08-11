# 第 110 轮：Runtime-native 产品工具与通用模型顺序合同

## 1. 目标

第 109 轮先通过显式兼容层补齐生产 Tool Surface，但仍留下三个架构问题：

1. 5 个文档/OCR Tool、`progress` 和 `kb_write_page` 仍由旧 Tool Factory 提供实现；
2. 产品工具在 Composition Root 创建时捕获全局 cwd，不能证明多 Session 工作目录隔离；
3. `CodingAgentModelCallFrameComposer` 通过具体工具名维护排序表，通用组合器仍认识产品能力。

本轮在不改变工具名称、描述、TypeBox Schema、scope、agent mode、结果文本和默认 selector 的前提下，完成
Runtime-native 所有权迁移，并把工具顺序改为通用元数据合同。

## 2. 实施内容

### 2.1 通用 `modelOrder` 合同

`RuntimeToolDefinition` 和 `CodingToolRegistration` 新增可选 `modelOrder`。Runtime Core 在创建 Model Call
Frame 时进行稳定排序：

- 声明顺序值的工具按数值升序；
- 未声明顺序值的 MCP/外部工具排在其后；
- 相同值和未声明值保持原贡献相对顺序。

具体产品名称及 Legacy 顺序只存在于 Coding Agent 的 `greenfield-model-tool-order.ts`，并在各 Registration 或
Feature 组装时写入。Composer、Runtime Core 和 Provider Adapter 不再认识 `read`、`doc_to_pdf`、
`invoke_skill` 等具体名称。

Session-local Plugin Tool 同样由 Coding Agent 产品策略写入统一的 `plugin` 顺序值。该值位于
`ask_user_question` 之后、未声明顺序的 MCP/外部工具之前，保持 Legacy 的
“内建工具 -> Plugin Tool -> MCP Tool”最终 Provider 数组合同。

### 2.2 Session-local 产品工具

产品工具不再注册到进程级 Catalog。每个 Session 使用自身 cwd 创建 Registration，并由 Session-local
`coding-agent.product-tools` Feature 在每次模型调用时读取当前 scope、agent mode、capability 和显式激活状态。

这样形成两个不同的动态边界：

```text
Session 创建
  -> 用该 Session cwd 创建工具和 Host Port 绑定

每次 Model Call
  -> 读取当前 activation
  -> 选择当前可见 Registration
  -> 按 modelOrder 物化最终 Tool Frame
```

Session cwd 不再从全局 Composition Root 泄漏到其他会话；mode、capability 和显式激活变化仍在下一次模型调用
生效，不重建整个 Runtime Snapshot。

### 2.3 文档、OCR 与进度工具原生化

以下工具的定义、TypeBox 输入 Schema、TypeScript 描述、执行编排和 Registration 已迁入独立
`runtime-tools/coding/tools/*` 目录：

- `doc_to_pdf`
- `html_to_pdf`
- `extract_text_from_pdf`
- `extract_text_from_img`
- `render_pdf_page`
- `progress`

工具没有反向导入 `coding-agent`。不可移植能力通过窄端口注入：

- `DocToPdfOperations`：Office/WPS 检测与转换；
- `DesktopCommandPort`：Vetta Desktop 定位与命令执行；
- `CommandProcessPort`：`pdfinfo` 等通用子进程；
- `RenderPdfPageProcessPort`：`pdftoppm` 单页渲染；
- `AsyncExecutionGate`：宿主级 OCR 全局并发限制。

`coding-agent` 只提供本地进程、可执行文件定位、既有 OCR 并发闸和 Office 平台实现。超时、buffer、参数、错误、
截断和输出格式继续由 Runtime Tool 保持既有合同。

### 2.4 Knowledge 写边界

`kb_write_page` 属于 Coding Agent 产品域，不下沉到通用 Runtime Tools。它已改为原生
`RuntimeToolDefinition + KnowledgePageWriterPort`：工具拥有模型合同和结果格式，宿主 Writer 继续委托既有
知识页持久化服务。Registration 保留：

- `scopeUse: ["kb-processing"]`
- `requires: ["knowledge"]`
- `category: "kb-write"`

### 2.5 删除迁移期产品工具适配器

`greenfield-product-tool-adapter.ts` 已删除。新的 `greenfield-product-tools-runtime.ts` 只负责 Composition：创建
Host Port、组装 Runtime Registration 和提供 Session-local Feature，不再把旧 AgentTool 转换成 Runtime Tool。

旧 Tool Factory 没有删除，因为 Legacy 默认生产路径仍在使用；本轮删除的是 Greenfield 对旧实现的依赖，不是
提前移除旧功能。

### 2.6 TypeBox 使用判断

本轮在不受信任的反序列化边界使用 TypeBox：

- `desktop-config.json`；
- Vetta Desktop HTML/PDF 命令响应；
- OCR CLI 最后一条 JSON 响应；
- OCR 结构化结果文件。

进程内 Port、Registration、排序值和 activation 均为受信任 TypeScript 合同，不重复增加 Zod。工具输入继续使用
既有 TypeBox Schema，因此没有同时引入两套 Schema 系统。

### 2.7 Desktop 源码组合与跨宿主门禁收口

首次验收发现 Desktop Vitest 虽然把 Coding Agent 和 Runtime Core 指向源码，却仍从 workspace `dist` 解析
`@vetta/runtime-composition`。这会把新 Coding Agent 与旧 Composition Root 混合装配，差异测试因此不能代表
当前源码。Desktop Vitest 现已显式把 Runtime Composition 指向 `src/index.ts`。

修正解析边界后，完整 Provider Tool 数组差异暴露了两个问题：

1. 测试会读取开发机真实全局 MCP 配置，导致结果和耗时依赖个人环境；
2. Plugin Tool 在 Greenfield 中晚于 Session-local MCP 注入，最终顺序与 Legacy 不同。

处理方式不是过滤差异：

- 测试将全局 Agent 配置目录隔离到临时目录，消除个人 MCP/Skill 配置污染；
- Greenfield 测试继续装配与生产相同的文件 MCP Source 和 Plugin MCP Runtime；
- Plugin Tool 获得产品级 `modelOrder`，恢复 Legacy 的 Plugin/MCP 相对顺序；
- Desktop 最终 Provider 请求继续逐项比较工具名称、顺序、描述和完整 Schema；
- CLI/RPC/IM 继续通过真实 `vetta` Agent RPC 进程比较 Legacy 与 `greenfield-im` 的 Provider、Tool、
  Abort、附件、Memory rollover 和会话所有权合同。

## 3. 测试与检查

已通过：

```text
Runtime Core Model Call Frame：1 file, 3 tests passed
Runtime 产品工具合同：1 file, 7 tests passed
Coding Agent Composer、产品工具、动态 Skill 与 Plugin 顺序：3 files, 13 tests passed
Desktop 源码 Composition 与最终 Provider Frame：2 files, 14 tests passed
CLI/RPC/IM 真实进程 Provider 差分：1 file, 5 tests passed
bun run check:quick: passed
bun run check: passed
```

测试覆盖通用稳定排序、未知工具相对顺序、Session cwd 路径解析、Office 转换端口、HTML 参数、OCR 并发闸、
OCR 外部 JSON、PDF 自动降 DPI、PDF 单页渲染、progress 结果合同、Plugin/MCP 相对顺序、全部会话场景的最终
Provider Tool 数组，以及 CLI/RPC/IM 的真实进程行为。

本机 `bunx vitest` 的 Bun worker 分别触发 Windows File URL 和 MessagePort 运行器错误，因此定向 Vitest 使用工作区
提供的 Node 运行同一 Vitest 配置完成；测试代码与断言均已实际执行。

最终完整 `bun run check` 已通过，包括全仓 Biome、Monorepo `tsgo --noEmit`、CLI 独立类型检查、Desktop
独立 `tsc --noEmit`、Admin `tsc -b` 和质量守卫。此前 Admin `node_modules/@types` ACL 导致的
`EPERM/TS6053` 在当前环境中不再复现。

## 4. 明确未修改

- 未修改 Legacy 工具的名称、描述、Schema、scope、mode、执行文本或副作用。
- 未删除仍由 Legacy 默认入口使用的旧 Tool Factory。
- 未改变 Legacy/Greenfield selector 默认值。
- 未把产品顺序表放入 Runtime Core、Composer 或 Provider。
- 未运行 build，也未刷新 workspace `dist`。

## 5. 下一步

第 110 轮源码实现、宿主组合和质量门禁已经完成。后续若进入新阶段，应独立处理“标准产物与剩余生产差分”：

1. 按标准 workspace 前置产物流程刷新 `dist`，运行安装产物级 Desktop 完整 Provider Frame 差分，确认工具名称、顺序、描述
   和 Schema 全部一致；
2. 在现有 CLI/RPC/IM 真实进程差分之上，补充完整 Tool 数组和多 Session cwd 隔离；
3. 比较 SessionEvent、持久化、恢复、关闭和动态 Skill/MCP/Tool 变化；
4. 默认 selector 继续保持 Legacy，只有产物和全部宿主门禁通过后，才单独决定切换及旧实现删除范围。
