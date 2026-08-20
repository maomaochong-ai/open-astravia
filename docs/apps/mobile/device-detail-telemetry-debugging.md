# 设备详情遥测调试实录

本文记录一次 Android 设备详情页中“连接时长、延迟一直显示暂无，系统信息却显示连接 URL”的完整排查、修复和真机验收过程。目标是让后续开发者能够快速找到数据责任边界，并复用已经验证过的命令和判断方法。

## 1. 现象和可观察行为

初始现象：

- 设备已经在线，桌面预览也能显示画面。
- “连接时长”和“延迟”始终为“暂无”。
- “系统信息”中出现 `Remote relay`、两个“暂无”和完整连接 URL。

期望行为：

- 连接时长至少每秒更新一次。
- 延迟显示手机控制通道到 Desktop 的实际请求往返时间，而不是常量或估算值。
- 系统信息只显示操作系统、处理器和内存，不显示 Relay、Pairing 或 viewer 地址。
- 控制通道异常时，详情页状态应变为“正在连接”，不能把仍有最后一帧的预览误判为控制通道在线。

## 2. 数据流和责任边界

```text
Desktop diagnostics()
  └─ diagnostics.snapshot response
       └─ RemoteConnection 记录 request RTT
            └─ RelayRemoteConversationGateway 更新 DesktopDevice
                 └─ AppViewModel 收集 devices StateFlow
                      └─ DeviceDetailScreen 渲染指标和系统信息
```

涉及的主要源码：

- `apps/desktop/src/main/remote-control/desktop-conversation-remote-operations.ts`
- `apps/mobile/shared/src/commonMain/kotlin/org/vetta/android/domain/remote/connection/RemoteConnection.kt`
- `apps/mobile/shared/src/commonMain/kotlin/org/vetta/android/domain/conversation/RelayRemoteConversationGateway.kt`
- `apps/mobile/shared/src/commonMain/kotlin/org/vetta/android/ui/connect/ConnectScreens.kt`

`device.host` 是控制 Relay 目标，同时用于推导 WebRTC viewer 地址。它是连接配置，不是系统信息，不能直接出现在系统信息卡片中。

## 3. 第一次源码定位

先从用户可见文案和模型字段反向搜索：

```powershell
rg -n "连接时长|延迟|系统信息|暂无|latencyMs|connectedDuration|osLabel|device.host" `
  apps/mobile/shared/src -g '*.kt'
```

这一步确认了三个事实：

1. `DesktopDevice` 已经定义 `latencyMs`、`connectedDuration`、`cpu` 和 `ram`，不需要新建并行模型。
2. `DeviceDetailScreen` 正确读取了 `latencyMs` 和 `connectedDuration`，但 `RelayRemoteConversationGateway` 创建设备时没有写入这两个字段。
3. `DeviceDetailScreen` 把 `device.host` 直接放入“系统信息”卡片，这是 URL 出现在错误区域的直接原因。

继续检查远程协议：

```powershell
rg -n "lastRttMs|DiagnosticsSnapshot|diagnostics.snapshot|diagnostics\(\)" `
  apps/mobile/shared/src apps/desktop/src/main/remote-control packages/remote-control
```

已有 `diagnostics.snapshot` 请求和 `RemoteConnectionSnapshot.lastRttMs`，因此不需要新增 ping 协议。`RemoteConnection` 会在请求响应时计算 RTT，手机只需定期发出轻量诊断请求并读取快照。

## 4. 根因

### 4.1 遥测字段只有定义，没有生产者

旧网关在握手完成后只创建：

```text
id / name / osLabel / host / status / channel
```

`latencyMs` 和 `connectedDuration` 使用模型默认值 `null`，之后也没有定时任务更新，所以 UI 永远只能显示“暂无”。

### 4.2 Desktop 诊断内容不包含系统信息

Desktop 的 `diagnostics()` 原本只返回活动会话数和工作目录。即使手机调用 `diagnostics.snapshot`，也无法得到 OS、CPU 和内存。

### 4.3 UI 混淆了系统信息和连接配置

`osLabel` 被硬编码为 `Remote relay`，`device.host` 又被直接渲染。两者都属于连接方式，不是电脑系统信息。

## 5. 实施方案

### Desktop

`diagnostics()` 增加：

- `osLabel`：友好平台名称和系统版本。
- `cpu`：`node:os.cpus()[0].model`。
- `ram`：`node:os.totalmem()` 格式化后的总内存。

平台名称不直接显示 Node 的 `win32` / `darwin` 标识，而是格式化为 `Windows (...)`、`macOS (...)` 或 `Linux (...)`。

### Android

连接成功后的顺序：

1. 等待 `RemoteConnectionState.Online`。
2. 记录连接起始时间。
3. 立即请求一次 `diagnostics.snapshot`。
4. 从 `lastRttMs` 写入首个延迟值，并从诊断响应写入系统信息。
5. 启动遥测 Job：每秒刷新连接时长，每 5 秒刷新诊断和 RTT。
6. 断开或更换连接时取消旧 Job，避免旧连接继续更新新设备。

系统信息 UI 使用有标签的三行布局：操作系统、处理器、内存。连接 URL 不再渲染。

## 6. 自动化测试

### Android 网关回归测试

测试使用假的 `RemoteTransport` 完成握手并响应 `diagnostics.snapshot`，断言设备状态流包含：

- 非空连接时长。
- RTT。
- OS、CPU 和内存。
- 后续对话请求仍能正常接收事件，避免诊断请求消耗或打乱会话事件序列。

执行：

```powershell
Set-Location apps/mobile
./gradlew.bat :shared:testAndroidHostTest --no-daemon
```

注意：Fake Transport 必须区分 `DiagnosticsSnapshot` 和 `SessionPrompt`。如果所有请求都发送同一个 `sequence=1` 的会话事件，首次诊断会提前占用事件序号，导致后续对话事件被当成重复事件丢弃。

### Desktop 诊断测试

断言 `diagnostics()` 保留原有会话字段，并返回非空 OS、CPU 和带 `GB`/`MB` 后缀的内存值：

```powershell
bun scripts/quality/run-vitest.mjs --run `
  apps/desktop/src/main/remote-control/desktop-conversation-remote-operations.test.ts
```

### 质量门禁和构建

```powershell
bun run check:quick
bun run check
bun run --cwd apps/desktop build:dev-processes

Set-Location apps/mobile
./gradlew.bat :androidApp:assembleDebug --no-daemon
```

`bun run check` 不运行测试，因此不能替代两个定向行为测试。

## 7. 真机自动化验收

### 7.1 安装并启动

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$apk = "C:\develop\yiyun\vetta\open-vetta\apps\mobile\androidApp\build\outputs\apk\debug\androidApp-debug.apk"

& $adb devices
& $adb install -r $apk
& $adb shell am force-stop org.vetta.android
& $adb shell monkey -p org.vetta.android -c android.intent.category.LAUNCHER 1
```

`install -r` 保留 SharedPreferences，但远程连接对象只存在于进程内。重启 APP 后看到欢迎页或“未连接”不代表数据被清空；进入主界面后仍需重新发起控制连接。

### 7.2 截图和 UI 树

使用临时目录，避免把真实桌面内容留在仓库：

```powershell
$probeDir = Join-Path $env:TEMP "vetta-mobile-probe"
New-Item -ItemType Directory -Force $probeDir | Out-Null

& $adb exec-out screencap -p > (Join-Path $probeDir "device-detail.png")
& $adb shell uiautomator dump /sdcard/vetta-device-detail.xml
& $adb pull /sdcard/vetta-device-detail.xml (Join-Path $probeDir "device-detail.xml")
```

只提取验收字段，不把完整 XML 输出到终端：

```powershell
$ui = Get-Content (Join-Path $probeDir "device-detail.xml") -Raw
$expected = @("连接时长", "延迟", "系统信息", "操作系统", "处理器", "内存")
$expected | ForEach-Object {
  if (-not $ui.Contains($_)) { throw "missing UI label: $_" }
}

if ($ui -match 'wss?://|Remote relay') {
  throw "connection target leaked into device detail UI"
}
```

截图用于确认预览不是黑屏、文字没有重叠；UI 树用于确认具体文案和值。两者互补，截图不能可靠证明语义字段，UI 树也不能证明视频像素非黑。

### 7.3 本次真机基线

本次连接稳定后观察到：

- 连接时长从秒级开始持续增长。
- 延迟随诊断请求变化，观察值约为 `431-644 ms`，不是固定占位值。
- 系统信息返回 Windows 版本、实际 CPU 型号和总内存。
- 桌面预览继续显示实时画面。
- UI 树中不再出现 `Remote relay` 或 `ws://` / `wss://`。

数值受网络和机器影响，测试不应断言固定 RTT、CPU 型号、系统版本或内存容量，只断言格式与非空性。

## 8. 本次遇到的错误

### Desktop 已改源码，但手机仍显示旧诊断

原因是 Electron 主进程使用 `apps/desktop/dist/main`，源码修改后旧进程不会自动加载新 bundle。必须执行 `build:dev-processes` 并重启 Desktop。只刷新 Renderer 不够。

判断方法：

```powershell
rg -n "osLabel|totalmem|cpus" apps/desktop/dist/main -g '*.js'
```

如果 bundle 已包含新字段但真机仍显示旧值，检查正在运行的 Electron 主进程启动时间和命令行，确认没有第二个旧实例：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -match 'open-vetta' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

不要按进程名称批量结束全部 Electron/Node/Bun；先确认目标命令行，只停止当前仓库的开发进程。

### Desktop 重启后状态为“正在连接”，预览仍有画面

控制 WebSocket 和 WebRTC 媒体是两条独立链路。Desktop 主进程重启后，手机控制通道可能处于 `Reconnecting`，但旧媒体会话仍显示最后一帧或短暂继续传输。此时 CPU/内存不会刷新，因为遥测 Job 只在控制通道 `Online` 时请求诊断。

验收新 Desktop 诊断时应主动断开并重新连接控制通道，不能只看预览。

### 直接输出 SharedPreferences 泄露了凭据

一次调试中直接读取完整 SharedPreferences，导致 Resume Secret 出现在本地工具输出。虽然没有提交到仓库，但这种方式不应复用。

正确做法：

- 优先重新扫描二维码或使用用户提供的完整邀请 URI。
- 不执行会打印整个 SharedPreferences、二维码内容或完整连接目标的命令。
- 必须检查持久化状态时，只返回字段是否存在或长度，不返回值。
- 截图、UI XML 和日志完成验收后立即删除；公开工单只记录脱敏状态和数值。

### 安装 APK 后回到欢迎页

`install -r` 保留数据，但欢迎页和当前导航状态可能重置。点击“先逛逛”进入主界面后，会话记录仍在；远程连接需要重新建立。这不是安装失败，也不应立即执行 `pm clear`。

## 9. 下次排查的最短路径

1. 搜索 `DesktopDevice` 的生产者，确认字段是 `null` 还是 UI 映射错误。
2. 检查 `RemoteConnectionSnapshot.lastRttMs` 是否在请求响应后更新。
3. 用 Fake Transport 跑网关回归测试，不先依赖真机。
4. 构建 Desktop main 和 Android APK，重启对应进程。
5. 真机重新建立控制连接，不复用处于 `Reconnecting` 的旧连接。
6. UI 树检查六个标签、非空值以及 URL 泄露；截图检查实时画面和布局。
7. 跑 `check:quick`、定向测试和 `check`，清理临时产物。

如果只做前三步，可以证明数据映射逻辑；完成真机步骤后，才能证明 Desktop、Relay、Android 和 Compose 渲染的完整链路。
