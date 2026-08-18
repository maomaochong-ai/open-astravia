# App Action 测试

本文记录 Vetta Desktop App Action（`vetta action` / 本地 Action RPC）的验收约定。

UI 验证入口见 [Vetta Desktop UI 验证](../dev/README.md)。

## 原则：直接看页面，不要用脚本包一层

写路径（`effect: write`）会挂起审批弹窗。验收时 **Agent 必须通过仓库 UI 验证入口观察与点击主窗**，而不是再写一层「自动点确认」编排脚本。

| 应该做 | 不要做 |
|--------|--------|
| `snapshot` / `run-code` 列出当前按钮文案 | 封装 `run-with-ui-approve.ps1` / 黑盒 `--approve` 盲点 |
| 看到真实按钮后再 `click`（如 `确认开启`、`保存实验功能`） | 写死中文正则列表后批量空转 |
| 先清残留弹窗（尤其 `拒绝（0:00）`）再发新 RPC | 队列堵着还连发写 action，把超时全记成 fail |
| 统一使用 `verify:ui:pw` 操作 **Vetta Desktop** 主窗 | 直接调用全局 `playwright-cli` 或写死 tab 下标 |

原因：

1. 审批按钮文案随 presentation 变化（`确认开启` / `保存实验功能` / `打开` / `切换语言` / `全部恢复默认` 等），脚本猜不全。
2. 审批是 FIFO；上一次超时残留（`拒绝（0:00）`）会挡住后续 run，看起来像「全挂」。
3. 脚本把失败收成 `TIMEOUT`，看不清页面上实际是什么对话框。

## 推荐手工步骤（写 action）

```powershell
# 0) 确认验证实例和主窗口可操作
bun run verify:ui:status
bun run verify:ui:pw -- snapshot

# 1) 若有残留审批：先看再点
bun run verify:ui:pw -- run-code "async (page) => { const all=page.getByRole('button'); const n=await all.count(); const vis=[]; for (let i=0;i<n;i++){ const t=(await all.nth(i).innerText().catch(()=>'')).replace(/\s+/g,' ').trim(); if(t && await all.nth(i).isVisible()) vis.push(t);} return vis; }"
# 有「拒绝」则按需拒绝排空，或确认后点对应主按钮

# 2) 后台发起 actions.run（会挂起直到 UI 确认）
#    例如 bun/fetch 调 ~/.vetta/action-server.json 的 /rpc

# 3) 再看页面：确认出现的按钮，再点
bun run verify:ui:pw -- snapshot
bun run verify:ui:pw -- click "getByRole('button', { name: '当前页面显示的确认按钮' })"
# name 以本步 snapshot / run-code 看到的为准，不要照抄

# 4) 读 RPC 结果文件或 CLI 输出，记 pass/fail
```

只读 query（`*.query` 的 list/get/help）可直接：

```powershell
bun apps/cli-host/src/cli.ts action run general.query '{"operation":"get"}'
bun apps/cli-host/src/cli.ts action run appearance.query '{"type":"get"}'
bun apps/cli-host/src/cli.ts action run navigation.query '{"type":"help"}'
```

无需 Playwright，也不应弹出授权。

> **注意**：`appearance.theme` / `navigation.open` 仅保留写操作；`help`/`get` 已拆到 `appearance.query`、`navigation.query`（`effect: read`）。其余域本来就是 `*.query`（read）+ `*.manage`（write）分离。

## 前置

1. 验证实例已启动：`bun run verify:ui:start`
2. 系统插件 `vetta-actions` 已启用并能激活（否则 Catalog 为空）
3. CLI 可连本地 RPC（`~/.vetta/action-server.json`）
4. `bun run verify:ui:status` 显示 `running` 和 `ui.targetFound` 均为 `true`

## 相关文档

- [Vetta Desktop UI 验证](../dev/README.md)
