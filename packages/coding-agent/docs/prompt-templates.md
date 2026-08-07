# Prompt Templates

Markdown 片段，以 `/文件名` 展开为完整提示。

## 位置

- 全局：`~/.vetta/agent/prompts/*.md`
- 项目：`<cwd>/.vetta/prompts/*.md`
- 包 / settings `prompts` / CLI `--prompt-template`
- `--no-prompt-templates` 关闭发现

`prompts/` 目录 **不递归**；子目录需在 settings 或包清单中显式声明。

## 格式

```markdown
---
description: 审查暂存改动
---
Review staged changes (`git diff --cached`). Focus on bugs and security.
```

- 文件名（无 `.md`）即命令名：`review.md` → `/review`
- `description` 可选；缺省用首个非空行

## 参数

| 占位 | 含义 |
|------|------|
| `$1`, `$2`, … | 位置参数 |
| `$@` / `$ARGUMENTS` | 全部参数 |
| `${@:N}` | 从第 N 个起 |
| `${@:N:L}` | 从 N 起取 L 个 |

实现与发现：`src/resources/`。
