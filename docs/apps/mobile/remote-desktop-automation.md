# 自动化验证与可观测性

真机不能由开发 Agent 直接替代验证，因此采用分层测试：快速纯逻辑测试覆盖协议，Worker 合同测试覆盖真实连接顺序，Chromium E2E 覆盖视频像素和输入，Android 构建/设备测试覆盖 Kotlin 集成，最后才用实体手机验证厂商系统和网络差异。

## 1. Remote Desktop 包

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta\packages\remote-desktop"
bun run build
bun run test
bun run test:e2e
```

`test:e2e` 启动真实 Electron Chromium，检查：

- 视频宽高存在。
- 收到的画面像素能量非零。
- 连续画面像素发生变化，避免只收到静态黑帧。
- DataChannel 能完成一个经过校验的输入事件往返。

它证明浏览器 WebRTC 主链路，不等价于 Android `SurfaceViewRenderer` 在某一款手机上的兼容性。

## 2. Cloudflare Worker

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta\apps\remote-relay"
bun run test
bun run typecheck
bun run deploy:dry
```

Worker 测试必须覆盖：

- host 先连接、viewer 后连接时，host 收到 `peer_ready`。
- 双方在线后 offer 能转发。
- viewer/host 角色方向校验。
- 客户端伪造 `peer_ready` 会被拒绝。
- 缺少凭据、错误凭据和非法帧会被拒绝。

生产部署后至少做健康检查和一次性随机 pairing WebSocket 冒烟。健康检查只验证 Worker 版本可达，不能代替 WebRTC 视频测试。

## 3. Android 构建和测试

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta\apps\mobile"
.\gradlew.bat :shared:testAndroidHostTest :androidApp:assembleDebug --no-daemon
```

连接 Android 设备后，可以运行：

```powershell
.\gradlew.bat :shared:connectedAndroidDeviceTest --no-daemon
```

带真实邀请的 `RemoteLiveConversationE2ETest` 是显式 opt-in 测试，可能调用真实模型或产生费用。未提供测试参数时应跳过，不能把它作为普通 CI 测试默认运行。

## 4. 仓库质量门禁

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta"
bun run check:quick
bun run check
```

`bun run check` 不运行测试；它负责 lint、TypeScript、架构守卫和包边界。行为测试要使用上面的定向命令。

`bun run test:changed` 可能因为当前分支相对 `origin/dev` 的其他改动而扩大测试范围。它失败时要看失败文件是否属于本次变更，不能把全局基线失败误判为远程桌面回归。

## 5. Android 日志观测

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb logcat -c
& $adb logcat -v time |
  Select-String "VettaRemote|org.webrtc.Logging|AndroidRuntime|FATAL EXCEPTION"
```

状态日志的含义：

| 日志 | 表示 |
| --- | --- |
| `signaling connected` | viewer WebSocket 已连接 |
| `offer received` | Worker/host 信令已到达 Android |
| `remote description set` | Android 已接受 Desktop SDP |
| `answer sent` | Android 已完成本地 description 并发送 answer |
| `video track attached` | 远端视频轨已连接到 renderer |
| `ICE state CONNECTED/COMPLETED` | WebRTC 媒体路径已建立或完成收敛 |
| `EglRenderer Frames received: 0` | renderer 没收到帧，应回到信令、ICE 或轨道生命周期排查 |

日志字段不能包含 SDP、ICE candidate、Token、键盘文本、剪贴板或屏幕像素。

## 6. 测试证据

一次完整验收至少保留：

- APK 构建命令和结果。
- `adb devices` 设备状态。
- Desktop/Worker 版本或部署版本 ID。
- Worker `/health` 返回值。
- Android 远程链路关键日志。
- 画面动态变化截图，而不是只有静态页面截图。
- 对话、画面、输入和断线恢复的逐项结果。

二维码和凭据只在本地短时使用，不能作为测试证据提交。
