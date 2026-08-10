# Kanban 看板

跨项目、跨会话的需求总览与派单入口。系统插件（preset），随 Vetta Desktop 发布。

用户视角的完整说明见 [docs/desktop/kanban-board.md](../../../../docs/desktop/kanban-board.md)。

## 它在架构里的位置

这是**工作区视图**（`ui.slot.workspace-view`）的第一个消费者——一个整页 surface，
在侧边栏占一个可 pin 的导航入口，路由是 `/workspace/kanban/board`。

选工作区视图而不是活动 Tab，是因为看板是**跨会话**的：活动 Tab 按会话 cwd 持久化显隐，
把跨会话总览绑在某一次对话上语义就错了。见 [ADR-0065](../../../../docs/adr/0065-plugin-workspace-views-and-customizable-sidebar-nav.md)。

## 目录结构

```text
src/
  index.tsx                    # activate：注册工作区视图 + agent 工具
  register-tools.ts            # 四个 agent 工具（读板 / 加需求 / 认领 / 提交）
  board/
    types.ts                   # 卡片与看板的数据形状
    board-store.ts             # 纯函数状态层：建卡、移动、解析、运行态回灌
    dispatch.ts                # 纯函数规则层：WIP 闸门、依赖顺序、prompt 构造、agent 快照
    board-controller.ts        # 唯一真相源：加载/落盘 + 副作用（建会话、发 prompt）
  components/
    BoardView.tsx              # 主视图：三泳道 + 拖拽 + 并发设置 + 快速发布
    CardTile.tsx               # 单张卡片（三条泳道共用）
    CardEditorDialog.tsx       # 新建 / 编辑需求
    useBoardModel.ts           # controller → React
test/                          # board-store 与 dispatch 的单测
```

**分层意图**：规则全在 `board-store.ts` / `dispatch.ts`，不碰存储、不碰会话、不碰 React。
UI 和 agent 工具共用同一个 `KanbanBoardController`，所以用户拖一张卡、agent 下一次读板
立刻看到；agent 认领一条需求、页面立刻亮起「运行中」。**不做双份状态**。

## 两个容易踩的点

1. **派单必须先占名额再发 prompt**。卡片先落到「正在处理」再调 `sessions.create`，
   否则并发派两条时两次 `canDispatch` 会看到同一个空名额、双双放行。
2. **派单失败必须把名额吐回来**（置为 `failed`），否则一次网络抖动会永久占住一个 WIP 位。

两条都有对应测试，改动 `dispatch()` 时先看 `test/dispatch.test.ts`。

## 开发

```bash
# 在仓库根安装
bun install

cd packages/plugins/presets/kanban
bunx tsc --noEmit     # 类型
bunx vitest --run     # 单测
bunx vite build       # 产出 dist/ 与 release/kanban-<version>.zip

# 装进开发中的 Desktop
cd ../../../desktop-app && bun run build:presets
```

修改 SDK（`packages/plugins/plugin-sdk`）后需要先在 SDK 目录跑一次 `bun run build`，
本插件按 `dist` 解析类型。

## 权限

| 权限 | 用途 |
| --- | --- |
| `ui.slot.workspace-view` | 注册整页看板视图 |
| `storage.read` / `storage.write` | 看板数据存在插件私有存储 |
| `agent.tools.register` / `agent.toolHandler.execute` | 四个看板工具 |
| `agent.session.read` / `agent.session.write` | 通过 `official.sessions` 建会话、发 prompt、读运行态 |
