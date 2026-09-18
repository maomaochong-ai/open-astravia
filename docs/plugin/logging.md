# 插件日志

Plugin API 2.5.0 起，插件可以从独立 SDK 子路径导入已经绑定身份的 logger：

```ts
import { logger } from "@vetta-org/plugin-sdk/logger";

logger.info("Model synchronization completed", { modelCount: 12 });
logger.error("Model synchronization failed", { channel: "codex", error });
```

logger 的 `pluginId` 与版本来自构建时校验过的 `plugin.json`。插件不传 `ctx`，也不能自行声明或覆盖日志身份。`@vetta-org/plugin-vite` 在生产构建与开发服务器中把该子路径替换成当前插件专属的 facade；没有经过兼容构建工具处理时，调用会给出明确错误，不会写出无法归属的日志。

需要区分模块时使用子作用域：

```ts
const log = logger.child("models").child("sync");

log.debug("Catalog request started");
log.info("Catalog published", { modelCount: 12 });
```

可用级别为 `debug`、`info`、`warn`、`error`。第二个参数必须是字段对象；异常放进 `error` 字段，宿主会保留名称、消息、堆栈和 cause 链。

## 持久化与隐私

日志进入 Desktop 的 Renderer 日志管线，由宿主统一持久化、轮转并纳入诊断信息。宿主限制消息和字段大小、处理循环引用，并对常见敏感字段名、Bearer、JWT、敏感 URL 参数和邮箱做防御性脱敏。

脱敏不是插件泄露秘密的许可证。不要记录 token、Cookie、Authorization header、OAuth 内容、完整用户文件或凭据；对象字段名不明显时，宿主无法判断其中是否包含秘密。

logger 无需权限：它只能写宿主管理的诊断通道，不能选择路径、读取日志或关闭轮转。它也不替代 `ctx.ui.notify()`——用户需要知道并采取行动的失败仍应通知；logger 用于开发者诊断和事后定位。

## 版本要求

使用该入口的插件需要：

- `@vetta-org/plugin-sdk >= 0.3.7 < 0.4.0`
- `@vetta-org/plugin-vite >= 0.2.3 < 0.3.0`
- `plugin.json#pluginApiVersion` 声明 `^2.5.0`

旧插件不导入 logger 时保持原行为。
