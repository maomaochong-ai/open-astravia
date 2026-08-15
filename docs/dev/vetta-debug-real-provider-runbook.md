# Vetta Debug 真实 Provider 实战

本文记录如何使用 Vetta Debug 驱动真实模型完成多轮工具调用，并验证上下文缓存、工具状态和模型行为。它是
[Vetta Debug](./vetta-debug.md) 的实战补充；能力契约、输入 Schema、错误码和安全边界仍以该文档为准。

## 适用场景

- 验证真实 Provider 是否正确返回 `usage`、缓存读写 Token 和停止原因。
- 模拟正常用户的多轮会话，检查 Todo、Ask User 等工具的调用与状态持久化。
- 区分模型行为问题、工具状态问题、Prompt 前缀变化和开发环境热更新干扰。
- 为缓存命中率优化建立可重复的冷启动、稳态和失效样本。

真实 Provider 可能产生费用。开始前必须确认测试已获授权、模型和费用范围明确，并且 Prompt 不包含密钥或
生产隐私数据。

## Profile 选择

| Profile | 选择条件 | 缓存实验注意事项 |
|---|---|---|
| Debug | 需要可重复实验、隔离数据和 Provider 观测文件 | 首选；固定启动参数后不会被普通开发会话污染 |
| Dev | 需要验证当前已经运行的普通开发应用及其真实配置 | 适合快速诊断；Vite HMR、插件重载和运行时重配置会污染缓存数据 |

正式缓存基准优先使用 Debug Profile。Dev Profile 的结果必须同时对照 Main/Renderer 日志；测试期间只要发生
HMR、插件重新激活或 `runtime reconfigure`，就应把对应调用标记为“环境失效样本”，而不是稳态样本。

## 开始前检查

在仓库根目录确认目标 Profile 已就绪：

```powershell
bun run verify:ui:status:debug
# 或附着普通开发应用
bun run verify:ui:status:dev
bun run verify:ui:attach:dev
```

不要凭记忆构造 Debug 输入。先发现能力并读取当前 Schema：

```powershell
bun run verify:ui:debug:debug -- search "" --category conversation
bun run verify:ui:debug:debug -- describe conversation.create
bun run verify:ui:debug:debug -- describe conversation.continue
bun run verify:ui:debug:debug -- describe conversation.answer
```

Debug Profile 在正式实验前还应执行精确模型的认证预检，并按
[Provider 请求观测](./vetta-debug.md#provider-请求观测) 启用独立 `runId`。`timeoutMs` 只是等待操作完成的上限，
不是模型输出 Token 限制；不传 `maxTokens` 才表示没有由 Vetta Debug 额外限制输出。

## 推荐实验设计

一次有效实验至少包含以下五个阶段，并始终通过同一个 `sessionPath` 继续会话：

1. **冷启动**：创建会话，记录首次 Provider 调用，但不把它纳入稳态命中率。
2. **工具循环**：要求模型创建、查询和更新 Todo，允许它自然决定是否调用其他工具。
3. **用户补充**：像正常用户一样回答 Ask User 或补充需求，观察历史追加后的缓存复用。
4. **状态核对**：要求模型读取 Todo 后再总结，检查工具状态和自然语言是否一致。
5. **稳态复测**：运行时没有重载后再继续一轮，确认同一轮后续调用恢复热缓存。

示例首轮 Prompt：

```text
请帮我规划一次将个人博客部署到生产环境的工作。先使用 Todo 工具建立包含需求核对、
构建验证、部署执行和回滚检查的任务清单，然后根据当前信息完成能够完成的规划。
缺少外部信息时保留为待办，不要臆造已经完成，最后自然地说明当前进展和下一步。
```

创建会话并保存返回的 `sessionPath`：

```powershell
bun run verify:ui:debug:debug -- run conversation.create `
  '{"cwd":"C:\\path\\to\\isolated-workspace","prompt":"<首轮 Prompt>","modelKey":"provider/model-id","timeoutMs":300000}'
```

继续会话时只提供正常用户会提供的新信息，不要重复整个历史：

```powershell
bun run verify:ui:debug:debug -- run conversation.continue `
  '{"sessionPath":"C:\\path\\to\\session.jsonl","prompt":"我决定使用 VitePress，并部署到 GitHub Pages。请据此更新计划。","timeoutMs":300000}'
```

遇到 `input_required` 时，使用返回的原始 `question` 和 `interactionId` 调用 `conversation.answer`。回答后继续等待
同一个 `operationId`，不要另建会话绕过交互。

## Todo 验证重点

Todo 测试不能只断言“模型调用过工具”。至少核对：

- `create`、`list`、`update`、`clear` 的成功和校验失败路径。
- Todo 在多轮 `conversation.continue` 之间是否保持相同状态。
- 模型文字中的“待办、进行中、完成”是否与 Todo Store 一致。
- 缺少外部证据时，模型是否保持待办而不是伪造完成。
- 用户指出不一致后，模型是否先 `list` 再纠正说明。

Todo Store 是状态事实源。模型自然语言只是解释层；UI 进度、完成数量和后续自动化不能从模型文字反向推断。
若模型首次提交了不符合 Schema 的参数，但工具拒绝后模型能够自行修正，应分别记录“边界校验有效”和
“Schema 可发现性不足”，不能把二者合并成工具执行成功。

## 缓存指标口径

Vetta 的归一化 Usage 中，`input`、`cacheRead`、`cacheWrite` 是互斥的 Prompt Token 桶。单次调用的读取命中率为：

```text
cacheRead / (input + cacheRead + cacheWrite)
```

输出 Token 不属于 Prompt 缓存分母。供应商未上报缓存细节时，`cacheUsageReporting` 会是 `unavailable`；此时
不能把 `cacheRead = 0` 当成真实未命中。

报告应拆成三类：

| 类别 | 定义 | 是否进入稳态命中率 |
|---|---|---|
| 冷启动 | 会话或 Provider 的首次调用 | 否，单独报告 |
| 稳态 | 前缀正常扩展，且没有环境重配置 | 是 |
| 失效 | Prompt、Tools、历史被改写，或运行时发生热更新 | 否，单独解释原因和成本 |

只给一个聚合命中率会掩盖问题：冷启动和一次前缀失效可能把长会话拉到 90% 以下，而其余调用实际上都在
99% 左右。反过来，只展示最佳热调用也会隐藏频繁失效。

## Prompt Cache 诊断

每个 Assistant Usage 中的 `promptCache` 用于解释“为什么命中或失效”：

| 字段 | 判读方式 |
|---|---|
| `prefixStatus: initial` | 没有上一条可比较诊断，通常是冷启动 |
| `prefixStatus: extended` 且 `changedSegments` 为空 | 旧消息保持前缀，新历史正常追加，是理想稳态 |
| `changedSegments: ["volatile-system"]` | 动态系统提示发生变化；继续检查模式、个性化和插件 Prompt Provider |
| `changedSegments: ["stable-system"]` | 稳定系统提示变化，通常会造成大范围缓存失效 |
| `changedSegments: ["tools"]` | 工具名称、描述或参数 Schema 变化 |
| `changedSegments: ["messages"]` | 旧消息不再是新请求的严格前缀，需检查压缩、重写或消息转换 |

不要要求 `cachePrefixHash` 在多轮间相等。正常追加历史会改变完整前缀哈希；正确条件是旧消息仍为新请求前缀、
稳定系统提示和 Tools 不变，并由真实 `cacheRead` 证明 Provider 确实复用了 Token。

哈希只能定位到段，不能证明段内具体哪个 Block 发生变化。需要精确定位时，使用隔离 Debug Profile 的
`payload`/`wire` 观测，或补充隐私安全的 Block 级长度和哈希诊断；不要仅凭时间接近就断言具体来源。

## 从会话文件读取 Usage

没有提前启用 Provider 观测时，持久化会话中的 Assistant Message 仍包含归一化 Usage 和 Prompt Cache 诊断，
足够计算命中率和定位变化段。会话文件只读分析，不要手工修改。

下面的 PowerShell 示例列出最近调用；路径应来自 `conversation.create` 或 `conversation.list`：

```powershell
$vettaSessionPath = "C:\path\to\session.jsonl"
$vettaEvents = Get-Content -LiteralPath $vettaSessionPath |
  ForEach-Object { $_ | ConvertFrom-Json -Depth 100 }

$vettaEvents |
  Where-Object {
    $_.event.type -eq "message.appended" -and
    $_.event.message.role -eq "assistant"
  } |
  ForEach-Object {
    $usage = $_.event.message.usage
    $promptTotal = $usage.input + $usage.cacheRead + $usage.cacheWrite
    [pscustomobject]@{
      Sequence = $_.sequence
      Input = $usage.input
      CacheRead = $usage.cacheRead
      CacheWrite = $usage.cacheWrite
      HitRate = if ($promptTotal -gt 0) { $usage.cacheRead / $promptTotal } else { 0 }
      PrefixStatus = $usage.promptCache.prefixStatus
      ChangedSegments = $usage.promptCache.changedSegments -join ","
    }
  } |
  Format-Table -AutoSize
```

不要把会话正文、`payload` 或 `wire` 内容粘贴到公开 Issue。共享结果时优先保留数字、哈希、长度、模型身份和
安全错误码，并去除本机用户名、绝对会话路径和业务 Prompt。

## Dev Profile 热更新干扰

一次实测中，22 次真实模型调用包含 14 次 Todo 调用、2 次目录检查和 1 次 Ask User。原始聚合命中率是
86.24%，但剔除首次冷调用和两次开发环境重载引起的失效调用后，19 次稳态调用的命中率为 99.477%。

两次失效具有不同证据：

1. Main 日志先出现多次 `runtime reconfigure requested` / `deferred until prompt` / `apply`，下一轮首调用的
   `changedSegments` 为 `volatile-system`，读取命中率降到 3.16%；同轮下一调用恢复到 99.61%。
2. 运行时重载后 Tools 哈希变化，下一轮首调用标记为 `changedSegments: ["tools"]`，命中率为 10.21%；
   同轮下一调用恢复到 99.75%。

这组数据证明 Todo 调用本身没有破坏前缀；连续 Todo 创建、查询和更新期间，大部分调用保持 98% 至 99.7%。
整体低命中来自冷启动与开发环境重配置。

在 Dev Profile 中遇到异常低命中时：

1. 把 Provider 调用时间转换为本地时间。
2. 对照 `<VETTA_HOME>/desktop-app/logs/main/<date>.log` 和 Renderer 日志。
3. 搜索 `runtime reconfigure`、插件 `activationId`、Main/Preload 重启和 Vite HMR。
4. 比较 `stableSystemPromptHash`、`volatileSystemPromptHash`、`toolsHash` 和长度。
5. 环境稳定后继续同一会话复测；若下一调用恢复高命中，将前一调用归为失效样本。

正式基准期间应冻结代码修改和插件配置，关闭不相关的演示插件及动态 Prompt Provider。必须保留动态 Provider
时，记录其启用状态和贡献哈希，使“预期动态变化”与回归能够区分。

## 一次实验应记录什么

- Git revision、工作区是否有并行修改，以及测试时间窗口。
- Profile、模型精确 `modelKey`、推理级别和 Provider 观测 `runId`。
- 会话轮数、模型调用数、工具调用数与各工具 Action。
- 冷启动、稳态、失效三类的 Token、命中率、输出和成本。
- 每个失效调用的 `changedSegments`、相关哈希和长度变化。
- 同时间窗口的 HMR、插件激活、Runtime 重配置或会话压缩日志。
- Todo 最终事实状态，以及模型文字是否与其一致。
- 是否设置输出限制；`timeoutMs` 不能记录成输出限制。

## 验收标准

- 真实 Provider 预检通过，`cacheUsageReporting` 不是 `unavailable`。
- 至少一轮冷启动和两轮无环境重载的稳态样本。
- 稳态调用为 `extended`、`changedSegments` 为空，读取命中率达到目标阈值。
- Todo 工具状态跨轮保持，失败输入被拒绝，最终状态与 UI 和模型总结一致。
- 所有异常低命中都有 Prompt 诊断或运行时日志证据，未把猜测写成根因。
- 报告区分冷启动、稳态和失效，不用单一聚合数字代替分析。
- 实验没有泄露凭据、会话正文或未脱敏的 Provider payload。

