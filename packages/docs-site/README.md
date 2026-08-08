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

## 部署

将部署项目的根目录设为 `packages/docs-site`，构建命令使用 `bun run build`，启动命令使用
`bun run preview`。默认站点地址为 `https://docs.openvetta.com`；其他环境可通过
`DOCS_SITE_URL` 覆盖，用于生成 canonical URL。
