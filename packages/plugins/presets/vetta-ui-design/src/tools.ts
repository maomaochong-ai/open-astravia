import type { PluginContext } from "@vetta-org/plugin-sdk";
import { getCanvasController, getFrameError, setPendingDesignPath } from "./canvas/design-runtime";
import { designSystemCardDescriptor } from "./cards/design-system-card";
import { screenshotCardDescriptor, SCREENSHOT_TOOL_NAME } from "./cards/screenshot-card";
import { ensureSnapshotsIgnored, pruneSnapshots, snapshotPath } from "./cards/snapshots";
import { applyDesignSystem, buildRestylePrompt } from "./design-systems/apply";
import { DESIGN_SYSTEMS, designSystemById } from "./design-systems/index";
import { engineDiagnostics } from "./engine/engine-manager";
import { CANVAS_TAB_ID } from "./tab-ids";
import { checkSources, type SourceFile } from "./vetd/check-sources";
import { findVetdFiles } from "./vetd/discover";
import { parseFrameMeta } from "./vetd/frame-meta";
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

/**
 * vetd_status 的一句话提示。按「此刻最该做的一件事」给，不叠加——三条并列的建议
 * 等于没有重点。
 */
function statusNote(
	shell: { layout: string | null; components: string[] } | null,
	issueCount: number,
	frameCount: number,
): string {
	if (issueCount > 0) {
		return `${issueCount} issue(s) found in your sources — these are proven rule violations, not suggestions. Fix them before reporting back; each message names the rule and the reference to read.`;
	}
	if (frameCount > 1 && shell && !shell.layout && shell.components.length === 0) {
		return "Multiple screens but NO shared UI yet. If they share a nav bar / sidebar / tab bar, extract it into components/ (or frames/_layout.tsx when it must survive navigation) rather than repeating it per frame. Structure checklist: references/self-check.md in the vetta-ui-design skill.";
	}
	if (shell && (shell.layout || shell.components.length > 0)) {
		return "This design already has shared UI (see `sharedShell`) — reuse it instead of writing a second copy.";
	}
	return "Design open on the canvas.";
}

/** 送进机检的全部设计源码：画框与共享组件。 */
async function collectSources(fs: PluginContext["fs"], dirPath: string): Promise<SourceFile[]> {
	const files: SourceFile[] = [];
	for (const dir of ["frames", "components"]) {
		let entries: Awaited<ReturnType<PluginContext["fs"]["readDir"]>>;
		try {
			entries = await fs.readDir(`${dirPath}/${dir}`);
		} catch {
			continue; // components/ 可以不存在
		}
		for (const entry of entries) {
			if (entry.isDirectory || !entry.name.endsWith(".tsx")) continue;
			try {
				const { content } = await fs.readFile(entry.path);
				files.push({ path: `${dir}/${entry.name}`, content });
			} catch {
				// 读不到就跳过：这条链路只做检查，不该因为一个文件失败而整体报错
			}
		}
	}
	return files;
}

export function registerDesignTools(ctx: PluginContext): void {
	ctx.agent.registerTool<CreateInput>({
		id: "vetd-create",
		name: "vetd_create",
		label: "%tool.vetd_create%",
		// 工具描述每轮都在系统提示里，所以只留「做什么 + 去哪拿规则」。规则本身归
		// skill 正文（已验证 invoke_skill 能送达），在这里复述一遍是双份 token。
		description:
			"Create a new Vetta UI Design document (.vetd manifest + sidecar sources) in the current workspace and open it on the design canvas. Use when the user asks to start a UI design / mockup. Each frames/<id>.tsx is one canvas frame AND one route — invoke the vetta-ui-design skill for the rules before writing any of them.",
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
				note: "Design created and opened on the canvas, with NO frames yet — pick sizes from the product type and write frames/<id>.tsx, each starting with `export const frame = { width, height, title }`. Never edit the .vetd manifest. More than one screen? Write the shared chrome FIRST (components/, or frames/_layout.tsx) — see the vetta-ui-design skill.",
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
				// 源码在、画布上却没有，只有一种可能：meta 没把尺寸声明全，reconcile 放弃了它。
				// 报「Unknown frame」会让模型以为自己写错了文件名，转头再写一遍同样没尺寸的文件。
				const source = await host.fs
					.readFile(`${controller.session.dirPath}/frames/${frameId}.tsx`)
					.then((file) => file.content)
					.catch(() => null);
				const meta = source === null ? null : parseFrameMeta(source, frameId);
				if (meta && (meta.width === null || meta.height === null)) {
					return {
						ok: false,
						retryable: true,
						error: `Frame "${frameId}" is not on the canvas: frames/${frameId}.tsx does not declare ${meta.width === null ? "width" : ""}${meta.width === null && meta.height === null ? " and " : ""}${meta.height === null ? "height" : ""}. There is no default size — add \`export const frame = { width, height, title }\` as the first statement, then take the screenshot again.${known.length > 0 ? ` Sizes already used here: ${controller.session.manifest.frames.map((frame) => `${frame.id} ${frame.width}x${frame.height}`).join(", ")}.` : ""}`,
					};
				}
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
				// 光说「截好了」模型会只瞟一眼就宣布完成。把该找什么写在这里：工具返回是
				// 每次都读的，而 references/quality.md 未必被翻开。三项是实测最高频的
				// 渲染缺陷，共同点是源码怎么读都读不出来，只有看图才能发现。
				note: "Screenshot saved. Read this path to actually look at the rendering, and inspect it for defects the source cannot reveal: (1) misalignment — edges/baselines that should line up but do not, cards of unequal height, inconsistent gutters; (2) unintended text wrapping — buttons, tabs, table headers, nav items or labels spilling onto a second line (CJK copy is wider than the English the container was sized for), and text clipped or overflowing; (3) blank icons — an icon slot rendering as empty space (a name or set that does not exist matches no CSS, so the span collapses) or a glyph invisible against its own background. Also check clipping, contrast, and whether the frame fills its declared height. Fix what you find and screenshot again — see references/quality.md for the full checklist.",
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
			"Inspect the Vetta UI Design state: workspace designs, the design open on the canvas, its frames (id/size/title/`buildError`), its `sharedShell` (existing _layout.tsx + components/ to reuse), `issues` (rule violations found in your sources) and engine diagnostics. Call it before editing an existing design, and again after writing frames to pick up `issues`.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session }) => {
			const designs = await findVetdFiles(host.fs, session.cwd);
			const controller = getCanvasController();
			const engine = await engineDiagnostics(controller?.session.dirPath ?? null);
			const shell = controller ? await inspectSharedShell(host.fs, controller.session.dirPath) : null;
			const issues = controller ? checkSources(await collectSources(host.fs, controller.session.dirPath)) : [];
			return {
				designs,
				open: controller
					? {
							vetdPath: controller.session.vetdPath,
							sourcesDir: controller.session.dirPath,
							// 复用面先于画框列出：agent 是一屏一屏往下写的，看不见既有的
							// 外壳与组件就会在每个 frame 里重抄一遍导航栏。
							sharedShell: shell,
							issues,
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
				...(controller ? { note: statusNote(shell, issues.length, controller.session.manifest.frames.length) } : {}),
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
