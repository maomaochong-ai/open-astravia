本 Kotlin Multiplatform Android 客户端支持远程协议 v2：可以扫描 Desktop 的配对二维码，或手动输入电脑的局域网地址并核对 6 位验证码完成配对。连接先用局域网或 Cloudflare 中继完成发现、鉴权和 WebRTC 信令，随后把对话、状态、诊断、画面和输入全部切到 P2P；P2P 不可达或断开时自动退回局域网或中继并继续重试。

桌面侧的状态由 `domain/work/DesktopMirror`（对应 iPhone 端 `VettaKit` 的 `AppModel`）统一持有：配对记录（`domain/remote/pairing`）、唯一的桌面连接与断线重连（`domain/remote/link/DesktopLink`，对应 `ChannelManager`）、会话列表与聊天记录的离线缓存（`data/remote/SessionCache`，SQLite 存 JSON）。协议载荷解析、会话记录归并、按轮合并、筛选排序等纯逻辑按 `VettaKit` 逐文件移植，单元测试在 `commonTest` 中对应 iPhone 端用例；主机测试用 `commonTest` 里的 `FakeDesktop` 走真实的 v2 握手与加密。

This is a Kotlin Multiplatform project targeting Android.

* [/shared](./shared/src) is for code that will be shared across your Compose Multiplatform applications.
  It contains several subfolders:
  - [commonMain](./shared/src/commonMain/kotlin) is for code that’s common for all targets.
  - Other folders are for Kotlin code that will be compiled for only the platform indicated in the folder name.
    For example, [androidMain](./shared/src/androidMain/kotlin) holds the Android-specific `actual`
    implementations of the `expect` declarations in `commonMain`.

* [/androidApp](./androidApp/src) is the Android application entry point.

### Running the app

Use the run configurations provided by the run widget in your IDE's toolbar. You can also use this command:

- Android app: `./gradlew :androidApp:assembleDebug`

### Running tests

Use the run button in your IDE's editor gutter, or run tests using Gradle tasks:

- Android tests: `./gradlew :shared:testAndroidHostTest`
- Android emulator/device tests: `./gradlew :shared:connectedAndroidDeviceTest`

### Remote Desktop developer preview

Run the Cloudflare relay and Desktop locally, then scan the v2 pairing QR code shown in Desktop settings. The device detail screen renders the peer-to-peer desktop stream; pointer, wheel, hardware keyboard, chat, status, and diagnostics use WebRTC DataChannels after bootstrap.

---

Learn more about [Kotlin Multiplatform](https://www.jetbrains.com/help/kotlin-multiplatform-dev/get-started.html)…
