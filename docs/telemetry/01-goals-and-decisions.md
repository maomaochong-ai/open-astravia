# 1. 目标、边界与关键决策

## 1.1 问题定义

Sentry 与 PostHog 都包含错误、事件和 Replay 相关能力，但核心关注点不同：

- Sentry 围绕错误、代码、堆栈、性能、release 和工程处置组织数据；
- PostHog 围绕事件、用户、会话、漏斗、留存、实验和产品决策组织数据。

如果同时开启两边的重叠功能，会产生：

- 同一异常形成两套 Issue；
- 两套 Replay 重复录制；
- source map、release 和告警维护两份；
- console、网络和 DOM 被重复采集；
- 数据成本、SDK 开销和隐私面扩大；
- 团队不知道应该在哪个平台处理问题。

因此本方案不做自由路由，而是固定主责。

## 1.2 必须满足

- Sentry 是唯一的错误和性能处置系统。
- PostHog 是唯一的产品分析和 Replay 系统。
- 业务调用点不出现 Sentry/PostHog SDK API。
- 两边共享同一个匿名用户标识、App Session ID、release 和 environment。
- 完整异常只进入 Sentry。
- PostHog 只接收低敏感度产品事件和经过严格遮罩的 Replay。
- 用户可以分别关闭错误报告、产品分析和 Session Replay。
- 任一 SDK 初始化或发送失败不得改变业务行为。
- 本地 electron-log 继续独立存在，不自动全量上报。

## 1.3 非目标

- 不支持 Sentry-only、PostHog-only 的运行时切换。
- 不建设通用 Telemetry Gateway 或供应商 exporter 路由。
- 不将 ErrorReporter、AnalyticsClient、ReplayRecorder 合成一个大接口。
- 不让 PostHog 创建 $exception Issue。
- 不让 Sentry 承担漏斗、留存、实验和用户路径分析。
- 不启用两套 Replay。
- 不上传 prompt、模型响应、用户文件正文、终端完整输出和完整 IPC payload。
- 不自建 minidump 符号化服务。

## 1.4 职责矩阵

| 能力 | Sentry | PostHog | 说明 |
|---|---:|---:|---|
| JavaScript/Node 异常 | 主责 | 关闭 | Sentry 统一分组和告警 |
| Electron 原生崩溃 | 主责 | 不使用 | 依赖 Electron/Sentry 原生能力 |
| Source map / Release | 主责 | 不上传 | PostHog 不负责异常堆栈 |
| Trace / 性能 | 主责 | 不重复采集 | 只记录稳定操作名 |
| 产品事件 | 不使用 | 主责 | 强类型事件目录 |
| Session Replay | 关闭 | 主责 | 默认最大隐私 |
| Feature Flag / 实验 | 不使用 | 主责 | 产品发布与验证 |
| Survey | 不使用 | 主责 | 产品反馈 |
| 本地文本日志 | 不拥有 | 不拥有 | 继续由 electron-log 管理 |

## 1.5 关键决策

### 决策 A：使用供应商 SDK，但限制在 adapter

Sentry Electron 的跨进程、原生崩溃和 source map 能力，以及 PostHog Replay/Feature Flag 的客户端能力，都依赖各自 SDK。既然不要求自由切换，直接使用 SDK 比自建通用传输层更简单可靠。

平台依赖只能位于：

- desktop 的 Main/Renderer 装配入口；
- Sentry/PostHog 专用 adapter；
- release 构建脚本。

领域组件、hook 和 service 只调用 Vetta 自有接口。

### 决策 B：错误与产品分析使用独立契约

packages/runtime-telemetry 当前明确不负责 business analytics，因此：

- ErrorReporter 和通用错误上下文可以属于 runtime-telemetry；
- AnalyticsClient、ReplayRecorder 和 FeatureFlagClient 首版属于 desktop；
- 如果未来多个宿主确实需要共享产品分析契约，再单独评估抽包。

### 决策 C：建立窄的跨系统桥

跨系统桥只做两件事：

1. 把 PostHog session/replay 标识附加到 Sentry error context；
2. 对用户有影响的错误，在 PostHog 发送 desktop.error_experienced。

PostHog marker 不包含 message、stacktrace 或业务 payload；它不是第二份错误事件。

### 决策 D：PostHog Replay 默认最大隐私

Vetta 会展示源码、终端、聊天、prompt、模型输出和本机路径。Replay 必须默认：

- 遮罩全部 input；
- 遮罩全部文本；
- 阻止编辑器、终端、聊天、文件预览和敏感设置区域；
- 不录制网络 body 和 console；
- 仅显式放开安全的导航、按钮和状态。

如果最大隐私下 Replay 价值不足，优先增加结构化产品事件，不降低隐私标准。

### 决策 E：共同标识由 Vetta 定义

不能用 PostHog distinct_id、PostHog session ID 或 Sentry event ID 作为 Vetta 的主身份。Vetta 定义：

- anonymousUserId；
- appSessionId；
- release/buildId；
- errorCorrelationId。

平台 ID 只作为关联字段保存。

### 决策 F：错误运营只在 Sentry

错误告警、分组、状态、负责人和版本回归只在 Sentry 处理。PostHog 中的 Sentry Source 数据用于分析，不建立第二套错误工作流。

## 1.6 为什么不需要通用 Gateway

通用 Gateway 适合供应商切换和多 exporter，但本方案已经固定主责：

- Sentry SDK 需要直接发挥 Electron 和原生能力；
- PostHog SDK 需要直接处理 Replay、身份和 Feature Flag；
- Gateway 无法通用代理 Replay 和原生 minidump 的完整语义；
- 额外服务会增加队列、协议、运维和故障面。

只有出现以下独立需求时才重新评估 first-party proxy：

- 网络可达性；
- 数据驻留；
- 企业统一出口；
- 服务端二次脱敏；
- 供应商密钥或滥用控制要求。

这些需求不应以“未来可能切换平台”为理由提前建设。
