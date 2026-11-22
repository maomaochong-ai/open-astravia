# ADR-0187：工作区路径的单一事实源

## 状态

已接受。

## 背景

「设置 → 通用 → 工作区」里选好自定义目录后，重启应用又回到默认工作区
（`~/.astravia/workspace`）。同一份路径同时存在两个写入点、两个存储位置：

| 位置 | 角色 |
| --- | --- |
| 主进程 `desktop-config.json` 的 `workspacePath` | 启动期由 `useAppInit` 读回并套用 |
| 渲染层 `localStorage["astravia-workspace-path"]` | atom 的初始值来源 |

旧实现的选择动作是「先改 atom 与 localStorage，再 `config.set` 写盘」：

```ts
setWorkspacePath(selected);
localStorage.setItem("astravia-workspace-path", selected);
await window.astravia.config.set({ workspacePath: selected });   // 可能抛错，无人处理
```

写盘失败（目录不可写、配置被占用、路径校验拒绝）时用户看到的是新路径，下次启动
`useAppInit` 用配置里的旧值覆盖 atom 与 localStorage —— 于是「设了又回去」，且没有任何提示。
反过来，如果写盘成功而本地镜像失效，也会出现短暂不一致。

## 决策

1. **主进程配置是唯一事实源**：`workspacePathAtom` 不再从 localStorage 初始化，启动只从
   `config.get()` 取值。
2. **先写盘，再改界面**：`selectWorkspace` / `resetWorkspace` 抽成 `persistWorkspace`，
   `await config.set(...)` 成功后才更新 atom；失败弹确认框说明原因，界面保持原值。
3. **不再维护 localStorage 镜像**：删掉 `astravia-workspace-path` 的读写（初始值、启动同步、
   选择与重置）。两处存储必然分叉，收益只有「少一次 IPC 读取」。
4. 失败路径必须可见：新增 i18n 文案 `workspaceSaveFailedTitle/Message/Confirm`（中英各一套）。

## 备选方案

- **保留 localStorage 作为首屏兜底**：能少一次异步等待，但这就是出现「重启回默认」的结构原因，
  且兜底值与真实值冲突时无法判断谁对。
- **写盘失败时重试**：治不了根因（用户可能选了一个不可写目录），还会把错误藏起来。
- **在启动时以 localStorage 为准**：相当于把配置降级成缓存，跨设备/跨 profile 行为更难解释。

## 后果

- 正面：改了就生效，重启仍是同一路径；写盘失败立刻可见且可修。
- 代价：首屏在 `config.get()` 返回前显示默认路径（毫秒级，此前也是一次异步套用）；
  设置页多一次错误弹窗的代码路径。
- 已知限制：`config.set` 仍是「补丁语义」的通用入口，工作区没有独立 IPC；如需更强的校验
  （绝对路径、目录存在性），应走 `GeneralSettingsService.setWorkspace`，见「后续」。

## 验证

- `useGeneralSettingsModel.workspace.test.ts`：
  - 成功路径：`config.set` 收到新路径、atom 更新、**没有**写 localStorage 镜像；
  - 失败路径：`config.set` 拒绝时 atom 不变、不记 usage 统计（即界面未改）。
- `tsc --noEmit`（apps/desktop）通过。

## 后续

把工作区写入收敛到主进程 `GeneralSettingsService.setWorkspace`（已有绝对路径校验与
`allowWorkspaceRoot` 授权），渲染层只保留一个受校验的 IPC；`config.set` 的通用补丁入口
不再对外承担这个字段。那是独立的一步，不与本次行为修复混在一起。
