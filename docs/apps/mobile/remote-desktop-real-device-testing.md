# Android 真机测试操作手册

本文用于验证手机连接 Desktop、远程对话、实时桌面画面和远程输入。它描述的是当前仓库的实际入口，不是一个脱离实现的产品方案。

## 1. 测试前提

准备以下环境：

- Windows、Android SDK、Bun 和仓库依赖已经可用。
- 手机开启 USB 调试，并允许当前电脑的 RSA 调试授权。
- 手机和电脑都能访问互联网。
- 只测试 Desktop 配对、画面和远程控制时不要求登录；云端 AI 和订阅能力才要求业务账号。
- 手机需要可用的后置摄像头。二维码识别模型随 APK 提供，不要求 Google Play Services。

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

### Xiaomi/HyperOS 额外设置

如果手机是 Xiaomi/HyperOS（例如 `25060RK16C`），还要在开发者选项中打开：

- **USB 调试**。
- **通过 USB 安装**（有些系统显示为“USB 安装”）。
- 如果后续要安装测试 APK，再打开 **USB 调试（安全设置）**，并按提示重新授权。

系统弹出“允许通过 USB 安装”或 RSA 授权时选择允许。保持手机解锁并使用“文件传输”连接模式；否则主 APK 可能能安装，但测试 APK 会被系统报 `INSTALL_FAILED_USER_RESTRICTED`。

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

如果电脑同时连接了模拟器和多台手机，先记录 `devices` 输出中的序列号，并为后续每条命令加上 `-s <serial>`：

```powershell
$serial = "你的真机序列号"
& $adb -s $serial install -r $apk
& $adb -s $serial shell am force-stop org.vetta.android
& $adb -s $serial shell monkey -p org.vetta.android -c android.intent.category.LAUNCHER 1
```

如果安装报 `INSTALL_FAILED_USER_RESTRICTED` 或手机弹出“禁止通过 USB 安装”，在手机上允许“USB 安装/通过 USB 安装应用”（部分厂商还要求关闭“仅充电”安全限制），保持屏幕解锁后重新执行安装。这个错误表示系统拦截了安装授权，不是 APK 构建失败。

建议先只安装主 APK 做手工冒烟测试。测试 APK 是另一份 instrumentation 包，必须单独安装；它安装失败不代表主 APK 不能运行。若 HyperOS 暂时不允许安装测试 APK，自动化 UI 测试继续在 `emulator-5554` 上执行，真机只做主 APK 的手工验收和日志采集。

仅验证 Compose UI 自动化时，可以额外安装测试 APK。它不会替代主 APK，且同样需要手机允许 USB 安装：

```powershell
.\gradlew.bat :shared:assembleAndroidTest --no-daemon
$testApk = "$repo\apps\mobile\shared\build\outputs\apk\androidTest\shared-androidTest.apk"
& $adb -s $serial install -r $testApk
& $adb -s $serial shell am instrument -w -r `
  -e class 'org.vetta.android.ui.EntryAndProfileScreenTest,org.vetta.android.ui.MainScreenInteractionsTest,org.vetta.android.ui.DesktopConversationScreenTest' `
  org.vetta.android.shared.test/androidx.test.runner.AndroidJUnitRunner
```

测试 APK 安装受限时，先完成上面的 USB 安装授权；如果暂时不能授权，仍可继续使用主 APK 做手工真机验收，不能把未执行的自动化结果当作通过。

只有在旧数据导致登录、配对或配置无法判断时才清空数据：

```powershell
& $adb shell pm clear org.vetta.android
```

清空数据会移除登录状态、Resume Secret 和本地配对信息。

## 4. 启动 Desktop

真实 UI 验证使用仓库提供的隔离实例，避免读取或修改日常 Desktop 配置：

```powershell
Set-Location "C:\develop\yiyun\vetta\open-vetta"
bun run verify:ui:start:fresh
bun run verify:ui:status
```

`status` 输出中的 `running`、`ready`、`ui.reachable` 和 `ui.targetFound` 都应为 `true`。

等待 Electron 窗口出现后：

1. 打开设置 → 远程连接。
2. 确认页面显示“安全中继已配置”。中继地址由 Desktop 的开发配置决定，不在用户界面暴露。
3. 点击生成二维码。第一次建立中继连接可能需要约 30 秒，按钮恢复为“生成二维码”且页面出现二维码后再继续。
4. 保持 Desktop 进程和二维码页面运行，不要重复生成二维码。

重新生成二维码会撤销旧配对。Worker 或 Desktop 代码更新后，必须重启 Desktop 并重新生成二维码。

测试结束后关闭隔离实例：

```powershell
bun run verify:ui:stop
```

## 5. 手机配对

1. 首次启动可点击“先逛逛”；Desktop 远程能力不要求业务登录。
2. 进入发现 → 远程连接。
3. 点击“扫码连接 Desktop”，授予相机权限并扫描 Desktop 二维码。
4. 扫描成功后 App 会直接建立连接并打开设备详情，不需要再输入服务器地址或点击第二次确认。
5. 确认页面显示“已连接”、电脑名、连接时长、延迟、桌面预览和系统信息。

邀请 URI 是一次性 bootstrap，后续连接使用手机保存的 Resume Secret。不要截图、复制或公开二维码。

### ADB 深链接自动化

自动化流程可以绕过相机，将测试环境生成的完整邀请直接交给 Android。先验证 APK 已注册协议：

```powershell
& $adb -s $serial shell cmd package query-activities `
  -a android.intent.action.VIEW `
  -d 'vetta://pair?invalid=1'
```

结果应唯一指向 `org.vetta.android.MainActivity`。打开真实邀请时必须将完整 URI 作为一个加引号的参数传入，并避免把它打印到终端、CI 日志或测试报告：

```powershell
$invite = '<由隔离 Desktop 当前二维码安全解码得到的完整 URI>'
$quotedInvite = '"' + $invite + '"'
& $adb -s $serial shell am start -W `
  -a android.intent.action.VIEW `
  -d $quotedInvite `
  org.vetta.android
$invite = $null
```

用无效 URI 测试时，App 应显示“配对码无效”和重新生成提示，且不得发起网络连接。

## 6. 验收顺序

按以下顺序逐项确认，先不要打开远程输入：

1. **设备在线**：手机能看到 Desktop 设备。
2. **远程对话**：发送短消息，能收到 Desktop 返回的流式或完整回复。隔离 Desktop 没有模型配置时，应显示可操作的“桌面执行失败”提示；这能证明请求到达电脑，但不能算模型回复通过。
3. **实时画面**：打开设备详情，能看到 Desktop 屏幕；移动窗口或打开应用，手机画面应发生变化。
4. **恢复能力**：手机切后台、锁屏后返回，连接和画面能恢复。
5. **页面返回**：在聊天、设备详情和设置页按手机系统返回键，应回到应用内上一层，不能直接退出应用。
6. **远程输入**：Desktop 打开允许远程输入后，测试点击、拖动和键盘输入。
7. **撤销配对**：Desktop 撤销后，手机不应继续操作；重新生成二维码后可以重新配对。

远程输入建议使用一个容易观察且无副作用的目标，例如切换 Desktop 当前测试页中的开关，再立即恢复。仅看到手机点击动画不能算通过；至少还要确认电脑鼠标位置、Desktop 路由或目标控件状态发生了对应变化。

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
