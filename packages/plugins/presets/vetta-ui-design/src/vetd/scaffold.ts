import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { emptyManifest, sidecarDirOf, type VetdManifest } from "./manifest-types";

export const DEFAULT_THEME_CSS = `/* 设计文档的统一色彩系统：Tailwind v4 @theme 令牌，所有 frame 共享。
 * 用 bg-primary / text-surface-foreground 等工具类引用；改这里即全局换肤。 */
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

export function sampleFrameSource(title: string): string {
	return `export const frame = { width: 390, height: 844, title: "${title}" };

export default function Frame() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 bg-surface text-surface-foreground">
			<span className="icon-[lucide--palette] size-10 text-primary" />
			<h1 className="text-xl font-semibold">${title}</h1>
			<p className="max-w-60 text-center text-sm text-muted">
				让 Vetta 修改这个 frame，或在画布上选中任意元素定向调整。
			</p>
			<button
				type="button"
				className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
			>
				开始设计
			</button>
		</div>
	);
}
`;
}

export interface ScaffoldResult {
	vetdPath: string;
	dirPath: string;
	firstFrameFile: string;
}

/**
 * Create a working-form design skeleton (manifest + sidecar dir). The plugin —
 * not the agent — always writes this scaffold (single-writer rule); the agent
 * goes through the vetd_create tool which lands here.
 */
export async function scaffoldDesign(fs: PluginFsApi, cwd: string, rawName: string): Promise<ScaffoldResult> {
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
	const firstFrameFile = "frames/home.tsx";
	await fs.writeFile(`${dirPath}/${firstFrameFile}`, sampleFrameSource("Home"));
	const manifest: VetdManifest = emptyManifest();
	await fs.writeFile(vetdPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return { vetdPath, dirPath, firstFrameFile };
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
