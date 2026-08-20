# Mobile 文档

这里记录 Android 真机、Desktop 远程控制和 Cloudflare Relay 的开发与验收方法。

## 文档索引

- [真机测试操作手册](./remote-desktop-real-device-testing.md)：从 ADB、APK 安装、Desktop 启动、二维码配对到远程画面和输入验收。
- [远程桌面黑屏诊断](./remote-desktop-debugging.md)：按控制通道、信令、ICE、视频轨和系统权限逐层定位问题。
- [自动化验证与可观测性](./remote-desktop-automation.md)：单元测试、Worker 合同测试、Chromium WebRTC E2E、Android 构建和日志采集。
- [远程桌面实战记录](./remote-desktop-operation-log.md)：本次真机测试、黑屏修复、生产部署中遇到的现象、错误和经验。

## 当前边界

- Android 包名：`org.vetta.android`。
- Desktop 远程画面使用独立 WebRTC，Cloudflare Worker 只负责配对和信令转发，不承载屏幕像素或输入数据。
- Desktop 和 Android 都需要互联网访问；同一 Wi-Fi 适合首轮排障，但不能替代跨 NAT 验证。
- 远程输入默认关闭，并受 Desktop 操作系统权限和本地能力检测限制。

文档中的命令以 Windows PowerShell 为主。二维码、Pairing Secret、Resume Secret、账号、Cookie 和日志中的敏感字段不得提交到仓库或粘贴到公开工单。
