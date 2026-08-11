# Desktop 开发文档

- [Windows 自动更新、R2 发版与排障](./windows-auto-update.md)：Inno 后台版本目录、稳定启动器与回退、增量下载原理、历史问题和排障清单。
- [macOS 自动更新、R2 发版与排障](./macos-auto-update.md)：Squirrel.Mac 暂存流程、双架构与元数据合并、签名公证门禁、自持 runner 和排障清单。
- [桌面应用发布入口](../deploy/desktop-releases.md)：兼容旧链接的导航页。
- [看板（Kanban）功能介绍](./kanban-board.md)：三条泳道、Agent 自行认领派单、并发闸门与依赖顺序。
- [看板与工作区视图：方案评估](./kanban-board-evaluation.md)：本轮取舍依据、需求覆盖对照、测试范围与遗留风险。
- [设计画廊（Design Gallery）功能介绍](./design-gallery.md)：设计稿的注册中心——主动收集、画布全景封面、点卡回到最近的会话、新建与导入。

两端共用同一套更新源配置、发布脚本、更新状态机与 CI 编排（`.github/workflows/desktop-release.yml`，一个 tag 出三平台）；差异集中在安装机制与产物形态。跨平台的通用部分（更新源拓扑、Cloudflare/R2 配置、发布脚本行为）写在 Windows 那份里，macOS 文档直接引用不重复。

