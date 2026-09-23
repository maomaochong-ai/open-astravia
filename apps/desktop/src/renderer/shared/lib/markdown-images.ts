const MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	ico: "image/x-icon",
	svg: "image/svg+xml",
};
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;[^,]*)?,/i;

export async function resolveMarkdownImage(
	source: string,
	base: string | null,
	read: (path: string) => Promise<{ content: string; encoding: "utf8" | "base64" }>,
): Promise<string> {
	if (/^https?:\/\//i.test(source)) return source;
	if (source.startsWith("//")) return `https:${source}`;
	if (DATA_IMAGE.test(source) && source.length <= 12_000_000) return source;
	if (base && /^https?:\/\//i.test(base)) {
		const url = new URL(source, base.endsWith("/") ? base : `${base}/`);
		if (/^https?:$/.test(url.protocol)) return url.href;
	}
	if (!base || (/^\w+:/i.test(source) && !/^[a-z]:[\\/]/i.test(source))) throw new Error("Unsupported image URL");
	const path = decodeURIComponent(source);
	const mime = MIME[path.split(".").pop()?.toLowerCase() ?? ""];
	if (!mime) throw new Error("Unsupported image format");
	const result = await read(path);
	if (result.content.length > 12_000_000) throw new Error("Image too large");
	return result.encoding === "base64"
		? `data:${mime};base64,${result.content}`
		: `data:${mime};charset=utf-8,${encodeURIComponent(result.content)}`;
}

export function imageDataForAction(source: string): Promise<string> {
	if (DATA_IMAGE.test(source) && source.length <= 12_000_000) return Promise.resolve(source);
	return window.vetta.markdown.imageData(source);
}
export function imageFileName(data: string): string {
	if (/^https?:\/\//i.test(data)) {
		const extension = new URL(data).pathname.split(".").pop()?.toLowerCase();
		return `image.${extension && MIME[extension] ? extension : "png"}`;
	}
	const mime = data.slice(5).split(/[;,]/, 1)[0];
	const ext = Object.entries(MIME).find(([, type]) => type === mime)?.[0] ?? "png";
	return `image.${ext}`;
}
export async function imageAsPng(source: string): Promise<string> {
	const image = new Image();
	image.src = source;
	await image.decode();
	if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error("Image dimensions too large");
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Image conversion unavailable");
	context.drawImage(image, 0, 0);
	return canvas.toDataURL("image/png");
}
