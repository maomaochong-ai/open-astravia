# ADR-0117：媒体 Provider 发布模型目录并受控读取调用输入

## 状态

已接受

## 背景

媒体协议 v4 只描述 Provider 级能力。一个 Provider 聚合 OpenAI、Google 等多个上游时，宿主只能选择 Provider，不能保存具体模型，也无法判断模型是否支持文生图或图生图。部分图片 API 接受 multipart 上传，Gemini 一类 API 则要求把图片字节作为 `inlineData` 放进 JSON；已有 `uploadInput()` 不能安全、正确地适配后者。

## 决策

1. Media Protocol v5 在 `generate` capability 上增加可选 `models` 与 `defaultModelId`。模型 ID 是 Provider 内稳定路由，可带来源显示信息与自身支持的生成模式。
2. 宿主在注册时校验模型 ID、模式和默认值，在提交时解析默认模型；调用者显式指定的模型不可用时返回 `invalid-request`，不静默切换。
3. Agent 图片设置分别保存 Provider ID 与模型 ID。旧配置只含 Provider 时继续使用 Provider 默认模型；已保存但暂时不可用的模型保留并在 UI 标记。
4. Plugin Media handler context 增加 `readInput(inputId)`。宿主只允许读取当前调用中已经解析出的输入，不暴露真实路径；单输入限制 32 MB，并继承调用取消、超时与卸载生命周期。
5. 省略模型目录的存量 Provider 保持 v4 的 Provider 级行为。公开 SDK 与宿主 API 同步推进，使用新字段的插件要求 `pluginApiVersion ^2.4.0`。

## 备选方案

- 每个模型注册成独立 Provider：会把供应商与模型两个层级混在一个 ID 中，设置页重复 Provider，且动态模型变化导致大量注册抖动。
- 由消费插件自行保存模型字符串：无法统一验证能力，也会让每个消费方重复目录与迁移逻辑。
- 给 Provider 暴露输入文件路径：实现简单，但越过命名空间与调用生命周期边界，扩大本地文件读取权限。

## 后果

聚合 Provider 可以在一个稳定 Provider ID 下展示多个供应商和模型，用户的显式选择可持久化且不会被静默替换。Provider 作者需要维护稳定模型 ID 和真实模式声明；必须内联大图片的 API 受 32 MB 上限约束，更大的输入应使用流式上传或返回明确错误。
