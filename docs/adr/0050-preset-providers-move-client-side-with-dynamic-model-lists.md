# 预设服务商目录改为客户端内置，模型列表按服务商适配器动态拉取

取代 [ADR-0015](./0015-preset-provider-templates.md) 的「服务端下发模板目录」部分：预设服务商（Claude / OpenAI / DeepSeek / Z.ai(GLM) / Kimi / Gemini）的 `baseUrl`、`api`、图标 symbol 全部**内置在客户端** (`packages/desktop-app/src/main/models/presets/catalog.ts`)，`/providers/templates.json` 与启动时的在线合并一并删除。原因：模板目录本身是不含密钥的静态元数据，为它强依赖服务端换来的是「首启离线预设区为空」和「服务端挂了就没有预设」，收益为零。

**模型列表改为向服务商本人要。** 用户填完 key 立刻请求该家 `/models`，之后每 12 小时后台同步一次，设置页每行还有手动刷新。各家接口形状不一致，按 `fetcher` 分派到三个适配器：

- `anthropic`：`GET /v1/models`，`x-api-key` + `anthropic-version`，游标分页；元数据最全（`capabilities.thinking` / `image_input` / `effort` 等级、`max_input_tokens`）。
- `openai-compatible`：`GET {baseUrl}/models`，Bearer；OpenAI / DeepSeek / Z.ai 只返回 id，Kimi 额外给 `context_length` / `supports_reasoning` / `supports_image_in`，一并解析（多余字段对其它家无害）。
- `gemini`：`GET {baseUrl}/models?key=`，`pageToken` 分页，按 `supportedGenerationMethods` 含 `generateContent` 过滤，给 `inputTokenLimit` / `outputTokenLimit` / `thinking`。

**客户端不内置任何默认模型清单**——内置清单必然随各家发版腐烂。未填 key 时展示 models.dev 公共目录里该家的模型（免 key 可拉），标注「公共目录，填入 Key 后按账号刷新」；填 key 后由该账号实际可用的 `/models` 结果取代。两条路径共用同一套非对话模型过滤（embedding / TTS / 图像视频音乐生成 / realtime）。

**默认每个系列只保留最新一档。** 各家 `/models` 会把历年模型全列出来（OpenAI 38 个、Gemini 22 个），绝大多数是没人再用的历史版本。按目录的 `family` 分组、取 `release_date` 最新的一个，并淘汰整族发布超过一年的（`selectLatestModels`）——不写死任何型号，新模型上线自动顶替旧的。目录里查不到的模型一律保留：那通常是刚发布还没进目录、或该账号专属，宁可多留也不能把用户真正能用的新模型藏掉。**不给「显示全部」的开关**：留一个能把历史版本放出来的入口，等于把「该用哪个模型」的判断重新推回用户，而这正是折叠要解决的问题；真需要旧型号的用户可以手搓自定义服务商。

已知取舍：折叠粒度取决于目录怎么划 family。Gemini 的 `gemini-pro` 族里混着 deep-research，pro 档会被同族更新的条目挤掉；这是目录数据的粒度问题，不为它引入本地例外表——真要用可以手搓自定义服务商填同一个 baseUrl。

**接口不给的字段用 [models.dev](https://models.dev/api.json) 目录补，接口给了的一律以接口为准**（`models-dev.ts`）。没有一家 `/models` 返回价格，OpenAI / DeepSeek / GLM 连上下文长度都不给。曾用手写静态表按模型 id 正则补，两个月不到就全错（v3 时代的 DeepSeek 价格套在 v4 上、`^gpt-5` 规则套在 gpt-5.6-sol 上），**手写表本身就是错误来源**，遂改为拉一份跟各家发版更新的社区目录：随模型列表一起同步、裁到六家后落 `~/.vetta/agent/models-dev-cache.json`，12 小时 TTL，拉不到退回缓存，一份都没有就只展示接口字段——绝不显示猜的价格。

**目录带一份随包快照兜底。** 国内网络下 `models.dev` 常在 TLS 握手阶段被直接掐断（`net::ERR_CONNECTION_CLOSED`），新装用户既没磁盘缓存也拉不到，结果是六家各 0 个模型——比数据旧得多的问题。故把目录快照作为生成物提交进仓库（`models-dev-snapshot.generated.ts`，`bun run snapshot:models-dev` 重新生成），随 main bundle 打包。取数顺序：内存 → 磁盘缓存 → **随包快照**，同时后台拉线上数据，拉到就覆盖。快照是自动生成、带抓取时间、且必然被线上数据顶替，与「不手写清单」并不矛盾；退到快照且确实拉失败时，设置页会说明当前用的是哪一份、生成于何时。快照的 `version` 必须与 `CATALOG_VERSION` 一致（有测试挡着），否则运行时会整份丢弃、兜底形同虚设。

这是 ADR-0015「纯动态 `/models` 拿不到能力元数据」那条否决理由的正解：动态拿 id + 目录补能力，而不是二选一。代价是多一个第三方目录依赖，但它不是发布链路的一环——挂了只影响价格展示，模型照常可用。

**持久化沿用 snapshot-on-key**：填 key 即落成 `models.json` 里的普通 provider 条目（`source:"template"` + `templateId`），新增 `modelsSyncedAt` 记录同步时间。拉取只在主进程发生且**只拉不写**，由渲染层连同 key 一起落盘，避免两处各写一次 `models.json`；后台定时同步例外，它直接经 `ModelSettingsService` 写回。

## Consequences

- 冷启动断网也有预设服务商列表可选，但模型列表要等填 key 且联网拉取成功后才有——「免配置」在离线下只成立到服务商这一层。
- 服务端不再能推送新模型或修正配置；换来的是模型列表跟着服务商自己走，比人工维护的目录更新更快。
- 价格与能力元数据的准确性交给 models.dev。目录里没有的模型（各家刚发的、内部灰度的）不显示价格，不回落到猜测。
- 早期由服务端模板采纳、现已不在内置目录里的条目仍展示（标记「已下线」），但不提供刷新入口。
