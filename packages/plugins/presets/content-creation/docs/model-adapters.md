# 模型目录与适配器

## 分析结论

Loomic 与 Open-AI Canvas 的模型接入方式不能直接合并成一张硬编码列表：

- Loomic 由 Provider 持有明确的图片/视频模型目录，并在服务端注册表中汇总；
- Open-AI Canvas 主要注册渠道协议，模型名称由系统渠道或用户渠道动态提供；
- 两者共同点是节点只保存 `providerId + modelId + 领域参数`，请求差异留在 Provider 层。

本插件采用“内置目录 + 可配置协议”的组合：内置目录提供可靠的模型元数据和选择体验；兼容服务设置允许接入 Open-AI Canvas 一类动态渠道，不要求修改节点代码。

## 当前目录快照

模型清单来自本地 Loomic 实现快照，只复制模型标识与能力信息，不复用其源代码。

| 适配器 | 能力 | 模型 |
| --- | --- | --- |
| `openai` | 图片 | GPT Image 2、GPT Image 1.5、GPT Image 1 |
| `replicate` | 图片 | Nano Banana Pro / 2 / Nano、Imagen 4、GPT Image 1.5、Flux Kontext Max / Pro、Seedream 5 Lite / 4.5 / 4、Recraft V3 |
| `replicate` | 视频 | Kling 3 / 3 Omni / 2.6 / O1、Seedance 1.5 Pro、Wan 2.6、Sora 2 / 2 Pro、Veo 3 / 3.1 / 3.1 Fast、Hailuo 2.3 |
| `google` | 图片 | Gemini 3 Pro Image Preview、Gemini 3.1 Flash Image Preview、Gemini 2.5 Flash Image |
| `google` | 视频 | Veo 3.1 / 3.1 Fast / 3.1 Lite、Veo 3 / 3 Fast、Veo 2 |
| `custom` | 图片 | 设置中的 OpenAI Images 兼容模型 |
| `custom-video` | 视频 | 设置中的 NewAPI Video Generations 兼容模型 |

Open-AI Canvas 的模型本身来自渠道，不存在可完整复制的固定列表。本插件对应实现了它的两个关键扩展点：OpenAI Images 兼容图片协议和 NewAPI Video Generations 兼容视频协议。Gemini Veo 由 `google` 适配器直接覆盖。

## 代码边界

```text
NodeGenerationComposer
  -> ContentModelDescriptor（只按能力过滤）
  -> ContentGenerationService（任务与产物编排）
  -> ContentProviderRegistry（providerId 路由与能力校验）
  -> ContentProviderAdapter（协议映射、轮询、媒体下载）
  -> PluginNetworkApi（宿主代理网络）
```

- `model-catalog.ts`：模型 ID、显示名、能力、比例、时长和分辨率；
- `create-provider-registry.ts`：唯一的内置适配器装配入口；
- `openai-image-provider.ts`：OpenAI Images；
- `replicate-provider.ts`：Replicate predictions，包含模型参数归一化和长任务轮询；
- `gemini-provider.ts`：Gemini `generateContent` 与 Veo `predictLongRunning`；
- `newapi-video-provider.ts`：可配置 NewAPI `/video/generations` 提交与轮询。

节点组件不判断模型字符串。模型特有的质量、尺寸、时长和端点差异只能出现在相应适配器中。新增同协议模型只修改目录；新增协议才创建适配器并在注册工厂中装配。

## 凭据与安全

- OpenAI、Replicate、Google 和兼容服务密钥均由插件 `secret` 设置声明，交给宿主安全存储；
- 项目文档和任务记录只保存 provider/model 引用，不保存密钥；
- Google Veo 下载使用请求头携带密钥，产物下载后立即写入插件 Blob 存储；
- 所有网络请求通过 `PluginNetworkApi`，渲染器不直接绕过宿主请求外部服务。

## 未错误兼容的协议

Open-AI Canvas 还包含火山即梦 AK/SK 签名、Vertex OAuth、xAI 官方视频等独立鉴权协议。它们不能安全地伪装成普通 Bearer 或 NewAPI 请求。本轮保留清晰的适配器边界，但不声明这些协议已经可用；后续接入时应各自实现签名、令牌刷新和错误归一化。

## 测试边界

适配器测试使用队列式模拟网络，验证目录、URL、鉴权头、请求体、轮询响应和媒体回存；生成服务测试使用模拟 Provider 与 Artifact Store 验证图片和视频任务。测试不读取用户密钥，也不调用真实模型。
