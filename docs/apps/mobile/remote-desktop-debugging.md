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
| 有 signaling connected，但没有 `offer received` | host 是否等待 viewer、Worker 是否已部署新版本 | 信令顺序或旧 Desktop 进程 |
| 有 offer，但没有 remote description set | Android SDP 设置失败 | 查看 `native WebRTC SDP set failed` |
| 有 video track attached，但 frames=0 | ICE、编码器、轨道生命周期、renderer | 查看 ICE 状态和系统日志 |
| ICE 到 `FAILED` | NAT、网络策略、STUN/TURN | 换同 Wi-Fi 或手机热点复测 |
| 对话正常、画面黑屏 | 控制和媒体链路分离 | 不要只继续查控制 Relay |
| 画面正常、输入无效 | Desktop 权限或输入适配器 | 先确认输入开关和系统权限 |

## 3. 本次真机黑屏的根因

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
