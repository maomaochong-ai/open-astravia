/** Decode a data URL into an <img> the 2D context can draw. */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode captured image"));
		image.src = dataUrl;
	});
}
