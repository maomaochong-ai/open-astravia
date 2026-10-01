/**
 * 分享包快照里的资源内嵌（见 src/preview/snapshot-assets.ts）。
 * 快照经 srcdoc 加载没有 origin，构建产物路径解析不到，只读预览里图片全是裂的；
 * 这里守的是「构建后的文件名能对回包内原图」以及「对不上时不破坏文档」。
 */
import { expect, it } from "vitest";
import { findAssetReferences, inlineSnapshotAssets, resolveDesignAsset } from "../src/preview/snapshot-assets";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function files(entries: Record<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
	return new Map(Object.entries(entries));
}

it("finds asset references with and without a leading slash", () => {
	const html = `<script>const a="/assets/home-banner-wide-B2dEZnNe.png",b="assets/logo-AbCdEfGh.svg"</script>`;
	expect(findAssetReferences(html)).toEqual(["/assets/home-banner-wide-B2dEZnNe.png", "assets/logo-AbCdEfGh.svg"]);
});

it("ignores paths whose extension is not a known asset type", () => {
	expect(findAssetReferences('x="/assets/index-B4K6J73q.js"')).toEqual([]);
});

it("maps a built name back to the original file, hyphens in the name included", () => {
	const designFiles = files({ "assets/home-banner-wide.png": PNG, "assets/other.png": new Uint8Array([9]) });
	expect(resolveDesignAsset("/assets/home-banner-wide-B2dEZnNe.png", designFiles)).toBe(PNG);
});

it("falls back to a prefix match when the hash suffix does not match the template", () => {
	const designFiles = files({ "assets/maya-avatar.png": PNG });
	expect(resolveDesignAsset("/assets/maya-avatar.12345.png", designFiles)).toBe(PNG);
});

it("does not cross extensions when matching", () => {
	const designFiles = files({ "assets/logo.svg": PNG });
	expect(resolveDesignAsset("/assets/logo-AbCdEfGh.png", designFiles)).toBeNull();
});

it("inlines what it can resolve and leaves the rest untouched", async () => {
	const html = 'a="/assets/known-AbCdEfGh.png";b="/assets/missing-AbCdEfGh.png"';
	const out = await inlineSnapshotAssets(html, files({ "assets/known.png": PNG }));
	expect(out).toContain("data:image/");
	expect(out).not.toContain("/assets/known-AbCdEfGh.png");
	// 包里没有的那张保持原样：图裂，但文档结构不受影响。
	expect(out).toContain('b="/assets/missing-AbCdEfGh.png"');
});

it("keeps the document unchanged when nothing resolves", async () => {
	const html = 'a="/assets/missing-AbCdEfGh.png"';
	expect(await inlineSnapshotAssets(html, files({}))).toBe(html);
});

it("inlines non-raster assets verbatim", async () => {
	const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
	const out = await inlineSnapshotAssets('u="/assets/logo-AbCdEfGh.svg"', files({ "assets/logo.svg": svg }));
	expect(out).toContain("data:image/svg+xml;base64,");
});
