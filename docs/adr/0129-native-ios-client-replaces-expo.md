# ADR-0129：iOS 手机端改为 Swift 原生，Expo 客户端移出仓库

## 状态

已接受（修订 ADR-0128 中"Expo 客户端是唯一跟进的手机端"与"React Native 共用 `@noble/*` 实现"两处）

## 背景

ADR-0128 让 Expo/React Native 客户端（`apps/mobile`）成为唯一跟进协议 v2 的手机端。落地后体验达不到要求：Uniwind、HeroUI Native 与 Hermes 上的加密补丁带来一连串启动与布局问题，界面也始终不是系统原生的质感。用户决定 iOS 端改用 Swift 原生重写，功能与原 Expo 版本一致，界面尽量还原原设计但使用原生组件与 Liquid Glass，深浅色跟随系统。

## 决策

- 手机端目录改为 `apps/mobile/<平台>`：`client-apple`（Swift/SwiftUI，iOS 26 起）与 `client-android`（原 `apps/kotlin` 平移，状态不变）。Expo 工程移出仓库、不再维护，相应的 workspace、根脚本与 CI 一并删除。
- `client-apple` 把协议与客户端逻辑放在本地 Swift Package `VettaKit` 中，逐文件移植 `packages/remote-control` 与原 Expo 的 `src/remote`、`src/store`。协议事实源仍是 TypeScript 包与 `schemas/remote-frame.schema.json`，Swift 端不引入协议差异。
- 加密改用 CryptoKit 的 X25519、HKDF-SHA256 与 ChaCha20-Poly1305。CryptoKit 没有 XChaCha20，按标准做法用 HChaCha20 从 24 字节 nonce 派生子密钥后交给 IETF ChaCha20-Poly1305。这段约 30 行的构造用 draft-irtf-cfrg-xchacha 测试向量、由 TypeScript 包生成的交叉向量，以及对桌面端真实 LAN 服务器的联调测试共同约束。
- 兼容性靠自动化保证：`scripts/interop.sh` 启动 `apps/desktop` 的 `DesktopRemoteLanServer` 与仓库的假中继，让 Swift 客户端走真实 WebSocket 完成扫码配对、手动配对、中继回退与会话镜像。

## 备选方案

- **继续修 Expo 客户端**：问题集中在第三方样式与组件层，修完仍不是原生质感，用户已明确放弃。
- **Swift 端通过 JavaScriptCore 复用 TypeScript 协议包**：可以避免双份实现，但要在 App 内嵌 JS 运行时并桥接 WebSocket 与随机数，调试与性能都更差；协议体量小且已有交叉测试，双份实现的维护成本可控。
- **引入第三方 libsodium 绑定获得 XChaCha20**：多一个二进制依赖，只为省下一个公开、可用测试向量验证的子密钥函数，不划算。

## 后果

- 改协议时需要同时改 TypeScript 包与 `VettaKit`，并跑 `scripts/interop.sh`；CI 的 `mobile-apple` 工作流在协议包变化时也会触发。
- iOS 客户端最低 iOS 26。
- Android 端仍是冻结在协议 v1 的 Kotlin 客户端，Android 用户暂时没有可用的新版客户端。
