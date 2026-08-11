# 第 108 轮：生产 Model Call Frame 差分门禁与 Profile 切换准备度

## 1. 目标

第 107 轮确认 MCP Runtime-native 路径具备替代旧 `McpManager` 数据面的条件后，本轮开始验证更外层的生产
Profile，而不是继续按单个内部模块推断切换准备度。

目标是：

1. 从真实 Desktop `RuntimeHost` 和 OpenAI Responses Provider HTTP 边界捕获最终模型请求；
2. 使用相同会话输入分别运行 Legacy 与 Greenfield；
3. 覆盖全部 7 个会话场景和 turn 边界上的动态能力变化；
4. 区分已经等价的共享合同、明确未迁移的能力和不应被归一化掩盖的差异；
5. 保持默认 Runtime selector 不变。

## 2. 为什么比较真实 Provider 请求

低层 Tool Profile 测试只能证明已经迁移的 Registration 在 scope 选择后名称一致，不能证明生产组合最终发送给
模型的内容一致。Skill、Knowledge、Plugin、MCP、Todo、Subagent 和宿主处理器都可能在更晚的组合阶段改变
System Prompt 或 Tool Surface。

本轮新增 `desktop-model-call-frame-differential.test.ts`，直接捕获 `/responses` 请求，比较：

- model、reasoning、token limit、store、stream 等 Provider 参数；
- 去除工具清单、Skill 清单和 turn 时间后，剩余模型消息与系统指令；
- 两条路径共同拥有的 Tool name、description 和完整 JSON Schema；
- 最终 Provider Tool Surface 的新增、缺失和未分类差异；
- 插件重配置、全局 Agent Mode 和用户提问处理器在下一 turn 的生效结果。

测试不使用 Golden Snapshot。只有 `prompt_cache_key`、系统提示中的 turn 时间以及本轮明确审计的能力清单被分类
处理；共同 Tool Schema 和其余 Provider 请求仍做结构相等比较。

## 3. 覆盖矩阵

静态矩阵覆盖：

- `im-claw`
- `conversation`
- `project`
- `batch`
- `automation`
- `kb-processing`
- `cli`

动态矩阵在同一 Session 的两个 turn 间同时执行：

```text
turn 1
  work mode
  + plugin prompt/tool
  + ask_user_question handler

turn boundary
  remove plugins
  switch to coding mode
  remove question handler

turn 2
  + knowledgeMode request
```

Legacy 与 Greenfield 的共同 Provider 请求、共同 Tool Schema、插件提示增删、插件 Tool 增删和
`ask_user_question` 增删均保持一致。

## 4. 发现的切换阻断项

真实生产 Frame 暴露了低层 Profile 测试没有覆盖的差距。

Greenfield 在全部场景缺少以下 Legacy 能力：

- `doc_to_pdf`
- `html_to_pdf`
- `extract_text_from_pdf`
- `extract_text_from_img`
- `render_pdf_page`
- `progress`
- `invoke_skill`

`kb-processing` 还缺少：

- `kb_write_page`

此外，共同 Tool 的 Provider 数组顺序尚未与 Legacy 一致。`RuntimeHost.getState().activeToolNames` 表示会话可用
能力视图，不等于每个请求经过 `knowledgeMode` 等调用级过滤后的最终 Tool Surface，因此本轮明确以 Provider
请求体为模型可观察事实源，不把状态视图顺序误当成最终 Frame。

本机 Legacy 路径还可能发现外部 `mcp_*` Tool；它们由第 107 轮及 Runtime-native MCP 组合测试负责。本轮不会
把机器本地 MCP 名称写入固定能力清单，也不会因此把文件 MCP 重复实现到 Profile 测试中。

## 5. 处理结论

本轮没有通过兼容适配把旧 Tool Factory 整体注入 Greenfield。那会让新 Composition Root 重新依赖待淘汰的
旧 Runtime Manager，并隐藏工具生命周期、Skill Resource 和 Knowledge 写能力尚未迁移的事实。

本轮实施的是可执行切换门禁：

- 未分类的 Legacy-only Tool 会立即使测试失败；
- Greenfield-only Tool 会立即使测试失败；
- 共同 Provider 参数、消息语义或 Tool Schema 变化会立即失败；
- 已知缺口必须逐项从清单移除，不能扩大清单绕过失败；
- 缺口未清零前不得改变默认 Runtime selector。

## 6. 解决方案与实施顺序

后续按能力所有权实施，不创建一个新的“Legacy Tools Adapter 大包”：

1. 文档与 OCR Tool：迁入 `runtime-tools/coding/tools/*`，复用既有参数化行为合同，宿主二进制和 Desktop 路径通过
   Port 注入；完成后逐项从门禁清单移除。
2. `progress`：作为独立模型 Tool 与宿主观察事件边界迁移，保持 Work Mode 可见性和既有输出合同。
3. `invoke_skill`：由 Session-local Prompt Resource/Skill Runtime 提供，不能作为无状态静态 Tool 注入；同时
   比较 Skill 清单和 Agent Mode 过滤。
4. `kb_write_page`：由 Knowledge 写能力注册，保持仅 `kb-processing` 场景和现有路径保护语义。
5. Tool 顺序：在完整能力清单迁移后，以 Legacy 最终 Provider 顺序为 Oracle，给 Profile Compiler 建立确定性顺序
   合同；不要在 Provider Adapter 内临时排序。
6. 清单清零后，把同一 Frame 门禁扩展到 CLI/RPC/IM 生产 Composition Root，再进行默认 selector 决策。

## 7. TypeBox / Zod 判断

本轮没有新增外部协议、配置或持久化反序列化边界，不新增 TypeBox/Zod Schema。Provider 测试服务器继续使用
现有 Zod 请求 Schema；Tool 参数继续比较已有 TypeBox JSON Schema。内部差分投影保持 TypeScript 类型。

## 8. 验证

验证结果：

```text
Desktop Model Call Frame 完整矩阵：1 file, 8 tests passed
Desktop 既有 RuntimeHost 差分与动态能力回归：2 files, 7 tests passed
bun run check:quick: passed
bun run check: passed
```

首次全量检查发现测试误用了未导出的类型名，以及只读字面量数组 `includes` 的类型方差过窄；修复后重新运行
`bun run check`，Biome、根 Monorepo `tsgo --noEmit`、CLI 显式类型检查、Desktop `tsc --noEmit`、Admin
`tsc -b` 和质量守卫全部通过。这再次说明 Vitest 转译通过不能替代生产项目类型检查。默认 Runtime selector
未修改。

## 9. 下一步

下一阶段应作为一个完整的“缺失生产能力迁移”阶段：先迁移 5 个文档/OCR Tool、`progress`、Session-local
`invoke_skill` 和 `kb_write_page`，再统一最终 Provider Tool 顺序，并让本轮已知缺口清单归零。完成前不进入默认
Greenfield 切换，也不继续拆除 Legacy `AgentSession`。
