interface NativeFileDragEvent {
	preventDefault(): void;
}

export function beginNativeFileDrag(
	event: NativeFileDragEvent,
	path: string,
	onNativeDragStart: (paths: readonly string[]) => void,
): void {
	// Electron requires the HTML drag to be cancelled before startDrag enters the native drag loop.
	event.preventDefault();
	onNativeDragStart([path]);
}
