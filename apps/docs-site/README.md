# Vetta Docs Site

Vetta 的公开产品与开发者文档站，使用 Next.js 和 Fumadocs 构建。

## 内容边界

- `content/docs/` 只存放确认可以公开的产品、插件和 SDK 文档。
- 仓库根目录的 `docs/`、ADR、部署和内部验证记录不会被自动加载。
- 公开内容以本站目录为唯一来源，避免与内部文档长期维护两份副本。

## 本地检查

```bash
bun run check
bun run build
```

Fumadocs 搜索索引由站点内容生成，因此需要通过构建后的站点验证搜索。

## 覆盖维护

`docs-coverage.json` 把公开产品领域映射到实现事实源和文档页面。新增或调整公开路由、设置、权限、协议或包导出时，必须同步核对对应领域：

- `complete`：核心概念、任务步骤、状态、验收和恢复均已覆盖。
- `partial`：已有入口说明，但缺少完整任务或参考合同。
- `internal-only`：有内部资料，但不属于公开站点范围。
- `not-applicable`：确认不需要独立公开页面。

页面示例只使用公开包入口。可执行代码的签名以 `package.json#exports` 和类型定义为准，不能从内部文档复制后长期脱离实现。

## SEO 与发现入口

站点在构建时生成面向搜索引擎和社交平台的元数据，不单独维护页面副本：

- `/robots.txt`：允许搜索与 AI 检索爬虫，并声明 sitemap。
- `/sitemap.xml`：收录全部公开文档页；`lastmod` 取自内容文件的 Git 提交时间。
- 每页 `canonical`、Open Graph、Twitter Card，以及 `application/ld+json`（Organization、SoftwareApplication、WebSite、WebPage/TechArticle、BreadcrumbList）。
- 文档页另提供 `text/markdown` alternate，例如 `/product/models.md`。

## LLM 入口

- `/llms.txt`：文档索引，适合 Agent 发现页面。
- `/llms-full.txt`：合并后的完整文档，适合一次性获取上下文。
- `/*.md`：对应文档页的纯 Markdown，例如 `/product/models.md`。

这些内容由 `content/docs/` 构建生成，不单独维护副本。

## 部署

公开站点由 Vercel Git 集成自动发布，不必再跑 `vercel deploy`。

- 项目：`vetta-docs`，Root Directory 为 `apps/docs-site`
- 生产分支：`dev` → https://vetta-docs.vercel.app
- PR 与其他分支：Preview 部署
- 是否跳过未受影响的提交由 Vercel 项目自身的 monorepo 检测负责；不要添加依赖 Git 历史的 `ignoreCommand`，因为上传阶段会排除 `.git`

GitHub Actions [`.github/workflows/docs-site.yml`](../../.github/workflows/docs-site.yml) 在同样的路径变更上跑 typecheck、测试和 `next build`，不重复执行 `vercel deploy`。

默认 canonical 为 `https://docs.openvetta.com`；其他环境可通过 `DOCS_SITE_URL` 覆盖。

仓库根 [`.vercelignore`](../../.vercelignore) 会作用于整个 Vercel 上传。顶层目录规则必须以 `/` 锚定，尤其不能使用未锚定的 `docs`：它会同时排除 `apps/docs-site/content/docs`，使构建表面成功但 sitemap、LLM 索引和全部文档路由为空。部署合同由 `test/deployment.test.ts` 守护。
