/** Frame meta declared in the tsx (`export const frame = {...}`). */
export interface FrameMeta {
	width: number;
	height: number;
	title: string;
}

/**
 * One canvas frame in the manifest. `meta` is the last frame-meta snapshot the
 * plugin synced from the tsx: current width/height follow the manifest (user
 * drags win) until the tsx meta CHANGES again (last writer wins, ADR-0053).
 */
export interface VetdFrameEntry {
	id: string;
	/** Path relative to the sidecar dir, e.g. `frames/login.tsx`. */
	file: string;
	x: number;
	y: number;
	width: number;
	height: number;
	title: string;
	meta: FrameMeta;
}

export interface VetdCanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

/** Working-form `x.vetd` manifest (plugin is the single writer). */
export interface VetdManifest {
	version: 1;
	type: "vetta-design";
	canvas: VetdCanvasViewport;
	frames: VetdFrameEntry[];
}

export function emptyManifest(): VetdManifest {
	return {
		version: 1,
		type: "vetta-design",
		canvas: { x: 0, y: 0, zoom: 1 },
		frames: [],
	};
}

/** `x.vetd` → sidecar dir `x.vetd.d` (naming-convention binding). */
export function sidecarDirOf(vetdPath: string): string {
	return `${vetdPath}.d`;
}

export function designNameOf(vetdPath: string): string {
	const base = vetdPath.split("/").pop() ?? vetdPath;
	return base.replace(/\.vetd$/, "");
}
