# 预设服务商目录改为客户端内置，模型列表按服务商适配器动态拉取

取代 [ADR-0015](./0015-preset-provider-templates.md) 的「服务端下发模板目录」部分：预设服务商（Claude / OpenAI / DeepSeek / Z.ai(GLM) / Kimi / Gemini / Grok / Qwen）的 `baseUrl`、`api`、图标 symbol 全部**内置在客户端** (`apps/desktop/src/main/models/presets/catalog.ts`)，`/providers/templates.json` 与启动时的在线合并一并删除。原因：模板目录本身是不含密钥的静态元数据，为它强依赖服务端换来的是「首启离线预设区为空」和「服务端挂了就没有预设」，收益为零。

**模型列表改为向服务商本人要。** 用户填完 key 立刻请求该家 `/models`，之后每 12 小时后台同步一次，设置页每行还有手动刷新。各家接口形状不一致，按 `fetcher` 分派到三个适配器：

- `anthropic`：`GET /v1/models`，`x-api-key` + `anthropic-version`，游标分页；元数据最全（`capabilities.thinking` / `image_input` / `effort` 等级、`max_input_tokens`）。
- `openai-compatible`：`GET {baseUrl}/models`，Bearer；OpenAI / DeepSeek / Z.ai 只返回 id，Kimi 额外给 `context_length` / `supports_reasoning` / `supports_image_in`，一并解析（多余字段对其它家无害）。
- `gemini`：`GET {baseUrl}/models?key=`，`pageToken` 分页，按 `supportedGenerationMethods` 含 `generateContent` 过滤，给 `inputTokenLimit` / `outputTokenLimit` / `thinking`。

**客户端不内置任何默认模型清单**——内置清单必然随各家发版腐烂。未填 key 时展示 models.dev 公共目录里该家的模型（免 key 可拉），标注「公共目录，填入 Key 后按账号刷新」；填 key 后由该账号实际可用的 `/models` 结果取代。两条路径共用同一套非对话模型过滤（embedding / TTS / 图像视频音乐生成 / realtime）。

**不再按 `family` 或发布日期折叠模型。** `family` 表示模型谱系，不保证代表可互换的版本；例如 Qwen Max、Plus、Flash 和 Coder 可能共用同一 family，但面向不同价格、延迟和能力需求。拿第三方目录的 family 去裁剪服务商 `/models` 返回值，会把账号实际可用的档位误删。填 Key 后，服务商接口返回的可对话模型集合是唯一事实源；models.dev 只能补名称、能力、上下文和价格，不能删除其中任何一项。未填 Key 的公共目录则保留所有未明确标记为 `deprecated` 的可对话模型。

模型数量增多由界面承担，而不是破坏数据：展开模型后可按名称或 ID 搜索，列表设置最大高度并在内部滚动。这样既控制设置页长度，也保留用户选择预览版、不同档位和账号专属模型的能力。

**接口不给的字段用 [models.dev](https://models.dev/api.json) 目录补，接口给了的一律以接口为准**（`models-dev.ts`）。没有一家 `/models` 返回价格，OpenAI / DeepSeek / GLM 连上下文长度都不给。曾用手写静态表按模型 id 正则补，两个月不到就全错（v3 时代的 DeepSeek 价格套在 v4 上、`^gpt-5` 规则套在 gpt-5.6-sol 上），**手写表本身就是错误来源**，遂改为拉一份跟各家发版更新的社区目录：随模型列表一起同步、裁到八家后落 `~/.vetta/agent/models-dev-cache.json`，12 小时 TTL，拉不到退回缓存，一份都没有就只展示接口字段——绝不显示猜的价格。

**目录带一份随包快照兜底。** 国内网络下 `models.dev` 常在 TLS 握手阶段被直接掐断（`net::ERR_CONNECTION_CLOSED`），新装用户既没磁盘缓存也拉不到，结果是八家各 0 个模型——比数据旧得多的问题。故把目录快照作为生成物提交进仓库（`models-dev-snapshot.generated.ts`，`bun run snapshot:models-dev` 重新生成），随 main bundle 打包。取数顺序：内存 → 磁盘缓存 → **随包快照**，同时后台拉线上数据，拉到就覆盖。快照是自动生成、带抓取时间、且必然被线上数据顶替，与「不手写清单」并不矛盾；退到快照且确实拉失败时，设置页会说明当前用的是哪一份、生成于何时。快照的 `version` 必须与 `CATALOG_VERSION` 一致（有测试挡着），否则运行时会整份丢弃、兜底形同虚设。

这是 ADR-0015「纯动态 `/models` 拿不到能力元数据」那条否决理由的正解：动态拿 id + 目录补能力，而不是二选一。代价是多一个第三方目录依赖，但它不是发布链路的一环——挂了只影响价格展示，模型照常可用。

**持久化沿用 snapshot-on-key**：填 key 即落成 `models.json` 里的普通 provider 条目（`source:"template"` + `templateId`），新增 `modelsSyncedAt` 记录同步时间。拉取只在主进程发生且**只拉不写**，由渲染层连同 key 一起落盘，避免两处各写一次 `models.json`；后台定时同步例外，它直接经 `ModelSettingsService` 写回。

## Consequences

- 冷启动断网时仍可从随包快照查看预设服务商及模型；填 key 后，模型列表以账号实际可用的 `/models` 结果为准。
- 服务端不再能推送新模型或修正配置；换来的是模型列表跟着服务商自己走，比人工维护的目录更新更快。
- 价格与能力元数据的准确性交给 models.dev。目录里没有的模型（各家刚发的、内部灰度的）不显示价格，不回落到猜测。
- 模型列表可能比过去更长，但不再因第三方 family 粒度误删可用型号；搜索和限高滚动承担可用性控制。
- 早期由服务端模板采纳、现已不在内置目录里的条目仍展示（标记「已下线」），但不提供刷新入口。
