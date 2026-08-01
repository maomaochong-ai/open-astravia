import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, setPendingDesignPath } from "./canvas/design-runtime";
import { screenshotCardDescriptor, SCREENSHOT_TOOL_NAME } from "./cards/screenshot-card";
import { ensureSnapshotsIgnored, pruneSnapshots, snapshotPath } from "./cards/snapshots";
import { engineDiagnostics } from "./engine/engine-manager";
import { CANVAS_TAB_ID } from "./tab-ids";
import { findVetdFiles } from "./vetd/discover";
import { scaffoldDesign } from "./vetd/scaffold";

const SCOPE_USE = ["project", "conversation"] as const;
/**
 * 设计画布只在「工作」模式下成立（ADR-0046）：编程模式里这些工具连同画布、
 * 全局插槽、skill 一起隔离，只留 .vetd 的文件预览。插件级 agent_mode 是硬闸、
 * 会把预览一起藏掉，所以按子资源逐个收窄。
 */
const AGENT_MODE = ["work"] as const;

interface CreateInput {
	name?: string;
}

interface ScreenshotInput {
	frame: string;
}

export function registerDesignTools(ctx: PluginContext): void {
	ctx.agent.registerTool<CreateInput>({
		id: "vetd-create",
		name: "vetd_create",
		label: "%tool.vetd_create%",
		description:
			"Create a new Vetta UI Design document (.vetd manifest + sidecar sources) in the current workspace and open it on the design canvas. Use when the user asks to start a UI design / mockup. After creating, add frames by writing frames/<id>.tsx files — never edit the .vetd manifest itself.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Design document name (kebab-case preferred), e.g. `login-app`.",
				},
			},
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session, trigger }) => {
			const result = await scaffoldDesign(host.fs, session.cwd, trigger.input.name ?? "design");
			setPendingDesignPath(result.vetdPath);
			ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true);
			ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
			return {
				ok: true,
				vetdPath: result.vetdPath,
				sourcesDir: result.dirPath,
				firstFrame: `${result.dirPath}/${result.firstFrameFile}`,
				note: "Design created and opened on the canvas. Add frames as frames/<id>.tsx with `export const frame = { width, height, title }`; shared color tokens live in theme.css. Do NOT edit the .vetd manifest — the canvas owns it.",
			};
		},
	});

	ctx.agent.registerTool<ScreenshotInput>({
		id: "vetd-screenshot",
		name: SCREENSHOT_TOOL_NAME,
		label: "%tool.vetd_screenshot%",
		description:
			"Capture a rendered screenshot of one design frame from the open design canvas. Returns a PNG file path — call the Read tool on that path to actually see the rendering and verify your design changes visually.",
		parameters: {
			type: "object",
			properties: {
				frame: {
					type: "string",
					description: "Frame id (the frames/<id>.tsx basename), e.g. `login`.",
				},
			},
			required: ["frame"],
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		timeoutMs: 30_000,
		handler: async ({ host, trigger }) => {
			const controller = getCanvasController();
			if (!controller) {
				ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
				return {
					ok: false,
					retryable: true,
					error:
						"The design canvas is not open (it was just requested to open). Wait a moment and retry, or ask the user to open the Design tab.",
				};
			}
			const frameId = trigger.input.frame.replace(/\.tsx$/, "");
			const known = controller.session.manifest.frames.map((frame) => frame.id);
			if (!known.includes(frameId)) {
				return {
					ok: false,
					retryable: true,
					error: `Unknown frame "${frameId}". Available frames: ${known.join(", ") || "(none)"}`,
				};
			}
			const dataUrl = await controller.captureFrame(frameId);
			const base64 = dataUrl.split(",")[1] ?? "";
			const { dirPath, vetdPath } = controller.session;
			const path = snapshotPath(dirPath, frameId, Date.now());
			await host.fs.writeFile(path, base64, "base64");
			await ensureSnapshotsIgnored(host.fs, dirPath);
			await pruneSnapshots(host.fs, dirPath, frameId);
			return {
				ok: true,
				path,
				note: "Screenshot saved. Use the Read tool on this path to view the rendering.",
				// 模型不可见：宿主把顶层 cards 提到 details.cards，在消息下方渲染截图卡。
				cards: [screenshotCardDescriptor(vetdPath, dirPath, frameId)],
			};
		},
	});

	ctx.agent.registerTool({
		id: "vetd-status",
		name: "vetd_status",
		label: "%tool.vetd_status%",
		description:
			"Inspect the Vetta UI Design state: design documents in the workspace, the design open on the canvas, its frames (id/size/title) and design-engine diagnostics (dev-server liveness + recent build output). Use to find frame ids, or to diagnose why the canvas shows a build error.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session }) => {
			const designs = await findVetdFiles(host.fs, session.cwd);
			const controller = getCanvasController();
			const engine = await engineDiagnostics(controller?.session.dirPath ?? null);
			return {
				designs,
				open: controller
					? {
							vetdPath: controller.session.vetdPath,
							sourcesDir: controller.session.dirPath,
							frames: controller.session.manifest.frames.map((frame) => ({
								id: frame.id,
								file: frame.file,
								title: frame.title,
								width: frame.width,
								height: frame.height,
							})),
						}
					: null,
				engine,
			};
		},
	});
}
