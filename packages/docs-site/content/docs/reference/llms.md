---
title: LLM 文档入口
description: 获取适合 Agent 发现、检索和一次性读取的 Markdown 文档。
---

本站从同一份 MDX 内容生成面向人类和 LLM 的输出，不单独维护容易失效的文本副本。

## 可用端点

- `/llms.txt`：精简索引，包含站点说明、页面链接和摘要，适合先发现相关文档。
- `/llms-full.txt`：把全部公开页面合并为一个 Markdown 文档，适合上下文窗口足够时一次读取。
- `/<页面路径>.md`：单页 Markdown，例如 `/product/models.md`，适合按需获取最小上下文。

建议 Agent 先读取 `/llms.txt`，根据任务选择少量单页 Markdown；只有确实需要跨主题全量检索时才读取 `/llms-full.txt`。

`llms.txt` 遵循 llms.txt 社区提案的 Markdown 结构，并由 Fumadocs 页面树和 frontmatter 描述生成。页面新增、删除或改名后，重新构建站点即可同步所有 LLM 入口。
