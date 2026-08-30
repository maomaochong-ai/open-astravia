import type { PluginAppActionRegistration, PluginAppActionUsage, PluginContext } from "@vetta-org/plugin-sdk";

const DOMAIN_USAGE = {
	general: {
		target: "Vetta Desktop 的通用设置",
		useWhen: "查询或调整 Vetta 的默认工作区、通知及默认执行模式。",
		avoidWhen: "修改项目配置、当前命令的执行参数，或为完成任务自行关闭沙盒。",
		alternatives: "项目配置使用文件工具；单次执行使用对应命令或会话能力。",
	},
	agent: {
		target: "Vetta Desktop 的 Agent 实验设置",
		useWhen: "查询或调整 Vetta 的输入预测、CLI、技能扩展等实验开关。",
		avoidWhen: "编写 Agent 程序、调整当前任务计划、创建子 Agent 或修改项目中的 Agent 配置。",
		alternatives: "开发任务使用仓库工具；任务协作使用子 Agent 工具。",
	},
	appearance: {
		target: "Vetta Desktop 自身的外观与界面语言",
		useWhen: "用户希望查询或改变 Vetta 窗口的主题、深浅模式、指针或界面语言。",
		avoidWhen: "开发网页的深色模式、修改设计稿配色、翻译文档或要求本次回答使用某种语言。",
		alternatives: "网页修改项目样式；设计稿使用设计工具；回答语言直接遵循用户要求。",
	},
	navigation: {
		target: "Vetta Desktop 内的页面与设置导航",
		useWhen: "用户要在 Vetta 中打开某个页面、设置分类或新会话入口。",
		avoidWhen: "打开网址、预览开发中的网页、查看文件，或为介绍功能而擅自跳转页面。",
		alternatives: "网址使用浏览器；项目预览使用项目工具；功能问题先查询后解释。",
	},
	projects: {
		target: "Vetta Desktop 侧边栏项目及其会话记录",
		useWhen: "查询 Vetta 项目或会话，或按用户要求管理侧边栏中的项目。",
		avoidWhen: "创建 React 等代码脚手架、编辑当前仓库、删除磁盘目录，或把普通开发任务自动登记为侧边栏项目。",
		alternatives: "开发使用文件工具与项目脚手架；独立执行任务使用适用的子 Agent 工具。",
	},
	"batch-tasks": {
		target: "Vetta Desktop 批量任务页中的持久项目和子任务",
		useWhen: "用户要查询或管理 Vetta 批量任务，或明确要求把工作建立为 Vetta 批量执行项目。",
		avoidWhen: "普通多步骤任务、批量编辑文件、当前会话的待办列表，或仅为了并行而创建持久批量项目。",
		alternatives: "当前任务使用 todo 和文件工具；确有独立复杂工作时使用子 Agent 工具。",
	},
	scheduler: {
		target: "Vetta Desktop 管理的持久定时 Agent 任务",
		useWhen: "用户要求 Vetta 稍后或周期性执行任务，或查询、修改已有的 Vetta 定时任务。",
		avoidWhen: "在业务代码中实现定时器或 cron、排查服务器调度、讨论计划但未要求建立自动任务。",
		alternatives: "代码调度修改对应项目；计划咨询直接解释，不创建定时任务。",
	},
	models: {
		target: "Vetta Desktop 配置的模型服务商与默认模型",
		useWhen: "查询或管理供 Vetta 使用的模型和服务商配置。",
		avoidWhen: "修改用户应用的模型调用代码、训练模型、比较模型概念，或未经要求改变全局默认模型。",
		alternatives: "项目模型接入修改项目配置和代码；概念问题直接解释。",
	},
	mcp: {
		target: "Vetta Desktop 的 MCP 服务器连接配置",
		useWhen: "用户要在 Vetta 中添加、配置、启停或查询 MCP 服务器。",
		avoidWhen: "调用某个已连接 MCP 的工具、开发 MCP 服务器，或仅因当前没有某工具就自行安装服务器。",
		alternatives: "调用工具使用 tool_search 和已连接 MCP；开发服务器使用仓库工具。",
	},
	skills: {
		target: "Vetta Desktop 能力页中的 Skill 与场景安装记录",
		useWhen: "查询、安装、启停或卸载供 Vetta 使用的 Skill 或场景。",
		avoidWhen: "使用当前可用的 Skill、编写 SKILL.md，或仅因任务涉及某能力就自行安装。",
		alternatives: "使用已有能力调用 invoke_skill；创作 Skill 修改其项目文件。",
	},
	plugins: {
		target: "Vetta Desktop 的已安装插件和插件安装流程",
		useWhen: "用户要求在 Vetta 中安装、查询、启停、重载或卸载插件。",
		avoidWhen: "安装 IDE、浏览器或框架插件；编辑插件源码；普通热更新已能应用变更时触发重装。",
		alternatives: "其他软件使用各自的安装方式；Vetta 插件开发先遵循 Plugin Workbench 的热更新或重装流程。",
	},
	knowledge: {
		target: "Vetta Desktop 的知识库集合与文档加工配置",
		useWhen: "用户要查询或管理 Vetta 知识库、导入资料或调整知识库加工流程。",
		avoidWhen: "回答常识问题、检索已挂载知识库的内容，或创建普通 Markdown 文档。",
		alternatives: "内容检索使用 kb_filter_by_tags、kb_list_available_tags 和文件工具；知识页面写入使用 kb_write_page。",
	},
	shortcuts: {
		target: "Vetta Desktop 的全局快捷键与快捷面板设置",
		useWhen: "用户要查询或改变 Vetta 的快捷键绑定及快捷面板行为。",
		avoidWhen: "实现网页键盘交互、修改 IDE 快捷键或讨论键盘操作。",
		alternatives: "代码交互修改项目；其他应用使用其设置入口；操作咨询直接解释。",
	},
	im: {
		target: "Vetta Desktop 的 IM 连接与渠道配置",
		useWhen: "查询或配置 Vetta 的飞书、微信等 IM 接入和运行状态。",
		avoidWhen: "发送普通消息或附件、开发聊天软件，或把用户提到的聊天平台自动接入 Vetta。",
		alternatives: "当前 IM 附件交付使用 im_send_attachment；消息操作使用对应渠道能力；软件开发修改项目。",
	},
	webhook: {
		target: "Vetta Desktop 的 Webhook 推送端点配置",
		useWhen: "用户要查询或配置 Vetta 发送通知使用的 Webhook 端点。",
		avoidWhen: "开发业务 Webhook、调用外部 API 或仅要求发送一次消息。",
		alternatives: "业务 Webhook 修改项目；一次性外部操作使用目标服务的能力。",
	},
	downloads: {
		target: "Vetta Desktop 下载中心中的任务记录",
		useWhen: "用户要查询或管理 Vetta 下载中心已有任务。",
		avoidWhen: "下载任意网页文件、安装项目依赖、查找下载目录文件。",
		alternatives: "文件下载使用对应下载能力；依赖使用包管理器；本地文件使用文件工具。",
	},
	updater: {
		target: "Vetta Desktop 应用本身的版本更新",
		useWhen: "用户要检查、下载或安装 Vetta 自身的新版，或控制已有更新任务。",
		avoidWhen: "更新项目依赖、修改源代码、升级其他应用或更新插件。",
		alternatives: "项目升级使用包管理器；插件更新使用插件管理；其他软件使用其更新机制。",
	},
} satisfies Record<string, PluginAppActionUsage>;

/** Keep routing text separate from searchable capability text and from execution/approval policy. */
export function createVettaActionRegistrar(ctx: PluginContext, domain: keyof typeof DOMAIN_USAGE) {
	return <TInput>(registration: PluginAppActionRegistration<TInput>) =>
		ctx.appActions.register({ ...registration, usage: DOMAIN_USAGE[domain] });
}
