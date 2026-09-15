/**
 * vetd_export 的对外合同：用户说导出 PDF 就只出 PDF、说导出图片就只出图片，文件落在
 * 当前目录且绝不覆盖；它不是检查工具，描述里要把检查指回 vetd_screenshot。
 *
 * 真实外部边界只有两处：离屏截图（captureMaterial）与宿主文件系统，都用假的代替。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMaterial = vi.hoisted(() => vi.fn());
vi.mock("../src/materials/capture-material", () => ({ captureMaterial }));

import { setCanvasController } from "../src/canvas/design-runtime";
import { EXPORT_TOOL_NAME, registerExportTool } from "../src/materials/export-tool";
import { DESIGN_ONLY_TOOLS } from "../src/vetd/tool-gate";

interface Registration {
	name: string;
	description: string;
	parameters: { required?: string[]; properties: Record<string, unknown> };
	handler(context: {
		host: { fs: unknown };
		session: { cwd: string };
		trigger: { input: Record<string, unknown> };
	}): Promise<Record<string, unknown>>;
}

let tool: Registration;
const openActivityTab = vi.fn();
const ctx = {
	agent: {
		registerTool: (registration: Registration) => {
			tool = registration;
			return { dispose: () => {} };
		},
	},
	ui: { openActivityTab },
} as unknown as PluginContext;

/** 内存文件系统：记录写入，`existing` 里的路径视为已存在。 */
function memoryFs(existing: string[] = []) {
	const written = new Map<string, Uint8Array>();
	const taken = new Set(existing);
	return {
		written,
		fs: {
			stat: async (path: string) => (taken.has(path) || written.has(path) ? { size: 1, modifiedAt: 0, createdAt: 0 } : null),
			writeFile: async (path: string, content: string, encoding?: string) => {
				expect(encoding).toBe("base64");
				const binary = atob(content);
				written.set(path, Uint8Array.from(binary, (char) => char.charCodeAt(0)));
			},
		},
	};
}

function openCanvas(): void {
	setCanvasController({
		port: 4321,
		captureFrame: async () => "",
		resolveNoteElements: async () => [],
		openDesign: () => {},
		notes: {} as never,
		session: {
			name: "checkout",
			vetdPath: "/work/checkout.vetd",
			dirPath: "/work/checkout.vetd",
			manifest: {
				version: 2,
				frames: [
					// 画布顺序：cart 在 login 左边，所以默认导出顺序是 cart → login。
					{ id: "login", file: "frames/login.tsx", x: 500, y: 0, width: 390, height: 844, title: "Login" },
					{ id: "cart", file: "frames/cart.tsx", x: 0, y: 0, width: 390, height: 844, title: "Cart / 购物车" },
				],
			},
		} as never,
	});
}

function call(input: Record<string, unknown>, fs: unknown = memoryFs().fs) {
	return tool.handler({ host: { fs }, session: { cwd: "/work/" }, trigger: { input } });
}

beforeEach(() => {
	setCanvasController(null);
	openActivityTab.mockReset();
	captureMaterial.mockReset().mockImplementation(async (target: { frame: { id: string } }, format: string) => ({
		dataUrl: `data:image/${format};base64,${btoa(`${format}:${target.frame.id}`)}`,
		cssWidth: 390,
		cssHeight: 1600,
		pixelWidth: 780,
		pixelHeight: 3200,
	}));
	registerExportTool(ctx, { scopeUse: ["project", "conversation"] });
});

describe("用户要求导出时", () => {
	it("导出 PDF 只渲染 PDF：一份文件落在当前目录，一帧一页、按画布顺序", async () => {
		openCanvas();
		const { fs, written } = memoryFs();
		const result = await call({ format: "pdf" }, fs);

		expect(result).toMatchObject({ ok: true, format: "pdf", path: "/work/checkout-frames.pdf", pages: 2, frames: ["cart", "login"] });
		expect([...written.keys()]).toEqual(["/work/checkout-frames.pdf"]);
		// 只截了 PDF 需要的 jpeg，每帧一次——没有顺手再出一份图片。
		expect(captureMaterial.mock.calls.map(([target, format]) => [target.frame.id, format])).toEqual([
			["cart", "jpeg"],
			["login", "jpeg"],
		]);
		const pdf = strFromU8(written.get("/work/checkout-frames.pdf") ?? new Uint8Array());
		expect(pdf).toContain("/Count 2");
		expect(pdf).toContain("/MediaBox [0 0 390.00 1600.00]");
	});

	it("导出图片只渲染图片：每帧一张 png 放进当前目录下的子目录", async () => {
		openCanvas();
		const { fs, written } = memoryFs();
		const result = await call({ format: "images" }, fs);

		expect(result).toMatchObject({
			ok: true,
			format: "images",
			path: "/work/checkout-frames",
			files: [
				{ frame: "cart", path: "/work/checkout-frames/01-Cart - 购物车.png" },
				{ frame: "login", path: "/work/checkout-frames/02-Login.png" },
			],
		});
		expect(captureMaterial.mock.calls.map(([, format]) => format)).toEqual(["png", "png"]);
		expect([...written.keys()].some((path) => path.endsWith(".pdf"))).toBe(false);
		expect(strFromU8(written.get("/work/checkout-frames/02-Login.png") ?? new Uint8Array())).toBe("png:login");
		// 不打 zip：落在工作区里的是能直接打开的图片。
		expect(() => unzipSync(written.get("/work/checkout-frames/02-Login.png") ?? new Uint8Array())).toThrow();
	});

	it("只导出用户点名的画框，并保持点名的顺序", async () => {
		openCanvas();
		const result = await call({ format: "pdf", frames: ["login", "cart", "login"] });
		expect(result).toMatchObject({ ok: true, frames: ["login", "cart"] });
	});

	it("同名文件已存在时另起名字，不覆盖用户目录里的东西", async () => {
		openCanvas();
		const { fs, written } = memoryFs(["/work/checkout-frames.pdf", "/work/checkout-frames-2.pdf", "/work/checkout-frames"]);
		await expect(call({ format: "pdf" }, fs)).resolves.toMatchObject({ path: "/work/checkout-frames-3.pdf" });
		await expect(call({ format: "images" }, fs)).resolves.toMatchObject({ path: "/work/checkout-frames-2" });
		expect(written.has("/work/checkout-frames.pdf")).toBe(false);
	});
});

describe("出错时", () => {
	it("没给格式就拒绝，而不是两种都导", async () => {
		openCanvas();
		const result = await call({});
		expect(result).toMatchObject({ ok: false });
		expect(captureMaterial).not.toHaveBeenCalled();
	});

	it("未知画框列出可用的 id，不截任何图", async () => {
		openCanvas();
		const result = await call({ format: "images", frames: ["nope"] });
		expect(result.ok).toBe(false);
		expect(String(result.error)).toContain("Available frames: login, cart");
		expect(captureMaterial).not.toHaveBeenCalled();
	});

	it("某一帧截图失败时点名那一帧，且不写出半份产物", async () => {
		openCanvas();
		captureMaterial.mockImplementation(async (target: { frame: { id: string } }) => {
			if (target.frame.id === "login") throw new Error("Capture timed out before readyExpression");
			return { dataUrl: "data:image/png;base64,AA==", cssWidth: 1, cssHeight: 1, pixelWidth: 1, pixelHeight: 1 };
		});
		const { fs, written } = memoryFs();
		const result = await call({ format: "images" }, fs);
		expect(result).toMatchObject({ ok: false, retryable: true });
		expect(String(result.error)).toContain('frame "login"');
		expect(written.size).toBe(0);
	});

	it("画布没开时请求打开并让 agent 稍后重试", async () => {
		const result = await call({ format: "pdf" });
		expect(result).toMatchObject({ ok: false, retryable: true });
		expect(openActivityTab).toHaveBeenCalled();
	});
});

describe("工具合同", () => {
	it("格式必填且二选一；描述写明只导一种、检查走 vetd_screenshot", () => {
		expect(tool.name).toBe(EXPORT_TOOL_NAME);
		expect(tool.parameters.required).toEqual(["format"]);
		expect(tool.parameters.properties.format).toMatchObject({ enum: ["pdf", "images"] });
		expect(tool.description).toMatch(/ONE format per request/);
		expect(tool.description).toMatch(/Never produce both/);
		expect(tool.description).toMatch(/Do NOT use for design verification[^\n]*vetd_screenshot/);
		expect(tool.description).toMatch(/\bOnly for\b/);
	});

	it("只在设计语境里出现（与其余设计工具同一道闸）", () => {
		expect(DESIGN_ONLY_TOOLS).toContain(EXPORT_TOOL_NAME);
	});
});
