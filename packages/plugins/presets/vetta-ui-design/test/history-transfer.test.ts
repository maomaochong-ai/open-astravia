/**
 * 历史进出分享包的那一层：中转文件一定要删干净，任何失败都不能连累导出本身。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runHistoryCommand = vi.fn();
vi.mock("../src/history/runner-host", () => ({
	runHistoryCommand: (...args: unknown[]) => runHistoryCommand(...args),
}));

const { packHistoryForShare, unpackHistoryFromShare } = await import("../src/history/history-transfer");

const readBinaryFile = vi.fn();
const writeFile = vi.fn();
const remove = vi.fn();
const ctx = {
	fs: { readBinaryFile, writeFile, delete: remove },
} as unknown as PluginContext;

const DESIGN = "/w/a.vetd";
const PACK = "/w/a.vetd/.history-pack.zip";

beforeEach(() => {
	runHistoryCommand.mockReset();
	readBinaryFile.mockReset().mockResolvedValue({ data: "AAAA", mimeType: "application/zip", size: 4 });
	writeFile.mockReset().mockResolvedValue(undefined);
	remove.mockReset().mockResolvedValue(undefined);
});

describe("packHistoryForShare", () => {
	it("正常打包后把中转文件删掉", async () => {
		runHistoryCommand.mockResolvedValue({ size: 1024 });
		expect(await packHistoryForShare(ctx, DESIGN)).toEqual({ kind: "ok", base64: "AAAA", bytes: 1024 });
		expect(remove).toHaveBeenCalledWith(PACK);
	});

	it("没有历史时安静返回 none", async () => {
		runHistoryCommand.mockResolvedValue({ size: 0 });
		expect(await packHistoryForShare(ctx, DESIGN)).toEqual({ kind: "none" });
		expect(readBinaryFile).not.toHaveBeenCalled();
	});

	it("超过宿主二进制读取上限时报 too-large 而不是读崩", async () => {
		runHistoryCommand.mockResolvedValue({ size: 40 * 1024 * 1024 });
		expect(await packHistoryForShare(ctx, DESIGN)).toMatchObject({ kind: "too-large" });
		expect(readBinaryFile).not.toHaveBeenCalled();
	});

	it("runner 挂了也不让导出失败，且照样清理中转文件", async () => {
		runHistoryCommand.mockRejectedValue(new Error("runner 挂了"));
		expect(await packHistoryForShare(ctx, DESIGN)).toEqual({ kind: "none" });
		expect(remove).toHaveBeenCalledWith(PACK);
	});
});

describe("unpackHistoryFromShare", () => {
	it("先写中转文件再交给 runner 还原，最后删掉", async () => {
		runHistoryCommand.mockResolvedValue({ files: 12 });
		expect(await unpackHistoryFromShare(ctx, DESIGN, "AAAA")).toBe(true);
		expect(writeFile).toHaveBeenCalledWith(PACK, "AAAA", "base64");
		expect(remove).toHaveBeenCalledWith(PACK);
	});

	it("还原失败不抛出——设计本身已经落地了", async () => {
		runHistoryCommand.mockRejectedValue(new Error("zip 坏了"));
		expect(await unpackHistoryFromShare(ctx, DESIGN, "AAAA")).toBe(false);
		expect(remove).toHaveBeenCalledWith(PACK);
	});
});
