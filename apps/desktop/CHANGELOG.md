## [Unreleased]

### Added

- 设置中的「插件设置」升级为统一「工具配置」目录：由 Runtime Core Definition/Layer 聚合内建图片处理与插件设置，
  统一渲染可编辑 Schema、配置消费者及其 `native` / `adapter` 支持方式。敏感插件字段在进入 IPC 前删除；配置写入继续由
  Agent Settings 与 Plugin Settings 各自的持久化 Adapter 负责。没有配置的 Tool 不显示空条目。
- 侧边栏导航项支持**原色图片图标**：`SidebarNavItem` 新增可选 `iconUrl`，设置后导航项以 `<img>` 渲染而不染色，插件可用 `registerWorkspaceView({ iconTint: false })` 让自己的彩色 Logo 保持原样（`svg` / `png` / `webp` 等任意图像资源）。`icon` 仍是必填的 class 字符串并同时下发 mask 版本，因此不认识 `iconUrl` 的主题（含替换了 `sidebar.navItem` 组件的主题）继续渲染单色图标，不受影响。缺省仍为单色，与内置导航项保持一致。
- 插件工作区视图未声明 `icon` 时回落到插件自己的 `plugin.json` Logo（此前固定落到一个通用 widget 图标）：包内图片由宿主生成 mask class 承载，跟随主题前景色着色，因此自带图形的插件不必再去 Iconify 集合里找近似图标。导航项 `icon` 仍是 class 字符串，主题层（含第三方主题）无需改动。
- 新增宿主管理的通用浏览器自动化能力与系统插件**浏览器操作（Browser Use）**：ESM / Module Federation 插件可经 `ctx.browser` 使用按 namespace 隔离的 session 和持久 profile，manifest 权限与 `browser.allowedHosts` 在主进程逐次校验。Agent 通过单个结构化 `browser_operate` 工具完成导航、a11y 快照、文本读取和类型化页面动作，并以稳定 `profileId` 隔离多个媒体账号登录态；不再执行插件 CLI shim。宿主统一拥有 `agent-browser` 运行时、进程取消、profile 迁移、过期快照拒绝、越界 session 回收和脱敏日志。公共 v1 不提供 eval、上传、下载、Cookie/token 或任意 argv，attach 与运行时安装仅限 official 插件，QuickJS 不支持。见 ADR-0088。
- 插件 AI 能力新增无状态多轮对话 capability `cap.domain.vetta.ai.chat`（`ctx.ai.chat`）：插件自持全量消息转写（user / assistant / toolResult），可携带仅本次请求可见的插件内部工具；模型触发工具调用时按 `stopReason: "toolUse"` 原样返回 `toolCalls`，由插件在自身 loop 内执行。权限沿用 `ai.complete`，宿主不保存任何插件会话状态。

### Fixed

- 修复消息列表中的用户消息含图片时，复制后粘贴回输入框只剩文本、图片无法还原的问题；消息复制现在以同一份
  系统剪贴板条目写入纯文本、富文本和图片，支持多图并保持图片 token 顺序。复制本地图片不再经过 Renderer
  重复读取、base64 编码和 Main 进程 PNG 重编码；粘贴 Vetta 富消息现在由 Main 直接解析并落盘，只向 Renderer
  返回路径和压缩文件元数据，监控统计也复用该元数据，不再为同一批图片额外解码像素。大图粘贴不会再因跨进程
  往返搬运 base64 或监控重复解码而长时间阻塞输入线程、制造大量临时内存；普通截图和外部图片的兼容路径也改为
  文件路径或二进制字节直传，并在单次编辑器事务中批量插入全部图片，避免逐图触发 React 渲染与 DOM commit。
  图片内容、token 顺序和外部粘贴行为不变。
- 修复创建新会话时 Desktop 同时把 RuntimeHost Observation Publisher 与同一个应用 Hub parent 注入 Coding Agent，
  导致 Composition 以“双上游”拒绝初始化的问题。现在 RuntimeHost Publisher 是唯一上游，Hub 的局部路由、容量和故障诊断配置仍保留。
- 修复消息下方存在插件卡片时，Agent 流式输出期间整页持续抖动：宿主此前把插件的 `pendingFor` 回调结果当作每帧渲染的唯一事实源，该回调读插件自身状态、相邻两帧可能返回 `null` 或不同 `key`，导致在途工具的骨架卡在「有 / 没有」之间反复翻转、卡片区高度来回跳。现在同一个在途 tool call 只认第一次合成成功的 descriptor 直到它落定，卡片归属表与本条消息的原始卡片列表在内容不变时复用旧引用，卡片子树不再随每个 token 重建。同 `key` 只挂在最后产出它的消息下这一语义保持不变。
- 修复 Vetta UI Design 的设计预览进程在插件热重载或异常退出后，Canvas 仍持有旧 localhost 端口并为每个画框重复报 `ERR_CONNECTION_REFUSED`：进程退出现在会立即撤掉旧端口消费者并有限退避重启，离屏截图同时作为失联后备探针；一分钟内连续失败超过三次才停止自动恢复并显示可手动重试的错误。
- 修复开发态页面热刷新后 Plugin Agent 工具、Hook 与动态 Prompt handler 偶发统一报 `handler not found`：插件宿主 bridge 的 handler 表、IPC listener guard 与会话订阅现在由 renderer 全局单例持有，模块被 HMR 重新求值时不会再创建一套空 registry 和重复监听器；正式的 activation / Turn generation 隔离与释放语义保持不变。
- 修复 Vetta UI Design 渲染机检把同一行的 checkbox + 文案、tab 下划线等多个 DOM rect 误判成文字换行，以及把 `items-center` / baseline 布局中正常的 top edge 差异误判成错位的问题；重复截同一画框前会清除旧绘制完成标记，避免复用离屏窗口时读到上一轮画面。

### Changed

- Runtime 生命周期日志 Adapter 现在也接收 `runtime.active-session.lifecycle`，统一记录活动 Session 监听器与切换清理的
  内容安全失败字段；不会写入 Session 路径、事件正文、Prompt 或原始错误文本。
- Desktop Runtime lifecycle 日志 Adapter 现在接收动态主 Agent Backend admission 的统一 Observation；安装、替换、停用与
  失败记录只包含 Agent/Definition/Backend revision、Source、lease 计数和分类错误，不记录配置、Prompt、路径或错误正文。
- Desktop Plugin Runtime 改为独立的 Coding Agent 配置 Source，由各 Session 订阅并在产品 Turn 边界应用；主进程不再把
  Plugin invoker、配置和额外 Skill 写入通用 RuntimeHost。自动标题、下一问、后台任务与 Subagent 命令统一调用 Coding
  Agent Session Extension；配置和会话辅助的安全 Observation 汇入现有应用 Hub 与结构化日志。
- Desktop 根 Runtime Observation Hub 现在汇聚 Coding Context Prefire 与 Subagent issue 诊断并投影为安全结构化日志；
  只记录 Session identity、阶段/操作、token 计数和失败 name/code，不记录摘要、任务、路径、对话、凭证或错误正文。
- Coding SessionEnd Hook 失败也进入同一根 Hub 的安全 lifecycle 日志，不再输出可能包含原始异常正文的直接 console 日志。
- Desktop 将 RuntimeHost 的统一 Observation Publisher 传入工作区 Coding Composition 和自动重试装饰器；重试调度、
  成功、取消、耗尽及 `Retry-After` 超限会写入主进程结构化日志，仅包含 Session/Turn identity、次数、延迟、失败
  code/origin 和枚举原因，不记录错误正文、Prompt 或用户内容。
- Desktop Coding Backend Pool 不再维护 RuntimeHost Session/assessment 的影子索引；Coding-only Scope 对其它主 Agent
  选择 fail-closed。Pool 关闭改为可重试所有权事务，失败后保留未完成 Composition/MCP Source，再次关闭只重试失败项；
  Agent Instance Pool 的复用/退休原因继续通过统一 lifecycle Observation 投影到安全日志。
- Desktop Coding Agent 改用唯一进程级 `RuntimeHost` 内置的 Agent 控制面：内置 Definition 在 Backend factory 发布，
  各工作区 Composition 创建独立且固定 revision 的 Instance。关闭时只调用 `RuntimeHost.close()`，由其统一释放
  Session、Backend Pool、Instance 与应用 Observation Hub；关键
  revision、Session identity rebind，以及 Session/Backend/Agent 控制面关闭失败通过同一个安全 lifecycle Observation
  Adapter 投影到日志，不记录 Prompt、Tool/MCP 数据或原始错误正文。
- Coding Agent Session 初始化日志改由进程级 Runtime Observation Hub 路由；产品初始化 Token、Tool 与 Session
  安全摘要现在先经过各 Composition 自有的 Coding Agent 子 Hub，再汇入进程级应用 Hub；日志 Adapter 仍只输出原有的
  阶段耗时聚合，关闭子 Hub 不关闭应用 Hub。
- 流式期间进行中的思考卡片不再提升到消息末尾，改为就地渲染在该 thinking 原本所在的位置（包括某个阶段组内部）：正文仍在约 3 行高的窗口里随流式内容缓动上滚、上下边缘渐隐，但它跟随所属阶段组的折叠状态，组收起时不再从组里跑到消息底部。思考结束后同一位置换回「思考」折叠条；由于卡片不再脱离原位常驻，最短可见时长与出场动画一并移除。
- 新会话的自动标题改在首条消息通过 Runtime 校验并进入 Turn 时立即异步生成，不再等待 Agent 回答完成；标题生成只依赖用户已发布的消息，并由主进程统一覆盖前台聊天、插件发送与调试会话入口。
- Vetta UI Design 的 UI 验证支持一次选择多张或全部画框：源码机检每批只跑一次、截图复用专用离屏会话，并返回一张可一次读取的总览图；单帧调用保持兼容。验证状态会按画框记录源码保鲜度，并在画面和问题连续两次不变时提示停止盲改；`vetd_status` 也不再把 source-only 的空 `issues` 当作 UI 已验证。

- 工作模式注册表迁入 Desktop（`src/main/agent-modes/`，ADR-0071 归属修订）：`modes/*.md` 是唯一事实源，
  经 `bun run generate:agent-modes` 内联成注册表，模式提示词正文在会话创建时按固化的 `agentMode` 注入
  coding-agent 的 `core.mode` 槽位。此前注册表住在 coding-agent 并把 `icon`、`narration` 这两个纯渲染层
  字段一并放在那里。新增模式仍是「一份 md + i18n 文案」，用户可见行为与历史会话模式记录不受影响。

## [0.5.48] - 2026-08-24

### Added

- Agent 消息流式渲染时，进行中的思考被提升到消息最下方，以一块轻量卡片常驻展示：不管它属于哪个（通常是折叠着的）阶段组，都能直接看到正文在约 3 行高的窗口里随流式内容持续缓动上滚、上下边缘渐隐。卡片只有圆角与淡背景、无边框无标题栏，有展开/收起的入场与出场动画，并保证至少可见 1.5 秒——模型吐字很快时思考不会一闪而过；停留期间又开始新一段思考会就地换成新内容并重新计时，卡片全程不卸载，因此不闪。思考结束后卡片消失，内容回到原位的「思考」折叠条（原位不与卡片重复渲染）。开启「减少动态效果」时窗口只贴底不做缓动；导出快照不含该卡片。

- 长会话达到 8 轮后，会话区域左侧会悬浮出提问目录（不占消息列宽度）：刻度标出每条提问，悬停时刻度向右加宽并预览最多三行提问正文、点击跳转；点图标在刻度右侧展开可搜索的提问列表，跳转后目录保持打开，点空白处、关闭或 Esc 再收起。会话区窄于 52rem 时整条目录自动隐藏，避免压住右对齐气泡。不再按「轮次 / 你 / Vetta」铺开双栏时间线。导航复用虚拟列表索引，跳转时会暂停自动追底，回到底部后恢复正常跟随。

- Claw 的飞书渠道改为扫码接入：在「设置 → Claw → 飞书」点「扫码接入」，用飞书扫码并在页面上确认应用名称与权限，飞书就会替你创建机器人应用——所需权限与 `im.message.receive_v1` 事件订阅已预填，App ID 与 App Secret 由桥接回传后自动存到本机凭据（`im-credentials.json`，权限 0600），不必再去开放平台创建应用、开机器人能力、勾权限、发版本、抄两串密钥。Lark 租户会自动把 API 域名钉到 `open.larksuite.com`。原先手填 App ID / App Secret 的表单保留在扫码对话框底部的「手动填写」入口，供不允许自助创建应用的企业使用。飞书渠道描述符的凭据形态相应改为 `scan-or-static`：未配置凭据时 sidecar 停在 `awaiting_bind` 等待扫码，而不是拒绝启动。

- Claw 八个渠道的对话框说明与「使用说明」手册改写成面向普通用户的口径：只讲去哪点、扫哪个码、贴哪串东西，去掉长连接、Socket Mode、Bot API、长轮询、chmod 0600 这类实现细节；对方平台界面上要照着找的字样（BotFather、Socket Mode、MESSAGE CONTENT INTENT、完全磁盘访问权限等）保留。

- Claw 每个渠道都可以解除绑定：飞书与通用渠道对话框（Telegram / Slack / Discord / Signal 自建服务 / iMessage）新增「解除绑定」，二次确认后清除本机保存的凭据与账号标识；解除的若是当前渠道且清空后已无法启动，会顺带关闭桥接并停掉 sidecar。清空逻辑收敛到 `im-host/channels.ts` 描述符的 `clearConfig` / `clearCredentials`，微信、WhatsApp、Signal 的解绑仍沿用各自扫码流程的 API（那条路要让 sidecar 一并丢掉自己持有的会话）。
- Claw 渠道网格补齐 Slack、WhatsApp 品牌图标，并更新飞书图标。
- Claw 每个渠道的配置对话框（飞书 / 微信 / Signal / 通用渠道）标题旁新增「使用说明」入口，点开是一个二级引导弹窗：编号步骤 + 可复制的命令或地址 + 提醒块，视觉与「知识库是怎么工作的」同一套。八个渠道的手册内容与 `apps/im-gateway/docs/*-setup.md` 对齐，中英文齐备。
- Claw 的 Signal 渠道改为扫码接入：装好 signal-cli 后，在「设置 → Claw → Signal」点「扫码连接」，用手机 Signal 的「已关联的设备」扫码即可，桌面端会自动找到 signal-cli、托管 daemon 并回填账号号码，不再需要手填服务地址与 E.164 号码。未安装 signal-cli 时对话框直接给出本平台的安装命令。原先「连接自建 signal-cli 服务」的表单保留在对话框底部的高级入口。
- IM 桥接主进程新增六个渠道的协议与配置合同：Telegram、Slack、Discord、Signal（静态凭证）、WhatsApp（扫码配对，含 `vetta:im:whatsapp:*` 绑定 IPC）与 iMessage（macOS 本地权限）。渠道能力收敛到 `im-host/channels.ts` 描述符注册表，测试连接按渠道分派校验；本次仅覆盖主进程与 preload 合同层，设置页 UI 与 i18n 文案随后续任务提供。

- 新增可选的手机远程接入宿主：Desktop 可主动连接 Cloudflare Worker 中继，将本地对话会话暴露为受版本化协议约束的远程请求；屏幕画面和鼠标键盘输入使用独立 WebRTC 通道，输入默认关闭并由本地配置显式授权。
- 开发环境的 Vetta Debug 新增只读 `provider.models.list`，可刷新并列出 Runtime 当前可用的本地模型与登录后远程模型；
  返回值只包含模型身份、来源和公开能力元数据，不读取凭据、不发起模型请求。
- 开发环境的 Vetta Debug 新增 `conversation.compact`，可对持久会话手动执行生产 Runtime 的上下文压缩；
  Desktop 主进程同时记录自动/手动压缩的阈值、Token、结果、耗时和脱敏失败原因，打包环境不注册该调试命令。
- 插件工作区视图页头支持沉浸模式（`immersive`）：页头浮在视图之上、视图占满全高，拖拽区与侧边栏触发器仍在最上层。设计画廊首页据此把 Hero 铺到窗口顶端，页头不再在顶部推出一条空带。
- 插件工作区视图可以接管宿主页头：宿主按当前路由应用插件推来的标题隐藏与左右两簇内容（渲染在该插件的 i18n 目录与 CSS 作用域内，出错只吃掉这一簇）。设计画廊据此把「设计 / 搜索 / 刷新 / 导入 / 新建」搬进顶栏，页面顶部不再出现「应用名 + 插件顶栏」两条叠加的栏。
- 新会话页在 hero 与输入框之间新增会话前置选项行：左侧是项目选择 popover，可选范围与侧边栏「项目」区一致
  （不含默认「对话」、批量任务项目与归档项目），顶部固定一条「不指定项目」用于回到未选中态，项目超过 5 个时
  出现搜索框（大小写不敏感的名称子串匹配，支持 ↑↓ 与回车选中）。默认值跟随入口：从某个项目进入即选中该项目，
  从「对话」或非项目入口进入为未选中。选择只作用于页面本地，不切路由，因此输入框里已经打好的内容不会被换走；
  发送目标、@文件补全、拖拽落点、活动面板、技能列表与顶栏上下文 badge 都跟随选中项目。
- 项目选择 popover 支持「新建项目」与「打开本地项目」。新建复用「新建项目」对话框，但确认后只登记待创建意向，
  真正的目录与 config 落盘推迟到用户点发送那一刻；准备期间发送按钮展开为带「正在准备项目」文案的胶囊，
  创建失败时保留输入与选择并弹出错误，不做任何导航。
- 发送按钮新增可选的 `pending` 变形能力：宿主传入文案后按钮就地展开成带标签的胶囊、显示指示器并拒绝点击，
  供其它「发送前还有一步准备」的场景复用。

### Fixed

- 修复插件动态系统提示词返回未授权操作时，IPC response handler 同步抛错并留下未决 Promise、随后只能等待超时的问题；响应校验失败现在会立即以 Promise rejection 传回 Runtime。Vetta UI Design 同时补齐动态工具开关权限并升级插件版本，使新权限能进入安装授权流程。
- 修复提问目录点击刻度后高亮落到上一条提问的问题：当前提问不再取 Virtuoso 的已渲染范围起点（含 overscan 撑出的视窗外条目），改为按实测偏移与 scrollTop 求真正贴着视窗顶部的那条消息。

- 修复提问目录搜索面板在提问较长时出现横向滚动条的问题：列表改为横向不可滚动，超出宽度的提问与匹配片段一律省略号截断。

- 修复飞书扫码接入后「机器人连上了但发消息没反应」：扫码创建出来的应用可能没有生效的事件订阅，桥接会在连上之后自动把投递方式设为长连接并补上接收消息事件；补配置失败时把平台原因写进 Claw 的状态栏与日志，并提示去开放平台手动开启，而不是停在一个看似正常的「已连接」上。

- 修复 Agent 在后台会话调用 `vetd_create` 时，设计标签错误写入当前前台项目、导致目标会话的标签列表缺少「设计」的问题；Activity Tab 宿主命令现在可按显式 cwd 写入 attach 与 active-tab 状态。
- 修复 Linux packaged E2E 真正启动应用后的两项误报：unpacked 可执行文件现在使用同批构建的 AppImage 作为更新器运行上下文，主进程 mock 探针改用同步 Electron API，避免 CDP 在异步 mock Promise 跨进程返回前将其回收。
- 修复 Desktop packaged E2E 的后续三平台失败：构建产物默认禁止 `electron-builder` 在 CI 中隐式发布，打包矩阵显式安装 IM gateway 所需的 Go 工具链与 Linux Electron 所需的 ALSA 运行时；Ubuntu 24.04+ CI 通过 Electron Service 为测试可执行文件安装作用域受限的 AppArmor profile；Windows E2E 直接驱动版本目录中的 Electron 而不是会分离子进程的稳定启动器。
- 修复配置了系统代理时 Claw 无法连接海外 IM 平台：im-gateway sidecar 是 Go 进程，只认 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 环境变量，不读 macOS 与 Windows 的系统代理设置；而 Electron 自己会跟随系统代理。于是在「系统里配了代理但没有导出对应环境变量」的机器上，Vetta 本体联网正常、sidecar 却直连并被重置，Discord 表现为 `Get "https://discord.com/api/v9/gateway": EOF`，其余需要代理的渠道同样连不上。现在主进程用 Electron 自己的 `session.resolveProxy()` 解析代理，并把结果作为环境变量注入 sidecar 进程；父进程已显式设置代理时以其为准、不覆盖，解析失败则按直连处理、不阻塞桥接启动。受进程级环境变量所限，逐主机返回不同结果的 PAC 脚本只会应用其中一条。
- 修复 Claw 渠道配置对话框保存时损坏 Discord 与 Slack 的允许列表：读取时把「用户允许列表」和「服务器/频道允许列表」合并显示在同一个输入框，保存时却把全部内容写回用户允许列表。后果是服务器 ID 或频道 ID 被当成用户 ID，网关据此丢弃全部私聊消息且不产生任何日志，表现为「显示在线但机器人不回消息」；同时原有的服务器/频道允许列表被清空。现在输入框只呈现并写回用户允许列表，服务器/频道允许列表原样保留。
- 修复 Vetta Claw 设置页切换消息渠道、更换对话模型后界面不更新（重开设置页才看到新值）的问题：写入成功后的配置刷新只回填了对话框表单，没有把最新配置写回页面状态。
- 修复干净 CI 环境下 Desktop 三平台打包烟测无法进入 packaged E2E：打包前现在统一按 workspace 依赖图生成声明与产物，Windows 不再使用漂移的独立构建顺序；Linux runner 同时显式安装 Bubblewrap 源码构建依赖。
- 修复启用语音输入能力后手机桌面预览完全黑屏的问题：全局媒体权限策略此前只允许主窗口麦克风，导致远程桌面隐藏宿主的 `getDisplayMedia` 在屏幕源选择前被拒绝。现在仅对白名单中的远程桌面主 Frame 放行 Electron 屏幕捕获的两阶段权限请求，仍拒绝其摄像头、音频、子 Frame 及其它 Renderer 请求；屏幕源授权、拒绝和枚举失败也有脱敏日志可查。
- 修复手机成功连接但桌面预览始终为空的问题：此前 Desktop 在二维码生成时立即发送一次 WebRTC offer，手机稍后进入预览时 Worker 会因 viewer 尚未在线而丢失该 offer 并关闭 host。现在 Worker 在双方信令端点都在线后发送不可由客户端伪造的 `peer_ready` 事件，Desktop 收到后才发起协商；Android 同时保证本地 description 成功后再发送 answer，并在 renderer 延迟创建时补挂视频轨。
- 增加独立的 Desktop 生产边界自动验证 workflow：始终检查打包资源合同，触及主进程、preload、打包配置、原生依赖或远程控制时自动构建 Windows unpacked 包并运行 packaged smoke，避免开发态与生产态目录差异只能在发布后暴露。
- 新会话首条消息期间插件页签与输入栏动作整体消失：会话打开流程把「派发首条 Prompt」当成一步 `await`，而 `session.prompt` 的 IPC 要到整轮回答结束（或用户暂停）才返回，导致 `getState` 回填被整轮挡住——对话场景停在未知（`null`），依赖场景的插件页签（设计、内容创作等）从活动面板和「+」里一起消失，激活工具集、上下文用量与本会话工作模式同样滞后，本轮内的后续发送还会一直等待过渡结束。现在首条 Prompt 只派发不等待，回答仍在流式输出时会话状态就已回填。
- 修复生产包生成远程配对二维码时隐藏桌面主机加载失败的问题：打包态现在从 staging 根目录加载 `renderer/` 与 `preload/` 资源，并在加载异常时清理窗口、IPC 监听器和屏幕捕获处理器。
- 打包版启动即崩（`Cannot find package 'ws'`）：主进程被标成 external 的运行时依赖需要同时写进打包 staging 清单，`ws`（远程接入中继连接）与 `koffi`（Windows 远程输入注入）此前只标了 external 却从未随包分发，asar 里根本没有这两个包。现在 external 清单与 staging 清单合并为同一份定义（`scripts/packaged-native-dependencies.mjs`），并由测试保证任何 external 都必然被某个平台 stage，不会再出现「只加一半」。
- 模型选择 popover 不再需要重启或刷新应用才能看到服务端的模型增删：本地 `models.json` 与远程模型目录收敛为一份共享数据源，打开模型菜单、窗口重新获得焦点或从后台切回时按 TTL（60 秒）后台重新拉取，先展示旧列表再无感替换；拉取失败保留上次结果并进入 10 秒冷却，登录/登出与设置页保存则直接绕过 TTL 强制刷新。设置页保存本地模型后，已打开的选择器也会立即同步。

### Changed

- 用户发送消息后，Vetta 会在模型首个内容到达前立即显示带头像、名称与等待耗时的 Assistant 消息头；thinking、工具或正文到达后在同一条消息内接管。运行时间改为由消息的绝对开始时间派生，切换会话后继续累计，并按秒、分、小时自适应显示。
- Work 模式的折叠工具组在 Agent 运行期间改为显示当前工具阶段、调用说明或最新 thinking 摘要，不再长期停留在笼统的「正在处理」；并行调用优先展示仍在执行的工具，阶段完成后恢复稳定的阶段总结，完整工具与思考内容仍保留在展开区。
- 重做 Vetta Claw 设置页：新增概览卡直接展示当前活动渠道、连接状态、总开关与对话模型；渠道网格改为自适应列宽，飞书、微信、Telegram、Discord、Signal、iMessage 使用品牌图标资源，Slack 与 WhatsApp 暂用单色图标，活动渠道用 ring 高亮、未配置渠道走虚线弱化态，整卡点击即切换活动渠道、右下角齿轮进配置，替代过去每卡两个等权重按钮；保存与切换的成功/失败结果改为在页面上以提示条呈现（此前只有飞书对话框内可见，主页面开关失败是静默的）；状态与日志收敛为一条紧凑信息栏。渠道名称、图标与配置入口收敛到单一渠道表，新增渠道只需增加一行。
- Desktop 打包新增跨平台环境前置检查，在清理和编译前统一校验开源/商业版本、服务端与更新源、Marketplace、目标平台、遥测参数和 macOS 签名组合；新增 `dist:opensource` 作为 Windows、macOS、Linux 共用的开源版构建入口，GitHub Releases 与开源版、R2 与商业版不再允许混用。
- Desktop 正式发布 Action 新增独立质量门禁：根检查、质量脚本测试和 packaging 合同测试全部通过后才启动平台矩阵；R2/GitHub 发布完成后验证三平台公开更新 feed 与其引用的安装包可读；默认手动构建只保留临时 Artifact，手动 `test` / `stable` 发布与 tag 发布走同一发布门禁。
- Desktop packaged E2E 扩展到 Windows、macOS、Linux：真实启动 unpacked 应用并通过 renderer updater bridge 检查本地隔离 feed，发布矩阵在上传产物前即可发现启动、`app-update.yml`、feed 请求和 IPC 回归；本地 feed 不会触碰真实生产更新源。
- Desktop 发布 workflow 支持通过 `workflow_dispatch` 发布隔离的 R2 `test` 通道；`build_version` 只允许用于 test channel 并注入 `VETTA_DESKTOP_BUILD_VERSION`，测试升级候选不会覆盖 stable，R2 凭据使用独立的 `desktop-test` Environment。
- 新增 `desktop-upgrade-e2e` workflow：从 test channel 基线包开始，在 Windows、macOS、Linux runner 上真实安装、检查更新、下载、退出、重启并校验候选版本；失败时保留应用日志和升级状态，生产 stable 不参与该验收。
- Desktop 打包未配置更新源时默认使用官方 stable 更新源，并在显式传入不支持的 `none` provider 时于构建期失败，避免安装包缺少 `app-update.yml` 导致检查更新时报 `ENOENT`。
- 打包版不再向终端用户暴露开发者工具入口：应用不再沿用 Electron 默认菜单，改为自建应用菜单——macOS 保留完整的应用/编辑/视图/窗口菜单（复制粘贴等 Edit role 不受影响），但打包版的「视图」不再包含重新加载、强制重新加载和切换开发者工具；Windows/Linux 打包版直接不装配应用菜单，对应快捷键一并失效。桌宠右键菜单的 DevTools 项沿用同一门禁。开发态行为不变，打包版排障可用 `VETTA_DEVTOOLS=1` 启动重新打开这些入口。
- 自动更新不再只在启动时检查一次：应用保持运行时每 2 小时后台重查一次；系统从睡眠唤醒、以及用户打开侧边栏底部的设置菜单时也会机会性补查一次（距上次检查不足 30 分钟则跳过）。所有后台补查只在空闲或上次检查出错时发起，不会打断已经在下载或已就绪的更新。长期不退出应用的用户不再长时间收不到新版本提示。
- 子代理与工作流活动面板新增实时 Todo、Token/费用、结构化目标和分类错误展示；状态图标统一为 Solar，运行/失败使用主题语义色，选择与状态变化使用 200ms 过渡，并补齐长内容与水平溢出处理。

- 设置-账户的「Token 活动」在「累计」模式下改用平滑面积曲线（保单调的三次插值，陡升段不会出现向下过冲的假回落）：累计值单调递增，方块矩阵只能表达相对当前窗口最大值的强度，越用越接近整屏填满。曲线从首次有用量的那一天起画，不再为了凑格子在左侧铺一段无信息的零平线，也不像方块模式那样丢弃最早的历史（超出宽度时等距降采样）。「每日」「每周」仍是方块矩阵，悬停 tooltip 与月份刻度保持不变。
- 侧边栏移除「项目」与「对话」之间的分栏拖拽条：两个区块改为共用同一个滚动区，按内容自然排布，不再有可拖拽的高度分配、展开项目时的自动占比调整，以及分栏比例的本地持久化（`vetta-sidebar-projects-split-ratio`，旧值不再读取）。
- 助手消息底部的复制按钮图标换成 `solar:copy-linear`（复制成功后的对勾不变）。
- 对话页助手消息底部的「本轮 Token」面板改为点击展开（此前 hover 即弹出），图标换成 `solar:chart-square-linear`。面板重排：缓存命中率提升为顶部主指标（大号数字，与缓存读取同色），总计 Token 并列右侧；读写观测覆盖率与前缀诊断（稳定/动态提示词字符、前缀状态、变化提示词块与工具、请求前缀指纹等）统一收进默认折叠的「更多参数」。构成条指标改名为输入 / 缓存命中 / 缓存写入 / 输出，Token 数值统一按 K、M 缩写显示（精确值移到 title），数值为 0 时显示「--」。消息列表滚动时面板自动关闭，不再挂在错位的锚点上。
- 低配机性能手术（详见 `docs/desktop/sidebar-perf-081826.md`）：
  - 侧边栏动画全面去 JS 化：导航高亮条改 CSS transform 过渡，项目组展开/折叠与输入栏附件区改纯 CSS
    grid 过渡（动画期间零逐帧 JS 测量），滚动辅助观察者 rAF 合帧并停用全子树监听；`prefers-reduced-motion`
    一律直出。视觉上由弹簧手感换为 200ms ease-out，属有意简配。
  - 发送消息不再被插件宿主热重载挡住最长 5 秒：prompt 前只等待插件宿主**首次**激活（冷启动首轮发送
    仍保证插件工具 schema 就绪）；ChatView/用户气泡收窄 atom 订阅并稳定 header 引用，消除发送与流式
    期间的级联重渲染。
  - 「能力」页首开剥离详情抽屉子树（react-markdown + shiki 不再进首开 chunk）、图标懒加载，并在启动后
    空闲期预取能力页 chunk；设计插件入口 chunk 836KB→216KB（画布/画廊/导出/预览/历史 runner 均按需
    加载），进入画廊不再强制重拉设计体系清单。
- 工作模式切换从 hero 内部移到新的选项行，与项目选择器同高、同为 `rounded-lg` 圆角矩形；它是全 App 唯一的
  模式入口，不再依赖可被主题整块替换的 hero 实现。
- 「新建项目」对话框在确认时校验重名。侧边栏与新会话页两个入口都会拦下同名项目，此前重名会静默复用已有目录，
  用户以为新建了项目、会话却落进旧项目。

### Fixed

- 修复 macOS 上 ⌘Q 退出应用后系统弹出「Vetta 意外退出」崩溃弹窗的问题（进程实际以 SIGTRAP 结束）。
  根因是全局键盘监听：主进程既在 worker 线程里 `uIOhook.start()`，又在主线程 import `uiohook-napi`
  只为取键码常量，于是两个 Node Environment 各注册了一份 napi 清理钩子，而原生侧的「监听中」标志是
  进程级共享的；退出时主线程那份钩子会替 worker 调 `hook_stop()`，对已失效的 CFRunLoopRef 取运行模式即崩溃。
  现在主线程改用本地键码常量、不再加载原生模块，退出前先让 worker 自己跑完 `uIOhook.stop()`（超时才硬终止）。
- 修复手机扫码配对后 Desktop 主进程因缺少浏览器 `WebSocket` 全局对象而持续重连、无法接入中继的问题；
  改用明确注入的 Node WebSocket 实现，并合并同一次失败触发的重复重连调度。
- 修复手机完成首次配对后仍使用一次性 bootstrap、导致 Desktop 或手机重启后无法恢复连接的问题；已有配对优先使用恢复凭据，失败时才回退当前二维码，并且只在连接成功后持久化新凭据。
- 远程对话不再把 Provider 原始错误（包括 API Key 摘要）透传到手机；Desktop 现在按运行时失败合同映射稳定错误码，手机展示可操作的模型认证、限流、超时或连接提示。
- 修复远程配对页始终显示“等待手机”的问题；Desktop 现在同步显示连接中、已连接和连接失败状态，并在连接状态变化后保留撤销配对与输入权限控制。
- 侧边栏打开已有会话时会立即切换选中态和草稿作用域；历史快照通过只读文件通道优先渲染，再恢复 Runtime 状态与实时订阅。打开过渡不再展示 pending 文案、替换顶层骨架或禁用输入与消息操作：发送会立即捕获内容并乐观上屏，依赖 Runtime 的操作在内部等待目标订阅就绪。右侧消息列表持续展示完整 Markdown、工具调用和插件卡片，Virtuoso 只分阶段调整屏幕外预渲染范围。Runtime 历史只替换真正变化的消息，并保留恢复期间接受的乐观消息。快速连续点击采用 newest-wins，旧请求与旧操作不会覆盖或误作用到新会话；跨进程诊断日志可按 `interactionId` 关联 Renderer、React 提交、Main 与 Coding Agent 初始化阶段。
- 修复带附件的排队消息被 turn 消费后，agent 回复完成时会话末尾残留一条重复用户气泡的问题。根因是排队路径
  把附件等上下文拼进 user 正文，落盘文本与队列条目 `displayText` 不一致，乐观对账按文本吸收失败；现在排队
  消费与空闲直发同形，上下文以 contextRecords 投递（ADR-0060 遗留优化落地），user 消息保持纯文本，且队列
  镜像补的气泡改为按文本 + 序号吸收。历史会话中已按旧格式落盘的消息不迁移，其气泡仍显示内联的附件前缀。
- 修复全局键盘手势整体失效：快捷面板（双击 ⌘ / Ctrl）与应用快照（左右修饰键同按）在开发和生产环境都无法触发。
  两个原因叠加，前者掩盖了后者：
  1. uiohook 宿主入口路径写成了 `new URL(<字面量>, import.meta.url)`，Vite 将其识别为静态资源引用并把宿主源码内联成
     `data:` URL，运行时 `fileURLToPath` 抛 `ERR_INVALID_URL_SCHEME`，宿主重试 3 次后放弃启动。现改为按同目录路径拼接解析，
     并加入源码守卫测试（`uiohook-host-entry.test.ts`）防止该写法再次进入主进程。
  2. 宿主起来之后仍收不到事件：Electron utilityProcess 内的 CGEventTap 至多投递一个事件就永久失聪，双击 ⌘ / 双 Shift
     同按依赖的修饰键事件（macOS `flagsChanged`）一个都收不到。现把 uIOhook 宿主从 utilityProcess 改为主进程内的
     worker 线程（`uiohook-worker.ts`）——实测可完整收到全部手势事件，同时 `uIOhook.start()` 的上游启动死锁只会冻住
     worker 线程，Electron 主线程不会再出现彩虹圈，`UiohookSupervisor` 的看门狗与重试预算保持不变。

- 新会话首条消息发送改为先切入聊天页并显示用户气泡，再在页面完成绘制后异步创建 Runtime；初始化过程不产生额外文案或操作门禁，期间输入和发送的下一条内容会被优先接受，且不会被首条消息真正派发时清空；创建失败则恢复原始输入。
- 流式回复点击停止后，纯图标按钮立即进入不可重复点击的忙碌状态，直到主进程确认取消完成；取消失败时恢复为可重试的停止按钮。
- 新会话页窄屏下 hero（问候语、副标题、选项行）与输入框卡片左缘不再错位：hero 容器补上与输入栏
  相同的 `px-2 sm:px-4`。宽屏时两者都被 `max-w-2xl` 收住看不出差异，窄到内层被压缩时才暴露。
- 新会话页的吉祥物在页面被压窄时（窗口变小、活动面板或侧边栏展开）不再渲染：素材右锚宽 144px，
  插槽窄于 480px 就会压到选项行的 chip 与问候语上。判断按插槽实际宽度而不是窗口宽度，页面变宽后自动恢复。
- 新会话页在「对话」与待创建项目下进入时，右侧活动面板默认收起，不再继承其它页面记忆的展开态
  （面板此时只有「选择项目」空态）；用户在该 scope 下手动展开仍然有效。
- 「对话」上下文里的文件面板不再暴露各会话工作区的 uuid 内部目录：目录列举（文件树与 @文件补全）在
  `~/.vetta/conversation` 根这一层隐藏 uuid 命名的工作区子目录（老产物文件仍可见，文件权限边界不变）；
  新会话页在「不指定项目」与待创建项目下，活动面板文件页改为显示「选择项目」空态，而不是列出 conversation 根。
