export const KB_WRITE_PAGE_TOOL_DESCRIPTION = `Write (create or update) a single wiki page in the LLM knowledge base at ~/.vetta/knowledges/.

This is the ONLY way to write wiki pages. It enforces the closed frontmatter schema (exactly: id, source, source_path, source_hash, tags, title, summary, created_at, updated_at, orphaned_at), assigns a stable page id, and refreshes the tags.json / manifest.json caches automatically. Do not hand-write wiki .md files with the generic write tool.

Upsert semantics:
- Provide \`id\` to update an existing page in place. The page keeps its id and created_at; updated_at is refreshed. Use this when reprocessing a changed source file (the poller resolves the old id for you).
- Omit \`id\`: if a page with the same \`source_hash\` already exists it is updated; otherwise a new page is created with a freshly assigned id.

Tree placement: \`path\` is relative to wiki/ and you choose it by topic/semantics (e.g. "产品/计费.md"), not by mirroring the raws layout. Updating an existing page with a different \`path\` moves it within the wiki tree (old file removed).

Cross-page references: put them in the body as [[page-id]] — never in frontmatter.

raw↔wiki is 1:1. One source raw file maps to exactly one wiki page.`;
