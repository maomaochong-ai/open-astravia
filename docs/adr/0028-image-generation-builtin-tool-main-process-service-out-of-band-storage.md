# 图像生成走内置 tool + 主进程图像服务，图像 out-of-band 落盘不入 LLM 历史

要做一个 [[图像生成插件]]（类 Grok 文生图/图改图）。它有两条触发入口：会话里 agent 优化 prompt 后生成（[[生成轮次]]），以及活动面板里对单图做 [[图改图]] 迭代（[[编辑谱系]]，不产生会话消息）。两条入口都要发 OpenAI `/v1/images`、都要拿到同一份配置、落到同一处存储。需要决定三件事：实际 API 调用放哪、agent 这一轮怎么被驱动去生成、生成的图像如何持久化。

决定：

1. **API 调用 + 落盘集中在 [[主进程图像服务]]**（desktop 主进程 IPC 服务）。它读[[插件设置]]拿 endpoint/图像模型/key，调 `/v1/images`（生成/编辑，n=1），把图像字节按 session 落盘，返回 `{ id, vetta-media:// URL }`。生成与面板编辑两条入口都转调它——一份实现、单一真相源。

2. **agent 侧用 coding-agent 内置 tool 薄包装**（`generate_image` / `edit_image`），而非 extension。[[图像模式]] toggle 经输入插槽的 prompt 装饰器给本轮 `PromptRequest.metadata` 注入 `imageMode`；agent 据此优化 prompt 并调该 tool。tool 不自己实现 API，而是通过 host 注入的句柄转调主进程服务（coding-agent 不能依赖 desktop）。

3. **图像 out-of-band 存储，不进 LLM 会话历史**。tool-result 只回轻量引用（id），图像字节单独落盘。per-message 预览靠 host 把该轮引用作为 `imageRefs` 附在传给 message-slot 的 message 上来渲染（host 侧绑定）。

## Considered Options

- **用 coding-agent extension 注册 image tool（最初的倾向）**：extension 能注册 tool 而不碰核心 6+ 注册点，看似更轻、更解耦。被否：desktop 当前**根本不加载 extension**——`session.bindExtensions()` 虽被调用，但 `ExtensionUIContext` 全 no-op（`confirm` 恒 false）、扫描目录（`~/.pi/agent/extensions/`）在桌面端未启用、`antigravity-image-gen.ts` 仅是 example 无加载入口。要走 extension 必须先在 desktop 建起整套 extension 加载子系统（真实 UIContext 桥、目录扫描、`includeExtensions`、安全模型、打包分发），比它想规避的内置 tool 6+ 注册点更重，且为单一功能引入大面积新机制。

- **图像字节进 session 历史作为 tool-result 的 ImageContent**：复用 agent 原生持久化、重载天然恢复。被否：base64 图像会污染 LLM context，受 [[image-budget]]（默认保留最近 2 张）影响而被裁成占位文本，且无损/大图全量进 jsonl 既臃肿又拖慢。out-of-band 落盘 + 轻量引用让 context 干净、UI 显示与发送预算解耦。

- **生成也由插件 renderer 直调主进程服务、完全不经过 agent**：最省事（与面板编辑同路）。被否：用户明确要 vetta agent 先把简单 prompt 优化成绘图 prompt 再生成——agent 必须在生成轮的回路里，这需要一个 agent 可调用的 tool。

- **API 调用各自实现两份（extension/tool 内一份、插件 renderer fetch 一份）**：被否，重复实现易随时间漂移，两处行为不一致。

## Consequences

- `PromptRequest` 新增可选 `metadata` 字段，并需把它从 runtime-core 贯通到 agent 轮，使 `imageMode` 能门控本轮 tool 行为（开启时强制/优先调用，关闭时 tool 不对模型暴露，保持普通对话）。**（图像软隔离修订：关闭时不再剥离 image tool；`imageMode` 仅注入隐形意图。知识检索则保持/改为硬隔离：`knowledgeMode` 关闭时剥离 kb-read 工具。）**
- coding-agent 要新增内置 tool，按既有约定扫齐 `tools/index.ts` 等 6+ 注册点；tool 需要一个 host 注入的图像服务句柄抽象（在 coding-agent 定接口、desktop 供实现），避免 coding-agent 反向依赖 desktop。
- 图像存储要有按 session 的目录与清理策略，并经 `vetta-media://`（ADR-0021 的自定义流式协议）映射给 `<img>`。重载恢复靠存储 + 会话里轻量引用重建，不依赖 LLM 历史。
- message-slot 的入参契约要扩展（host 把 `imageRefs` 附到 message），这意味着 host 必须能从该轮 tool-result 里识别图像 tool 并提取引用。
- 编辑路径不写会话历史：[[编辑谱系]] 只活在主进程存储 + 活动面板，重载后由面板按基准图 id 重新拉取谱系。**（已被 ADR-0029 超越：编辑收敛到 AI 输入栏、改走 agent `edit_image` tool、成为正式会话轮次并写历史；活动面板编辑选项卡删除。out-of-band 落盘与「只传 id 引用、字节不进上下文」的原则仍沿用。）**
- 配置依赖[[插件设置]]系统（VSCode 式声明 schema）就绪：主进程服务按 plugin id 命名空间读 settings.json 里的 endpoint/模型/key（含 `secret` 项）。
