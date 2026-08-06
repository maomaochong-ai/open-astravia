# 图像生成（image-gen）

类 Grok 的文生图 / 图改图系统插件。

## 能力

- **输入栏「图像生成」开关（软隔离）**：插件通过 `PluginPromptDecoration.instructions` 注入本轮隐藏意图。**未开启时**插件注册的工具仍可用；开启则加强引导。agent 按 prompt 语义自行决定调用 `generate_image`（全新画面）还是 `edit_image`（修改已有图像）。
- **消息下方版本 swiper**：在生成图像的那条消息下横向排列该图编辑谱系的全部版本（超出可左右翻看），每张 hover 出「编辑」「导出」。同一谱系只在最新一条消息下渲染，生成中时最前面插入「生成中」骨架卡。
- **图改图统一从输入栏触发**：点某张图的「编辑」icon → 插件通过 `ui.setPromptAttachment` 绑定一次性编辑上下文，宿主只展示通用胶囊并在发送时合并隐藏指令，agent 调用 `edit_image` 以该图为 source。

## 出图链路

一律走宿主 `ctx.media` 协议，默认选择 desktop-app 内置的 `desktop-app:vetta` 图片 Provider。
插件不感知模型、不持有任何 key，也不能指定网关路径；内置 Provider 在主进程固定调用
`POST /api/v1/images/{generate,edit}`。模型选择、provider 形态适配（含改图协议差异）、
尺寸白名单与按次计费都在服务端，管理员在 admin 配置；能不能出图由用户的订阅档位决定
（ADR-0056）。

**插件没有任何设置项**，`contributes.settings` 已整块移除。曾经的「自定义 API」逃生舱
也一并撤掉——一旦允许自带 key，插件就得重新养一套 provider 适配，而改图形态各家不同
（官方 multipart / 聚合站 `images[].image_url`），那套适配已经在服务端存在，客户端再养
一份就是长期双维护。存量用户填过的 key 留在 CredentialVault 里不再被读取。

因为不再直接发 HTTP，插件也不再声明 `network.fetch` 权限；「未配置」引导弹窗随之删除，
`ui.slot.global` 权限一并撤回。

输出尺寸不在插件侧决定：由 agent 通过 `generate_image` 的 `size` 参数传入，服务端再按
白名单强制归一（`1024x1024` / `1024x1536` / `1536x1024`）——上游按尺寸不同价，而按次
计费每模型只有一个固定单价，放开尺寸等于用固定单价买贵的图。

## 架构

插件拥有 `generate_image` / `edit_image` 工具、隐藏提示、卡片渲染、持久化记录和编辑谱系；
desktop 提供受 capability session 约束的 `ctx.media`、`ctx.storage`、
`ctx.fs.readBinaryFile` 与通用 prompt attachment。Vetta Provider 内置于 desktop 主进程，凭据不出
主进程；其它 Provider 由宿主模块按同一 SPI 扩展，协议也允许 Provider 列表为空。图像字节仍只落插件本地
`~/.vetta/plugin-data/image-gen/`，不进服务端存储、
也不进 LLM 上下文（工具结果只回 image id）。

详见 `docs/adr/0057-host-media-protocol-and-desktop-vetta-provider.md`、
`docs/adr/0056-image-generation-through-vetta-gateway-metered-by-credits.md`
与被其部分取代的 `docs/adr/0048-image-generation-owned-by-plugin-generic-network-storage.md`。
