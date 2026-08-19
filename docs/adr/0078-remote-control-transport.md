---
status: accepted
---

# Mobile 到 Desktop 的远程控制传输边界

## 背景

Android 端目前只有云端 Gateway 客户端，桌面端的本地 RPC 只绑定到 localhost，设备列表仍是演示数据。要让手机控制桌面 Agent，需要一个不依赖公网入站连接的双向传输，并且要能在没有真实手机、模型或 Cloudflare 账号的情况下验证。

## 决策

新增 `@vetta/remote-control` 作为平台无关的协议和连接生命周期合同。它只定义：

- 版本化 JSON 帧、请求/响应关联、事件序号和 ACK；
- 连接状态转换与断线恢复边界；
- Transport、Logger 和时钟等窄接口；
- 可控延迟、丢帧和断线的 Fake Transport。

桌面 Connector、Android Transport、Fake Relay 和 Cloudflare Durable Object 都是协议消费者，不把任意 Electron IPC、本地 Action RPC token 或 Agent 内部对象暴露为远程合同。

桌面端和 Android 端均主动连接中继；中继只负责配对、鉴权、在线状态和转发。屏幕/输入通道另行使用 WebRTC，不进入本协议。

## 保持的不变量

1. 非法版本、角色、帧类型、请求 ID 和事件序号必须在边界被拒绝。
2. requestId 必须幂等地关联一个 response；重复 response 不得再次完成请求。
3. event sequence 单调递增；重复事件被忽略，跳号进入恢复状态。
4. 断线不会静默丢失待处理请求；请求由调用方决定重试，连接状态明确进入 reconnecting。
5. 日志只记录设备、连接、请求和序号等诊断元数据，不记录 token、prompt 或文件内容。

## 后果

协议包可被 TypeScript、Kotlin 和 Cloudflare Worker 独立实现并做合同测试。代价是需要维护跨语言字段镜像；协议字段变更必须同步更新 Kotlin DTO、Fake Relay 和 Durable Object 合同测试。
