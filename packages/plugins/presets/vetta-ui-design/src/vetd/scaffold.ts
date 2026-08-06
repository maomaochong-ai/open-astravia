import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { emptyManifest, type FrameSize, sidecarDirOf, type VetdManifest } from "./manifest-types";

// 注意：这段是写进用户项目里的产物文件，不是插件 UI 文案，所以不走 locales；
// 但也不能是中文——英文宿主的用户同样会拿到这个文件。
export const DEFAULT_THEME_CSS = `/* Shared color system for this design document: Tailwind v4 @theme tokens,
 * used by every frame. Reference them as utilities (bg-primary,
 * text-surface-foreground, …); edit here to reskin the whole document. */
@theme {
	--color-primary: #4f46e5;
	--color-primary-foreground: #ffffff;
	--color-surface: #f8fafc;
	--color-surface-foreground: #0f172a;
	--color-muted: #64748b;
	--color-accent: #f59e0b;
	--color-danger: #ef4444;
}
`;

export interface ScaffoldResult {
	vetdPath: string;
	dirPath: string;
}

/**
 * Create a working-form design skeleton (manifest + sidecar dir). The plugin —
 * not the agent — always writes this scaffold (single-writer rule); the agent
 * goes through the vetd_create tool which lands here.
 *
 * 刻意不铺任何示例 frame：产物可能是界面、幻灯片、海报，预置一个手机画框等于
 * 替用户押了尺寸和品类。零 frame 的画布自己会给出引导（DesignCanvas 空态）。
 *
 * `defaultFrameSize` 是品类本身，和示例 frame 不是一回事：它不往画布上放任何东西，
 * 只在某个画框漏声明尺寸时兜底（frame-size.ts）。画布上手动新建设计时问不到品类，
 * 传 null 即可。
 */
export async function scaffoldDesign(
	fs: PluginFsApi,
	cwd: string,
	rawName: string,
	defaultFrameSize?: FrameSize | null,
): Promise<ScaffoldResult> {
	const name = sanitizeDesignName(rawName);
	let vetdPath = `${cwd}/${name}.vetd`;
	let suffix = 1;
	while ((await fs.stat(vetdPath)) !== null) {
		vetdPath = `${cwd}/${name}-${suffix}.vetd`;
		suffix += 1;
	}
	const dirPath = sidecarDirOf(vetdPath);
	await fs.createDirectory(`${dirPath}/frames`);
	await fs.createDirectory(`${dirPath}/components`);
	await fs.createDirectory(`${dirPath}/assets`);
	await fs.writeFile(`${dirPath}/theme.css`, DEFAULT_THEME_CSS);
	const manifest: VetdManifest = {
		...emptyManifest(),
		...(defaultFrameSize ? { defaultFrameSize } : {}),
	};
	await fs.writeFile(vetdPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return { vetdPath, dirPath };
}

export function sanitizeDesignName(raw: string): string {
	const cleaned = raw
		.trim()
		.replace(/\.vetd$/i, "")
		.replace(/[\\/:*?"<>|\s]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned || "design";
}

/** Frame source template used by the canvas "Frame" tool (drag-to-create). */
export function blankFrameSource(title: string, width: number, height: number): string {
	return `export const frame = { width: ${width}, height: ${height}, title: "${title}" };

export default function Frame() {
	return <div className="h-full bg-surface" />;
}
`;
}
