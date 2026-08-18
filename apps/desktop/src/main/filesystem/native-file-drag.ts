export interface NativeDragFilePayload {
	file: string;
	files?: string[];
}

export function createNativeDragFilePayload(paths: readonly string[]): NativeDragFilePayload {
	const file = paths[0];
	if (!file) throw new Error("Native drag requires at least one file");
	if (paths.length === 1) return { file };
	return { file, files: [...paths] };
}
