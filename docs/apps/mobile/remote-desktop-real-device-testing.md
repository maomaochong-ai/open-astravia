# Android 真机测试操作手册

本文用于验证手机连接 Desktop、远程对话、实时桌面画面和远程输入。它描述的是当前仓库的实际入口，不是一个脱离实现的产品方案。

## 1. 测试前提

准备以下环境：

- Windows、Android SDK、Bun 和仓库依赖已经可用。
- 手机开启 USB 调试，并允许当前电脑的 RSA 调试授权。
- 手机和电脑都能访问互联网。
- 手机已经具备 Vetta 业务 API 的可用登录账号。Cloudflare Relay 只负责远程中继，不提供业务账号登录。
- 使用二维码扫描需要 Google Play Services；没有该服务时使用页面中的手动邀请 URI 输入框。

## 2. 连接 ADB

手机上依次操作：

1. 设置 → 关于手机 → 连续点击版本号 7 次。
2. 返回设置 → 开发者选项 → 开启 USB 调试。
3. USB 连接电脑，选择允许 USB 调试。

PowerShell 检查设备：

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
```

期望看到：

```text
<serial>    device
```

`unauthorized` 表示手机还没有接受 RSA 弹窗；没有设备通常是 USB 线、USB 模式或厂商驱动问题。可以重启 ADB：

```powershell
& $adb kill-server
& $adb start-server
& $adb devices
```

## 3. 构建和安装 APK

从仓库根目录进入移动端：

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta\apps\mobile"
.\gradlew.bat :androidApp:assembleDebug --no-daemon
```

安装当前 Debug APK：

```powershell
$repo = "C:\develop\yiyun\vetta\open-vetta"
$apk = "$repo\apps\mobile\androidApp\build\outputs\apk\debug\androidApp-debug.apk"
& $adb install -r $apk
& $adb shell am force-stop org.vetta.android
& $adb shell monkey -p org.vetta.android -c android.intent.category.LAUNCHER 1
```

只有在旧数据导致登录、配对或配置无法判断时才清空数据：

```powershell
& $adb shell pm clear org.vetta.android
```

清空数据会移除登录状态、Resume Secret 和本地配对信息。

## 4. 启动 Desktop

在另一个 PowerShell 窗口执行：

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta"
bun run --cwd apps/desktop dev:isolated
```

等待 Electron 窗口出现后：

1. 打开设置 → 远程连接。
2. 确认 Relay 地址是当前环境的有效地址，例如 `https://relay.flowerwine.dpdns.org`。
3. 点击生成二维码。
4. 保持 Desktop 进程和二维码页面运行，不要重复生成二维码。

重新生成二维码会撤销旧配对。Worker 或 Desktop 代码更新后，必须重启 Desktop 并重新生成二维码。

## 5. 手机配对

1. 首次启动先完成业务登录。
2. 进入发现 → 远程连接。
3. 点击二维码按钮，授予相机权限并扫描 Desktop 二维码。
4. 没有 Google Play Services 或扫码失败时，把完整的 `vetta://pair?...` URI 粘贴到手动输入框。
5. 点击连接，等待设备在线。

不要只复制 URI 的一部分。邀请 URI 是首次 bootstrap，后续连接会使用手机保存的 Resume Secret。

## 6. 验收顺序

按以下顺序逐项确认，先不要打开远程输入：

1. **设备在线**：手机能看到 Desktop 设备。
2. **远程对话**：发送短消息，能收到 Desktop 返回的流式或完整回复。
3. **实时画面**：打开设备详情，能看到 Desktop 屏幕；移动窗口或打开应用，手机画面应发生变化。
4. **恢复能力**：手机切后台、锁屏后返回，连接和画面能恢复。
5. **远程输入**：Desktop 打开允许远程输入后，测试点击、拖动和键盘输入。
6. **撤销配对**：Desktop 撤销后，手机不应继续操作；重新生成二维码后可以重新配对。

首次测试建议手机和电脑处于同一 Wi-Fi。控制通道正常但画面黑屏时，不能简单判定 Relay 正常，因为控制通道和 WebRTC 媒体通道是两条独立链路。

## 7. 系统权限

### Windows

通常不需要独立的屏幕录制授权，但需要检查 Windows 防火墙或安全软件是否拦截 Electron。远程输入还需要 Desktop 设置中的输入开关处于开启状态。

### macOS

在系统设置 → 隐私与安全性中允许 Desktop/Electron：

- 屏幕录制。
- 辅助功能。

授权后重新启动 Desktop。

### Linux

当前输入适配器依赖 X11/XWayland。Wayland 原生环境可能只能验证画面，不能验证鼠标键盘注入。

## 8. 采集日志

清空旧日志并过滤 Android 远程链路：

```powershell
& $adb logcat -c
& $adb logcat -v time |
  Select-String "VettaRemote|org.webrtc.Logging|AndroidRuntime|FATAL EXCEPTION"
```

预期的关键顺序是：

```text
native WebRTC signaling connected
native WebRTC offer received
native WebRTC remote description set
native WebRTC local description set
native WebRTC answer sent
native WebRTC video track attached
native WebRTC ICE state state=CONNECTED
```

保存截图：

```powershell
& $adb exec-out screencap -p > .ai/remote-control/real-device-screen.png
```

不要把包含二维码、Pairing Secret、Resume Secret 或完整 WebSocket 目标的日志公开。
