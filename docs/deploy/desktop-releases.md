# 桌面应用发布与自动更新

桌面端更新文档已迁移到 [`docs/desktop/`](../desktop/README.md)，按平台分为两份：

- [`windows-auto-update.md`](../desktop/windows-auto-update.md)：`electron-updater + Inno Setup + 版本目录启动器`。含 R2 test/stable 与 GitHub Releases 更新源、EXE/blockmap 差分下载、后台版本准备与健康确认回退、Cloudflare/R2 配置要求。跨平台通用部分写在这份里。
- [`macos-auto-update.md`](../desktop/macos-auto-update.md)：`electron-updater + Squirrel.Mac`。含双架构构建与元数据合并、签名公证门禁、暂存阶段的进度与超时语义、自持 runner 配置。

两份都包含本地闭环测试、发布前检查清单，以及开发过程中遇到的故障、原因、修复与日志排查方法。
