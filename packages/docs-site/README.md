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

## LLM 入口

- `/llms.txt`：文档索引，适合 Agent 发现页面。
- `/llms-full.txt`：合并后的完整文档，适合一次性获取上下文。
- `/*.md`：对应文档页的纯 Markdown，例如 `/product/models.md`。

这些内容由 `content/docs/` 构建生成，不单独维护副本。

## 部署

将部署项目的根目录设为 `packages/docs-site`，构建命令使用 `bun run build`，启动命令使用
`bun run preview`。默认站点地址为 `https://docs.openvetta.com`；其他环境可通过
`DOCS_SITE_URL` 覆盖，用于生成 canonical URL。
