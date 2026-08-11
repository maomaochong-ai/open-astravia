# 第 111 轮：真实宿主 Provider Frame 与多会话隔离收口

## 1. 目标

第 110 轮已经完成 Runtime-native 产品工具和通用模型顺序合同，但真实宿主门禁仍只比较事件与局部 Provider
行为，尚未同时证明：

1. `vetta` CLI/RPC/IM 独立进程发出的完整 Provider 请求与 Legacy 相等；
2. 同一个 `RuntimeHost` 持有不同 cwd 的多个 Session 时，Session-local 产品工具不会串用工作目录；
3. 测试执行的是当前源码组合，而不是直接调用某个内部 Session 或 Tool Factory。

本轮只补齐这些生产边界证据和由差分暴露的兼容性问题，不增加产品功能，不切换默认 Runtime。

## 2. 真实 CLI/RPC/IM Provider Frame

现有差分测试会从 `packages/cli-app/src/agent-rpc-cli.ts` 构建临时可执行文件，再以独立子进程、独立工作区、
独立 Agent 配置目录和本地 OpenAI Responses Server 分别运行 `legacy` 与 `greenfield-im`。新增合同直接比较
第一轮完整 Provider 请求：

- model、stream、store、reasoning 和 token 参数；
- 完整 input 与系统提示词；
- Tool 数组名称、顺序、描述和完整 JSON Schema。

只归一化三类真实易变数据：`prompt_cache_key`、fixture 临时根路径和当前回合时间。工具清单或 Schema 不允许
通过快照、缺失白名单或模糊匹配隐藏。

## 3. 差分发现与兼容修复

完整请求首次运行发现两项真实功能漂移：

1. Greenfield IM 默认创建 Subagent Runtime，额外向模型暴露 7 个子代理/工作流工具；Legacy IM 不暴露；
2. Legacy IM 的系统提示词仍公布两个知识库检索工具，但本轮实际 Tool Frame 会移除它们；Greenfield 原先同时
   从提示词和 Tool Frame 移除。

处理方式：

- Greenfield IM Composition Root 显式设置 `enableSubagents: false`，不再依赖 Composition 的通用默认值；
- `GreenfieldRuntimeCompositionOptions.systemPromptAdvertisedToolNames` 明确表达“只保留既有系统提示词公布，
  不加入可执行 Tool Frame”的宿主兼容合同；
- `CodingAgentModelCallFrameComposer` 只在构建系统提示词时合并这些名称，最终可执行 Tool Map 仍完全来自当前
  Model Call Frame；
- IM 默认工具模式公布 `kb_filter_by_tags` 和 `kb_list_available_tags`；`--no-tools` 和显式 `--tools`
  继续保持原有显式选择语义。

该选项不是新的动态工具注册通道，也不能绕过 Tool Catalog、activation 或执行期能力校验。

## 4. 同一 RuntimeHost 的多会话 cwd 隔离

新增 Desktop 真实 Model Call 测试在同一个 `RuntimeHost` 中创建两个 Greenfield Session，每个 Session 使用
不同 cwd 和会话目录。Provider 依次要求两个 Session 调用：

```text
render_pdf_page({
  input: "source.pdf",
  page: 1,
  output: "invalid.txt"
})
```

工具在启动外部 `pdftoppm` 前会把相对路径按 Session cwd 解析，并因输出扩展名无效返回包含绝对路径的 Tool
Result。第二次模型请求中的 Tool Result 被用作可观察事实源，验证：

- Session A 只包含 cwd A 的绝对输出路径；
- Session B 只包含 cwd B 的绝对输出路径；
- 两个结果均不包含另一个 Session 的 cwd。

这验证的是完整 `RuntimeHost -> Backend Pool -> Session-local Feature -> Runtime Tool -> Provider` 链路，不是
直接调用工具函数。CLI/RPC/IM 独立进程按产品合同只持有一个会话，因此多会话隔离放在真正支持并发持有多个
Session 的 Desktop RuntimeHost 门禁中验证。

## 5. Schema 与边界判断

本轮没有新增外部 JSON、配置或持久化反序列化格式，因此没有引入新的 TypeBox/Zod Schema。

- Provider 测试 Server 继续使用既有 Zod 外部请求校验；
- Runtime Composition、Composer 选项和 Session cwd 均为受信任 TypeScript 合同；
- Tool 输入继续由既有 TypeBox Schema 校验。

## 6. 测试与检查

已通过：

```text
Coding Agent Model Call Composer Adapter：1 file, 8 tests passed
Greenfield Runtime Composition：1 file, 14 tests passed
CLI/RPC/IM 真实进程完整 Provider Frame 与既有行为：1 file, 6 tests passed
Desktop 全场景 Provider Frame、动态重配置与多会话 cwd：1 file, 9 tests passed
bun run check:quick: passed
bun run check: passed
```

Composition fixture 对自身关注的 Tool 做显式过滤，并关闭用户 Agent Skill，避免本机动态 `invoke_skill` 扩大
破坏无关断言。定向测试使用工作区提供的 Node 运行同一 Vitest 配置；没有使用失效的 Bun Vitest worker。

完整 `bun run check` 包含全仓 Biome、Monorepo `tsgo --noEmit`、CLI 独立类型检查、Desktop 独立
`tsc --noEmit`、Admin `tsc -b` 和质量守卫，均已通过。

## 7. 明确未修改

- 未修改 Legacy Tool Factory、工具执行结果或持久化格式。
- 未向 IM 开放 Subagent 或 Knowledge Tool 执行能力。
- 未改变 `--no-tools`、显式 `--tools` 或默认 Runtime selector。
- 未运行仓库规则禁止的 build，也未刷新 workspace `dist`。

## 8. 结论与下一步

源码层的真实 CLI/RPC/IM 完整 Provider Frame 和 Desktop 多会话 cwd 隔离已经闭合。下一阶段应聚焦剩余生产
切换门禁：

1. 通过允许的标准 workspace 产物流程刷新并验证安装产物，禁止测试继续依赖陈旧 `dist`；
2. 比较真实宿主的 SessionEvent、持久化、恢复和关闭序列；
3. 覆盖运行中 Skill/MCP/Tool 增删在下一 Model Call 生效、在途调用保持既有 Turn 绑定的合同；
4. 全部门禁通过前继续保持 Legacy 默认 selector，不删除旧实现。
