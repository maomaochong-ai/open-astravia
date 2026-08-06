import { definePlugin } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
import "./style.css";
import { REINSTALL_CARD_TYPE, ReinstallCard } from "./ReinstallCard";
import { findProjectById } from "./project";
import { setWorkbenchRuntime } from "./runtime";
import { WorkbenchPanel } from "./WorkbenchPanel";

const REINSTALL_TOOL_NAME = "workbench_offer_reinstall";

function WrenchIcon({ className }: { className?: string }): ReactNode {
	return (
		<svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
			<path
				fill="currentColor"
				d="M22.7 19.3 13.6 10.2a6 6 0 0 0-7.8-7.8l3.1 3.1-2.1 2.1-3.1-3.1A6 6 0 0 0 10.2 13.6l9.1 9.1a1 1 0 0 0 1.4 0l2-2a1 1 0 0 0 0-1.4Z"
			/>
		</svg>
	);
}

const offerReinstallSchema = {
	type: "object",
	properties: {
		pluginId: {
			type: "string",
			description: "目标插件 id（与工程 plugin.json 的 id 一致）。",
		},
		projectDir: {
			type: "string",
			description: "可选。插件工程绝对路径；缺省时在会话 cwd 根或一层子目录中按 pluginId 查找。",
		},
		reason: {
			type: "string",
			description:
				"为何需要重新安装（展示在卡片上）。例如：新增了 permissions、commands 或 settings，热更新无法同步授权。",
		},
	},
	required: ["pluginId"],
	additionalProperties: false,
} as const;

interface OfferReinstallInput {
	pluginId: string;
	projectDir?: string;
	reason?: string;
}

export default definePlugin({
	activate(ctx) {
		setWorkbenchRuntime(ctx.command, ctx.fs);

		ctx.ui.registerActivityTab({
			id: "workbench",
			label: "%tab.label%",
			icon: <WrenchIcon className="h-4 w-4" />,
			component: WorkbenchPanel,
			scope_use: ["project", "conversation"],
			// 出现条件由插件自己驱动：输入栏「插件工作台」toggle 点亮才上栏（见下方 onToggle）。
			initiallyVisible: false,
		});

		ctx.ui.registerInputAction({
			id: "mode",
			label: "%action.mode.label%",
			icon: <WrenchIcon className="h-3.5 w-3.5" />,
			defaultActive: false,
			hardIsolation: true,
			scope_use: ["project", "conversation"],
			// 工作台面板跟随输入栏 toggle：点亮才上栏（硬隔离只负责关掉时藏起来，
			// 不会把标签卡放进栏里）。不用 openActivityTab，避免抢焦点弹开面板。
			onToggle: (active) => ctx.ui.setActivityTabVisible("workbench", active),
			decoratePrompt: () => ({
				metadata: {
					pluginModes: { "plugin-workbench": true },
				},
			}),
		});

		ctx.ui.registerCardRenderer({
			type: REINSTALL_CARD_TYPE,
			title: "%card.reinstall.tabTitle%",
			icon: <WrenchIcon className="h-3.5 w-3.5" />,
			component: ReinstallCard,
			pendingFor: (tc) =>
				tc.toolName === REINSTALL_TOOL_NAME ? { type: REINSTALL_CARD_TYPE } : null,
		});

		ctx.agent.registerTool<OfferReinstallInput>({
			id: "workbench-offer-reinstall",
			name: REINSTALL_TOOL_NAME,
			label: "提示重新安装插件",
			description:
				"When hot reload cannot apply changes (new/changed permissions, commands, settingsSchema, or other install-time registry fields), call this tool to show a message-list card with a user-clickable「重新安装」button. Do NOT call install-from-path yourself (that pops a confirmation sheet). The card rebuilds the zip, re-applies the plugin, and reloads the whole Vetta app. Only use when reinstall is actually required — not for ordinary source edits under hot reload.",
			parameters: offerReinstallSchema,
			timeoutMs: 15_000,
			scope_use: ["project", "conversation"],
			handler: async ({ trigger: { input }, session }) => {
				const pluginId = input.pluginId?.trim();
				if (!pluginId) {
					return { ok: false, message: "pluginId is required" };
				}

				const searchRoot = input.projectDir?.trim() || session.cwd;
				if (!searchRoot) {
					return {
						ok: false,
						message: "No projectDir and session has no cwd; cannot locate plugin project.",
					};
				}

				const project = await findProjectById(searchRoot, pluginId);
				if (!project) {
					return {
						ok: false,
						message: `Plugin project not found for id=${pluginId} under ${searchRoot}`,
					};
				}

				const reason =
					input.reason?.trim() ||
					"权限 / 命令 / 设置声明等安装态字段已变更，热更新无法同步，需要重新安装并刷新 App。";

				return {
					ok: true,
					pluginId: project.id,
					projectDir: project.dir,
					name: project.name,
					message:
						"已在消息下方展示「重新安装」卡片。请用户点击卡片按钮完成构建、安装与 App 刷新；不要代点、不要再调 install-from-path。",
					cards: [
						{
							type: REINSTALL_CARD_TYPE,
							key: `reinstall:${project.id}`,
							title: project.name,
							payload: {
								pluginId: project.id,
								projectDir: project.dir,
								name: project.name,
								reason,
								permissions: project.permissions,
							},
						},
					],
				};
			},
		});
	},
});
