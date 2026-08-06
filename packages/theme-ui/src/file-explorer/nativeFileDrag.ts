interface NativeFileDragEvent {
	preventDefault(): void;
}

export function beginNativeFileDrag(
	event: NativeFileDragEvent,
	paths: readonly string[],
	onNativeDragStart: (paths: readonly string[]) => void,
): void {
	if (paths.length === 0) return;
	// Electron requires the HTML drag to be cancelled before startDrag enters the native drag loop.
	event.preventDefault();
	onNativeDragStart(paths);
}
