# 应用内可见会话复测（2026-07-18）

## 问题纠正

上一轮 `conversation.create` 的 `cwd` 指向：

```text
docs/adapter/claude/fixtures/hook-smoke
```

该路径不在 `desktop-config.projects` 中，侧边栏不会出现对应项目，因此用户在应用里“看不到会话”。

会话仍落在 `~/.astravia/agent/sessions/<encoded-cwd>/`，但这是**所有** Desktop/Agent 会话的统一存储，不是旁路存储。

## 本次正确做法

| 项 | 值 |
| --- | --- |
| 项目 cwd | `C:\develop\yiyun\astravia-mono`（已在侧边栏 projects） |
| Hook 配置 | `C:\develop\yiyun\astravia-mono\.astravia\claude-hooks.json` |
| 脚本 | `.astravia/claude-hooks/*.cjs` |
| sessionPath | `~\.astravia\agent\sessions\--C--develop-yiyun-astravia-mono--\2026-07-18T06-46-25-367Z_7948ddee-....jsonl` |
| 自动标题 | `ClaudeHook UI可` |

## 结果

### Debug / 日志

1. **SessionStart**：`claude handlers loaded` total=3；dispatch SessionStart Completed  
2. **UserPromptSubmit `/cdt`**：`DEBUG_CONVERSATION_FAILED`，文案含 `CDT requires Agent Teams (UI-visible project fixture)`  
3. **PreToolUse Write**：助手引用 `Write blocked by Claude PreToolUse (UI-visible project fixture)`；`claude-hook-ui-write-test.txt` 不存在  
4. **conversation.list** 对 `cwd=astravia-mono` 首条即为本会话  

### 应用 UI（Playwright）

进入 `#/project/.../astravia-mono` 后侧栏可见：

```text
astravia-mono
ClaudeHook UI可
2 分钟
Playwright闭环验收
...
```

`hasClaude: true`。此前停在 `#/new-session/...` 时，侧栏默认展开的是「对话」分区会话，容易误以为 astravia-mono 下没有新会话；点开 **astravia-mono 项目** 后即可看到。

## 本地查看方式

1. 打开 Astravia Desktop  
2. 侧边栏点 **astravia-mono**  
3. 点会话 **ClaudeHook UI可**  
4. 应看到首轮 `session hooks ok` 与后续 Write 拒绝说明  

## 清理说明

- 验收用的 `.astravia/claude-hooks.json` 与 `.astravia/claude-hooks/*.cjs` 目前在 monorepo 根目录，**未 gitignore**，会显示为 untracked  
- 若不希望仓库出现这些本地文件：删除 `C:\develop\yiyun\astravia-mono\.astravia\`，或把 `.astravia/` 加入 gitignore  
- 文档向 fixture 仍在 `docs/adapter/claude/fixtures/hook-smoke/`（可提交）  
