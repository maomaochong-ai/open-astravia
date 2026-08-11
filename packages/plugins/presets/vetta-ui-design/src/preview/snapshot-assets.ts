/**
 * 把分享包快照里的资源引用换成内嵌数据。
 *
 * 快照是单个 HTML，经 srcdoc 加载，没有 origin —— 构建产物里那些
 * `/assets/home-banner-wide-B2dEZnNe.png` 引用因此谁也解析不到，只读预览里所有图片
 * 都是裂的。原图就在包里（`design/assets/`），缺的只是「构建后的文件名 → 原文件」
 * 这一步映射：vite 的默认命名是 `[name]-[hash][ext]`，剥掉 hash 就是原名。
 *
 * 为什么在读取端做而不是导出时内联：设计稿的图片动辄几 MB（实测一份包 22MB），全量
 * base64 塞进快照会让每个 frame 的 iframe 各扛一份几十 MB 的文档字符串。这里改成
 * 「按预览需要的分辨率重编码后再内嵌」，同一份图从 MB 级降到几十 KB；顺带存量分享包
 * 不必重新导出也能显示图片。
 */

/** 重编码后的最长边（设备像素）。手机画框宽 ~430，2 倍图之外再大也看不出来。 */
const MAX_EDGE = 1024;
/** 重编码质量。位图缩放后的细节损失远大于这一档压缩带来的损失。 */
const ENCODE_QUALITY = 0.82;

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	mp4: "video/mp4",
	webm: "video/webm",
};

/** 会被重编码的位图；其余（svg、字体、视频）原样内嵌。 */
const RASTER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif"]);

/**
 * 构建产物里的资源引用。前导 `/` 可有可无（base 配置不同），扩展名限定在已知集合，
 * 免得把 JS 里恰好长得像路径的字符串也换掉。
 */
const ASSET_REFERENCE = new RegExp(`/?assets/[\\w.-]+\\.(?:${Object.keys(MIME_BY_EXTENSION).join("|")})`, "g");

export function extensionOf(path: string): string {
	return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

/** 快照里引用到的全部资源路径（去重，保留原始写法）。 */
export function findAssetReferences(html: string): string[] {
	return [...new Set(html.match(ASSET_REFERENCE) ?? [])];
}

/**
 * 构建产物路径 → 包内原始文件。
 *
 * 命名模板不写死：从完整名字开始，逐段剥掉结尾的 `-token` / `.token` 再试，第一个
 * 对得上的就是它。`home-banner-wide-B2dEZnNe.png` 先试整名（不中），再试
 * `home-banner-wide.png`（中）——名字自带连字符也不会被剥过头，因为一旦命中就停。
 */
export function resolveDesignAsset(
	builtPath: string,
	designFiles: ReadonlyMap<string, Uint8Array>,
): Uint8Array | null {
	const builtName = builtPath.slice(builtPath.lastIndexOf("/") + 1);
	const extension = extensionOf(builtName);
	const byName = new Map<string, Uint8Array>();
	for (const [rel, bytes] of designFiles) {
		const name = rel.slice(rel.lastIndexOf("/") + 1);
		if (!byName.has(name)) byName.set(name, bytes);
	}
	let stem = builtName.slice(0, builtName.length - extension.length - 1);
	while (stem.length > 0) {
		const found = byName.get(`${stem}.${extension}`);
		if (found) return found;
		const cut = Math.max(stem.lastIndexOf("-"), stem.lastIndexOf("."));
		if (cut <= 0) break;
		stem = stem.slice(0, cut);
	}
	return null;
}

function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function dataUrl(mime: string, bytes: Uint8Array): string {
	return `data:${mime};base64,${base64FromBytes(bytes)}`;
}

/**
 * 位图按预览需要的分辨率重编码。透明通道要保住（头像、贴纸都是抠图 png），所以统一
 * 编 webp 而不是 jpeg。任何一步失败都退回原始字节——图小一点总比图裂了强。
 */
async function shrinkRaster(bytes: Uint8Array, mime: string): Promise<string> {
	try {
		const source = new Blob([bytes as BlobPart], { type: mime });
		const bitmap = await createImageBitmap(source);
		const longest = Math.max(bitmap.width, bitmap.height);
		const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no 2d context");
		context.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		const encoded = await canvas.convertToBlob({ type: "image/webp", quality: ENCODE_QUALITY });
		const encodedBytes = new Uint8Array(await encoded.arrayBuffer());
		// 重编码偶尔会比原图还大（本来就小、或者已经是 webp），那就别换。
		if (encodedBytes.byteLength >= bytes.byteLength) return dataUrl(mime, bytes);
		return dataUrl("image/webp", encodedBytes);
	} catch {
		return dataUrl(mime, bytes);
	}
}

/**
 * 把快照里能对上号的资源引用替换成内嵌数据。对不上的引用原样留着（图会裂，但文档
 * 结构不受影响），整体失败也只是回到「没有图」的现状，不该让预览打不开。
 */
export async function inlineSnapshotAssets(
	html: string,
	designFiles: ReadonlyMap<string, Uint8Array>,
): Promise<string> {
	const references = findAssetReferences(html);
	if (references.length === 0) return html;
	const inlined = new Map<string, string>();
	for (const reference of references) {
		const bytes = resolveDesignAsset(reference, designFiles);
		if (!bytes) continue;
		const extension = extensionOf(reference);
		const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
		inlined.set(reference, RASTER_EXTENSIONS.has(extension) ? await shrinkRaster(bytes, mime) : dataUrl(mime, bytes));
	}
	if (inlined.size === 0) return html;
	// replacer 函数：data: URI 里含 `+` `/` 等字符，字符串替换值还会解释 `$&` 之类。
	return html.replace(ASSET_REFERENCE, (match) => inlined.get(match) ?? match);
}
