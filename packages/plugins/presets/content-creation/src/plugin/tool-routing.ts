import type { PluginContext } from "@vetta-org/plugin-sdk";
import {
	CONTENT_ASSETS_TOOL_NAME,
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
} from "./register-tools";

export const CONTENT_CREATION_TOOL_NAMES = [
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_ASSETS_TOOL_NAME,
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
] as const;

const RUN_PATTERN =
	/\b(generate|render|run|execute|start|resume|cancel|stop|status|progress)\b|生成|渲染|执行|开始|继续|取消|停止|状态|进度/i;
const EDIT_PATTERN =
	/\b(create|build|add|edit|change|update|revise|remove|delete|connect|duplicate|plan|design)\b|创建|搭建|添加|编辑|修改|更新|调整|删除|连接|复制|规划|设计/i;
const READ_ONLY_PATTERN =
	/\b(inspect|explain|diagnose|why|what|show|list|check)\b|检查|诊断|为什么|什么|查看|列出|说明/i;
const LOCAL_ASSET_PATTERN =
	/\b(import|upload|file|folder|directory|desktop|local|path|asset|media)\b|导入|上传|文件|文件夹|目录|桌面|本地|路径|素材|媒体|(?:[a-z]:[\\/]|\/[\w.-])/i;

export function selectContentCreationTools(text: string): ReadonlySet<string> {
	const selected = new Set<string>([CONTENT_INSPECT_TOOL_NAME]);
	const wantsRun = RUN_PATTERN.test(text);
	const wantsEdit = EDIT_PATTERN.test(text);
	const wantsLocalAssets = LOCAL_ASSET_PATTERN.test(text);
	if (wantsLocalAssets) selected.add(CONTENT_ASSETS_TOOL_NAME);
	if (wantsEdit || (!wantsRun && !READ_ONLY_PATTERN.test(text))) selected.add(CONTENT_EDIT_TOOL_NAME);
	if (wantsRun) {
		selected.add(CONTENT_RUN_TOOL_NAME);
		if (wantsEdit || (!READ_ONLY_PATTERN.test(text) && /生成|render|generate/i.test(text))) {
			selected.add(CONTENT_EDIT_TOOL_NAME);
		}
	}
	return selected;
}

export function registerContentCreationToolRouter(ctx: PluginContext): void {
	ctx.agent.registerSystemPromptProvider({
		id: "content-creation-tool-router",
		context: { conversation: "messages" },
		handler: ({ conversation, runtime, actions }) => {
			const latestUserText = [...conversation.messages]
				.reverse()
				.find((message) => message.role === "user")?.text;
			const selected = selectContentCreationTools(latestUserText ?? "");
			const available = new Set(runtime.availableToolNames);
			for (const toolName of CONTENT_CREATION_TOOL_NAMES) {
				if (available.has(toolName)) actions.tools.setEnabled(toolName, selected.has(toolName));
			}
		},
	});
}
