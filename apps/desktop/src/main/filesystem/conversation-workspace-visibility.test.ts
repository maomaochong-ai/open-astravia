import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * DEFAULT_CONVERSATION_CWD 在模块加载时由 VETTA_HOME 派生，因此本文件不做静态导入：
 * 先把 VETTA_HOME 指到临时目录，再动态加载被测模块，让「对话」根落在可控位置。
 */
describe("「对话」根目录下会话工作区的列举可见性", () => {
	const uuidDirName = "0c558d85-6603-4e52-81a4-ba686d57a3e4";
	let vettaHome = "";
	let conversationRoot = "";
	let service: typeof import("./filesystem-service.js");
	let previousVettaHome: string | undefined;

	beforeAll(async () => {
		vettaHome = await mkdtemp(join(tmpdir(), "vetta-conv-visibility-"));
		previousVettaHome = process.env.VETTA_HOME;
		process.env.VETTA_HOME = vettaHome;
		vi.resetModules();
		service = await import("./filesystem-service.js");
		const config = await import("../config/desktop-config-store.js");
		conversationRoot = config.DEFAULT_CONVERSATION_CWD;

		await mkdir(join(conversationRoot, uuidDirName), { recursive: true });
		await writeFile(join(conversationRoot, uuidDirName, "inner.md"), "inner", "utf8");
		await mkdir(join(conversationRoot, "legacy-assets"), { recursive: true });
		await writeFile(join(conversationRoot, "legacy-assets", "chart.html"), "<html/>", "utf8");
		await writeFile(join(conversationRoot, "report.md"), "legacy", "utf8");
		service.allowProjectRoot(conversationRoot);
	});

	afterAll(async () => {
		if (previousVettaHome === undefined) {
			delete process.env.VETTA_HOME;
		} else {
			process.env.VETTA_HOME = previousVettaHome;
		}
		vi.resetModules();
		if (vettaHome) await rm(vettaHome, { recursive: true, force: true });
	});

	it("列举「对话」根时隐藏 uuid 工作区目录，老产物保持可见", async () => {
		const names = (await service.readFilesystemDirectory(conversationRoot)).map((entry) => entry.name);
		expect(names).toEqual(["legacy-assets", "report.md"]);
	});

	it("递归列举（@文件补全）不进入 uuid 工作区目录", async () => {
		const relPaths = (await service.listFilesystemFilesRecursive(conversationRoot)).map((file) => file.relPath);
		expect(relPaths).toContain(join("legacy-assets", "chart.html"));
		expect(relPaths).toContain("report.md");
		expect(relPaths.some((relPath) => relPath.startsWith(uuidDirName))).toBe(false);
	});

	it("会话自己的工作区目录作为根时不受过滤影响", async () => {
		const names = (await service.readFilesystemDirectory(join(conversationRoot, uuidDirName))).map(
			(entry) => entry.name,
		);
		expect(names).toEqual(["inner.md"]);
	});
});
