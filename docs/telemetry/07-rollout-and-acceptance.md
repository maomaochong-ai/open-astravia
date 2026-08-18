# 7. 实施路线与验收

## 7.1 总原则

按“数据和隐私决策 → 统一身份 → Sentry → PostHog Analytics → PostHog Replay → 跨系统关联”的顺序实施。先让每个平台在自己的主责范围内工作，再建立关联，避免一开始同时排查两套 SDK。

## 7.2 阶段 0：数据与产品策略

确认：

- 错误与崩溃报告、产品分析、Replay 三个用户设置；
- production/staging 的 Sentry/PostHog project；
- anonymousUserId 派生规则；
- 产品事件目录和 owner；
- Sentry 禁止字段；
- PostHog event 禁止字段；
- Replay 默认遮罩和允许显示区域；
- Sentry、PostHog 的数据区域、留存、删除和访问权限；
- 告警和数据看板负责人。

验收：

- 有字段级数据清单；
- 有用户关闭和身份删除路径；
- 没有“后续再脱敏”的未决敏感区域。

## 7.3 阶段 1：统一契约与身份

改动方向：

- runtime-telemetry 增加 ErrorReporter 和错误上下文；
- desktop 增加 AnalyticsClient、TelemetryContext 和 Noop 实现；
- Main 生成 appSessionId 和统一身份；
- Preload 提供只读、强类型桥；
- 登录、登出和账号切换统一编排。

验证：

- Main/Renderer 身份一致；
- appSessionId 每次启动更新；
- 退出后两边身份都清除；
- Renderer 不能覆盖 release、environment 和用户 ID；
- SDK 未配置时应用正常启动。

## 7.4 阶段 2：Sentry

改动方向：

- 接入 Sentry Electron Main/Renderer；
- 捕获 Main、Preload、Renderer 和 React 错误；
- 接入原生崩溃；
- 配置 beforeSend 和 breadcrumbs 脱敏；
- 配置关键性能 Span；
- 完成 release/source map CI；
- 建立 staging/production 告警。

验证：

- 每类异常只上报一次；
- production 堆栈正确还原；
- Main/Renderer/process/window 信息正确；
- 原生测试崩溃进入 staging；
- prompt、文件内容、终端输出和 token 不出现；
- Sentry Replay 未启用。

## 7.5 阶段 3：PostHog 产品分析

改动方向：

- 建立强类型产品事件目录；
- 接入 Renderer PostHog；
- Main 发送宿主产品事件；
- 接入统一 identity；
- 配置 Feature Flag exposure；
- 建立核心漏斗和健康看板。

验证：

- 一个产品事实只有一个事件；
- 事件属性全部来自白名单；
- 不存在 $exception；
- 不存在异常 stack/message；
- Main/Renderer 事件能通过 appSessionId 关联；
- 产品分析关闭后不再发送事件。

## 7.6 阶段 4：PostHog Replay

改动方向：

- 默认 maskAllInputs；
- 默认 maskTextSelector="*"；
- 编辑器、聊天、终端、文件预览、认证和敏感设置使用 ph-no-capture；
- 关闭 console 与网络 body 录制；
- URL 去除 query/fragment；
- 只对安全 UI 选择性解除遮罩；
- 配置独立 Replay 用户开关和采样。

验证：

- Replay 中看不到源码、文件名正文、聊天和终端；
- 输入内容和凭据不可恢复；
- 网络请求不包含 header/body；
- 关闭 Replay 后立即停止；
- 遮罩后仍能识别导航、操作类别和失败位置。

## 7.7 阶段 5：跨系统关联

改动方向：

- 实现 ErrorProductBridge；
- Sentry event 附加 PostHog session/replay；
- 用户影响错误发送 desktop.error.experienced；
- PostHog marker 附加 sentryEventId；
- 配置 PostHog Sentry Source；
- 建立联合产品健康看板。

验证：

- 从 Sentry 能定位 PostHog Replay；
- 从 PostHog marker 能定位 Sentry event；
- Main-only 错误没有虚假的 Replay；
- userImpact=none 不生成 marker；
- Sentry Source 数据不被当作实时产品事件；
- PostHog 中没有重复 exception。

## 7.8 阶段 6：灰度

建议顺序：

1. 内部开发环境；
2. staging production bundle；
3. 内部用户；
4. 小比例 production；
5. 扩大错误上报；
6. 扩大产品分析；
7. 最后单独扩大 Replay。

每一步观察：

- 启动耗时；
- Renderer 内存；
- 安装包体积；
- SDK 网络失败；
- Sentry 事件量和告警噪声；
- PostHog event/replay 成本；
- 用户隐私反馈。

## 7.9 测试矩阵

| 场景 | Sentry | PostHog | 预期 |
|---|---|---|---|
| Main uncaught error | error | 无 marker | 有堆栈，无 Replay |
| Renderer 阻断错误 | error | error marker + replay | 双向可关联 |
| React 已处理且无用户影响 | error/warning | 无 marker | 不污染产品指标 |
| Agent run 失败 | error | run.failed + 可选 marker | 不重复同一产品事实 |
| 登录/登出 | user 更新/清除 | identify/reset | 不串用户 |
| 产品分析关闭 | 正常 | 无事件 | Sentry 不受影响 |
| 错误报告关闭 | 无错误上传 | 正常产品事件 | PostHog 不受影响 |
| Replay 关闭 | 正常错误 | analytics 正常、无 replay | 开关独立 |
| 断网 | SDK 有界处理 | SDK 有界处理 | 应用主流程正常 |
| 原生崩溃 | native crash | 无异常详情 | 只由 Sentry 处置 |

## 7.10 隐私验收

构造包含以下内容的错误、产品事件和 Replay 场景：

- Bearer token；
- API key；
- Cookie；
- Windows/POSIX 用户目录；
- 带 token 的 URL；
- 文件正文；
- prompt 和模型输出；
- 终端命令与输出；
- IM secret；
- 登录表单；
- 循环引用和超长对象。

检查：

- Sentry event、breadcrumb、tag、context、attachment；
- PostHog event properties；
- PostHog Replay DOM、console、network、URL；
- SDK 本地诊断日志。

任何一条路径泄漏都阻断上线。

## 7.11 SDK 共存验收

- production bundle 中 Sentry debug ID 正确；
- source map 能映射 Main/Preload/Renderer；
- PostHog SDK 不捕获 exception；
- Sentry SDK 不启用 Replay；
- console/fetch/XHR 没有重复 patch；
- React Error Boundary 不重复上报；
- 两个 SDK 初始化顺序稳定；
- 升级任一 SDK 后重新运行 integration smoke test；
- app 启动、内存和安装包体积在预算内。

## 7.12 首版完成标准

- [ ] Sentry 是唯一错误、Trace、原生崩溃和告警系统。
- [ ] PostHog 是唯一产品分析、Replay 和 Feature Flag 系统。
- [ ] 业务代码没有 Sentry/PostHog SDK 调用。
- [ ] runtime-telemetry 不依赖供应商包。
- [ ] TelemetryContext 在 Main/Renderer 一致。
- [ ] 登录、登出和账号切换不会串用户。
- [ ] PostHog 不存在 $exception 和异常堆栈。
- [ ] Sentry 不启用 Replay。
- [ ] 用户影响错误能双向关联 Sentry 和 PostHog。
- [ ] Main-only 错误不伪造 Replay。
- [ ] production source map 正确。
- [ ] Replay 使用最大隐私，并通过敏感场景检查。
- [ ] 三类用户设置相互独立且走 i18n。
- [ ] 任一平台失败不影响应用。

## 7.13 明确不做

首版不做：

- provider selector；
- Sentry/PostHog 错误双写；
- PostHog Error Tracking；
- Sentry Replay；
- 通用 Telemetry Gateway；
- 自建错误 UI、Issue workflow 或 minidump 符号化；
- 全量 console 和本地日志上传；
- 任意 extra 属性；
- 自动上传 prompt、响应、文件正文和终端输出。
