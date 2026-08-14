/**
 * 版本历史的两个 agent 工具（ADR-0069）。
 *
 * 为什么给 agent 恢复能力、而不是只让它引导用户去面板：用户在聊天里说「退回上一版」
 * 时，没有这两个工具的模型会埋头手改代码去拼凑旧样子——那正是设计没有版本控制时最
 * 大的浪费。风险是它挑错版本，由 vetd_restore 的返回值兜住：它同时报出「已恢复到
 * 哪一版」和「恢复前的状态存成了哪一版」，用户说「不是这个」时模型能立刻改正。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController } from "../canvas/design-runtime";
import { listHistory } from "./history-client";
import { restoreDesign } from "./restore";

interface HistoryToolsOptions {
	/** 无画布场景下解析目标 .vetd（显式参数 > 打开的画布 > cwd 里唯一那份）。 */
	resolveVetdPath(host: { fs: PluginContext["fs"] }, cwd: string, explicit?: string): Promise<string>;
	scopeUse: readonly ("project" | "conversation")[];
}

export function registerHistoryTools(ctx: PluginContext, options: HistoryToolsOptions): void {
	const { resolveVetdPath, scopeUse: SCOPE_USE } = options;

interface HistoryInput {
	design?: string;
	limit?: number;
}

ctx.agent.registerTool<HistoryInput>({
	id: "vetd-history",
	name: "vetd_history",
	label: "%tool.vetd_history%",
	description:
		"List this design's saved versions, newest first. A version is saved automatically after every turn that changed the design, titled with what the user asked for. Use it when the user wants to go back to how the design was earlier, or asks what changed recently — then pass the chosen `version` to vetd_restore. Do NOT try to reconstruct an old version by editing files: the real content is here.",
	parameters: {
		type: "object",
		properties: {
			design: {
				type: "string",
				description: "Path to the `x.vetd/` directory (default: the design open on the canvas).",
			},
			limit: { type: "number", description: "How many versions to return (default 30)." },
		},
		additionalProperties: false,
	},
	scope_use: SCOPE_USE,
	handler: async ({ host, session, trigger }) => {
		try {
			const designDir = await resolveVetdPath(host, session.cwd, trigger.input.design);
			const commits = await listHistory(ctx, designDir, trigger.input.limit ?? 30);
			return {
				ok: true,
				design: designDir,
				// 第一条就是当前内容——恢复到它是空操作，别让模型把它当成一个可回退的目标。
				versions: commits.map((commit, index) => ({
					version: commit.sha,
					title: commit.title,
					at: new Date(commit.timestamp).toISOString(),
					files: commit.files,
					...(index === 0 ? { current: true } : {}),
					...(commit.restoredFrom ? { restoredFrom: commit.restoredFrom } : {}),
				})),
			};
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	},
});

interface RestoreInput {
	version?: string;
	design?: string;
}

ctx.agent.registerTool<RestoreInput>({
	id: "vetd-restore",
	name: "vetd_restore",
	label: "%tool.vetd_restore%",
	description:
		"Restore the design to one of the versions from vetd_history. The files go back to how they were at that version, and the restore itself is saved as a new version — so nothing is lost and you can restore again if the user says you picked the wrong one. Call vetd_history first; never guess a version id.\nDo NOT use to undo changes in the user's own repository — that is the repo's own version control, reached through git in a terminal.\nOnly for rolling a .vetd design document back to one of its own saved versions.",
	parameters: {
		type: "object",
		properties: {
			version: { type: "string", description: "`version` from vetd_history." },
			design: {
				type: "string",
				description: "Path to the `x.vetd/` directory (default: the design open on the canvas).",
			},
		},
		required: ["version"],
		additionalProperties: false,
	},
	scope_use: SCOPE_USE,
	handler: async ({ host, session, trigger }) => {
		const version = trigger.input.version?.trim();
		if (!version) return { ok: false, error: "Pass a `version` from vetd_history." };
		try {
			const designDir = await resolveVetdPath(host, session.cwd, trigger.input.design);
			const target = (await listHistory(ctx, designDir, 200)).find((commit) => commit.sha === version);
			if (!target) {
				return { ok: false, error: `No version "${version}" in this design's history. Call vetd_history first.` };
			}
			const controller = getCanvasController();
			const outcome = await restoreDesign(ctx, designDir, target, {
				session: controller?.session.dirPath === designDir ? controller.session : null,
			});
			if (!outcome.restored) {
				return { ok: true, unchanged: true, note: "The design already matches that version — nothing to do." };
			}
			return {
				ok: true,
				restoredTo: { version: target.sha, title: target.title },
				// 挑错版本是这个工具唯一的真风险。把「回去的路」一起报出来，用户说
				// 「不是这个」时模型能立刻改正，而不是去手改文件。
				...(outcome.stashed
					? {
							previousStateSavedAs: outcome.stashed.sha,
							note: `Restored. The state from before this restore was saved as version ${outcome.stashed.sha} — if the user says this is not the version they meant, call vetd_history again and restore a different one (nothing is lost).`,
						}
					: {
							note: "Restored. Nothing is lost — every earlier version is still listed by vetd_history.",
						}),
				...(outcome.reinstalled ? { dependenciesReinstalled: true } : {}),
			};
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	},
});
}
