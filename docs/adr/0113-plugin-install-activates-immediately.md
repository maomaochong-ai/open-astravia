# ADR-0113：插件安装即激活，不再留 pending 版本

## 状态

Accepted

## 背景

`InstalledPlugin` 同时有 `version`、`activeVersion` 和 `pendingVersion`。装同一插件的新版本时，安装只把 `version`、`permissions`、`declaredCommands` 换成新 manifest 的值，`entryUrl`、`styleUrls`、`iconUrl`、`moduleFederation`、`agent`、`cliProviders`、`serviceProviders`、`locales` 全部沿用旧版本，并写下 `pendingVersion` 等调用方再显式调用 `reloadPlugin` 才切换。

于是「让新版本生效」的责任散落在每个调用方：市场更新流在权限确认后补一次 reload，CLI 靠 `add` 的输出提示用户再跑一条 `reload`，而能力页手动导入 zip 这条路径没有补，用户看到的就是版本号变成新版、运行的仍是旧代码；`pendingVersion` 持久化在注册表里，重启不会自愈，只能卸载重装。

同一份「manifest → InstalledPlugin 版本字段」的投射在安装、重载、dev 链接三处各写了一遍，字段集互不相同，manifest 每新增一个字段都要在三处同步，漏一处就退化成同类故障。

## 决策

1. `installPluginFromArchive` 装配完整的新版本：`activeVersion` 落到 `manifest.version`，全部版本字段按新 manifest 重算，资源 URL 带 reload token（渲染进程据此丢弃已加载的旧 Module Federation 远端）。
2. 安装不再产生 `pendingVersion` / `availableVersion`。`reloadPlugin` 保留为「重新读盘刷新」，并在遇到旧宿主留下的 `pendingVersion` 时收敛掉它。
3. manifest → 版本字段的投射收敛为 `projectPluginVersion` 一个函数，安装与重载共用。
4. 用户态跨升级保留：启用状态、首次安装时间，以及已授予的权限与命令——后者与新声明取交集，新增权限与新增命令不会被自动授予，仍要用户在确认界面勾选。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 在手动导入这条路径补一次 reload | 只堵住一个入口，半新半旧的安装结果还在，下一个安装入口继续踩 |
| 启动时统一应用 pending | 仍要重启才生效，且没有改变「生效责任不属于安装方」这个根因 |
| 保留两步并在 UI 上强提示 | 把宿主的状态自洽问题转嫁给用户，跨 UI、CLI、Action 三处都要维护提示 |

## 后果

- 升级不再需要第二步动作，GUI 导入、Action 安装与 CLI `add` 一致。`@vetta-org/plugin-cli` 无需改动：它的 pending 提示是条件分支，不再触发；`reload` 命令仍然可用且幂等。
- 市场更新流的次序变为「装完即生效 → 权限确认」。这不扩大权限：`grantedPermissions` 仍是旧授权与新声明的交集。
- 旧注册表里已经存在的 `pendingVersion` 状态，在一次重载或重新安装后收敛。字段本身暂时保留以兼容这些存量记录。
- ADR-0067 中「升级 pending/reload」的表述随之失效，已同步修订。
