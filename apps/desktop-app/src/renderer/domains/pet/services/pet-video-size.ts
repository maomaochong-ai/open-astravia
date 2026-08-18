export function getVideoDisplaySize(
	naturalSize: { width: number; height: number } | undefined,
	size: number,
): { width: number; height: number } {
	if (!naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
		return { width: size, height: size };
	}
	const scale = size / Math.max(naturalSize.width, naturalSize.height);
	return {
		width: Math.round(naturalSize.width * scale),
		height: Math.round(naturalSize.height * scale),
	};
}
