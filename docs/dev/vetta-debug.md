# Vetta Debug

Vetta Debug 是开发环境专用的会话能力，用于从外层 Agent 驱动真实 Vetta Agent，完成创建会话、继续会话、处理 Ask User、等待结果和中止操作。

它与 Vetta Action 共用本地 RPC 服务，但能力目录相互独立。打包环境不注册 Debug runtime，调用时会返回 `DEBUG_NOT_AVAILABLE`。

## 运行环境

在仓库根目录启动持久 Debug Profile：

```powershell
bun run verify:ui:start:debug
```

等待实例就绪：

```powershell
bun run verify:ui:status:debug
```

开始调用 Debug 前，状态必须满足：

- `running === true`
- `ready === true`
- `ui.reachable === true`
- `ui.targetFound === true`

Debug Profile 使用当前工作树独立且持久的 Vetta home、Electron user-data、RPC endpoint 和 CDP endpoint，不与普通开发实例共用运行状态。首次启动从 `.vetta-dev` 白名单播种模型配置；具体边界见 [Desktop UI 验证](./README.md#验证-profile)。

所有 Debug CLI 调用统一经过仓库入口：

```powershell
bun run verify:ui:debug:debug -- <debug 参数>
```

修改 Renderer 后通常由 Vite HMR 更新。修改 Main 或 Preload 后，需要停止并重新启动验证实例：

```powershell
bun run verify:ui:stop:debug
bun run verify:ui:start:debug
```

## 标识和生命周期

| 标识 | 生命周期 | 用途 |
|---|---|---|
| `sessionId` | 当前 Desktop runtime 中的已打开会话 | 标识运行时会话 |
| `sessionPath` | 持久化 | 重新打开并继续会话 |
| `operationId` | 当前开发进程内，终态后保留约 30 分钟 | 回答、等待或中止一次 `create` / `continue` 操作 |

验证实例重启后，旧 `operationId` 会失效。使用已保存的 `sessionPath` 调用 `conversation.continue` 可以继续持久化会话。

## 发现和调用能力

先搜索能力，再读取具体输入契约：

```powershell
bun run verify:ui:debug -- search "" --category conversation
bun run verify:ui:debug -- describe conversation.create
bun run verify:ui:debug -- describe conversation.answer
```

执行能力：

```powershell
bun run verify:ui:debug -- run <debug-id> '<json-input>'
```

CLI stdout 返回一个 JSON 对象：

```json
{"ok":true,"result":{}}
```

或者：

```json
{"ok":false,"error":{"code":"...","message":"..."}}
```

调用方必须先判断顶层 `ok`，再读取 `result`。输入 schema 为严格模式，多余字段会导致 `DEBUG_INVALID_INPUT`。

## 会话能力

| 能力 | 必填输入 | 作用 |
|---|---|---|
| `conversation.list` | `cwd` | 列出项目的持久化普通会话 |
| `conversation.create` | `cwd`、`prompt` | 创建可见会话并执行首轮 Agent |
| `conversation.continue` | `sessionPath`、`prompt` | 继续已有会话并执行下一轮 Agent |
| `conversation.answer` | `operationId`、`interactionId`、答案 | 回答当前 Ask User 并继续等待 |
| `conversation.wait` | `operationId` | 等待下一次可报告状态 |
| `conversation.abort` | `operationId` | 中止运行中或等待回答的操作 |

`conversation.create` 和 `conversation.continue` 支持以下可选参数：

| 参数 | 含义 |
|---|---|
| `executionMode` | `sandbox` 或 `full-access`，默认 `sandbox` |
| `modelKey` | 指定已配置的模型；省略时使用 Desktop 默认模型 |
| `reasoning` | 模型支持的推理级别 |
| `timeoutMs` | 1,000 至 1,800,000 毫秒，默认 600,000 毫秒 |

## 创建和继续会话

创建会话：

```powershell
bun run verify:ui:debug -- run conversation.create '{"cwd":"C:\\develop\\my-project","prompt":"检查当前实现，完成目标功能并运行相关验证。"}'
```

完成结果包含：

```json
{
  "operationId": "...",
  "sessionId": "...",
  "sessionPath": "...jsonl",
  "cwd": "...",
  "status": "completed",
  "stopReason": "stop",
  "assistantText": "...",
  "messageCount": 4
}
```

保存 `sessionPath`。验证失败时继续同一个会话：

```powershell
bun run verify:ui:debug -- run conversation.continue '{"sessionPath":"C:\\path\\to\\session.jsonl","prompt":"实际验证仍然失败。请根据以下证据修复并重新验证：..."}'
```

需要重新查找会话时使用：

```powershell
bun run verify:ui:debug -- run conversation.list '{"cwd":"C:\\develop\\my-project","limit":20}'
```

不要手工猜测 `sessionPath`，应从 `create` 返回值或 `conversation.list` 获取。

## 处理 Ask User

内层 Agent 调用 Ask User 时，`create`、`continue`、`answer` 或 `wait` 返回 `input_required`：

```json
{
  "status": "input_required",
  "operationId": "...",
  "sessionId": "...",
  "sessionPath": "...jsonl",
  "interaction": {
    "id": "...",
    "type": "ask_user_question",
    "questions": [
      {
        "question": "采用哪种兼容方案？",
        "header": "实现方案",
        "multiSelect": false,
        "options": [
          { "label": "共享适配层", "description": "复用现有运行时" },
          { "label": "独立实现", "description": "维护单独链路" }
        ]
      }
    ]
  }
}
```

回答问题：

```powershell
bun run verify:ui:debug -- run conversation.answer '{"operationId":"...","interactionId":"...","answers":[{"question":"采用哪种兼容方案？","answers":["共享适配层"]}]}'
```

规则：

- 原样使用返回的 `question` 文本。
- 每个问题恰好提供一项答案。
- 多选题将多个选项放在同一个 `answers` 数组中。
- 问题组为每个问题分别提供一项。
- 根据需求、代码现状和风险选择答案，不默认选择第一个选项。

取消当前问题：

```powershell
bun run verify:ui:debug -- run conversation.answer '{"operationId":"...","interactionId":"...","cancelled":true}'
```

取消问题不会中止整个 Agent 回合。需要停止操作时使用 `conversation.abort`。

用户和外层 Agent 都可以回答 Renderer 中的同一个问题，先完成的答案生效。如果调用返回 `DEBUG_INTERACTION_NOT_PENDING`，说明问题已经得到处理，应使用 `conversation.wait` 获取后续状态。

## 等待和中止

等待操作状态：

```powershell
bun run verify:ui:debug -- run conversation.wait '{"operationId":"..."}'
```

可能返回：

- `completed`：本轮完成
- `input_required`：需要回答问题
- `aborted`：操作已中止
- 错误：操作失败或等待被取消

中止操作：

```powershell
bun run verify:ui:debug -- run conversation.abort '{"operationId":"..."}'
```

中止不会删除持久化会话，之后仍可通过 `sessionPath` 发起新的 `conversation.continue`。

## Agent 闭环

1. 使用 `search` 和 `describe` 确认能力及输入。
2. 调用 `conversation.create`，保存 `sessionPath` 和 `operationId`。
3. 收到 `input_required` 时，分析全部问题并调用 `conversation.answer`。
4. 调用断开但 `operationId` 仍有效时，使用 `conversation.wait` 恢复查询。
5. 收到 `completed` 后，独立检查 diff、日志、产物和目标功能。
6. 验证失败时，通过相同 `sessionPath` 调用 `conversation.continue`。
7. 无法安全继续时调用 `conversation.abort`，并报告具体阻塞条件。

`completed` 只表示 Agent 回合结束，不表示功能已经验收通过。

## Prompt 要求

用于闭环开发的 Prompt 应包含：

- 明确目标
- 允许修改的范围
- 可观察的成功标准
- 要运行的检查或复现场景
- 禁止的命令、权限和无关改动
- 遇到会改变方案的歧义时调用 Ask User

推荐格式：

```text
目标：<明确目标>
范围：<允许修改的模块或文件>
成功标准：
- <可观察结果 1>
- <可观察结果 2>

要求：
1. 阅读项目规则和现有实现；
2. 先定义可验证条件，再修改代码；
3. 修改后运行与风险匹配的验证；
4. 保留无关改动，不做顺手重构；
5. 存在会显著改变方案的歧义时调用 Ask User；
6. 最终报告修改文件、验证命令、结果和限制。
```

## 安全约束

- 默认使用 `sandbox`，不要因环境失败自动升级为 `full-access`。
- 只有用户明确授权且目标与验证命令可信时才使用 `full-access`。
- Prompt 不得扩大用户授权范围。
- 不读取、打印、提交或分享本地 RPC endpoint 文件中的 token。
- Prompt、工具调用和结果会进入持久化会话历史，不要写入密钥。
- 不允许内层 Agent 未经授权提交、推送或执行破坏性命令。

## 错误处理

| 错误码 | 处理方式 |
|---|---|
| `LOCAL_RPC_SERVER_NOT_FOUND` | 运行 `verify:ui:status`；未启动时在后台运行 `verify:ui:start` |
| `LOCAL_RPC_SERVER_UNREACHABLE` | 停止并重新启动验证实例，再次检查 `verify:ui:status` |
| `DEBUG_NOT_AVAILABLE` | 确认连接的是仓库启动的开发验证实例 |
| `DEBUG_NOT_FOUND` | 重新执行 `debug search`，确认能力 ID |
| `DEBUG_INVALID_INPUT` | 执行 `debug describe`，按 schema 修正输入 |
| `DEBUG_SESSION_BUSY` | 对现有 `operationId` 执行 `wait` 或 `abort`，不要并发 continue |
| `DEBUG_SESSION_LOCKED` | 结束占用该会话的运行时后重试，不直接修改 JSONL |
| `DEBUG_OPERATION_NOT_FOUND` | 使用 `sessionPath` 发起新的 `conversation.continue` |
| `DEBUG_INTERACTION_NOT_PENDING` | 使用 `conversation.wait` 获取后续状态，不重复回答 |
| `DEBUG_CONVERSATION_TIMEOUT` | 检查工具、网络和权限状态，调整超时或中止操作 |
| `DEBUG_CONVERSATION_FAILED` | 保留错误证据，修复环境后通过 `sessionPath` 继续 |

## 验收条件

- 会话出现在预期项目的普通会话列表中。
- `create` 或 `continue` 到达明确终态。
- 所有 `input_required` 都已回答或取消。
- 代码修改与任务范围一致。
- 执行了功能级验证，而不只是格式或类型检查。
- 验证失败时使用相同 `sessionPath` 继续修正。
- 最终结果包含可复查的命令、日志、产物或行为证据。
- 没有未经授权的提交、推送或权限扩大。
