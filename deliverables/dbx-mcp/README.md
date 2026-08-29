# deliverables/dbx-mcp

## 这是什么

`dbx-mcp-astravia.yml` 是 **dbx-mcp 的 Astravia 自有构建工作流**（GitHub Actions，多平台矩阵：Windows x64 / macOS arm64 / macOS x64）。

它不属于本仓库（astravia）自身的 CI——本仓库的 `.github/workflows/` 只放 astravia 自己的流水线。这份文件是要**交付到另一个仓库**使用的：

- 目标仓库：fork `sikongyue/dbx`
- 部署位置：`sikongyue/dbx` 的 `.github/workflows/dbx-mcp-astravia.yml`（替换其既有 Windows-only 版本）
- 触发方式：推送到 fork 的 `main`（push 到该 workflow 路径）或手动 `workflow_dispatch`
- 产物：构建 dbx-mcp 二进制并发布到 fork 的 Release（tag `dbx-mcp-astravia-v<ver>`）

## 消费者

astravia 桌面端通过 `packages/desktop-app/scripts/fetch-dbx-mcp.mjs` 下载上述 Release 资产接入自有构建产物（win32-x64 走 fork 直链，darwin 目前走官方 npm 平台包过渡源）。

## 更新流程

1. 修改本目录下的 `dbx-mcp-astravia.yml` 并提交（此处为受版本控制的母版）。
2. 将文件内容推送到 `sikongyue/dbx` fork 的 `.github/workflows/dbx-mcp-astravia.yml`（提交信息建议注明对应 Astravia 版本）。
3. 在 fork 仓库手动触发 workflow 或由 push 自动触发，构建并发布 Release。
4. 若资产命名/版本变化，同步更新 `fetch-dbx-mcp.mjs` 中的 pin 与 sha256。

关联文档：[docs/database/dbx-main-integration-tasks.md](../../docs/database/dbx-main-integration-tasks.md)
