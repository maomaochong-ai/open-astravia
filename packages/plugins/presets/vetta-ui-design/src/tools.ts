import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, getFrameError, setPendingDesignPath } from "./canvas/design-runtime";
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
		// 必须宽于画布侧那条链路（拉回活体的静置 + 30s 截图 + 落盘），否则工具会
		// 抢在内层超时前失败，报出来的原因也就没了参考价值。
		timeoutMs: 60_000,
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
			// 坏掉的 frame 渲染不出任何东西，截图只会一路等到超时（30s+），而模型
			// 拿到的还是一句「超时」。直接把编译报错回给它，这一轮就能去修。
			const buildError = getFrameError(frameId);
			if (buildError) {
				return {
					ok: false,
					retryable: true,
					error: `Frame "${frameId}" is currently broken — the canvas shows a build error, so there is nothing to capture:\n\n${buildError}\n\nFix the source, then take the screenshot again.`,
				};
			}
			let dataUrl: string;
			try {
				dataUrl = await controller.captureFrame(frameId);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				// 等待期间才坏掉的话，报错要带上真正的原因而不只是「超时」。
				const late = getFrameError(frameId);
				return {
					ok: false,
					retryable: true,
					error: late
						? `Screenshot failed (${reason}). Frame "${frameId}" has a build error:\n\n${late}\n\nFix the source, then take the screenshot again.`
						: `Screenshot failed: ${reason}. Call vetd_status for design-engine diagnostics and recent build output.`,
				};
			}
			// 位图态的 frame 没挂 iframe，也就没有 HMR 连接，它坏没坏是截图这一步把它
			// 挂上来才知道的。这时截到的是引擎的兜底文案，交给模型只会让它以为渲染正常。
			const lateError = getFrameError(frameId);
			if (lateError) {
				return {
					ok: false,
					retryable: true,
					error: `Frame "${frameId}" failed to build, so the capture only shows the engine's fallback placeholder:\n\n${lateError}\n\nFix the source, then take the screenshot again.`,
				};
			}
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
			"Inspect the Vetta UI Design state: design documents in the workspace, the design open on the canvas, its frames (id/size/title, plus `buildError` when a frame currently fails to compile) and design-engine diagnostics (dev-server liveness + recent build output). Use to find frame ids, or to diagnose why the canvas shows a build error.",
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
							frames: controller.session.manifest.frames.map((frame) => {
								const buildError = getFrameError(frame.id);
								return {
									id: frame.id,
									file: frame.file,
									title: frame.title,
									width: frame.width,
									height: frame.height,
									...(buildError ? { buildError } : {}),
								};
							}),
						}
					: null,
				engine,
			};
		},
	});
}
