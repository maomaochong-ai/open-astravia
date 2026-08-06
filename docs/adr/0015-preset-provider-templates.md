# 预设服务商走服务端模板 + BYOK 直连，与远程网关并存

> 目录来源部分已被 [ADR-0050](./0050-preset-providers-move-client-side-with-dynamic-model-lists.md) 取代：预设目录改为客户端内置、模型列表向服务商 `/models` 动态拉取。BYOK 直连与 snapshot-on-key 持久化仍然有效。

为让普通用户「免配置、只填 key 就能用大模型」，新增**预设模板**机制：服务端维护一份 provider 模板目录（`baseUrl`、模型列表与能力参数、`api` 类型、图标 symbol，**不含 key**），客户端公开免登录拉取（新接口 `/providers/templates.json`）。用户填入**自己的 key**，请求**直连服务商原站**（BYOK），服务端不碰 key、不转发流量、不计费——与现有[远程网关](./0004-im-gateway-collapses-to-default-conversation.md)（JWT 代理转发、服务端计费）是两条独立并存的链路，术语上刻意不复用 "remote"。

**持久化用 snapshot-on-key**：用户给某模板填 key 的那一刻，模板被落成本地 `~/.vetta/agent/models.json` 的一个普通 provider 条目（带 `apiKey`），打标 `source:"template"` + `templateId`。由此 `getAvailable()` / `ModelSelector` / 离线 fallback 全部复用既有 model-registry 机制；coding-agent 无需感知模板，仅让其 `ProviderConfigSchema` 容忍 `source`/`templateId`/`icon` 字段即可共享同一份 models.json。fetch / 合并 / 写回只发生在 desktop-app main 进程。

**更新语义为「在线合并 / 离线回退快照」**：每次 fetch 成功用服务端最新 url/模型/参数覆写 `source:"template"` 的本地条目（只保留用户 `apiKey`）；服务端删除该模板或 fetch 失败时，本地快照照常可用。兼得「服务端能修正错误配置/推送新模型」与「下线/离线不影响存量用户」。

图标走 [icon symbol](../../CONTEXT.md)：客户端内置图标注册表，服务端只下发可选的唯一 symbol；网关 provider 配置同样新增 icon 字段。

**服务端用独立表存模板，不复用网关 `providers` 表。** 模板（`provider_templates` / `provider_template_models`）与网关供应商（`providers` / `provider_models`）是两张彼此独立的表、各自独立的 name 唯一索引、各自的 admin CRUD 与并列页面（admin「网关管理」下「模型配置」vs「预设模板」）。这样同名（如 `nvidia`）可**同时**作为网关供应商与预设模板存在——网关供应商客户端聚合进单一 `vetta-zen`、用服务端 key 代理转发；预设模板保留真实名称、用用户自带 key 直连。曾尝试在 `providers` 上加 `is_template` 布尔标记复用同表，但 name 唯一索引导致同名冲突、网关生成逻辑要处处 filter、语义混淆，遂改独立表。模板表刻意不含计费/限流字段（BYOK 不经服务端）。`providers` 表保留新增的 `icon` 字段（网关供应商也可配图标）。

## Considered Options

- **纯动态 `/models`**：各家 `/models` 只返回 id，拿不到上下文/vision/思考/价格等能力元数据，无法满足「预设好能力」，弃用——`/models` 在本方案中完全不使用（连 key 校验都不做，填即持久化，首次真实请求才暴露无效 key）。
- **冻结快照（采纳即永不跟服务端）**：服务端修错 url / 补新模型传不到存量用户，弃用。
- **客户端内置种子目录**：增加打包耦合且老项目易残留过期种子；选择「首启离线且拉取失败=空列表+提示重试」。
- **复用网关 `/providers/models.json` 同接口**：两种语义混在一起且继承「未登录不下发」限制，改为新建公开接口。

## Consequences

- `models.json` 会在 desktop 启动时被自动改写（仅限 `source:"template"` 条目；手搓的无标记条目绝不触碰）。用户手改模板条目会被下次 fetch 覆盖——模板归服务端所有。
- 首次安装离线时预设区为空，「免配置」承诺在冷启动断网下不成立（已知取舍）。
- key 明文存于 models.json，与现有自定义服务商行为一致。
