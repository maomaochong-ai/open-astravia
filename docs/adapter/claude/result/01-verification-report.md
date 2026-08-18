# 验证报告

## 1. 单元测试

命令：

```powershell
cd packages/ecosystem-adapter
bunx vitest --run test/claude-hooks.test.ts
```

结果：**10/10 通过**

覆盖：

- `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` 展开（含空格路径）
- 工具名映射：`bash→Bash`、`write→Write`、`edit→Edit`、`spawn_agent→Agent`、`TeamCreate` 透传
- `claude-hooks.json` 发现
- 原样 `hooks/hooks.json` + `CLAUDE_PLUGIN_ROOT` 展开
- unsupported event / handler 诊断
- SessionStart context
- UserPromptSubmit block
- PreToolUse deny + matcher 隔离
- Stop block + `stop_hook_active` 第二次放行

## 2. Desktop 真机会话（vetta debug）

前置：

```powershell
cd apps/desktop-app
bun dev
# 另开终端
bun apps/cli-app/src/cli.ts debug run ui.info
```

`ui.info` 结果：`configured/reachable/targetFound = true`，endpoint `http://127.0.0.1:9223`。

### 2.1 SessionStart

```powershell
$payload = @{
  cwd = "C:\develop\yiyun\vetta-mono\docs\adapter\claude\fixtures\hook-smoke"
  prompt = "ClaudeHook验收 20260718-SESSION-START。只回复：session hooks ok。不要调用工具。"
  executionMode = "full-access"
  timeoutMs = 180000
} | ConvertTo-Json -Compress

bun apps/cli-app/src/cli.ts debug run conversation.create $payload
```

结果：

- `status: completed`
- `assistantText: session hooks ok`
- 主进程日志 `~/.vetta/desktop-app/logs/main/2026-07-18.log`：

```text
[ecosystem-hooks] claude handlers loaded {
  profile: 'claude-code-hooks/2.1.211',
  total: 3,
  byEvent: { SessionStart: 1, UserPromptSubmit: 1, PreToolUse: 1 },
  sources: [
    '...\\.vetta\\agent/claude-hooks.json',
    '...\\fixtures\\hook-smoke\\.vetta/claude-hooks.json'
  ]
}
[ecosystem-hooks] dispatch {
  event: 'SessionStart',
  handlers: 1,
  statuses: [ 'Completed' ],
  contexts: 1
}
```

### 2.2 UserPromptSubmit（模拟 cdt 阻断）

```powershell
bun apps/cli-app/src/cli.ts debug run conversation.continue '{
  "sessionPath":"<上一轮 sessionPath>",
  "prompt":"/cdt plan implement auth",
  "executionMode":"full-access",
  "timeoutMs":60000
}'
```

结果：

```json
{
  "ok": false,
  "error": {
    "code": "DEBUG_CONVERSATION_FAILED",
    "message": "CDT requires Agent Teams. Add CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (fixture; Teams not supported in Vetta yet)."
  }
}
```

与 fixture `block-cdt.cjs` / 上游 `block-cdt-without-teams.sh` 语义一致：**未进入模型循环，提示词被拦截**。

### 2.3 PreToolUse Write deny

```powershell
bun apps/cli-app/src/cli.ts debug run conversation.continue '{
  "sessionPath":"<同一 sessionPath>",
  "prompt":"请用 write 工具创建 hook-write-test.txt ...",
  "executionMode":"full-access",
  "timeoutMs":180000
}'
```

结果：

- `assistantText` 包含：`Write blocked by Claude PreToolUse fixture`
- 磁盘上 **不存在** `hook-write-test.txt`
- 日志：

```text
[ecosystem-hooks] pre-tool blocked {
  tool: 'write',
  reason: 'Write blocked by Claude PreToolUse fixture'
}
```

## 3. cc-skills 原样 hooks.json 加载

对本地 `C:\develop\github\cc-skills`：

| 插件 | handlers 数量 | 备注 |
| --- | ---: | --- |
| `council` | 1 | SessionStart → preflight.sh |
| `cdt` | 9 | SessionStart / UserPromptSubmit / PreToolUse×5 / Stop×2 |

`${CLAUDE_PLUGIN_ROOT}` 均已展开为绝对路径，diagnostics 为空。

## 4. Playwright

已确认 CDP attach 可连到 Electron。主窗口 tab 列表中有 `Vetta Desktop`。

本轮业务正确性以 **debug RPC + 主进程日志 + 副作用（文件未写出）** 为准；Playwright 仅作辅助，不作为 Hook 协议通过与否的唯一条件。

## 5. 环境注意

- 本机 `sandbox` 在 win32 不可用，会话测试使用 `full-access`。
- 本机无 Git Bash；`.sh` 不会被 `cmd.exe` 执行，会报明确的 Bash missing 错误（见矩阵文档）。
