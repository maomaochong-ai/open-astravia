# ADR-0140：iPhone 接入 P2P 与远程桌面，画面改为按需推流

## 状态

已接受（扩展 ADR-0135，使其不再仅限 Android；在 ADR-0128 的协议 v2 上启用握手里预留的 `screen` 能力位）

## 背景

Android 已能通过 WebRTC 查看和操控电脑，并按 ADR-0135 把会话、聊天、文件等控制消息迁到同一条 P2P 连接的 `vetta-control-v2` 通道上。iPhone 客户端（ADR-0129）只有局域网与中继两条链路，没有远程桌面。

把 Android 的做法原样搬到 iPhone 前，发现它有一个隐藏代价：P2P 控制通道和屏幕视频共用一个 PeerConnection，电脑建连时总把屏幕轨道加进去且从不暂停。只要手机走在 P2P 上，哪怕只是聊天，电脑都在持续截屏、编码、推流：

- 手机在蜂窝网络下持续耗流量、耗电；
- 电脑持续承担编码负载；
- macOS 菜单栏的录屏指示灯常亮。

另外，电脑缺少 macOS 屏幕录制权限时，手机只看到黑屏；缺少辅助功能权限时，操作静默失效，手机无从得知原因。

## 决策

### iPhone 与 Android 同等接入 P2P

iPhone 按 ADR-0135 的规则接入：局域网或中继先连通，再升级到 WebRTC 控制通道；P2P 失败时回退，前台时定期重试（超时 12 秒，探测间隔 20 秒）。聊天、会话、文件面板等所有控制消息都走当前优先级最高的链路。

- WebRTC 使用 `webrtc-sdk/Specs`，与 Android 的 `io.github.webrtc-sdk:android` 同源，尽量对齐同一个里程碑版本。
- `VettaKit` 只放平台无关的部分：信令与输入消息的编解码、`P2PTransport` 协议、通道状态机、坐标换算、键码映射，全部可用假传输单测。真正的 PeerConnection 与视频视图放在单独的 `VettaRTC` target，只有 App 依赖它，`swift test` 不链接 WebRTC 二进制。
- 进入后台时，iPhone 主动取消画面订阅、发送 `end(peer_closed)` 并关闭 PeerConnection，不申请任何后台保活。回到前台时先走局域网或中继，再重新升级到 P2P；如果切走前停在远程桌面页，就自动重新订阅。
- 仍然只用 STUN，不引入 TURN。直连失败时，控制消息走中继，远程桌面页提示当前网络无法直连电脑。

### 画面按需推流，随订阅启停截屏

- 电脑建连时用 `addTransceiver("video", { direction: "sendonly" })` 预留视频位置，不再要求建连时就有画面。
- 控制协议新增请求 `screen.subscribe { active }`。手机进入远程桌面页时发 `true`，离开时发 `false`。
- 订阅时电脑重新调用 `getDisplayMedia`，再用 `replaceTrack` 换上新轨道；取消订阅时停止轨道，并 `replaceTrack(null)`。没人看画面时，电脑不截屏，录屏指示灯熄灭。
- 这样换来的代价是：每次进入远程桌面，都要多等一次截屏启动加一个关键帧。

没有采用只把轨道设为 `enabled = false` 的做法：那样截屏仍在进行，指示灯照样常亮。

### 权限状态回报

电脑对 `screen.subscribe` 的响应和之后的 `screen.status` 事件都带两个字段：

- `screen`：`streaming | permission_denied | unavailable`；
- `input`：`ready | permission_denied | unsupported`。

电脑在截屏前先检查 macOS 的屏幕录制与辅助功能权限。缺权限时，手机直接说明原因和电脑上的设置路径：没有屏幕录制权限就不显示黑屏；没有辅助功能权限就只能看、不能操作。电脑端在手机首次订阅时提示用户去授权，但不主动触发 macOS 的系统授权弹窗，因为这时用户多半不在电脑前。Windows 与 Linux 总是回报 `streaming` 和 `ready`。

### 能力位与兼容

- 手机在 `hello` 里声明 `screen: true`，表示「我会按需订阅画面」。
- 电脑在 `device.status` 里声明 `screen: true`，表示「支持 `screen.subscribe`」。沿用 ADR-0139 的结论，手机只以 `device.status` 为准。

| 手机 | 电脑 | 行为 |
|---|---|---|
| 声明 `screen` | 声明 `screen` | 按需推流 |
| 旧 Android（不声明） | 新 | 电脑对这台手机保持旧的常开截屏行为 |
| iPhone | 旧（不声明） | iPhone 不升级到 P2P，远程桌面页提示更新电脑端；控制消息照常走局域网或中继 |
| 新 Android | 旧 | 维持原有的常开行为 |

iPhone 不和旧电脑建立 P2P，是为了避免一上线就承担常开视频的流量与电量代价。

### iPhone 远程桌面交互

- 交互沿用 Android 的直接触控模型：
  - 点按：左键单击；
  - 长按：右键；
  - 拖动：按住左键拖；
  - 双指捏合：缩放、平移本地画面；
  - 双指滑动：滚动电脑。
- 在此基础上，iPhone 还提供：
  - 长按时显示放大镜；
  - 点击、右键、开始拖动时有触觉反馈；
  - 键盘上方的修饰键工具栏（Esc、Tab、⌃、⌥、⌘、⇧、方向键），修饰键点一下作用于下一个按键，双击锁定；
  - 把手机剪贴板的文字粘贴到电脑（拆成多条 `text` 消息发送）；
  - 外接硬件键盘直接映射为 DOM `code`。
- 远程桌面以全屏页打开，只有这一页允许横屏。入口有三处：首页抽屉、设置页、长按 App 图标的快捷菜单。
- 电脑关闭了这台手机的远程控制（`desktopControl: false`）时，入口照常显示，点进去说明原因。

## 后果

- 只聊天时，电脑不再截屏，Android 和 iPhone 都省下流量与电量；代价是进入远程桌面时画面会晚几百毫秒出来。
- 黑屏和操作无响应有了明确原因，不用再靠排查文档逐项猜。
- iPhone 引入第一个第三方二进制依赖。它只在 App target 中链接，不影响 `VettaKit` 的测试。
- 以下内容推迟到后续版本：把电脑剪贴板同步回手机、多显示器切换、画质档位、触控板模式、控制中心按钮。
