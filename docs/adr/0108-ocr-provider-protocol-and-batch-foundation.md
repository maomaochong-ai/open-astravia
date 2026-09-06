# ADR-0108：OCR 以可扩展 Provider 协议提供批量图片识别

## 状态

已接受

## 背景

阅读器、图像工具和未来插件都需要识别图片中的文字，但把 OCR 做成 PDF 专用解析器会把能力绑定在错误的场景。线上识别服务在请求封装、批量限制、异步状态、语言提示和结构化结果上差异很大；宿主若暴露某一家服务的字段，后续更换 Provider 就会产生破坏性 API 变更。

## 决策

1. `@vetta/capability-sdk` 定义版本化 `OcrRequest/OcrResult/OcrProviderDescriptor` 合同。消费者只提交 `inputs[]` 图片批次和 `output` 能力，不能看到 Provider 的密钥、网络客户端或内部任务字段。
2. `OcrService` 负责权限、配置选择、批次能力协商、取消、进度和结果顺序校验；Provider 只实现 `recognize(request, context)`。单张图片是长度为 1 的批次。
3. 内置 `desktop-app:ppocrv5` 是默认本地实现，来自百度开源 PaddleOCR 视觉模型；协议不包含百度云 API 语义。远程或其它本地实现通过 Plugin SDK `ctx.ocr.registerProvider()` 注册，并由 manifest 权限及 Agent 配置共同门控。
4. OCR 是基础能力，PDF 页渲染、截图转图片、文本层回退、OCR 缓存与阅读交互属于上层插件。宿主不提供 PDF Annotation Provider，也不把 PDF 解析写入 OCR 基础层。
5. 输入通过宿主管理的 plugin blob/workspace file 引用传递；Provider 只能通过受控 `getInputUrl` 与 `uploadInput` 读取，不能获得其它插件路径或凭证。结果使用核心字段加可选 blocks/regions，未知扩展字段由边界校验丢弃。

## 备选方案

- 为每个供应商增加专用宿主 API：短期接入快，但会把供应商字段、认证和重试策略固化在公共合同中。
- 在 Shimo 内实现 OCR：能快速完成 PDF，但图像、截图和其它插件无法复用，且宿主权限无法统一治理。
- 只支持单图：调用简单，却迫使批量场景重复初始化模型、增加费用和延迟。

## 后果

内置实现开箱即用；插件可以在不升级 Shimo 的情况下提供远程 Provider。Provider 作者需要处理自身 API 的异步/同步差异并归一化结果，宿主只保证统一生命周期和安全边界。协议未来以 `protocolVersion` 演进，新增字段保持可选，重大语义变化通过新版本协商。
