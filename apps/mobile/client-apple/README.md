# Vetta for iPhone（client-apple）

Vetta 手机端的 iOS 原生客户端（Swift 6 + SwiftUI，iOS 26 起，Liquid Glass）。它通过 `@vetta/remote-control` 的协议 v2 与 Vetta Desktop 配对，在手机上镜像电脑正在处理的会话：查看进度、继续追问、回答电脑弹出的提问、中止任务。Android 端在 [`../client-android`](../client-android)。

原 Expo/React Native 客户端已移出仓库；本工程在功能上与它一一对应（配对、双通道连接、会话镜像、离线缓存、设置项），界面按原设计还原，但全部换成系统原生控件：导航栏、分段控件、开关、弹层、`glassEffect` 玻璃材质。深浅色跟随系统，不提供应用内切换。

## 结构

| 路径 | 内容 |
| --- | --- |
| `VettaKit/` | Swift Package，平台无关的全部逻辑：协议帧与校验、加密、连接状态机、事件日志、配对链接、载荷解析（`Protocol/`）；双通道管理、配对流程、配对存储、转写归约、SQLite 缓存、WebSocket 传输（`Remote/`）；应用状态 `AppModel` 与文案键 `L10n`（`App/`），中英文译文在 `Resources/Localizable.xcstrings`，跟随系统语言、其他语言回落英文。可在 macOS 上直接 `swift test`。 |
| `Vetta/` | iOS App：SwiftUI 界面、钥匙串、相机扫码。 |
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

真机运行需在 Xcode 的 Signing & Capabilities 里选择自己的 Team（免费 Apple ID 即可本机签名）。

- iOS 首次连接电脑的局域网地址会弹「本地网络」权限，必须允许；`Info.plist` 已声明 `NSLocalNetworkUsageDescription` 与 `NSAllowsLocalNetworking`（局域网明文 `ws://`）。
- 扫码需要相机权限；模拟器没有相机，可用下文的 `-VettaPairURI` 或手动输入 IP 配对。
- `vetta://pair?...` 链接可直接唤起 App 完成配对。

## 验证

```bash
cd apps/mobile/client-apple
(cd VettaKit && swift test --no-parallel)   # 单元测试：加密兼容、协议、连接、双通道、配对、转写、缓存、AppModel
scripts/interop.sh                          # 与 apps/desktop 的真实 LAN 服务器和假中继对跑（需 bun install）
scripts/ui-test.sh                          # 模拟器（默认 iPhone 17 Pro）上跑 UI 测试，深浅色各截一套图到 build/ui-shots
```

UI 测试只构建一次，再按外观各跑一遍。改界面时用 `scripts/ui-test.sh --fast` 只跑深色、不截图，配合 `--only <测试方法名>` 只跑一个用例；提交前再完整跑一次，确认深浅两套截图。

`scripts/interop-desktop.ts` 也可以单独运行，作为模拟器调试用的"桌面端"：它打印配对链接，把链接通过 Debug 启动参数交给 App 即可跳过系统的"在 Vetta 中打开"确认：

```bash
bun scripts/interop-desktop.ts /tmp/vetta-interop.json
xcrun simctl launch booted com.openvetta.mobile -VettaPairURI "$(jq -r .invite /tmp/vetta-interop.json)"
```

`-VettaEphemeralStorage` 让 App 使用内存存储（UI 测试用，每次启动都是全新安装的状态）。
