import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ElementQuery, SelectedElementPayload } from "./canvas/bridge-client";
import { getCanvasController, getFrameError, setPendingDesignPath } from "./canvas/design-runtime";
import { designSystemCardDescriptor } from "./cards/design-system-card";
import { screenshotCardDescriptor, SCREENSHOT_TOOL_NAME } from "./cards/screenshot-card";
import { ensureSnapshotsIgnored, pruneSnapshots, snapshotPath } from "./cards/snapshots";
import { applyDesignSystem, buildRestylePrompt } from "./design-systems/apply";
import { DESIGN_SYSTEMS, designSystemById } from "./design-systems/index";
import { engineDiagnostics } from "./engine/engine-manager";
import { composeNotePins } from "./notes/annotate";
import { notesFilePath } from "./notes/notes-store";
import { type DesignNote, type NotesFile, noteStatus, parseNotesFile, pendingNotes } from "./notes/types";
import { CANVAS_TAB_ID } from "./tab-ids";
import type { SourceIssue } from "./vetd/check-sources";
import { blockingSyntaxIssues, SYNTAX_RULE } from "./vetd/check-syntax";
import { findVetdFiles } from "./vetd/discover";
import { inspectIssues } from "./vetd/inspect";
import { sidecarDirOf } from "./vetd/manifest-types";
import { PRODUCT_SIZE_SUMMARY, PRODUCT_TYPES, resolveDefaultFrameSize } from "./vetd/product-size";
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
	product?: string;
	frameSize?: { width: number; height: number };
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
	issues: readonly SourceIssue[],
	frameCount: number,
): string {
	const syntaxCount = issues.filter((issue) => issue.rule === SYNTAX_RULE).length;
	if (syntaxCount > 0) {
		// 语法错是硬阻塞（那一帧根本没在渲染），不能和风格违规并列。
		return `${syntaxCount} file(s) do not parse — the canvas cannot build them, so those frames are frozen on their last good rendering. Fix these first, with a targeted edit at the reported line rather than a full rewrite.`;
	}
	if (issues.length > 0) {
		return `${issues.length} issue(s) found in your sources — these are proven rule violations, not suggestions. Fix them with a targeted edit before reporting back; each message names the rule and the reference to read.`;
	}
	if (frameCount > 1 && shell && !shell.layout && shell.components.length === 0) {
		return "Multiple screens but NO shared UI yet. If they share a nav bar / sidebar / tab bar, extract it into components/ (or frames/_layout.tsx when it must survive navigation) rather than repeating it per frame. The structure checklist is in the vetta-ui-design skill, under Workflow.";
	}
	if (shell && (shell.layout || shell.components.length > 0)) {
		return "This design already has shared UI (see `sharedShell`) — reuse it instead of writing a second copy.";
	}
	return "Design open on the canvas.";
}

export function registerDesignTools(ctx: PluginContext): void {
	ctx.agent.registerTool<CreateInput>({
		id: "vetd-create",
		name: "vetd_create",
		label: "%tool.vetd_create%",
		// 工具描述每轮都在系统提示里，所以只留「做什么 + 去哪拿规则」。规则本身归
		// skill 正文（已验证 invoke_skill 能送达），在这里复述一遍是双份 token。
		description:
			"Create a new Vetta UI Design document (.vetd manifest + sidecar sources) in the current workspace and open it on the design canvas. Use when the user asks to start a UI design / mockup. Requires the product type (or an explicit frame size) — that is what the design defaults to, so decide it from the user's request BEFORE calling. Each frames/<id>.tsx is one canvas frame AND one route — invoke the vetta-ui-design skill for the rules before writing any of them.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Design document name (kebab-case preferred), e.g. `login-app`.",
				},
				product: {
					type: "string",
					enum: PRODUCT_TYPES,
					description: `What is being designed — sets this design's default frame size (${PRODUCT_SIZE_SUMMARY}). Take it from the user's request in whatever language they wrote it: a phone app is \`mobile\`, an admin console or dashboard is \`desktop\`. Anything else (infographic, A4 print, a square social post) goes through \`frameSize\` instead.`,
				},
				frameSize: {
					type: "object",
					properties: {
						width: { type: "number" },
						height: { type: "number" },
					},
					required: ["width", "height"],
					additionalProperties: false,
					description:
						"Explicit default size in PIXELS, for whatever `product` cannot express — the user named a size (`800x800`), or a physical format you convert yourself (A4 at 96dpi is 794x1123, at 300dpi 2480x3508). Wins over `product` when both are given.",
				},
			},
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session, trigger }) => {
			// 硬闸而不是默认值：品类是这一步唯一需要判断的东西，而它在这一刻最清楚。
			// 从前这里没有参数，兜底就写死成桌面 1440x900，于是「用户要移动 App」在整条
			// 链路上无处可存——五个 frame 漏声明尺寸，整份设计静默落成桌面尺寸。
			const defaultFrameSize = resolveDefaultFrameSize(trigger.input);
			if (!defaultFrameSize) {
				return {
					ok: false,
					error: `Pass \`product\` (${PRODUCT_TYPES.join(" | ")}) or an explicit \`frameSize\` in pixels. This is the size the design defaults to — decide it from what the user asked for, do not guess after the fact.`,
				};
			}
			const result = await scaffoldDesign(host.fs, session.cwd, trigger.input.name ?? "design", defaultFrameSize);
			setPendingDesignPath(result.vetdPath);
			ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true);
			ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
			return {
				ok: true,
				vetdPath: result.vetdPath,
				sourcesDir: result.dirPath,
				defaultFrameSize,
				note: `Design created and opened on the canvas, with NO frames yet. Its default size is ${defaultFrameSize.width}x${defaultFrameSize.height} — still declare it per frame: every frames/<id>.tsx starts with \`export const frame = { width: ${defaultFrameSize.width}, height: ${defaultFrameSize.height}, title }\`, and a screen of a different product type declares its own. Never edit the .vetd manifest. More than one screen? Write the shared chrome FIRST (components/, or frames/_layout.tsx), then every frame as a short skeleton so the whole set reaches the canvas immediately, and only then fill them in one at a time — see the vetta-ui-design skill.`,
			};
		},
	});

	ctx.agent.registerTool<ScreenshotInput>({
		id: "vetd-screenshot",
		name: SCREENSHOT_TOOL_NAME,
		label: "%tool.vetd_screenshot%",
		description:
			"Capture a rendered screenshot of one design frame from the open design canvas. Returns a PNG file path — call the Read tool on that path to actually see the rendering and verify your design changes visually. Also machine-checks the sources first: a frame that does not parse returns the syntax error instead of an image, and `issues` carries any rule violations found in that frame. This is the checkpoint after writing a frame — screenshot before revising it, never revise blind.",
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
			// 机检先于截图：语法错的 frame 从磁盘上就判定得了，不必等画布那条 30s 的
			// 链路，也不受「位图态没挂 iframe 所以 HMR 报不出错」的限制。顺带把这一帧的
			// 风格违规一起带回去——截图本来就是每帧必调的，agent 不用再单独跑 vetd_status。
			const issues = await inspectIssues(ctx, host.fs, controller.session.dirPath);
			const blocking = blockingSyntaxIssues(issues, frameId);
			if (blocking.length > 0) {
				return {
					ok: false,
					retryable: true,
					error: `Frame "${frameId}" cannot build — these sources do not parse, so the canvas is still showing the previous rendering:\n\n${blocking
						.map((issue) => `${issue.file}${issue.line === null ? "" : `:${issue.line}`} — ${issue.message}`)
						.join("\n")}\n\nEdit the broken region (do not rewrite the whole file), then take the screenshot again.`,
				};
			}
			const known = controller.session.manifest.frames.map((frame) => frame.id);
			if (!known.includes(frameId)) {
				// 漏声明尺寸不再让画框掉出画布（vetd/frame-size.ts），所以源码在、画布上
				// 没有，剩下的只有一种情况：文件刚落盘，reconcile 的防抖还没跑完。
				const exists = await host.fs
					.readFile(`${controller.session.dirPath}/frames/${frameId}.tsx`)
					.then(() => true)
					.catch(() => false);
				return {
					ok: false,
					retryable: true,
					error: exists
						? `Frame "${frameId}" is not on the canvas yet — frames/${frameId}.tsx exists, so the canvas is still picking it up. Wait a moment and take the screenshot again.`
						: `Unknown frame "${frameId}". Available frames: ${known.join(", ") || "(none)"}`,
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
			// 只带这一帧自己的违规：截图是逐帧调的，把整份设计的 issues 全塞进来会让
			// agent 拿着别的 frame 的报错去改当前这个。
			const frameIssues = issues.filter((issue) => issue.file === `frames/${frameId}.tsx`);
			// 搭车提醒（与 issues 同一先例）：截图是每帧必调的，这一帧有待处理的用户
			// 备注就在这里点名，agent 不必单独巡检。
			const framePendingNotes = pendingNotes(controller.notes.notes).filter(
				(note) => note.anchor.kind !== "free" && note.anchor.frameId === frameId,
			).length;
			return {
				ok: true,
				path,
				...(framePendingNotes > 0
					? {
							pendingNotes: framePendingNotes,
							notesReminder: `This frame has ${framePendingNotes} pending user note(s). Call vetd_notes to see them (annotated screenshot + source anchors) and address them before you finish.`,
						}
					: {}),
				...(frameIssues.length > 0 ? { issues: frameIssues } : {}),
				// 光说「截好了」模型会只瞟一眼就宣布完成。把该找什么写在这里：工具返回是
				// 每次都读的，而 references/quality.md 未必被翻开。三项是实测最高频的
				// 渲染缺陷，共同点是源码怎么读都读不出来，只有看图才能发现。
				note: `Screenshot saved${frameIssues.length > 0 ? " — `issues` lists rule violations the checker proved in this frame's source; fix them with a targeted edit along with whatever you see in the image" : ""}. Read this path to actually look at the rendering, and inspect it for defects the source cannot reveal: (1) misalignment — edges/baselines that should line up but do not, cards of unequal height, inconsistent gutters; (2) unintended text wrapping — buttons, tabs, table headers, nav items or labels spilling onto a second line (CJK copy is wider than the English the container was sized for), and text clipped or overflowing; (3) classes that resolve to nothing — Tailwind emits no CSS for a class it cannot resolve, so the element silently keeps its default look while the source reads fine: an icon slot collapsing to empty space (a name or set that does not exist), or a surface with no background because its theme token was never defined in theme.css. Also check clipping, contrast, and whether the frame fills its declared height. Fix what you find and screenshot again — see references/quality.md for the full checklist.`,
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
			"Inspect the Vetta UI Design state: workspace designs, the design open on the canvas, its frames (id/size/title/`buildError`), its `sharedShell` (existing _layout.tsx + components/ to reuse), `issues` (files that do not parse, plus rule violations found in your sources) and engine diagnostics. Call it ONCE before editing an existing design, to learn what is already there. Afterwards you do not need it for `issues` — vetd_screenshot returns them per frame.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		handler: async ({ host, session }) => {
			const designs = await findVetdFiles(host.fs, session.cwd);
			const controller = getCanvasController();
			const engine = await engineDiagnostics(controller?.session.dirPath ?? null);
			const shell = controller ? await inspectSharedShell(host.fs, controller.session.dirPath) : null;
			const issues = controller ? await inspectIssues(ctx, host.fs, controller.session.dirPath) : [];
			return {
				designs,
				open: controller
					? {
							vetdPath: controller.session.vetdPath,
							sourcesDir: controller.session.dirPath,
							// 这份设计是什么品类的。新画框漏声明尺寸时兜底就是它，所以
							// agent 补声明时该照着它写，而不是回去猜。
							...(controller.session.manifest.defaultFrameSize
								? { defaultFrameSize: controller.session.manifest.defaultFrameSize }
								: {}),
							// 复用面先于画框列出：agent 是一屏一屏往下写的，看不见既有的
							// 外壳与组件就会在每个 frame 里重抄一遍导航栏。
							sharedShell: shell,
							issues,
							// 用户在画布上留的待处理备注数。非零时先调 vetd_notes 看内容。
							pendingNotes: pendingNotes(controller.notes.notes).length,
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
				...(controller ? { note: statusNote(shell, issues, controller.session.manifest.frames.length) } : {}),
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

	interface NotesInput {
		ids?: string[];
		resolve?: { id: string; reply: string }[];
	}

	/** vetd_notes 返回给模型的一条备注。 */
	interface NoteView {
		number: number;
		id: string;
		status: "pending" | "resolved";
		messages: { author: string; text: string }[];
		/** 锚在哪：frame 内（含元素）或画布空白处。 */
		location:
			| { kind: "frame"; frame: string; frameFile: string; x: number; y: number }
			| { kind: "canvas"; x: number; y: number; detachedFromDeletedFrame?: string };
		/** 元素锚（刚刚现场重解析过）；`source` 即 `frames/x.tsx:行号`。 */
		element?: { source: string | null; domPath: string; tag: string; text: string };
		/** true = 原锚定元素在当前 DOM 里已找不到，element 是放置时的旧快照，行号不可信。 */
		anchorStale?: boolean;
	}

	ctx.agent.registerTool<NotesInput>({
		id: "vetd-notes",
		name: "vetd_notes",
		label: "%tool.vetd_notes%",
		description:
			"User notes pinned on the design canvas (Figma-style comments addressed to you). No args: list PENDING notes — each with its thread, a freshly re-resolved source anchor (`element.source` = file:line, authoritative unless `anchorStale`), and per-frame screenshots where numbered pins mark note positions (numbers match `number`). `ids`: read specific notes instead. `resolve`: after fixing, reply per note to mark it resolved — this is the ONLY way to write notes; never edit .notes.json directly.",
		parameters: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Note ids to read (default: all pending notes).",
				},
				resolve: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							reply: {
								type: "string",
								description: "What you changed, one or two sentences, in the user's language.",
							},
						},
						required: ["id", "reply"],
						additionalProperties: false,
					},
					description: "Mark notes resolved with a reply each. Only resolve notes you actually addressed.",
				},
			},
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		agent_mode: AGENT_MODE,
		// 读取要为每个涉及的 frame 拉活体 + 截图 + 合成，逐帧 30s 的链路可能串联多次。
		timeoutMs: 120_000,
		handler: async ({ host, session, trigger }) => {
			const { ids, resolve } = trigger.input;
			const controller = getCanvasController();

			// —— 回写：agent 处理完的备注在这里定点落状态（插件仍是唯一写者）。 ——
			if (resolve && resolve.length > 0) {
				if (controller) {
					const unknown: string[] = [];
					for (const entry of resolve) {
						if (!controller.notes.appendMessage(entry.id, "agent", entry.reply)) unknown.push(entry.id);
					}
					await controller.notes.flush();
					const remaining = pendingNotes(controller.notes.notes).length;
					return {
						ok: unknown.length === 0,
						resolved: resolve.length - unknown.length,
						...(unknown.length > 0 ? { unknownIds: unknown } : {}),
						pendingRemaining: remaining,
					};
				}
				// 画布没开：没有别的写者，直接 patch 文件（同样按 id 定点，不整体重写语义）。
				let vetdPath: string;
				try {
					vetdPath = await resolveVetdPath(host, session.cwd);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				const dirPath = sidecarDirOf(vetdPath);
				const path = notesFilePath(dirPath);
				const file = parseNotesFile(await host.fs.readFile(path).then((r) => r.content, () => ""));
				const unknown: string[] = [];
				for (const entry of resolve) {
					const note = file.notes.find((candidate) => candidate.id === entry.id);
					if (!note) {
						unknown.push(entry.id);
						continue;
					}
					note.messages.push({ author: "agent", text: entry.reply, at: Date.now() });
				}
				await host.fs.writeFile(path, `${JSON.stringify(file satisfies NotesFile, null, "\t")}\n`);
				return {
					ok: unknown.length === 0,
					resolved: resolve.length - unknown.length,
					...(unknown.length > 0 ? { unknownIds: unknown } : {}),
					pendingRemaining: pendingNotes(file.notes).length,
				};
			}

			// —— 读取。画布没开时退化成纯文本锚点（截不了标注图，锚点也无法保鲜）。 ——
			if (!controller) {
				let vetdPath: string;
				try {
					vetdPath = await resolveVetdPath(host, session.cwd);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				const dirPath = sidecarDirOf(vetdPath);
				const file = parseNotesFile(await host.fs.readFile(notesFilePath(dirPath)).then((r) => r.content, () => ""));
				const targets = ids && ids.length > 0 ? file.notes.filter((note) => ids.includes(note.id)) : pendingNotes(file.notes);
				return {
					ok: true,
					notes: targets.map((note, index) => toNoteView(note, index + 1, dirPath)),
					note: "The design canvas is not open, so anchors are frozen snapshots (source line numbers may have drifted) and no annotated screenshots are available. Locate elements by their text/domPath if a line looks wrong.",
				};
			}

			const { dirPath } = controller.session;
			const all = controller.notes.notes;
			const targets = ids && ids.length > 0 ? all.filter((note) => ids.includes(note.id)) : pendingNotes(all);
			const unknownIds = ids?.filter((id) => !controller.notes.noteById(id)) ?? [];
			if (targets.length === 0) {
				return { ok: true, notes: [], ...(unknownIds.length > 0 ? { unknownIds } : {}), note: "No pending notes." };
			}
			const numberOf = new Map(targets.map((note, index) => [note.id, index + 1]));

			// 按 frame 分组做锚点保鲜 + 标注图；自由备注只有文本。
			const frames = controller.session.manifest.frames;
			const byFrame = new Map<string, DesignNote[]>();
			for (const note of targets) {
				const anchor = note.anchor;
				if (anchor.kind === "free") continue;
				if (!frames.some((frame) => frame.id === anchor.frameId)) continue;
				const group = byFrame.get(anchor.frameId) ?? [];
				group.push(note);
				byFrame.set(anchor.frameId, group);
			}

			const staleIds = new Set<string>();
			const screenshots: { frame: string; path: string }[] = [];
			for (const [frameId, group] of byFrame) {
				const frame = frames.find((candidate) => candidate.id === frameId);
				if (!frame) continue;
				// 保鲜：元素锚按 domPath 重查（行号跟着代码走），frame 锚按坐标补一次 hit-test。
				const queries: ElementQuery[] = group.map((note) => {
					const anchor = note.anchor;
					if (anchor.kind === "element") return { domPath: anchor.element.domPath };
					if (anchor.kind === "frame") return { x: anchor.fx, y: anchor.fy };
					return { x: 0, y: 0 }; // free 不进分组，纯类型收口
				});
				let payloads: (SelectedElementPayload | null)[] = [];
				try {
					payloads = await controller.resolveNoteElements(frameId, queries);
				} catch {
					payloads = queries.map(() => null);
				}
				group.forEach((note, index) => {
					const payload = payloads[index];
					if (payload) {
						controller.notes.upgradeAnchor(note.id, {
							domPath: payload.domPath,
							tag: payload.tag,
							text: payload.text,
							classes: payload.classes,
							source: payload.source,
						});
					} else if (note.anchor.kind === "element") {
						staleIds.add(note.id);
					}
				});
				// 标注图：干净截图 + 编号气泡二次合成（编号与返回列表严格同号）。
				try {
					const dataUrl = await controller.captureFrame(frameId);
					const annotated = await composeNotePins(
						dataUrl,
						{ width: frame.width, height: frame.height },
						group.map((note) => ({
							fx: note.anchor.kind === "free" ? 0 : note.anchor.fx,
							fy: note.anchor.kind === "free" ? 0 : note.anchor.fy,
							label: numberOf.get(note.id) ?? 0,
						})),
					);
					const path = snapshotPath(dirPath, `notes-${frameId}`, Date.now());
					await host.fs.writeFile(path, annotated.split(",")[1] ?? "", "base64");
					await ensureSnapshotsIgnored(host.fs, dirPath);
					await pruneSnapshots(host.fs, dirPath, `notes-${frameId}`);
					screenshots.push({ frame: frameId, path });
				} catch {
					// 截不到图不拦整个读取：文本锚点仍然可用。
				}
			}

			// 保鲜写回后从 store 取最新锚点。
			const views = targets.map((note) => {
				const fresh = controller.notes.noteById(note.id) ?? note;
				const view = toNoteView(fresh, numberOf.get(note.id) ?? 0, dirPath);
				if (staleIds.has(note.id)) view.anchorStale = true;
				return view;
			});
			return {
				ok: true,
				notes: views,
				...(unknownIds.length > 0 ? { unknownIds } : {}),
				...(screenshots.length > 0 ? { screenshots } : {}),
				note: "Read every screenshot path — the numbered pins mark each note's position (numbers match `number`). `element.source` (file:line) was re-resolved just now and is the authoritative edit target unless `anchorStale`. Address each note with a targeted edit, verify with vetd_screenshot, then call vetd_notes again with `resolve` to reply and mark them done.",
			};
		},
	});

	/** DesignNote → 模型视图（与画布/抽屉共享同一份状态推导）。 */
	function toNoteView(note: DesignNote, number: number, dirPath: string): NoteView {
		const base = {
			number,
			id: note.id,
			status: noteStatus(note),
			messages: note.messages.map((message) => ({ author: message.author, text: message.text })),
		};
		if (note.anchor.kind === "free") {
			return {
				...base,
				location: {
					kind: "canvas",
					x: note.anchor.x,
					y: note.anchor.y,
					...(note.anchor.detachedFrom ? { detachedFromDeletedFrame: note.anchor.detachedFrom } : {}),
				},
			};
		}
		return {
			...base,
			location: {
				kind: "frame",
				frame: note.anchor.frameId,
				frameFile: `${dirPath}/frames/${note.anchor.frameId}.tsx`,
				x: note.anchor.fx,
				y: note.anchor.fy,
			},
			...(note.anchor.kind === "element"
				? {
						element: {
							source: note.anchor.element.source,
							domPath: note.anchor.element.domPath,
							tag: note.anchor.element.tag,
							text: note.anchor.element.text,
						},
					}
				: {}),
		};
	}
}
