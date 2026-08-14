export const KB_FILTER_BY_TAGS_TOOL_DESCRIPTION = `Filter knowledge base wiki pages by their tags, using set algebra.

- all: intersection — page must contain ALL of these tags (AND)
- any: union — page must contain AT LEAST ONE of these tags (OR)
- none: complement — page must contain NONE of these tags (NOT), relative to the whole base

The three clauses combine with AND. An omitted/empty clause adds no constraint; an empty query returns all live pages. Orphaned pages are excluded. Returns each matched page's id, absolute file path, title and summary so you can drill down. Pass the absolute path directly to the read tool. If you don't know which tags exist, call kb_list_available_tags first.

This is a convenience shortcut for multi-dimensional retrieval, NOT the only path. You can also navigate the curated maps under indexes/, or progressively explore the wiki/ tree (read pages, follow [[page-id]] links, grep full text).`;
