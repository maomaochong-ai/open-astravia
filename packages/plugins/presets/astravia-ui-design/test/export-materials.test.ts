/**
 * 下载素材的落盘合同：一张图存 png、多张打 zip（序号 + 标题、画布顺序）、PDF 一帧
 * 一页且页面尺寸就是各自的 CSS 尺寸。另存为对话框是外部边界，用假函数收集调用。
 */
import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import type { FullFrameImage, MaterialFormat } from "../src/materials/capture-full-frame";
import { exportMaterials, type MaterialFrame, materialFileName } from "../src/materials/export-materials";

interface SaveCall {
	fileName: string;
	bytes: Uint8Array;
	filters: string[];
}

function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** 假截图：把 frame id 与格式编进「图片字节」，落盘后能认出是谁。 */
const captured: Array<{ id: string; format: MaterialFormat }> = [];
async function capture(frame: MaterialFrame, format: MaterialFormat): Promise<FullFrameImage> {
	captured.push({ id: frame.id, format });
	const sizes: Record<string, [number, number]> = { login: [390, 1600], landing: [1440, 5200] };
	const [width, height] = sizes[frame.id] ?? [100, 100];
	return {
		dataUrl: `data:image/${format};base64,${btoa(`${format}:${frame.id}`)}`,
		cssWidth: width,
		cssHeight: height,
		pixelWidth: width * 2,
		pixelHeight: height * 2,
	};
}

function harness(result: string | null = "/out/file") {
	const saves: SaveCall[] = [];
	const progress: Array<[number, number]> = [];
	captured.length = 0;
	return {
		saves,
		progress,
		run: (frames: MaterialFrame[], kind: "images" | "pdf") =>
			exportMaterials({
				designName: "checkout",
				frames,
				kind,
				capture,
				saveTitle: "save",
				onProgress: (done, total) => progress.push([done, total]),
				saveAs: async (fileName, base64, options) => {
					saves.push({ fileName, bytes: bytesFromBase64(base64), filters: options.filters.flatMap((f) => f.extensions) });
					return result;
				},
			}),
	};
}

const login: MaterialFrame = { id: "login", title: "Login / Sign in" };
const landing: MaterialFrame = { id: "landing", title: "Landing" };

it("saves a single frame straight to a png named after the frame", async () => {
	const h = harness();
	await expect(h.run([login], "images")).resolves.toBe("/out/file");
	expect(h.saves).toHaveLength(1);
	expect(h.saves[0]?.fileName).toBe("01-Login - Sign in.png");
	expect(h.saves[0]?.filters).toEqual(["png"]);
	expect(strFromU8(h.saves[0]?.bytes ?? new Uint8Array())).toBe("png:login");
	expect(captured).toEqual([{ id: "login", format: "png" }]);
	expect(h.progress).toEqual([[1, 1]]);
});

it("zips several frames in canvas order with numbered file names", async () => {
	const h = harness();
	await h.run([landing, login], "images");
	expect(h.saves[0]?.fileName).toBe("checkout-frames.zip");
	expect(h.saves[0]?.filters).toEqual(["zip"]);
	const entries = unzipSync(h.saves[0]?.bytes ?? new Uint8Array());
	expect(Object.keys(entries)).toEqual(["01-Landing.png", "02-Login - Sign in.png"]);
	expect(strFromU8(entries["02-Login - Sign in.png"] ?? new Uint8Array())).toBe("png:login");
	expect(h.progress).toEqual([
		[1, 2],
		[2, 2],
	]);
});

it("builds one pdf page per frame at each frame's own css size", async () => {
	const h = harness();
	await h.run([login, landing], "pdf");
	expect(captured.map((entry) => entry.format)).toEqual(["jpeg", "jpeg"]);
	expect(h.saves[0]?.fileName).toBe("checkout-frames.pdf");
	const pdf = strFromU8(h.saves[0]?.bytes ?? new Uint8Array());
	expect(pdf.startsWith("%PDF-1.4")).toBe(true);
	expect(pdf).toContain("/Count 2");
	// 页面尺寸 = CSS 尺寸（1px = 1pt）：手机帧与桌面帧保持真实比例，不被归一到同一宽度。
	expect(pdf).toContain("/MediaBox [0 0 390.00 1600.00]");
	expect(pdf).toContain("/MediaBox [0 0 1440.00 5200.00]");
	// 图像按物理像素登记，jpeg 字节原样内嵌。
	expect(pdf).toContain("/Width 780 /Height 3200");
	expect(pdf).toContain("jpeg:login");
});

it("returns null without notifying when the user cancels the save dialog", async () => {
	const h = harness(null);
	await expect(h.run([login, landing], "images")).resolves.toBeNull();
	expect(h.saves).toHaveLength(1);
});

it("does nothing for an empty scope", async () => {
	const h = harness();
	await expect(h.run([], "pdf")).resolves.toBeNull();
	expect(h.saves).toHaveLength(0);
});

it.each([
	[{ id: "home", title: "首页 · Home" }, "01-首页 · Home.png"],
	[{ id: "a", title: 'bad\\/:*?"<>|name' }, "01-bad-name.png"],
	[{ id: "detail", title: "   " }, "01-detail.png"],
	[{ id: "x", title: "..trailing.." }, "01-trailing.png"],
])("sanitises %j into %s", (frame, expected) => {
	expect(materialFileName(0, frame, "png")).toBe(expected);
});
