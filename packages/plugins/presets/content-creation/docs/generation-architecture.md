# 内容生成与插件凭据架构

## 决策

- 内容生成通过可注册的 Provider Adapter 执行，React 组件不直接发送供应商请求。
- 插件设置中声明为 `type: "secret"` 的值由宿主拆分到统一 `CredentialVault`，不再写入明文 `plugin-settings.json`。
- 生产运行时使用真实 OpenAI 兼容图片接口；测试使用 Vitest 模拟 Provider、网络和 Artifact Store，不依赖真实密钥或计费服务。
- 生成入口、模型选择、错误提示和结果预览绑定到选中的画布节点；不使用常驻右侧属性面板。
- 时间线不参与当前生成流程。

## 凭据流

1. 插件在 `plugin.json` 的 `contributes.settings` 中声明 secret 字段。
2. 设置 UI仍通过原有插件设置 IPC 保存值。
3. 宿主根据已安装插件的 setting schema 识别 secret 字段。
4. secret 写入 Electron `safeStorage` 支持的统一凭据库，普通设置继续写入 `plugin-settings.json`。
5. 插件运行时仍通过 `ctx.settings` 读取自己的有效设置，不接触凭据文件和加密实现。
6. 旧版本留在 `plugin-settings.json` 的明文 secret，在安全存储可用时自动迁移并从 JSON 删除。

安全存储不可用时，新 secret 写入会失败，不会退化为新的明文保存；已有明文仅保留兼容读取，等待后续迁移。

## 生成执行流

```text
ContentNodeCard / NodeInlineEditor
  -> ContentGenerationService
  -> ContentProviderRegistry
  -> ContentProviderAdapter
  -> host-mediated PluginNetworkApi
  -> ContentArtifactStore
  -> PluginStorageApi.putBlob
  -> job.succeed + asset + node.assetId
```

`ContentGenerationService` 负责领域编排：解析节点或上游提示词、创建任务、调用 Provider、保存产物并把结果写回项目。Provider 只负责模型描述和请求/响应转换，Artifact Store 只负责保存内容字节。

当前真实适配器覆盖 OpenAI 与 OpenAI 兼容图片生成端点。模型 ID、兼容服务地址和密钥来自插件设置；项目中只保存 `providerId`、`modelId` 和领域参数，不保存密钥。

## 测试边界

- `PluginSettingsStore`：加密落盘、明文迁移、安全存储不可用。
- `OpenAiImageProvider`：请求路径、鉴权头、请求体和响应解析，网络完全模拟。
- `ContentGenerationService`：模拟 Provider 与 Artifact Store，验证任务、节点状态和素材回流。
- 测试不得请求真实模型，也不得依赖用户机器上的密钥。

## 后续扩展

- 将任务执行迁移到可恢复的后台队列，支持重启恢复、取消和重试。
- 增加参考图输入、图片编辑与多个候选结果。
- 将 Provider 错误归一化为稳定错误码，由 UI通过 i18n 显示。
- Agent 通过独立执行工具调用同一个 `ContentGenerationService`，不直接拼接供应商请求。
