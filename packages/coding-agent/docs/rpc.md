# RPC 模式

子进程通过 **stdin/stdout 逐行 JSON** 驱动单会话。类型权威源：`src/modes/rpc/rpc-types.ts`。TS 客户端：`src/modes/rpc/rpc-client.ts`；公开导出：`@vetta/coding-agent/rpc`。

同进程嵌入请用 [sdk.md](sdk.md)，不要走子进程。

## 启动

```bash
vetta --mode rpc [options]
```

常用：`--provider` / `--model` / `--session` / `--session-dir` / `--continue` / `--no-session` / `--enable-host-bridge` / `--memory-mode`。

- 工作目录 = 进程 cwd（无运行时改 cwd 命令）。
- 默认会话目录：`~/.vetta/agent/sessions/<safe-cwd>/`。
- **一进程一活动会话**；同文件禁止多 writer。
- 旧 JSONL v1–v3 会非破坏导入为 V2 conversation 后再恢复。

## 帧约定

| 方向 | 形状 |
|------|------|
| 命令 (stdin) | `{ id?, type, ... }` |
| 成功 (stdout) | `{ id?, type: "response", command, success: true, data? }` |
| 失败 (stdout) | `{ id?, type: "response", command, success: false, error, ... }` |
| 事件 (stdout) | agent / turn / message / tool / compaction / retry 等 |

`id` 可选，用于请求响应关联。

## 命令（`type`）

| 组 | `type` |
|----|--------|
| 提示 | `prompt`, `steer`, `follow_up`, `abort`, `new_session` |
| 状态 | `get_state`, `get_session_stats`, `get_messages`, `get_commands` |
| 模型 | `set_model`, `cycle_model`, `get_available_models` |
| 思考 | `set_thinking_level`, `cycle_thinking_level` |
| 队列 | `set_steering_mode`, `set_follow_up_mode` |
| 压缩 | `compact`, `set_auto_compaction` |
| 重试 | `set_auto_retry`, `abort_retry` |
| Shell | `bash`, `abort_bash` |
| 会话 | `switch_session`, `fork`, `get_fork_messages`, `get_last_assistant_text`, `set_session_name`, `export_html` |
| Memory | `flush_memory`（需 `--memory-mode`） |

字段与响应 `data` 见 `RpcCommand` / `RpcResponse`。

## 会话事件

与 Session 订阅同源：`agent_start` / `agent_end`、`turn_*`、`message_*`、`tool_execution_*`、`auto_compaction_*`、`auto_retry_*`、`extension_error` 等。流式正文在 `message_update.assistantMessageEvent`。

## Extension UI（可选）

扩展需要确认/选择时 stdout 发 `extension_ui_request`，宿主 stdin 回 `extension_ui_response`。形状见 `RpcExtensionUIRequest` / `RpcExtensionUIResponse`。无 UI 宿主可忽略或默认取消。

## Host Bridge（`--enable-host-bridge`）

agent → host 反向调用（如 IM 发附件）：

- stdout：`host_request`（`method: "send_attachment"`）
- stdin：`host_response`

见 `RpcHostRequest` / `RpcHostResponse`。

## 参考

- 命令分发：`src/modes/rpc/rpc-command-dispatcher.ts`
- 模式入口：`src/modes/rpc/rpc-mode.ts`
- im-gateway / desktop 以本协议驱动子进程
