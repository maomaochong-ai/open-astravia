# 图像生成（image-gen）

类 Grok 的文生图 / 图改图系统插件。

## 能力

- **输入栏「图像生成」开关（软隔离）**：插件通过 `PluginPromptDecoration.instructions` 注入本轮隐藏意图。**未开启时**插件注册的工具仍可用；开启则加强引导。agent 按 prompt 语义自行决定调用 `generate_image`（全新画面）还是 `edit_image`（修改已有图像）。
- **消息下方版本 swiper**：在生成图像的那条消息下横向排列该图编辑谱系的全部版本（超出可左右翻看），每张 hover 出「编辑」「导出」。同一谱系只在最新一条消息下渲染，生成中时最前面插入「生成中」骨架卡。
- **图改图统一从输入栏触发**：点某张图的「编辑」icon → 插件通过 `ui.setPromptAttachment` 绑定一次性编辑上下文，宿主只展示通用胶囊并在发送时合并隐藏指令，agent 调用 `edit_image` 以该图为 source。

## 出图链路

默认走 **Vetta 网关**：插件不感知模型、不持有任何 key，只把 prompt/size 发给服务端的
`POST /api/v1/images/{generate,edit}`。模型选择、provider 形态适配、尺寸白名单与按次计费
都在服务端；能不能出图由用户的订阅档位决定（ADR-0056）。

另一条是 **自定义 API**（高级选项），直连 OpenAI 兼容渠道、用户自带 key、不消耗订阅额度。
保留它是为了私有部署与内网场景——Vetta API 不可达时图像功能不该整个消失。它只支持
OpenAI 兼容形态，`agnes-ai` 专用分支已删除（服务端 adapter 已覆盖那类聚合站，插件再养
第二套完整 adapter 就是长期双维护）。

## 配置（插件设置）

- `mode`：`vetta`（默认，走网关）/ `custom`（自定义 API）
- `baseUrl`、`customApiKey`、`model`：仅 `custom` 模式生效，三项都要填

`mode` 没有默认值，未显式选过时按存量配置推断：旧的 `provider=custom` 用户三个字段键名未变，
自动继续走直连；旧的 `openai` / `agnes-ai` 用户迁到网关——他们当初填 key 就是为了绕过
「没有官方图像服务」，现在有了就不该再让他们自付。插件只能读设置不能写，所以这层兼容
只能做在读取侧，不会去改用户已存的值。

输出尺寸不在设置中选择：由 agent 通过 `generate_image` 工具的 `size` 参数传入。网关模式下
服务端还会按白名单强制归一（`1024x1024` / `1024x1536` / `1536x1024`）——上游按尺寸不同价，
而按次计费每模型只有一个固定单价，放开尺寸等于用固定单价买贵的图。

## 架构

插件拥有 `generate_image` / `edit_image` 工具、隐藏提示、卡片渲染、持久化记录和编辑谱系；
desktop 提供受 capability session 约束的 `ctx.network`、`ctx.gateway`、`ctx.storage`、
`ctx.fs.readBinaryFile` 与通用 prompt attachment。`ctx.gateway` 只对内置 official 插件挂载，
凭据不出主进程。图像字节仍只落插件本地 `~/.vetta/plugin-data/image-gen/`，不进服务端存储、
也不进 LLM 上下文（工具结果只回 image id）。

详见 `docs/adr/0056-image-generation-through-vetta-gateway-metered-by-credits.md`
与被其部分取代的 `docs/adr/0048-image-generation-owned-by-plugin-generic-network-storage.md`。
