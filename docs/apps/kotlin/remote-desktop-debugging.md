# 远程桌面黑屏诊断

## 1. 数据流和责任边界

```text
手机控制通道
  └─ Cloudflare Relay /v1/relay
       └─ Desktop Connector、设备列表、对话请求

手机 WebRTC viewer                         Desktop WebRTC host
  └─ /v1/desktop/:pairingId/viewer   ←→   /v1/desktop/:pairingId/host
       └─ SDP / ICE 信令经过 Worker 转发
       └─ 屏幕像素点对点传输，不经过 Worker
       └─ 输入事件通过 WebRTC DataChannel 发送
```

控制通道在线只证明手机和 Desktop 的远程协议已经连接，不能证明 WebRTC 已收到视频帧。

## 2. 黑屏的判定方法

Android WebRTC 日志中的 `EglRenderer` 统计是最有价值的第一证据：

```text
Frames received: 0
Rendered: 0
```

这说明 `SurfaceViewRenderer` 本身已经初始化，但没有收到远端视频帧。此时不应先修改 Compose 布局或缩放参数，应先检查信令和 Desktop 屏幕捕获。

### 分层检查表

| 现象 | 优先检查 | 结论方向 |
| --- | --- | --- |
| 设备列表都没有 Desktop | bootstrap/resume、控制 Relay、业务登录 | 还没有进入 WebRTC 页面 |
| 设备在线但没有 `signaling connected` | viewer URL、Pairing Secret、Worker WebSocket | Android 信令连接失败 |
| 有 signaling connected，但没有 `offer received` | Desktop 是否捕获到屏幕、host 是否等待 viewer、Worker 是否已部署新版本 | 屏幕权限、信令顺序或旧 Desktop 进程 |
| 有 offer，但没有 remote description set | Android SDP 设置失败 | 查看 `native WebRTC SDP set failed` |
| 有 video track attached，但 frames=0 | ICE、编码器、轨道生命周期、renderer | 查看 ICE 状态和系统日志 |
| ICE 到 `FAILED` | NAT、网络策略、STUN/TURN | 换同 Wi-Fi 或手机热点复测 |
| 对话正常、画面黑屏 | 控制和媒体链路分离 | 不要只继续查控制 Relay |
| 画面正常、输入无效 | Desktop 权限或输入适配器 | 先确认输入开关和系统权限 |

## 3. 已确认的真机黑屏根因

### Desktop 媒体权限策略拒绝屏幕捕获

一次真机复现中，Android 已完成控制通道连接和 `SurfaceViewRenderer` 初始化，但始终没有收到 offer，`EglRenderer` 持续为 `Frames received: 0`。Desktop 同期日志为：

```text
Uncaught NotAllowedError: Permission denied
```

根因不是 Windows 没有屏幕源，而是语音输入为 Electron `defaultSession` 安装的全局媒体权限策略只允许主窗口麦克风。远程桌面隐藏宿主调用 `getDisplayMedia` 时，在 `desktopCapturer` 处理器之前就被这项策略拒绝，因此后续没有视频轨，也不会创建 offer。

Electron 34 对同一次屏幕捕获执行两个权限阶段：

- `setPermissionCheckHandler` 收到主 Frame 的 `mediaType=video`。
- `setPermissionRequestHandler` 收到同一主 Frame，但 `mediaTypes=[]`。

修复后，Desktop 只为当前隐藏宿主登记临时视频权限，并按上述两阶段合同放行；停止或启动失败时立即撤销登记。屏幕源选择处理器还会再次核对实际 `webContents`、仅视频且无音频，普通 Renderer、子 Frame、摄像头和音频请求仍被拒绝。

真机验收的成功证据为：

```text
remote desktop screen capture granted
native WebRTC offer received
native WebRTC video track attached
native WebRTC ICE state state=CONNECTED
Reporting first rendered frame
Frames received: <持续增长>
Rendered: <持续增长>
```

本次实测首帧分辨率为 `2560x1600`，稳定约 `20-21 FPS`，连续统计中丢帧为 `0`，手机截图能辨认电脑当前桌面内容。

### Viewer 晚于一次性 offer 上线

真机记录中的关键事实是：

- Android 控制通道已经出现 `remote connection online`。
- `SurfaceViewRenderer` 已完成初始化并有稳定尺寸。
- `EglRenderer` 长时间显示 `Frames received: 0`。
- 没有发生 Android 应用崩溃。

原来的时序是：

```text
Desktop 生成二维码
  → Desktop host 连接 Worker
  → host 立即创建并发送 offer
  → 手机还没有打开 viewer WebSocket
  → Worker 返回 peer_offline 并关闭 host
  → 手机后来进入预览，但没有 offer 可处理
```

修复后的时序是：

```text
Desktop host 连接 Worker
  → 手机 viewer 连接 Worker
  → Worker 发送 relay-owned peer_ready 给 host
  → Desktop 创建 offer
  → Worker 转发 offer/ICE
  → Android 创建 answer 并附加视频轨
```

`peer_ready` 不携带 SDP、ICE、Token 或屏幕数据。客户端不能伪造该事件，Worker 只在两端都在线时生成它，也不需要把 SDP/ICE 写入 Durable Object 存储。

## 4. 常见操作错误

### 旧二维码或旧进程

Worker、Desktop 或 APK 更新后，旧 Desktop 隐藏 host 页面可能仍运行旧协商逻辑。处理顺序：

1. 完全退出 Desktop。
2. 安装最新 APK。
3. 重新启动 Desktop。
4. 重新生成二维码。
5. 手机重新扫描。

### ADB 显示 unauthorized

解锁手机并接受 RSA 授权；不要通过反复安装 APK 来解决授权问题。

### 扫码按钮不可用

真机没有 Google Play Services 时，Google Code Scanner 不会工作。改用完整 `vetta://pair?...` URI 手动粘贴。

### 只有黑色画面，没有明显异常

先看 Android 日志是否有 `offer received`：

- 没有：检查 Worker 部署、Desktop 进程和二维码是否是最新的。
- 有：看 `remote description set`、`video track attached` 和 ICE 状态。
- ICE 失败：更换网络，先使用同一 Wi-Fi；严格 NAT 环境可能需要 TURN，而当前配置只使用公网 STUN。

### 输入权限问题

输入默认关闭是预期行为。Desktop 需要显式开启；macOS 需要辅助功能权限，Linux 需要 X11/XWayland，Windows 需要检查防火墙和安全软件。

## 5. Desktop 日志

隐藏 host renderer 的安全诊断会转发到 Desktop 主日志，重点搜索：

```text
remote-desktop-host
remote desktop screen capture granted
remote desktop display media request rejected
remote desktop screen capture source unavailable
remote desktop host peer state
remote desktop signaling closed
remote desktop host negotiation already pending
```

日志只应包含 session ID、状态和计数等诊断字段。不要为了排障打印 SDP、ICE candidate、完整 target 或捕获像素。

## 6. 生产部署后的验证

部署后先检查：

```powershell
Invoke-WebRequest -UseBasicParsing `
  "https://relay.flowerwine.dpdns.org/health" |
  Select-Object -ExpandProperty Content
```

然后使用一次性随机 pairing 做 host/viewer WebSocket 冒烟，验证 host 收到 `peer_ready`。不要使用真实用户配对、固定 Secret 或把冒烟凭据写入文件。

## 7. 详情页遥测与系统信息

设备详情页的“连接时长”和“延迟”来自控制通道，而不是预览画面：

- 连接成功后手机立即请求一次 `diagnostics.snapshot`，用响应往返时间作为首个 RTT。
- 之后每秒刷新连接时长，每 5 秒请求一次诊断以更新 RTT；断开或重连时不会把旧连接的计时器带到新连接。
- Desktop 诊断响应包含 `osLabel`、`cpu` 和 `ram`，手机按“操作系统 / 处理器 / 内存”展示。
- `device.host` 只用于构造 WebRTC viewer 地址，不属于系统信息，不能渲染到系统信息卡片。

如果详情页显示“连接中”但预览仍有最后一帧，说明媒体链路尚在而控制通道正在重连；此时应等待控制通道恢复，或断开后用最新 Resume Secret 重新连接。测试时可以用 UI 树确认 `连接时长`、`延迟`、`操作系统`、`处理器`、`内存` 节点，而无需输出包含配对信息的完整 URI。
