本 Kotlin Multiplatform Android 客户端支持远程协议 v2：可以扫描 Desktop 的配对二维码，通过端到端加密的 Cloudflare 中继连接电脑。当前 Android 版本尚未实现局域网优先切换；二维码未包含中继地址时无法连接。

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

Run the Cloudflare relay and Desktop locally, then scan the v2 pairing QR code shown in Desktop settings. The device detail screen renders the peer-to-peer desktop stream; pointer, wheel, and hardware keyboard events use the WebRTC DataChannel rather than the control relay.

---

Learn more about [Kotlin Multiplatform](https://www.jetbrains.com/help/kotlin-multiplatform-dev/get-started.html)…
