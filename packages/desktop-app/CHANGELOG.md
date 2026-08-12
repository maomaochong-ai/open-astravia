# Changelog

All notable changes to `@vetta/desktop-app` are documented in this file.

## [Unreleased] — 内测版（未公证）

### Added

- **Windows 本地流式语音输入**（ADR-0070）：输入栏在 Windows x64 显示麦克风入口；Windows 构建阶段下载、
  校验并把约 160 MiB 的中文 Streaming Zipformer 模型写入安装包，应用运行时完全离线；16 kHz PCM 由 AudioWorklet 分块
  采集，Sherpa-ONNX 原生解码隔离在 utilityProcess，partial 实时展示、final 插入当前光标。macOS/Linux
  不显示入口，构建时跳过模型，也不把 Windows 原生运行时带进各自产物。识别宿主使用显式启动握手，并提供
  真实 Electron 进程冒烟验证，避免进程消息接线错误表现为初始化超时。

- **执行模式与 Plugin Hook 采用 Turn 边界生效**：活动 Agent 运行时修改全局 Execution Mode 不再报 busy，
  当前 Turn 保持原沙盒/全访问实现并在下一 Turn 应用；Desktop Plugin Hook 按 `turnId` 固定首次捕获的
  binding 集合，普通注册/注销只影响后续 Turn。
- **Hosted Route 导航进入三层能力架构**（ADR-0068）：Desktop Renderer 新增通用 namespace 路由服务并继续拥有 TanStack Router、URL 与页面 Registry；Capability SDK 只发布可序列化的 `open-hosted-route` 合同，Runtime 负责精确 Grant、namespace constraint 与撤销；Plugin/Theme 各自在自己的集成层固定身份、映射权限并管理 Session。Capability SDK 中原有 Plugin/Theme Adapter 已迁回 Desktop 上层集成目录，网络和媒体合同中的 `pluginId` / `plugin-blob` 也分别收敛为通用 `namespace` / `storage-blob`，插件公开 API 保持不变。

- **画布活动态浮层改挂生成阶段**：`edit` / `write` 的时间几乎全花在模型生成参数上（一整份 frame 正文），执行只要几毫秒。浮层原本挂在工具执行事件上，于是要等改动落盘之后才亮，看起来像「改完才闪一下」。宿主现在把新的 `toolcall.args`（生成中的部分参数）转译成插件事件 `tool-call-args`，插件据此在模型刚写下目标路径时就点亮对应画框，一直亮到落盘。

- **设计画廊（系统插件「Vetta UI Design」新增侧边栏入口「设计」）**：所有带设计稿的项目的注册中心。它主动收集侧边栏里**项目根目录下**直接躺着 `x.vetd/` 的项目（只 readDir 一层，不递归——画廊要把每个项目都扫一遍，递归大仓库会让这个页面打不开），一个项目一张卡，卡面是**上封面下 info** 的 Figma 式版式：封面为画布全景，info 为项目名 + 最近改动相对时间 + 多设计时的「N 份设计」+ 有会话在跑时的运行中指示。点卡片跳进该项目**最近一个可续聊的会话**（只读或已被别的运行时占用的会话会被跳过，一个都没有则落到该项目的新建会话页），并直接把设计画布铺开、定位到卡面那份设计——从画廊进来是明确的「我要看这份设计」，不该再让用户自己去活动面板找标签卡。工具栏可按名字搜索、新建（只问名字，项目建在 workspace 下，随后进新会话页从提示词开始）、导入（拖 `.vetdz` 到页面，或按钮选文件）；卡片右键可导出分享包（项目里有多份设计时开子菜单让用户选，不替他挑）、在文件管理器中显示、归档项目。画廊与设计画布不按工作模式装卸（见 ADR-0046 修订：系统中不再有任何模式硬闸）——画布标签卡是否露出由「cwd 里有没有 `.vetd`」决定，那本来就是比模式更准的条件：在代码仓库里写着写着要看设计稿，画布就该在。
- **画布封面**：用 manifest 里的 frame 坐标把画布已有的逐帧位图拼成一张**原比例全景图**存进 IndexedDB，供画廊卡片显示。素材复用画布本来就截过的那批位图，不额外起引擎、不额外截图，也不往用户项目里写派生文件。合成有两个时机：画布里位图安静下来之后（防抖）合成一次，离开设计时再补最后一版——只在卸载时合成会与画廊的挂载抢跑，出现「明明进过画布却没有封面」。画廊发现某份设计缺封面时还会**自己用缓存里的位图补一张**：原料早就在库里，有没有封面不该取决于用户离开画布的那一刻画布来不来得及写。三条路都拿不到（这台机器从没打开过这份设计的画布）才退回占位——用该设计 `theme.css` 的主色刷一个带设计名的色块。全景按原比例保存、卡片内 `object-cover` 裁切，故 frame 横排得很长的设计在卡面上只看得到中间一段。

- **看板 0.3.1：侧边栏入口实时角标**：空闲时是 Beta 标识，有任务在跑时换成数量——不点开看板、不进任何会话页也知道现在有多少活在跑。计数与板上并发名额环 `n/5` 同一个口径（已派单但还没交付），已交付/失败的卡不再计入；任务清零后 Beta 标识自己回来。板面变化频繁而多数与角标无关，因此只在角标真的变了才通知宿主。
- **侧边栏导航项角标，插件可用**（Plugin API 新增 `PluginWorkspaceViewContribution.badge` 与 `ctx.ui.setWorkspaceViewBadge()`）：此前只有内置「知识库」挂得上 Beta 标识，且样式在三处各写了一遍。现在角标是统一的判别联合——`beta`（宿主预置，插件声明一个 kind 就得到与知识库完全一致的标识，文案由宿主按当前语言给出）、`text`（支持 `%catalogKey%`）、`count`（超 99 显示 `99+`，归零即消失）、`dot`，各带可选色调（`default` / `accent` / `warning` / `danger`，插件给不了原始色值，角标因此始终与内置项一致）。未读数、状态点这类会变的角标走 `setWorkspaceViewBadge` 原地更新，不会让整页 surface 重挂载。三处重复的角标样式收敛为一个 `SidebarNavBadgeView`。
- **看板 0.3.0：模型选择器改用宿主同款**：看板的模型选择器不再是自绘胶囊，而是**会话页输入栏的同一个组件**——`ModelSelectorView` 连同 `ProviderIcon` / `MultiplierTag` 从 desktop renderer 下沉到 `@vetta/theme-ui`，宿主改从新位置引用，并经新的共享入口 `@vetta/theme-ui/plugin-ui` 开放给插件（Module Federation 共享域，同 `@vetta/ui`）。于是搜索、按 provider 分组与图标、云端/默认/视觉徽章在两处天然一致，宿主改了看板跟着改。看板侧只适配语义差异：多一个「跟随默认」项、不接推理档位。配套把 provider 的图标 symbol 打通 capability → plugin-sdk → renderer（`model.list` 摘要新增 `icon`），否则插件那侧的选择器会缺图标。同时补上 `vetta-host://plugin-sdk` shim 漏掉的 `PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES`——插件一旦 import 它会整体加载失败；该 shim 现由合同测试逐个比对，三份清单（sdk / ui / theme-ui）都不会再漏。
- **看板 0.3.0：自动认领**：页面右上角新增「自动认领」开关（默认关闭）。此前「待认领」只是解除了 Agent 的禁令，本身不触发任何事——不手动派发、也不在会话里让 Agent 读板，卡片就一直躺在灵感池里。打开后看板自己盯着灵感池：卡片是「待认领」、依赖已满足、名额未满、目标项目可解析时直接建会话派出去（标记为 Agent 认领）；新卡标为待认领、有任务交付腾出名额、上调并发都会立刻触发下一轮。循环串行且不可重入，一次只派一条、派完再看名额，并发上限不会被绕过；没有可用目标项目或建会话失败的卡片被跳过而不是反复重试，编辑该卡后重新参与。开关持久化，重启后会把停机期间攒下的待认领卡片接着派。`kanban_list_tasks` 快照带上 `autoClaim`，Agent 据此知道不必再逐条认领。
- **看板：模型清单补齐 Vetta Go**：插件侧的模型清单此前只来自主进程的本地模型配置，看不到登录后服务端下发的远程目录，于是看板的模型选择器缺了 Vetta Go 一整块。现在 renderer 的 `official.models` 把两份按宿主选择器同一口径合并（同 key 本地优先），模型 key 校验也认远程 key。看板的模型清单改为每次面板挂载刷新一次，开着看板去登录或加 provider，回来即可看到新模型。
- **看板 0.2.1：任务可指定模型**：发布器工具栏新增模型胶囊，选定后即成为看板默认，新需求按当前选择**固化**（之后改看板默认不会回头改写已有卡片）；单张卡可在编辑弹窗里单独换模型或退回「看板默认」，卡面显示模型徽章。派单时模型写进新会话的**会话设置**而不是只钉首轮，用户之后在对话页接管这个会话，用的仍是卡片上选的模型。都没选时不带模型，跟随宿主全局默认（换全局默认后板上的卡跟着走）。Agent 侧 `kanban_add_task` 新增 `model` 入参（落卡前校验模型存在，避免脏模型拖到派单当场才失败），`kanban_list_tasks` 快照带上待认领项的模型。
- **外置插件支持 npm 分发安装（ADR-0067）**：新增 `npx @vetta-org/plugin-cli add <package>` 流程。npm 只承载标准插件 zip，CLI 禁用 lifecycle scripts、限制提取文件并通过 Action RPC 请求安装；Desktop 在落盘前再次校验 SHA-256、插件 id 与版本，npm 来源按 community trust 持久化并继续沿用权限审批和 pending/reload 生命周期。
- **插件品牌图标由宿主注入**：`ctx.plugin.iconUrl` 来自 `plugin.json#icon`（不透明 URL/Iconify）；Activity Tab 省略 `icon` 时自动用该品牌图，插件不必 `import` 包内 png 或拼 `vetta-plugin://`。
- **看板 0.2.0：发布器与验收闭环**：底部新增与会话页 AI 输入栏**同款胶囊发布器**（回车入灵感池、⌘回车直接开工、Shift+回车写正文，可选目标项目与优先级）——看板即对话入口在形式上也成立。「待检查」补全验收闭环：**验收通过 → 归档**（右上角面板回看/恢复/删除，归档卡不占名额、作为依赖视为已交付）与**打回重做**（反馈发往原会话，Agent 带完整上下文修正；原会话丢失时降级为重新派发）。另有搜索过滤、并发步进器（带名额用量环）、优先级左侧色条、运行中呼吸光环、相对时间与空板三步引导。修复两个首版渲染问题：插件 CSS 缺 theme 层与 iconify 插件导致图标类未生成；Radix 弹层 portal 逃出 `@scope` 导致弹层内部样式丢失（按 content-creation 模式补挂 `data-vetta-plugin-root`）。
- **系统插件「看板」**：跨项目、跨会话的需求总览与派单入口，侧边栏「更多」→「看板」进入。三条泳道——「灵感池」（草稿 / 待认领两态，草稿是给 Agent 的明确「别动它」信号）、「正在处理」（每张卡背后是一个真实会话，点卡片即跳进对话页，卡上实时显示已派单/运行中/等待中/失败）、「待检查」（Agent 交付区，附交付说明）。看板本身就是提问入口：顶部敲一行回车即入灵感池，卡片上点「派发」直接建会话开跑，全程不用进任何会话页。右上角设置并发（默认 5），**只约束本看板「正在处理」泳道上未交付的任务数**，不影响批量任务、自动化和手动会话。Agent 侧提供 `kanban_list_tasks` / `kanban_add_task` / `kanban_claim_task` / `kanban_submit_task` 四个工具：看板只做闸门不做调度，先后与并行由 Agent 自行判断，越界时按 `wip-full` / `blocked` / `draft` 给出可执行的拒绝理由。卡片可声明依赖，被依赖项进入「待检查」前不会被派发。见 ADR-0065。
- **侧边栏导航可自定义**：导航项现在由布局驱动而非硬编码。「更多」弹层同时是自定义面板——置顶区与收纳区都列出、都可拖拽排序、也可跨区拖动或点 pin 图标切换。「新会话」锁定在置顶区第一位（不可拖动、不可收纳），置顶区含它在内**最多 5 个**；超限项退回收纳区最前而不是丢弃。布局按 key 持久化，插件卸载不影响其它项位置，装回来自动复位。插件贡献的**工作区视图**也作为普通导航项参与其中。见 ADR-0065。
- **插件工作区视图插槽**（Plugin API 新增 `ui.slot.workspace-view`）：插件可贡献与内置页同级的整页 surface，宿主提供 `/workspace/$pluginId/$viewId` 路由与侧边栏入口。插件停用时入口消失，用户若正停在该路由会被送回首页；插件宿主尚未加载完成时显示加载态而不是误判为「不存在」。同时新增 renderer 侧 `official.sessions`（仅 official 插件），封装既有 `window.vetta.session.*`，不新增主进程 IPC 通道。见 ADR-0065。

- **会话页顶栏「新会话」按钮**：侧边栏收起（或窄屏浮层）时，展开侧边栏按钮与会话标题之间多出一个「新会话」图标，行为与侧边栏导航的「新会话」完全一致（同一套目标项目 cwd 解析），不必先展开侧边栏才能在当前项目下开新会话。侧边栏可见时该按钮不出现。

- **新会话欢迎页支持右侧活动面板**：欢迎页标题栏右侧补上「窗口置顶」与「活动面板」两个按钮，面板按当前项目 cwd 取上下文（文件、调试等 tab），与会话页、项目详情页共用同一开关状态与宽度。

- **媒体生成角色化输入协议 v4**：宿主在 Provider 注册、能力发现和不透明输入转发中保留模式级输入槽与 `role`，支持首帧/尾帧及图片、视频、音频参考，同时继续隔离真实素材路径。
- **插件动态接入 Coding Agent Hook**（ADR-0064）：Plugin API 1.3.0 新增 `ctx.agent.registerHook()`，ESM / Module Federation 插件可按场景、工作模式和工具名动态注册 Coding Agent 的 12 类原生 Hook 事件。Desktop callback adapter 通过既有 `additionalHookAdapterFactories` 进入每 Session 唯一 Hook Runtime；注册、执行、注销经 preload/main/renderer IPC bridge 回到插件 handler，并受 `agent.hooks.register` + `agent.hookHandler.execute` 双权限、超时、取消与结构校验约束。插件停用、重载和卸载会停止新调用，在途 dispatch 使用稳定快照；QuickJS 继续不开放 Agent 动态 handler。
- **App Action 能力适配与密钥弹窗补齐**：`skills.*` 文案对齐产品「能力页」（公共 id 兼容不变），`skills.manage` 新增 `install-from-market`（主进程按 slug 下载安装）；`im.manage` 新增 `set-feishu-config`，审批弹窗手填 App Secret 等密钥；`mcp.upsert` 审批支持 env/headers 手填；`models.upsert-provider` 指引 Agent 省略 apiKey。导航目录补 `abilities` / `scenes` / `knowledge`。补齐官方 API、审批解析与 vetta-actions 域单测。
- **第三方插件可选 QuickJS-WASM Worker 沙盒**（ADR-0061）：`runtime: "quickjs"` 的入口只作为文本进入独立 Worker/QuickJS context，不可访问 DOM、Electron、Node、原生 fetch 或模块加载器；插件用宿主渲染的声明式 Activity Tab 获得布局、文本、表单和动作 UI，网络/私有存储/设置/i18n 经固定 JSON RPC allowlist 接回现有 capability session。每个上下文配置 32 MB 内存、512 KB 栈、1 秒单次执行和待处理任务上限；现有 ESM/MF 插件行为不变。
- **底层媒体生成能力、插件 Provider SPI 与内置 Vetta 图片实现**（ADR-0057）：通用图片/视频契约下沉到 Domain Capability；插件除可通过 `media.generate` 消费外，还可用 `media.provider.register` 注册 Provider。宿主把素材引用转换为不透明 ID，负责流式上传与远程产物落盘，不向 Provider 暴露其它插件的存储路径，也不经 renderer 传 Base64；Provider 增删事件会让并行激活的消费插件刷新模型列表。默认 `desktop-app:vetta` Provider 仍固定在主进程调用 `images/generate` / `images/edit`，renderer 插件无法读取 JWT 或指定任意网关路径。新增 `comfyui-media-provider` 预设插件，将本地 ComfyUI 的成功 API Prompt 作为模板，在插件内部适配 MiniMax H3 图生视频节点、队列与输出文件，内容创作节点只传统一的提示词、比例、时长和素材引用。
- **设计画布新增预览模式**：设计稿现在是可点的真实站点。顶栏「预览」打开一个浏览器窗口——按钮、tab、表单都是真交互，跨屏跳转走真实路由（`frames/login.tsx` 就是 `/login`，`frames/index.tsx` 就是首页 `/`），带前进/后退/刷新/地址显示/画框切换/视口预设，窗口可自由拉伸，也可以一键交给系统默认浏览器打开（该地址随设计画布关闭而失效）。预览期间画布整体降为位图，不再同时养 N 份活体渲染树。引擎因此升级到 0.2.0（引入 react-router），首次打开设计稿会重跑一次依赖安装。见 ADR-0055。
- 插件 SDK 新增 `ui.openExternal(url)`（权限 `shell.openExternal`）：把 http/https 链接交给系统默认浏览器。
- 图像生成插件不再有任何设置项：出图一律走 Vetta 网关，模型与计费由 admin 配置，用户无需也无法填写 API key（ADR-0056）。此前保留的「自定义 API」逃生舱一并撤掉——改图形态各家不同（官方 multipart / 聚合站 `images[].image_url`），逃生舱要能用就得在客户端重养一套 provider 适配，而同一套适配已经在服务端存在。插件因此不再直接发 HTTP，`network.fetch` 与 `ui.slot.global` 两项权限一并撤回。存量用户填过的 key 留在 CredentialVault 里不再被读取。
- 内置插件可通过 `ctx.gateway.request()` 带登录身份调用 Vetta 服务端（ADR-0056）。新增 foundation 能力 `cap.foundation.vetta.gateway.request` 与主进程 `plugin-gateway-service`：插件只交出相对 `/api/v1` 的路径，服务端地址与 JWT 由主进程注入、401 由主进程单飞刷新后重试一次，token 不出主进程。请求默认与最大超时都是 5 分钟，与服务端 `ImageService` 的 http client 对齐——网关背后是图像生成这类长任务，客户端先超时只会让一次已经在上游跑着的生成白白丢掉。该能力**不挂可声明权限**，只按来源收口给 `trustLevel === "official"` 的插件——第三方插件在 renderer 侧读到 `ctx.gateway === undefined`，即使伪造 sessionId，主进程 capability 适配层也会再校验一次 official 属性。

- **外部插件混合热更新**：插件工作台改为启动 `vetta-plugin dev` 开发服务器；React 组件与 CSS 走 Fast Refresh/HMR，入口、清单、locale 与 agent 资源变化只替换当前插件 activation，其他插件不再被整表重载。生产构建与 zip 格式不变。
- **统一插件开发会话**：未打包 Desktop 可通过 `VETTA_PLUGIN_DEV` / `VETTA_PLUGIN_DEV_ROOTS` 显式接入 preset、仓库 external 或仓库外工程；主进程统一解析工程内 `plugin-vite`、等待版本化 ready 握手并管理生命周期。未安装的显式 external 仅创建内存记录，不写插件注册表；插件工作台首次应用后复用同一会话服务。

- **预设服务商新增 Grok 与 Qwen**（同时修掉两个会让新预设显示 0 个模型的问题：models.dev 目录缓存版本 +1，老缓存里没有新家的 key 却在 TTL 内算「新鲜」，会让新增的预设服务商最长 12 小时一直是空列表；「刷新目录」在缓存新鲜时原本直接返回旧缓存、等于空操作，现在手动刷新一律强制重拉）：设置 → 模型 → 预设服务商多出 Grok（`https://api.x.ai/v1`，走 `openai-completions`）与 Qwen（DashScope 国际站 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`，走 `qwen-openai-completions`）。两家的模型清单与价格照旧走 models.dev 目录（`xai` / `alibaba`），随包快照已重新生成；Grok 滤掉 `grok-imagine-*` 图像视频模型，Qwen 只保留 qwen/qwq/qvq 系列的对话模型（ocr / asr / mt 等专用接口模型不列）。

- **项目文件列表支持鼠标框选**：在空白区域按下并拖出矩形，可多选可见文件/文件夹；Ctrl/Cmd/Shift 按住时为追加选区。与现有点选、Shift 范围选、多选拖拽共用同一套选区状态。
- **插件快捷键 SDK（接入宿主 ShortcutScopeStack）**：新增权限 `ui.shortcuts.register`、`ctx.ui.registerShortcutScope` 与 SDK hook `usePluginShortcutScope`。插件按 `surface` / `overlay` / `modal` 注册绑定（禁止 `app` 层，留给宿主可配置全局快捷键），与宿主同一套优先级与 `when`（always/editable/not-editable），卸载时自动 dispose。`media-viewer` 缩放 / 全屏 Esc 已从 ad-hoc `keydown` 迁到该 API。
- **输入框按会话草稿与发送历史**：未发送内容按作用域隔离（已有会话用 `sessionPath`，新会话页用 `new:${cwd}`），切换会话 / 临时去看别的任务再回来会恢复草稿，不再串台或被新会话页清空。发送成功后记入该作用域历史；输入为空或光标在文档起点时 ↑ / ↓ 浏览过往输入（首次 ↑ 暂存当前草稿，↓ 回到最新后还原）。仅进程内内存，刷新不保留。
- **系统插件「Vetta UI Design」**：无限画布 UI 设计工作台（活动面板 Tab）。设计文档为 `.vetd` 清单 + `x.vetd.d/` 旁挂源码（frame = TSX + Tailwind v4 + Iconify），由插件托管的共享设计引擎（vite dev server + HMR）渲染；支持画布平移/无级缩放/空格拖手、frame 拖拽与改尺寸、Figma 式逐层选中 DOM 并 attach 给 Vetta、agent 修改中呼吸态、只读色板、`.vetd` 文件预览（工作态/打包态）、导出自包含分享包与导入。agent 工具：`vetd_create` / `vetd_screenshot` / `vetd_status`。插件声明 `agent_mode: ["work"]` 表示工作模式主推；该字段在本版内已随「零硬闸」决策降级为纯偏好，插件在两种模式下都完整可用。见 ADR-0053、ADR-0046（含修订）。

- **Vetta UI Design 导出渲染图**：画布支持 frame 多选（shift 点选 / 空白处框选 / 多选群组拖动），选中后底部控制栏出现「导出渲染图」。导出走全局插槽的全窗口模态：等高归一化横排合成（每张图最多 4 个 frame，超出自动分页），可调圆角、外边框粗细与颜色、背景色或透明、投影、Vetta 标识与 1x/2x 倍率，预览内可拖拽交换位置，参数按设计文档记在本地。产物可另存为或直接复制到剪贴板。同时把「让 Vetta 调整」从 frame 标题栏移到控制栏上方常驻，支持一次对多个 frame（或整份设计稿）发起调整。

- **插件 API `ctx.fs.saveAs()` 与 `ctx.ui.copyImage()`**：前者经原生保存对话框把内存字节写到用户选定路径（复用 `fs.write` 权限，路径由用户当场确认，不受工程根限制），补上 `dialog.saveCopy` 只能复制已有文件的缺口；后者经 Electron 原生剪贴板写入图片，不依赖渲染进程的 `ClipboardItem` 支持。

- **插件 API `ctx.ui.setActivityPanelWidth(width)`**：插件可随时把活动面板宽度设为像素值或 `"max"`（宿主仍 clamp 到 min/max 并按需收侧边栏）。设计画布据此在每次激活标签卡时占满宽度。

- **插件离屏截图能力 `ctx.capture.offscreen`**（新权限 `capture.offscreen`）：主进程 `offscreen-capture-service` 用隐藏离屏窗口（sandbox + OSR）加载 http(s) 页面并 `capturePage` 出图，位图与在屏渲染逐像素一致。`sessionKey` 串行复用窗口（SPA 切路由零加载），`prepareScript`/`readyExpression` 对接页面就绪信号；窗口闲置 30s 回收，插件禁用/卸载/重载与 App 退出统一清扫，每插件并存会话上限 4。Vetta UI Design 的画布位图队列已切到这条路径：位图不再有 html-to-image 克隆重排带来的文字断行与 ±1 设备像素基线抖动，截图也不再要求 frame 挂活体 iframe、不占画布渲染进程主线程（旧宿主自动回落 html-to-image）。

- **插件长驻进程能力 `ctx.command.spawn`**（ADR-0054）：与 `command.run` 同一治理模式（清单 `commands` 声明 + 新权限 `agent.command.spawn` + 用户可关），主进程管理进程组生命周期（stop/退出事件/`{{PORT}}` 端口分配），插件禁用/卸载/重载与 App 退出时统一清扫。

- **项目文件列表多选与复制粘贴**：支持 Ctrl/Cmd 点选、Shift 范围选、Ctrl/Cmd+A 全选；右键/快捷键复制与粘贴、复制路径；批量删除与多选拖拽；方向键导航、F2 重命名、Delete 删除；空白处单击清空选区，空白处右键为根目录菜单（新建/粘贴/在资源管理器打开）。不做剪切。同目录粘贴会自动生成 `name (1)` 副本。选区状态与预览解耦，避免幽灵高亮。

- **模型表单的上下文长度快捷预设**：设置 → 模型里新增/编辑模型时，「上下文窗口」与「最大输出」输入框下各多一排快捷标签（32K/64K/128K/256K/1M 与 16K/32K/64K/128K/384K），点一下即填入，当前值命中时高亮。与 Admin 的 `NumberQuickPicks` 取值一致。

- **内置 Skill 图标**：随 App 分发的内置 Skill（`create-skill` / `publish-ability`）不再落默认图，图标随 renderer 静态资源分发（`public/skills/`，约定同内置 MCP 的 `public/mcp/`）。能力广场与输入栏命令面板（含选中后插入的 token chip）共用同一解析：市场目录的图 → 内置图 → type 默认图。只对 `source=builtin` 的 skill 生效，用户自放或插件贡献的同名 skill 不会借用。`SkillTypeIcon` 的图片态判定补上 `./` 前缀。

- **插件重载入口补齐**：能力广场的插件卡片三点菜单、以及插件详情页顶部操作区都新增「重载」按钮，不再只有检测到 `pendingVersion` 时才给入口。

- **插件装完直接弹权限配置**：首次安装的插件权限默认全未授予，安装成功（市场安装 / 开源市场 / 本地 zip 导入）后自动弹出该插件的权限弹窗，省掉用户自己找「权限配置」的一步。插件数据落地后才弹，系统插件与无权限声明的插件不打扰。

### Changed

- **会话流叙事方式改由模式注册表的 narration 能力位驱动（ADR-0071 外部审计跟进）**：渲染层不再以 `mode === "work"` 二值判断决定阶段折叠，改查注册表 `narration`（staged/inline），新模式声明一份 md 即获得正确渲染；新会话页 toggle 拉取注册表前不再渲染硬编码回退清单。批量任务与定时任务会话显式固化为 work 模式——此前它们执行时没有 mode 提示词、事后打开会话时 UI 又按 work 渲染，执行与展示割裂。插件工具注册未声明 `side_effect` 时宿主给出告警（缺省按 light，重副作用工具漏声明会绕过首调确认闸）。
- **agent_mode 声明整体废弃，模式清单排序取消（ADR-0071，行为变化）**：接续下方「不再隐藏任何插件」条目——上一版 `agent_mode` 还保留「排序与提示词详略偏好」语义，本版确认清单排序对模型工具选择无可观察影响（模型按 description 语义匹配、不按位置，且「详略」从未实现）后整体归零：插件、工具、Skill、MCP、Hook 的 `agent_mode` 声明容忍存在但被忽略，工具与 Skill 清单在任何模式下集合与顺序完全一致（注册序，前缀缓存更稳）。插件详情页的「模式偏好」一栏移除。模式差异改由三处承担：mode 系统提示词、工作区事实注入、工具 description 的反向触发段。三个系统插件（vetta-ui-design / chart-renderer / content-creation）的全部 agent_mode 声明随之删除。
- **模式注册表数据化（ADR-0071）**：新会话页的工作模式 toggle 改为遍历 coding-agent 模式注册表渲染（新增 IPC `vetta:session:get-agent-modes`，下发 id/label/description/icon）；`desktop-config` 与会话模式索引的合法值校验改查注册表。新增一个工作模式 = coding-agent 新增一份 modes/*.md（含 icon frontmatter）+ i18n 文案，桌面端零代码改动（缺译时回落注册表自带 label）。
- **工作模式在会话创建时固定，会话内不可变（行为变化）**：此前工作模式是纯全局态，切换会把新模式推给所有活跃会话，在各自下一个 Turn 边界改写提示词与工具面——一个跑到一半的老会话会因为用户在别处改了模式而换掉行为。现在模式只在**新会话页**选择，创建会话时固化到该会话；之后改默认值只影响之后新建的会话，已存在会话（含恢复的历史会话）保持创建时的模式。历史会话没有记录时按 `work` 恢复，而不是回落到当前默认值。桌面配置 `desktop-config.json` 的 `agentMode` 字段随之改名为 `defaultAgentMode`（语义：新会话默认值），仍兼容读取旧字段名，老用户配置不会丢。
- **工作模式不再隐藏任何插件，插件 Hook 也不再按模式过滤（行为变化）**：此前插件 `plugin.json#agent_mode` 是硬闸——声明了另一模式的插件在当前模式下被整体排除（列表看不到、UI 面板与侧边栏入口不加载、Agent 资源不注入），Hook 也按同一条件被跳过。现在这条硬闸整体删除：已安装插件在任何工作模式下都完整可用，`window.vetta.plugins.list()` 与 `listAll()` 返回同一份完整清单；插件声明的 Hook 只由自身的 `scope_use`、事件与工具 matcher 决定是否触发，因此**工作模式下也会触发编程类插件声明的 Hook，反之亦然**。`agent_mode` 字段仍然保留并解析，但只作为偏好声明（供排序与提示词详略使用），不再有任何排除语义。改默认工作模式也因此不再重建活跃会话的插件运行配置、不再让 renderer 重载插件 bundle——它只写配置并广播给各窗口的新会话页 toggle。
- **工作模式不再隐藏文档类内置工具（行为变化）**：`doc_to_pdf`、`html_to_pdf`、`extract_text_from_pdf`、`extract_text_from_img`、`render_pdf_page`、`progress` 此前只在「工作」模式下激活，在「编程」模式下整组从模型工具清单消失。现在它们在两种模式下都可用，模式只影响 agent 的优先取向。
- **工作模式的调整入口收敛到新会话页一处**：侧边栏顶栏的工作模式徽章下拉与底部设置菜单里的模式切换区一并删除（不保留只读指示器），共享的分段切换器 `AgentModeSwitcher` 随之移除。模式既然在会话创建时固化、会话内不可变，会话中途出现的切换入口就只会误导——现在只有新会话页的胶囊 toggle 能改，改的也明确是「新会话默认模式」。插件详情页原来的「适用工作场景」一栏当时改为「模式偏好」；该栏随后在本版内随 agent_mode 声明整体废弃而移除（见上方 ADR-0071 条目）。
- **Work 模式重新保留思考过程**：此前 work 渲染把 thinking 块整块丢弃（ADR-0047 原决策），过程里模型的推理无处可查。现在 thinking 与工具行同列收在所属阶段组内，按原顺序排列，展开阶段后才可见；标题只报一句「正在思考」，不像 coding 模式那样报行数——work 的受众不需要这个数字。默认收起的阶段标题行不受影响，信息密度不变。
- **桌宠消息改为结构化、可调度的纯文字通知**：会话状态、工具进度、后台任务和错误不再直接竞争同一个文本气泡；同一会话的连续进度原地更新，多会话普通消息短队列展示，高优先级错误即时抢占并清理过时状态，用户主动消息继续优先。协议同时携带消息类型、i18n key、参数、去重键与会话来源，为后续展示扩展保留稳定合同，当前视觉仍只显示文字。
- **桌宠运行中消息改为正文优先并保持常驻**：工具描述、工具阶段、助手最终回复、重试原因和错误详情会优先作为气泡正文展示；运行态气泡持续到终止事件，正文更新至少保持 3 秒，结束时只保留一条最终消息，避免快速模型导致文字连续跳变或重复收尾。
- **会话正文字号从 16px 调整为 14px**：用户气泡与 Agent 回复的正文基线统一为 14px，Markdown 层级按同比例收敛（h1/h2/h3/h4 = 20/17/15/14，行内代码、代码块、表格、文件/链接胶囊 = 13，技能与场景徽章 = 12），行高仍为 1.6。用户气泡的 10 行折叠阈值以 `em` 计算，字号调整后折叠行数不变。
- **设计画廊「新建」改为从提示词开始**：输入名字后只建一个空项目，随即进入该项目的**新建会话页**，输入框里预置好 `vetta-ui-design` 的能力 badge，用户接着敲一句「要画什么」即可。此前是先预铺一份空 `.vetd` 再把画布铺开——用户还没说要画什么，画廊里就先多出一张空卡片，画布也只有一块空白；设计有几屏、多大尺寸、什么主题本来就该由第一句提示词决定，由 agent 建。设计建好后画廊照常自动扫出这张卡。导入分享包的路径不变（包里已经是成品，仍直接进画布）。
- 活动面板 Tab 切换改为默认 warm 驻留：访问过的文件、内容创作等 Tab 不再每次切换都重建整棵组件树；每个面板最多保留 2 个非活动 Tab，超出后按 LRU 在空闲阶段淘汰，当前与浮动 Tab 不参与淘汰。浏览器等既有显式保活 Tab 继续常驻。
- **设计文档变成一个目录，不再是「文件 + 同名旁挂目录」两个条目**：一份设计在磁盘上就是 `login-app.vetd/` 一个目录，画布 manifest 降级成包里的 `design.json`，`frames/`、`components/`、`assets/`、`theme.css` 都在同一个包内。此前是 `login-app.vetd` 和 `login-app.vetd.d/` 两个并列条目，靠一条命名约定绑在一起：移动、复制、删除、`git mv` 都要成对操作，漏一个就得到半份设计（没有源码的空画布，或丢掉全部画布坐标的一堆 tsx）。旧文档在被扫描到时**自动就地迁移**，路径不变、无需用户操作，迁移过程幂等且不存在丢内容的窗口。相应地，分享包（zip）改用 `.vetdz` 扩展名与目录形态区分，历史导出的 `-share.vetd` 仍可导入；文件树里设计包带专属图标，右键「在设计画布中打开」。Agent 侧规则同步更新：改的是 `design.json` 之外的源码，manifest 依旧由插件独写。见 ADR-0066。
- **输入栏下沿元素进出带动画**：待办条出现时输入栏会被顶高一截，此前这是一次没有过渡的布局跳变，对话读起来很硬。现在卡片下沿是一个通用插槽，元素进出走纯 CSS 过渡（`grid-template-rows: 0fr ↔ 1fr` 加内容的淡入与 4px 上托），整条输入栏平滑抬起、落下，收回比抬起略快。动画不经主线程 JS——输入栏上方就是虚拟消息列表，抬高的同时列表要重测量，用 JS 逐帧写高度会和它抢同一帧。每个槽位各自折叠，之后下沿再挂别的元素时，某一个的增减不会让其它元素跟着跳；`prefers-reduced-motion` 下直接切换不过渡。
- **待办展示重做**：待办从输入框内的抽屉标签移到输入卡片外部下方，成为独立一条状态栏——数字徽标换成颜色圆点（未完成时主色呼吸、全部完成时静止绿点），后面跟进度 `已完成/总数` 和当前进行中的条目，条目文字带光斑扫过效果。点击不再展开抽屉，改为与模型选择一致的 popover，里面是完整待办清单（时间线连线、进行中条目高亮），底部可跳到活动面板。右侧活动面板的待办页同步重做为「概览（圆点 + 百分比 + 进度条）+ 同款时间线清单」。

### Fixed

- **生产包启动数秒后整个 App 未响应（macOS 彩虹圈）**：uiohook-napi ≤1.5.5 的 `hook_enable()` 存在启动竞态死锁——`uv_cond_wait` 无谓词循环，虚假唤醒后调用线程误判启动失败、持 `hook_running_mutex` 进入 `uv_thread_join`，钩子线程随后派发 `EVENT_HOOK_ENABLED` 时又要锁同一把 mutex，两边永久互等；quickpanel/appshot 手势在启动期同步调用 `uIOhook.start()`，主进程主线程被冻住。死锁在原生层、与输入监控授权无关（macOS 26/27 上调度时序变化后近乎必现）。现在 uIOhook 隔离到 utilityProcess 宿主子进程（`uiohook-host.ts`），键盘事件经 IPC 回传主进程状态机；`UiohookSupervisor` 对宿主做启动看门狗（超时即视为命中死锁，kill 后延迟重拉，竞态窗口极窄、重试大概率成功），重试预算用尽只降级为手势不可用并记日志，主进程 UI 永不再因此冻结。
- **从归档安装插件后 Agent 能力未立即生效**：归档安装路径此前只更新插件清单和监控事件，没有像 URL、目录安装路径一样刷新共享 Agent 运行时；新插件贡献的工具、Hook、MCP 和提示词要等下一次重载才可用。插件安装生命周期现由同一服务统一收尾，三种安装来源都会在成功后立即应用运行时配置。
- **删掉项目后右侧还停在这个项目的页面上**：项目消失后的路由收尾只认 `/project/$cwd` 一条路由，于是站在该项目的**新会话页**（`/new-session/$cwd`）或它名下的**会话页**上删除项目时，右侧视图原地不动——新会话页甚至还能继续发消息，把会话建回刚删掉的目录里。现在被删项目的详情页、新会话页、会话页（靠 activeSession 归属判断）和正在看它名下会话的只读查看器都会离开，统一落到默认「对话」项目的新会话页（此前是首页；默认 cwd 尚未解析出来时仍退回首页）。停在别的项目页面时不动。移除、归档、硬删除三条路径共用这段收尾。
- **硬删除项目后，同路径重建的新项目会「继承」旧项目的会话**：会话文件不在项目目录里，而是在按 cwd 路径算出的全局分片目录（`~/.vetta/agent/sessions/--<路径>--`）。侧边栏的「删除项目」只做了摘配置 + 删项目目录两件事，全程没碰会话存储；而新项目默认建在 `~/.vetta/workspace/<名字>` 下，于是同名 = 同路径 = 同一个分片目录，重新加进配置后旧会话原样回到侧边栏，产物、snapshot 和锁文件也一并残留。现在硬删除会先按 cwd 清空该项目名下的全部会话（走与单条删除相同的回收路径：dispose 活动句柄 + 删 jsonl/snapshot/lock/产物），全删成功后连分片目录一起回收，再删项目目录——清理必须发生在项目仍在配置里的时候，分片 root 是从项目列表推导出来的。单条会话删除失败不阻断其余会话，但会保留目录而不是强拆。内置「对话」/ Claw / 知识库 cwd 由主进程侧拒绝清理。「移除项目」（不删磁盘）与归档删除的语义不变，仍保留会话。此前版本残留的孤儿分片不会被自动清理。
- **插件派活消息发进别的会话**：`useSessionManager` 同时挂载在 RootLayout / 会话页 / 新会话页三处，`ctx.conversation.sendPrompt` 拿到的是「最后渲染那份实例」的 sendMessage，而目标会话读的是**该实例自己**上次打开的会话（实例级 ref）——它可能还停在很久以前的另一个 workspace 会话上。设计画布备注自动派活曾因此把指令发进用户昨天的「对话」会话：当时界面上的乐观气泡看着正常（消息列表是全局的），重进会话后消息却出现在别的会话里，且那个旧会话的 agent 真的开始改当前项目的文件。现在 sendMessage 一律在调用时直读共享的 `activeSessionAtom`（openSession 同步写入，同 tick「建会话+发送」不受影响），发送目标与用户当前激活会话、与插件侧的 cwd 闸口回到同一事实源。
- 插件重复更新提示词附件时，已激活的输入 Action 不再创建等价 `Set`，避免无意义地重渲染输入栏与活动面板消费者。
- **文件能被注册成「项目」**：`projects.open()` 只校验路径是绝对的，不校验它是不是目录。于是 v1 时代的 `x.vetd`（那时它是个 JSON **文件**）被登记进项目列表后，本身不报错，直到有人去 readdir 它才 `ENOTDIR`——而项目扫描每轮都会读一次，主进程于是反复刷同一条 error。现在登记时就挡住：路径已存在且不是目录直接拒绝；不存在的路径照旧放行（`open` 本来就允许登记一个还没建出来的目录）。已经写进配置的坏条目需要在侧边栏右键移除。
- **插件贡献的侧边栏图标画不出来**：工作区视图的 `icon` 是插件在自己源码里声明的 iconify class，而 Tailwind 只生成它扫得到的字面量、插件源码不在宿主的扫描范围内——那条 class 没有规则，导航项是个空格子（看板的 `solar:archive-minimalistic-outline` 一直如此）。现在按图标逐条放行（`@source inline`），与既有的 `SOLAR_SKILL_ICON_CLASS` 同一个思路；不整目录扫进插件源码，那会把 preset 里只有插件自己用的成百上千个工具类一并生成进宿主 CSS。第三方插件仍只能拿到默认图标。
- **旧格式设计稿在画廊里看不见、也永远不会被迁移**：设计文档从「`x.vetd` 文件 + `x.vetd.d/` 旁挂目录」改成单个 `x.vetd/` 包之后（ADR-0066），画布打开时会就地升级旧格式，但新的设计画廊只认目录形态——旧项目根本不出现在画廊里，用户看不到也就点不进去，那份设计等于消失了。现在画廊每次加载/刷新时同样会就地迁移（幂等、分步崩溃安全，打包分享文件靠内容嗅探放过）。
- **迁移中断后设计彻底隐身**：升级分三步走，如果停在「旧 manifest 已删、旁挂目录还没改名」之间，磁盘上就不再有任何叫 `.vetd` 的条目，只按后缀找设计的扫描器再也看不见它。现在画布、agent 工具与画廊都会认出落单的 `x.vetd.d/` 并把最后一步补上；同名设计包已存在时不动它，避免改名撞车。
- **画布的「刷新」不重扫设计列表**：面板开着时新出现的设计（含还没迁移的旧格式）要等切会话才被发现。现在刷新按钮同时与磁盘重新对齐；空态下也补了「重新扫描」按钮——此前那里只有「新建设计」一条路，扫不到的时候会让人以为设计丢了。
- **主进程改动项目列表后侧边栏不刷新**：项目列表的事实源在主进程配置里，但渲染进程只在启动和用户亲手操作后重读，于是任何**不经过渲染进程**的写入（插件的 `official.projects.*`、Action）改完配置后侧边栏纹丝不动，要重启才看得到。现在 `ProjectService` 的每一次落盘都广播 `vetta:projects:changed`，渲染进程收到即重读；没落盘的调用（如 create 命中「已存在就不写」分支）不广播，不会白刷。
- **会话不再写进用户的工程目录**：普通项目的会话产物一直存在全局的 `~/.vetta/agent/sessions/--<编码后的项目路径>--/`，7 月 29 日 Desktop Runtime 切换到新 Backend Pool 时缺省落点被写成了 `<项目>/.vetta/sessions`——于是每开一个会话，用户仓库里就多一个未跟踪目录（可能被 `git add -A` 误提交，也可能随项目分发出去）。现在缺省落点恢复为全局分片目录；批量任务与「对话」/ Claw / 知识库这些自带 `sessionDir` 的场景不受影响。这段时间已经落在项目里的会话**不需要迁移也不会丢**：项目的会话目录发现同时认全局分片与 `<项目>/.vetta/sessions` 两处，列表按 cwd 并集展示。仓库里已经产生的 `.vetta/sessions` 可自行删除。
- **在新会话页贴设计备注不再石沉大海**：UI 设计画布的备注自动派活此前要求宿主已有活动会话，而新会话欢迎页恰恰把活动会话清空了——用户在画布上贴了备注，左侧毫无动静，也没有任何提示。现在这种情况下会先按当前项目 cwd 建一个会话（执行模式跟随页面当前选择，建完跳进对话页，与手动发送一致）再派活。真正发不出去的只剩「会话在别的工作区」与「Agent 正在跑」两种，语义不变。配套 Plugin API 新增 `conversation.createSession()`。
- 插件热更新现在保存 `activate()` 返回的 activation-scoped cleanup，并只在对应旧实例释放时执行，避免 last-known-good 替换流程中的模块级 `deactivate()` 误清理新运行时。

- **插件媒体能力列表兼容严格 JSON 校验**：宿主复制 Provider capability 时不再把缺省的分辨率、比例、时长和模式字段显式写成 `undefined`，避免内容创作读取 ComfyUI 等视频 Provider 时被 capability 输出边界拒绝。
- **消息队列收归主进程 kernel，多处丢消息与误发路径根除**（ADR-0060）：streaming 中发送改为直发 `session.prompt`（携 `streamingBehavior: "followUp"`）进入 kernel 队列，本轮自然停止点接力消费；渲染端仅保留镜像。修复：出队后发送失败不回滚导致丢消息、「立即发送」的 abort+8 秒超时竞态导致丢消息（打断与续发下沉到 kernel 原子完成，语义不变、竞态消失）、上游报错后队列被误判自然结束继续自动派发、打断/出错后排队消息静默滞留（现队列暂停并在输入框队列抽屉脉冲提示，可「继续发送」或移除）、队列纯内存重启即丢（现随会话 sidecar 持久化）。排队消息的用户气泡改为在被实际消费时上屏，顺序与模型可见顺序严格一致。
- **失败重发不再产生重复用户记录**：上一轮以错误收尾且重发文本与最后一条用户消息相同时，自动走 `replaceLastUserMessage` 路径回退后再发，jsonl 与下一轮模型上下文只保留一条。
- **插件 sendPrompt 不再吞用户准备的输入**：插件发送不消费用户挂在输入框上的 promptAttachment、不清空输入预测；`sendPrompt` 返回 `sent | queued` 回执并透传队列条目 id。
- **继续使用过的历史会话无法再次打开**：Legacy 会话首次导入后，Renderer 会采用 Runtime 返回的 canonical Conversation V2 路径；存储层同时允许复用 Import Seed 一致且已追加原生事件的迁移目标，避免切换回来时因固定 recovery 目标冲突而抛出 `Conversation already exists`。
- **执行中的会话切走再切回时不再丢失刚发送的用户消息**：Renderer 会按 runtime session 暂存尚未被 canonical 历史确认的乐观用户气泡；会话历史水合时保留缺失气泡，待对应序号的持久化用户消息出现后自动去重并清理暂存。活动会话的队列自动派发与立即发送使用同一保护。
- **插件工作区视频 MIME 识别**：`fs.readBinaryFile` 现在正确返回 MP4、M4V、MOV 与 WebM 类型，避免生成视频被标记为通用二进制后无法在节点中播放。
- **重启后上下文圆环点击无响应**：总 Token 会从会话历史恢复，但分区构成报告此前只存在于进程内存，导致重启后圆环仍在、Popover 内容却未挂载。现在按会话缓存最新的隐私安全报告并在重启时恢复；旧会话尚无缓存时也会正常打开并说明下一次模型调用后生成明细，不再静默无响应。
- `vetta-host://ui` ESM 桥接现在会同步转发全部 `@vetta/ui` 运行时导出，避免插件使用新增的下拉单选组件时在模块加载阶段报缺少导出。
- **插件媒体任务支持页面刷新恢复**：通用 Job 与临时产物改为按稳定插件 owner 跨 renderer capability session 保留；媒体 Provider 重载后，进行中的 Job 会按稳定 Provider ID 绑定新注册实例继续查询，内容创作图片/视频节点不再永久卡在刷新前的生成状态。
- **丢失的宿主任务停止重复轮询**：主进程重启或遗留任务导致 Job 内存记录不存在时，`job.get` / `job.cancel` 返回标准 `job-not-found` 终态，不再持续抛出 IPC handler 错误。
- **设计画布首次打开要等很久（依赖装不完，agent 都收工了面板还在转）**：两处叠加。其一，托管运行时配置的 npm 镜像源与共享缓存（`npm_config_registry` / `npm_config_cache` / `npm_config_prefix` / `npm_config_userconfig`）只写在主进程 `process.env` 上，而插件命令的子进程环境是按白名单构造的，这几个键全被挡在外面——插件里的 `npm install` 一直在绕过镜像走默认 registry。其二，设计引擎模板只带 `package.json`，每次都要向 registry 重新解析约 190 个包的版本范围。现在白名单放行这几个 npm 配置键，引擎模板同时 materialize `package-lock.json` 并改用 `npm ci --prefer-offline`。同一台机器冷缓存实测：45.3s → 14.3s（仅镜像）→ 1.9s（镜像 + `npm ci`）。存量已装好的引擎目录不受影响，不会触发重装。
- **重启应用后进会话，输入栏模型被重置成列表第一个**：会话用的模型只存在主进程内存里，重启后按 sessionPath 重开会话时，后端拿不到该会话的模型，落到「可用模型列表第一个」这个兜底值（`backend-pool.ts` 的 `resolveInitialModel`），渲染层再无条件把这个值 pull 回输入栏，覆盖掉本地记住的选择。同一次运行里切来切去看着正常，是因为会话 handle 还在内存里。现在重开已有会话会从会话历史里恢复上一轮实际使用的模型；该模型已被删除或没有凭证时才回落到默认模型。
- **能力页「Vetta 内置」分组只列出几项、计数也不对**：列表分页原本先把全局按下载量排序的扁平结果切成 60 条，再对切片分组。内置能力下载量为 0 恒排在最末，第一页只捞到零星几条，分组标题旁的计数显示的也是这个已加载数（例如实际 12 个只显示「2」），要点「加载更多」才补齐。现在内置能力整组返回、不参与分页，分页只作用于市场条目，「加载更多」的剩余数量也随之只算市场条目。
- **窗口从窄屏拉回宽屏后活动面板空白**：面板内容 portal 到一个容器里，而宽屏侧栏与窄屏 bottom sheet 各渲染一份该容器。跨断点拉宽时侧栏已挂载并登记了新容器，随后 bottom sheet 播完退场动画才卸载，其清理无条件把登记清空，portal 失去落点——面板只剩空白，要再拉窄一次才恢复。现在只在被卸载的正是当前登记的容器时才清空。
- **活动面板拉满后不跟随窗口变宽**：面板宽度此前只存夹紧后的像素数，`"max"`（设计画布、内置浏览器、文件内嵌预览都用它）在写入那一刻就被求值成一个固定数字，窗口坐标系一变只会向下夹紧、不会回涨——拉开设计画布后把 App 拖宽，画布面板仍停在原宽度。现在存的是宽度**意图**（固定像素 / 跟随窗口拉满）：拉满态随窗口尺寸重新求值，用户拖动分隔条或任何写入具体像素即退出该态。固定宽度也一并修好：窗口变窄时夹紧、变宽时回到用户原本拖出的宽度，而不是永久留在被压缩后的值。历史 localStorage 里的裸数字按固定宽度读入。
- **输入栏上下文构成改为分类汇总**：默认只展示基础指令、扩展能力、工具、对话和运行时上下文五类占用，点击后才展开原始区块；历史消息合并为一项并单列当前输入，避免长会话和大量工具把弹层铺成冗长明细。部分区块无法估算时保留已知 Token 合计，并明确标出未知项数量。
- **活动面板视频预览被裁切**：内置 `media-viewer` 的视频预览原先用 `object-cover` 铺满容器会裁掉画面；改为 `object-contain`，按面板尺寸等比缩放完整显示（黑底 letterbox）。

- **插件工作台热更新失败不再静默**：应用插件后会等待开发服务器 ready；CLI 缺失、版本不兼容、启动退出或超时会回传到工作台，而不是显示应用成功但源码修改无效。CLI 通过项目内 `@vetta-org/plugin-vite/cli` 公共子路径解析，兼容 ESM exports、workspace 链接与标准用户工程安装。开发工程只在版本化 ready 握手成功后原子覆盖 staging/installed 快照；启动失败保留稳定插件，运行中进程退出则回退并按 250ms/1s/3s 有限重启。批量 preset 会话限制为四路冷启动并逐插件汇总结果，单个插件失败不再把整批记为失败。

- **插件官方身份校验补强**：命令执行与长驻进程接口不再接受 renderer 传入的插件 ID，改由主进程从活动 capability session 解析真实调用者；插件 dev watch 也必须携带 official session。插件 SDK 与现有插件调用方式不变。
- **能力页首开列表转圈过久**：原先 `loading` 要等本地安装态、服务端 `/abilities/market`、开源市场三条 `allSettled` 全结束后才关，外加 `mcp.config === null` 再挡一道，网络 RTT 会直接变成整表转圈。现改为本地 IPC 就绪即出列表（内置/已装先可见），市场在后台合并；MCP 配置缺省按空表组装；开源市场同会话 `list()` 复用进程内快照，避免反复全量校验包。
- **侧栏切换会话卡顿**。最大头不是渲染慢，是点击后被排队等了几百毫秒：点会话行会先平滑滚动把行挪进安全区、并等分栏面板的 `max-height` 过渡结束，两个等待 `Promise.all` 完（fallback 分别 800ms 与 450ms）之后才真正发起会话切换——而 `openSession` 内部本来已经做了「拿到 sessionId 就写 activeSession + navigate」的优化，全被这段等待抵消，慢机上还容易吃满 fallback。现在滚动与切换并行，点下去立刻开始切。其余是渲染层：
  - 会话行改成 memo 组件，per-row 回调（选中/重命名/右键菜单）与行视图对象的引用都稳定下来——切换会话原本只有两行的高亮变了，却会把整份列表重建一遍。
  - `<Sidebar>` 加 memo。它挂在 RootLayout 下，而 RootLayout 同时订阅了附件、提及文件、选中 skill/模型、todo 等一堆与侧栏无关的状态，此前输入框贴张图都会把整条侧栏重渲染。
  - `useProjects` 拆出不订阅任何状态的 `useProjectActions`，只用动作的调用方（应用初始化、会话管理器、批量任务、归档设置、添加项目菜单）不再被会话列表刷新唤醒；项目面板对 `activeSession` 也改成只订阅 path/cwd。
  - 会话列表回填时内容没变就不换引用；`onSessionsChanged` 触发的全量重拉合并成一次（一轮对话原本要拉 2~3 趟，每趟都是一次 IPC + 全侧栏重渲染）。
- **流式期间整机卡顿（Renderer / GPU 进程 / WindowServer 三高）**。三处，全部行为等价：
  - 流式 delta 的冲刷从每 rAF 一次（约 60 次/秒 `setChatMessages`）节流到 100ms 一次。文字的视觉揭示在下游本来就是 500ms 批的，60fps 冲刷对画面毫无贡献，只让尾部消息的分组/折叠计算与 Virtuoso 重测每秒白跑 60 遍；主窗口是透明 + vibrancy 窗口，渲染进程每刷一帧 WindowServer 就要整窗重合成一次，重绘频率降 6 倍，WindowServer 负载同比例下降。工具/状态事件前的同步冲刷路径保持不变，块顺序保证不受影响。
  - 摘掉 `.streaming-chunk` 的 `will-change: opacity, transform`：流式回复每 10 个字符一个 chunk span，此前每个都被永久提升成合成层，一条长回复几百个活层贯穿整个流式期，GPU 进程与 WindowServer 一起被打满。360ms 入场动画期间浏览器本来就会自动提升，动画完让它自然降回普通内容。
  - 流式指示器的逐字符入场从 motion.span（JS 每帧写内联样式）改为纯 CSS `animation-delay` 错峰，时长/缓动/错峰间隔/模糊参数逐一保留，画面不变，主线程零参与。
- **对话消息列表在低配机上的滚动与展开卡顿**。改动分三类：
  - **粗粒度订阅导致的全列表重渲染**。展开态存储 `expansionStore` 原本用 `useAtom` 订阅整张 map，视窗内每个折叠组件（每个工具行、每个阶段、每条消息的折叠条、每个错误块）共享同一个对象引用，点开任意一处就把它们全部重渲染一遍——现在按 key 用 `selectAtom` 切片订阅。`useMessageCardsHostModel` 里「card key 归属表」原本每条 assistant 消息各算一遍全量消息扫描（整条列表 O(N²)，流式期间每帧重跑），现在提成派生 atom 全局算一次，且只有真的产出了卡片的消息才订阅它。`useAssistantMessageModel` 与 `useToolCallBlockModel` 不再订阅 `activeSession` 整个对象和 `promptPredicting` 整张 map，只取 `runtimeId` 与本会话的预测位。
  - **展开动画与虚拟列表测量互相打架**。工具卡片、阶段组、思考块、错误详情的折叠动画原本用 framer-motion 的 `height: 0 → auto`，每帧回主线程写内联 height 并触发强制样式重算，外层 Virtuoso 的 ResizeObserver 又把每一帧都变成一次列表重测量。改为 CSS `grid-template-rows: 0fr → 1fr` 过渡（新增共享组件 `CollapsePanel`），不占主线程 JS，也不经过 React 协调；内容仍按需挂载。
  - **收起时的一顿**。折叠动画跑完那一刻要把整棵工具卡片子树同步卸载掉，是一次很长的提交，正好压在动画收尾帧上——所以把动画从 JS 换成 CSS 只让展开变顺，收起没变。现在动画结束先 `display:none`（布局立刻定稿，子树不再参与布局与绘制），真正的卸载挪到浏览器空闲期（2s 兜底）；收起后马上再展开则取消卸载、直接复用已有子树。顺带修掉两处：折叠面板改用 grid 布局后 `display:grid` 会盖过 `[hidden]`，导出态的折叠面板实际没被藏住；以及每个「初始收起」的面板挂载时都会白排一个 200ms 定时器（工作模式一条消息几十行就是几十个）。
  - **重复计算**。消息列表 `itemContent` 里 `hasAssistantAfter` 原本对每个可见条目做一次 `slice().some()`（O(n²)，流式每帧重跑），改为一次倒序扫描预算位置；`conclusionText` 不再重复调用一次 `getAssistantFoldData`；代码块高亮加了结果缓存，条目滚出视窗再滚回来不必重跑 shiki，也不再「先纯文本、后高亮」变两次高度；虚拟列表未测量条目的高度估算从 80 提到 200（更接近真实中位数，往回滚时少一大截高度修正）；贴底跟随的 rAF 在静止时降频读布局，不再每帧一次强制 reflow。
- **输入预测不再固定说中文**。喂给预测模型的上下文里每条消息前缀是写死的「用户:」「助手:」标签，等于反复给模型「本会话说中文」的信号，用户全程英文也会拿到中文建议。标签改为英文 `User:` / `Assistant:`，语言回归由用户消息本身决定。
- **对话里的报错不再是一排看不懂的红块**（ADR-0057）。三处一起改：
  - **不再堆叠**。一次限流原本会连着刷出 6~7 个内容一模一样的红块（自动重试 3 次，每次失败一条，`auto_retry_start` 又算一条）。现在重试期间不再往消息流里塞错误，只在最终失败时留下一条。历史回放走另一条路——会话文件里确实存着每一次失败——由 `historyToChat` / `fullHistoryToChat` 折叠连续同类错误并标「重复出现 N 次」，所以重开旧会话也不会再长回来。
  - **看得懂**。错误按 限流 / 额度用尽 / 网络 / 密钥失效 / 服务端故障 / 未知 六类归档，卡片显示一句现象加一句建议（「请求太频繁了 / 稍等片刻再发一次就好」），provider 原文收进「查看详情」的折叠区，旁边有复制按钮。额度与密钥两类各带一个跳转按钮直达对应设置页——只有这两类真需要人离开对话去处理。展开态存在 `expansionStore` 里，滚出视窗再滚回来不会自己折回去；导出 HTML 时详情直接展开。
  - **重试可见**。退避等待期间底部显示「连接不太稳定，正在自动重试（第 2/3 次）」，最终失败的卡片会说明「已自动重试 3 次」。此前这段时间界面完全静止，用户只知道卡住了。
  - 视觉上撤掉了红底红框：这些绝大多数是暂时性抖动，红色把每次抖动都渲染成事故。改为中性卡片，紧迫性交给图标、文案和动作按钮。
- **修复隔夜/睡眠后第一次使用掉登录**。成因是 refresh token 被多方共用后互相作废（详见 `@vetta/api` 的 CHANGELOG），客户端侧配套修三处：
  - `settings.json` 的读-改-写改为跨进程加锁（`updateSettings`，与 coding-agent 的 `FileSettingsStorage` 用同一把 `proper-lockfile` 锁）。此前主进程无锁整份写回，与 coding-agent 或同机另一个客户端实例交错时会把已轮换掉的 `serverRefreshToken` 覆盖回旧值，下次刷新出示的即是已撤销令牌。
  - 授权回调未携带 refresh token 时清空本地旧值，而不是继续留着上一次登录的（多半已失效，用它刷新会被服务端按重放处理，直接撤掉整条会话链）。
  - 刷新失败落日志并记录业务错误码（40105 无效 / 40106 过期 / 40107 已撤销）与登出触发点。此前只看 HTTP 401、丢弃响应体，掉登录后无从判断成因。
  - 启动时以主进程 `settings.json` 为准补齐渲染层 token：两处存储不同步时（localStorage 被清等），磁盘上仍有效的凭据不会再表现为「掉登录」。只在挂载时对齐一次，避免登出瞬间把旧 token 读回来。
- **Windows 插件命令可启动 npm 等脚本入口**：`command.run` / `command.spawn` 共用跨平台启动器；内置 `node` / `npm` / `npx` 优先解析到托管 Node 的绝对路径，其他 `.cmd` / `.bat` 与 shebang 命令由统一兼容层解析，不再因裸 `spawn("npm")` 报 `ENOENT`。

- **输入栏命令面板不再丢掉开源市场能力的图标**：开源市场 skill/scene 的图标解析后是 `vetta-file://local/...`，而命令面板与 skill 胶囊共用的 `SkillTypeIcon` 原先只认 http(s)/相对路径/data，导致列表与 token 一律退回默认立方体。图片态判定补上任意 `scheme://`（含 `vetta-file`），与能力广场一致。

- **插件贡献的 skill 显示宿主插件图标**：如 `vetta-ui-design` 这类随插件内嵌的 skill 不在市场目录里，命令面板此前只能落默认立方体。`skills.list()` 现在把宿主插件的 `iconUrl` 挂到 `SkillInfo.icon`，命令区 / 胶囊 / 能力页统一认领。

- **订阅卡片的窗口重置倒计时超过一天按「天」显示**：周窗口显示成 `136h 39m`、月窗口 `606h 13m`，几百小时读不出还剩几天。`SubscriptionCardsView` 里有一份自己的格式化函数，只会 `h`/`m` 不进位到天，而且硬编码英文单位、绕开了已经写好的 `subResetInDays` 等 i18n 文案。改为倒计时文案由 `useSubscriptionCardsModel` 用 `getResetCountdown` + `t()` 算好，视图只渲染 `resetLabel`（视图层不再持有 `now` 与本地格式化函数）。现在显示「5天16小时后重置」/「Resets in 5d 16h」。

- **开发模式登录回调不再拉起已安装的正式版**：dev 跑的是 `node_modules` 里的 Electron.app（bundle id `com.github.Electron`，Info.plist 没有 `CFBundleURLTypes`），macOS/Linux 的 LaunchServices 只会把 `vetta://` 派发给声明过该 scheme 的 bundle，也就是 `/Applications/Vetta.app`，开发中的实例永远收不到 token；`setAsDefaultProtocolClient` 在 macOS 上也救不了（系统拉起 bundle 时不带 `dist/main/index.js` 这个 argv）。非打包时改走 OAuth 标准的 loopback 回调：主进程在 `127.0.0.1` 临时端口监听 `/oauth/callback`，`client_redirect` 指向该地址，收到后归一化成 `vetta://oauth/callback?…` 复用既有的 state 校验链路，并把窗口抢回前台。打包版行为不变。

- **能力市场「我的」不再按工作模式过滤插件**：声明了 `agent_mode` 白名单的插件（如 `agent_mode: ["work"]`）在「编程」模式下会从「我的」里整条消失，看起来像能力丢了。能力页改用不过滤的 `plugins.listAll()` 取已装插件；插件详情页新增「适用工作场景」一栏，列出该插件声明的模式（未声明则为「全部场景」），当前模式不在白名单时给出提示。（本版稍后进一步取消了全部模式硬闸，工作台列表与 UI 贡献也不再按模式过滤，详见下方「工作模式不再隐藏任何插件」。）

- **活动面板「生图历史 / 移动预览 / 内容创作」默认不再占栏**：生图历史 `initiallyVisible: false`，仅在 `generate_image` / `edit_image` 成功后 `openActivityTab` 上栏；移动预览改为跟文件树选中（含 html/htm）显隐，不再因项目里任意存在 html 就自动上栏；内容创作（content-creation）同理默认隐藏，由 `open_content_creation` 或用户从「+」添加后再显示。
- **移动预览旧安装包一直占栏**：已装的 `mobile-ui-preview@0.2.x` 未声明 `initiallyVisible: false`（缺省即上栏），与源码改动无关也会常驻。0.3.3 显式 `initiallyVisible: false`，会话回放时按选区写回显隐以清掉历史 attach 脏记录。
- **用户消息里图片胶囊不再退化成文件名**：输入框是「图 N」+ 上方缩略图，发出后 Windows 路径里的 `\.` 会被消息气泡的 CommonMark 当转义吃掉，编号表对不上就回退成 basename。路径 token 统一写成 `/`，编号查找也按同一键，气泡与输入框一致。
- **文件编辑器保存后无法撤销**：CodeMirror 的 `documentKey` 误绑定磁盘 `revision`，保存成功 revision 变化会整实例重挂载并清空撤销栈。改为按 `editorGeneration` 标识编辑会话（仅磁盘重载/外部干净替换时递增），保存与草稿编辑保持同一编辑器实例。
- **编辑/预览切换保留撤销栈**：有渲染预览的文件（HTML/Markdown 等）在切到预览时不再卸载 CodeMirror，仅隐藏编辑器并叠放预览层；回到编辑时 `requestMeasure` + 恢复焦点，正文与 Ctrl+Z 历史都不丢。
- **HTML 预览不再跟随应用主题**：取消按 App 深浅切换 iframe 底色与文档 `color-scheme`（避免未写背景的页面被强制成深色画布）；预览外观由 HTML 自身 CSS 决定，壳层固定浅色兜底。

### Changed

- **插件附件改为输入框外的引用行**：插件挂上来的上下文不再是输入卡片里的胶囊，改画在卡片**外面**顶部——来源图标 + 逐条列出的名字（右侧 hover 出移除），一次选中三个对象就是三条，而不是「3 个画框」这种数不出是哪几个的汇总。插件 SDK 的 `PluginPromptAttachment` 因此新增可选的 `labels: string[]`（省略时回落到 `[label]`），vetta-ui-design 与内容创作都已按条给名。
- **Vetta UI Design 选中改为挂到 AI 输入框**：画布不再自带「让 Vetta 调整」按钮与浮层。选中画框或 Figma 式选中的 DOM 元素后，输入框上方直接出现画框名那一行引用，用户在输入框里正常提问即可，选中作为结构化上下文（`vetta.ui-design.canvas-selection`：画框绝对路径/尺寸、元素的插桩源码位置与 DOM 路径）随这一轮发出。单选画框/元素时后台截一张图（元素保留高亮描边）一并带上；多选只给元数据，由 agent 按需 `vetd_screenshot`。引用可随手摘掉，摘掉后同一次选中不再自动挂回。
- **插件网络目标改为清单声明，命令执行收口到 official 插件**（ADR-0060）：`network.fetch` 必须配置 `network.allowedHosts`，主进程按 capability session 绑定的插件 ID 校验首跳与每次重定向；公网、私网 IP、localhost 均可显式声明，official 插件可使用 `*` 适配用户自定义服务地址。`agent.command.run` / `agent.command.spawn` 及命令授权不再对 local/community 插件生效，执行入口仍做权威 trustLevel 校验。
- **活动面板拉到最大时给对话区留更多空间**：`ACTIVITY_PANEL_MIN_CHAT_AREA` 由 360 提到 454，消息列表最窄净宽从约 336 提到约 430。
- **项目文件拖出系统时使用应用内文件类型图标**：原生 `startDrag` 幽灵图与文件树一致（`getFileIcon` / vscode-icons），由渲染进程栅格化为 PNG 后缓存到主进程；pointerdown / 选区变更时预取。缓存未命中时回退应用 logo，不再使用系统 `app.getFileIcon`。
- **插件可选用宿主 `@vetta/ui` 单例**：Module Federation share 与 `vetta-host://ui` 提供 Button / Dialog / Switch / Slider 等 primitives，构建侧由 `@vetta-org/plugin-vite` external，避免插件自带一份 UI。可选、半稳定，不承诺跨大版本 semver；`@vetta/theme-ui` 仍不共享。见 `docs/plugin/styling-and-pitfalls.md`。
- **活动面板 tab 统一贡献注册表**：内置与插件 tab 同构为 `ActivityTabDefinition`（`useMeta` + `component`）。Host 只跑 meta 收集 → 可见性（hidden / 插件 attach 三态）→ 排序管道；`useActivityPanelModel` / `ActivityPanelView` 不再枚举 todo/workflow/browser 等业务。新增内置 tab 只需在 `domains/activity-panel/builtins` 注册。浏览器 tab 仍通过 `keepAliveWhenAvailable` 跨 tab 保活 webview。
- **更新就绪不再自动弹全局对话框**：后台下载完成（`phase === "ready"`）时只保留侧边栏底部的更新提示项，不再打断当前操作。设置 → 更新里点「立即重启」仍会打开重启确认对话框。

- **内置 Skill「发布能力」提交前会读安装包核对 payload（2.1.0）**：新增 `scripts/package-inspect.mjs`（零依赖手写 zip / tar.gz 解析），`--dry-run` 与正式提交都会打开 `.zip` / `.tar.gz`，用 `plugin.json`、`locales/*.json`、`SKILL.md` frontmatter 反查 payload。拦下的是一类服务端不会报错、装完切语言才看得见的问题：① 译文块的 locale 键带地区后缀（`en-US`）——客户端界面语言只有基语言，包内若也有 `locales/en.json`，两块并存且只命中包内那份，作者写的正文/头图整块不显示；② 键与包内 locale 文件名不一致；③ 给包的 `defaultLocale` 又写一份译文块；④ `detail` 与译文块里的未知字段（`title` / `long_description` 之类），服务端 `json.Unmarshal` 会静默丢弃；⑤ plugin 传了不会生效的 `version`。`slug` 被忽略、包内 `vetta.json` 被 `detail` 整体顶替、手写译文与包内不一致等改为 warning 随结果返回。同时 `publish.mjs` 不再重复发送平铺的 `tags` 表单字段（skill/scene 的上传路径根本不读它，其余形态也会被 `detail.tags` 覆盖），`payload.md` / `SKILL.md` 补齐 locale 键约定、`i18n` 对已存行是整体替换、以及各字段的优先级链。

- **HTML 预览去嵌套工具条**：内置 HTML 预览改为纯 iframe 渲染表面，去掉内部「预览 | 代码」分段。源码统一走文件编辑器的「编辑」模式；HTML/Markdown 打开默认进入预览，纯文本仍默认编辑且不再显示无效的编辑/预览切换。
- **文件编辑器语法高亮与扩展名映射完善**：CodeMirror 高亮主题提高 HTML/XML 等标记语言对比度（标签名 / 属性 / 属性值 / 尖括号独立着色）；扩展名→语言映射与只读 CodePreview（Shiki）共用，覆盖 vue/svelte/xhtml/xml 等，并新增 `@codemirror/lang-xml`。
- **文件编辑器语法配色可扩展（VS Code 风格）**：语法色全部走 `--syntax-*` CSS 变量，默认对齐 VS Code Dark+ / Light+；主题只需覆盖对应变量即可换色，无需改编辑器代码。
- **文件列表面板顶部标题固定为「项目文件」**：不再显示动态项目/文件夹名，统一用 i18n 文案（`fileExplorer.fileList`）。
- **能力广场不再要求登录**：市场列表与安装（skill / scene / plugin 的下载安装）在未登录状态下照常可用，服务端对应接口已开放匿名访问。`fetchMarketAbilities` / `fetchAbilityInfo` / `downloadAbility` 的 token 参数改为可选并移到末位，有 token 时仍带 `Authorization`。移除安装前的「请先登录」拦截与 `abilities:error.notLoggedIn` 文案。
- **内置 Skill 展示文案接入 i18n**：「创建技能」「发布能力」的名称与描述改由宿主 catalog（`skills:builtin.<name>.*`）按当前语言给出，`skills-manifest.json` 里的中文降级为缺译回退。切语言时能力广场与输入栏命令面板都会重新取数（命令面板的模块级缓存改为按语言分键）。
- **系统插件图标改用包内 PNG**：office-viewer、image-gen、svg-viewer、media-viewer、chart-renderer、plugin-workbench、vetta-actions、git 的 manifest 图标由 Iconify 名换成包内 `icon.png`。
- **Git 插件不再限定 coding 工作模式**：manifest 去掉 `agent_mode: ["coding"]`（agent_mode 轴改为通用）。面板与 turn 卡的显隐仍只看当前 cwd 是不是 git 工作区（`git rev-parse --is-inside-work-tree`），非仓库目录照旧不占标签位。
- **「插件工作台」更名为「制作插件」**：插件名、活动面板标题、Activity Tab、输入栏 mode 开关及配套 skill / prompt 文案统一改名（英文 `Create Plugin`）。

### Fixed

- **macOS 经典侧边栏深色下的选中背景会被背后桌面「吃掉」半边**：侧边栏底是半透明 `--background` 叠原生 vibrancy，底色跟着背后桌面的明暗走，而主题的 `--accent`（深色 `rgb(41, 41, 43)`）是不透明实色纹丝不动；背后亮的那一段底色被抬得比选中块还亮，高亮与底色的明暗关系当场反转，看着就像那半边的选中背景没了。把浅色早先单独做的半透明 `--accent` 覆盖提升为不分明暗，选中始终是「在当前合成底色上再压 10% 前景色」。导航指示条、项目行/会话行选中与 `hover:bg-accent/50` 一起生效；深色下叠出来的颜色与原先的 `rgb(41, 41, 43)` 基本一致，纯色背景下观感不变。

### Removed

- **系统插件「我能帮你」(guiding-words) 移除**：不再随 App 构建/打包，preset 源码目录一并删除。
- **官网下载清单 `downloads.yml` 不再生成**：下载页已改为读 Admin 后台配置的直链，这份清单没有消费方了。删除 `scripts/generate-download-manifest.mjs` 与 `generate:downloads` script，R2 发布不再生成和上传它，GitHub Release 也不再把它作为附件。`updaterMetadataPattern` / `referencedFileName` 移到 `scripts/updater-metadata.mjs` 继续供发布脚本使用。electron-updater 的 `latest*.yml` 不受影响，自动更新照旧。

### Breaking Changes

- **客户端只保留授权登录，账号密码登录移除**：登录入口与引导页登录步不再有账号/密码输入框，点「登录」直接唤起系统浏览器走站点授权，回跳 `vetta://oauth/callback` 完成登录。渲染层 `loginByAccount` / `LoginResponse` 删除（服务端 `/auth/login` 不受影响）。非 GitHub/Google 账号经站点 `/login` 的邮箱验证码或邮箱密码登录，客户端不再提供第二条入口。
- **登录弹窗改为侧边栏左下角浮层**：全屏 `LoginDialog` 删除，改为锚在侧边栏底部的 `LoginPopover`。设置菜单点「登录」即关闭设置菜单、弹出授权浮层并**同时发起授权**——浮层里不再有「授权登录」按钮，不需要第二次点击。浮层只呈现等待态（「正在等待浏览器授权 / 完成后将自动登录」+「重新打开链接」）与失败态（错误文案 +「重新授权」）。
- **主题槽位改名与契约变更**：`root.loginDialog` / `root.loginDialogView` → `root.loginPopover` / `root.loginPopoverView`；`LoginDialogViewProps` 由表单模型改为 `LoginPopoverViewProps { phase, error, labels, onReopen, onRetry }`，`open` / `account` / `password` / `onAccountChange` / `onPasswordChange` / `onSubmit` / `onStart` / `onClose` / `loginLoading` / `oauthLoading` 全部移除（开合交给 Radix Popover）；labels 收敛为 `waitingTitle` / `waitingHint` / `reopen` / `retry`。覆盖该槽位的主题需要跟着改。
- **i18n 命名空间 `common.loginDialog` 改名为 `common.login`**：并去掉 `title` / `subtitle` / `footerHint` / `accountPlaceholder` / `passwordPlaceholder` / `login` / `loggingIn` / `oauthDivider` / `error`，新增 `waitingTitle` / `waitingHint` / `reopen` / `retry` / `openFailed` / `rejected`。
- **`loginDialogOpenAtom` 改名为 `loginPopoverOpenAtom`**。
- **`/skills` 与 `/plugins` 路由移除**：两者重定向到 `/abilities`（`/skills?tab=scene` 仍去 `/scenes`）。渲染层不再有独立插件页与插件卡片/详情 Drawer。
- **市场接口收敛为 `/abilities/*`**：`fetchMarketSkills` / `fetchMarketPlugins` / `fetchMarketMcpServers` 与 `downloadSkill` / `downloadPlugin` / `fetchSkillInfo` / `fetchPluginInfo` 由 `fetchMarketAbilities` / `fetchAbilityInfo` / `downloadAbility` 取代。
- **输入框改为多模态编辑器，`chat.inputBarView` 契约变更**：`InputBarModel` 不再有 `inputValue` / `textareaRef` / `mentionedFiles` / `attachedImages` / `imageFiles` / `nonImageFiles` / `imagePreviewItems` / `hasImages`，`actions` 里的 `handleChange` / `handleKeyDown` / `handlePaste` / `getAtFilter` / `removeFile` 移除，新增 `handleEnter` / `handleTriggerChange` / `imageAttachments` / `atFilter` / `removeImage(path)`；`classNames.textareaWrap` 改名 `editorWrap`。覆盖该槽位的主题需要跟着改。
- **输入框里的 skill 由硬展开改为软引用**：选中 skill 不再写 `PromptRequest.promptRef`、也不再由 coding-agent 把 skill 正文注入成隐藏 `<skill>` 块，而是在消息文本里留 `@skill:名字` 标记，由模型经 `invoke_skill` 自行决定是否调用，因此一条消息可以引用多个 skill。场景（scene）不变，仍走 `promptRef` 硬展开以保留 `tasks.json` 自动建 todo 与 todo 锁定；定时任务与批量任务的 `promptRef` 链路同样不变。

- **斜杠面板重构为命令面板，主题槽位一分为二**：`chat.slashPanelView` 拆成 `chat.commandPanelView`（聊天侧，含连接器宫格与底部动作条）与 `chat.skillPickerView`（批量任务 / 自动化 dialog 侧，纯 skill 选择器）；theme-ui 的 `SlashPanelView` 及其 `SlashPanelViewProps` / `SlashPanelItemModel` / `SlashPanelLabels` / `SlashPanelSkillItem` / `SlashPanelClassNames` 一并删除，面板不再有「场景 / 技能」两段分区（合成单列）。覆盖该槽位的主题需要跟着改。
- **输入卡片下方的动作条（知识检索 / 插件 input action）移入命令面板底部**：desktop 不再渲染 `InputActionBar`；已激活的开关改为在工具栏里紧跟执行模式（权限/沙箱）右侧显示（无底色无描边，点一下即关闭），避免面板关闭后激活态完全不可见。theme-ui 的 `InputActionBarView` 与 `chat.inputActionBar` surface 保留（官网 demo 仍在用），但对 desktop 已无效果——xianxia 主题里那条 `mx-auto w-[93%]` 因此不再影响客户端。
- **工具栏按形态切换**：收缩形态下是「+」+ 执行模式（左）与模型 / 用量环 / 发送（右）；展开形态下执行模式、模型与发送一并收起，执行模式的位置让给「插图 / 附件」——命令区已占满上方，此时工具栏只服务于「往输入框里添东西」。命令区底部只保留可开关的知识检索 / 插件 action。
### Added

- **能力页「添加能力」支持导入本地插件 zip**：原先菜单只有「导入技能压缩包」与「手动添加 MCP」，插件本地安装被注释成开发者路径。现增加「导入插件压缩包」，走既有 `plugins.installFromArchive`（`source: "archive"`），装完刷新能力列表。
- **外观设置新增「侧边栏样式」**：「经典」（默认）让侧边栏贴紧窗口左侧，去掉圆角与四周边框、只保留右侧一条分隔线；「悬浮」是原来的留白 + 圆角 + 边框形态。偏好存 localStorage `vetta-sidebar-style`，首帧前写到 `<html data-sidebar-style>`，避免启动时闪一下悬浮态。窄屏 overlay 侧边栏不受影响，仍是圆角浮层。macOS 下经典侧边栏透出系统原生毛玻璃（窗口本就带 `vibrancy: "sidebar"`，此前被整帧底色盖住）：整帧不上底色、侧边栏改铺一层 60% 的半透明 `--background`（压住壁纸杂色又保留通透感），主内容区用 `::before` 溢出 8px 补回不透明底色，因此布局与其它平台完全一致，只有侧边栏那一条是毛玻璃。`<html data-platform>` 由 `applyPlatformAttribute()` 写入，供仅某平台生效的样式选择。
- **侧边栏「更多」菜单新增设置直达项**：模型设置 / Agent 设置 / 外观，分别跳 `/settings/models`、`/settings/context`、`/settings/appearance`。`SidebarNavItem` 新增可选 `settingsTab`（与 `path` 互斥）。
- **订阅卡「升级套餐」外链按钮（ADR-0051）**：设置页 Vetta Go 订阅卡右上角新增按钮，`shell.openExternal` 跳官网 `/pricing` 完成购买。desktop 刻意不做站内支付——3DS 验证、银行跳转、PayPal 弹窗在 `BrowserWindow` 里均不可靠，支付闭环收敛在官网。theme-ui 的 `SubscriptionCardsViewModel` 新增可选 `actions.upgrade` / `labels.upgrade`（缺省不渲染，旧主题不受影响）。
- **全局统一的加载指示器 `Spin`（`@vetta/ui`）**：两颗小球黏连、分离、整体旋转的「果冻」效果，黏连靠 SVG 高斯模糊 + `feColorMatrix` 拉伸 alpha 实现。颜色取 `currentColor`，跟随容器文字色，用主题类切换即可（`<Spin className="text-primary" />`）；尺寸只开 `sm`/`md`/`lg` 三档，避免各处随手写像素值。keyframes 经 React 19 的 `<style href precedence>` 全页去重只插一次，SVG filter id 用 `useId()` 隔离，同页多个实例不串扰；`prefers-reduced-motion` 下停在两球分离的静止态而非塌成一个点。授权等待浮层与引导页登录步已换用，后续需要 loading 的地方统一从 `@vetta/ui` 引。
- **授权登录的等待态与 state 校验**：发起授权后浮层/引导步显示「正在等待浏览器授权」，提供「重新打开链接」补救；关闭浮层只收起 UI，晚到的回调仍会正常登录，不设超时。主进程在发起时生成一次性 state 塞进 `client_redirect`，回调必须带回同一 state 才被接受——挡掉客户端未发起授权时被塞入的回调；state 只存内存（进程重启即失效），校验不通过时丢弃 token 并广播 `vetta:auth:oauth-rejected`，界面提示「授权链接已失效」而不是一直干等。新增 IPC `vetta:auth:start-oauth` / `vetta:auth:reopen-oauth`，URL 拼接与校验都在主进程，未校验的 token 不进渲染层。注意这挡不住 `vetta://` scheme 劫持本身（需 PKCE/一次性 code，单独排期）。
- **预设服务商改为客户端内置 + 模型列表动态拉取（ADR-0050）**：Claude / OpenAI / DeepSeek / Z.ai(GLM) / Kimi / Gemini 六家的 `baseUrl`、`api`、图标内置在客户端，不再依赖服务端 `/providers/templates.json`，离线冷启动也有预设服务商可选。客户端不内置任何默认模型清单：未填 key 时展示 models.dev 公共目录里该家的模型（含价格与上下文，标注「公共目录，填入 Key 后按账号刷新」）；填入 key 后立即请求该家 `/models`，换成该账号实际可用的模型列表（Anthropic / OpenAI 兼容 / Gemini 三套适配器，分别处理游标分页与能力位），之后每 12 小时后台同步一次，设置页每行提供手动刷新按钮并展示上次同步时间。接口不返回的上下文长度 / 视觉 / 思考能力与价格由 [models.dev](https://models.dev/api.json) 目录补齐（随模型列表同步、裁到六家后本地缓存 12 小时，拉不到退回缓存），目录里查不到的模型不显示价格。目录带一份随包快照兜底（`models-dev-snapshot.generated.ts`，`bun run snapshot:models-dev` 更新）：国内网络下 models.dev 常被 TLS 阻断，新装用户既无缓存也拉不到，退到快照后照样有完整模型与价格，线上拉到即覆盖。区块标题右上角新增刷新图标（清失败冷却强制重拉），失败经全局站内通知（Toaster）提示、原文进控制台与界面横幅；预设链路的错误改为主进程回传结构化错误码 + 参数、渲染层查 i18n 出文案（zh/en 双份），主进程不再产出面向用户的中文；密钥被上游拒绝单独归为 `invalid-key`（各家状态码不一：Bearer 系 401/403，Gemini 的无效 key 是 400），**启用即校验：拉不到模型一律不落盘、不启用**（认证失败、网络不通、超时、空列表都算），输入面板与草稿保留供修改；密钥被上游拒绝时标题直说「密钥校验未通过」，其它失败说「密钥未能校验」，都注明密钥未保存。已下线的旧条目无上游可校验，只改 key 不校验；服务商行内的 key 输入框与「启用」按钮合并为一个钥匙图标，点开才展开输入面板。默认每个系列只保留最新一档（按目录的 family + release_date 折叠，整族发布超过一年的淘汰，目录里查不到的一律保留），Claude 15→4、OpenAI 38→9、Gemini 22→5，不提供切回全量的开关。
- **能力（Ability）统一页与独立详情页（ADR-0049）**：Skill / 场景 / MCP / 插件 / 能力套装（bundle）合并为一个 `/abilities` 列表，筛选轴改为正交两条——分类（用途）与类型（五种 type）；「发现」/「我的」两个 scope 保留。新增 `/abilities/$type/$slug` 独立详情页（不再是侧边 Drawer，返回走 history.back）：通用壳层（图标/标题/作者/版本/状态/主次 CTA）+ `raw.detail.content` 的 markdown 正文 + `showcases` 结构化头图（沿用 `chat-over-canvas` / `chat-thread` 宿主呈现模板）+ type 专属区块（plugin → 权限与命令开关，mcp → 凭证与 OAuth，bundle → 成员列表可逐个跳详情）。
- **能力套装（bundle）**：恒无产物，`installed` / `enabled` / `needsUpdate` 全部由成员派生；卸载弹确认框列出将被卸载的成员并允许逐项取消勾选。
- **安装态改读安装台账**：`installed` / 本地版本 / 可更新一律取 `~/.vetta/abilities.json`，五种 type 共用同一套更新检测；`enabled` 仍回各自运行时（skills 清单 / mcp.json / 插件注册表）。
- **`abilities` i18n 命名空间**：能力页与详情页文案（含插件权限展示名）全部走 i18n，zh / en 双份 catalog。
- **能力详情的元信息表**：详情页新增元信息区块，展示官网 / 代码仓库 / 文档 / 开源协议及运营自定义条目，顺序由 admin 排定。预置项的名称走 i18n（zh / en），自定义项按运营填写原样显示；`http(s)://` 开头的值渲染为可点击链接。
- **插件详情展示内聚的 MCP 与技能**：插件详情页新增「本插件提供」区块，列出该插件经 `agent.mcpServers` / `agent.skillPaths` 自带的 MCP server 与 skill（名称 + 简介），未安装时同样可见。数据来自服务端上传时对 zip 的解析；仅本地安装且用内联 server map 声明的插件从 manifest 兜底取名。
- **插件条目的名称/描述走 NLS catalog 解析**：`plugin.json` 的 `name` / `description` 可以是 `%key%` 占位符（ADR-0033），能力卡片与详情页统一经插件自带 catalog 解析后再展示，不再直接渲染原始占位符；未安装的市场条目没有本地 catalog，由服务端在上传时解析好下发。
- **GitHub 开源能力市场**：能力页支持从环境变量配置的 GitHub 仓库整库同步 skill / scene / plugin / bundle，并以校验后的本地快照提供离线回退与安装；Plugin 配置从包内 `plugin.json` 派生并复用现有安全安装链路，Bundle 复用客户端成员批量安装逻辑；新增持久化多来源管理、来源级失败隔离、配置指纹缓存和确定性冲突策略，已安装能力锁定原来源；搜索、筛选与分页全部基于下载后的本地目录执行，不向 GitHub 发分页请求；单一 `marketplace.json` 强制声明 `minAppVersion`，不兼容的新内容不会覆盖旧的可用快照。
- **开源能力自带展示资源**：GitHub 能力目录可通过 `ability.json` 提供本地图标、Markdown 详情或宿主白名单 Rich Blocks，并支持按 locale 选择详情文件和 Markdown 回退；本地图片路径限定在能力目录内并随市场版本缓存。市场索引继续只承担列表元信息，仓库内容不能注入 HTML、脚本、CSS 或安全相关操作。
- **macOS 代码签名与公证接入**：`dist:mac` 检测到完整的签名凭据（`CSC_LINK`/`CSC_NAME` + `APPLE_TEAM_ID` + App Store Connect API Key 或 App 专用密码）时，自动开启 Developer ID 签名、hardened runtime（新增 `build/entitlements.mac.plist` 与 `build/entitlements.mac.inherit.plist`）与公证；DMG 随之退回两图标常规版式，不再打包「修复已损坏.app」、背景图也去掉「右键打开」提示。凭据一个都不设时行为与之前完全一致（未签名 + 修复助手），只设一部分会直接报错并列出缺项，避免产出「签了名但没公证」的半成品。证书申请与注入流程见 `docs/deploy/apple-code-signing.md`。
- **多模态输入框：文本与 skill / 文件 / 图片胶囊同处一条文本流**：输入区由 `textarea` 换成 Lexical 编辑器，`/` 选中的 skill、`@` 引用的文件、粘贴或拖入的图片都成为行内原子胶囊，可插在句子任意位置（「先 `@skill:审查` 这个 `@/path/a.ts`，没问题再 `@skill:上传`」），不再是输入框上方的一排附件。触发符从「整个输入开头」放宽到词首；图片在输入框内显示为「图 N」胶囊，缩略图集中在输入卡片上方并带同号角标，用户气泡按同一形态回放。文本形态 `@skill:名字` / `@绝对路径` 既是发给模型的内容也是持久化格式，旧会话的行首前缀格式（`/skill:name` + `@path` 整行）仍能解析并归一呈现，重编辑回填与气泡渲染共用同一个解析器。

- **命令面板是 InputBar 的一种形态，而非浮层**：命令区与编辑区同处一张输入卡片，`/` 或「+」展开时只是这张卡片长高（高度弹簧过渡），两者之间既没有接缝也没有分界线；收起即回到原来的一行形态。命令区绝对定位、底边钉在卡片顶沿向上生长，因此会话页的消息列表不会被顶走。skill 列表与连接器在空闲时段预取并按 cwd 缓存——否则第一次展开要等扫盘，数据在动画途中到位会把高度目标反复重测，表现为「第一次卡一下、第二次就顺」。因此 `CommandPanelProps` 没有 `placement`——浮层形态只保留给 dialog 侧的 `SkillPickerPanel`。「+」按钮成为真正的开合开关（此前 mousedown 会先触发面板的click-outside 收起、紧接着的 click 又把它打开，导致按钮只能开不能关）。
- **命令面板（Splash 完全体）**：`/` 或「+」唤出的面板顶部新增**已接入连接器宫格**——列出 mcp.json 里已添加、未禁用且必填密钥齐的内置连接器（canva / notion / figma / github / slack / gmail / google-calendar / google-drive），列数自适应以避免末行只剩单个（2→2、3→3、4→2、5/6→3、7→4）；点击插入 `@mcp:名字` 行内胶囊，与 skill 同为软引用，模型自行决定是否调用该 MCP。下方 skill 列表把场景与技能合成单列，按**调用次数 → 类别（内置 > 插件 > Vetta 原生 > 通用）→ 最近使用 → 名称**排序；调用次数取自 app-monitor 已落盘的 per-skill 统计（新增 IPC `vetta:app-monitor:get-prompt-ref-usage`）。item 高度 46px→32px 单行（图标 + 名称 + 来源标签 + 同行右侧描述），面板总高 320→420，宫格随内容滚动、只有头部与底部动作条固定；输入过滤词时隐藏宫格、键盘上下键只在列表内移动。
### Removed

- **「电光」/「翠玉」/「青石」三个主题色**：`voltage.ts` / `emerald.ts` / `slate.ts` 与四处 `COLOR_THEME_LABEL_KEYS`、zh/en `colorThemes.*` 文案一并删除，主题色只剩「默认」「珊瑚」「经典」三档（引导页主题选择随之从 2×3 变一排三列）。已选中被删主题的用户经 `resolveThemeId` 回落到默认主题 `mono`；`github → slate` 的历史别名同时移除（老 id 一样回落默认）。
- **设置页的骨架屏与块级入场动画**：`SettingsContentLoadingView`、`SettingsTabEnter` / `SettingsEnterItem` / `useSettingsEnterDelay` 与 `SETTINGS_ENTER_*` 常量从 theme-ui 删除（覆盖设置页排版的主题若引用了它们需要跟着改），`settings-highlight.css` 里的 `settings-element-enter` CSS 兜底动画一并移除。设置 tab 的 `Suspense fallback` 改为 `null`，`SettingSection` / `SettingsPageShellView` / 账号页的标题块换回普通 `div`（`data-setting-section-highlight-target` 等锚点属性不变，跳转高亮不受影响）。
- **设置 / 自动化 / 批量任务的切页骨架**：三个路由单独设 `pendingComponent: () => null`，pending 期间留空白、内容就绪后直出，不再闪一屏 `RouteContentLoadingView` 脉冲块。其余路由仍保留全局 `defaultPendingComponent`。
- **新会话页的场景轮播 / 技能徽章 / 引导词三个区块**：欢迎页只保留问候语、模式切换与输入栏。随之删除 `useNewSessionResources`（本地 skill + 市场场景 + 安装清单的拉取）、场景点击安装链路、`GuidingWords` / `SkillBadgeRow` / `SceneCarousel` 及 `useGuidingWordsModel`，以及主题槽位 `chat.newSessionSceneCarousel` / `chat.newSessionSceneCard` / `chat.newSessionSkillBadgeRow` 在 desktop 侧的声明（theme-ui 的组件与契约保留，主题覆盖它们对客户端不再有效果）。`chat.newSession` 的 `sceneCarouselNext` / `sceneCarouselPrev` / `sceneInstallPrompt` / `skillScrollLeft` / `skillScrollRight` 文案一并删除。
- **设置 → 新会话页**：整个 tab（含「页面元素」三个开关）与 `NewSessionSettings*` / `useNewSessionSettingsModel` 删除，`SettingsTab` 不再有 `newSession`；`newSessionPageVisibilityAtom` 与 desktop-config 的 `newSessionPage` 字段（主进程 `normalizeNewSessionPage`、preload 类型）一并移除。已有 `desktop-config.json` 里的该字段会在下次写入时被丢弃。
- **侧边栏「更多」里的「场景」入口**：`/scenes` 路由本身保留，只是不再从侧边栏进入。
- **服务端预设模板目录**：`/providers/templates.json` 的拉取、启动时的在线合并与 `vetta:models:fetch-templates` IPC 删除，改为 `vetta:models:list-presets` / `vetta:models:refresh-preset-models`。早期由服务端模板采纳、现已不在内置目录里的条目仍展示（标记「已下线」），但不提供刷新入口。
- **能力详情的结构化 section 体系**：`CapabilityDetailSections` 的 featureList / scenarios / permissions / reviews 与 `catalog.ts` 中 Figma / GitHub / Notion 的客户端硬编码正文按 ADR-0049 作废，正文改由服务端下发 markdown。
- **插件独立入口**：`PluginsPage` / `PluginsPanel` / `PluginCard` / `PluginDetailSheet` 及侧边栏「插件」导航项删除；插件的 dev 热更新、devLinks、从路径安装等开发者功能保持不变。
- **下载管理页面**：`/downloads` 路由、`DownloadsPage` / `DownloadsPageView`、`downloads-atoms`、设置 popover 的「下载管理」入口与角标，以及 `appShell.routeTitles.downloads` / 插件导航目标 `downloads` 一并删除；`ThemeRouteArea` 与 `ThemeNavigationTarget` 不再有 `downloads`。下载能力底座保留：主进程 `DesktopDownloadService`、`vetta:downloads:*` IPC、`window.vetta.downloads`、`vetta.domain.download` 能力、插件 `internalCapabilities.downloads` 与取消下载审批 UI 均不受影响，用户侧只是没有查看界面。已有 `userData/downloads/downloads.json` 不做清理。

### Fixed

- **Desktop 验证启动依赖修复**：升级 `lucide-react` 到包含完整图标产物的版本，修复 `currency.mjs` 缓存入口缺失导致 Vite 依赖优化失败、Greenfield Runtime 进程级 Canary 无法启动的问题。
- **Workspace 前置构建顺序修复**：前置构建依赖由各包 manifest 的正式 workspace 依赖推导，确保 `runtime-core` 先于 `coding-agent` 构建；构建图脚本本身也纳入缓存哈希，避免陈旧声明文件导致 `TS5055`。
- **消息气泡里的 skill 胶囊退化成 slug**：输入栏刚插入时是「图标 + 别名」（如「发布能力」），消息发出后气泡里却变成 `publish-ability` + 通用魔法棒图标。根因是文本流里只留 `@skill:<slug>`（软引用的权威形态，模型要按真实 name 查 skill），别名与图标只挂在输入框的 `SkillTokenNode` 上，气泡端无从得知。新增 `lib/skill-token-meta` 承载解析口径（`skills.list()` 给别名，市场目录 / 内置静态资源给图标，与命令区同源），气泡通过 `TextBlockView` 的 `inlineTokens.getSkill` 回查。同一根因导致的**重编辑回填后输入框胶囊也退化**一并修复：`SkillTokenNode` 的胶囊改为在节点缺少别名/图标时回查。查不到（未安装 / 已卸载）时回退 slug + 默认图。

- **能力广场的双语文案只显示默认语言**：两处独立缺陷叠加。① **locale 键口径不一**：admin 与分类译名写的是 `zh-CN` / `en-US`（服务端 `SupportedLocales`），插件包 `locales/*.json` 解析出的是 `zh` / `en`，而界面语言只有 `zh` / `en`，客户端此前精确匹配 `i18n[locale]`，admin 录入的译文永远命中不到。归一改在读侧（`pickLocaleValue`：精确 → 基语言 → 同基语言任一地区键），存量数据无需迁移，两条写入路径都生效。② **列表链路根本不解析译文**：`build-ability-items` 只读服务端投影到顶层的默认语言 `name`/`description`/`tags`，卡片标题、简介、标签、搜索词与详情页头部因此不跟随语言（只有正文/头图/元信息跟随）。改为在 `useAbilitiesModel` 组装入口先按当前语言归一市场行（`localizeMarketAbility`），四种 type 的组装函数保持纯函数、签名不变。另：能力标签现在支持按语言覆盖（`detail.i18n[locale].tags`，整体替换）。

- **活动面板图片预览操作别扭**：内置 `media-viewer` 原先空格+拖才平移、Ctrl/Cmd+滚轮才缩放、适配只按宽度算导致竖图被裁切，按钮缩放也不绕中心。改为常见看图交互：滚轮对准光标缩放、左键直接拖移、双击在「适应窗口」与 1:1（已是 1:1 则 2×）间切换、+/- / 0 快捷键、宽高同时适配并限制平移不把图拖丢、工具栏改图标。
- **活动面板图片左键拖不动**：两处叠加——① 平移开关挂在 React `isPanning` 上，`pointermove` 在重渲染前全部被丢掉；② `clampOffset` 在图未超出视口时强制居中，拖一点就弹回。现改为 document 级 pointer 监听 + ref，并放宽边界为「保留一截在视野内」而非强制居中。
- **消息列表里本地文件链接误当网页打开 / 无法点击**：Markdown `href` 原先只认 `file://` 与以 `/` 开头的路径；更关键的是 `react-markdown` 的 `defaultUrlTransform` 把 Windows 盘符 `C:` / `file:` 当成非法协议直接清空 `href`，链接变成不可点的下划线文案。现用 `chatUrlTransform` 放行本地路径，并在解析前把 `](C:\…)` 里的反斜杠改成 `/`（避免 CommonMark 把 `\.` `\f` 等当转义破坏路径，如 `.vetta`）。分类为 file / http(s) / 其它：本地路径文件 badge → 活动面板内嵌预览（项目内）或灯箱；http(s) → 内置浏览器 tab；未知协议不再 `target=_blank`。宿主侧相对路径按会话 cwd 解析，并修正 `file:///C:/…` 残留的 `/C:/` 形态。
- **拖放高亮过重且闪烁**：文件树根区 / 目录行与输入框 drop 区弱化提示（更浅底色、1px 虚线、圆角，去掉厚 ring/blur）；`dragleave` 用 `relatedTarget` 判断是否真的离开容器，经过子节点/文件行时不再误关高亮导致方框闪烁。
- **输入框 drop 区与卡片对齐**：拖放层从外层 padding/`max-w-2xl` 容器挪到真正的 input card 上，高亮圆角与卡片一致；移出后正确关闭（去掉与 counter 冲突的 leave 逻辑）。
- **文件预览左右键不再抢走编辑器光标**：活动栏文件预览在 `window` 上监听了 `ArrowLeft` / `ArrowRight` 切换同目录相邻文件，但只排除了 `input`/`textarea`；CodeMirror 是 contenteditable，方向键被当成「上一张/下一张」，文本编辑中会跳到图片等兄弟文件。现对 contenteditable / `.cm-editor` 等可编辑目标一律不拦截。
- **macOS 点「立即重启」后装不上新版本**：这条链路上串着五个必须全对的环节，缺任何一个都表现为「点了重启但版本没变」，而且症状彼此相似、极易误判。逐个实测确认如下。**① 标记 `app.isQuitting`**：窗口 `close` 守卫在 macOS 上默认把关闭改成隐藏，而 Squirrel.Mac 走 `NSApp terminate:` 语义——任一窗口 `preventDefault()` 就取消整个终止流程，症状是应用压根不退出（托盘「退出」菜单两处早就设了这个标记，只有更新器这条路漏了）。**② 交棒前跑完退出清理**：清理逻辑从 `before-quit` 抽到 `quit-cleanup.ts`，供 `main.ts` 与 `updater.ts` 共用。**③ 等 launchd 作业出现再退出**：交棒后立刻 `app.exit(0)` 实测 41ms 就打死进程，Squirrel 连作业都还没提交。**④ 主动 `launchctl kickstart` 该作业**：作业注册的是按需启动的 mach service 端点（`launchctl print` 里 `port = 0x0`、`active = 0`、`runs = 0`），Squirrel 本该提交后连上去触发 spawn，实测它从不连、给几分钟也不动且无任何错误日志；手动 kickstart 则能完整装好。**⑤ 最后仍要硬 `exit`**：本进程挂着 IM sidecar、uiohook、RPC server 等句柄，Electron 的正常退出流程结束不了它，而 launchd 要等目标进程退出才 spawn ShipIt——不 exit 就死锁，用户以为关了，其实是单实例锁把老进程窗口又调了出来。另加**⑥ 重启后主动抢焦点**：ShipIt 以 launchd 守护进程身份拉起应用，应用不会成为活动应用，窗口 `show()` 调了也不露面（日志里没有 `[window] show`），用户以为没重启。退出前打一次性标记、启动时消费（`update-relaunch-marker.ts`），只有这一种情况抢焦点，避免开机自启打断用户。**Windows 同样受①⑤影响**：Inno 的 `activate()` 只是 `app.relaunch()` + `app.quit()`，而 `before-quit` 在清理跑过后是直通的，没人再兜底 `app.exit(0)`——进程不退出，`app.relaunch()` 也就永远不生效，症状是「版本指针切了但新版本起不来」。因此收尾的硬 `exit` 对两个平台都执行，macOS 额外多一步等安装器接手。

- **macOS 公证因内置运行时是归档而失败**：`notarytool` 返回 `Invalid`，issues 指向 `Resources/vendor/python/cpython-….tar.gz/…/bin/python3.13` 之类的路径——Apple 的公证服务会**解开归档**递归校验里面的 Mach-O，而 electron-builder 只签得到文件系统上可见的二进制，签不进归档内部，于是 `python3.13`、`libpython3.13.dylib`、`libtcl9.0.dylib` 和一批 `.so` 全被判「未签名 / 无安全时间戳 / 未启用 hardened runtime」。`prepare-pack.js` 改为按目标平台分支：darwin 内置解压目录（osx-sign 会像处理 `im-gateway`、`cli-app` 那样逐个签名），Windows / Linux 保留原始归档、Inno 的小文件优化不受影响。`RuntimeManager.seedFromVendor` 相应地优先使用解压目录，找不到才回退归档解压；新增 `installRuntimeDirectory` 与 `installRuntimeArchive` 共用同一套 staging + 原子替换逻辑。从目录 seed 时必须传 `verbatimSymlinks`——Node 的 `fs.cp` 默认会把相对符号链接（`python3 -> python3.13`）重写成指向源目录的绝对路径，安装后指回 app bundle 内部，更新替换 `.app` 时整片悬空。

- **活动面板里「Git 面板」「插件工作台」标签卡不再出现**：插件标签卡的显隐靠「上栏记录」（cwd → tab，ADR-0026），而唯一的写入方是插件自己调 `openActivityTab`——图像生成插件在生成后调所以正常，git 与工作台从没写过这个触发，6/24 删掉 "+" 下拉里的手动勾选 attach 后就再没有任何入口能让它们上栏。改为让插件显式声明自己的出现条件：新增 `ctx.ui.setActivityTabVisible(tabId, visible)`（只上栏/下栏，不激活、不抢焦点弹开面板）与 `registerActivityTab({ initiallyVisible })`（缺省 `true`，注册即上栏，老插件不用改）。git 插件按 `git rev-parse --is-inside-work-tree` 探测，只在仓库目录上栏；插件工作台跟随输入栏「插件工作台」toggle 上下栏。`ctx.conversation.on()` 订阅后会立刻回放一次 `conversation-changed`，插件不必等下次切会话才判定。
- **活动面板「+」菜单不再列出当前未上栏的插件 tab**：在 `setActivityTabVisible` / `initiallyVisible` 之上，把 scope 命中但当前不可见的池项列在「可添加插件面板」（例如 `initiallyVisible: false` 或用户关掉的 tab）；从菜单添加会写显式上栏记录，关闭插件 tab 写显式下栏并回到池，与 ADR-0026 三态记录一致。
- **macOS 更新在 Squirrel 暂存阶段被误判为「下载失败」**：传输结束到 Squirrel.Mac 收下 ZIP 之间不产生任何 `download-progress` 事件，而 120 秒的停滞超时只由进度事件重置，这段时长又不受控（取决于磁盘与包体积）。一旦超时，`UpdaterService` 取消下载并置为 error，之后 Squirrel 其实暂存成功、promise 回来时又因 `activeDownload` 不匹配被丢弃，界面永久停在「下载失败」。（实测 M4 上这个窗口只有 3.4 秒——Squirrel 的 `update-downloaded` 只表示 ZIP 已收进 ShipIt 暂存区，真正的解包与验签在应用退出后进行。）`UpdateEngine.downloadUpdate` 新增可选的 `onStaging` 回调标记进入安装准备阶段，该阶段改用 10 分钟的兜底超时（只防死锁）。同时把 macOS 的网络阶段压缩到 0～90%（此前只有 Windows 这么做），暂存期间停在 90%、ready 才跳 100%，让「90% 之后是本地准备而非网络问题」这条排障语义在两端一致。Windows 的 Inno 准备阶段本就持续上报进度，行为不变。
- **命令区 / skill 选择器 / @ 文件面板：鼠标滑过列表会带动滚动**：高亮项 `scrollIntoView` 原先挂在 `activeIndex` 上，键盘与鼠标 hover 共用同一路径，移到底部附近时滚动位置会被不断拽动。现仅在方向键改高亮时滚进视口，hover 只改高亮。
- **方向键移到输入框里的 token 上会把光标吞掉**：技能 / 连接器 / 文件 / 图片四种行内 token 都声明了 `isKeyboardSelectable() = true`，光标左右移到 token 上时 Lexical 会把 RangeSelection 换成 NodeSelection，caret 随之消失；而输入框用的是 `PlainTextPlugin`，它不像 RichText 那样注册 NodeSelection 下的方向键处理，选区就此卡死——再按方向键没有任何反应，此时继续打字还会插到整段开头，只能用鼠标点一下才能恢复。四种 token 改为不可键盘选中，光标像跨过一个普通字符那样跨过 token，Backspace 删除 token 的行为不变。
- **通用 Agent 目录里的同名 skill 会挡住能力广场安装**：`~/.agents/skills` 下有同名 skill（如 `xlsx` / `docx`）时，安装市场同名能力被判为「同一能力标识已由其它来源安装」而拒绝。通用目录不受 Vetta 托管、也无法预测别的 agent 往里放什么，按 ADR-0020 它本就该让位于 Vetta 原生 skill，因此不再让 `agents-user` / `agents-project` 来源的只读条目占据物理安装位。装好之后该同名条目按既有加载优先级被 Vetta 的版本盖掉（输入框命令区与 agent 感知都只看得到一份），与 Vetta 受控能力不重名的通用 skill 不受影响。
- **输入框「默认态 → 展开态」在低配设备上卡顿**：上一轮只清掉了首次展开时撞进动画的异步数据，结构性开销还在。命令区的高度生长是 `height: 0 → auto` 的弹簧，而 height 不可合成，每帧都要 style → layout → paint → raster 整块面板（几十行列表 + 每行一个内联 SVG 图标）——偏偏命令区是 `absolute bottom-full`，压根不参与布局流，这段高度动画对其它元素毫无影响，纯粹为了「生长感」却付了整条不可合成路径的代价；`height: "auto"` 还会在过滤词每变一次时重新测量并重定向弹簧，打字期间是持续的 layout 抖动。现在改成 `clip-path: inset()` 从上往下揭幕：布局与绘制内容全程停在终态，每帧只重新裁剪一次，layout 一次都不跑。刻意不用更便宜的 transform 位移——内容一动，描边、圆角与「和输入卡片接成一整块」的接缝在动画中途就都不在终态位置上，半像素接缝会显出一条线，与卡片相接的两角会短暂露出背后的消息列表。同时：揭幕期间列表只渲染可视区的 12 行（剩下的动画结束再补，不再在首帧一次性布局上百行）、渐隐 mask 暂不挂载；工具栏切形态不再卸载 / 挂载 `ExecutionModeSelector`、`ModelSelector`、`ContextRing`（那次同步 render 正好落在动画第一帧），改为只切 display；新会话页的 hero 淡出、输入栏位移与命令区揭幕改为共用一条固定时长的曲线（各跑各的弹簧时掉帧时能看出它们互相在追），并接上 `prefers-reduced-motion`。输入卡片的圆角与透明上边框改为跟随新的 `slashVisible`（命令区是否还在屏上，含退场动画）而不是 `slashOpen`——两块面本该是一整块，`slashOpen` 一变卡片就立刻恢复圆角，命令区还没退完，那 190ms 里接缝处会露出两个缺口。`InputBarModel` 因此新增 `slashVisible`，覆盖 `chat.inputBarView` 槽位的主题可以按需使用。
- **展开态命令区与输入区之间有一条贯穿全宽的细线**：那 1px 正对着输入卡片的上描边——展开态它被置成透明（不用 `border-t-0`，否则整条 bar 会抖 1px），但没有任何东西盖住它，边框区显示什么取决于 `background-clip`，透出来就是一条把两块面切开的线。命令区的 bottom 从 `100%` 压到 `calc(100% - 1px)`，用它自己无描边的底边补平。
- **进入应用后第一次展开命令面板会顿一下再继续展开**：`height: 0 → auto` 的弹簧全程跑在主线程，首次展开时有三处异步在动画中间才到位——skill 列表的预取挂在 `requestIdleCallback`（冷启动主线程被占满，一路拖到 2s 超时才发起，赶不上第一次展开）、缓存命中时展开那一刻仍无条件重拉一次、图标目录（要打网络）只在 `open` 时才开始加载。数据一到就是几十行重渲染加整列远程 `<img>` 换图，动画因此顿住。现在 skill 列表预取挂载即发起、图标目录同样提前预热，缓存命中时的「反映磁盘增删」重拉推到空闲再做。
- **Windows 安装版启动后只有托盘、主窗口不显示**：版本启动器曾用 `HideWindow: true` 拉起 Electron，会写入 `STARTF_USESHOWWINDOW` + `SW_HIDE`，导致进程第一次 `ShowWindow` 被系统强制隐藏（日志里已有 `show`，但 HWND 无 `WS_VISIBLE`）。去掉启动器 `HideWindow`；主进程 `revealMainWindow` 在 Windows 上再 show 一次，兼容尚未替换的旧启动器。
- **输入栏「图像生成」等 badge 时有时无**：`activeToolNamesAtom` 只在 `openSession` 时用 `getState` 取一次快照，而 `generate_image` 是 image-gen 插件 activate 后才动态注册的。冷启动恢复会话时会话创建早于插件就绪，那个会话的 `requiresActiveTool` 闸门就一直把 badge 挡住。现在订阅 runtime 新增的 `active_tools_update` 事件刷新该 atom，并在 `session.subscribe` 时回放一次当前工具集，堵住 getState 与 subscribe 之间的丢事件窗口。
- **展开态的「插图 / 附件」点不出文件选择器**：命令区的 click-outside 走 mousedown，会在 click 之前把面板连同这两个按钮一起卸载，click 因此落空。两个按钮加 `data-command-panel-keep-open`，与「+」一样被 click-outside 跳过。
- **开发版主进程无法加载 `electron-updater`**：主进程 ESM 产物将 CommonJS 的 `electron-updater` 保持为 external 时，命名导入 `autoUpdater` 会在 Electron 启动阶段抛出 `Named export not found`。改为从 CommonJS 默认导出解构，恢复开发版与打包版启动。
- **新会话页 skill 徽章行支持拖动横向滑动**：原先 `DefaultSkillBadgeRow` / 仙侠主题 skill 行只有左右箭头，桌面鼠标无法拖动。抽出 `useHorizontalDragScroll`（指针捕获 + 阈值抑制 click），默认主题与仙侠主题 skill 行接入；仙侠场景轮播一并复用。
- **新会话页 skill 徽章悬浮不再放大**：`SkillCard` 去掉 `whileHover` 的 scale / 上移，仅保留颜色过渡与点击缩放。
- **新会话页 skill 横向拖动使用默认光标**：去掉 `cursor-grab` / `cursor-grabbing`，拖动时保持普通鼠标样式。
- **能力市场可用时仍显示 `Failed to fetch`**：服务端、GitHub 与本地来源改为独立判定；单个来源失败但其它市场来源或旧缓存可用时静默降级，不再把浏览器原始网络异常暴露给用户。详情 Drawer 只显示当前安装或配置操作错误，不再重复列表级来源错误。
- **macOS 启动骨架屏压住交通灯**：`AppBootLoadingView` 侧边栏顶部的骨架块正落在窗口左上角的红黄绿按钮下面（macOS 用 `hiddenInset` 标题栏，`trafficLightPosition` 为 x:16 y:20）。macOS 下改为只留等高占位、不画脉冲块；保留占位是为了下方条目不会上移到交通灯区域。Windows / Linux 不变。
- **侧边栏会话相对时间 i18n**：会话列表 `timeLabel` 改为经 `useTranslation` 的 `t` 渲染（`project:sidebar.time.*`，插值用 `n` 避免 `count` 复数解析），并在列表 `useMemo` 中依赖 `i18n.language`，切换界面语言后时间文案立即更新；消息中心相对时间同步改为 `message:time.*` + `n`。
- **侧边栏会话时间简写**：相对时间改为紧凑文案（zh：`5分`/`3时`/`2天`；en：`5m`/`3h`/`2d`），适配侧栏窄列。

### Changed

- **更新提示从侧边栏顶部图标改为底部提示条**：顶栏那个带进度环的小图标去掉（`SidebarUpdateButton` / `SidebarUpdateIcon` / `useSidebarUpdateButtonModel` 删除），改为在侧边栏底部设置项上方插一条与侧栏等宽的提示条，只在后台下载完成（`phase === "ready"`）后出现。条上是版本文案 +「重启更新」按钮（`updater.install()` 立即重启安装）；鼠标悬浮时左侧图标变为关闭图标，点击忽略本条（调 `updater.dismiss()`，安装交给退出时的自动流程），忽略状态按版本记忆，下一个版本就绪时重新出现。
- **能力列表把随 App 分发的内置能力单独成组「Vetta 内置」**：内置 skill / 通用 Agent 与系统插件（`isBuiltin`）不再按各自分类混进市场能力与 `~/.agents/skills` 里，统一聚到一个分组，排在各分类之后、未分类（本地技能）之前。从内置预设添加的 MCP 连接器仍留在「连接」分组。分组逻辑从 `useAbilitiesModel` 抽到 `lib/group-abilities.ts`。

- **能力卡片去掉来源类 badge 与只读锁图标**：标题右侧不再有「内置」「自定义」「只读」标签（来源已由分组和详情页的来源信息表达），只保留需要用户处理的「需要配置」「可更新」「N 个同名」；只读条目右侧不再用锁图标占位，直接留空。详情页头部同步。

- **修正 `listSkills` 列出的 skill 一律被当成内置**：`~/.agents/skills` 里用户自己放的、以及插件贡献的 skill 之前被硬标成 `isBuiltin` + builtin 来源（跟着进了「Vetta 内置」分组），现在只有 `source=builtin`（随 App 分发）才算内置，其余归本地来源。同时按 `type:name` 去重：市场装的 skill 也会被 `listSkills` 列出，此前会额外多出一条只读条目。

- **macOS 发版改出 arm64 与 x64 两套产物**：此前 `desktop-release` 只在 arm64 runner 上按宿主架构构建一次，Intel Mac 既没有安装包，检查更新时也会因 `MacUpdater.filterFilesForArch` 过滤掉 arm64 文件而报 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`。内置的 node/python 运行时按 `VETTA_VENDOR_PLATFORM` 单架构落盘，一次构建出不了两套，因此拆成 `dist:mac:arm64` / `dist:mac:x64` 两个 matrix 任务；两次构建都会写同名 `latest-mac.yml`，各自重命名为 `latest-mac-<arch>.yml` 上传，再由发布任务的 `merge:updates:mac`（`scripts/merge-mac-update-metadata.mjs`）合并回单一元数据（ZIP 在前、x64 在 arm64 之前，与 electron-builder 单次多架构构建的产物顺序一致）。

- **新会话页展开命令区时，能力条目不足 7 条就不再下沉输入栏**：条目少时面板长不到会盖住 hero 的高度，那趟 120px 位移纯属多余。判定用不带过滤词的完整列表条目数（与命令区共用模块级缓存），因此不会随用户打字过滤而抖；hero 淡出仍跟展开态本身走。
- **外观设置里「侧边栏样式」下移到「主题」之后**：原先夹在「外观模式」与「界面主题」之间，现在排到主题色区段下方（页面末尾），`SETTINGS_SECTIONS` 的顺序同步调整以对齐设置搜索结果。
- **工具栏里已激活 action 胶囊常驻底色**：紧跟权限/沙箱右侧的激活胶囊由「透明、hover 才上底色」改为常驻 `bg-accent/60`（hover 加深到 `bg-accent`）。它表示的是持续生效的状态，全透明时和旁边的普通工具栏按钮分不出来。多个 action 折叠后堆叠的图标容器由圆形改为圆角矩形（20px、`rounded-[7px]`、3px 内边距），`+n` 角标同步跟上。折叠态 popover 宽度跟随触发胶囊（`--radix-popover-trigger-width`），条目改用与未折叠胶囊完全一致的外观与关闭手势（h-7 / `rounded-lg` / `bg-accent/60`，图标 hover 变关闭键、整行可点），看起来就是把几枚胶囊竖着收纳了。
- **命令区 skill 列表空态改为卡片**：「未找到匹配项」/「暂无可用的技能或场景」由一行灰字换成占满命令区宽度的虚线卡片（左侧圆形图标 + 右侧标题与提示，横排以免撑高命令区），新增 `SkillListEmpty` 组件与 `chat.slashPanel.emptyNoMatchHint` / `emptyNoSkillsHint` 两条文案（zh/en），`SkillListLabels` 随之新增两个必填字段。聊天侧命令面板与 dialog 侧 skill 选择器共用。
- **新会话页命令区展开时输入栏整体下移 120px**：命令区向上生长会把视觉重心整体抬起、下方留出大片空白，现在输入栏随展开/收起沿同一条弹簧（`stiffness 420 / damping 34`）平移，与面板一起动。`InputBarProps` 新增可选 `onExpandedChange`（仅新会话页传），会话页不受影响。展开期间 hero（模式切换 + 吉祥物）整块淡出并禁用命中——命令区盖在 hero 上时，这两个元素会浮在面板前面挡住列表。
- **新会话页欢迎区版式**：工作 / 编程模式切换从问候语右侧移到标题上方；右侧吉祥物插画改为绝对定位并下移，视觉上趴在输入栏顶边上（原先在流内、下方还有一条分隔线）。
- **输入框工具栏整排改用正文色**：「+」/ 插图 / 附件按钮、执行模式、模型选择与已激活 action 的静默态由 `muted-foreground` 改为 `foreground`，hover 仍只上底色；此前整排偏灰，和输入区正文对比过弱。
- **多个已激活 input action 折叠成一枚胶囊**：工具栏是单行不换行的，平铺两三个 action 就把执行模式和模型挤没了。现在一个时保持平铺（图标 + 名称，点图标即取消）；两个及以上折叠为「图标堆叠 + N 个插件」，最多堆 4 格、超出时最后一格显示 `+n`；点胶囊在上方升起 popover，逐条 hover 出关闭键。
- **命令区与输入卡片接缝去掉台阶**：展开形态下输入卡片去上圆角、上边框置透明（不减 1px，避免整条 bar 抖动），命令区左右各外扩 1px 与卡片描边对齐——此前命令区被卡片内容盒内缩，两侧各差 1px 看着像锯齿。
- **展开形态保留发送按钮**：工具栏右侧改为只收起模型选择与上下文用量环，发送按钮常驻。
- **命令区去掉顶部标题行**，最大高度由 `min(420px, 45vh)` 压到 `min(320px, 40vh)`；skill 条目去掉 source badge，只留名称与描述（`SkillListLabels.sourceLabel` 改为可选，批量任务的 skill 选择器仍显示）。
- **命令区滚动条隐藏，改用底部渐隐提示还能往下滚**：渐隐走 mask 而非叠渐变色块，换主题不会露色差；只在真的还能滚时才挂，内容不满一屏时最后一行不会被淡掉。
- **命令区 skill 图标沿用能力广场那套**：市场目录的图（图片 / `solar:` 预设）→ type 默认图，不再所有条目都是同一个魔法棒。图标按 `type:slug` 从市场目录（服务端 + 开放市场本地缓存）解析，命令区首次展开时才拉取并按登录态缓存；未登录 / 离线 / 目录里查不到时落默认图。选中后插入文本流的行内胶囊复用同一张图（`SkillTokenNode` 新增可选 `icon`，随 EditorState 序列化）。
- **「经典」（default）主题的中性表面去蓝偏**：`secondary` / `muted` / `accent` 的色相改为中性灰，亮度不变——深色 `secondary` `rgb(36, 38, 48)` → `rgb(38, 38, 40)`、`muted` `rgb(28, 30, 38)` → `rgb(30, 30, 32)`、`accent` `rgb(38, 41, 52)` → `rgb(41, 41, 43)`；浅色 `muted` `rgb(242, 242, 245)` → `rgb(242, 242, 242)`（浅色 `secondary` / `accent` 本就是中性灰，未动）。
- **暗色正文略压亮度**：各主题色板暗色 `foreground` / `muted-foreground` 从近白改为约 82–86% 灰阶，减轻深底刺眼；默认黑白主题（mono）纯黑底上再软一档，强调色 `primary` 同步略降。
- **新会话问候语跟正文色**：`你好，{{nickname}}` 由 `primary` 渐变改为 `foreground` 渐变（与能力页等标题一致），暗色/黑白主题下不再用近白 primary 发亮。
- **输入栏窄宽不再折成两行**：工具栏去掉 `flex-wrap`，按输入区容器宽度折叠文案——窄时隐藏执行模式名、推理档位、快捷键提示与动作条标签（保留图标与 `title`），模型名缩短截断；宽了再逐步显示。
- **Popover/Select 面板动效更轻**：侧边栏设置菜单、`MotionSelect`、执行模式选择仅保留约 120ms 淡入淡出，去掉缩放与位移；内部选项不再逐项 stagger。
- **账户设置额度/用量/模型合一卡**：计划、五小时/周等额度（容器内 `auto-fit` 并排）、Token 使用量、可用模型同处一张卡片，顺序为额度 → 用量 → 模型。
- **聚焦样式统一为 1px border**：去掉输入框、按钮、开关及全局 `:focus-visible` 的 ring/outline 叠加光晕，仅保留边框色变化（`@vetta/ui` Button/Switch、`theme-ui` 控件与桌面端相关入口同步）。
- **侧边栏顶栏品牌区改为纯文字**：去掉顶部 Vetta 头像/图标，Windows/Linux 仅显示「Vetta」文案（macOS 仍因交通灯占位不显示品牌字）。
- **助手消息头像改回 `BotAvatar` 方块**：消息列表「Vetta」左侧由静态猫爪图恢复为带动画的 `BotAvatar`（流式 `active` 光晕 + 手势循环，点击触发）。
- **新会话页设置默认值**：场景卡片列表与引导词轮播改为默认关闭；技能徽章列表仍默认开启。未在配置里显式写入的项按新缺省解析；已持久化的 true/false 不受影响。
- **能力市场的分类分组标题按界面语言显示**：服务端随每个市场条目下发 `category_i18n`，分组标题取 `category_i18n[locale] ?? category`（`resolveCategoryLabel`，与 `raw.detail` 的取值口径一致）。分组与筛选仍按分类的**规范名**，所以切换语言只换标题文案，不改分组划分、也不改分组顺序。GitHub 开放市场清单没有译名块，这类条目继续显示原名。

- **桌面更新源从业务服务端解耦**：客户端更新引擎切换为 `electron-updater`，发现新版后延迟 20 秒静默下载及失败重试；打包时可通过 `VETTA_UPDATE_PROVIDER` 在 R2/任意静态 CDN（generic）和公开 GitHub Releases 之间切换。electron-builder 生成各平台 `latest*.yml` 与 blockmap，下载缓存、完整性校验、差分更新和退出时自动安装由标准更新器接管；旧的自定义下载/安装模块、兼容 IPC 与 `pendingInstall` 假持久态全部删除。R2 发布改为大文件分片上传、只发布清单实际引用的产物并在安装包可公开读取后最后覆盖清单；新增三平台 GitHub Actions 发布工作流与从版本 Changelog 注入的 Release Notes。业务服务端与管理后台的 release 接口、数据模型及发版页面同步删除，不保留双轨兼容。

- **`~/.vetta/auth.json` 的消费者换人**：内建 vetta MCP 改为远程 HTTP 服务后不再有本地子进程，这份下沉凭据的读方变成 coding-agent 的 `core/mcp/vetta-credentials.ts` 与 `publish-ability` skill 的上传脚本。文件形状与写入时机（登录 / 刷新 / 登出三处 `syncCredentialFile`）不变；消费者一律按需重读、不缓存，token 轮换后自动生效。
- **`stage-system-skills` 放行 skill-presets 下的工程目录**：`test` / `node_modules` 不再被「内置 Skill 未在 manifest 注册」这条检查误伤。用白名单而不是放宽检查——真漏注册一个 skill 仍然必须炸。
- **「让 Vetta 帮您配置」不再自动跳转对话页**：提交后在当前设置页后台创建会话并发送协助 prompt，侧栏高亮对应新会话；同时用一颗主色小球从 CTA 飞向该会话行作引导（`prefers-reduced-motion` 时跳过动效）。用户可自行点击侧栏会话进入聊天。
- **设置 AI 协助飞球起点对齐弹窗提交**：小球在点击提交瞬间从弹窗内发送按钮位置出现并短暂停留，会话创建与侧栏刷新在后台进行，就绪后再飞向对应会话行；不再等 `openSession`/`sendMessage` 结束后才出球。
- **设置 AI 协助弹窗与飞球动效**：提交后弹窗与会话创建解耦（截取起点后即关，可随时再开再关）；发送不绑定会话 busy/streaming，可连续发起多个协助会话（后台串行建会话+发消息）；飞球用 **GSAP** 单段二次抛物线 `MotionPath`（`M0,0 Q…`，弧高约 20% 路程 / 峰值约 72–148px，`ease: none`），侧栏目标短轮询/列表兜底。
- **桌面端补齐 tw-animate 与 Radix open/closed 变体**：`styles.css` 引入 `tw-animate-css`，并将 `data-open`/`data-closed` 映射到 `data-state`，使 Popover 等开关过渡真正生效；AI 协助面板关闭改为约 220ms 淡出+缩放上移。
- **桌宠设置隐藏「桌宠装饰」分区**：设置页暂不展示装饰网格；`PetSettingsView` 组件、装饰数据与 section 注册保留，`showDecorationSection` 改回即可恢复。
- **设置等场景模型选择面板对齐新会话**：共享 `ModelSelect`（Claw / 知识库 / 定时任务 / 批量任务 / 审批等）下拉改为与聊天 `ModelSelectorView` 同款——搜索框、入场动效、分组与选中态、徽章色与宽幅列表；触发器仍可由调用方自定义。
- **能力详情由独立页改为侧边抽屉**：`/abilities/$type/$slug` 重定向到 `/abilities?detail=<type>:<slug>`，详情在能力页内以抽屉呈现——宽屏右侧 60vw，窄屏（≤768px）改为底部弹出 85vh；深链与浏览器返回键仍可用，列表与详情共用同一个 model 实例，安装 / 启停结果直接反映到身后的列表。场景页与 bundle 成员的跳转一并改走该 search 参数。
- **能力详情页版式调整**：作者/版本/许可移到标题下方，描述与标签移到图标下方通栏，面板内不再有返回按钮（遮罩 / Esc 关闭）；页尾区块（插件、MCP、套装、其他）与正文之间只用分隔线，小标题统一为 11px 大写 muted；插件权限改为三列纯文本清单（不再是卡片与开关），授予与否移到主 CTA 右侧「权限配置」按钮弹出的弹窗；插件内聚的 MCP / 技能列表收进单张卡片，条目用分隔线分隔、图标复用能力广场的 `AbilityIcon`、描述最多两行，超过 5 条折叠；「其他」（原元信息）改为标签-值两栏；markdown 正文去掉内边距；页面块级元素按序 `opacity + y` 入场，`prefers-reduced-motion` 下关闭。
- **能力详情动作区统一**：主 CTA 改 `variant="primary"`，「停用 / 权限配置 / 配置凭证 / 编辑配置 / 移除」与主按钮同排并补上图标——停用与类型专属入口用次按钮，移除固定在最右且保留破坏色描边；已启用（无主 CTA）时由停用撑满整行；MCP 详情不再在正文底部重复一排按钮。
- **编辑 MCP 由右侧抽屉改为弹窗**：`McpEditDrawer` → `McpEditDialog`，与「手动添加 MCP」同一套 `Dialog` 形态；能力详情本身已是抽屉，避免抽屉套抽屉。设置页与能力页共用该组件。
- **能力头图 showcase 改版**：渐变舞台（primary 光晕 + 淡出细网格）+ 悬浮窗口 mock（design / code / docs / generic 四种主题），对话占更大篇幅，回复方头像改用 `BotAvatar`；配色全部走 `--primary` / `--border`，浅色深色都成立。
- **设置页下拉统一为 `MotionSelect`（修关闭空白）**：根因是 Radix `SelectValue` 依赖已挂载 `SelectItem` portal 文案，条件卸载 Content 后触发器空白。`MotionSelect` 改回 Popover + 显式 label（原 Agent 交互 + motion），关闭时文字仍显示；通用/快捷面板/Appshot/成就/知识库/插件/模型表单/外观语言/Agent 人设全部统一；`@vetta/ui` Select 默认皮仍产品化，供非设置场景。
- **外观设置鼠标指针卡片**：改为固定两列布局，置于主题色上方；卡片加高（约 72px）并放大预览图标，说明文案最多两行。
- **外观设置选中边框统一为 1px 细线**：模式 / 界面主题 / 主题色 / 鼠标指针卡片去掉 `ring-2` + `ring-offset`；选中只改 `border-primary/50`（可叠浅底 `bg-primary/10`），**不再叠 ring**，避免 border+ring 视觉上变粗。
- **侧边栏「对话」空状态**：无会话时由单行「暂无对话」改为图标 + 标题 + 引导说明；对话 tab 提供「开始新对话」CTA，且空态下头部「+」始终可见；Claw tab 单独说明如何产生记录。
- **插件 agent 工具展示名走注册 label**：`registerTool({ label })` 直接写入展示表（支持 `%catalogKey%`）；Work 模式工具头优先用该 label，`generate_image` / `edit_image` 文案从宿主 `chat.toolLabel.alias` 迁到 image-gen 插件 catalog。

### Added

- **设置页元素入场动画**：切换设置侧栏 tab 时，标题 / `SettingSection` 卡片等块级元素按序 `opacity + y` 入场（stagger ≈50ms，遵循 DESIGN.md §5.1）；`prefers-reduced-motion` 下关闭；未走 `SettingSection` 的裸标题等由 CSS 兜底。
- **WebdriverIO Electron E2E scaffold**: `@wdio/electron-service` with unpackaged smoke via `dist/main/index.js` (`bun run test:e2e`); `VETTA_E2E_PACKAGED=1` / `bun run test:e2e:packaged` for `release/*-unpacked` binaries. See `wdio.conf.ts` and `e2e/`.
- **Electron E2E batch-1 smoke**: boot contract (ready / version / main window `index.html`), `VETTA_E2E`·`VETTA_HOME`·userData isolation, and `dialog.showOpenDialog` mock probe; no product UI coverage.

- **edit 锚点模式的专属渲染**：diff 卡片统计行新增紫色「锚点编辑」徽章（`DiffPreviewView.modeBadge`）标识本次修改走锚点模式；流式阶段（diff 尚未产出）不再空白，新降级视图逐条展示锚点目标（`42:ab` 紫色 chip）、动作（替换该行/替换区间/插入到其后/删除）与新文本预览；文案接入 i18n（zh/en）。锚点模式参数（`edits` 数组）纳入工具卡片可展开判定。

- **内置「图表渲染」系统插件（chart-renderer）**：收编原第三方插件为 preset，随 App 发布（common / tenantb 租户）。Agent 调用 `render_chart` 传入标准 Chart.js `type`/`data`（或 `charts` 数组，最多 4 个），图表渲染在工具调用下方；随包附带 `chart-renderer` skill；`agent_mode: ["work"]`（本版内已降级为纯偏好，两种模式下都可用）；文案接入插件 i18n（zh/en）。
- **插件卡片 New 徽章**：用户新安装的非系统插件在安装后 1 小时内于卡片状态徽章旁显示 `New`（依据 `installedAt`）。
- **Work 模式对话渲染改为 agent 自述的阶段组（ADR-0047）**：Work 模式下 `MessageList` 不再平铺工具卡片，而是按 agent 通过 `progress` 工具声明的阶段折叠成一行标题（进行中 / 完成态文案均由 agent 撰写），展开后一行一条调用说明，再点开才是完整工具卡片；thinking 一律不渲染；流式期间阶段标题行常驻，消息结束后整段过程收起、只留最终总结，折叠条按阶段数计数。没有 `progress` 调用时退回启发式合组 + 通用文案。插件自定义 UI 工具、错误块与失败调用强制冒泡到组外。Coding 模式渲染不变，历史消息中的 `progress` 调用降级为一行语义分隔小标题。
- **插件产物卡片支持 agent 撰写的引入语**：渲染进程自动探测某个插件 agent 工具是否注册了 tool-call slot，是则宿主为其注入可选的 `md_intro` 参数，模型填写的 markdown 渲染在卡片正上方。插件无需任何改动。
- **插件产物不再被大折叠吞掉**：`registerToolCallSlot` 注册的自定义 UI 工具一律视为产物，消息级折叠的答案区起点改为「第一个产物之前最后一次真实工具调用之后」与「最后一个过程块之后」中更靠前者，work 与 coding 同时生效；产物上方引出它的结论文字一并留在答案区，产物之后的过程块也不再折叠。答案区之前无内容可折时不再显示折叠条。

- **本地服务商模型一键拉取**：设置 → 模型的本地服务商展开后新增「从接口拉取」，按 provider 的 `baseUrl`/`apiKey`/`headers` 请求 `GET {baseUrl}/models`（兼容 OpenAI `data[].id` 与 `models[].name`），勾选后批量写入 models.json；仅写 modelId，其余字段继承服务商默认，已存在的模型默认不勾选。
- **新会话页设置**：设置新增「新会话页」页，可分别控制场景卡片列表、技能徽章列表、引导词轮播的显示/隐藏（技能徽章默认开，场景卡片与引导词默认关）；配置持久化到 `desktop-config.json` 的 `newSessionPage`。
- **会话页文本右键菜单**：输入栏支持剪切 / 复制 / 粘贴（依选区与剪贴板启用）；消息列表在选中文字后可复制或清空输入框后写入选中内容，未选中时不弹出菜单。
- **官方 App Action 第二批迁移**：`vetta-actions` 系统插件与 `ctx.official` 宿主能力扩展覆盖 `skills`、`shortcuts`、`im`、`mcp`、`models`、`projects`、`knowledge`、`plugins`；继续以同 id 静态实现为 fallback，写操作复用既有领域审批 UI。
- **官方 App Action 第三批迁移（收尾）**：完成 `batch-tasks`、`scheduler`、`appearance`、`navigation`；`ctx.official` 新增批量/定时窄 API、渲染器内主题读写与 hash 导航；插件审批 presentation 映射同时识别 `operation` 与 `type` 字段。
- **移除静态 App Action 领域实现**：Desktop 仅保留 Catalog/Runtime/审批/插件注册协议；业务 Action 完全由 `vetta-actions` 等插件提供。Catalog 每个 action id 只保留一份实现，**先注册为准**，冲突写日志忽略；插件 activation commit 时先卸旧再挂新，避免热更新空窗。
- **`vetta-host://plugin-sdk` 补导出 `PluginAppActionError`**：官方 `vetta-actions` 插件加载依赖该运行时导出；漏列会导致插件 SyntaxError 整包失败、Action Catalog 为空。
- **市场产物 sha256 校验**：技能、场景、插件与应用安装包下载后，在主进程解压/落盘前比对服务端下发的 `sha256`，不一致直接中止安装并清理临时文件。摘要机制之前上传的存量条目服务端不下发摘要，此时跳过校验以免装不上。技能与插件的下载接口现在可能 302 到对象存储的预签名 URL，`fetch` 默认跟随重定向，客户端无需改动请求方式。

- **插件动态 App Action（ADR-0045）**：插件可通过 `ctx.appActions.register()` 向主进程 Action 目录动态注册 JSON Schema Action；支持 `vetta action search/describe/run`、插件 activation 两阶段提交与失败回滚、内置 provider fallback、可信系统插件稳定 `publicId`、权限复查、write/execute 审批、超时、取消与 JSON 结果校验，为官方 Action 插件独立于 Desktop 发版奠定运行时基础。
- **首次启动引导页**：用户首次进入主窗口时全屏展示；右上角可 Skip。非 mac 3 屏（语言与外观 → 登录 → 欢迎），mac 4 屏（语言与外观 → 授予权限 → 登录 → 欢迎）。权限屏仅 mac 可见；已登录时省略登录步与 indicator；登录可选；完成/跳过写入 localStorage，并延后侧边栏 product tour。设置 → 通用可重新「启动App引导」。语言与外观步含 6 色主题选择；底部导航收拢为居中胶囊条并带动画。
- **插件动态 App Action（ADR-0045）**：插件可通过 `ctx.appActions.register()` 向主进程 Action 目录动态注册 JSON Schema Action；支持 `vetta action search/describe/run`、插件 activation 生命周期清理、权限复查、write/execute 审批、超时、取消与 JSON 结果校验，为官方 Action 插件独立于 Desktop 发版奠定运行时基础。
- **功能引导（driver.js）**：首次使用时侧边栏 3 步引导（项目区域 / 对话区域 / 能力入口）与能力页 4 步讲解；点击下一步推进，完成或关闭后写入 localStorage，各引导只展示一次。
- **可选 Desktop telemetry**：集成 Sentry 错误与崩溃监控、PostHog 产品分析/Feature Flag/可选 Replay；未配置对应环境变量时 SDK 不初始化，采集和网络异常不阻断应用。Main、Renderer 与四个自包含 preload bundle 共享脱敏上下文，并支持 release Source Map 上传。
- **工作流并行执行 UI（ADR-0044）**：Agent 经 `dispatch_workflows` 派遣工作流后，消息列表 footer 出现工作流摘要块——深蓝色波光标题「有 N 个工作流正在处理」（spin 图标，结束后转对勾）+ 树形分支列表（人类可读标题 + todo 进度如 1/4 + 状态 + 悬停停止按钮），点击 item 打开活动面板新增的「工作流」标签卡（有工作流才出现、带运行中计数角标）：顶部工作流切换条 + 选中工作流的 1:1 只读 MessageList（复用无锁 session viewer 通道实时刷新）。工作流不再出现在「后台任务」标签卡与角标中，二者职责互斥；新一批派遣自动替换已结束的旧工作流列表。
- **开发环境会话 Debug 能力**：`vetta debug` 新增 `conversation.list`、`conversation.create`、`conversation.continue`、`conversation.answer`、`conversation.wait`、`conversation.abort`，通过持久化 `sessionPath` 创建或恢复真实 Desktop 会话并等待完整 Agent 回合；与 UI 共用会话装配服务，支持 sandbox、模型选择、超时、取消及稳定错误码；遇到 `ask_user_question` 时返回 `input_required`，允许调用方 Agent或用户回答后继续执行，主进程统一维护待答快照并在任一来源完成回答后通知 Renderer 自动关闭面板；打包环境不启用。
- **开发环境 UI 自动化入口**：标准 Desktop 开发启动会在本机 `127.0.0.1` 开放可配置的 Electron Renderer CDP 端口，`ui.info` Debug 能力返回端点、连通性与主窗口 target，供 Playwright CLI 附着当前真实应用；打包环境和 CLI 子进程不启用。
- **外部会话实时刷新与标题衔接**：Debug 等主进程入口创建或更新会话后广播受影响的项目 cwd，侧栏无需刷新页面；首轮开始时直接用用户消息展示，不再短暂出现「未命名会话」，Agent 完成后后台生成并替换为自动标题。
- **后台任务 Tab 统一展示子代理**：活动面板「后台任务」入口合并 bash 后台任务与 explorer 子代理（异构 item 分型渲染）；角标计入两者运行中数量；支持中断子代理（`session.interruptSubagent` IPC）。
- **后台任务「清除已结束」含已完成子代理**：与 bash 已结束任务一并清除，避免完成态子代理一直挂在列表里。
- **能力页顶部 Banner**：能力列表上方增加装饰性 Hero 条；右侧从市场能力图标池随机轮播（与卡片同源 skill/MCP 图标）。
- **自动化空状态推荐任务**：用户尚无自动化任务时，页面直接展示「每日晨间简报 / 每日工作总结 / 每周复盘」三张推荐模板；点击后打开新建表单并预填名称、调度与 prompt（顶栏「新建任务」仍可空白创建）。
- **后台任务手动终止**：活动面板后台任务列表中，运行中的任务可点「终止」；主进程 kill 后 agent 会收到用户手动终止的 `<task-notification>`，无需再靠对话让 agent 调 `task_stop`。
- **外观设置「界面主题」环境开关**：`VETTA_SHOW_UI_THEME=true` 时在设置 → 外观展示 default / xianxia 界面主题选择（含预览与不可用锁定态）；默认不展示。颜色主题仍仅在 default 界面主题下显示。
- **内置 Agent Skills**：构建时从 `packages/skill-presets` 按 `skills-manifest.json` 打包启用的 Skill，并内置 `create-skill`。
- **技能市场图标**：展示服务端下发的 `icon`（上传图 / `solar:xxx-bold`）；未配置时仍用 capability/scene 默认图标。
- **会话 / Skill 列表 info 日志（测试可观测）**：`session created` 记 sessionId、cwd、kind、scenario、`includeAgentSkills`；`skills.list` 记 cwd、按 source 计数与名称。使用 `getAppLogger("session"|"skills")`。
- **应用监控月度日聚合存储**：保留累计 `summary.json` 契约，同时按持久化统计时区将每日聚合写入 `app-monitor/months/YYYY-MM.json`；月文件携带随机安装设备 ID、revision、IANA 时区、UTC 日边界与覆盖起点，为后续多设备云同步预留可合并边界。升级时一次性清除旧 `~/.vetta/app-monitor.json`、累计汇总和已有月度聚合，从本次启动重新采集；设备 ID 与统计时区继续保留。
- **插件 release 导出（插件工作台）**：活动面板工程卡片新增「导出」按钮；经宿主原生保存对话框把当前 `release/<id>-<version>.zip` 复制到用户选择路径。宿主新增 `dialog.saveCopy(sourcePath, options?)`（源路径需可读，取消返回 null）。
- **插件 dev 热更新（插件工作台）**：工程卡片新增「热更新」开关（已安装后默认开）。打开后宿主把插件 dev 链接到工程目录（`vetta-plugin://` 资源直接从工程 `dist/` 解析，内存态不落注册表）、常驻托管 Node `vite build --watch` 并监听 dist，产物变化自动 `reload`（token 强制 MF 重注册），保存源码即生效。宿主新增 `plugins.startDevWatch/stopDevWatch` IPC；`InstalledPlugin.devWatch` 透出状态（starting/running/error）；卸载与 App 退出自动停 watch；`@vetta-org/plugin-vite` 在 `VETTA_PLUGIN_DEV_WATCH=1` 下跳过每轮重打 zip。
- **插件页自定义 badge**：本地 zip 导入或 plugin-workbench `install-from-path` 安装的插件（`source === "archive"`）在卡片与详情标题旁显示「自定义」标记，与系统插件「系统」badge 对称。
- **插件工作台（系统插件）+ 硬隔离 / 本地安装路径**：新增 preset `plugin-workbench`（对话 skill、标准脚本、Activity 面板；输入栏 mode 默认关）。宿主：`plugins.manage` 支持 `install-from-path`（安装确认后按声明一次授权并启用）；`InstalledPlugin.rootPath`；`registerModeGate` / `setContributionMode` 按 pluginId 硬隔离 agent 贡献（tools/skills/MCP/prompt）与 Activity Tab（ADR-0041 / ADR-0042）。`registerInputAction.hardIsolation` 与 manifest `contributionMode.hardIsolation`。
- **插件工作台内嵌完整插件手册**：将 `docs/plugin/*` 同步到 `agent/docs/plugin/`（`prebuild`/`sync-docs`），skill 强制先 read 再实现；附 doc-index 与 templates 参考。手册补全：MCP 三源聚合、`command.run`、turn-card/tool-call 槽、i18n、scope_use、hardIsolation、install-from-path 等。
- **插件内聚 MCP**：`plugin.json` 支持 `agent.mcpServers`（路径或内联）与权限 `agent.mcp.control`；`buildAgentPluginRuntimeConfig` 产出 `mcpServerContributions`（路径相对插件根 resolve，运行时名 `plugin-<id>-<local>`）。启停插件经既有 `reconfigureAgentPlugins` 联动 MCP 进程。不写用户 `mcp.json`（ADR-0040）。
- **外置插件 cowart-vetta**：改编自 [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart)——活动面板 + `open_cowart_canvas`、skills、插件内聚 MCP（画布 state/image 工具；无 Codex widget 宿主）。源码位于 `packages/plugins/externals/cowart-vetta`，不随 App 打包，由用户安装 zip。
- **Slash `/` 列出插件 skills**：`skills.list` 合并已启用插件的 `agent.skillPaths`（`skillPathContributions`），source 标为 `plugin`。
- **cowart-vetta MCP 进程被误杀修复**：`start-mcp.mjs` 在 `import` bundle / `server.connect()` 返回后不再 `process.exit(0)`，否则宿主侧连接立刻断开、MCP tools 为空。
- **cowart-vetta 1:1 画布**：活动面板嵌入完整 tldraw（上游 App.jsx）；Codex widget bridge 映射为 `ctx.fs` + `conversation.sendPrompt`；`fs.writeFile` 支持 `base64` 写二进制资产。
- **知识库 / 批量任务 / 自动化页 AI 协助入口**：复用设置页「让Vetta帮您配置」；顶栏弹出意图 Popover，打开带页面上下文的对话。知识库页（含未启用态与「全部知识库」列表）、批量任务页、自动化页均已接入；示例与气泡标签按页面区分（如「知识库协助」「批量任务协助」）。
- **连接器推荐 Figma（社区 MCP + PAT）**：`figma-developer-mcp` stdio 预设在「发现 → 推荐」展示；添加时必填 Personal Access Token（`FIGMA_API_KEY` env，仅本机）；引导链接指向 Figma Help Center「Manage personal access tokens」。定位为读设计上下文辅助写码（非官方 `mcp.figma.com` OAuth）。
- **远程 MCP OAuth 授权（通用，Notion 首接）**：HTTP 连接器支持浏览器 OAuth；IPC `mcp.login` / `logout` / `hasAuth` / `authStatus`；扩展 → 连接器展示「待授权 / 已授权」与去授权/断开。Notion 内置预设改为官方托管 `https://mcp.notion.com/mcp`（不再手填 Integration Secret）。
- **OAuth 连接器添加时序**：先浏览器授权成功再写入 mcp.json；Dialog 保持打开并显示「请在浏览器中完成授权…」，避免点继续后立刻出现「已添加」。
- **对话消息编辑 / 分支切换 / 分叉会话**：任意已落盘的用户消息可编辑（解析 skill/@文件 回填底部输入框，发送时 `navigateForEdit` 从 parent 分叉）；同位置多版本显示 `‹ i/n ›` 切换分支；支持「分叉为新会话」导出独立 session。streaming 时切换/编辑/分叉会确认中断。History 透传 `entryId` 与 sibling 信息；Runtime/IPC 新增 `navigateForEdit` / `switchBranch` / `forkSession`。
- **Fork 来源展示与跳转**：分叉会话在 fork 回合 AI 回复下方展示来源提示（居中、无背景，含被 fork 消息预览），点击打开父会话并滚动到源消息；侧栏 fork 会话用分叉图标标识。
- **远程 MCP 图标**：连接器「发现 → 广场」与「我的」均展示管理员配置的图标；添加时写入 `mcp.json` 的 `icon`；已添加但缺 icon 的条目会从市场自动补全。
- **插件全局 Toast `ctx.ui.notify`**：插件可调用无权限的 `notify({ message, title?, variant?, error?, durationMs? })` 推送右下角 Toast；传入 `error` 时默认 error 样式、常驻不自动关，并提供「复制堆栈」（含 pluginId@version 与 stack），同时 `console.error` 一份。

### Changed

- **新会话页 Work/Coding 切换**：移到问候语标题上方；选中段在 icon 右侧展示 Label（Work/Coding），未选中仅保留 icon；选中高亮改为按钮自身背景（宽度随文案伸缩）。


- **官方插件项目管理接入 Domain Capability**：`PluginOfficialApi.projects` 通过七个独立项目能力令牌、宿主项目 Provider 和 Capability Session 调用；仅官方且当前启用的插件获得精确 Grant，项目业务从 renderer 桥接收口到主进程服务。
- **Work 模式不再把失败的工具调用冒泡到阶段组外**：失败调用与普通调用一样留在阶段组内折叠，展开阶段仍可查看，避免非技术用户在对话流里看到看不懂的红色工具卡。插件自定义 UI 工具与 error 块（模型/请求级报错）仍单独渲染。
- **通用设置分区合并**：设置 → 通用由 6 个单行分区收拢为 3 组——「基础」（工作区 / 沙盒 / 通知）、「应用」（版本更新 / 引导）、「开发者」（调试模式 / 导出诊断包），减少卡片与标题占位。
- **Vetta Vivi 设置分区合并**：「显示状态」与「窗口」合并为「显示与窗口」（显示桌宠 + 始终置顶），其余装饰 / 气泡 / 开发调试分区不变。
- **预设服务商启用简化**：模型配置里未启用的预设服务商行内直接展示 API Key 输入框与「启用」按钮，无需先展开表单；placeholder 仅示意格式（`sk-...`）；已启用仍用「改 Key」展开修改。
- **Vetta Claw 设置分区整理**：「总开关」与「对话模型」合并为「基础」；连接状态徽标上移到页标题旁；消息渠道与状态日志分区结构不变，减少单行卡片。
- **Claw 徽章下沉到底部头像 item 内**（脉冲点 + Claw，非交互状态标记）。侧边栏顶栏一度改为展示可切换的「工作模式」徽章，但本版稍后把模式入口收敛到了新会话页一处，该徽章与共享分段切换器 `AgentModeSwitcher` 均已移除，详见下方「工作模式的调整入口收敛到新会话页一处」。
- **插件 App Action 运行时收口**：`vetta-actions` 改为不可停用/卸载的 required 系统插件并要求 Plugin API `^1.1.0`；Catalog 在核心 provider 未就绪时返回结构化错误，插件热更新按 provider 快照原子切换并在失败时保留上一版；官方审批 operation 映射改为宿主权威选择；批量任务、定时任务与 MCP 写入增加主进程结构校验，官方插件 API 按领域拆分并收紧数据类型。
- **首次启动引导**：已登录时隐藏登录步骤（含底部 indicator）；设置 → 通用最下方新增「启动 App 引导」，可随时重新打开引导页。
- **界面语言支持「跟随系统」**：`desktop-config.language` 取值 `system` | `zh` | `en`（缺省 / 未设置 = `system`）；启动按 OS locale 解析（中文族 → `zh`，其余 → `en`）。设置 → 外观与首次引导「语言与外观」均提供跟随系统 / 中文 / English 选项；缺译回退仍为中文（`FALLBACK_LANGUAGE=zh`）。
- **开发态 Vite renderer 端口改为 3020**：避免与官网 Next（3000）、仙侠主题 dev（3010）冲突；`wait-on` / `VETTA_DESKTOP_DEV_URL` 同步为 `http://127.0.0.1:3020`，并启用 `strictPort`。
- **用户消息不再展示相对时间**：消息下方操作区去掉「刚刚 / N 分钟前」等时间标签，复制等操作按钮与分支切换保留。
- **聊天输入框 placeholder**：改为自定义不可选中覆盖层，默认态多条文案垂直自动轮播（i18n `inputBar.placeholder.defaults` 数组可自由扩展）；无会话 / 思考中 / 输入预测建议仍为单条静态文案；有任意字符（含空格）即隐藏，与原生 placeholder 一致。纯视图落在 `@vetta/theme-ui/chat` 的 `InputBarPlaceholder`，desktop model 解析文案；支持 `chat.inputBarPlaceholder` component override。
- **Skill / Scene 改为结构化 Prompt 引用**：会话输入、Vetta Debug、自动化与批量任务统一通过顶层 `PromptRequest.promptRef` 传递选择，不再向用户正文拼接 `/skill:` / `/scene:`；历史重载、消息编辑和徽章展示从隐藏历史标记恢复，旧文本前缀会话仍可读取。
- **知识库 Beta 徽标**：侧栏「知识库」与设置「知识库设置」显示镂空 BETA badge；设置「应用快照」侧栏与页标题去掉 beta 标记；设置侧栏 beta badge 改为镂空描边样式。
- **自动化新建/编辑 Dialog**：加宽为 `max-w-[min(52rem,calc(100%-2rem))]`（覆盖 Dialog 默认 24rem），高度上限 `88vh`。
- **Markdown 无序列表样式**：聊天消息与 Markdown 预览的 `ul` 由圆点改为与新会话页引导词一致的树形连接线（竖轨 + 横枝 / 末项 L 角）。
- **能力页窄屏 2 列**：能力卡片网格由固定 3 列改为 `grid-cols-2 lg:grid-cols-3`（宽度低于 lg 时两列）。
- **设置 → 账户 Vetta Go 卡片简化**：去掉 3D 倾斜、浮动光晕、持续弹跳与扫光等装饰动画，改为标准 `bg-card` 边框卡片；信息结构（套餐/额度/模型）不变。
- **设置 → 账户头像**：由圆形改为圆角矩形（`rounded-2xl`）。
- **设置「桌宠」更名为「Vetta Vivi」**（侧栏 item 与设置页顶部标题），且桌宠默认开启（无本地配置时 `enabled: true`）。
- **「黑白」主题配色**：深色 `background` `#0a0a0a`、`muted` `#161616`、`card` `#121212`；深色 `popover`/`border`/`input` 改为中性灰；深色 `accent`（hover）抬到 `rgb(48, 48, 48)`，与 popover 拉开侧栏设置菜单 hover；浅色 `card` `#f8f8f8`、`muted` `#fafafa`、`secondary` `#f0f0f1`、`border`/`input` `#eeeeee`、`accent` 调浅；浅色侧栏选中 `bg-primary/15` 压到约 7%/5% 叠色。
- **能力列表排序**：固定为内置 MCP → 远程 MCP → 手动 MCP → 自定义 skill → 远程/市场 skill（同类内仍按安装态/可更新/热度/标题）。
- **Skill 默认图标**：未配置 icon 时使用 3D 方块 SVG（浅色 `#1C274C` / 深色白色），能力卡片、Skill 卡片与详情 dialog 共用。
- **侧边栏「扩展」更名为「能力」**：主导航与相关 deep-link / 审批文案对齐；能力页「我的」将 `~/.agents/skills` 兼容发现的项独立为「通用 Agent Skill」分组。
- **侧栏无项目空状态**：无用户项目时，在默认「对话」区上方展示「还没有项目 / 点击上方 + 新建项目」空状态（此前仅在默认项目也不存在时才显示，实际几乎不可见）。
- **外观设置 BotAvatar 下移**：右上角动画移到「语言」区右侧、「外观模式」上方空白处。
- **设置页顶栏与侧栏标题平齐**：去掉内容区顶部 `h-12` 占位，各设置页 `pt-2` 与侧栏「设置」label 对齐。
- **「默认」主题边框改中性灰**：深色 `border`/`input` 改为 `#3a3a3a` / `#424242`，浅色 `#d6d8db`，不再继承经典主题偏蓝描边。
- **外观设置文案与紧凑卡片**：section「默认主题颜色」改为「主题颜色」；外观模式、鼠标指针选项改为横向紧凑卡片。
- **外观设置隐藏「界面主题」**：设置 → 外观不再展示界面主题（default / 仙侠）选择 section。
- **「经典」主题 secondary 与背景拉开色差**：深色 `rgb(36, 38, 48)`、浅色 `rgb(235, 235, 235)`，避免 `bg-secondary` 与背景几乎同色。
- **场景迁至侧栏「更多」**：扩展页移除「场景」Tab；新增独立 `/scenes` 页面，入口在侧栏「更多 → 场景」。旧深链 `/skills?tab=scene` 自动重定向。
- **扩展 → 能力列表 UI**：item 改为「图标 | 标题与 intro | 添加/更多」横排；未添加显示「添加」按钮，已添加显示更多菜单；去掉下载次数与常驻背景色，仅保留 hover 高亮。无图标时使用默认 3D 方块 SVG（浅色 `#1C274C` / 深色白色）；所有图标外包超圆角矩形。
- **内置 MCP 图标**：GitHub / Figma / Notion 替换为新版预设图标（`public/mcp/*.png`）。
- **侧边栏 Claw badge**：背景改为 `bg-secondary`，文字与状态点改为 `text-secondary-foreground`。
- **设置页 item 背景统一 `bg-card`**：`SettingSection` 容器及 MCP / IM / 插件 / 外观 / 宠物等列表卡片由 `bg-muted`（或半透明变体）改为 `bg-card`。
- **Agent 设置人设 / 自定义指令背景**：人设下拉触发器与自定义指令 textarea 改为 `bg-card`。
- **设置 → 外观选中态统一**：外观模式 / UI 主题 / 鼠标指针的 active 样式与「默认主题色」卡片一致（`ring-2 ring-primary ring-offset-2` + 右上角 check badge）。
- **「默认」主题浅色偏冷**：浅色表面由米黄纸面改为冷灰石色（`#f0f1f2` 等），降低黄调；主色与深色不变。
- **「默认」主题换新色板**：原暖砂默认下线；由迭代中的「测试」色板接替（id 仍为 `sand`，label「默认」）。主题色 `#f76f53`；旧 id `test` 迁移到 `sand`。
- **外观颜色主题精简与重命名**：移除「猩红 / 霓虹 / 海洋」；原「GitHub」更名为「青石」（id `slate`）；旧 id `github` 自动迁移。
- **全主题 secondary 相对 muted 对齐**：深色 secondary 略深于 muted，浅色 secondary 略浅于 muted。
- **列表卡片背景改用 card**：自动化 / 扩展 / 批量任务 / 插件页 item 由 `bg-muted` 改为 `bg-card`。
- **输入栏背景统一 `bg-card`**：输入框本体深浅色均为 `bg-card`；下方 action list 为 `bg-card/70`。
- **插件工作台热更新默认开启**：已安装的工程卡片在应用成功或打开面板时默认启动热更新；用户可手动关闭（本会话内不再自动重开）。
- **设置侧栏「知识库设置」去掉 BETA 徽标**。

### Fixed

- **新会话页内容异步出现时布局抖动**：hero 延迟挂载与技能/场景/引导词分批 setState 导致区块插入时页面跳动。现 hero 首帧即占位（仅 opacity 入场）、资源一次落盘，并在加载中为场景/技能/引导词预留高度；主列仍保持整块 `justify-center` 垂直居中（避免把输入栏单独钉中线造成整体偏上）。
- **侧边栏窄宽自适应**：最小宽度 180px；顶栏工作模式徽章按 actions 可用空间在「icon+文案」与「仅 icon」间切换（拉宽后可恢复文案），折叠按钮始终可见；底栏长昵称 truncate，Claw/消息中心不被裁切。





- **只读外观/导航不再误弹授权**：`appearance.theme` 的 `help`/`get` 与 `navigation.open` 的 `help` 原先挂在 `effect: write` 上，本地 Action RPC 一律要审批。现拆出只读 `appearance.query`、`navigation.query`；`appearance.theme` / `navigation.open` 仅保留真正写操作。
- **会话页多行输入退格时 MessageList 抖动**：输入框变短量高时曾把 `textarea` 临时设为 `height: 0`，flex 列里 MessageList 瞬时变高导致 `scrollTop` 被夹低，贴底 lerp 再追回。现量高期间锁定输入区父级 `minHeight`，并在列表视口尺寸变化且 stick-to-bottom 时立即贴底。
- **桌宠首次出现落在屏幕中心**：全屏 workArea 叠加后默认 `contentOffset` 为中心，右下角仅靠 `did-finish-load` 的 `set-content-offset` IPC，易与 React 监听注册竞态导致消息丢失。现加载时直接计算右下角 offset 并写入入口 URL，渲染端首帧即读取初始位置。
- **设置页多处 i18n 漏翻**：外观六个颜色主题名、Agent 人设下拉 label/description、快捷键「全局快捷键 / 快捷面板」section 标题、Claw「总开关 / 消息渠道」section 标题、Vetta Vivi 装饰 item 名称均改为走 i18n；主题定义与装饰元数据中的中文硬编码改为英文 fallback。
- **新会话页模型选择器重启后显示「选择模型」**：per-session 改造后全局偏好不再写入/恢复 localStorage，欢迎页无会话可 pull 导致 UI 空置（实际仍可走后端默认模型对话）。现恢复 `vetta-selected-model` 作为新会话全局偏好（atom 启动读取、用户选择写回、`useAppInit` 正确恢复），options 未就绪时用 modelKey 兜底展示，已有会话仍以 session settings 为准。
- **新会话引导词区高度抖动**：单条引导词过长换行或轮播切页时组件高度变化，牵动 `justify-center` 布局导致页面跳动。现固定 3 槽位列表高度，单条单行 `truncate`（全文在 `title`）；仅 1 组时用满宽，默认主题与仙侠主题同步。
- **黑白主题 BotAvatar 眼睛**：深色覆盖为灰 `rgb(150, 150, 150)`；浅色保持白眼，不影响其它主题。
- **黑白主题浅色发送按钮禁用态**：默认 `muted-foreground` 偏深，压浅为中性灰 `rgb(180, 180, 180)`。
- **「经典」主题浅色 border / card 分层**：`border`/`input` 由 `rgb(213, 213, 216)` 改为 `rgb(230, 230, 230)`；`background` 纯白、`card` 极浅灰 `rgb(250, 250, 250)`（`styles.css` 浅色回退同步）。
- **「电光」主题浅色 border 过深**：`border`/`input` 由 `rgb(215, 213, 206)` 改为 `rgb(230, 228, 222)`；浅色仍为纯白画布 + `card` `rgb(250, 250, 250)`。
- **「黑白」主题浅色 card 与背景不可辨**：浅色 `background` 纯白 `rgb(255, 255, 255)`，`card` 改为极浅灰 `rgb(250, 250, 250)` 分层；`popover` 保持纯白。
- **「黑白」主题浅色 border 过深**：`border`/`input` 由继承经典的 `rgb(213, 213, 216)` 改为 `rgb(230, 230, 230)`，减轻灰框重量。
- **插件详情卸载确认二次点击**：Sheet（Vaul Drawer）打开时确认框首次点击会关掉 sheet、需再点一次才生效。根因是 modal drawer 把 body 设为 `pointer-events: none`，portaled ConfirmDialog 未恢复点击；现为 ConfirmDialog 加 `pointer-events-auto`，并在确认框打开时阻止 drawer outside dismiss。
- **Claw / 自动化 / 批量任务卡片网格固定横排**：设置页 Claw 消息渠道、自动化任务列表、批量任务卡片不再随容器/视口宽度在单列与多列间切换，分别固定为 2 列与 3 列横排。
- **问答面板多题主按钮**：多问题未到最后一题时底部主按钮显示「下一步」（当前题已答即可点），最后一题才显示「提交」；避免未答完全部问题时一直看到置灰的「提交」。
- **插件热更新偶发要手点「重载 / 重新安装」**：根因 (1) 仅靠 dist 顶层 `fs.watch`，部分环境下丢事件或半截写盘即触发，未读 vite 成功日志（stdout 还被直接 discard）；(2) dev overlay 不带 permissions/commands/settingsSchema，改声明像没生效。现以 vite「built in …ms」为主触发、dist 与 `plugin.json` 监听为辅；dev 会话内声明权限/命令自动放行（仅内存，不落注册表），关热更新仍回落安装态。
- **发送图片后消息列表并排出现两张缩略图**：乐观气泡同时带了 base64 `message.images` 与文本里的 `@image-cache` 路径，渲染把两者拼在一起；重进会话只有路径故正常。现有落盘路径时只渲染路径缩略图，base64 仅作 persist 失败时的兜底。
- **插件 file-preview 布局围栏**：`PluginFilePreviewView` 外壳增加 `transform` fixed containing block + `overflow-hidden` + `isolate`，避免预览插件用 `position: fixed` 贴 App 视口逃出预览区。手册补充面板类 slot 布局边界（禁止 viewport fixed / 超高 z-index；全局浮层走 `registerGlobalSlot` / `notify`）。
- **office-viewer 不再占住 PPT/PPTX 预览**：系统插件只注册实际可渲染的 `pdf` / `docx` / 表格扩展名，移除 PowerPoint 兼容性占位页；第三方插件可接管 `ppt`/`pptx` 预览。
- **确认 Dialog 被右侧 Drawer/Sheet 挡住**：全局 `ConfirmDialog` 挂在 `AppFrame`（`isolate`）内，z-index 被 stacking context 困住；插件详情等经 Portal 挂到 body 的 Drawer（z-50）会盖住卸载确认框。现将 ConfirmDialog portal 到 `document.body`，与 Drawer/Dialog 同层比较（z-[100] 压过 z-50）。
- **新会话页引导词只轮播头两个插件**：组级原为整页跳切（一次换 2 组）且间隔 24s，词级 6s 动画更抢眼，体感上永远只有前两个插件在转。现改为步进 1 的滑动窗口，组级间隔 8s，所有声明了 `guidingWords` 的启用插件都会进入可见区。
- **插件 reload 后活动面板宽度回到默认**：工作台「重载」/ agent reload / 热更新会短暂清空插件 activity tabs，active tab 回退到 `file` 并触发文件 tab 卸载副作用，用户拖宽（如 500px）被盖回默认。现 (1) reload 期间保留上次已发布的 tab/action 贡献、原子替换插件列表；(2) 记忆中的插件 tab 在贡献短暂缺失时 sticky，不回退 file；(3) 面板宽度写入 localStorage。
- **热更新后活动面板宽度被重置**：插件 `activate()` 里的 `ctx.ui.openActivityTab({ width })` 会随 reload/热更新重放，把用户手动拖出的面板宽度覆盖回初始值（小于下限时表现为缩到最小）。现 `width` 只在该 tab 首次 attach 时生效，重复调用只做激活。
- **插件 reload/热更新加载旧代码（根因修复）**：remoteEntry.js 是 ESM 容器，MF 用原生 `import()` 加载，浏览器 ES module registry 按 URL 永久缓存——reload token 只在 manifest URL 上、相对解析不会带到 remoteEntry，导致 reload 与热更新永远执行旧模块（只有换版本路径的卸载重装才生效）。现给 MF host 注册 `vetta-reload-bust` runtime 插件，在 `afterResolve` 把 token 追加到 remoteEntry 的 import URL，使每轮重载 URL 唯一。同时修复 Action 路径 uninstall/set-enabled(false) 不停 dev watch 子进程的泄漏。
- **Agent 改插件感知热更新**：`plugins.query` 的返回项透出 `devWatch`；workbench skill/prompt 更新——热更新开启时改完源码即自动生效，agent 不再走 install-from-path/reload（不弹确认）。
- **工作台流程不再弹「从本地路径安装插件确认」**：workbench skill/prompt 全面改为引导用户在活动面板点「应用到 Vetta」（面板路径一次完成授权+启用、无确认弹窗）；应用后默认开启「热更新」。宿主 `plugins.manage` 的 `install-from-path` 能力保留（外置插件 zip 等通用场景仍可用）。
- **AI 输入栏 toggle 按会话持久化**：图像生成、插件工作台、知识检索等 input-action 状态按 `sessionPath` 独立记忆（localStorage）；切会话 / 离开再回来 / 刷新后恢复，且 hardIsolation contribution mode 随当前会话同步。此前为全局内存态，切换或刷新即丢失。
- **Fork 后侧边栏不出现新会话**：「对话」项目下 openSession 用 UUID 子目录 cwd 刷新 sessionsMap，桶键与侧栏不一致。现用 `conversationBucketCwd` 归一后 `loadSessions`，并 `ensureLocalSession` 兜底插入；列表透出 `parentSessionPath` / `parentEntryId`。
- **安装/启停/重载插件后活动面板 tab 不出现**：main 变更插件注册表后广播 `vetta:plugins:changed`，渲染进程 `PluginGlobalSlotHost` 重载 MF remotes。此前仅设置页本地 `notifyPluginsChanged`，工作台 / Action `install-from-path` 装完 UI 仍停在旧列表，需重启 App 才见 tab。
- **用户长消息展开后移出气泡又自动折叠**：展开状态曾依赖 `children` 引用，hover 操作栏等重渲染会重建 `textBody` 并误重置。现以正文 `contentKey` 为唯一复原条件，点击展开后保持展开；无收缩按钮；切换会话或刷新后 remount 恢复折叠。
- **会话 streaming 时 text block 高频闪烁**：`useTextBlockModel` 每次 render 新建 `labels` 对象，导致 `TextBlockView` 的 ReactMarkdown `components` 映射失效、自定义节点整树 remount，`.streaming-chunk` 入场动画对已有文本整段重播。现稳定 `labels` 引用，且 `components` 仅随 `theme` 重建（labels/回调走 ref）。
- **连接器「我的」误把其他 HTTP MCP 显示为 Notion**：`matchBuiltinMcpPreset` 回退匹配时错误使用了 `preset.config.url.includes(packageHint)`（对 Notion 预设恒真），导致广场添加的远程 HTTP 连接器标题/图标被盖成 Notion。现仅用条目自身的 `url` 与 `packageHint` 比对。
- **免密钥 HTTP 连接器误提示「待授权」**：`serverUsesOAuth` 曾把所有无 headers 的 HTTP MCP 都当成 OAuth；现仅对内置 OAuth 预设（如 Notion）展示授权状态与按钮。
- **输入框 / 用户消息本地图片无法展示**：输入栏 `@` 图片曾用 `file://`（Electron 拦截 `Not allowed to load local resource`），改为 `vetta-file://`；用户气泡不再过滤 `image-cache` 路径，发送落盘回放后缩略图可显示。共享 `toVettaFileUrl`。
- **编辑/续聊后 bash 与文件树 ENOENT（session cwd 丢失）**：`~/.vetta/conversation/<uuid>` 是 ADR-0007 的运行 cwd；「清空产物」曾整目录删除这些 UUID 夹，session header 仍引用 → 编辑后 agent 报 Working directory does not exist、`vetta:fs:read-dir` scandir 失败。清空产物改为只清空 UUID 目录内容并保留目录；`session:create` 与 `RuntimeHost.prompt` 在启动轮次前 `mkdir` 自愈缺失 cwd。
- **Fork 保留被点击的用户消息及本轮 AI 回复**：分叉导出到该 user 回合 tip（user + assistant/工具链；此前只到 user 会丢 AI 气泡；再早只到 parent 会连 user 也丢）。打开新会话后清空 pending 编辑，避免对原 session 的 entryId 调用 `navigateForEdit` 报 Entry not found。
- **分支箭头在 skill/隐藏 custom 插入后也能识别 sibling**：user 版本按「结构分支点」聚合（跳过 skill_expansion 等透明节点），不再只比直接 parentId。
- **App Action：`shortcuts.*`（设置 → 快捷键整页）**：统一快捷键业务域——`shortcuts.query` / `shortcuts.manage` 覆盖全局应用快捷键绑定（`set-binding` / `reset-*`）与快捷面板呼出/发送后行为（`set-quick-panel-trigger` / `set-quick-panel-behavior`）。自定义绑定写入 `desktop-config.shortcuts.bindings`；面板相关仍用 `quickPanel` 配置字段供运行时复用，但不再注册独立 `quickpanel.*` Action。支持从旧 `localStorage(vetta-shortcuts)` 迁移；写操作走按 operation 的审批 UI。
- **设置页 Webhook 飞书/钉钉表述**：原 provider 中 displayName 与错误提示、manager 中默认名称与测试消息硬编码中文。现 displayName 源改为英文，设置页通过 i18n（whFeishu/whDingtalk）渲染；默认名生成与测试消息走 mainT + settings i18n；botSuffix 提取到 common；URL 校验错误改为英文。
- **设置页 Webhook 飞书/钉钉图标**：移除飞书、钉钉的 iconClass（provider 源、接口、descriptor、列表 mapper、编辑器选择器、EndpointListView 渲染全部条件化显示），不再展示图标。

### Changed

- **`build:presets` / dev 自动同步插件手册**：构建预置插件前若租户包含 `plugin-workbench`，先跑其 `scripts/sync-plugin-docs.mjs`（`docs/plugin` → 包内 `agent/docs/plugin`），再算缓存哈希；改 monorepo 手册无需再手跑 sync。
- **知识检索改为硬隔离**：开启「知识检索」toggle 后本轮才暴露 `kb_list_available_tags` / `kb_filter_by_tags`（经 `metadata.knowledgeMode`）；未开启时 agent 无法调用知识库检索工具。tooltip 文案同步。加工场景（`kb-processing`）不受影响。
- **侧边栏导航「更多」收纳**：主区域保留新会话 / 自动化 / 知识库 / 扩展；「批量任务」「插件」收进底部「更多」弹出菜单（右侧 popover，打开时 chevron 旋转）。当前路由落在收纳项时，触发器展示该项 icon + label。
- **侧边栏新增「插件」入口**：扩展页的「插件」Tab 迁至独立 `/plugins` 页面；侧栏新增导航项，旧深链 `/skills?tab=plugin` 自动重定向。
- **侧边栏项目区 / 会话区可滚动底部渐隐**：内容溢出且未滚到底时显示底部 fade，提示可继续滚动；滚到底或无溢出时隐藏。
- **连接器推荐仅展示已接好的预设**：目前为 Notion 与 Figma；Canva / Slack / Gmail / Google 日历 / 云端硬盘等仍保留配置与匹配逻辑，在「发现 → 推荐」中隐藏（`listedInDiscover`），接好后打开该标记即可展示。
- **连接器编辑改为右侧 Sheet**：自定义 MCP 点编辑后从侧边滑出表单，不再在卡片下方内联展开。
- **连接器配置引导 Dialog**：改为双图标头图 + 分区说明卡片 + 全宽「继续」主按钮的连接授权式布局（保留本机凭证表单与推荐徽标，风格沿用现有 token）。
- **快捷键 Action 授权弹窗对齐设置页交互**：`set-binding` 用功能下拉 + `ShortcutRecorder` 录制，不再手填 id/组合键字符串；快捷面板触发与发送后行为复用 `@vetta/ui` Select（与设置页同款）；恢复类弹窗展示产品功能名与默认键显示。文案按 `docs/user-facing-copy.md` 说结果与影响。
- **新会话欢迎区主题覆盖点 `chat.newSessionHero`**：开放 `NewSessionHeroProps`（标题/副标题/场景轮播等）供主题替换欢迎区实现；默认仍渲染 `BotAvatar`。修仙主题覆盖为无头像布局，去掉 idle 弹跳手势。
- **扩展页「连接器」Tab**：侧栏「扩展」下新增连接器入口，承载原设置中的 MCP 管理（已添加列表、发现 MCP、AI 协助配置）。

### Removed

- **模型配置页移除「视图 / JSON」切换**：仅保留可视化服务商与模型表单；删除 `ModelsJsonEditor`、编辑模式状态，以及导航 section `models-json`。
- **移除「全局模型」配置与 `models.manage` 的 `set-peripheral`**：设置页不再展示周边任务专用模型选择；自动标题 / 输入预测改为自动使用当前会话模型并在失败时轮转其它可用模型。Action 审批组件 `ModelsSetPeripheralApproval` 与 i18n 相关文案同步删除。`ModelsConfig` 类型与读写路径不再包含 `peripheralModel*`；读/写 `models.json` 时剥离旧残留键。
- **移除内置 Browser（Playwright MCP）推荐预设**：不再在「发现 MCP」中提供一键添加 `@playwright/mcp`；浏览器自动化改由 Playwright CLI + skill 等路径使用。已手动添加到 `mcp.json` 的配置不受影响。

### Changed

- **MCP 无配置图标时使用默认 SVG**：已添加/远程列表在无图标或加载失败时展示主题色圆角矩形底 + 链环图标，不再回退 `default.webp` 或 puzzle 图标。
- **连接器 MCP 布局改为宫格卡片**：已添加 / 推荐 / 远程列表由纵向列表改为 `auto-fill` 卡片网格，与扩展页插件区一致，更直观。
- **扩展页去掉内容区顶部空白条**：移除页面内 `drag-region h-6` 占位，大标题与壳层顶栏更紧凑（拖拽仍由 PageHeader 提供）。
- **扩展页顶栏右侧为 Tab 操作插槽**：场景/技能放搜索与导入；插件放导入；连接器放「让 Vetta 帮您配置」（原内容区内 AI 协助入口上移）。
- **连接器「自定义」改为顶栏按钮 + 对话框**：发现区 Segmented 仅保留推荐/远程；顶栏「自定义连接器」打开添加 Dialog。
- **连接器列表合并为「我的 / 发现」**：去掉上下双列表；Toggle 为「我的」「发现」；发现内上方「推荐」、下方「广场（远程）」。
- **扩展页 Tab 切换偶发要点两下**：`typeTab` 改为仅从 URL `search.tab` 推导，去掉本地 state 与 URL 竞态回写。
- **连接器 Toggle 顺序为「发现 | 我的」**：默认落在发现；发现列表保留已添加项并展示已添加徽标与禁用态按钮。
- **MCP 管理从设置迁至扩展 → 连接器**：设置侧栏移除「MCP 管理」；`/settings/mcp` 与 `mcp-*` section 深链、`navigation.open` 的 `mcp`/`connectors` 目标均跳转到 `/skills?tab=connector`。AI 协助上下文文案改为「扩展 → 连接器」。
- **侧栏项目/会话分隔条可见性**：`ProjectsPanelSplitHandle` 在侧栏 hover 时展示细分割线与居中 grip 条，直接 hover/拖拽分隔条时切换为 primary 高亮，避免空白分隔区不易发现可拖拽。
- **设置页 AI 协助入口**：紧凑「魔法棒 + 让Vetta帮您配置」触发；点击在按钮下方弹出意图 Popover（建议气泡、轻量动效、取消/开始操作），替代原先居中 Dialog。
- **project 域 must_split 清空并迁入 `@vetta/theme-ui/project`**：侧栏 Project/Session 行与列表、ContextMenu、ProjectsPanel、Schedule/BatchQueue 状态、ProjectDetailPage 等拆为 model + props-driven View；FilterSelect 保留 host Popover（`host_primitive_hold`）；DetailPage 以 slots 挂载 batch/flowing/activity/dialog。见 `docs/theme/ui/17-project-split.md`。
- **theme-ui 迁移闭合门禁**：新增 `eligible-inventory.mjs` + `docs/theme/ui/deferrals.json` 逐路径 deferral；SettingsMenu 账号/下载/设置/主题/配额段与 MessageCenterTabs 迁入 props-driven view。
- **skeptic2 pure leaves 迁入 theme-ui**：成就 Title/Curtains/Confetti、AddProjectMenuItem、MultiplierTag、PreviewErrorBoundary、SyntaxHighlightedCode、CodePreview（shiki peer）；assets/i18n/clipboard 仍由 desktop adapter 注入。
- **skeptic pure leaves 补迁 theme-ui**：`InputBarCapsule`、`NewSessionBackground`、`KnowledgeFilesSkeleton`、`SkillToggleSwitch`、`ProjectsPanelSplitHandle`、`SettingsFormFields`、`MacKeyboardPreview`、`CodeBlockCopyButton`（clipboard 状态仍在 desktop）。
- **DrawerCard / TodoCard 迁入 `@vetta/theme-ui/chat`**：props-driven；Todo 文案经 desktop adapter 注入（保持原硬编码字符串，无新增 i18n key）。
- **多域 pure 叶子迁入 theme-ui**：`SandboxPermissionCard`、`SendButton`、`CopyIconButton`、`TextPreview`、`SettingsMenuActionButton/Divider`、`MessageCenterEmptyState/ToolbarButton`、`ProjectsPanelEmptyState`、`ActivityPanelFrame`；i18n 经 desktop adapter 注入。
- **chat 新会话纯叶子补迁 `@vetta/theme-ui/chat`**：`SceneCard`、`SkillCard`、`DefaultSceneCarousel`、`DefaultSkillBadgeRow`、`InputBarToolbarButton`；desktop 保留 i18n connected 入口（`SceneCarousel` / `SkillBadgeRow`）。
- **theme-ui 迁移台账收尾**：`docs/theme/ui` 记录 settings/其它域扫描结果——剩余 View 依赖 SettingSection/Dialog 等 host 原语，显式暂缓；见 `04-settings-and-others.md` 与 `99-final-audit.md`。
- **chat 纯 View 迁入 `@vetta/theme-ui/chat`**：`AtPanelView`、`SlashPanelView`（最小 skill 渲染形状）、`DefaultGuidingWords`；InputBar/MessageList 等大块暂缓。
- **root overlays 纯 View 迁入 `@vetta/theme-ui/overlays`**：`KnowledgeDropOverlayView`、`UpdateRestartDialogView`；依赖 Dialog/Drawer 的审批/登录等浮层暂缓至 `@vetta/ui` 原语就绪。
- **sidebar 剩余 props-driven 叶子迁入 `@vetta/theme-ui`**：`RunningPulseDot`、`SessionStatusIcon`、`SidebarUpdateIcon`、`ShowMoreSessionsButton`、`SidebarTopBar`（labels + brandTrailing slot）；desktop 保留 i18n 适配与 `SidebarUpdateButton` 等 connected 组装。
- **app-shell / sidebar 默认 view 迁入 `@vetta/theme-ui`**：`DefaultPageHeader`、`PageHeader*` 叶子组件、`DefaultWindowControls`、`WindowControlButton`、`DefaultSidebar` shell、`SidebarPanel` / `SidebarNavigation` / `SidebarNavItemButton` 等 props-driven 实现迁至 `theme-ui`；desktop-app 保留 connected 容器（`PageHeader`、`WindowControls`、`Sidebar`）与 model hook。导航文案改在 `useSidebarModel` 解析。`@vetta/desktop-theme-ui/*` 继续 re-export 兼容主题包。
- **重构并移除含糊的 `settings` App Action 域**：按设置页 IA 落域——界面语言在 `appearance.theme`（`set-language`）；工作区/通知/默认执行模式为 `general.query` / `general.manage`；Agent 实验开关为 `agent.query` / `agent.manage set-experimental`；知识库加工为 `knowledge.*`。审批 presentation 与 i18n 同步为 `general.*` / `agent.*`，不再注册 `settings.*`。
- **UI 主题 `appearance.colorScheme` 联动显示模式**：激活声明了 `colorScheme: "light" | "dark"` 的主题时，host 通过既有 `setMode`（与设置页亮暗切换同一路径）同步显示模式。修仙主题声明 `light`，切入即亮色。
- **设置页 AI 协助：用户气泡只显示意图 + 页面对应标签**：操作说明经 `metadata.settingsAssistInstruction` 以 `display:false` 注入；气泡上方展示固定文案徽章（如「MCP配置协助」「模型配置协助」），无悬停说明；`settingsAssistTabId` 随 metadata 持久化，历史回放经 `settings_assist_marker` 恢复。
- **仓库根目录 `bun run check` 纳入 desktop-app 类型检查**：在 Biome 与 monorepo `tsgo` 之后追加 `tsc --noEmit -p packages/desktop-app/tsconfig.json`，避免只在根目录跑 check 时漏掉 desktop / i18n 类型错误。
- **MCP 设置表单区分基础/高级选项**：添加/编辑服务器时默认只展示名称与 command/args（stdio）或 url（HTTP）；传输类型、环境变量、工作目录、请求头、超时、自动批准、禁用与调试等收入可折叠「高级选项」。编辑 HTTP 或已有高级字段的配置时自动展开。列表启用开关由图标按钮改为与设置页一致的 `Switch` 组件；去掉点击行展开只读详情，仅编辑时展开表单。
- **MCP 管理改为商店式结构**：上方统一列出已添加 MCP；下方「发现MCP」用 Tab 切换推荐 / 远程 / 自定义，且只展示尚未添加的项。去掉视图/JSON 切换，页头增加「可在对话中让 AI 助手帮忙添加 MCP」的提示。
- **扩展内置推荐 MCP**：新增 Canva、Notion、Figma、Slack、Gmail、Google 日历、Google 云端硬盘（含 webp 图标）；需密钥的项添加时弹窗填写，已添加项可用钥匙图标补全/更新密钥，缺必填密钥显示「待填密钥」。
- **侧栏项目/对话列表改为双区内部滚动**：`ProjectsPanel` 外层不再整体滚动；上方项目分组与下方默认对话各自 `overflow-y-auto`。默认高度比 4:6（项目:对话），中间可拖拽分隔条，比例限制 2:8～8:2，并持久化到 `localStorage`（`vetta-sidebar-projects-split-ratio`）。
- **侧栏展开会话列表恢复虚拟滚动**：展开「更多」后使用 `react-virtuoso` 的 `customScrollParent`，挂到所属分区滚动容器上，只虚拟化 DOM、不另开内层 scroller，避免双层抢滚轮。
- **侧栏默认对话区 header 固定**：对话/Claw 筛选条与操作按钮不再随列表滚动；仅会话列表区域 `overflow-y-auto`，Virtuoso 的 scroll parent 同步改为列表容器。
- **外观设置「鼠标指针」改为样式选择**：由自定义指针开关改为「默认指针 / 白鼬」两档卡片选择；存储键由 `vetta-custom-cursor`（布尔）迁移为 `vetta-cursor-style`（`default` | `stoat`），旧值自动兼容。
- **自动标题端到端耗时日志**：renderer `[auto-title] got name=...` 增加 `durationMs`（含 IPC + 主进程 LLM 全流程）。
- **知识库文件树按层懒加载**：`list()` 每个库只返回根层 nodes，不再递归整树叶子；进入子目录时通过 `listDir(kbId, relPath)` 每次只拉一层并合并进缓存。大库首屏不再扫全树，目录「N 项」用浅层 `childCount`；待加工列表与库文件数改从加工态 map 统计，不依赖已打开的目录树。

### Fixed

- **@vetta/ui 六原语 class 可能未生成**：Button/Dialog/Drawer/Select/Switch/Popover 实现迁入 `packages/ui` 后，主应用 Tailwind 只扫描 theme-ui；在 `styles.css` 增加对 `ui/src` 的 `@source`。
- **Dialog 弹窗几乎全屏宽**：`DialogContent` 默认 `max-w`/`sm:max-w-sm` 仅写在 `@vetta/ui`，未扫描时只剩 `w-full`；改为单一 `max-w-[min(24rem,calc(100%-2rem))]`，并在 `styles.css` 用 `@layer components` 对 `[data-slot=dialog-content]` 兜底宽度（调用方 `max-w-*` 仍可覆盖）。
- **macOS 顶栏右侧多余 70px 空白**：`DefaultWindowControls` 在 Mac 上曾返回占位 div，挤压 PageHeader rightSlot；现改为 `null`，与迁移前「Mac 不挂载窗口按钮」一致。
- **批量任务审批恢复主题 frame slot**：`BatchTasksTaskApprovalView` 经 `useThemeComponent("root.approval.batchTasksFrameView")` 注入 Frame，与 Execution/Project 审批一致，避免主题无法替换 frame。
- **窗口控件最小化/最大化图标无颜色**：app-shell 迁入 `@vetta/theme-ui` 后，`icon-[mdi--window-*]` 仅出现在 theme-ui 源码中，desktop-app Tailwind 未扫描导致 iconify 类未生成（关闭按钮仍可用因其它处仍引用 `mdi--close`）。在 `styles.css` 增加对 `theme-ui/src` 的 `@source`。
- **设置项 SettingRow 始终左右布局**：去掉 `@max-xl:flex-col` 等窄宽竖排逻辑；标题区可收缩，控件固定在右侧，不再上下堆叠。
- **知识库「整理用哪个模型」标题被压成单字竖列**：该行右侧用 `flex-wrap` + `basis-full` 警告会撑满整行宽度，左侧 `min-w-0` 被挤到近乎 0。改为控件与警告纵向 `items-end` 排列，SettingRow 标题 `truncate`、右侧 `max-w` 上限。
- **新会话首条消息前标题/侧栏误显示「未命名会话」**：`openSession` 后 listSessions 常先写入空 name + `(no messages)` 占位；用户发出首条 prompt 时 `ensureLocalSession` 因 path 已存在而跳过，且 `loadSessions` 只兜底 name 不兜底 firstMessage，乐观的用户文案被冲掉。现 `ensureLocalSession` 会在展示名仍为空时补齐 firstMessage，`loadSessions` 合并时同样保留可用的乐观 firstMessage，直至 auto-title 或磁盘真实 name 生效。
- **知识库页 Maximum update depth exceeded 死循环**：浏览 path 未写入 atom 时用 `?? []` 每次渲染新空数组，依赖 `path` 的 `useEffect`（清空选中）反复 `setState`；改为稳定 `EMPTY_PATH` + `pathKey`，清空选中在已空时跳过。
- **知识库进入子目录加载完弹回根层**：页面骨架曾在「深层懒加载出文件 + 加工态未 hydrated」时卸载内容面板，组件内 path 被清空；现页面骨架仅用于列表尚无缓存，加工态等待改在面板内层处理，浏览路径按库写入 atom，避免重挂载丢路径。
- **知识库文件列表首屏灰闪**：加工态（`fileStatuses`）未回填前，`statusFor` 把缺 key 默认成 `unprocessed`，文件多时 item 先灰 0.几秒再出角标。现改为：加工态完成至少一次拉取前对有文件的库继续显示骨架；`statusFor` 缺 key 返回 null（不默认 unprocessed）；刷新保留旧加工态（stale-while-revalidate），避免重复闪烁。
- **手打 @ 文件引用刷新后误进文件 badge**：用户消息里未通过 AtPanel 选中、仅作为正文的 `@…`（相对路径 / 非绝对路径）刷新会话后不应变成文件列表 badge。根因是 history 回放把所有以 `@path\n` 开头的行都当成附件前缀；现仅把绝对路径（面板选择 / 拖拽 / 图片缓存 / appshot 写出的格式）视为附件，并排除 `image-cache` 系统路径，避免刷新后正文 @ 消失、badge 文件与手打内容不一致。
- **优化 UI 主题包加载链路**：主题运行时新增分段 debug 耗时日志，区分主题列表读取、Module Federation host/remote 注册、`loadRemote`、模块缓存命中与 CSS 加载；同一主题版本的远程模块加载改为 Promise 级内存去重，避免 StrictMode 或并发请求重复拉取；`vetta-theme://` 版本化资源改用长期 immutable 缓存，减少第二次打开时重复协议读取。
- **避免启动时先渲染默认 UI 主题**：保存的界面主题为非 default 时，主题运行时会先加载该主题包，加载完成后再渲染应用内容，避免冷启动首帧使用默认 runtime 主题后再切换到用户选择的主题。
- **桌宠过夜动作切换导致视频资源累积**：桌宠视频不再随 `actionId` 变化重建 `<video>` 元素，改为复用同一 DOM 节点并在切换/卸载时显式暂停、清空 `src` 和 `load()` 释放媒体管线；自动内容尺寸监听也不再在每次 DOM 变化时重建 `ResizeObserver` 或观察整棵子树，降低通宵运行时 Chromium native 线程、句柄与内存累积风险。
- **桌宠随 agent 状态更新过快及气泡残留**：`app` 来源的桌宠动作与气泡显示现在各自至少展示 2 秒；展示期间收到的新状态只保留最后一条，计时结束后再应用最新状态，避免快模型高频事件导致动作和气泡快速闪烁。气泡隐藏信号不再进入节流队列，避免消失信号被延迟或被后续显示状态覆盖。用户手动切换动作与配置更新不受该节流影响。
- **桌宠拖拽、缩放与鼠标穿透异常**：窗口尺寸归一化改为按 `PET_SIZE_STEP` 对齐，避免透明窗口在 Windows 拖拽时漂移到非步进尺寸后反复回正；拖拽期间放宽仅用于 `setPosition` 的轻微尺寸漂移容忍度，减少无意义 warn 风暴；视频滚轮缩放继续使用“动作初始大小 × 全局比例”的模型，并按当前比例下所有动作的最大显示尺寸同步窗口，避免切换动作时窗口被小动作缩小、大动作再溢出；视频 hitbox 上报与主进程接收时都裁剪到窗口范围内，避免负坐标导致穿透误判。
- **桌宠气泡导致窗口尺寸震荡与遮挡**：自动内容尺寸同步改为上报内容包围盒与视频锚点，主进程按锚点扩缩窗口并在触及屏幕工作区边界时下发内容偏移补偿，避免气泡 DOM 插入、文字布局和窗口 resize 互相触发造成尺寸震荡；气泡默认贴在按所有动作平均显示尺寸计算出的参考圆上沿，避免动作切换时随不同视频尺寸上下跳动，顶部空间不足时自动翻到参考圆下方，同时保留气泡需要更多空间时自动扩窗、消失后自动收回的能力。
- **知识库无限加工 + 后台进程不释放**：加工轮 `runKnowledgeRound` 收尾新增止损对账——本轮正常完成（非中止）时调 `knowledge.reconcileRoundFailures`，据「wiki 是否真出现该文件 hash」统计成败，连续失败达阈值的文件被隔离，下一轮不再自动重加工，杜绝同样几个文件每 N 分钟反复空转（连带反复 spawn 不可回收的 OCR 子进程累积到数百个拖垮应用）。根因与子进程回收修复见 `@vetta/coding-agent`。
- **桌宠窗口拖动在 Windows/DPI 缩放下出现鼠标与窗口漂移**：拖动窗口不再把 renderer `PointerEvent.screenX/screenY` 增量直接传给主进程，而是在主进程记录拖动起点并用 Electron `screen.getCursorScreenPoint()` 计算窗口位置，避免 renderer 坐标与 `BrowserWindow.setPosition()` 坐标系比例不一致。
- **知识库加工选用自定义模型时报 "No model selected" / 切换模型无效**：加工轮 `runProcessingBatch` 起会话时 `createAgentSession` 未传 `modelRegistry`，SDK 便新建一个不含 `models.json` 路径的临时 registry，导致 `models.json` 里的自定义 provider/模型解析不到——`applyProcessingModel` 的 `find()` 落空后仅静默 `warn`，会话退回默认/空模型，最终以 "No model selected" 收场；用户在设置里怎么切换加工模型都作用在这个坏 registry 上，「像没切一样」。改为复用 `runtime.ts` 的进程级共享 `getOrCreateSharedModelRegistry()`（与主对话一致，已加载 models.json + 远程模型），并把 `applyProcessingModel` 的解析失败从静默 `warn` 改为抛错，使失败在 scan-now 结果里以「整理失败」明示原因，不再隐身。仅用内置 provider 的机器不受影响，故此前表现为「有的电脑正常、有的报错」。
- **普通项目会话被误标成 `conversation` 场景，导致 `scope_use: ["project"]` 永不命中**：`useSessionManager` 创建/重开会话时按 `sessionKind` 推导场景，普通项目走 `sessionKind = "conversation"` → 主进程 `isConversation` 为真 → 场景被标成 `"conversation"`。改为在渲染端显式下发场景（不改 `kind`，避免牵动 VETTA_CLI/子目录行为）：默认「对话」项目（cwd 归一到 `defaultConversationCwd`）→ `"conversation"`，批量 → `"batch"`，其余交互式项目 → `"project"`。影响面安全：所有含 `"conversation"` 的内置工具均同时含 `"project"`，翻转不会让任何工具从项目里消失。修复后仅声明 `["project"]` 的插件活动面板标签卡（如内置 Git 插件）才会在普通项目里出现。
- **桌宠通宵持续解码导致内存与 CPU 累积**：桌宠是透明置顶窗口，24/7 连续解码+合成 loop 视频；在 macOS（尤其 Retina 高 DPI）上持续解码会让 renderer/合成层 native 内存随时长累积（无人值守跑一整晚可达数 GB），并常驻高 CPU、视频转卡（Windows 因解码/合成路径不同不受影响）。新增系统空闲守卫（`pet/pet-idle-guard.ts`）：`powerMonitor` 检测锁屏/休眠即时暂停、解锁/唤醒即时恢复，并每 30s 轮询 `getSystemIdleTime`，无输入达 3 分钟即暂停桌宠视频、有操作即恢复。暂停期间同时停掉 autoMode 自动切换，彻底停止解码累积。新增 `set-playback` 桌宠命令与渲染端 `<video>` 暂停/恢复控制。

### Breaking Changes

- **桌面「对话」与 IM-gateway 物理分家（ADR-0005）**：im-gateway sidecar 启动时下发的 `conversationCwd` 由 `~/.vetta/conversation` 改为独立的 `~/.vetta/im-gateway/conversation/`，桌面「对话」cwd 不变。两边 sessions/产物互不可见，避免互相窜味，也为未来 Claw 独立加记忆/profile 解耦。配套移除 `SessionHeader.origin` 字段、`runtime-core` `SessionHistoryInfo.origin`、preload `openViewer` / `subscribeViewer` 返回的 `origin` 字段、`window.vetta.config.get()` 的 `DesktopConfigSnapshot` 新增 `defaultImConversationCwd`。renderer 侧 `SessionInfo.origin` 字段下线，Claw tab / SessionViewer / 「清空 Claw 记录」全部改为按 `session.cwd === defaultImConversationCwdAtom` 判定。「清空 Claw 记录」实际清的是 `~/.vetta/im-gateway/conversation/` 整目录（jsonl + 产物），「清空对话」对应桌面 cwd 全清；分家后两个 scope 都不再做 origin 过滤。`useProjects.refreshProjects` 启动时额外调用 `loadSessions(imCwd)`，把 IM session 列表跟普通项目一并加载到 `sessionsMap`。session-list / clear-default-conversation 主进程 IPC 同步识别 IM cwd 并注入对应 `sessionDir`（`<cwd>/.vetta/sessions`）。

- **批量任务状态模型简化为 4 态、项目级控制按钮重做**：`BatchTaskStatus` 联合类型移除 `"paused"`，新模型仅保留 `pending / running / completed / failed`（UI 上 pending+queued 仍展示为「等待中」，pending+无 session 展示为「未执行」）。`BatchProject.pausedAt` 字段、调度器 `pausedProjects` 集合、`pauseProjectScheduling` / `resumeProjectScheduling`、project 级 paused/resumed 事件全部下线。项目 banner 仅保留两个执行控制按钮——「开始 / 停止」合二为一的 toggle（队列活动态即 `running > 0` 或存在 queued 任务时显示「停止」并执行 abort + 清非已完成；空闲态显示「开始」，按并发把所有未执行入队，无未执行时 disabled），以及独立的「重置」（删全部 session 包括已完成重跑）；不再有「批量暂停 / 批量继续 / 批量重试失败下拉 / 清空队列状态」。单任务 hover 操作移除「暂停 / 继续」，仅保留「执行 / 重试 / 取消等待 / 删除」。后端 IPC `BATCH_PAUSE` / `BATCH_RESUME` / `PAUSE_TASK` / `RESUME_TASK` / `BATCH_RETRY_FAILED` / `BATCH_CLEAR_FAILED_AND_RETRY` / `BATCH_CLEAR_FAILED` / `BATCH_RUN_NEVER_EXECUTED` / `BATCH_RESTART_ALL` / `BATCH_CLEAR_UNFINISHED` 通道全部删除，对应 preload API（`batchPause` / `batchResume` / `pauseTask` / `resumeTask` / `batchRetryFailed` / `batchClearFailedAndRetry` / `batchClearFailed` / `batchRunNeverExecuted` / `batchRestartAll` / `batchClearUnfinished`）一并下线；新增 `BATCH_START` / `BATCH_STOP` / `BATCH_RESET` / `STOP_TASK` 通道，对应 `batchStart` / `batchStop` / `batchReset` / `stopTask`。executor 的 `pauseTask` 重命名为 `abortTask`（不再写持久化状态），停止流由 IPC 层 `cleanTaskFilesAndState` 统一收尾。`task.paused` / `task.resumed` / `project.paused` / `project.resumed` 事件类型从 `BatchTaskEvent` 联合中删除，renderer hook 不再监听。`.vetta/meta.json` 的 `pausedAt` 字段在 `readProjectMeta` 中静默剥离；`.vetta/task-states.json` 中 `status === "paused"` 的子任务在 `loadProjectTaskStates` 中静默迁移为 `pending`。详情页 `BatchQueueStatus` 也同步重构：移除 `isQueuePaused` 横幅 / 单任务 pause/resume 按钮 / 「暂停队列 / 继续 / 重试失败」按钮，对齐 banner 的「开始 / 停止 / 重置」三键模式。webhook 通知模板 `STATUS_ROWS` 与 `isProjectFinished` 删除 paused 行/分支。

### Removed

- **移除 Vetta Zen（按需付费/积分制）会员卡与积分体系**（配合后端 ADR-0038，网关塌缩为单一 Vetta Go Token Plan）：账户设置的会员卡区删除 `VettaZenCard`、积分余额与交易记录展示，只保留 Vetta Go 卡；`SubscriptionStatus.zen_enabled` 下线，模型清单只识别 `vetta-go` provider。连带删除积分 API 链路：渲染层 `fetchCreditsBalance`/`fetchCreditTransactions`/`CreditTransactionVO`、`creditsBalanceAtom`/`creditsUnlimitedAtom`、账户设置的交易记录 section，主/预加载层 `DesktopCreditsApi`、`vetta:credits:balance` IPC handler 及相关 preload wiring。
- **移除「产物列表」面板（ArtifactCard）**：删除消息列表底部基于启发式推断的产物面板及其全部支撑代码——`ArtifactCard` 组件、`turnModifiedFilesAtom`、`chat-service` 的 `extractModifiedFiles` 及其 shell 重定向 / result 文本扫描等 helper、`useSessionManager` 的相关写入。旧实现靠扫工具调用文本猜测产出文件，既漏掉真实成品（如 node 脚本写的 .pptx）又捞进中间脚手架（解包的 XML、临时文件）和纯文本误命中。改由：git 项目走新的插件 turn 卡（真相来自 `git status`），非 git 项目靠 agent 在完成总结里用 md 链接列出成品（系统提示词约束，见 `@vetta/coding-agent`），点击 md 链接即可预览。

### Changed

- **`vetta action --help` 渐进式披露**：帮助文案只说明 search → describe → run 工作流与能力域清单，不内嵌全量参数；权威目录与 schema 仍通过 `search` / `describe` / `*.query help` 获取。
- **Action 搜索相关性**：`actions.search` 不再对 id/title/summary 做整串 substring 过滤。改为分词、同义词扩展、多字段加权（含 `keywords`、inputSchema/operations/examples），并按相关度排序；空查询仍返回全部。各 Action 补充 `keywords` 别名。
- **扩展域 manage Action 审批 UI（对齐 scheduler 拆分）**：models / mcp / skills / projects / settings / knowledge / plugins / im / webhook / downloads / updater 的写操作按 **operation 独立 presentation**（如 `mcp.upsert`、`models.remove-provider`），schema 为每种 operation 默认对应 `approvalUi`；renderer 在 `action-approval/manage/<domain>/` 下一 operation 一组件（禁止 god component）。外壳共用 batch 风格 Frame；可编辑操作为右侧抽屉并回写 input，确认/删除为 Dialog；`generic` 仅兜底。

### Changed

- **Action 审批前实体存在校验（`assertReady`）**：runtime 在 `validateInput` 之后、授权弹窗之前执行可选 `assertReady`；用户改写 input 后再校验一次。编辑/删除/改状态引用不存在实体时抛 `ACTION_NOT_FOUND`，不再弹出授权框。已接入 mcp / models / skills / plugins / webhook / downloads / projects / knowledge / scheduler / batch-tasks / im（模型）/ appearance.themeId / navigation.open。创建类 operation 不要求实体已存在。
- **assertReady 错误文案面向 Agent**：`throwAgentEntityNotFound` / `throwAgentInvalidInput` 明确「审批未展示」、错误字段与取值、应调用的 query/示例 input/结果字段路径，并尽量附带 `availableIds`，避免 agent 编造 id 或误以为用户拒绝。
- **Action 授权弹窗可读性与可编辑性（对齐 user-facing-copy）**：共享外壳不再展示 `domain.write` 等权限码，改为说明「为何需要确认」；Generic 兜底去掉主路径 raw JSON，改为字段摘要 + 影响说明 + 可折叠技术详情；`settings` 执行权限/实验功能/知识库设置支持确认前改选或改表单；导航目标/设置分区走产品名映射；取消下载展示文件名与状态；解析失败时 `ApprovalRawFallback` 默认收起技术详情。
- **授权弹窗开/关歧义消除 + 设置层级 + 复用设置页控件**：`set-enabled` / 通知类审批改用「将改为：开启|关闭」主意图卡（可切换后再确认），标题/摘要/按钮/影响文案按方向拆分；实验功能与知识库设置用设置页式分组+行（标题/说明/控件）；默认模型与 Claw 模型复用 `ModelSelect`（含推理档），避免手填 provider/modelId。

### Added

- **设置页 AI 协助配置入口**：MCP、模型、知识库、Claw、消息推送、外观、插件、桌宠、应用环境、快捷键、Agent 配置等页标题区增加「让 AI 协助配置」按钮；点击后弹出意图输入（含示例 chips），确认后在默认对话目录新建会话并发送带页面上下文的 starter prompt，由 Agent 经 `vetta action` 协助配置（写操作仍走既有审批）。
- **`appearance.theme` 覆盖外观设置页鼠标指针**：`set`/`get`/`help` 增加 `cursorStyle`（`default` | `stoat`），与显示模式、主题风格同属一个 Action；审批 UI（theme-change / picker）可一并选择指针样式；经既有 theme IPC 写入 `vetta-cursor-style`，桌宠通过 storage 事件跟随。
- **扩展 App Actions 覆盖面（中高优先级）**：新增 models / mcp / skills / projects / settings / knowledge / plugins / im / webhook / downloads / updater 等域的 query+manage Action，经 `vetta action` 操作 Desktop 能力；写操作走领域专用审批 UI（可回退 generic）；密钥字段在查询结果中脱敏。市场技能安装与 Flowing 远端流转仍走 GUI。
- **主题自有数据存储（Theme Storage）**：主题可通过 `@vetta/theme-sdk/storage` 的 `useThemeStorage` / `useThemeStorageValue` 持久化自身 KV 数据；desktop-app 经 `ThemeHost.storage` 注入实现，main 进程按 `themeId` 隔离写入 `~/.vetta/desktop-app/themes/<themeId>/data.json`（单主题 ≤ 256KB，JSON only），preload 暴露 `vetta.themes.storage` 仅供 host 使用。主题不得直接访问 `localStorage` / `window.vetta`。详见 `docs/theme/storage.md`。
- **主题修为与应用使用绑定**：新增 `ThemeHost.usage`（`useThemeUsageStats`，数据源为 app-monitor）与 `ThemeModule.runtime` 无 UI 挂载点。内置 xianxia 将 app-monitor 多指标合成修为分并映射境界，写入 theme storage key `cultivation`（不绑定设置页 fanren 成就阶梯；暂无洞天 UI 消费）。
- **设置页使用行为统计**：应用监控新增 `settings.changed` 行为事件，设置页会按 tab、操作类型、设置项和安全枚举值聚合主题/语言、执行模式、Agent 实验能力、模型与 MCP 配置操作、IM/Webhook、快捷键/Appshot、知识库、桌宠、插件设置、归档项目、订阅刷新和运行时重装等主动配置行为，并维护最近与最多使用项；不保存昵称、自定义指令、工作区路径、provider/model/server 名称、URL、密钥、快捷键组合、Webhook 内容或项目路径。
- **账户页 Token 活动图**：设置 → 账户新增近一年 Token 用量方块活动图（每日 / 每周 / 累计），数据来自 `GET /usage/me/series?days=365`。
- **技能、场景与插件生命周期使用统计**：应用监控新增 `resource.lifecycle` 行为事件，技能/场景安装、更新、卸载、启用/停用、自定义导入，以及插件安装、更新、卸载、启用/停用、重载、权限授权/撤销、命令授权/撤销成功后会按资源类型、来源、操作、资源 id 聚合到 `app-monitor.json`，并维护最近操作与最多操作快照；权限和命令仅记录变化数量，不保存具体权限名、命令名、包路径或文件内容。
- **输入附件行为事件统计**：应用监控新增通用 renderer → main 行为事件入口，输入框通过 @ 面板、文件选择、图片选择、拖放和粘贴添加附件时会上报去隐私的聚合元数据；发送消息时也会记录本轮实际使用的文件、图片、scene 与 skill。主进程按来源、文件扩展名、图片格式、总大小、图片最大/最小尺寸数值、scene/skill 类型、名称、使用次数、最近使用与最多使用项更新 `app-monitor.json`，不保存文件路径、文件名、base64、提示词或会话内容。
- **输入框底部 action 使用统计**：应用监控新增 `input.action.toggled` 与 `input.action.used` 事件，分别记录内置知识检索与插件 input action 的打开/关闭次数、发送消息时实际进入本轮请求的次数，并按 action 类型与 action id 聚合到 `app-monitor.json`，不记录按钮文案、metadata 内容、提示词或会话内容。
- **模型设置支持 Z.ai / 智谱 OpenAI Completions 扩展**：模型 API 类型下拉新增 `zai-openai-completions` 与 `zhipu-openai-completions`，用于 GLM OpenAI 兼容接口并配套自定义思考档位。
- **外观界面主题选择**：外观设置新增「默认主题 / 修仙主题」独立选择与预览，并将颜色主题明确限定为默认主题的配色设置；界面主题选择会持久化，默认使用标准界面。
- **可扩展 UI 主题包运行时**：新增独立主题构建、归档与 staging 流程；内置主题随应用进入 `Resources/system-themes`，远程主题从用户主题目录发现，两者通过相同 manifest、preload API、`vetta-theme://` 协议和 Module Federation loader 加载。Xianxia 作为首个内置主题包接入，desktop-app 不再静态依赖具体主题实现。
- **Appshot：全局手势捕获前台应用窗口为附件（macOS）**：默认关闭，在「设置 › 快捷键 › Appshot」开启并选择手势（同时按住左右 ⇧/⌘/⌥）。触发后捕获前台应用窗口的截图 PNG 与结构化文字（辅助功能 AX 优先、不足时 OCR 异步兜底），落盘后作为胶囊附件挂到主窗口输入框（可移除，发送时以 `@截图路径` / `@文本路径` 前缀随 prompt 引用，发送后自动清除）。renderer 侧新增 `appshotAttachmentAtom` / `focusInputRequestAtom`、App 常驻监听捕获/文本补齐/失败事件（失败走 toast），preload 新增 `window.vetta.appshot`（`reloadGesture` / `onCaptured` / `onTextUpdated` / `onCaptureError`）；权限管理页新增「屏幕录制」项（`PermissionKind` 扩展 `screen-recording`）。
- **Appshot 独立为 Vetta Computer Use 授权引导**：Appshot 的截图/辅助功能捕获改由独立 helper 应用「Vetta Computer Use」承担（独立 TCC 主体，系统权限列表单独显示）。新增授权引导窗（拖拽 helper 到系统设置列表 + 一键跳转权限面板 + 实时权限状态），设置页开启 Appshot 开关时若权限不足自动弹出引导窗（原先仅 toast 提示）。preload 新增 `window.vetta.appshot.openOnboarding()`。「设置 › 快捷键 › Appshot」入口仅在 macOS 显示。
- **插件 turn 卡槽位（消息列表底部）**：新增 `ui.slot.turn-card` 的宿主侧实现——`plugin-loader` 的 `registerTurnCard`、`pluginTurnCardsAtom`、`PluginGlobalSlotHost` 发布、以及挂在 `MessageList` footer 的新组件 `PluginTurnCardHost`（按 `scope_use` fail-closed 过滤，渲染各插件的零 props turn 卡组件）。卡片不绑定 tool 调用，可见性由插件组件自身决定。内置 Git 插件据此在 git 项目里、一轮 agent 结束后显示「本轮变更卡」：turn-start 抓 `git status` 基线、turn-end 只列相对基线的本轮变更（不是全部未提交文件），列全、最多 10 项、超出折叠为「查看所有变更」，点击任意行打开 Git 活动面板看完整 diff。
- **桌宠装饰素材展示恢复**：设置页重新提供「桌宠装饰」分区，展示主进程注册的装饰素材缩略图与可用/缺失状态；气泡样式移动到独立「气泡样式」分区。
- **快捷面板背景接入 macOS 原生玻璃（ADR-0036）**：面板背景改用原生玻璃——macOS 26+ (Tahoe) 为液态玻璃，更低版本经 `electron-liquid-glass` 自动回退为磨砂玻璃（legacy `NSVisualEffectView`），非 macOS 退回原不透明卡片。玻璃绘制在 web 内容之下，主进程依平台/`isGlassSupported()` 判定后经新增 `ON_GLASS` 通道下发 `liquid`/`frosted`/`none`，渲染层据此把卡片背景置透明、去边框与阴影。该库为 darwin-only 原生模块，主进程用 `createRequire` 仅在 macOS 上按需加载，避免 Windows/Linux 跨平台包顶层 import 即崩。同步：列表去掉滚动条、改用上/下边缘渐隐遮罩提示可滚动；选中/悬停高亮由实心深色块改为半透明前景叠加以贴合玻璃。打包侧补齐 `uiohook-napi`（全平台）与 `electron-liquid-glass`（darwin-only）的 staging 复制与 `asarUnpack`。
- **快捷面板（Quick Panel）主进程信号与 IPC**：新增 `main/ipc/quickpanel.ts`（`registerQuickPanelIpc` + `GET_CONFIG` / `LIST_RECENT` / `CREATE_CONVERSATION` / `OPEN_SESSION` / `HIDE` / `RELOAD_HOTKEY` 处理器）。呼出方式为**双击功能键**（`quickPanel.trigger`：none/⌘·Ctrl/⌥·Alt/⇧），由新增 `main/quickpanel-trigger.ts` 经 `uiohook-napi` 原生全局键盘监听检测「干净双击」（两次点按 ≤350ms）唤出，默认 `none` 不监听、零开销不申请权限；macOS 需「输入监控」授权（见 ADR-0035，推翻 ADR-0034 的全局组合键方案）。`session.ts` 新增 `vetta:session:pending-question-changed` 通道与模块级「待答 sessionPath 集合」：`ask_user_question` 请求/响应时按 `runtime.getSessionPath` 解析路径并向所有窗口广播 `{ sessionPath, hasPendingQuestion }`；`RUNNING_CHANGED` 在保留主窗口投递的同时并行广播给其它窗口，使独立的快捷面板窗口也能跟随运行态与「待答」态。`LIST_RECENT` 透出会话末条消息预览（`SessionHistoryInfo.lastMessagePreview`）。
- **知识库「加工失败」态 + 「重试失败」**：文件加工态新增第 4 态 `failed`（`getKnowledgeFileStatuses` 据 `failures.json` 的隔离记录推导，文件列表显示红色错误角标 `kbBadgeFailed`），让连续加工失败被隔离的文件不再静默显示成「未加工」。知识库设置页「整理操作」新增「重试失败」按钮：清除全部失败/隔离记录（解除暂停）并立即重新整理一轮——供用户修好文件或想再试时手动触发。新增 `window.vetta.knowledge.retryFailed()` 预载 API 与 `vetta:kb:retry-failed` IPC（主进程 `retryFailedKnowledge` 经 `runKnowledgeMaintenance` 互斥执行）。
- **本地应用使用统计**：主进程按前台活跃、前台不活跃和后台三类累计使用时长，前台连续两分钟无键盘、鼠标、触摸或滚轮操作后转为不活跃；同步汇总会话、工具调用、批量任务、自动化任务、Token、上下文压缩和错误计数。统计只保存在 `~/.vetta/app-monitor.json`，每两分钟异步原子写入，退出时尽力落盘，采集或写入失败仅记录日志且不影响正常功能。
- **九阶段成就页面**：设置页新增「成就」入口，以横向吸附轨道展示九枚阶段徽章；支持无惯性拖动、滚动与前后按钮查看，当前成就放大着色、未达成成就缩小灰化，并展示所选成就的名称与意义。
- **自定义鼠标样式**：renderer 全局接入自定义 cursor 素材，并覆盖常见 Tailwind `cursor-*` 工具类与基础交互元素，保证默认、点击、悬停、加载、文本、移动、禁用和 resize 状态使用统一鼠标样式。
- **插件系统接入 i18n（ADR-0033）**：插件（系统/外置）面向用户的文案现可跟随宿主语言切换。承载方式为 NLS `%key%` 占位符 + 插件包内 sidecar `locales/<lang>.json`：宿主 main 解析 manifest 时一次读齐全部语言的 catalog，随 `InstalledPlugin`（新增 `defaultLocale` / `locales` 字段）下发到 renderer，manifest 与运行期组件共用同一套。宿主渲染的插件串（插件名/描述/设置项 title·description/guidingWords、`ctx.ui.register*` 的 `label`、卡片 title）经新增的 `usePluginI18n` / `usePluginTextResolver` 响应式解析 `%key%`（非 `%key%` 即字面量、向后兼容）；插件自己 React 组件内文字走 SDK `useTranslation()`，由各渲染点包裹的 `PluginI18nBoundary`（`__PluginI18nContext`）按 plugin id 提供对应 catalog。语言切换全程实时、无需 reload。fallback 链：当前 locale → 插件 `defaultLocale`（缺省 zh）→ 裸 key。`%key%` shim 导出（`useTranslation` / `resolvePluginText` 等）已纳入 `vetta-host://plugin-sdk`；plugin-vite 打包随包带上 `locales/`。内置 preset 插件（git / image-gen / media-viewer / office-viewer / svg-viewer / guiding-words / demo-map）已迁移为 zh/en 双语。**排除** agent 面向串（tool description / systemPrompt / skills，与 ADR-0031 一致）。
- **插件命令执行能力 + 内置 Git 系统插件**：打通 `ctx.command.run`——renderer `createCommandApi`（门控 `agent.command.run` + 声明/授权校验）→ preload `plugins.runCommand` → 主进程 `command-runner.ts` 用 `execFile`（shell=false、30s/120s 超时、10MB 缓冲、env 合并 `process.env`）执行。`plugin.json` 顶层新增 `commands: string[]`（二进制名）声明，存进 `InstalledPlugin.declaredCommands` / `grantedCommandNames`（用户插件入注册表、系统插件入 `system-plugin-prefs.json` 的 `disabledCommands`）；插件设置页新增「可执行命令」逐条开关（系统插件亦可关），被关命令调用时拦截并弹全局 toast 通知用户。新增 `window.vetta.plugins` 的 `grantCommands` / `revokeCommands` / `runCommand` 与 `vetta:plugins:grant-commands` / `revoke-commands` / `command-run` IPC。新增 `git` 系统插件：project 对话的活动面板出现「Git」标签卡，展示 `git status` 变更文件树（M/A/D/R/U + 文件夹后代圆点）、点击文件内联展开 diff（自包含 unified-diff 渲染器）、非 Git 项目一键 `git init`；刷新走 turn-end + 窗口聚焦 + 手动。详见 `docs/adr/0032`。
- **全局 Toast 基建**：新增 `shared/store/toast-atoms.ts`（`showToast` / `dismissToast`，可在任意 .ts/组件外命令式调用）与挂在 App 根的 `shared/components/ui/Toaster.tsx`（info/success/warning/error 四态、可带单个动作按钮），供命令拦截通知等场景复用。
- **一键导出诊断包**：「常规」设置页开发者段新增「导出诊断包」按钮，把最近日志文件（各 type 取最新若干、受 20MB 预算约束）+ 内存 ring buffer 序列化的 NDJSON（含递归 `error.cause` 链与 `code/errno/address/port`）+ 系统信息打包为 zip，落到临时目录并在文件管理器中定位；异步压缩（`writeZipPromise`）不阻塞主进程，导出失败弹错误提示。新增 `window.vetta.diagnostics`（`exportDiagnosticsPackage` / `getLogDir`）预载 API 与 `vetta:diagnostics:export` / `vetta:diagnostics:get-log-dir` IPC。
- **会话页插件插槽按对话类型显隐（scope_use）**：活动面板的插件标签卡（`registerActivityTab`）与 AI 输入栏的插件 toggle（`registerInputAction`）现按各自贡献的 `scope_use` 随当前对话类型显示/隐藏，与工具 `scope_use` 同一套场景轴。会话场景经 `RuntimeHost.getState` 的 `SessionStateSnapshot.scenario` 从主进程透出，写入渲染端 `currentScenarioAtom`，`ActivityPanel` 与 `InputActionBar` 据此 **fail-closed** 过滤（未声明 `scope_use` 或场景未知一律不显示；输入栏 toggle 再与 `requiresActiveTool` 取「与」）。内置 `image-gen` / `demo-map` / `mobile-ui-preview` 插件已补声明 `scope_use`。
- **知识库「清空 wiki」与「删除 wiki」**：知识库设置页「整理操作」新增危险按钮「清空 wiki」——删除全部已整理的 wiki 产物及加工记录（processing_records 下的整理 session；影响所有知识库，原始资料保留）并重建空索引，确认弹窗提示清空后下一轮会重整理全部资料、可能耗费较多额度。侧边栏知识库文件列表的右键菜单（单项「查看 wiki」下方新增「删除 wiki」，仅已加工文件可见）与多选右键菜单（新增「删除选中 N 项的 wiki」）支持删除选中原始文件已整理出的 wiki 页，删后该文件回到未加工态，下一轮重新整理。新增 `window.vetta.knowledge.clearWiki()` / `deleteWiki(kbId, relPaths)` 预载 API 与 `vetta:kb:clear-wiki` / `vetta:kb:delete-wiki` IPC；主进程 `main/knowledge/wiki-ops.ts` 实现删 wiki 物理文件 + `pruneEmptyWikiDirs` + `rebuildAllCaches`，全部经新增的 `runKnowledgeMaintenance` 持「同一时刻只跑一轮」互斥锁执行，与后台加工轮互斥、避免写 wiki/重建缓存竞态（加工进行中触发会先立即中止在跑的加工轮再独占执行）。
- **内置 Office 文件预览插件**：新增轻量、离线的 `office-viewer` 系统插件。PDF 使用 Mozilla PDF.js 按页渲染，DOCX 使用长期维护的 docx-preview，XLS/XLSX/XLSM/XLSB/ODS 使用 SheetJS CE 解析并交由自研虚拟表格渲染；文件内容通过 Range-capable URL 读取，不再经 renderer IPC Base64 全量复制。PPT/PPTX 因暂无符合长期维护要求的轻量纯本地渲染器，插件内明确展示兼容性说明，不引入短期项目做近似渲染。
- **插件 Agent 自动续跑策略**：Plugin SDK 新增 `ctx.agent.registerContinuationProvider()` 与 `agent.continuation.register` 权限；Desktop 打通 renderer handler、preload/IPC、主进程贡献聚合和 RuntimeHost 调用链。插件可在 Agent 自然停止点返回后续指令继续当前循环，宿主提供超时、幂等去重、异常隔离和循环次数上限。
- **知识库页面 UI（磁盘为唯一真相源）**：侧边栏知识库页面改为直接以磁盘 `~/.vetta/knowledges/raws/` 为唯一真相源——每个顶层目录即一个独立知识库，库内文件约定平级但允许子目录。废弃原 localStorage 原型数据源与「描述」字段，知识库的 id/名称取目录名、更新时间取目录 mtime，全部从文件系统派生。文件列表改为 Mac Finder 风格宫格 + 面包屑（双击进子目录、面包屑回退），点击文件统一走全局文件预览灯箱（复用应用既有的代码/Markdown/图片/PDF/HTML/Docx/音频及插件预览），移除原内嵌分屏预览与目录树，并去掉内容卡片外边框。支持反向重建：手动刷新按钮或重新进入页面即从磁盘重读，用户在 Finder 手动增删改也随之重建到 UI。导入去掉「智能整理预览」，改为平铺复制进目标库（同名自动改名 `file (1).ext` 共存）。新增 `window.vetta.knowledge` 读写 API（`list`/`addFiles`/`deleteEntry`/`renameEntry`/`create`/`delete`/`rename`）：写盘走主进程特权互斥写（`raws-fs.ts` + `raws-lock.ts` 的 `privilegedWrite`），与后台加工的 raws 只读锁共用一把进程内互斥锁——加工进行中 UI 写盘仍恒成功（临时放开目标目录写位、写后按锁态恢复，新文件下一轮重建），既不阻塞用户也不让 agent 趁机污染 raws。`addFiles` 支持 move（应用内产物移走）/copy（外部文件留源），为未来「右键移动到知识库」等多入口复用。
- **完整会话导出为桌面同款交互 HTML**：聊天页标题栏新增 HTML 导出入口，使用非虚拟化离屏列表复用桌面端用户消息、Markdown、思考过程、工具调用、工具结果与插件消息卡片组件，避免 Virtuoso 只序列化可视区。导出文件内嵌当前主题 CSS 和可读取图片，回答过程、工具组、思考及工具结果保持默认折叠，并由文件内轻量脚本提供离线展开/收起交互。
- **知识库后台加工 + 「知识库设置」页**：新增惰性轮询器（`main/knowledge/poller.ts`，基于 `toad-scheduler` SimpleIntervalJob），按设置每 3/5/10/30 分钟对 `~/.vetta/knowledges/raws/` 算 diff，攒批后起一个加工 agent 会话（落在新特殊项目 `~/.vetta/knowledges/processing_records`，会话 jsonl 自包含在其 `.vetta/sessions`，并虚拟注入侧边栏「知识库加工」项目供回看），moved 纯元数据更新、删除走 n+1 孤儿回收。会话经 `createAgentSession` 注入 `kb_write_page`/`filter_by_tags` 工具与加工约定 prompt。`DesktopConfig`/`DesktopConfigSnapshot` 新增 `knowledgeBase`（`enabled`/`pollIntervalMinutes`/`processingModelKey`）与 `knowledgeProcessingCwd`；`session.ts` 的 `resolveSessionDirForCwd` 识别 KB 加工 cwd。新增设置页「知识库设置」（开关 / 轮询间隔 / 加工模型 / 立即扫描 / 重建索引）与 `window.vetta.knowledge` 预载 API（`scanNow`/`rebuildIndex`/`reload`）。
- **消息卡片改为「声明式描述符 + 按 type 动态渲染器注册表」（ADR-0030）**：插件 message slot 体系反转——旧的「每条消息 mount 全部 slot、各自 `null` 自隐」改为「host 持有每条消息的卡片描述符列表、按 `type` 查渲染器注册表渲染」。`registerMessageSlot`/`pluginMessageSlotsAtom`/`PluginMessageSlotsHost` 下线，代之以 `registerCardRenderer`/`pluginCardRenderersAtom`/`MessageCardsHost`。卡片描述符走工具结果的 out-of-band `details.cards`（`chat-service` 新增 `extractToolCards`，接进 `handleToolEnd` 与两条历史加载路径；`ToolCallBlock` 新增 `cards` 字段，模型永不可见）；in-flight 骨架由渲染器的 `pendingFor` 对 pending tool_call 合成；host 按描述符 `key` 跨轮去重（一条 lineage 只在最新一轮出卡，复用原 `latestOwnerByRoot`）。新增 `MessageCards` 收纳 UI：同一条消息 ≥2 张卡片时上方出操作 area（左侧 tab 切卡、右侧「列表/收纳」切布局），收纳（tab）为基本形态、列表（平铺）为不持久化的临时形态；<2 张裸渲染。
- **插件引导词（guidingWords，ADR-0003）**：`plugin.json` 新增顶层声明式字段 `guidingWords?: string[]`，是插件第一个**声明式** UI 贡献——与命令式 `ctx.ui.register*` 不同，纯静态清单数据、无权限位、无运行时注册，随 `description` 同路径从 manifest 经 `parseManifest` 流入 `InstalledPlugin`（用户插件与系统插件两条安装路径均透传）。NewSessionPage 欢迎页新增读 `plugins.list()`，在技能徽章下方按插件**分组**展示已启用且声明了非空 `guidingWords` 的插件引导词（组标题取插件 `name`）。点击一条引导词即以其文本为 `overrideText` 走 `openSession → sendMessage` 立即发起一轮（不填入输入框、规避 atom 异步 stale read）。展示限额靠轮播：同时最多 3 组、每组最多 4 词；组超 3 则组级 12s 轮播、某组词超 4 则该组词级 3s 轮播，未超出则静态。
- **插件 Agent 工具执行通道**：插件可在 JS 中通过 `ctx.agent.registerTool()` 注册 TypeBox/JSON-Schema 工具 schema 和 handler；主进程按插件启用状态与 `agent.tools.register` / `agent.toolHandler.execute` 权限把工具注入会话，coding-agent 仅看到 tool shell，实际执行经 IPC 回到 renderer 插件 handler。插件激活会等待工具 schema 注册完成，注册/注销/权限或启停变化会刷新空闲的对话 session；新建对话 session 完成后会再同步一次插件配置，避免冷启动时插件注册刷新早于 session 入表导致首个会话漏掉插件工具；首次发送 prompt 前会等待插件宿主完成首次加载，避免冷启动时第一轮 agent 上下文缺少插件工具；未授权的插件贡献注册会被独立跳过，避免一个缺失权限拖垮插件的其他已授权能力。同步暴露受权限门控的 `ctx.fs` 文件 API（`fs.read` / `fs.write`），供插件 UI 与插件工具 handler 读写项目文件。
- 新增 `[plugin-agent]` 调试日志，覆盖插件宿主加载、动态工具注册、主进程权限过滤、runtime 同步、session 创建/发送 prompt 时的插件工具快照，便于定位插件工具偶发未进入 agent 上下文的问题。
- 插件动态 Agent 工具注册新增加载代次隔离：每次插件加载都会分配 `activationId`，main 进程会忽略过期加载实例的注册、注销和清理请求，避免旧实例 dispose 晚到时把新实例刚注册的 tool 从 agent 上下文中清掉。
- **插件设置项条件显隐 + 标准化渲染 + `desc` 说明项**：`PluginSettingSchema` 新增 `visibleWhen`（`{ key, in }`，按另一设置项的当前值决定本项是否显示）与 `desc` 类型（只读说明项，不存值，渲染 `description` 文本并把其中的 http(s) 链接变为可点外链；`title` 对 `desc` 可选）；plugin-store 解析并透传。插件设置页改用通用 `SettingSection` / `SettingRow` 渲染——每个插件一个独立 Section，每个设置项与其它设置页样式一致，并按 `visibleWhen` 过滤。
- **图像生成插件按服务商配置**：image-gen 服务商扩展为 `openai` / `agnes-ai` / `custom`。`openai`（`https://api.openai.com/v1`）与 `agnes-ai`（`https://apihub.agnes-ai.com/v1`）的接口地址内置固定，仅需填 API Key 并从模型下拉中选择（`openaiModel` / `agnesModel`，目前各一个选项，后续可扩充）；`custom` 显示并要求填写 `baseUrl` / `model`（标准 OpenAI v1 图像生成格式）。API Key 按服务商独立存储（`openaiApiKey` / `agnesApiKey` / `customApiKey`，各自 `visibleWhen`），切换服务商互不覆盖。移除 `size` 设置项——输出尺寸改由 agent 经 `generate_image` 工具的 `size` 参数（自由格式，缺省 `1024x1024`）决定并透传给主进程图像服务。
- **图像编辑收敛到 AI 输入栏（ADR-0029）**：删除图像生成插件的活动面板「图像编辑」选项卡，编辑统一从输入栏触发。消息下方预览改为横向版本 swiper（newest-first，超出可左右翻看），点某张图「编辑」icon 即把它 attach 为编辑目标——经新 SDK 方法 `ui.setEditImageAttachment` 在输入栏顶部胶囊区渲染缩略图胶囊，发送时 `useSessionManager` 注入 `metadata.editImageId`、清空（一次性）。主进程 `imageBackend` 新增 `edit`（转调既有 `editImage`），`generate_image` / `edit_image` 结果 marker 携带 `rootId`，`PluginMessageSlotsHost` 据此做编辑谱系去重（同一谱系只在最新一条消息出卡，旧卡自隐）并把 in-flight 编辑目标透传给生成中的卡（骨架置于 swiper 最前）。`PluginImageResult` 新增 `rootId`，`PluginEditImageInput` 新增可选 `size`。新增主进程 `sessionLineages(sessionId)` + IPC `vetta:plugins:images:session-lineages`，供 image-gen 的「生图历史」活动面板列出当前会话的所有编辑谱系（按会话文件名里的 UUID 匹配 sessionId）。
- **可信 UI 插件运行时**：新增桌面端插件系统基础设施，支持从本地 zip 或远程 zip 安装外部插件，读取 `plugin.json` 记录插件版本、`pluginApiVersion`、入口、样式和权限声明；主进程注册 `vetta-plugin://` 加载插件文件、`vetta-host://` 共享宿主 React / JSX runtime / plugin SDK，renderer 启动时加载已启用插件并渲染全局 slot。新增 `window.vetta.plugins` 管理 API（安装、卸载、启用、授权、撤权、手动 reload），插件更新只记录 pending 版本，不自动切换到新 UI。
- **设置页插件管理**：新增「插件」设置页，支持选择本地 zip 或填写远程 zip URL 安装插件，查看已安装插件，管理启用状态、权限授权、重载和卸载；设置页操作后会通知 renderer 插件宿主即时重新加载已启用插件。
- **插件 Module Federation 加载模式**：可信 UI 插件新增 `runtime: "module-federation"` manifest 格式，宿主通过 `@module-federation/enhanced/runtime` 动态注册 zip 插件 remote 并加载 expose，React / React DOM 由宿主作为 shared singleton 提供；原 `runtime: "esm"` 加载模式保留兼容。
- **插件开发包**：新增 `@vetta-org/plugin-sdk` 和 `@vetta-org/plugin-vite` workspace 包，分别提供插件生命周期/权限/global slot 类型契约与 Vite Module Federation 配置封装，示例插件不再依赖手写 `host-modules.d.ts` 类型垫片。
- **插件文件预览插槽（ui.slot.file-preview，ADR-0023）**：插件可经 `ctx.ui.registerFilePreview({ extensions, component })` 按文件扩展名贡献预览组件，挂进活动面板 `FilePreviewView`。优先级「仅补空白」——内置显式支持的扩展名插件抢不到，只有内置不认、本会掉进文本兜底的扩展名才查插件注册表，首个匹配胜。预览组件首次接收 props `{ path, name, extension, mime, size }` + 内容访问器 `readText() / readBytes() / getUrl()`（宿主不预读/猜编码，内容访问免额外权限）。配套把 `svg` 从内置图片预览集移出，交由新增的 `svg-viewer` 示例插件接管。新增权限位 `ui.slot.file-preview`。
- **对话插件 API（agent.session.read / write，ADR-0023）**：插件可在 agent 对话场景读状态、监听事件、发起/驾驶对话。`@vetta-org/plugin-sdk` 导出 hook `useActiveConversation()` / `useConversationMessages()`（读宿主 jotai store、自动 rerender）；`ctx.conversation.on(event, cb)` 推送实时事件（turn-start/turn-end、message-added/updated、tool-call-start/end、conversation-changed）；`ctx.conversation` 提供 `sendPrompt(text)`（复用完整发送路径、渲染为用户气泡）、`insertText(text)`（填输入框不发）、`abort()`。宿主经 `installPluginHostBridge` 把 store/actions 注入 plugin-sdk 内部 bridge，事件由一个独立的 `session.subscribe` 翻译器产出，不改动既有会话事件处理。
- **活动面板插件 tab（ui.slot.activity-tab，ADR-0026）**：插件可经 `ctx.ui.registerActivityTab({ id, label, icon?, component })` 注册活动面板 tab contribution（一个插件可注册多个，icon 为 React 节点而非 iconify class）。注册仅进入「可添加池」、不直接渲染——活动面板 tab 栏 hover 时右侧浮现"+"按钮，弹出勾选列表统一管理 attach/remove（attach 即切到该 tab；remove 当前激活的插件 tab 时回退 profile 默认 tab）。attach 记录以**会话 cwd** 为 key 持久化在 localStorage（`vetta-activity-plugin-tabs`）：普通项目所有 session 共享项目 cwd → attach 项目级同步；「对话」项目 per-session 子目录 cwd（ADR-0007）→ 天然按 session 隔离、零特判。渲染取「attach 记录 ∩ 已注册 contribution」交集——插件禁用 tab 即隐、重新启用自动回来，记录不联动删除。插件 tab 追加在所有内置 tab 之后、按 attach 顺序排列；面板组件零 props（会话上下文走对话插件 API hooks）；IM 会话查看器首期不支持。新增权限位 `ui.slot.activity-tab`。
- **静态文件协议 vetta-file://（ADR-0027）**：主进程新增通用静态文件协议 `vetta-file://local/<绝对路径>`——**pathname 承载路径**（区别于 `vetta-media://` 的 query 参数形态），HTML 内相对引用的 css/js/图片按所在目录天然解析正确；mime 按扩展名映射常见 web 资源、未知回退 octet-stream，路径校验复用 `assertPathReadableForPreview`（与 readFile/vetta-media 同一道预览沙箱）。凡需「整页带资源地预览项目内 HTML」走本协议。
- **活动面板插件 tab 的作用域出口 useActivityTab()**：plugin-sdk 新增 `useActivityTab()` hook（React Context，宿主 `PluginActivityTabPanel` 渲染插件组件时注入面板 cwd）。插件以此获知「自己被渲染在哪个 cwd 的面板里」，与 attach 作用域语义一致；不要用 `useActiveConversation().cwd` 代替——项目详情页的面板 cwd 与活动会话可能错位。
- **外置插件示例：移动UI预览（mobile-ui-preview）**：活动面板插件 tab 形态的外置示例插件（`packages/plugins/externals/mobile-ui-preview`，不随 App 打包，由用户自行安装）。在仿真移动设备边框（react-device-mockup：iPhone 灵动岛/刘海/Home键、Pixel/Galaxy、iPad、Android 平板共 8 个命名机型预设）内预览当前作用域的 HTML 页面：自绘 iOS/Android 两套仿真状态栏（实时时间+静态信号电量）、横竖屏切换、设备按逻辑分辨率渲染整体 scale 适配面板宽度。html/htm 候选按面板 cwd 递归列出（复用 listFilesRecursive 排除规则），iframe src 走 vetta-file:// 协议故相对资源可用；所选 html 所在目录变更自动刷新 + 手动刷新按钮。机型/横竖屏偏好全局记忆、所选 html 按 cwd 记忆；IM 会话查看器不提供。工具栏提供导出：「导出 PNG 渲染图」经新 IPC `vetta:window:capture-region`（`window.captureRegion`，主进程 capturePage 截取窗口指定区域 + 保存对话框落盘）输出设备渲染图；「生成工程化 Prompt」把"根据这个页面的html设计稿，转换成用于工程化的prompt：<文件路径>"insert 进 AI 输入栏（`agent.session.write`），由用户手动发送。
- **系统插件（ADR-0024）**：新增随 App 发布、用户不可删改的系统插件。源码放在 monorepo 的 `packages/plugins/presets/<id>/`，但不纳入根 workspace；`packages/plugins` 建立独立 workspace 和 `bun.lock`，presets 通过 `workspace:*` 直接使用仓库内的插件 SDK/构建包源码，并独立生成 `release/<id>-<version>.zip`。Desktop 的开发准备与打包阶段统一校验 zip 的路径、manifest、id/version、入口和样式后解压到 `system-plugins/<id>` staging，dev 不再直接读取 preset 源码 `dist`，打包从同一 zip 制品生成 `Resources/system-plugins/<id>/`。运行时从只读 staging 直服，**不**拷进 `~/.vetta`、**不**写 `plugins-manifest.json`。`InstalledPlugin.source` 新增 `"system"`，`listPlugins()` 运行时发现并与用户插件合并；id 冲突时系统插件优先、id 保留（用户装同 id 被拒、同 id 用户插件被遮蔽）；声明权限自动全量授予且不可撤；默认启用、用户可停用（偏好存 `~/.vetta/system-plugin-prefs.json`）但不可卸载/改文件/改权限；版本随 App。设置页对系统插件只读呈现（「系统」标、权限锁定、无卸载/重载）。首个系统插件：`svg-viewer`（由 `packages/plugins/svg-viewer` 迁入 `packages/plugins/presets/svg-viewer`）。
- **插件设置系统（VSCode 式）**：插件可在 `plugin.json` 声明 `contributes.settings`（每项 `key`/`type`/`title`/`description`/`default`/`enum`，含 `type:"secret"` 掩码），desktop 在「设置 → 插件设置」自动渲染统一表单。值按 plugin id 命名空间持久化在 `~/.vetta/plugin-settings.json`（schema 默认值与存储值合并），改动经 IPC 广播 `vetta:plugins:settings-changed` 实时同步。新增 `window.vetta.plugins.getSettings / setSettings / onSettingsChanged`，plugin-sdk 侧 `ctx.settings`（`get`/`getAll`/`onChange`）。
- **主进程图像服务 + 内置图像生成（ADR-0028）**：主进程新增图像 IPC 服务，读「图像生成」插件设置（baseUrl/apiKey/model/size）调用 OpenAI 兼容 `/v1/images`（生成/编辑），把图像字节按 session 落盘到 `~/.vetta/plugin-images/`、经 `vetta-media://` 提供（媒体协议补齐图片 MIME）、并维护编辑谱系索引。两条入口共用同一实现：agent 的 `generate_image` 工具（经 `RuntimeHostOptions.imageBackend` 注入）与插件面板的 `ctx.images`（`window.vetta.plugins.generateImage / editImage / imageLineage`）。`PromptRequest.metadata` 贯通到 agent 轮次以门控本轮是否走图像生成。
- **AI 输入栏动作插槽 + 消息下方插槽**：插件可经 `ctx.ui.registerInputAction` 在输入栏下方加 toggle（激活时 `decoratePrompt` 注入本轮 `PromptRequest.metadata`）、经 `ctx.ui.registerMessageSlot` 在每条消息下挂载组件（host 侧把该轮 `generate_image` 结果绑成 `imageRefs`），并经 `ctx.ui.openActivityTab` 主动打开自己的活动面板 tab。
- **系统插件：图像生成（image-gen）**：类 Grok 的文生图/图改图系统插件——输入栏「图像生成」开关（开启后下一条提示词生成图像）、消息下方预览卡（编辑/导出）、活动面板图像编辑选项卡（图改图 + 编辑谱系历史版本）。配置（endpoint/key/model/size）走插件设置。
- **适配通用 Agent Skill（ADR-0020）**：设置页「Agent配置 → 扩展功能」新增「适配通用 Agent Skill」开关（`experimental.agentSkills`，**缺省开**）。开启后会话层自动发现 `~/.agents/skills` 与项目 `<cwd>/.agents/skills` 下符合跨 Agent 约定的 Skill（仅子目录 `SKILL.md`），与 Vetta 自带技能并存、同名时 Vetta 自带优先；关闭时新建/打开的会话经 `SessionConfig.includeAgentSkills=false` 不再发现这些目录。聊天侧技能选择器（SlashPanel / SkillPromptArea）经 `vetta:skills:list` 跟随开关展示——`vetta:skills:list` 新增可选 `cwd` 参数，渲染端按当前会话/项目 cwd 传入，故既列全局 `~/.agents/skills` 也列当前项目的 `<cwd>/.agents/skills`（来源标签「通用」/「通用·项目」；该 cwd 同时让项目级 `<cwd>/.vetta/skills` 一并进选择器）。技能市场页（技能广场）也新增「通用 Agent Skill」**只读分区**，按当前 tab（技能/场景）类型分流展示全局 `~/.agents/skills`，带「通用/只读」标记、可预览 SKILL.md（`get-skill-md-path` 回退解析 `~/.agents/skills` 并放行其读取），但不提供安装/卸载/启停。这些项纯只读，不进市场托管管理。这两处目录在 coding-agent 侧一并纳入写保护（agent 只读、禁止新增/修改）。
- **输入预测（next prompt suggestions）**：agent 一轮回答正常完成（`agent_end`；中断/出错/待答提问均不触发）后，预测用户下一个可能输入的 0-3 条 prompt。生成复用 auto-title 同款轻量 LLM 调用（`completeSimple`，会话当前模型，取最近 ≤3 轮对话文本为上下文），不进主对话历史、失败静默降级。呈现两处：MessageList 下方、InputBar 上方垂直排列的建议气泡（点击即作为独立 prompt 直发，不带技能/@文件前缀）；首条建议同时作为 InputBar placeholder（`↵ ` 前缀），输入框为空时回车即按该建议发送。建议按会话 `runtimeId` 索引（`promptSuggestionsAtom`，纯内存态、不持久化）：该会话发出下一个 prompt 即清空、切会话保留、切回恢复；异步回填以「过期令牌」校验丢弃跨轮的陈旧结果。设置页「Agent配置 → 扩展功能」新增「输入预测」开关（`experimental.promptPrediction`，**缺省关**），仅交互式会话生效（批量任务与流转会话不适用）。新增 IPC `vetta:session:next-prompt-suggestions` 与 preload `session.nextPromptSuggestions`，runtime-core 新增 `RuntimeHost.nextPromptSuggestions`。
- **文件预览支持音频——黑胶播放器（ADR-0021）**：文件预览（侧栏分屏与全局 Dialog 共用的 `FilePreviewView`）新增音频分支，覆盖 Chromium 原生可解格式（mp3 / wav / ogg / flac / m4a / aac / opus / webm），其余音频格式维持「不支持 + 下载」。UI 为黑胶播放器：唱片旋转（rAF 物理加速起转 / 减速停盘）+ 唱臂起落动画（播放搭上、暂停抬起，仅状态动画不可交互）+ 频谱可视化（Web Audio AnalyserNode 驱动，随音乐跳动）+ 进度条拖拽 seek + 音量 / 静音 / 单曲循环 / 倍速（1→1.25→1.5→2→0.5→0.75 循环切换），打开不自动播放。唱片中心贴内嵌封面（ID3 APIC / FLAC picture，主进程 music-metadata 解析并连同标题 / 艺术家经新 IPC `vetta:media:audio-metadata` 返回），无封面降级纯 CSS 盘面 + 文件名。本地音频不走 readFile base64 全量 IPC（无损可达百 MB），改经主进程新注册的 `vetta-media://` 流式协议（支持 Range seek、复用 fs IPC 同一道路径沙箱校验、带 CORS 头供 AnalyserNode 取样）；远程 url 音频直接作 `<audio src>`，跨源读不到采样故频谱整块隐藏。新增 preload `media` 命名空间（`getAudioMetadata`）、新依赖 `music-metadata`。
- **后台任务可视化（run_in_background）**：agent 把耗时命令转入后台执行时，桌面端三处联动展示——(1) 右上角新增后台任务 badge：仅在有运行中任务时显示（蓝色旋转图标 + 数量），全部结束即消失，点击打开活动面板并切到「后台任务」tab；(2) 活动面板动态注入「后台任务」tab（当前 session 存在后台任务时出现，badge 为运行中数量），逐任务卡片展示状态/命令/时长/exit code 与实时滚动的输出尾部，已结束记录留存供追溯，顶部提供「清除已结束」一键清理（经新增 IPC `vetta:session:background-tasks-clear-finished` 落到主进程任务注册表，快照事件回流刷新 UI）；(3) chat 中发起任务的 bash 工具卡片按 toolCallId 关联后台任务快照，展开后实时滚动显示输出尾部与完成状态。数据链路复用现有 `vetta:session:event` 通道：runtime-core 新增 `background_tasks_update` 事件透传，renderer 新增 `background-tasks-atoms`（按 sessionId 隔离的全量快照）。**批量任务 session 禁用后台模式**（`enableBackgroundTasks: false`）：批量执行器按 session 结束判定子任务完成并调度并发队列，后台任务会让 agent 提前结束而进程仍在跑、完成通知凭空唤醒新 turn，干扰队列判定。**设置页「实验性功能」新增「后台任务」开关**（`experimental.backgroundTasks`，缺省开）：关闭后新打开的会话中 bash 拒绝 `run_in_background` 并回退同步执行、task_output/task_stop 不注册；批量任务不受开关影响始终禁用。
- **定时任务 App Actions**：新增 `scheduler.query`、`scheduler.task`、`scheduler.execution` 三个 Action，支持 Agent 查询任务与执行历史、创建/更新/删除/启停任务，以及立即执行和中止运行。IPC 与 Action 统一复用主进程 `SchedulerService`，任务读改写串行化避免并发覆盖，重复执行会被拒绝，外部写入与执行操作默认进入审批流程；Action 变更后自动通知 renderer 刷新任务和项目类型。
- **批量任务 App Actions**：新增 `batch-tasks.query`、`batch-tasks.project`、`batch-tasks.task`、`batch-tasks.execution` 四个 Action，覆盖现有批量项目查询/创建/更新/删除、单任务执行/重试/停止/删除/继续/删除会话，以及项目级开始/停止/重置/重置失败/删除任务等操作。IPC 与 Action 统一复用主进程 `BatchTaskService` 编排层，执行类 Action 提交命令后立即返回受影响任务和当前排队信息，agent 可继续通过查询 Action 获取进度；所有外部写操作默认进入通用审批流程。
- **Action 审批渲染管理中心**：renderer 新增无 UI 的全局审批中心，统一订阅主进程请求、按 FIFO 排队、去重并提交结果；每个 Action 可声明多个审批 UI、默认 UI 及用途说明，Agent 可在单次 Action 输入中通过可选 `approvalUi` 选择本次展示界面，省略时使用默认值。运行时只接受 Action 白名单内的 UI，目标 Presenter 未挂载时自动回退到通用审批弹窗。通用弹窗不再持有 IPC 订阅和队列状态，响应失败会保留当前请求并允许重试。
- **Action 审批超时自动关闭 UI**：主进程审批请求下发权威过期时间，并在超时 reject 时通知 renderer 清理对应审批；renderer 倒计时 hook 改为返回格式化文本、剩余秒数和超时状态，审批 UI 到期后自动关闭，避免主进程已超时但授权弹窗仍停留。
- **实验性 Vetta CLI 开关**：设置页「Agent配置 → 实验性功能」新增默认开启的 Vetta CLI 开关。开启后仅在桌面端普通对话会话创建时注入应用操作提示词；Claw、批量任务、自动化与流转会话不注入。
- **Vetta action 同请求授权执行**：`vetta action run` 通过本地 action RPC 调用需要授权的 action 时，Desktop main 进程会在参数校验后挂起当前请求，并通过全局授权弹窗展示 action 元数据与完整输入。用户允许后 `AppActionRuntime` 在同一个 RPC 请求内立即执行并把结果返回 CLI；拒绝返回 `ACTION_REJECTED`，超时、renderer 崩溃或调用方中止会取消请求。授权决定只绑定当前 Promise，不再生成或消费一次性 grant，RPC endpoint Bearer token 仍保留用于本地通信认证。
- **技能市场展示下载量热度**：市场页技能/场景卡片展示服务端下发的 `download_count`，同分类内按下载量降序排列便于区分热门（已安装/启用项仍优先靠前）。
- **站内信（in-app notification，ADR-0018）**：消息中心「通知」(铃铛) Tab 从空壳接入服务端推送的持久化站内信——登录后拉取列表与未读数，并监听 SSE `notification:new` 事件实时插入；铃铛角标、「全部」与「通知」Tab 计数纳入未读数，点击单条标已读、支持「全部已读」/「清空已读」、通知条目 hover 右上角可硬删除单条。首期消费者是管理员的订阅操作（移除/更改/重置额度），与本地 OS「系统通知」是两套独立系统。新增 `notification-atoms`、`useNotificationInit`、`api.ts` 站内信接口。

- **预设服务商：服务端模板 + 自带 key 直连（BYOK，ADR-0015）**：模型配置页新增独立「预设服务商」区，列出服务端下发的 provider 模板（claude / openai / deepseek / qwen 等，含 baseUrl、模型列表与能力参数、供应商图标），用户只需填入**自己的 key** 即可直连服务商原站使用——服务端只提供目录、不碰 key、不转发流量、不计费，与登录制「远程网关」并存。填 key 即「采纳」：模板被快照成本地 `~/.vetta/agent/models.json` 的普通 provider 条目（带 `apiKey` + `source:"template"`/`templateId`/`icon` 标记），离线/服务端下线均可用；App 启动及手动「刷新」时经新公开接口 `/providers/templates.json`（免登录）拉取并**在线合并**——用服务端最新 url/模型/参数覆写已采纳条目（仅保留本地 key），服务端删除该模板或拉取失败时回退本地快照。采纳的条目只在「预设服务商」区展示、从手搓「服务商」区隐藏，互不重复；填 key 不做校验，首次真实请求才暴露无效 key；首启离线且拉取失败时该区为空 + 提示重试（不内置种子）。新增供应商图标注册表（客户端内置 symbol→图标，服务端只下发可选 symbol），「预设服务商」区、「远程服务商」区与聊天页 ModelSelector（触发按钮 + 分组标题）均按 symbol 渲染图标。新增 IPC `vetta:models:fetch-templates` 与 preload `models.fetchTemplates`；`ProviderConfig`/`ModelsConfigData` 新增可选 `source`/`templateId`/`icon`/模型级 `cost` 字段（coding-agent 共享同一份 models.json，仅做 schema 兼容、不感知模板）。「预设服务商」每个模板行可展开查看其模型（上下文 / vision / 思考）与价格摘要（只展示模型实际配置的价格项——输入(未命中)/命中/写入/输出，缺省项不展示，单位「元/百万 tokens」，display-only，随快照持久化）。

- **实验性功能：向用户提问（`ask_user_question`，ADR-0014）**：设置页「Agent配置」新增「实验性功能」section，含 ask_user_question 开关（默认开，存 `desktop-config.json` 的 `experimental.askUserQuestion`）。开启后 agent 可在执行途中向用户提一组多选题：该会话的输入栏被**完全接管**为「问答面板」——多问题以紧凑可折叠堆叠列表呈现、可自由切换，已答折叠成所选摘要；每题含选项（带 `badges` 引导标签）+ Other 自由输入，底部「取消 / 提交」。面板**绑定发起它的会话**（按 runtimeId 索引 `pendingQuestionsAtom`），切到别的会话只隐藏、切回恢复，App 关闭/刷新视为取消。提交/取消后 transcript 留一个富视图 tool_call block 回显问题与所选答案。开关切换即时生效：经新 IPC `vetta:session:question-set-enabled` 在共享 runtime 上注入/清除问答 handler（`setUserQuestionHandler`），agent 下一条消息即看到/看不到工具（能力=注册）；新增 `vetta:session:question-request` / `question-response` 两个 IPC 与 preload `onQuestionRequest` / `respondToQuestion` / `setQuestionEnabled`，runtime-core 新增 `RuntimeUserQuestion*` 契约与 `setUserQuestionHandler`。触发提问时同时发系统通知「有问题待确认，点击查看」（新通知类型 `agent-question-pending`，点击跳转该 session；聚焦看着该 session 时抑制），问答面板跳出/关闭走渐入渐出动画；transcript 富视图单问题平铺、多问题用带滑动下划线的 tab 切换（含淡入淡出动画），并修长标题挤压 header 标签的问题。
- **设置页「Agent配置」新增「个性化」面板——人设 + 自定义指令**：「Agent配置」（原「上下文策略」）最上方新增「个性化」section。人设以可选卡片网格呈现（清单由 coding-agent 注册表经新 IPC `vetta:session:get-personas` 下发，仅 id/label/description、不含提示词正文），首期含「默认」（no-op）与「务实」；下方 textarea 为自定义指令（叠加在人设之上的自由文本）。人设选择与 textarea 缓冲在本地，单一「应用」按钮统一提交（dirty 时才可点），经 `vetta:session:get-personalization` / `vetta:session:set-personalization` 读写 `~/.vetta/agent/settings.json` 的 `personalization` 块。配合 coding-agent 侧 ADR-0013 的个性化懒重建：写盘后不广播，运行中的 session 在下一条消息按签名比对重建系统提示词即生效（人设在前、自定义指令在后，拼在提示词末尾），新建/重开的 session 构造时直接读到，无需重启。

- **agent 完成一轮回答的系统通知（macOS / Windows，ADR-0002）**：交互式会话每完成一轮回答（`agent_end` 正常收尾或 `error` 出错；用户主动中断不通知）时弹系统通知，标题取会话名（会话 jsonl header 的 `name`，回退首条用户消息截断、再回退「新会话」），正文固定文案。唯一不打扰的情形：窗口聚焦**且**用户正停在该会话的聊天页（窗口可见但失焦、或停在设置/自动化等非聊天页都会通知；APP 在后台一律通知）。同一会话连续完成合并为一条（新通知替换旧的），不同会话各占一条。点击通知前台化窗口并路由到该会话聊天页（会话已删除则仅前台化、不报错）。仅覆盖交互式会话——自动化/批量/定时任务静默。「通用设置」新增全局总开关（默认开）；权限交给系统，不主动申请。实现为主进程类型化通知服务（`AppNotification` 判别联合 + 薄 dispatch，预留横向扩充非 agent 通知类型）：检测放在主进程，于 `vetta:session:create` 时给交互式会话挂常驻事件订阅（独立于渲染端视图订阅，不随切换会话销毁），因后台会话的完成事件渲染端收不到；新增 `vetta:notification:set-foreground-session`（渲染端上报当前所在会话）/ `vetta:notification:navigate`（点击后下发路由意图）两个 IPC 与 preload `notification` 命名空间；`DesktopConfigData.notificationsEnabled` 新字段。不改动 runtime-core。

- **设置页新增「上下文策略」面板——上下文保留图片数滑块**：设置侧边栏底部新增「上下文策略」Tab（`SettingsTab` 联合新增 `context`），内含一个带刻度、吸附整数的滑块控制 coding-agent 的 `images.maxRecentImages`（上下文里最多保留最近几张图片，更早的替换为文字占位以省显存/token），范围 1..10 张、默认 2 张，全宽布局不挤压。配合 coding-agent 侧 ADR-0012 的判定改动：刚读入、模型尚未看过的图片不受此限制（修复批量读图「读了=没读」）。同时新增全局 `ui/slider.tsx`（基于 `radix-ui` Slider 的 shadcn 风格组件，主题色自适应）。改动经 `vetta:session:set-max-recent-images` / `get-max-recent-images` 两个新 IPC 写入/读取 `~/.vetta/agent/settings.json`；运行中的 session 下一轮 prompt 经 `SettingsManager.reloadImageSettings()` 懒重读生效、新建/重开的 session 直接读到，无需重启。

- **设置页新增「权限管理」面板（仅 macOS）**：设置侧边栏在「环境管理」之后插入「权限管理」Tab（`SettingsTab` 联合新增 `permissions`，`BASE_TABS` 新增 `macOnly` 过滤标志，非 mac 完全隐藏）。面板复用 `SettingSection` + `SettingRow` 风格，列出三项权限：完全磁盘访问（让 coding-agent 读写项目外文件）、辅助功能（全局快捷键 / 读取其他窗口）、通知（任务完成 / 错误推送系统通知）；每行左侧状态徽章（已授权 / 未授权 / 未知 三态点），右侧按钮跳转对应「系统设置 → 隐私与安全」子面板（`x-apple.systempreferences:` URL Scheme）。进入面板时检测一次，并监听 window `focus` 事件——用户从系统设置切回时自动重查。新增 `vetta:permissions:check-all` / `vetta:permissions:open-pane` 两个 IPC 与 preload `permissions` 命名空间。状态探测：辅助功能用 `systemPreferences.isTrustedAccessibilityClient(false)` 静默查询；通知通过 `Notification.isSupported` + `getNotificationSettings`（若可用）判断；完全磁盘访问无官方 API，采用试读 `~/Library/Safari/CloudTabs.db` 的间接探测（EACCES/EPERM → 未授权，ENOENT → 未知，避免误判）。

- **内置可移植运行时 + bash 源重定向（环境管理，ADR-0011）**：面向无开发环境的普通用户，desktop-app 自带 Node 与 Python 运行时，无需手动安装、无需代理。随安装包内置当前平台的二进制（`prepare-pack.js` 新增 vendor staging：Node 取自 npmmirror、Python 取自 python-build-standalone GitHub releases；可设 `VETTA_SKIP_VENDOR=1` 跳过、`VETTA_VENDOR_PLATFORM` 指定跨平台目标），首次启动由 main 进程零网络拷贝到 `~/.vetta/runtimes/<type>/<version>/`（`.vendor-version` 标记幂等跳过）。启动时（早于 IM sidecar bootstrap）一次性把托管运行时 bin 前置进全局 `process.env.PATH`，并注入 `npm_config_registry`（npmmirror）、`npm_config_prefix`（私有全局目录，与运行时版本解耦、不污染系统）、`npm_config_cache`、`PIP_INDEX_URL`（清华）、`PIP_TRUSTED_HOST`——桌面 in-process bash 经 `getShellEnv()` spread、IM sidecar 继承本进程 env，两条链路自动生效，coding-agent 全程无感（保持 portable）。始终优先托管版（PATH 前置盖过系统版），系统探测仅供面板展示/兜底。设置页新增「环境管理」面板（自动获取，面板仅做可见性 + 升级/重新获取 + 系统探测展示）：新增 `vetta:runtimes:*` IPC（get-status / reinstall / redetect）、preload `runtimes` 命名空间、`SettingsTab` 新增 `environment`。明确不含原生编译工具链——pip 装仅 sdist 的 C 扩展包仍会因无工具链失败，是 v1 已知边界。

- **MCP 设置支持 HTTP transport**：MCP 服务器设置（视图模式 + JSON 模式）支持新增 `type: "http"` 配置，可填 `url` 和可选 `headers`（每行 `KEY=VALUE`，支持 `${VAR}` 替换）。视图模式表单顶部新增「传输类型」切换器在 stdio / HTTP 间切换；JSON 模式不再强制要求 `command` 字段，按 `type` 分别校验。详情视图额外展示 HTTP URL/Headers。例：`{ "exa": { "type": "http", "url": "https://mcp.exa.ai/mcp" } }`。
- **设置页新增「外观」面板（外观模式 + 主题）**：设置侧边栏在「通用设置」之后插入「外观」Tab，提供两组大卡片：外观模式（浅色 / 深色 / 跟随系统）和主题（默认 / 海洋）。主题用 TypeScript 对象表达（`shared/theme/themes/*.ts`，每个主题导出 `{ light, dark }` 两套 token），切换时通过 `document.documentElement.style.setProperty` 把 `TokenSet` 注入到根节点 inline style，CSS 文件保持不变。`styles.css` 中原 `[data-theme="dark|light"]` 选择器（语义=模式）改名为 `[data-mode="dark|light"]`，新增 `data-theme="default|ocean"` 仅作主题标识；`@custom-variant dark` 同步更新到 `[data-mode="dark"]`。`main.tsx` 顶部在 React 挂载前同步调用 `applyInitialTheme()` 从 localStorage 读 mode + 主题名注入变量，避免冷启动闪烁；切换时给 `<html>` 临时加 `.theme-transitioning` class 启用 180ms 颜色 transition，超时后自动移除。主题仅渲染层 + localStorage（key: `vetta-color-theme`），不经 IPC；模式同步主进程的逻辑保持原状。新增 token 涵盖 `[data-mode]` 块下所有原有变量（颜色 + chart + 阴影 + 字体 + 圆角），后续新增主题只需添 TS 文件 + 在 `themes/index.ts` 注册一行。

- **批量任务 / 自动化 Dialog 支持选择技能·场景**：`BatchProjectDialog`（批量任务）和 `TaskFormDialog`（自动化）的 prompt 区改造为「输入卡片」——上方胶囊条 + textarea + 底部「+ 技能/场景」按钮，与会话页 InputBar 对齐。textarea 为空且首字符为 `/` 时唤起复用的 `SlashPanel`（中间出现 `/` 不触发，避免误触路径），底部「+」按钮可随时切换面板，胶囊上 Backspace 直接移除选中项。选中态以 `skill?: { name, alias?, type }` 持久化到 `BatchProject` / `ScheduledTask` 记录，运行时由各自 executor 通过顶层 `PromptRequest.promptRef` 结构化传递（与会话页 `useSessionManager.sendMessage` 一致）。重新打开 Dialog 时若存储的技能已被卸载，胶囊仍按 name/type 渲染并附 amber 色「未安装」标记，避免静默丢失用户选择。新增渲染端共享子组件 `SkillPromptArea`（位于 `domains/chat/components/`）封装胶囊条、SlashPanel 锚点与「+」工具条；preload 新增 `SelectedSkillRef` 类型并扩展 `BatchProject` / `ScheduledTask` / `createProject` / `updateProject` 数据形状；主进程 `batch-task-storage`、`batch-task-executor`、`task-storage` / `task-executor` 全链路透传。`/.vetta/meta.json` 与 `~/.vetta/scheduled-tasks.json` 旧记录无 skill 字段时按 undefined 兼容。NewSessionPage 复用既有 `selectedSkillAtom` 路径不变。

- **会话页支持外部文件拖拽引用**：`ChatPage` / `NewSessionPage` 全页接管 OS 拖入事件，hover 时出现虚线虚化蒙层「松开以引用文件」提示。松开后非图片文件/目录通过 preload 新暴露的 `fs.pathForFile(file)`（Electron 32+ 移除 `File.path` 后由 `webUtils.getPathForFile` 接管）取到绝对路径，去重后追加进 `mentionedFilesAtom`，在 InputBar 顶部以胶囊形式展示并保留原有 hover 路径 tooltip；图片仍走 `attachedImagesAtom`（DataURL 多模态附件，不变）。文件夹通过 `webkitGetAsEntry` 检测，胶囊以目录形态显示。NewSessionPage 状态下拖入有效——文件暂存于 atom，由后续 `openSession + sendMessage` 串起。应用内 File Explorer 拖到 ChatPage 同样进 mentionedFiles：`FileTreeNode` 在 dragstart 新增第二条 MIME `application/vetta-path-meta`（JSON: `{ isDirectory, name }`），既不影响原有 in-tree move 逻辑，又让 chat drop zone 拿到目录标记。InputBar 自身的图片专属 drop overlay 下线，避免与全页 overlay 叠加。`mentionedFile` 语义随之从「cwd 内 @ 提及」放宽到「任意绝对路径引用」，CONTEXT.md 与 docs/adr/0002 已同步。

- **工具调用耗时元数据 UI 展示（含工具自报阶段）**：每个 tool_call block 现在自带 `startedAt / durationMs / phases / currentPhase` 四个可选字段。runtime-core 的 `tool.start` 事件加 `startedAt`、`tool.end` 加 `durationMs/phases`、新增 `tool.phase` 事件由工具内部 `ctx.phase(label)` 触发。renderer 端 `useSessionManager` 把三个事件喂给 chat-service 新接口（`handleToolStart` 扩展 `startedAt`、`handleToolEnd` 扩展 `timing` 选项、新增 `handleToolPhase` 维护 `currentPhase` + 累加 phases），历史加载侧 `fullHistoryToChat` 读取新的 `tool_timing` HistoryEntry 关联到对应 tool_call block。ToolCallBlock UI：header 在 duration > 1s 时显示紧凑耗时徽章（pending 状态每秒 tick 实时跳秒），展开面板顶部新增一行 `meta` 区显示 `HH:MM:SS · 12.345s · phase1 2.1s · phase2 12.3s ...`，title 文案明确「本地元数据，仅 UI 展示，不发送给大模型」；没有 result 但有 timing 数据时面板也可展开。所有 timing 信息存在 jsonl 的独立 `tool_timing` entry 里（参见 `@vetta/coding-agent` 的 ADR 0001），LLM 上下文永远看不到。

- **默认「对话」项目新增「清空会话」入口**：默认项目 label 右侧 ⋯ 弹出的 `ProjectContextMenu` 在 isDefault 分支新增「清空会话」项（destructive 样式，`mdi--broom` 图标）。点击弹 danger 风格确认弹窗，文案带上当前会话数量；确认后调用新增 IPC `vetta:session:clear-default-conversation`，主进程先 dispose 所有指向默认 cwd 的 session handle，再递归清空 `~/.vetta/conversation/` 下全部条目（保留目录本身），最后重建 `.vetta/sessions/`。若该项目存在 running 会话，菜单项置灰 + tooltip「请先停止运行中的会话」，主进程亦做兜底校验。清空后当前 active session 若属默认项目，自动跳回该项目的 NewSession 页。同步迁移默认项目的 session 落盘布局：在 `vetta:session:create` / `vetta:session:list-sessions` 两条 IPC 中识别默认 cwd 时透明注入 `sessionDir = <cwd>/.vetta/sessions`（与批量项目布局对齐），替代原先与设备相关的 `~/.vetta/agent/sessions/--*-.vetta-conversation--/` 编码路径；旧位置的会话不迁移、不再被读取。`SessionFacade.listSessions` 与 `RuntimeHost.listSessions` 签名扩展为接受可选 `sessionDir` 参数，透传给 `SessionManager.list`。

- **批量任务「失败 · 重置」徽章**：项目头部副标题里的失败计数文案改成红色可点击徽章「N 失败 · 重置」，仅在 `failed > 0` 时渲染；点击弹确认对话框，确认后清空所有失败任务的 session / 产物 / 状态（`status` 回到 `pending`，清 `sessionId` / `sessionPath` / `error`）并复用既有 `task.reset` 事件刷 UI。前端按点击瞬间快照取 failed 任务 ID 列表，与之后新失败的任务无关；后端按队列状态分流——若该项目还有 `running` 或 queued 任务（队列活动态）则把这些 ID 重新 `enqueueRunTask` 到队尾继续执行，否则仅重置等用户手动「开始」。当 `neverExecuted=0 && paused=0` 且「开始」按钮 disabled 时，按钮 `title` 提示「所有任务已完成或失败，点击「N 失败 · 重置」徽章可重置后重试」引导用户发现新入口。新增 IPC `vetta:batch-tasks:batch-reset-failed` 与 preload `batchResetFailed(projectId, taskIds)`。

- **侧边栏显示后台 streaming session 的运行指示**：runtime-host 维护 `runningSessionPaths` 集合，在 `attachInFlightBuffer` 里随 `agent_start`/`agent_end` 同步增删并通过 `onRunningChanged` 回调向上广播；desktop-app main 进程新增 `vetta:session:list-running` 与 `vetta:session:running-changed` 两个 IPC 通道（前者用于挂载时拉 snapshot，后者用于增量推送），preload 暴露 `session.listRunning` / `session.onRunningChanged`。renderer 新增 `runningSessionPathsAtom`，在 `Sidebar` 挂载时一次性拉取并订阅事件维护；`ProjectGroup` 中正在运行的 sessionItem 左侧 20px 槽位放 `mdi--loading` 旋转 spin（覆盖 `[定时]` 时钟图标），项目 row 的 folder/chevron 图标右上角叠加一个 primary 色微小 ping 脉动点表示「此项目内含运行中会话」；`DefaultSessionList`（底部默认对话）里的会话同样加 spin，标题行不加。批量项目复用同一通路（其 task session 也通过 `runtime.prompt` 触发 lifecycle 事件）。

- **批量任务已完成子任务支持「重新运行」**：批量任务页（`BatchTaskList`）与项目详情页（`BatchQueueStatus`）的子任务在 `status === "completed"` 时，hover 操作中新增「重新运行」按钮，复用既有 `retryTask` IPC 走 `cleanTaskFilesAndState`（删 session + 删 task-state + `resetTaskFiles` 清产物目录），随后重新入队。按钮视觉沿用 `mdi--restart` 图标但去掉 danger 红色（completed 是正常态，danger 色会误导为失败），破坏性语义通过二次确认弹窗兜底——标题「确认重新运行任务「xxx」」、描述「将删除该任务现有的会话和产物，并重新执行」、确认按钮「重新运行」。failed 重试沿用原"重试"文案与 danger 视觉不变。

- **批量重试失败下拉新增「仅清除失败状态」**：在原有「重试失败」/「清除失败状态并重试」基础上加入第三项，把所有失败任务的会话、task-state 与工作目录并行清理并广播 `task.reset` 事件把 UI 重置为未执行，但**不**触发重新运行——适合先批量清空再人工筛选哪些任务真要重跑的场景。新增 IPC `vetta:batch-tasks:batch-clear-failed` 与 preload `batchClearFailed`，复用既有的 `cleanTaskFilesAndState` + `task.reset` 通路。

- **批量重试失败按钮支持下拉两种模式**：批量任务列表项目头部的「批量重试失败」按钮改为下拉，提供两种重试策略：(1)「重试失败」沿用原行为——把每个失败任务的清理（删 session、删 task-state、清工作目录）放在 `pLimit(concurrency)` 内由 worker 拿到任务后再做，所以排队中的失败任务在轮到前 UI 上仍显示"失败"；(2)「清除失败状态并重试」先 `Promise.all` 并行清理所有失败任务的状态/会话/文件并向 renderer 广播新增的 `task.reset` 事件（renderer 收到后立即把 status 重置为 `pending`、清空 sessionId/sessionPath/error），再交给 `pLimit` 按并发数排队执行，UI 上能立刻看到所有失败标记消失。新增 IPC `vetta:batch-tasks:batch-clear-failed-and-retry` 与 preload `batchClearFailedAndRetry`，并在 `BatchTaskEvent` 联合类型里加入 `task.reset` 分支供 hook reducer 处理。

- **批量任务接入 Webhook 消息推送**：新建 / 编辑批量项目 Dialog 新增「启用消息推送」开关（默认关）。开启后，每个子任务终态（成功 / 失败 / 超时 / 产物缺失）会向所有已启用的 Webhook 推送一条富文本卡片，含本次子任务名 + 结果 + 耗时 + 模型、总进度条与状态分布表、正在运行任务列表、等待队列长度；当 pending + running + paused 全部为 0 且至少有一次完成时额外推送一条「项目汇总」消息（成功/失败合计、总耗时、平均耗时、并发度、失败列表前 10 条）。用户主动暂停不推送。推送走 main 进程 `getWebhookManager().broadcast()` 直接调用，best-effort（失败仅 console.warn，不阻塞任务终态）；消息模板支持飞书 lark_md 卡片与钉钉 markdown，header 颜色按 success / warn / error 自动切换。`notifyEnabled` 字段持久化到 `.vetta/meta.json`，IPC / preload / atoms 全链路透传。

- **Webhook 消息推送基础设施**：设置页新增「消息推送」Tab，支持多条飞书 / 钉钉自定义机器人 endpoint 并行配置（每条独立启用、独立测试），URL 与签名 Secret 持久化到 `~/.vetta/desktop-app/webhook-credentials.json`（chmod 0600），非敏感字段（名称、@配置、钉钉关键词）写到 `webhook-config.json`。`WebhookProvider` 接口 + `WEBHOOK_PROVIDERS` 注册表使后续接入企业微信 / Slack / Discord 只需新增 provider 文件 + 注册一行；UI / IPC / 存储 / Manager 一律基于 kind 动态展开。飞书走 `msg_type:"interactive"` 卡片 + `lark_md` 元素（HMAC 签名 key=`timestamp\nsecret`、data=空 → body 内 timestamp/sign），钉钉走 `msgtype:"markdown"`（HMAC 签名 key=secret、data=`timestamp\nsecret` → URL append timestamp/sign），统一映射通用 `WebhookMessage { title, text, level }`；钉钉关键词模式会自动拼到 title 前满足安全校验。主进程任意模块通过 `getWebhookManager().broadcast(message, { onlyKinds?, onlyIds? })` 直接推送，不走 IPC；CRUD / toggle / test 走 `vetta:webhook:*` 通道。30s 超时、不重试。后续业务接入点（批量任务完成 / 定时任务失败 / 更新通知等）按需挂在 main 进程对应位置。

### Changed

- **侧边栏知识库页面完整 i18n + 默认库磁盘名语言无关化**：知识库页面相关组件（`KnowledgeBaseListPage` / `KnowledgeBasePage` / `KnowledgeBaseSwitcher` / `KnowledgeContentsPanel` / `KnowledgeImportDialog` / `KnowledgeRenameDialog` / `KnowledgeSourcePicker` / `KnowledgeGrid` / `KnowledgeList` / `KnowledgeViewShared` / `KnowledgeProcessingBadge` / `KnowledgeDropOverlay`、活动面板 `KnowledgeHistoryPanel`、`lib/knowledge-base.ts` 的相对时间格式化）面向用户的文案全部接入 i18n（`settings` ns 的 `kb*` key 族，zh/en 双语），不再硬编码中文。默认「个人知识库」的磁盘目录名由中文 `个人知识库` 改为语言无关的 `default_kb`（`DEFAULT_KNOWLEDGE_BASE`），UI 显示名改由 `isDefault` 标记驱动、经新增 `knowledgeBaseDisplayName()` 走 `settings:kbDefaultName` 映射多语言。不做旧目录迁移：升级后磁盘上已存在的旧 `个人知识库` 目录会作为一个普通知识库保留，另新建空的 `default_kb` 作为默认库。
- **知识库文件列表加载提速 + 首屏骨架屏（修复大库进页空屏）**：主进程 `raws-fs.ts` 的目录扫描从「逐项串行 `await`（递归子目录 + 逐文件 stat）」改为同层并行展开（`buildTree` 内 `Promise.all`，各知识库的树也并行构建），消除深树/大目录下扫描阶段的长时间阻塞；功能契约不变（仍返回完整树，搜索与每库文件计数照常）。渲染侧 `refreshKnowledgeBasesAtom` 拆分为两段——文件列表（`knowledge.list()`）一返回即渲染，较慢的加工态（`knowledge.fileStatuses()`）改为后台异步填充角标，不再「等两个请求都回来才出内容」。新增 `knowledgeLoadingAtom` 与 `KnowledgeFilesSkeleton`：仅首次进页（尚无任何缓存）显示宫格骨架屏替代空屏，刷新已有数据时保持旧快照不闪。
- **知识库后台加工改为分批 + 并发会话**：一轮不再用单个 agent 会话处理全部 added/changed，而是按 `source_path` 聚簇 + 文件数/字节双预算切成多批（每批 ≤20 文件 / ≤8MB），经并发会话池跑（`createLimiter`，并发数 `knowledgeBase.agentConcurrency` 缺省 3）。所有并发批共享一个轮级写页会话（`createKbWriteSession`，内存 PageIndex + 串行提交），既消除 O(N²) 全量扫描又保证写页互斥安全；OCR 子进程并发经 `knowledgeBase.ocrConcurrency`（缺省 1，写入 `VETTA_KB_OCR_CONCURRENCY` 传给 coding-agent 全局 OCR 闸）限流。续跑靠 hash-diff 自愈，无需游标——大库分多轮平滑收敛。`KnowledgeBaseConfig` 新增 `agentConcurrency` / `ocrConcurrency` 两项（改 `ocrConcurrency` 需重启 app 生效）。每批起会话后把本批文件**预填为锁定待办**（`session.todoStore.createMany` + `lock("scene")`，一文件一项），强制 agent 逐个有序处理、逐个标记完成——锁定清单不可新建/跳过/乱序，未全部完成不允许结束，且待办作为 session 快照不受上下文压缩影响，杜绝长任务里漏处理或重复处理同一文件。
- **加工态与索引按批同步推进（修复侧边栏状态滞后）**：此前 `manifest.json`/`tags.json`/`indexes/INDEX.md` 只在整轮 `finalizeRound` 重建一次，且 UI 文件列表仅在用户增删改后才重取——大量文件加工时，已完成的文件在侧边栏长时间仍显示「待加工」。现每个批的会话一结束就重建一次索引（合并去重 + 串行执行，避免并发批同时写 manifest 竞态），并经新增 IPC 事件 `vetta:kb:statuses-changed` 广播；`KnowledgeContentsPanel` 订阅后重取文件加工态。状态与索引**同批推进**——侧边栏显示「已就绪」时索引已建好、检索/预览一致，不会出现「显示就绪但索引未建」。索引文件不跟到单文件粒度（单文件重写为 O(N²)，不划算）。
- **「知识库设置」新增「同时整理几批」下拉**（`agentConcurrency`，可选 1/2/4/6/8，缺省 3）；「多久整理一次」下拉新增「永不自动整理」项（`pollIntervalMinutes=0`）——选中后仅停后台轮询，知识库本身仍启用、检索可用，靠「马上整理」手动触发。手动「马上整理」现读配置里的加工模型与并发数（此前一直用默认值、忽略所选模型），与定时加工行为一致。`ocrConcurrency` 不暴露 UI（受 desktop 共享 OCR profile 制约，默认 1，仅高级用户改配置文件）。
- **「知识库设置」加工模型选择支持云端模型 + 测试连通**：加工模型下拉不再只列本地 `models.json`，参照 Claw 设置合并云端模型目录（`remoteProvidersAtom`，登录后由 useAuth 流式写入；本地同 key 优先），云端 provider 分组标「云端」徽章。模型旁新增「测试连通」按钮，经新增通用 IPC `vetta:models:probe`（preload `models.probe`）探测所选 provider 的 baseUrl 是否可达（本地优先、回退云端目录；仅判可达性，任何 HTTP 响应都算通，5s 超时）。探测逻辑从 im-host 的 `probeAgentModel` 抽出为共享的 `main/models/probe.ts`，Claw 与知识库共用。
- **知识库加工轮：孤儿删除纯工程化 + 无内容变更不起 LLM**：`runKnowledgeRound` 仅在 `diffNeedsProcessing`（有 added/changed）时才锁 raws、起加工 agent 会话；只有 moved（纯元数据）/deleted（标孤儿）/待回收孤儿时走「engineering-only round」，跳过 LLM，直接由 `finalizeRound` 工程侧物理删除上一轮孤儿并据 frontmatter 重建缓存。孤儿 wiki 页的删除不再经 agent 复判（确定性动作不耗 token、不由 LLM 决策）。轮询与手动「立即扫描」共用 `runKnowledgeRound` 顶部的 `running` 重入守卫：一轮进行中时后续触发记录「previous round still running, skipping this tick」并跳过，下一次 tick 待空闲后再跑，二者不会并发冲突。
- **附加图片改为路径引用、不再受模型视觉能力限制**：输入栏「添加图片」按钮、粘贴、拖拽不再判断当前模型是否支持图像输入——所有模型一律允许附加图片（移除按钮置灰与 paste/drop 的 `modelSupportsImages` 门控）。发送时附图不再以 base64 直接塞进上下文，改为经新 IPC `vetta:dialog:persist-images`（preload `dialog.persistImages`）落盘到 `~/.vetta/image-cache/<sessionId>/<id>.<ext>`，并以 `@绝对路径` 文本前缀（与 `@文件` 引用同机制）随 prompt 传给 agent，由 Read 工具按需读取：视觉模型 Read 后即可看到图，不支持视觉的模型也能用工具对图做 OCR / 改图等。`PromptRequest.images` 不再由桌面端填充（聊天气泡缩略图仍用本地 base64 渲染，不受影响）。图片缓存在启动时按 7 天 mtime 过期清理旧会话目录。配套把 `imageBackend.edit` 接线扩展为支持 `sourceImagePath`：agent 对用户上传的图片调 `edit_image` 时，主进程读取该本地文件字节走 image-gen 后端的 base64 图改图分支，不再因没有生成记录 id 而退回 `generate_image` 凭空重画。：右侧活动面板顶部 tab 从胶囊式 SegmentedControl 改为浏览器/文件夹式页签——页签悬浮在内容卡片上方，激活页签圆角凸起、底色与卡片一致并与卡片描边接成连续轮廓（切换时滑动过渡），非激活页签为半透明灰色圆角块、hover 提亮，页签之间紧贴无间隙，保留图标与未读 badge；面板容器底色同步从 bg-muted 改为 bg-card 并加柔和投影，保留 1px 边框。新增通用组件 `shared/components/ui/tab-bar.tsx`（SegmentedControl 其他使用处不受影响）。
- **「自动化」界面交互重构 + 侧栏 session 图标**：执行历史从网格底部堆叠改为右侧滑出抽屉（背景色与 app 页面一致），点哪张卡片历史就贴着右侧出现，任务多也不用滚动；抽屉头部带任务名/调度描述 + 立即执行/暂停启用/编辑/关闭。定时任务 session 名改为干净的「任务名 · 时间」（去掉 `[定时]` 文字占位），侧栏据调度执行记录里的 sessionPath（含 basename 兜底）识别定时 session 并挂时钟图标，普通会话挂消息图标，运行中挂 spinner；默认「对话」项目的独立 session 列表（`DefaultSessionList`）同步加图标。新增 `src/shared/scheduled-session.ts`、`scheduledSessionPathsAtom`、`HistoryDrawer`，新增 `scheduler.getScheduledSessionPaths` IPC。
- **消息中心弹窗重构（motion 动效 + 主题色）**：从居中 Radix 弹窗改为锚定右上角铃铛、spring 弹出/退场的下拉面板；Tab 栏引入主题色（active 用 `primary`，带 `layoutId` 滑动指示块），Tab 内容切换、列表增删、空态均加 motion 过渡；面板视觉重做（图标徽章头部、主题色高亮未读条目）。

- **桌面端主进程日志目录跨平台统一**：主进程 `main.log` 不再使用 Electron 各平台默认日志目录，统一写入 `~/.vetta/desktop-app/logs/main.log`；Windows / macOS / Linux 现在共享同一用户目录结构。日志滚动文件仍与 `main.log` 同目录，继续保留 5MB 大小滚动、按 Asia/Shanghai 日期跨日滚动和最近 10 个归档文件清理策略。

- **主进程日志滚动策略增强**：保留 Electron 默认日志目录与当前文件 `main.log`，但归档文件从 `.old.log` 改为带中国时区时间戳与原因的文件名（如 `main.2026-05-25T143012+0800.size.log` / `.date.log`）。日志同时支持 5MB 大小滚动与按 Asia/Shanghai 日期跨日滚动，日志行时间戳也改为中国时区，并自动清理只保留最近 10 个归档文件。

- **项目详情页失败任务「重试」改为先清理再重跑**：`BatchQueueStatus` 中失败子任务的「重试」按钮原先调用 `runTask`（直接重新入队，旧 session / 产物原样保留），与批量任务页 `BatchTaskList` 调用 `retryTask`（先清 session + 清产物再重跑）的行为不一致——同一个标着"重试"的按钮在两处语义不同。现统一改为 `retryTask`，并补上和批量任务页一致的二次确认弹窗（标题「确认重试任务「xxx」」、danger 变体）。

- **批量任务页面 UI 紧凑化**：顶部 4 张 StatCard 卡片网格收敛为「新建项目」按钮左侧的内联紧凑 stat strip（总数 / 运行中 / 已完成 / 失败，pill 内分隔线），移除卡片背景与 hover 动画；项目 list 去掉外层卡片框（border + bg-card + 顶部 accent + 内部分隔线全部移除），只保留 header 行 + 进度条 + 任务网格的扁平结构；子任务网格固定 3 列（`sm:grid-cols-2 lg:grid-cols-3`），折叠阈值从 6 提升到 9（3×3 对齐 UI 网格）。子任务 item 去掉边框/ring，背景改 `bg-muted/40` 与主背景区分，padding 收紧到 `px-2.5 py-2`，字号下调（标题 12px / 状态 pill 9px / 时间 10px），不再展示 sourcePath，默认仅显示项目名 + 时间 + 状态 pill；hover 时整张卡片浮一层 `bg-background/70 backdrop-blur` 蒙层，操作按钮（跳转会话 / 执行 / 重试 / 取消等待 / 删除）以圆形 `OverlayActionButton` 居中排列在蒙层正中。失败错误从单独错误条改为时间右侧的内联红色省略式提示（hover 看完整 tooltip）。新增 `sortProjects` / `sortTasks` 两个本地排序函数：项目级与子任务级一律「运行中靠前，其次 createdAt latest」，让正在跑的批次和最近新建的子任务自动浮顶。

- **批量子任务完成消息标题带上项目名**：原标题 `✅ 子任务已完成` / `❌ 子任务失败` 在多项目并行时无法分辨是哪个项目，改为 `[${project.name}] ✅ 子任务已完成`；body 末尾的 `📁 项目：****` 同步去掉 mask 改为真实项目名（标题既已暴露，body 再 mask 已无意义）。子任务名仍以 `****` 脱敏，错误信息与模型 Key 保持原文不变。

- **批量项目汇总消息的失败列表任务名也脱敏**：`buildProjectSummaryMessage` 在 `failed.length > 0` 时输出的 `**失败列表**：- \`${t.name}\`：…` 与子任务消息脱敏规则不一致，按相同规则改为 `- \`****\`：…`，仅保留错误信息原文。汇总标题 / body 项目名维持原样（与子任务消息一致地显示 `project.name`）。

- **对话消息中 bash 工具调用展开 UI 改造为终端卡片**：原先 bash/shell 工具的展开内容只是一个灰底 `<pre>` 命令块加另一个 `<pre>` 输出块。重做为带边框的终端卡片：标题栏（状态点 + 中文文案「执行命令 / 正在执行 / 命令失败：{首行≤40 字符}」+ hover 出现的复制命令按钮）、命令行区（amber 色 `$` 提示符 + 完整命令，`max-h-[180px]` 独立滚动，pending 时末尾 1s 闪烁方块光标）、输出区（`max-h-[300px]` 独立滚动）、底部脚注（pending 时显示「正在执行···」+ 旋转 loader，结束后显示原 meta 行）。配色全用 `bg-muted/*`、`text-foreground/*` 等主题 token，深浅色主题自适应。新增 `bash-cursor-blink` keyframe。同时按工具拆分 `ToolCallBlock.tsx`（原 ~700 行）：新建 `blocks/tool-views/` 目录，bash/edit/read-image/write 各一个 view 文件，公共 utils（format/parse-tool/parse-diff/use-elapsed/StatusIndicator/CopyIconButton/TextPreview）归到 `tool-views/shared/`，容器只负责 header + expand + 按 toolName dispatch（~180 行）。外部 `ToolCallBlockView` 导出保持不变。

### Fixed

- **主进程日志系统失控自保护（防雪崩三件套）**：① console patch 重入护栏——`patchConsoleToAppLogger` 把 `console.*` 指向 logger，logger 管线内部（transport / 序列化 / 归档失败）再触发的 `console.*` 会回灌 logger 形成自反馈死循环（"Render frame was disposed" 刷屏瞬间写满数个 5MB 文件即此类）；现用同步标志拦截，内部再触发的 `console.*` 直接走原生 stderr，绝不回灌。② 全局体积上限——保留策略从"仅按日期保留 10 天"叠加"单 type 目录归档数（50）+ 总字节（200MB）双上限"，当日活跃文件按精确文件名保护、永不删，封顶只回收归档，杜绝单天写爆磁盘。③ 多进程文件隔离——GUI 主进程与 agent-rpc / OCR / PDF / Action / Help 等 sidecar/CLI 子进程不再共写同一 `<日期>.log`，子进程文件名带 `role+pid` 后缀，消除并发追加与归档 rename 的 TOCTOU 竞态（GUI 文件名不变、向后兼容）。
- **后台加工进行中关闭知识库开关 / 清空 wiki 不会立即停止加工**：此前关闭知识库总开关只取消后台定时调度，正在跑的那一轮加工仍会把 wiki 写完；「清空 wiki」在有加工轮进行时直接报「知识库正在整理中，请稍后再试」。现在 `main/knowledge/poller.ts` 给运行中的加工轮加了可中止句柄（记录本轮全部活动加工会话），新增 `abortKnowledgeRound()` 对所有活动会话调 `session.abort()` 并等待该轮真正收尾；关闭总开关（`reloadKnowledgePoller` 的 disabled 分支）会立即中止在跑的加工轮并清除 raws 只读锁，`runKnowledgeMaintenance`（清空 / 删除 wiki 走此互斥锁）改为先中止在跑的轮再独占执行，而非直接拒绝。中止后队列里未起的批直接跳过、已起的批立即停止且不再重建索引。
- **Linux AppImage 下 IM（微信/Claw）发消息报 `subprocess exited during handshake: FATAL:setuid_sandbox_host.cc(163)`**：上一版用子进程内 `app.commandLine.appendSwitch("no-sandbox")` 关沙箱，但对 AppImage 太晚——`chrome-sandbox` 挂在只读的 `/tmp/.mount_xxx` 且非 setuid root，Chromium 在 ContentMain 早期的 SUID 沙箱检查就 FATAL abort，早于 JS main 执行，appendSwitch 根本没机会生效。现在 Linux 打包路径把 `--no-sandbox` 作为真实 argv 传给子进程，且置于 `--agent-rpc` 之前——既让 Chromium 在最早期解析到、又因 `parseAgentRpcCommand` 只转发 `--agent-rpc` 之后的参数而不会污染 coding-agent 的参数解析（macOS 不受影响）。
- **Linux 下 IM（微信/Claw）桥接发消息报 `acquire session: hostclient/local: handshake timed out after 10s`**：im-gateway 在 dev/生产都用 `process.execPath + --agent-rpc` spawn 一个 headless Electron 子进程跑 coding-agent RPC，而该子进程的逻辑挂在 `app.whenReady()` 之后。Linux 上嵌套 spawn 的 Electron 的 Chromium setuid/namespace sandbox 经常初始化失败，`whenReady()` 永不 resolve，宿主只看到 10s 握手超时且无子进程 stderr（macOS 不受影响）。现在 CLI/agent-rpc 模式在 Linux 上启动时追加 `--no-sandbox` 与 `--disable-dev-shm-usage`（该子进程不渲染任何不可信网页，关 sandbox 安全）。
- **streaming 期间展开右侧文件预览后，模型结束输出但打字指示器仍卡住**：内联文件预览展开会自动收起左侧 Sidebar 腾出空间，而 Sidebar 被条件渲染时是真正卸载。维护 `runningSessionPathsAtom`（streaming 状态真值来源之一）的 `RUNNING_CHANGED` IPC 订阅原先挂在 Sidebar 的 effect 上，Sidebar 卸载期间该事件被静默丢弃，导致 `isStreamingAtom` 一直为真，直到关闭预览、Sidebar 重新挂载靠 `listRunning` 快照纠偏。现把该订阅抽成 `useRunningSessionsSync` hook 上提到始终挂载的 App 根级，Sidebar 折叠/窄屏/内联预览均不再丢事件。

- **开发启动时系统插件重复初始化异常**：React StrictMode 会在开发环境重复执行插件宿主初始化，原加载器每次都以 `force` 覆盖 Module Federation remote，触发覆盖告警并清除已加载缓存；首次异步加载若在清理后才完成，也不会释放插件贡献。现在仅在插件别名或入口实际变化时强制重注册，同一制品直接复用既有 remote，并在异步加载完成后正确清理已失效初始化产生的插件实例。

- **Windows 开发启动构建系统插件时报 EPERM**：预置插件改由 `packages/plugins` 独立 Bun workspace 统一管理；构建脚本按该 workspace 的锁文件执行 frozen install，并通过 `workspace:*` 直接链接插件 SDK/构建包源码，不再从嵌套项目复制根 workspace 的 Junction。

- **实验性「提问用户面板」现在仅对话会话生效**：`ask_user_question` 不再因全局 handler 开启而出现在 Claw、批量任务、定时任务等非对话 session 的工具列表中；desktop 创建对话 session 时显式允许该工具，其它 session 不注册，设置页说明同步更新。
- **定时任务执行后刷新 app，「自动化」里所有任务卡片消失**：任务执行收尾时多处 `saveTasks` 并发非原子写 `~/.vetta/scheduled-tasks.json`，互相截断导致文件尾部多一个 `]` 而成非法 JSON，`loadTasks` 的 `JSON.parse` 抛错被吞、静默返回 `[]`，任务全没了（且下一次写入会把损坏文件覆盖、永久丢数据）。修复：`saveTasks` 改「写临时文件 + `rename`」原子替换并用 promise 链串行化所有写入；`loadTasks` 解析失败时用括号匹配截出首个完整数组自愈并原子重写干净文件，实在无法恢复则把损坏文件备份成 `.corrupt-<ts>` 再返回空，杜绝静默覆盖。
- **默认「对话」项目下的定时任务 session 从侧栏消失**：定时任务经 `runtime.createSession` 直连创建，绕过了 desktop session IPC 的 `sessionDir` 注入，默认「对话」/IM 项目的 session 落到了 `~/.vetta/agent/sessions/`，而侧栏 `listSessions` 读的是 `<cwd>/.vetta/sessions/`，首次 `loadSessions` 整桶替换后就再也找不到。`task-executor` 创建时改用 `resolveSessionDirForCwd(task.cwd)` 注入与 IPC 一致的 sessionDir。
- **运行中的定时 session 被点开会闪现「未命名会话」**：session 的 name 记录（`session_info`）在首个 assistant 回复落盘前只在内存、磁盘只有 header，`openSession` 末尾的 `loadSessions` 重载时读到空 name。`loadSessions` 合并时改为：磁盘 name 为空就沿用上一次已知的非空 name，消除闪烁（对所有新建会话同样生效）。
- **右键删除侧栏定时 session 不会删掉「自动化」里的执行记录**：`deleteSession` 只删了 session jsonl。新增 main 端 `deleteRecordsBySessionPath` + IPC + preload，删除定时 session 时按 sessionPath 同步删 `~/.vetta/task-records/<taskId>/<sessionId>.jsonl`，并刷新正在展示的执行历史。
- **从 Finder/Dock 启动时 coding-agent 的 bash 找不到 homebrew 安装的命令（`brew`、`git` 等）**：macOS GUI 进程不继承终端 shell 的 PATH，只拿到系统精简 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`），不含 `/opt/homebrew/bin`；而 coding-agent bash 工具用 `bash -c`（非登录非交互），不会 source 任何 profile，也补不回这些路径。修复：新增 `src/main/fix-path.ts`，主进程启动早期跑一次用户登录交互 shell（`-ilc`）解析真实 PATH，把缺失项**追加**到 `process.env.PATH`（追加而非前置以保留 `RuntimeManager.applyEnv()` 注入的托管运行时优先级），`main.ts` 在 `applyEnv()` 与任何 bash 执行前调用。不触碰 `SYSTEM_PATH_SNAPSHOT`，运行时探测行为不变。
- **市场技能/场景安装后一直显示「可更新」**：客户端安装时会重新解析本地 SKILL.md 取版本，而 SKILL.md 常缺 `version`、本地解析缺省 `0.0.0`，与服务端缺省 `0.0.1` 永不相等，导致 `needsUpdate` 恒为真。修复：`installFromMarket` 的 `meta` 新增 `version`，安装时以服务端下发版本写入 manifest 作为更新比对基准，不再重解析本地（缺省才回落本地解析以兼容旧客户端）。两处安装入口（市场页、新会话场景轮播）均透传 `version`。
- **生产环境 IM（飞书 / 微信）发消息一律报 `exec: "vetta": executable file not found in $PATH`**：im-gateway sidecar 默认从 PATH 找 `vetta` 拉起 coding-agent，但打包后的 Vetta.app 不包含独立 CLI 二进制，PATH 也没软链，整条 IM 发消息链路都断在 spawn 上。修复：`main.ts` 新增 `--agent-rpc` CLI mode（参考既有 ocr / pdf CLI 实现），新增 `src/main/cli/agent-rpc-command.ts` 检测到该 flag 后短路 UI 引导，把后续 argv 直接交给 `@vetta/coding-agent` 的 `main` 跑 stdio RPC 会话；`im-host/index.ts` 新增 `buildCodingAgentSpec()` 把 `{ bin: process.execPath, prefixArgs: ["--agent-rpc"] }`（dev 模式额外塞 main entry 路径）通过新增的 `InitFrame.codingAgent` 字段下发给 sidecar，sidecar 据此 fork Vetta.app 本体充当 coding-agent。免去要求用户全局安装 `@vetta/coding-agent`，dev 与 prod 走同一代码路径。

- **`--agent-rpc` 子进程一启动整条 stdout/stderr 静默 → IM sidecar 卡在 handshake 上**：`installMainDiagnostics()` 在 main.ts 顶部无条件运行，会用 `patchConsoleToAppLogger()` 把 `console.log` / `info` / `warn` / `error` 全部劫持成 electron-log 的文件 logger。coding-agent 的 RPC 模式恰好用 `console.log(JSON.stringify(...))` 作为对 parent 的 NDJSON 协议输出 —— 一被劫持就全进了文件，sidecar 永远读不到响应。PDF / OCR CLI 不受影响是因为它们用 `writeSync(1, ...)` 直接写 fd1。修复：把 `installMainDiagnostics()` 用 `if (!agentRpcArgs)` 包起来；其它 CLI mode 行为不变。

- **`--agent-rpc` 子进程启动即 `ENOENT, dist/modes/interactive/theme/dark.json not found`（dev 落到 `<workspace>/desktop-app/dist/coding-agent/...`，prod 落到 asar 内）**：Vite 把 `@vetta/coding-agent` 的 JS 打进 `app.asar/main/main-*.js`，但 coding-agent 的运行时静态资源（theme JSON、export-html 模板、package.json、banner.txt）并不会被 Vite 一起 bundle；`getPackageDir()` 在 asar 内 walk up 找到的是宿主 desktop-app 的 `package.json`，于是 `getThemesDir()` 解析到 `app.asar/dist/modes/...` 里去找根本不存在的文件，子进程 `initTheme` 就直接 throw。修复分三步：① `prepare-pack.js` 新增 staging 步骤，把 `packages/coding-agent/{package.json,banner.txt,README.md,CHANGELOG.md,dist/modes/interactive/theme,dist/core/export-html}` 复制进 `<buildStage>/coding-agent/`，并加进 `extraResources` 让 electron-builder 输出到 `Vetta.app/Contents/Resources/coding-agent/`；② `agent-rpc-command.ts` 在 import `@vetta/coding-agent` 之前 fallback 设置 `process.env.VETTA_PACKAGE_DIR`；③ 真正可靠的路径是 desktop-app 在 `buildCodingAgentSpec()` 里把 `@vetta/coding-agent` 的 package 路径用 `createRequire(...).resolve("@vetta/coding-agent/package.json")` 解析出来，塞进新增的 `InitFrame.codingAgent.packageDir`，im-gateway sidecar 再把它作为 `VETTA_PACKAGE_DIR` 环境变量传给 agent-rpc 子进程。dev / prod 走同一条 env 注入路径，不再依赖 `app.getAppPath()`（在以 `electron <main>` 启动时返回 `dist/main`，walk up 永远找错位置）。

- **packaged AppImage 里 photon-node 找不到，图片以原图喂模型导致主进程内存膨胀**：`@silvia-odwyer/photon-node` 在 `vite.main.config.ts` 里被 external，运行时由 `photon.ts` 通过 `createRequire(import.meta.url)("@silvia-odwyer/photon-node")` 加载；但打包 staging 的 `package.json` 原先没有声明该 production dependency，electron-builder 没把手动复制进 staging 的 `node_modules/@silvia-odwyer/photon-node` 收进最终 `app.asar` / `app.asar.unpacked`，packaged 后 createRequire 仍会 resolve 失败，photon.ts 走 catch 降级 → image-resize 失效 → 历史里的 base64 图片以**原始分辨率**重复拼进每一轮 LLM request body，长会话主进程 RSS 直线上涨，最终触发 OOM。`prepare-pack.js` 现在从 external 包自身的 `package.json` 读取版本并写入 staged app 的 `dependencies`，再复制包目录，配合 `asarUnpack` 让 `photon_rs_bg.wasm` 落在 `app.asar.unpacked/`，恢复图片缩放路径。photon-node 是纯 WASM、无平台二进制差异，跨平台打包安全。

- **主进程长跑后被 Linux OOM Killer 静默 SIGKILL**：主进程从未给 V8 设过老生代上限，长跑批量任务 + 图片预算未生效（photon WASM 在 packaged 路径 load 失败导致原图喂模型）后 RSS 自然膨胀，最终被 kernel SIGKILL，进程静默消失、连一行日志都来不及写。`main.ts` 在 app 启动前 `appendSwitch("js-flags", "--max-old-space-size=4096")`，超限时改由 V8 抛 `RangeError: JS heap out of memory`，可被 `uncaughtException` handler 接到并落盘栈；CLI 模式跑短任务沿用默认。`__filename is not defined` 那条错误文本来源待进一步定位，先前把 `dbus-next` / `bindings` 加进 vite external 的尝试因 bun 的 napi-rs 平台二进制 / native addon 在 cross-platform 打包链路下不齐而导致 packaged 启动 ERR_MODULE_NOT_FOUND，已回滚到只 external `@silvia-odwyer/photon-node`。

- **桌面端主进程日志改为 electron-log 滚动文件日志**：新增统一 `main/logger.ts` 封装 `electron-log/main` 配置，`main.log` 由 file transport 管理并按 5MB 自动滚动为 `.old.log`；主进程 `console.*` 统一 patch 到 scoped file logger，避免继续手写 `appendFileSync` 与临时目录 fallback。应用生命周期、窗口事件与 renderer console 捕获分别落到 `main` / `window` / `renderer` scope，`process.on("warning")` 现在也会进入日志文件，便于排查 `MaxListenersExceededWarning` 等 Node warning。仅在 `VETTA_DESKTOP_DEV_URL` 开发模式启用 console transport，打包与 PDF/OCR CLI 模式禁用 console transport，避免 stdout/stderr 被诊断日志污染。

- **历史会话里残留的"无名工具"块不再显示**：`chat-service.ts` 的 `messageToBlocks` 加载历史时，判断条件是 `typeof part.name === "string"`，空串也通过，于是 `@vetta/ai` `openai-completions` provider 旧版解析缺陷写进 session 文件的 `{id:"", name:"", arguments:{}}` 幽灵 toolCall 都会被还原成一个空名 tool_call block，UI 上呈现一排没有标签、点开也没内容的"无名工具"。判断改为 `name !== ""`，跳过这些块。注意：写入侧的根因已在 `@vetta/ai` 这次发版里修好，此项是对历史脏数据的渲染层兜底。

- **发消息无反应（核心 bug 修复）**：prod DMG 装好、用户登录 OK、能看到 remote 模型，但点发送后聊天里没任何反应——既没气泡、没 spinner、也没报错。三个独立缺陷叠加导致：(1) renderer `useSessionManager.sendMessage` 里 `await window.vetta.session.prompt(...)` 没有 try/catch，IPC reject 直接成 unhandled promise rejection；(2) `RuntimeHost.prompt` 把 `session.prompt` 的同步抛错（"No model selected" / "No API key found" / "Agent is already processing"）原样向上抛，而这些抛错发生在 `agent.start()` 之前，根本不会经由 session 事件流转成 `error` 事件，subscribe 链路完全捕获不到；(3) coding-agent SDK 的 `createAgentSession` 退回到内置硬编码的 `http://127.0.0.1:8080/api/v1` LAN 默认值并把它静默写入 `~/.vetta/agent/settings.json`，于是 prod 构建里 desktop-app 自己（env 注入的 `VETTA_SERVER_URL`，prod = `118.89.84.172:8080`）和 SDK（写死 LAN）指向两个不同 server——renderer 拉到的 remote 模型来自 prod，但 ModelRegistry / LLM streaming 用的是 LAN，prod 用户网络下 `loadRemoteModels` 静默超时 → `findInitialModel` 返回 undefined → `session.prompt` 第一行抛 "No model selected" → 沿 (1)(2) 路径吞掉。修复：runtime-core 新增 `RuntimeHostOptions.serverUrl` 与外部订阅者表，`prompt` 路径 try/catch 后合成 `error` 事件广播给所有订阅者再 rethrow（scheduler / batch-tasks 等已有 try/catch 的调用方仍能拿到 reject 做重试）；desktop-app `runtime.ts` 把编译期注入的 `DEFAULT_SERVER_URL` 显式喂给 `RuntimeHost`；coding-agent SDK 新增 `CreateAgentSessionOptions.serverUrl` 选项，调用方传入时既不读 settings 也不写 settings，彻底切断对 settings.json `serverUrl` 字段的静默污染路径；renderer `sendMessage` 保留 try/catch 作为 IPC 自身出错的兜底，在 chat 里 `appendError` + `setIsStreaming(false)`，杜绝任何 prompt 路径上的失败导致死寂体验。

- **批量项目处于 paused 态时，"清空队列状态/执行全部/重试失败/重新开始"被静默 skip**：`pausedAt` 是项目级标志，但只有 `BATCH_RESUME` 一条路径清；其他"批量执行/批量重置"类 IPC handler（`BATCH_RUN_NEVER_EXECUTED` / `BATCH_RETRY_FAILED` / `BATCH_CLEAR_FAILED_AND_RETRY` / `BATCH_CLEAR_UNFINISHED` / `BATCH_RESTART_ALL`）都没碰它。结果用户在 BatchTaskList（非详情页）点"清空队列状态"清掉任务级状态后，项目仍卡在 paused 态，再点"批量运行" → 220 次 `enqueueRunTask` 全被 paused gate skip，UI 看不出任何反应。新增 `clearProjectPausedFlag(projectId)` helper（`setProjectPaused(undefined)` + `resumeProjectScheduling` + emit `project.resumed`），在上述五个 handler 开头统一调用——这些操作的语义本身就覆盖了"项目暂停"意图（用户主动要求重置或跑任务）。`BATCH_CLEAR_FAILED`（仅清失败状态、不入队）和 `BATCH_PAUSE` 本身不调用，保持暂停意图。

- **批量项目暂停时其他批量操作按钮没禁用，点了 UI 没反应**：项目处于 `pausedAt` 状态时，`enqueueJob` 会被 paused gate 拒绝，但 `BatchQueueStatus` 的「执行全部 / 重试失败 / 全部重新开始」按钮没跟着 disable，用户点了之后所有任务被 `enqueueJob` 静默 skip，UI 看不出来。改为这三个按钮在 `isQueuePaused` 时一律置灰；banner 文案改为「请先点『恢复队列』才能执行、重试或重新开始任务」，把行动路径写清楚。

- **批量项目「暂停」无法真正停下整个队列**：原 `BATCH_PAUSE` 只对 `task.status === "running"` 调 `pauseTask`，没有同步阻断调度器。当前任务被 abort 后，`startJob` 的 `finally { drainQueue() }` 立刻从内存 `pendingByProject` 队列里拉出下一个 pending 任务替补，导致用户点了"暂停"队列仍在继续推进。修复方案：(1) `BatchProjectMeta` 增加 `pausedAt` 字段并通过新 `setProjectPaused()` 持久化到 `.vetta/meta.json`，重启后 `registerBatchTasksIpc` 读回 meta 重建内存级 `pausedProjects` 集合保持暂停态；(2) executor 新增 `pauseProjectScheduling(projectId)` / `resumeProjectScheduling(projectId)` 维护内存集合，`enqueueJob` 与 `drainQueue` 入口都加 paused gate 拒绝调度，从根本上切断 worker 完成后的替补链路；(3) 暂停时被赶出内存队列的 pending 任务也持久化为 `status === "paused"`，与"从未执行过的 pending"区分，恢复时凭 `status === "paused"` 一次性 `enqueueResumeTask` / `enqueueRunTask`，避免把用户根本没启动过的任务带跑；(4) 新增 `project.paused` / `project.resumed` 事件，`useBatchTasks` hook 收到后更新 `BatchProject.pausedAt`，`BatchQueueStatus` 在暂停态显示「队列已暂停」横幅，并把"暂停全部"/"继续"按钮文案切换为"暂停队列"/"恢复队列"。

- **Linux AppImage 启动找不到 `dbus-next` / `x11`**：`dbus-next` 现在随主进程 bundle 内联打包，避免 AppImage 运行时查找外置 `node_modules`；同时用本地 `x11` shim 保留 `dbus-next` 的旧式 DBus 地址发现 fallback 边界，避免打包器提前解析其惰性 `require("x11")`。

- **Linux 批量项目多目录选择报错**：批量项目选择多个文件夹时，Linux Electron/Chromium portal 后端会把 `openDirectory + multiSelections` 错误收尾为单选目录选择，触发 `Got >1 file URI from a single-file chooser` 并丢弃结果。现在 Linux 下改为主进程直接调用 `org.freedesktop.portal.FileChooser.OpenFile`，同时传 `directory=true` 与 `multiple=true`，保留系统原生文件选择器体验；portal 不可用或失败时再回退到 Electron dialog。

- **Linux AppImage / unpacked 应用名统一为 Vetta**：packaged 主进程现在会把 console、未捕获异常、renderer/child process 退出、窗口加载失败、preload 错误等关键事件写入 Electron `logs/main.log`，启动时同步输出日志路径；同时修正打包 staging 的包名并显式设置 `executableName: "Vetta"`，避免 Linux unpacked 产物生成 scoped package 派生名称并触发 `xdg-settings: invalid application name`。

- **技能广场场景安装 / 卸载报 EACCES**：历史版本把临时 tar 包写到 `~/.vetta/scene/` 内，少数环境下该目录的 owner 写位被破坏（变成 `dr-xr-xr-x`）后，后续 install-from-market 写 `_tmp_*.tar.gz` 与 uninstall rmdir 子目录都会报 `EACCES: permission denied`。修复两点：(1) 临时 tar 改写到独立的 `~/.vetta/tmp/_install_*.tar.gz`，不再污染 baseDir；(2) install 与 uninstall 在动 baseDir / skillDir 之前先 `ensureDirWritable` 自愈，只补 owner 写位（`u+w`）不放宽其他权限位，自愈失败时让真正的写操作抛出更具体的错误。

- **Ubuntu 打包后显示 Electron 默认图标**：Linux electron-builder 配置现在显式使用 `build/icon.png` 作为应用图标，并把 `build/icon*` 作为 `extraResources` 打入安装包；主进程在 packaged 模式下从 `process.resourcesPath/build` 解析窗口 / 托盘图标，避免继续访问被排除在 `app.asar` 外的 `app.asar/build/icon.png`。

- **批量任务 Webhook 推送的状态分布表在飞书不渲染**：飞书 `lark_md` 与钉钉 markdown 都不识别 GFM 表格语法，子任务终态与项目汇总两条消息里 `| 状态 | 数量 |` 三行被原样输出。改成 `- 标签：**N**` 列表展示，两端渲染一致。

- **无感更新装完后启动仍弹"立即重启"对话框**：mac/linux 的 detached swap.sh 是异步执行的，安装成功后 `pending-install.json` 未必被及时清理；新版本启动时 `onAppReady` 仍读到该记录、又进入 ready 状态、再弹 Dialog。改为用版本号比较作为权威信号：若 `currentVersion ≥ pending.version` 说明已升级成功，直接清掉 `pending-install.json` 与 staging 目录；否则才恢复 ready 状态展示对话框。

### Added

- **无感更新（in-place auto-update）**：发现新版本后侧边栏左上角出现下载图标，点击触发后台静默下载（不打开浏览器、不打开 Finder），下载完成后弹出"立即重启 / 稍后"对话框；点稍后则保留下载产物，下次启动会再次提示。三平台均支持：mac 解压 `.zip` 内的 `.app`、清 quarantine 后通过 detached shell 覆盖 `/Applications/Vetta.app` 并 relaunch；win 走 NSIS `/S` 静默安装 + `--force-run` 自启动；linux 覆盖 `$APPIMAGE` 指向的文件后 relaunch。启动时自动 `GET /releases/latest?platform=&arch=` 检查一次，命中新版本（按三段式版本号比较）即激活 sidebar icon。下载产物写到 `app.getPath("userData")/updates/<version>/`，pending-install.json 记录"待重启"状态，文件丢失时自动重置。客户端按 platform/arch + 平台首选扩展名（mac `.zip` / win `.exe` / linux `.AppImage`）从 `assets[]` 里挑资产；未匹配平台或后端未上传对应资产时返回友好错误。配套发版资产规范见 `docs/release-guide.md`。

- **侧边栏会话默认折叠**：项目展开后默认只显示前 5 个 session，超过则底部出现「展开更多（N）」按钮；点击展开全部后按钮变为「折叠会话」，再次点击恢复 5 个。避免项目下 session 过多时一次性渲染导致的卡顿。

### Fixed

- **Linux 沙盒无法访问网络与本地 Action RPC**：Bubblewrap 不再创建独立网络命名空间，沙盒内现在可以执行 `npm` / `bun` / `pip` 安装、访问外部网络，并通过宿主机 `127.0.0.1` 连接 Desktop Action RPC；文件系统、PID、IPC 与 UTS 隔离保持不变。

- **Vetta action run 在 Windows 命令行无法解析 JSON 参数**：CLI 与桌面可执行入口现在会在原样解析失败后兼容剥离一层完整包裹的 shell 引号；开发模式下 `~/.vetta/agent/bin` 只生成 `vetta.exe`，并清理旧的 `vetta.cmd` / `vetta` shim，避免 Windows batch 二次解析吃掉 JSON 内部双引号。修复 `vetta action run appearance.theme '{"type":"set","mode":"light"}'` 在部分 Windows 调用链中导致 `json-input must be valid JSON` 的问题。

- **Windows 微信/Claw 发消息报 `acquire session: hostclient/local: subprocess exited during handshake`**：打包后的 `Vetta.exe --agent-rpc --mode rpc` 在 Windows GUI Electron 模式下 stdin 会很快关闭，coding-agent 刚完成 `createAgentSession` 就退出 0，im-gateway 因拿不到 `get_state` 握手响应而把 stderr 里的 perf 日志回显到微信。Windows 生产环境现在改为用同一个 `Vetta.exe` 设置 `ELECTRON_RUN_AS_NODE=1` 运行 `Resources/coding-agent/dist/agent-rpc-cli.mjs --mode rpc`，保留可用 stdio；打包阶段同步用 Bun 生成包含 `chalk` 等依赖的 agent-rpc 单文件 bundle，并把 coding-agent 完整 `dist` 放入 `Resources/coding-agent/`。

- **侧边栏无法拖拽收缩**：两层原因叠加导致 `ResizeHandle` 完全失效——(1) `ResizeHandle` 用 `translate-x-1/2` 让 5px 命中区域骑在 `<aside>` 右边缘，但 `<aside>` 与外层 `motion.div` 都是 `overflow-hidden`，外侧那 2.5px 被裁切；(2) 更关键的是 `styles.css` 中 `.sidebar-surface > *` 对 sidebar 所有直接子元素强制 `position: relative; z-index: 1`，把 ResizeHandle 的 `absolute z-30` 直接覆盖回 relative，导致它沦为 flex 流末尾的普通块、`right-0` 完全失去意义、根本拦不到拖拽。修复：把这条规则改为 `:not(.absolute)`（保留对玻璃质感 `::before` 的层级压制能力，但放过绝对定位子元素），同时把 `ResizeHandle` 改为完全位于父容器内部、宽度 6px，hover/active 高亮提升至 `primary/40`、`primary/60`。侧边栏宽度持久化到 `localStorage[vetta-sidebar-width]`，仅在拖拽结束时落盘。

- **导入项目后打开会话报 EPERM**：批量项目的 `.vetta/task-states.json:sessionPath` 与 session JSONL 首行的 `cwd` / 历史 tool_call 内嵌的文件路径都是绝对路径；跨机器或跨 workspace 导入时这些路径仍指向原项目根，导致 `SessionManager.open` 在 mkdir 旧 sessions 目录时报 `EPERM: operation not permitted`。修复：导入解压完成后，对 `.vetta/task-states.json` 与 `.vetta/sessions/*.jsonl` 做 path-rewrite——递归扫描 JSON / JSONL 中的字符串值，把以 manifest.originalPath 开头的绝对路径前缀替换成新项目根，并按目标平台规则化分隔符（macOS `/` ↔ Windows `\`）。重写策略保守：只匹配"完整等于"或"以原根 + 分隔符开头"的字符串，不影响指向原机器其它资源的外部绝对路径。

### Added

- **项目导入 / 导出**：项目详情页右上角新增「导出」按钮，点击二次确认后通过原生保存对话框输出 `<项目名>.vetta.zip`，包内含 `_vetta-export.json` manifest（format/version/type/name/originalPath/exportedAt）+ 项目目录全量内容（.vetta/sessions、batch 任务工作目录与 task-states.json 等），自动剔除 `*.lock` 文件锁与符号链接。侧边栏「新建项目」下拉菜单新增「导入项目」入口，原生打开对话框只接受 `.zip`，命中非本应用导出的 zip / 损坏的 zip / 缺失 manifest 时统一报「不支持的项目」。导入路径走 `desktop-config.json` 单一注册路径并解决重名（自动追加 `-2`/`-3`），导入完成后联动刷新普通与批量两个 atom 列表，提供「查看项目」直跳。仅支持 `normal` 与 `batch` 两种类型，flowing/schedule 类型在导出端自检拒绝、导入端 manifest 校验拒绝。Batch 项目导入后会扫描 `meta.json:items[].sourcePath`，对本机不存在的源路径以模态形式列出，便于用户后续重链或删除（不修改 meta，保留原路径以支持回链）。导入解压前对每条 zip 条目做 path-traversal 校验（zip slip 防护），失败时回滚已解压目录。

### Changed

- **批量项目改由 `desktop-config.json:projects` 单一注册**：批量项目以前完全靠扫描 `workspacePath` 子目录的 `.vetta/meta.json` 自动发现，导致用户切换 `workspacePath` 后已有批量项目从侧边栏消失。重构后批量项目与普通项目共用同一注册入口（绝对路径写入 `projects` 数组），workspace 仅作为迁移源——`discoverBatchProjects` 启动时仍会扫描 workspace，把未注册的 `type:"batch"` 目录幂等回填进 config，老安装无感升级。`createProject` 写盘后追加注册，`deleteProject` 删盘前先反注册（双向最终一致）。`useBatchTasks` 在 create/delete 后联动刷新 `useProjects` 的项目原子，避免新建/删除批量项目后侧边栏其它分组数据陈旧。`ProjectsPanel` 同步过滤掉 `type:"batch"` 的普通项目条目，保证批量分组与普通分组不重复渲染。

### Fixed

- 修复 desktop-app 开发模式不会写入可直接执行的 `vettaAppPath` 的问题；开发启动时会自动生成本地 CLI shim，并让 `vettaAppPath` 与生产模式一样指向单一可执行入口。
- 修复同一 desktop-app 进程内重复打开同一 session 时抛 `SessionLockError` 的问题。`RuntimeHost.createSession` 现在按 sessionPath 去重，已开的 session 直接复用 handle，不再二次申请文件锁；`renameSession` / `renameSessionById` / `deleteSession` 不再泄漏 SessionManager 与孤儿 `.lock` 文件；`WebContents` 销毁时会通过新增的 `disposeAllSessions()` 释放本进程持有的全部 session 文件锁。新增 `vetta:session:dispose` IPC 通道与 `window.vetta.session.dispose(sessionId)`，供 renderer 在关闭/切换 session 时主动归还锁。

### Added

- **HTML 转 PDF 命令行入口**：desktop-app 新增 `--html-to-pdf` / `pdf html-to-pdf` CLI 模式，使用内置 Electron Chromium 将 HTML 文件渲染为 PDF，并支持 `-h` / `--help`、`--output`、`--page-size` 与页边距参数，以及 JSON stdout 协议；packaged 启动时会向 `desktop-config.json` 写入 `vettaAppPath`，供独立进程发现桌面端可执行文件。
- **对话回答外层折叠**：桌面对话页现在会记录每轮 assistant 回答的起止时间，并在回答完成后自动折叠中间过程，只保留最后一次工具调用 / 思考后的结论文本；折叠提示支持“正在处理 Ns”的流式状态和“展开 / 收起 N 条内容”的完成态。

- **可配置的 Electron 打包入口**：desktop-app 新增统一的 `dist:desktop` 打包脚本，并补充 `dist:linux` / `dist:win` / `pack:linux` / `pack:win` 入口；支持通过命令行参数 `--platform`、`--arch`、`--target` 动态指定目标平台、架构与安装包格式，并为 Linux 提供 `dist:linux:appimage` / `dist:linux:deb` / `dist:linux:rpm` / `dist:linux:tar.gz`，为 Windows 提供 `dist:win:nsis` / `dist:win:portable` / `dist:win:zip` 快捷命令。Linux 打包前会校验 `packages/runtime-core/sandbox/linux/<arch>/bwrap` 是否齐备，避免产出缺少对应沙盒二进制的安装包。
- **Windows 前置依赖构建**：desktop-app 新增 `prepare:windows`，在 Windows 主机上会先执行仓库根目录的 [`scripts/build.ps1`](C:/yiyun/vetta-mono/scripts/build.ps1) `desktop` 目标，再启动 `dev` / `start` 或进入打包链；非 Windows 主机自动跳过，避免 Electron 开发和打包时缺少上游依赖产物。
- **Windows 沙盒资源打包与显式路径解析**：desktop-app 打包阶段现在会将 `packages/runtime-core/sandbox/bin` 整体复制到安装包 `Resources/sandbox/windows/`，并由主进程新的 Windows sandbox resolver 从 `process.resourcesPath/sandbox/windows/codex-windows-sandbox-host.exe` 解析 host 路径后显式注入 `RuntimeHost`。这样安装包与开发环境统一走 Electron `extraResources` 模型，不再依赖源码目录猜测路径。
- **Linux 沙盒内置 `bubblewrap` + 启动期能力探测**：desktop-app 主进程在应用启动阶段执行 Linux sandbox probe，区分 `binary_not_found` / `binary_not_executable` / `userns_unavailable` 等失败原因，并通过 `config.get()` 向 renderer 暴露 `linuxSandbox` 运行时状态；`session` IPC、scheduler 和 batch tasks 在请求 `sandbox` 模式前统一校验该状态，避免静默降级为 `full-access`。`prepare-pack.js` 同时预留了将 `packages/runtime-core/sandbox/linux/<arch>/bwrap` 打入安装包 `Resources/sandbox/linux/<arch>/bwrap` 的资源路径。
- **微信（iLink）渠道卡片 + 扫码绑定对话框**：`Settings → IM 集成` 新增「微信」渠道卡片，与飞书并列。点击「扫码绑定」打开对话框，对话框内通过 NDJSON 长轮询从 sidecar 实时接收 `wechat_qr` / `wechat_bind_status` / `wechat_bound` 事件，渲染 QR 图（`qrcode` 包，新增依赖），按状态机展示 idle → starting → waiting → scanned → confirmed → 自动关闭，过期自动刷新。
  - 「活动」徽章：标识当前激活的 transport（飞书 / 微信，互斥）。点击非活动卡片的「激活」按钮可在不重新填写凭据的前提下切换到该 transport。
  - 「管理 / 解绑」：已绑定后对话框显示 `ilink_bot_id` / `ilink_user_id` 与 24h/10 条配额提醒，并提供解绑按钮。解绑触发 `wechat_logout` 帧，sidecar 清空 `~/.vetta/desktop-app/im-wechat.json` 后回到 awaiting_bind 状态。
  - 总开关在微信模式下无需任何长效凭据：选中微信、未绑定时点击「启用」会自动弹出绑定对话框；已绑定后启用即拉起 wechat transport 长轮询。
- **IM 集成设置页**（`Settings → IM 集成`）：支持启用 / 停用 IM 桥接、填写飞书 App ID / App Secret / Verification Token / Encrypt Key、查看连接状态、测试连接、重启桥接、查看实时日志（最近 500 条），跨 macOS / Windows / Linux 三端可用。
- **嵌入式 im-gateway 桥接子进程**：desktop-app 主进程通过 `child_process.spawn` 启动 `im-gateway host` 子进程，stdio NDJSON 协议双向通信。完整生命周期由父进程管理：app 完全退出 → 桥接进程在 5s 内被发送 shutdown 帧 → 退出。
  - 健康检查：spawn 后 10s 内未收到 `ready` 事件视为启动失败。
  - 自动重启：异常退出 / 启动失败按指数退避（5s / 15s / 60s）重试，连续 5 次失败后停止并切换到 `error` 状态等待用户手动重启。
  - 跨平台终止策略：POSIX 走 SIGTERM → SIGKILL，Windows 走 `child.kill()` + stdin EOF。
- **凭据安全存储**：飞书 App Secret / Verification Token / Encrypt Key 通过 Electron `safeStorage` 加密后写入 `~/.vetta/desktop-app/im-credentials.enc`（chmod 0600）。
  - macOS Keychain / Windows DPAPI / Linux libsecret 自动选择。
  - Linux 无密钥服务时降级为强制 0600 明文存储，UI 显式弹窗告知。
  - im-gateway 子进程不直接访问任何凭据文件，全部由父进程注入。
- **跨平台二进制打包**：`prepare-pack.js` 在 electron-builder 之前调用 `make -C packages/im-gateway cross-build`，产出 5 个目标 arch 的 `im-gateway-<os>-<arch>[.exe]` 二进制，通过 `extraResources` 进入 `.app` / `.exe` / `.AppImage` 内 `Resources/im-gateway/`。运行时由 `binary-resolver` 按 `process.platform` + `process.arch` 解析。
- **旧版数据迁移**：检测 `~/.vetta/im-gateway/{config,credentials}.yaml` 与 `state.json`，弹出导入向导，导入成功后将旧文件重命名为 `.<timestamp>.bak`，避免重复提示。
- **IM IPC**：`vetta:im:get-config` / `set-config` / `get-status` / `subscribe-status` / `test-connection` / `restart` / `get-recent-logs` / `get-paths` / `detect-legacy` / `import-legacy` 端点，全部通过 preload 暴露为 `window.vetta.im.*`。
- **`SettingsTab` 类型扩展**：新增 `"im"` 标签项与对应导航条目。
- **`before-quit` 钩子**：确保完全退出 desktop-app 时 IM 桥接 sidecar 已被回收，无残留进程。

### Notes

- macOS 公证暂未启用：本期为内测版，分发的 `.app` 未通过 `notarytool` 公证。首次启动时 macOS Gatekeeper 会拦截，用户需手动在「系统设置 → 隐私与安全性」中放行（详见 [`docs/macos-bypass-guide.md`](docs/macos-bypass-guide.md)）。CI 配置与 entitlements 已为后续切换公证预留。
- 不接入 Sparkle / 任何自更新机制：未公证 .app 走自更新会触发更严格的 Gatekeeper 检查；当前的 `updater.ts` 是手动「检查 + 下载」模式，不会触发 Gatekeeper 重新校验。
