# 远程桌面实战记录

本文记录一次从设计评估到 Android 真机黑屏修复和生产部署的实际过程，重点保留以后排障时最有价值的判断依据。

## 1. 架构判断

手机不能直接连接电脑的本地 RPC：

- 电脑通常位于 NAT 后面，没有公网入站地址。
- 手机和电脑可能不在同一网络。
- Worker 不能安全地承载屏幕像素、键盘内容或完整 Agent 权限。

最终采用的边界是：Cloudflare Durable Object 做配对、鉴权、在线状态和信令转发；Desktop 和 Android 主动连出；WebRTC 负责屏幕和输入；控制/对话继续走版本化远程协议。

这个边界让 Worker 不接触屏幕内容，也避免把 Electron IPC 或 Android 内部对象直接暴露到公网。

## 2. 真机准备中遇到的经验

### ADB

- `adb devices` 显示 `unauthorized` 时，真正的修复是接受手机 RSA 授权，而不是反复安装 APK。
- Windows 环境下常用路径是 `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`。
- 构建成功不等于手机安装成功，必须单独确认设备状态和包名 `org.vetta.android`。

### 登录与扫码

- 当前手机 UI 的远程连接入口位于登录后的“发现 → 远程连接”，所以业务 API 登录问题和 Relay 配对问题要分开判断。
- Google Code Scanner 依赖 Google Play Services；部分真机应准备完整 `vetta://pair?...` URI 的手动输入路径。
- 二维码重新生成会撤销旧配对，测试时不能为了“刷新状态”连续生成。

## 3. 黑屏故障复盘

真机记录没有显示崩溃，反而给出了很强的正向证据：

```text
remote connection online
SurfaceViewRenderer: onMeasure(). New size: ...
EglRenderer: Frames received: 0. Rendered: 0.
```

因此排查顺序应是：

1. Compose 容器是否存在：已存在。
2. Renderer 是否初始化：已初始化。
3. Android 是否收到 offer：没有。
4. Worker 是否在 viewer 到达前关闭 host：是。

根因不是 Android 布局，而是“host 先发一次性 offer、viewer 后到达”的竞态。原 Worker 在没有 opposite WebSocket 时返回 `peer_offline` 并关闭 host；手机后来连接时只能得到一个没有视频轨的 PeerConnection。

## 4. 修复方式

### 协议

新增仅由 Worker 生成的 `peer_ready` 事件，不带 session、SDP、ICE 或凭据字段。Worker 在两端在线后发送它，客户端发来的同名事件直接拒绝。

### Desktop

`RemoteDesktopHost.start(stream, { waitForPeerReady: true })` 先准备屏幕轨和 DataChannel，收到 `peer_ready` 后才创建 offer。这样无需把 SDP/ICE 暂存到 Durable Object，也避免了敏感信令长期落盘。

### Android

同时修正两个时序问题：

- 本地 `setLocalDescription` 成功后才发送 answer。
- 如果视频轨到达时 `SurfaceViewRenderer` 尚未创建，保存轨道并在 renderer 创建后补挂。

## 5. 验证中的错误和如何分类

### 与本次改动直接相关且必须修复

- Worker 原有测试只覆盖双方已连接，未覆盖 host-first 顺序；新增该回归测试后暴露了真实竞态。
- Android 日志只有 renderer 统计，没有“是否收到 offer/轨道/ICE”状态；补充不含敏感数据的状态日志后，真机问题可以沿链路定位。

### 与本次改动无关的基线失败

一次 `test:changed` 扩展到了多个不相关包，出现过：

- AI HTTP proxy 测试因为 `undici` 构造器环境差异失败。
- Runtime 测试找不到 Windows sandbox host 二进制。
- Desktop 测试桩缺少 `window.vetta.session.openViewer`。

这些失败不能归因于 WebRTC 修复；远程桌面包、Worker、Android 构建和完整静态 `check` 仍需单独报告。

### 测试脚本自身的误判

第一次生产 WebSocket 冒烟在收到 `peer_ready` 后主动关闭连接，但脚本把 viewer 的预期 close 事件当成错误，进程返回 1。修复脚本状态机后，随机 pairing 冒烟稳定输出 `peer_ready_received` 并以 0 退出。

经验是：测试脚本必须区分“主动清理导致的 close”和“建立连接前的 error”，否则会把成功测试报告成失败。

## 6. 生产部署经验

部署顺序：

1. 运行 Worker 单元测试、类型检查和 `deploy:dry`。
2. 使用 `wrangler whoami` 确认账号和目标 `account_id`。
3. 执行 `wrangler deploy`。
4. 检查 `/health`。
5. 用一次性随机 pairing 验证 `peer_ready`。
6. 重启 Desktop、安装新 APK、重新生成二维码，再做真机验收。

Worker 更新和 Desktop 协商逻辑必须配套。只部署 Worker 而不重启旧 Desktop，旧 host 仍可能在收到 `peer_ready` 前发送 offer；只更新 APK 而不更新 Worker，也不能解决 host-first 竞态。

## 7. 后续排障原则

- 先确认哪条链路失败：登录、控制 WebSocket、WebRTC 信令、ICE、视频轨、renderer 或输入权限。
- 先看可观察状态，再改布局或网络配置。
- 先用同 Wi-Fi 排除 NAT，再切换移动数据验证真实网络。
- 自动化测试验证协议和浏览器媒体；真机验证 Android SDK、厂商 ROM、SurfaceView、权限和后台生命周期。
- 所有测试都应避免输出 Secret、SDP、ICE、键盘文本、剪贴板和屏幕像素。
