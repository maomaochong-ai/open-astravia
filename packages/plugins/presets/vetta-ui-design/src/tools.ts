import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, getFrameError, setPendingDesignPath } from "./canvas/design-runtime";
import { designSystemCardDescriptor } from "./cards/design-system-card";
import { screenshotCardDescriptor, SCREENSHOT_TOOL_NAME } from "./cards/screenshot-card";
import { ensureSnapshotsIgnored, pruneSnapshots, snapshotPath } from "./cards/snapshots";
import { applyDesignSystem, buildRestylePrompt } from "./design-systems/apply";
import { DESIGN_SYSTEMS, designSystemById } from "./design-systems/index";
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

/**
 * 这份设计当前的复用面：公共外壳与已有组件。
 *
 * 存在的理由很具体：agent 是一屏一屏往下写的，写第三屏时早已看不见第一屏写过
 * 什么，于是每个 frame 里各抄一份导航栏。把它随 vetd_status 一起端到眼前，比在
 * skill 文档里多写一段更管用——工具返回是每次都会读的。
 */
async function inspectSharedShell(
	fs: PluginContext["fs"],
	dirPath: string,
): Promise<{ layout: string | null; components: string[] }> {
	const layout = await fs
		.readFile(`${dirPath}/frames/_layout.tsx`)
		.then(() => "frames/_layout.tsx")
		.catch(() => null);
	const components = await fs
		.readDir(`${dirPath}/components`)
		.then((entries) =>
			entries.filter((entry) => !entry.isDirectory && entry.name.endsWith(".tsx")).map((entry) => entry.name),
		)
		.catch(() => []);
	return { layout, components };
}

export function registerDesignTools(ctx: PluginContext): void {
	ctx.agent.registerTool<CreateInput>({
		id: "vetd-create",
		name: "vetd_create",
		label: "%tool.vetd_create%",
		// 工具描述每轮都在系统提示里，而 skill 正文要 invoke_skill 才读得到 —— 所以
		// 「设计稿是个工程」这件事必须写在这里，否则 agent 只会看到一堆 tsx 文件，
		// 把每屏当成一张互不相干的图去画。
		description:
			"Create a new Vetta UI Design document (.vetd manifest + sidecar sources) in the current workspace and open it on the design canvas. Use when the user asks to start a UI design / mockup. A design document is a real front-end project: each frames/<id>.tsx is a route (frames/login.tsx = /login, frames/index.tsx = /), screens link to each other with react-router, shared chrome lives in components/ or a frames/_layout.tsx that renders <Outlet/>, and shared color tokens live in theme.css. Build it like an engineer would — never edit the .vetd manifest itself. Invoke the vetta-ui-design skill first for the full rules.",
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
				note: "Design created and opened on the canvas. It has NO frames yet — pick the frame sizes from the product type (screen / slide / poster / …) and write them as frames/<id>.tsx with `export const frame = { width, height, title }`; shared color tokens live in theme.css. Do NOT edit the .vetd manifest — the canvas owns it. If this design will have MORE THAN ONE screen, write the shared chrome FIRST (nav bar / sidebar / tab bar → components/, or frames/_layout.tsx when it must survive navigation) and have every frame use it — never paste the same nav bar into each frame file.",
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
			"Inspect the Vetta UI Design state: design documents in the workspace, the design open on the canvas, its frames (id/size/title, plus `buildError` when a frame currently fails to compile), its `sharedShell` (the existing frames/_layout.tsx and components/ — reuse these instead of rewriting the nav bar in every frame) and design-engine diagnostics (dev-server liveness + recent build output). Call it BEFORE editing an existing design: frame ids double as routes, and you cannot tell what is already shared by guessing.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session }) => {
			const designs = await findVetdFiles(host.fs, session.cwd);
			const controller = getCanvasController();
			const engine = await engineDiagnostics(controller?.session.dirPath ?? null);
			const shell = controller ? await inspectSharedShell(host.fs, controller.session.dirPath) : null;
			return {
				designs,
				open: controller
					? {
							vetdPath: controller.session.vetdPath,
							sourcesDir: controller.session.dirPath,
							// 复用面先于画框列出：agent 是一屏一屏往下写的，看不见既有的
							// 外壳与组件就会在每个 frame 里重抄一遍导航栏。
							sharedShell: shell,
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
				...(shell && controller && controller.session.manifest.frames.length > 1
					? {
							note:
								shell.layout || shell.components.length > 0
									? "This design already has shared UI (see `sharedShell`) — reuse it in every frame you touch instead of writing a second copy."
									: "This design has multiple screens but NO shared UI yet. If they share a nav bar / sidebar / tab bar, extract it into components/ (or frames/_layout.tsx when it must survive navigation) and have every frame use it — do not repeat the same chrome in each frame file.",
						}
					: {}),
			};
		},
	});

	interface DesignSystemsInput {
		present?: string[];
		apply?: string;
		design?: string;
	}

	/** apply/无画布场景下解析目标 .vetd：显式参数 > 打开的画布 > cwd 里唯一那份。 */
	const resolveVetdPath = async (host: { fs: PluginContext["fs"] }, cwd: string, explicit?: string) => {
		if (explicit) return explicit;
		const controller = getCanvasController();
		if (controller) return controller.session.vetdPath;
		const designs = await findVetdFiles(host.fs, cwd);
		if (designs.length === 1) return designs[0];
		throw new Error(
			designs.length === 0
				? "No .vetd design document in the workspace. Create one with vetd_create first."
				: `Multiple design documents found — pass \`design\` to pick one: ${designs.join(", ")}`,
		);
	};

	ctx.agent.registerTool<DesignSystemsInput>({
		id: "vetd-design-systems",
		name: "vetd_design_systems",
		label: "%tool.vetd_design_systems%",
		description:
			"Built-in design systems (curated theme.css + DESIGN.md presets: Linear, Stripe, Notion, Apple, Spotify, …). Three usages: (1) no arguments — list all systems with style blurbs, so you can shortlist by the user's description; (2) `present: [ids]` — render clickable preview cards in the conversation for the user to pick from (their choice arrives as a new user message; ALWAYS prefer this over choosing silently when the user hasn't named a style); (3) `apply: id` — apply a system to the design document. Apply on an EMPTY design writes theme.css + DESIGN.md directly; on a design with frames it writes DESIGN.md + a full backup, then returns restyle instructions for you to execute.",
		parameters: {
			type: "object",
			properties: {
				present: {
					type: "array",
					items: { type: "string" },
					description:
						"System ids (2-4 recommended) to render as clickable preview cards for the user to choose from.",
				},
				apply: {
					type: "string",
					description: "System id to apply to the design document.",
				},
				design: {
					type: "string",
					description:
						"Absolute path of the target .vetd (optional; defaults to the design open on the canvas, or the workspace's only .vetd).",
				},
			},
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session, trigger }) => {
			const { present, apply, design } = trigger.input;

			if (apply) {
				const system = designSystemById(apply);
				if (!system) {
					return {
						ok: false,
						error: `Unknown design system "${apply}". Valid ids: ${DESIGN_SYSTEMS.map((s) => s.id).join(", ")}`,
					};
				}
				let vetdPath: string;
				try {
					vetdPath = await resolveVetdPath(host, session.cwd, design);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				const result = await applyDesignSystem(host.fs, vetdPath, apply);
				if (result.mode === "direct") {
					return {
						ok: true,
						mode: "direct",
						vetdPath: result.vetdPath,
						note: `Applied "${system.name}": theme.css and DESIGN.md written to ${result.dirPath} (the design had no frames, so nothing else changes). The canvas hot-reloads. Every frame you create from now on MUST follow ${result.dirPath}/DESIGN.md.`,
					};
				}
				return {
					ok: true,
					mode: "restyle",
					vetdPath: result.vetdPath,
					frames: result.frames,
					note: `DESIGN.md written and a full backup of the previous sources saved. Now execute the restyle yourself:\n\n${buildRestylePrompt(system, result, "en")}`,
				};
			}

			if (present && present.length > 0) {
				const unknown = present.filter((id) => !designSystemById(id));
				if (unknown.length > 0) {
					return {
						ok: false,
						error: `Unknown design system ids: ${unknown.join(", ")}. Valid ids: ${DESIGN_SYSTEMS.map((s) => s.id).join(", ")}`,
					};
				}
				return {
					ok: true,
					presented: present,
					note: "Preview cards rendered in the conversation. STOP and wait — the user's pick (or their choice to skip templates) arrives as a new user message; do not choose for them.",
					cards: [designSystemCardDescriptor(present, true)],
				};
			}

			return {
				systems: DESIGN_SYSTEMS.map((system) => ({
					id: system.id,
					name: system.name,
					category: system.category,
					vibe: system.vibe,
					blurb: system.blurb,
				})),
				note: "Shortlist 2-4 systems that fit the user's description and render them with `present` for the user to pick. Only call `apply` directly when the user has explicitly named a system.",
			};
		},
	});
}
