import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ElementQuery, SelectedElementPayload } from "./canvas/bridge-client";
import {
	type CanvasController,
	getCanvasController,
	getFrameError,
	setPendingDesignPath,
} from "./canvas/design-runtime";
import { captureFrameOffscreen, offscreenRasterSupported } from "./canvas/offscreen-raster";
import { screenshotCardDescriptor, SCREENSHOT_TOOL_NAME } from "./cards/screenshot-card";
import { pruneSnapshots, snapshotPath } from "./cards/snapshots";
import { registerHistoryTools } from "./history/history-tools";
import { setDesignPresence } from "./vetd/design-presence";
import { ensureDesignIgnored } from "./vetd/design-ignore";
import { ENGINE_PROVIDED_PACKAGES } from "./engine/engine-files";
import { engineDiagnostics, installDesignDependencies } from "./engine/engine-manager";
import { composeNotePins } from "./notes/annotate";
import { notesFilePath } from "./notes/notes-store";
import { type DesignNote, type NotesFile, noteStatus, parseNotesFile, pendingNotes } from "./notes/types";
import { CANVAS_TAB_ID } from "./tab-ids";
import type { SourceIssue } from "./vetd/check-sources";
import { blockingSyntaxIssues, SYNTAX_RULE } from "./vetd/check-syntax";
import { readDesignDependencies } from "./vetd/design-package";
import { findVetdFiles } from "./vetd/discover";
import { inspectIssues } from "./vetd/inspect";
import { layoutIssues } from "./vetd/layout-probe";
import { PRODUCT_SIZE_SUMMARY, PRODUCT_TYPES, resolveDefaultFrameSize } from "./vetd/product-size";
import { DESIGN_ONLY_TOOLS } from "./vetd/tool-gate";
import {
	composeVerificationSheet,
	designSourceFingerprints,
	recordVerificationCapture,
	resolveScreenshotSelection,
	summarizeRenderVerification,
	type RenderVerificationSummary,
	type ScreenshotSelectionInput,
} from "./vetd/render-verification";
import { scaffoldDesign } from "./vetd/scaffold";

const SCOPE_USE = ["project", "conversation"] as const;
/** 与画布位图队列同一档（canvas/frame-raster.ts）：模型看的图不该比画布上的糊。 */
const SCREENSHOT_JPEG_QUALITY = 0.92;

interface CreateInput {
	name?: string;
	product?: string;
	frameSize?: { width: number; height: number };
}

type ScreenshotInput = ScreenshotSelectionInput;

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
	renderVerification: RenderVerificationSummary,
): string {
	const syntaxCount = issues.filter((issue) => issue.rule === SYNTAX_RULE).length;
	if (syntaxCount > 0) {
		// 语法错是硬阻塞（那一帧根本没在渲染），不能和风格违规并列。
		return `${syntaxCount} file(s) do not parse — the canvas cannot build them, so those frames are frozen on their last good rendering. Fix these first, with a targeted edit at the reported line rather than a full rewrite.`;
	}
	if (issues.length > 0) {
		return `${issues.length} issue(s) found by deterministic source checks. Fix them with a targeted edit before reporting back; each message names the rule and the reference to read.`;
	}
	if (renderVerification.status === "stale") {
		return `The latest rendered verification is stale for: ${renderVerification.staleFrames.join(", ")}. Those sources changed after capture; verify the touched frames again, preferably in one screenshot batch.`;
	}
	if (renderVerification.status === "issues") {
		return `Rendered verification still has measured issues in: ${renderVerification.issueFrames.map((entry) => entry.frame).join(", ")}. If the same image and issue repeat twice, stop blind edits and report the stalled checker result.`;
	}
	if (renderVerification.status === "not-run" || renderVerification.status === "partial") {
		return `Rendered verification is ${renderVerification.status}; unverified frames: ${renderVerification.unverifiedFrames.join(", ") || "(none)"}. Capture the frames you changed in one batch and read the returned overview once.`;
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
		// 反向触发段（Do NOT / Only for）是误调防线的第一层：这个工具会在用户工作区
		// 里建一整棵目录，模型在「写个页面」这种指令上最容易把它当成实现路径。
		description:
			"Create a new Vetta UI Design document (a `<name>.vetd/` directory holding design.json + sources) in the current workspace and open it on the design canvas. Requires the product type (or an explicit frame size) — that is what the design defaults to, so decide it from the user's request BEFORE calling. Each frames/<id>.tsx is one canvas frame AND one route — invoke the vetta-ui-design skill for the rules before writing any of them.\nDo NOT use when the user is writing or modifying code in an existing codebase — implement the page directly in that repo's own framework instead.\nOnly for standalone visual exploration decoupled from any codebase, when the user asked for a design/mockup rather than working code.",
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
		// 在用户工作区落一整棵 .vetd 工程目录。
		side_effect: "heavy",
		handler: async ({ host, session, trigger, actions }) => {
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
			// Provider 在一个 Turn 内只执行一次：仅更新 presence 只能让下一 Turn 开闸。
			// 工具 handler 的 effect 会在当前 Turn 后续模型调用上重放，因此创建成功后
			// 还要显式覆盖本轮开头写入的 disable，避免 agent 只剩 vetd_create 可用。
			setDesignPresence(session.cwd, true);
			for (const toolName of DESIGN_ONLY_TOOLS) actions.tools.enable(toolName);
			setPendingDesignPath(result.vetdPath, session.cwd);
			console.debug(
				`[vetta-ui-design:activity-tab-debug] vetd_create requesting canvas ${JSON.stringify({
					sessionCwd: session.cwd,
					vetdPath: result.vetdPath,
					tabId: CANVAS_TAB_ID,
				})}`,
			);
			ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true, { cwd: session.cwd });
			ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max", cwd: session.cwd });
			return {
				ok: true,
				vetdPath: result.vetdPath,
				sourcesDir: result.dirPath,
				defaultFrameSize,
				note: `Design created and opened on the canvas, with NO frames yet. Its default size is ${defaultFrameSize.width}x${defaultFrameSize.height} — still declare it per frame: every frames/<id>.tsx starts with \`export const frame = { width: ${defaultFrameSize.width}, height: ${defaultFrameSize.height}, title }\`, and a screen of a different product type declares its own. Never edit design.json. More than one screen? Write the shared chrome FIRST (components/, or frames/_layout.tsx), then every frame as a short skeleton so the whole set reaches the canvas immediately, and only then fill them in one at a time — see the vetta-ui-design skill.`,
			};
		},
	});

	ctx.agent.registerTool<ScreenshotInput>({
		id: "vetd-screenshot",
		name: SCREENSHOT_TOOL_NAME,
		label: "%tool.vetd_screenshot%",
		description:
			"Capture and machine-check one or more rendered design frames. Prefer `frames` or `all: true` for a multi-screen checkpoint: the tool inspects sources once, reuses one delivery capture session, and returns one contact-sheet path to Read once. The existing `frame` form remains available for a targeted recheck. Each frame reports measured/source `issues`; `stalled: true` means two consecutive captures had the same image and issues, so stop blind edits instead of trying a third cosmetic change.\nDo NOT use to capture anything that is not a frame of an open .vetd design — a dev server, a website, or an app you are building in the repo; drive those with the browser tooling instead.\nOnly for verifying frames of the design document currently open on the canvas.",
		parameters: {
			type: "object",
			properties: {
				frame: {
					type: "string",
					description: "One frame id (the frames/<id>.tsx basename), e.g. `login`. Use for a targeted recheck.",
				},
				frames: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					maxItems: 12,
					description: "Frame ids to capture as one verification batch. Prefer this after changing several screens.",
				},
				all: {
					type: "boolean",
					description: "Set to true to capture every frame in the open design as one verification batch.",
				},
			},
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		// 交付截图必须复用宿主保留的第 4 个离屏会话（另 3 个属于画布位图队列），
		// 所以批量串行；上限 12 帧，外层留足内层极端超时与总览合成时间。
		timeoutMs: 270_000,
		handler: async ({ host, session, trigger }) => {
			const controller = getCanvasController();
			if (!controller) {
				ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max", cwd: session.cwd });
				return {
					ok: false,
					retryable: true,
					error:
						"The design canvas is not open (it was just requested to open). Wait a moment and retry, or ask the user to open the Design tab.",
				};
			}
			const known = controller.session.manifest.frames.map((frame) => frame.id);
			let selection: ReturnType<typeof resolveScreenshotSelection>;
			try {
				selection = resolveScreenshotSelection(trigger.input, known);
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
			const { dirPath, vetdPath } = controller.session;
			// 源码检查与指纹各做一次，而不是跟帧数线性重复。
			const [sourceIssues, sourceFingerprints] = await Promise.all([
				inspectIssues(ctx, host.fs, dirPath),
				designSourceFingerprints(host.fs, dirPath, known),
			]);
			const useOffscreen = offscreenRasterSupported();
			type Success = {
				ok: true;
				frame: string;
				path: string;
				dataUrl: string;
				width: number;
				height: number;
				issues: SourceIssue[];
				pendingNotes: number;
				verification: ReturnType<typeof recordVerificationCapture>;
			};
			type Failure = { ok: false; frame: string; retryable: boolean; error: string };
			type Result = Success | Failure;

			const captureOne = async (frameId: string): Promise<Result> => {
				const blocking = blockingSyntaxIssues(sourceIssues, frameId);
				if (blocking.length > 0) {
					return {
						ok: false,
						frame: frameId,
						retryable: true,
						error: `Frame "${frameId}" cannot build:\n${blocking
							.map((issue) => `${issue.file}${issue.line === null ? "" : `:${issue.line}`} — ${issue.message}`)
							.join("\n")}`,
					};
				}
				const frameSize = controller.session.manifest.frames.find((frame) => frame.id === frameId);
				if (!frameSize) {
					const exists = await host.fs
						.readFile(`${dirPath}/frames/${frameId}.tsx`)
						.then(() => true)
						.catch(() => false);
					return {
						ok: false,
						frame: frameId,
						retryable: exists,
						error: exists
							? `Frame "${frameId}" exists but is not on the canvas yet. Wait for reconciliation and retry.`
							: `Unknown frame "${frameId}". Available frames: ${known.join(", ") || "(none)"}`,
					};
				}
				const buildError = getFrameError(frameId);
				if (buildError) {
					return { ok: false, frame: frameId, retryable: true, error: `Frame "${frameId}" cannot build:\n${buildError}` };
				}
				let dataUrl: string;
				let probe: unknown;
				try {
					if (useOffscreen) {
						const raster = await captureFrameOffscreen({
							port: controller.port,
							frameId,
							width: frameSize.width,
							height: frameSize.height,
							quality: SCREENSHOT_JPEG_QUALITY,
							probeLayout: true,
						});
						dataUrl = raster.dataUrl;
						probe = raster.probe;
					} else {
						dataUrl = await controller.captureFrame(frameId);
					}
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					const late = getFrameError(frameId);
					return {
						ok: false,
						frame: frameId,
						retryable: true,
						error: late ? `Screenshot failed (${reason}); frame build error:\n${late}` : `Screenshot failed: ${reason}`,
					};
				}
				const lateError = getFrameError(frameId);
				if (lateError) {
					return { ok: false, frame: frameId, retryable: true, error: `Frame failed to build during capture:\n${lateError}` };
				}
				const frameIssues = [
					...sourceIssues.filter((issue) => issue.file === `frames/${frameId}.tsx`),
					...layoutIssues(probe, frameId),
				];
				const capturedAt = Date.now();
				const path = snapshotPath(dirPath, frameId, capturedAt);
				await host.fs.writeFile(path, dataUrl.split(",")[1] ?? "", "base64");
				await pruneSnapshots(host.fs, dirPath, frameId);
				const framePendingNotes = pendingNotes(controller.notes.notes).filter(
					(note) => note.anchor.kind !== "free" && note.anchor.frameId === frameId,
				).length;
				return {
					ok: true,
					frame: frameId,
					path,
					dataUrl,
					width: frameSize.width,
					height: frameSize.height,
					issues: frameIssues,
					pendingNotes: framePendingNotes,
					verification: recordVerificationCapture({
						vetdPath,
						frameId,
						dataUrl,
						issues: frameIssues,
						sourceFingerprint: sourceFingerprints.get(frameId) ?? "",
						capturedAt,
					}),
				};
			};

			const results: Result[] = [];
			for (const frameId of selection.frameIds) results.push(await captureOne(frameId));
			const successful = results.filter((result): result is Success => result.ok);
			const failed = results.filter((result): result is Failure => !result.ok);
			if (successful.length > 0) await ensureDesignIgnored(host.fs, dirPath);

			if (selection.single) {
				const [result] = results;
				if (!result || !result.ok) return result ?? { ok: false, error: "No frame was captured." };
				return {
					ok: true,
					path: result.path,
					...(result.pendingNotes > 0 ? { pendingNotes: result.pendingNotes } : {}),
					...(result.issues.length > 0 ? { issues: result.issues } : {}),
					verification: result.verification,
					note: result.verification.stalled
						? "The image and measured issues are unchanged across two captures. Do not make a third blind edit; inspect the image/checker assumption and report the stalled result if it is a false positive."
						: "Read this screenshot now. Check hierarchy, copy, icon meaning, contrast, spacing, clipping and frame fill; make only evidence-based edits, then recheck this frame if needed.",
					cards: [screenshotCardDescriptor(vetdPath, dirPath, result.frame)],
				};
			}

			let overviewPath: string | null = null;
			if (successful.length > 1) {
				const sheet = await composeVerificationSheet(
					successful.map((result) => ({
						id: result.frame,
						width: result.width,
						height: result.height,
						dataUrl: result.dataUrl,
					})),
				);
				if (sheet) {
					overviewPath = snapshotPath(dirPath, "verification-overview", Date.now());
					await host.fs.writeFile(overviewPath, sheet.split(",")[1] ?? "", "base64");
					await pruneSnapshots(host.fs, dirPath, "verification-overview");
				}
			} else if (successful.length === 1) {
				overviewPath = successful[0].path;
			}
			const stalledFrames = successful.filter((result) => result.verification.stalled).map((result) => result.frame);
			return {
				ok: successful.length > 0,
				...(failed.length > 0 ? { partial: successful.length > 0, failed } : {}),
				...(overviewPath ? { path: overviewPath } : {}),
				frames: successful.map(({ frame, path, issues, pendingNotes: count, verification }) => ({
					frame,
					path,
					...(issues.length > 0 ? { issues } : {}),
					...(count > 0 ? { pendingNotes: count } : {}),
					verification,
				})),
				verification: {
					captured: successful.map((result) => result.frame),
					stalledFrames,
				},
				note: overviewPath
					? `Read the overview path once and compare all captured frames together.${stalledFrames.length > 0 ? ` Stop blind edits on stalled frames: ${stalledFrames.join(", ")}.` : ""}`
					: "The overview could not be composed in this host. Read the per-frame paths listed in `frames`.",
				cards: successful.map((result) => screenshotCardDescriptor(vetdPath, dirPath, result.frame)),
			};
		},
	});

	ctx.agent.registerTool({
		id: "vetd-status",
		name: "vetd_status",
		label: "%tool.vetd_status%",
		description:
			"Inspect the Vetta UI Design state: workspace designs, the open design, frames, shared UI, source-only `issues`, `renderVerification`, pending notes and engine diagnostics. `issues: []` only means the source checks are clear; it is never proof that UI verification passed. `renderVerification` reports which latest captures are clean, stale, unverified, or still have measured issues. Call this once before editing an existing design; use vetd_screenshot batches for subsequent verification.\nDo NOT use to survey a code repository, locate its UI source files or read its build state — use the ordinary file search and read tools instead.\nOnly for .vetd design documents and the design canvas.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		scope_use: SCOPE_USE,
		handler: async ({ host, session }) => {
			const designs = await findVetdFiles(host.fs, session.cwd);
			const controller = getCanvasController();
			const engine = await engineDiagnostics(controller?.session.dirPath ?? null);
			const shell = controller ? await inspectSharedShell(host.fs, controller.session.dirPath) : null;
			const [issues, sourceFingerprints] = controller
				? await Promise.all([
						inspectIssues(ctx, host.fs, controller.session.dirPath),
						designSourceFingerprints(
							host.fs,
							controller.session.dirPath,
							controller.session.manifest.frames.map((frame) => frame.id),
						),
					])
				: [[], new Map<string, string>()];
			const renderVerification = controller
				? summarizeRenderVerification(
						controller.session.vetdPath,
						controller.session.manifest.frames.map((frame) => frame.id),
						sourceFingerprints,
					)
				: null;
			// 这份设计装过的第三方库。react 三件套不列：它们由引擎提供，每份设计都有，
			// 报出来只是每轮多几个 token。
			const dependencies = controller
				? (await readDesignDependencies(host.fs, controller.session.dirPath)).filter(
						(name) => !ENGINE_PROVIDED_PACKAGES.includes(name as (typeof ENGINE_PROVIDED_PACKAGES)[number]),
					)
				: [];
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
							// 已装的第三方库，import 前先看这里：装过的直接用，没有的
							// 先掂量能不能用 Tailwind + React 写出来，真需要才 vetd_install。
							...(dependencies.length > 0 ? { dependencies } : {}),
							// 保留 `issues` 字段兼容旧客户端/提示词，但明确它只来自源码检查。
							issues,
							renderVerification,
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
				...(controller && renderVerification
					? { note: statusNote(shell, issues, controller.session.manifest.frames.length, renderVerification) }
					: {}),
			};
		},
	});

	/** 无画布场景下解析目标 .vetd：显式参数 > 打开的画布 > cwd 里唯一那份。 */
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


	/**
	 * npm 包名（可带 `@version`）。
	 *
	 * 卡这个形状不是为了限制能装什么，而是因为这些串会直接进 npm 的 argv：不校验的话
	 * 一个 `--foo` 就从「包名」变成了「npm 的开关」。file:/git+ssh 之类的说明符也一并
	 * 挡掉——设计要装的是 registry 上的库。
	 */
	const PACKAGE_SPEC = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[a-z0-9-._~^><=|\s*]+)?$/i;

	interface InstallInput {
		packages?: string[];
		design?: string;
	}

	ctx.agent.registerTool<InstallInput>({
		id: "vetd-install",
		name: "vetd_install",
		label: "%tool.vetd_install%",
		description:
			"Install npm packages INTO this design (they land in the design's own package.json + node_modules, and travel with it). Use when a screen genuinely needs a library the design does not have — charts, markdown rendering, a rich text editor, an animation library. Import the package normally once this returns.\nDo NOT use to add a dependency to the user's own project, nor for icons (Iconify CSS classes are always available) or anything Tailwind utilities and plain React state already do well — run the repo's own package manager in a terminal for project dependencies instead.\nOnly for packages that frames of a .vetd design import.",
		parameters: {
			type: "object",
			properties: {
				packages: {
					type: "array",
					items: { type: "string" },
					description:
						'npm package names, optionally with a version (`recharts`, `react-markdown@10`). Install everything you need in ONE call — each call is a separate npm round-trip.',
				},
				design: {
					type: "string",
					description: "Path to the `x.vetd/` directory (default: the design open on the canvas).",
				},
			},
			required: ["packages"],
			additionalProperties: false,
		},
		scope_use: SCOPE_USE,
		// 往设计工程的 node_modules 写依赖树（落在用户工作区的 .vetd 目录内）。
		side_effect: "heavy",
		handler: async ({ host, session, trigger }) => {
			const packages = trigger.input.packages ?? [];
			if (packages.length === 0) {
				return { ok: false, error: "Pass at least one package name in `packages`." };
			}
			const invalid = packages.filter((spec) => !PACKAGE_SPEC.test(spec.trim()));
			if (invalid.length > 0) {
				return {
					ok: false,
					error: `Not valid npm package names: ${invalid.join(", ")}. Pass registry names, optionally with a version (\`recharts\`, \`react-markdown@10\`).`,
				};
			}
			const designDir = await resolveVetdPath(host, session.cwd, trigger.input.design);
			try {
				const outputTail = await installDesignDependencies(
					ctx,
					designDir,
					packages.map((spec) => spec.trim()),
					() => {},
				);
				return {
					ok: true,
					design: designDir,
					installed: packages,
					outputTail,
					note: "Installed into this design — import them normally now. The canvas reloads on its own; if a frame that imports one of these still shows a build error, screenshot it again after your next edit.",
				};
			} catch (error) {
				return {
					ok: false,
					error: `Install failed: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	});

	// 版本历史的两个工具在 history/history-tools.ts：历史相关的东西全归那一处。
	registerHistoryTools(ctx, { resolveVetdPath, scopeUse: SCOPE_USE });

	interface NotesInput {
		ids?: string[];
		resolve?: { id: string; reply: string }[];
	}

	/** 拿到一批待办时的干活方式。列表读取与 resolve 后的续办共用。 */
	const NOTES_WORK_THROUGH_HINT =
		"Read every screenshot path — the numbered pins mark each note's position (numbers match `number`). `element.source` (file:line) was re-resolved just now and is the authoritative edit target unless `anchorStale`. Work through them ONE AT A TIME: edit for a note, verify it with vetd_screenshot, then immediately call vetd_notes with `resolve` for that single note before starting the next one. Do not batch the replies until the end — the user watches each note flip to resolved on the canvas as you go, and a turn that dies halfway must leave the finished ones already marked.";

	/**
	 * resolve 之后还有待办。这条提示得把「还没完」说死：这些备注多半是用户在你干活
	 * 期间新贴上来的，不会有任何消息通知你，这里就是它们唯一的入口。
	 */
	const NOTES_KEEP_GOING_HINT = `You are NOT done — \`notes\` above lists what is still pending, including anything the user pinned while you were working (nothing else will notify you about those). Keep going in this same turn: handle the next one now, resolve it, and repeat until a resolve comes back with \`pendingRemaining: 0\`. Do not report back or end your turn while notes remain. ${NOTES_WORK_THROUGH_HINT}`;

	const NOTES_ALL_CLEAR_HINT =
		"All notes are resolved — nothing is pending on the canvas. You can finish the rest of your checks and report back.";

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
			"User notes pinned on the design canvas (Figma-style comments addressed to you). No args: list PENDING notes — each with its thread, a freshly re-resolved source anchor (`element.source` = file:line, authoritative unless `anchorStale`), and per-frame screenshots where numbered pins mark note positions (numbers match `number`). `ids`: read specific notes instead. `resolve`: after fixing, reply per note to mark it resolved — this is the ONLY way to write notes; never edit .notes.json directly.\nDo NOT use for what the user wrote to you in this conversation, for code review comments or for issue trackers — act on those directly instead; and never as an end-of-turn habit on a turn that touched no .vetd design, e.g. after editing pages in the user's own codebase.\nOnly for notes pinned on the design canvas of an open .vetd design.",
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
					const remaining = pendingNotes(controller.notes.notes);
					const head = {
						ok: unknown.length === 0,
						resolved: resolve.length - unknown.length,
						...(unknown.length > 0 ? { unknownIds: unknown } : {}),
						pendingRemaining: remaining.length,
					};
					if (remaining.length === 0) return { ...head, note: NOTES_ALL_CLEAR_HINT };
					/**
					 * 还有待办就连同锚点与标注图一并回给它。
					 *
					 * 只回一个 `pendingRemaining: 2` 是不够的——实测 agent 拿到这个数字照样
					 * 收工报告，因为「用户交代的那件事」已经做完了。而这些备注往往是用户在
					 * 它干活期间新贴上来的，除了这里没有别的入口能送到它眼前。把下一批活直接
					 * 摆上来，顺带省掉它再查一次的那趟往返（那一趟同样要拉活体、截图）。
					 */
					const next = await readNotesLive(controller, host, remaining);
					return {
						...head,
						notes: next.notes,
						...(next.screenshots.length > 0 ? { screenshots: next.screenshots } : {}),
						note: NOTES_KEEP_GOING_HINT,
					};
				}
				// 画布没开：没有别的写者，直接 patch 文件（同样按 id 定点，不整体重写语义）。
				let vetdPath: string;
				try {
					vetdPath = await resolveVetdPath(host, session.cwd);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				const dirPath = vetdPath;
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
				// 画布没开：拉不了活体，给不出保鲜锚点与标注图，只能列出冻结快照。
				const remaining = pendingNotes(file.notes);
				return {
					ok: unknown.length === 0,
					resolved: resolve.length - unknown.length,
					...(unknown.length > 0 ? { unknownIds: unknown } : {}),
					pendingRemaining: remaining.length,
					...(remaining.length > 0
						? {
								notes: remaining.map((note, index) => toNoteView(note, index + 1, dirPath)),
								note: NOTES_KEEP_GOING_HINT,
							}
						: { note: NOTES_ALL_CLEAR_HINT }),
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
				const dirPath = vetdPath;
				const file = parseNotesFile(await host.fs.readFile(notesFilePath(dirPath)).then((r) => r.content, () => ""));
				const targets = ids && ids.length > 0 ? file.notes.filter((note) => ids.includes(note.id)) : pendingNotes(file.notes);
				return {
					ok: true,
					notes: targets.map((note, index) => toNoteView(note, index + 1, dirPath)),
					note: "The design canvas is not open, so anchors are frozen snapshots (source line numbers may have drifted) and no annotated screenshots are available. Locate elements by their text/domPath if a line looks wrong.",
				};
			}

			const all = controller.notes.notes;
			const targets = ids && ids.length > 0 ? all.filter((note) => ids.includes(note.id)) : pendingNotes(all);
			const unknownIds = ids?.filter((id) => !controller.notes.noteById(id)) ?? [];
			if (targets.length === 0) {
				return { ok: true, notes: [], ...(unknownIds.length > 0 ? { unknownIds } : {}), note: "No pending notes." };
			}
			const { notes: views, screenshots } = await readNotesLive(controller, host, targets);
			return {
				ok: true,
				notes: views,
				...(unknownIds.length > 0 ? { unknownIds } : {}),
				...(screenshots.length > 0 ? { screenshots } : {}),
				note: NOTES_WORK_THROUGH_HINT,
			};
		},
	});

	/**
	 * 读一批备注：锚点保鲜 + 每帧标注图。画布开着才走这条（要拉活体）。
	 *
	 * 读取与 resolve 后的「还剩什么」共用同一条实现：agent 处理完一条后，剩下的待办
	 * 连同标注图一并回给它，省掉一次往返，也省掉它自己想起来要再查一次。
	 */
	async function readNotesLive(
		controller: CanvasController,
		host: { fs: PluginContext["fs"] },
		targets: readonly DesignNote[],
	): Promise<{ notes: NoteView[]; screenshots: { frame: string; path: string }[] }> {
		const { dirPath } = controller.session;
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
		{
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
					await ensureDesignIgnored(host.fs, dirPath);
					await pruneSnapshots(host.fs, dirPath, `notes-${frameId}`);
					screenshots.push({ frame: frameId, path });
				} catch {
					// 截不到图不拦整个读取：文本锚点仍然可用。
				}
			}
		}

		// 保鲜写回后从 store 取最新锚点。
		const notes = targets.map((note) => {
			const fresh = controller.notes.noteById(note.id) ?? note;
			const view = toNoteView(fresh, numberOf.get(note.id) ?? 0, dirPath);
			if (staleIds.has(note.id)) view.anchorStale = true;
			return view;
		});
		return { notes, screenshots };
	}

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
