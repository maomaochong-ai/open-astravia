---
title: LLM documentation entry points
description: Get Markdown documents for Agent discovery, targeted retrieval, and full-context reads.
---

The site generates human and LLM outputs from the same MDX content. It does not maintain a separate text copy that can drift out of date.

## Available endpoints

- `/llms.txt`: a compact index with the site description, page links, and summaries for discovery.
- `/llms-full.txt`: all public pages merged into one Markdown document when the context window is large enough.
- `/<page-path>.md`: one page as Markdown, such as `/product/models.md`, for the smallest useful context.

Agents should start with `/llms.txt`, select a small number of page Markdown files, and use `/llms-full.txt` only when cross-topic retrieval really requires the complete corpus.

`llms.txt` follows the community proposal's Markdown structure and is generated from the Fumadocs page tree and frontmatter. Adding, removing, or renaming a page updates all LLM entry points on the next site build.
