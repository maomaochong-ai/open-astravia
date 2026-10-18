import { describe, expect, it } from "vitest";
import { ASTRAVIA_LOGO_DATA_URL } from "../src/mockup/brand-logo.js";

function pngSize(dataUrl: string): { width: number; height: number } {
	const prefix = "data:image/png;base64,";
	expect(dataUrl.startsWith(prefix)).toBe(true);
	const bytes = Buffer.from(dataUrl.slice(prefix.length), "base64");
	// PNG: 8 字节签名 + 4 字节长度 + "IHDR" + 宽(4) + 高(4)。
	expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
	expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("ASTRAVIA_LOGO_DATA_URL", () => {
	it("is a real PNG at the size the export header draws it", () => {
		// 这张图是从 apps/desktop/build/icon.png 缩到 96px 内联的，
		// 生成命令写在 src/mockup/brand-logo.ts 头部。
		expect(pngSize(ASTRAVIA_LOGO_DATA_URL)).toEqual({ width: 96, height: 96 });
	});

	it("stays small enough to keep inline in the plugin bundle", () => {
		expect(ASTRAVIA_LOGO_DATA_URL.length).toBeLessThan(20_000);
	});
});
