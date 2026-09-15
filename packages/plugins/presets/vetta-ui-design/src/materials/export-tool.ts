/**
 * vetd_export：用户要「导出 PDF / 导出全部图片」时，agent 用它把设计产物落到当前目录。
 *
 * 与 vetd_screenshot 分工明确：那个是给模型自己看、做设计检查的（jpeg、只截视口、
 * 带机检 issues）；这个是交付给用户的文件（完整内容、原图 png / 一帧一页 PDF），
 * 不带任何检查。两者混用的代价都不小——拿导出做检查会每轮把大图写进用户目录，
 * 拿截图当交付物则拿到的是被裁掉滚动内容的缩略图。
 *
 * 截图与打包复用画布「下载素材」那条链路（materials/），区别只在落盘：画布弹另存为，
 * 这里直接写进会话的工作目录。
 */
import type { PluginContext, PluginFsApi } from "@vetta-org/plugin-sdk";
import { getCanvasController } from "../canvas/design-runtime";
import { byCanvasOrder } from "../canvas/frame-order";
import { bytesToBase64 } from "../mockup/binary";
import { CANVAS_TAB_ID } from "../tab-ids";
import { captureMaterial } from "./capture-material";
import { type MaterialBundle, type MaterialFrame, type MaterialKind, renderMaterials } from "./export-materials";

export const EXPORT_TOOL_NAME = "vetd_export";

interface ExportInput {
	format?: MaterialKind;
	frames?: string[];
}

interface ExportToolOptions {
	scopeUse: readonly ("project" | "conversation")[];
}

/**
 * 同名已存在时加 `-2`、`-3`……，绝不覆盖：当前目录是用户自己的地方，上一次导出的
 * 文件可能已经被改过、发出去过。
 */
export async function uniquePath(fs: Pick<PluginFsApi, "stat">, stem: string, extension: string): Promise<string> {
	for (let index = 1; ; index += 1) {
		const candidate = `${index === 1 ? stem : `${stem}-${index}`}${extension}`;
		if ((await fs.stat(candidate).catch(() => null)) === null) return candidate;
	}
}

/**
 * 按导出结果写盘：PDF 一个文件直接放在当前目录；图片放进当前目录下的一个子目录——
 * 十几张 png 直接散在项目根上，用户找都不好找。
 */
export async function writeMaterials(
	fs: Pick<PluginFsApi, "stat" | "writeFile">,
	cwd: string,
	designName: string,
	bundle: MaterialBundle,
): Promise<{ path: string; files: Array<{ frame: string; path: string }> }> {
	const root = cwd.replace(/[\\/]+$/, "");
	if (bundle.kind === "pdf") {
		const path = await uniquePath(fs, `${root}/${designName}-frames`, ".pdf");
		await fs.writeFile(path, bytesToBase64(bundle.bytes), "base64");
		return { path, files: bundle.frameIds.map((frame) => ({ frame, path })) };
	}
	const directory = await uniquePath(fs, `${root}/${designName}-frames`, "");
	const files: Array<{ frame: string; path: string }> = [];
	for (const file of bundle.files) {
		const path = `${directory}/${file.fileName}`;
		await fs.writeFile(path, bytesToBase64(file.bytes), "base64");
		files.push({ frame: file.frameId, path });
	}
	return { path: directory, files };
}

export function registerExportTool(ctx: PluginContext, options: ExportToolOptions): void {
	ctx.agent.registerTool<ExportInput>({
		id: "vetd-export",
		name: EXPORT_TOOL_NAME,
		label: "%tool.vetd_export%",
		description:
			"Export the open design as deliverable files into the current working directory: `format: \"pdf\"` writes one PDF with one page per frame; `format: \"images\"` writes one full-size PNG per frame into a `<design>-frames/` folder. Every file holds the frame's FULL content, including what scrolls below the frame's viewport. Omit `frames` to export every frame in canvas order. Existing files are never overwritten.\nExport ONE format per request, the one the user named: \"export PDF\" is `pdf` only, \"export images\" is `images` only. Never produce both in the same request — each format re-renders every frame, so doubling it doubles a slow export. If the user did not say which format, ask instead of exporting both.\nDo NOT use for design verification or to look at your own work — that is vetd_screenshot; this tool performs no checks and its output is not meant to be Read back.\nOnly for when the user asks to export, download or hand off the design as PDF or images.",
		parameters: {
			type: "object",
			properties: {
				format: {
					type: "string",
					enum: ["pdf", "images"],
					description: "`pdf`: one PDF, one page per frame. `images`: one PNG per frame.",
				},
				frames: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "Frame ids to export, in this order. Omit to export every frame (canvas order).",
				},
			},
			required: ["format"],
			additionalProperties: false,
		},
		scope_use: options.scopeUse,
		// 每帧至少两次真实渲染（量高度 + 按内容高度截），引擎冷启动时单次就可能吃满
		// 60s 的离屏预算并重试一次；几十帧的设计要给足。
		timeoutMs: 900_000,
		handler: async ({ host, session, trigger }) => {
			const { format, frames: requested } = trigger.input;
			if (format !== "pdf" && format !== "images") {
				return { ok: false, error: 'Pass `format`: "pdf" or "images".' };
			}
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
			const { manifest, name } = controller.session;
			const byId = new Map(manifest.frames.map((frame) => [frame.id, frame]));
			let selected = [...manifest.frames].sort(byCanvasOrder);
			if (requested && requested.length > 0) {
				const unknown = requested.filter((id) => !byId.has(id));
				if (unknown.length > 0) {
					return {
						ok: false,
						error: `Unknown frame(s): ${unknown.join(", ")}. Available frames: ${manifest.frames.map((frame) => frame.id).join(", ") || "(none)"}`,
					};
				}
				selected = [...new Set(requested)].flatMap((id) => {
					const frame = byId.get(id);
					return frame ? [frame] : [];
				});
			}
			if (selected.length === 0) {
				return { ok: false, error: "This design has no frames to export yet." };
			}

			let current: string | null = null;
			let bundle: MaterialBundle | null;
			try {
				bundle = await renderMaterials({
					designName: name,
					frames: selected.map((frame): MaterialFrame => ({ id: frame.id, title: frame.title || frame.id })),
					kind: format,
					capture: (frame, imageFormat) => {
						current = frame.id;
						const entry = byId.get(frame.id);
						if (!entry) throw new Error(`frame not on canvas: ${frame.id}`);
						return captureMaterial(
							{ port: controller.port, frame: entry, captureInCanvas: (frameId) => controller.captureFrame(frameId) },
							imageFormat,
						);
					},
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					retryable: true,
					error: current ? `Export failed at frame "${current}": ${reason}` : `Export failed: ${reason}`,
				};
			}
			if (!bundle) return { ok: false, error: "This design has no frames to export yet." };

			const written = await writeMaterials(host.fs, session.cwd, name, bundle);
			return {
				ok: true,
				format,
				path: written.path,
				...(format === "images" ? { files: written.files } : { pages: written.files.length }),
				frames: selected.map((frame) => frame.id),
				note: "Exported. Tell the user where the file(s) are. This is a hand-off, not a check: do not Read the exported files to inspect the design — use vetd_screenshot when you need to verify frames.",
			};
		},
	});
}
