# 如何本地复验 Claude Hook 适配

## A. 最快路径：单元测试

```powershell
cd C:\develop\yiyun\vetta-mono\packages\ecosystem-adapter
bun run build
bunx vitest --run test/claude-hooks.test.ts
```

期望：`10 passed`。

## B. Desktop + fixture 烟雾

### 1. 启动

```powershell
cd C:\develop\yiyun\vetta-mono\apps\desktop
bun dev
```

### 2. 确认 Debug / CDP

```powershell
cd C:\develop\yiyun\vetta-mono
bun apps/cli-host/src/cli.ts debug run ui.info
```

### 3. SessionStart

```powershell
$payload = @{
  cwd = "C:\develop\yiyun\vetta-mono\docs\adapter\claude\fixtures\hook-smoke"
  prompt = "ClaudeHook验收。只回复：session hooks ok。不要调用工具。"
  executionMode = "full-access"   # win32 sandbox 不可用时
  timeoutMs = 180000
} | ConvertTo-Json -Compress

bun apps/cli-host/src/cli.ts debug run conversation.create $payload
```

保存返回的 `sessionPath`。

### 4. 查日志

```powershell
Select-String -Path "$env:USERPROFILE\.vetta\desktop\logs\main\*.log" `
  -Pattern "claude handlers loaded|ecosystem-hooks\] dispatch" |
  Select-Object -Last 20
```

期望看到 `profile: 'claude-code-hooks/2.1.211'` 与 `SessionStart` `statuses: [ 'Completed' ]`。

### 5. UserPromptSubmit block

```powershell
$payload = @{
  sessionPath = "<上一步 sessionPath>"
  prompt = "/cdt plan demo"
  executionMode = "full-access"
  timeoutMs = 60000
} | ConvertTo-Json -Compress

bun apps/cli-host/src/cli.ts debug run conversation.continue $payload
```

期望：`ok:false`，message 含 `Agent Teams`。

### 6. PreToolUse deny

提示模型写文件；期望回复引用 `Write blocked by Claude PreToolUse fixture`，且项目目录不出现目标文件。

## C. 加载原始 cc-skills hooks（不执行 .sh）

```powershell
bun -e "
import { discoverClaudeHookHandlers } from './packages/ecosystem-adapter/src/claude-code/hooks/config.ts';
import { join } from 'node:path';
const root = 'C:/develop/github/cc-skills/plugins/council';
const r = await discoverClaudeHookHandlers([{
  directory: root,
  enabled: true,
  sources: [{
    path: join(root, 'hooks/hooks.json'),
    env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: root },
    pluginId: 'council',
    profileId: 'claude-code-hooks/2.1.211',
  }],
}], { projectDir: root });
console.log(r);
"
```

期望：1 个 SessionStart handler，command 已展开，`diagnostics: []`。

若要在 Windows 原样执行 `.sh`，先安装 Git Bash 或设置：

```powershell
$env:VETTA_BASH = "C:\Program Files\Git\bin\bash.exe"
```

并保证 `jq` 等脚本依赖在 Bash PATH 中。

## D. 项目内启用自定义 Claude Hook

在任意项目：

```text
<project>/.vetta/claude-hooks.json
```

写入与 fixture 相同结构的 hooks，重新开会话即可。不要写入 `.vetta/hooks.json`（那是 Codex profile）。

## E. Playwright（可选 UI）

```powershell
playwright-cli -s=vetta attach --cdp=http://127.0.0.1:9223
playwright-cli -s=vetta tab-list
# 选择 Title=Vetta Desktop 的 tab
playwright-cli -s=vetta tab-select <n>
playwright-cli -s=vetta snapshot
playwright-cli -s=vetta detach
```

定位失败时对照 `apps/desktop/src/renderer` 源码，不要只猜 aria/selector。
