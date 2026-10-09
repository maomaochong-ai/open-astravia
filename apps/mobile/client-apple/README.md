# Vetta for iPhone（client-apple）

Vetta 手机端的 iOS 原生客户端（Swift 6 + SwiftUI，iOS 26 起，Liquid Glass）。它通过 `@vetta/remote-control` 的协议 v2 与 Vetta Desktop 配对，在手机上镜像电脑正在处理的会话：查看进度、继续追问、回答电脑弹出的提问、中止任务。Android 端在 [`../client-android`](../client-android)。

原 Expo/React Native 客户端已移出仓库；本工程在功能上与它一一对应（配对、双通道连接、会话镜像、离线缓存、设置项），界面按原设计还原，但全部换成系统原生控件：导航栏、分段控件、开关、弹层、`glassEffect` 玻璃材质。深浅色跟随系统，不提供应用内切换。

## 结构

| 路径 | 内容 |
| --- | --- |
| `VettaKit/` | Swift Package，平台无关的全部逻辑：协议帧与校验、加密、连接状态机、事件日志、配对链接、载荷解析（`Protocol/`）；双通道管理、配对流程、配对存储、转写归约、SQLite 缓存、WebSocket 传输（`Remote/`）；应用状态 `AppModel` 与文案键 `L10n`（`App/`），中英文译文在 `Resources/Localizable.xcstrings`，跟随系统语言、其他语言回落英文。可在 macOS 上直接 `swift test`。 |
| `Vetta/` | iOS App：SwiftUI 界面、钥匙串、相机扫码；会话提醒（本地通知、图标角标、后台刷新）在 `Platform/`。 |
| `VettaWidgets/` | Widget Extension，只放灵动岛与锁屏上的 Live Activity 界面。 |
| `Shared/` | App 与 `VettaWidgets` 共同编译的源码（Live Activity 的属性类型）。 |
| `VettaUITests/` | XCUITest，驱动真实 App 走完整流程并截图。 |
| `scripts/` | 与桌面端真实实现对跑的 interop 夹具、UI 测试脚本、加密测试向量生成。 |
| `project.yml` | XcodeGen 工程定义；`Vetta.xcodeproj` 由它生成。 |

`VettaKit` 是 `packages/remote-control` 与原 Expo `src/remote`、`src/store` 的逐文件移植，文件头注释标出对应的 TypeScript 源。协议仍以 TypeScript 包为事实源，改协议时两边同时改，并跑下文的 interop 测试。

加密用 CryptoKit：X25519、HKDF-SHA256、ChaCha20-Poly1305；XChaCha20 的 24 字节 nonce 用标准 HChaCha20 子密钥构造（`RemoteCrypto.hchacha20`），由 draft-irtf-cfrg-xchacha 测试向量、TypeScript 生成的交叉向量和与桌面端的真实联调三重校验。

## 开发

需要 Xcode 26+（iOS 26 SDK）与 [XcodeGen](https://github.com/yonaskolb/XcodeGen)。修改 `project.yml` 或增删文件后重新生成工程：

```bash
cd apps/mobile/client-apple
xcodegen generate
open Vetta.xcodeproj
```

真机运行需要自己的 Team（免费 Apple ID 即可本机签名）。签名写在本地、不进仓库：复制 `Config/Local.xcconfig.example` 为 `Config/Local.xcconfig`，填入 Team ID。不要在 Xcode 的 Signing & Capabilities 里直接选 Team，那会写进 `project.pbxproj`。

- iOS 首次连接电脑的局域网地址会弹「本地网络」权限，必须允许；`Info.plist` 已声明 `NSLocalNetworkUsageDescription` 与 `NSAllowsLocalNetworking`（局域网明文 `ws://`）。
- 扫码需要相机权限；模拟器没有相机，可用下文的 `-VettaPairURI` 或手动输入 IP 配对。
- `vetta://pair?...` 链接可直接唤起 App 完成配对。
- 配对页也支持连接码与密码、自建中继地址；已连接时可从首页抽屉的「连接电脑」重新打开配对。电脑在状态事件中公布新中继地址后，手机会保存并重连，保留正在查看的聊天。
- 远程桌面双指滑动在未放大时滚动电脑内容，放大后平移画面；捏合缩放。只读权限下不会向电脑发送滚动操作。
- 远程桌面的网络标签来自视频 transport 实际选中的 ICE 连接：结合原生 WebRTC 的网卡/VPN 信息与系统网卡真实掩码识别局域网、公网和 VPN；TURN 候选显示中继。网络切换不复用旧候选；地址隐藏、网卡证据不足或私网跨子网等不能确定范围的情况显示“P2P 直连（网络待确认）”。地址仅在内存中用于判断，不写入日志或缓存。

## 验证

```bash
cd apps/mobile/client-apple
(cd VettaKit && swift test --no-parallel)   # 单元测试：加密兼容、协议、连接、双通道、配对、转写、缓存、AppModel
xcodebuild test -project Vetta.xcodeproj -scheme Vetta -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:VettaRTCTests # 视频帧时间戳、Metal 绘制尺寸/刷新率与 UIKit 远程手势测试
scripts/screen-test.sh                      # 真实 WebRTC 视频：画面变化、点击回传、关闭后重新打开（需 bun install）
scripts/interop.sh                          # 与 apps/desktop 的真实 LAN 服务器和假中继对跑（需 bun install）
scripts/ui-test.sh                          # 模拟器（默认 iPhone 17 Pro）上跑 UI 测试，深浅色各截一套图到 build/ui-shots
```

若命令行 SwiftPM 只复制 `.xcstrings`，导致文案测试读到键名，先在 `VettaKit` 目录运行 `xcrun xcstringstool compile Sources/VettaKit/Resources/Localizable.xcstrings --output-directory "$(swift build --show-bin-path)/VettaKit_VettaKit.bundle"`，再重跑 `swift test --no-parallel`。这只编译测试构建目录中的资源，App 构建由 Xcode 自动处理。

`screen-test.sh` 使用临时配对、内存存储和独立 Electron 数据目录，只发送合成画布，不截取真实桌面或注入系统输入。测试从抽屉打开远程桌面，检查截图中的红蓝画面持续变化、点击经 DataChannel 回到主机后画面变绿，再关闭并重新打开检查恢复；仅有帧率而没有画面也会失败。截图保存在 Xcode 测试结果中，夹具日志在 `build/screen-logs`。该夹具每次只接一部新手机，测试脚本在退出时自动清理进程与临时目录。

模拟器 App 也要保留 Xcode 默认签名，不要用 `CODE_SIGNING_ALLOWED=NO` 构建后覆盖日常调试安装；缺少模拟器的 `application-identifier` entitlement 会让钥匙串返回 `-34018`，内存存储测试无法发现这个问题。合成视频测试只证明编解码与交互通路；真实远程桌面验收还需通过正常配对入口连接实际电脑、看到屏幕内容随操作变化，并检查 App 重启后配对仍有效。

外网访问开关不能替代 macOS 的系统录屏授权。开发环境从终端或 IDE 启动时，macOS 可能将 Electron 的录屏请求归属于启动它的应用，例如 Orca；只给正式版 Vetta 或 Electron 授权仍可能被拒绝。先核对当前进程的 TCC 日志中 `AUTHREQ_ATTRIBUTION` 与 `AUTHREQ_SUBJECT`，确认实际授权对象，再由用户决定是否授权；不要仅按进程名称猜测。权限调整后按系统提示重启相关开发进程，并重新打开手机远程页面验证真实画面。

UI 测试只构建一次，再按外观各跑一遍。每个用例都是一部新手机、自己完成配对（夹具在 UI 测试里允许新手机顶替旧配对），彼此独立，按界面划分：工作列表、聊天与模型菜单、失败的一轮、新会话与附件及提问、设置。改哪块界面就只跑那块：`scripts/ui-test.sh --fast --only testChatMergesRepliesAndSwitchesModel`（逗号分隔可跑多个），只跑深色、不截图；一批界面改动完成时再完整跑一次深浅两套并看截图。

`scripts/interop-desktop.ts` 也可以单独运行，作为模拟器调试用的"桌面端"：它打印配对链接，把链接通过 Debug 启动参数交给 App 即可跳过系统的"在 Vetta 中打开"确认：

```bash
bun scripts/interop-desktop.ts /tmp/vetta-interop.json
xcrun simctl launch booted com.openvetta.mobile -VettaPairURI "$(jq -r .invite /tmp/vetta-interop.json)"
```

`-VettaEphemeralStorage` 让 App 使用内存存储（UI 测试用，每次启动都是全新安装的状态）。它同时关掉通知和 Live Activity，免得权限弹框挡住 UI 测试。

提醒不经过 Apple 推送服务：App 离开屏幕后约半分钟内、以及系统安排的后台刷新时，状态变化才会变成通知并更新 Live Activity；再之后 Live Activity 过 15 分钟标为过时。要在模拟器上看后台通知，给夹具加 `VETTA_INTEROP_ASK_AFTER_MS=25000`，配对后把 App 切到后台，时间一到 `s-build` 会发起提问。
