/**
 * 导出分享包的落点。
 *
 * 分享包是给人拿走的产物，不是设计源码：它必须走宿主的系统另存为对话框，绝不能
 * 被写回项目目录（会污染文件树，并被下一次构建/导入当成内容）。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, expect, it, vi } from "vitest";

const buildDesign = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/engine/engine-manager", () => ({ buildDesign }));

const { exportDesign } = await import("../src/export/export-design");
const { SHARE_EXTENSION } = await import("../src/export/share-format");

interface SaveAsCall {
	fileName: string;
	content: string;
	encoding?: string;
}

function fakeSession() {
	return {
		dirPath: "/proj/checkout.vetd",
		vetdPath: "/proj/checkout.vetd",
		name: "checkout",
		manifest: { version: 2, frames: [] },
	} as never;
}

function fakeCtx(saveAs: (call: SaveAsCall) => string | null) {
	const writes: string[] = [];
	const calls: SaveAsCall[] = [];
	const ctx = {
		fs: {
			readFile: async (path: string) => {
				if (path.endsWith("/index.html")) return { content: "<html></html>" };
				return { content: "x" };
			},
			readBinaryFile: async () => ({ data: "", mimeType: "application/octet-stream", size: 0 }),
			listFilesRecursive: async () => [{ name: "app.tsx", path: "/proj/checkout.vetd/app.tsx", relPath: "app.tsx" }],
			writeFile: async (path: string) => {
				writes.push(path);
			},
			delete: async () => {},
			saveAs: async (fileName: string, content: string, encoding?: string) => {
				const call = { fileName, content, encoding };
				calls.push(call);
				return saveAs(call);
			},
		},
	} as unknown as PluginContext;
	return { ctx, writes, calls };
}

beforeEach(() => {
	buildDesign.mockClear();
});

it("把分享包交给系统另存为对话框，不写进项目目录", async () => {
	const { ctx, writes, calls } = fakeCtx(() => "/Users/me/Desktop/checkout-share.vetdz");

	const path = await exportDesign(ctx, fakeSession());

	expect(path).toBe("/Users/me/Desktop/checkout-share.vetdz");
	expect(calls).toHaveLength(1);
	expect(calls[0].fileName).toBe(`checkout-share.${SHARE_EXTENSION}`);
	expect(calls[0].encoding).toBe("base64");
	expect(calls[0].content.length).toBeGreaterThan(0);
	expect(writes).toEqual([]);
});

it("用户取消时返回 null，磁盘上什么都不留", async () => {
	const { ctx, writes } = fakeCtx(() => null);

	expect(await exportDesign(ctx, fakeSession())).toBeNull();
	expect(writes).toEqual([]);
});
