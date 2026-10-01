/**
 * v1（`x.astravia-design` 文件 + `x.astravia-design-dir/` 目录）→ v2 设计包（`x.astravia-design/` 目录）的就地迁移。
 *
 * 关注三件事：迁完之后 discover 认得出、源码一个不少、打包分享文件不会被当成设计
 * 拆掉。中断重跑的幂等性单独覆盖——用户的设计只有一份，迁移不能有丢内容的窗口。
 */
import type { PluginFsApi } from "@astravia-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { findAstraviaDesignFiles } from "../src/astravia-design/discover";
import { migrateLegacyDesign } from "../src/astravia-design/migrate";

/** 内存文件系统：文件是 path→content，目录由「有孩子」或显式建过来决定。 */
function fakeFs(initial: Record<string, string>, dirs: string[] = []) {
	const files = new Map(Object.entries(initial));
	const explicitDirs = new Set(dirs);

	const isDir = (path: string): boolean =>
		explicitDirs.has(path) || [...files.keys()].some((candidate) => candidate.startsWith(`${path}/`));

	const fs = {
		// 与宿主一致：目录抛 EISDIR，**不存在的路径返回空串**而不是报错。
		readFile: (path: string) => {
			if (isDir(path)) return Promise.reject(new Error("EISDIR"));
			return Promise.resolve({ content: files.get(path) ?? "", encoding: "utf8" });
		},
		writeFile: (path: string, content: string) => {
			files.set(path, content);
			return Promise.resolve();
		},
		stat: (path: string) =>
			Promise.resolve(files.has(path) || isDir(path) ? { size: 0, modifiedAt: 0, createdAt: 0 } : null),
		createDirectory: (path: string) => {
			explicitDirs.add(path);
			return Promise.resolve();
		},
		delete: (path: string) => {
			files.delete(path);
			explicitDirs.delete(path);
			for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
			return Promise.resolve();
		},
		rename: (from: string, to: string) => {
			for (const [key, value] of [...files.entries()]) {
				if (key === from) {
					files.delete(key);
					files.set(to, value);
				} else if (key.startsWith(`${from}/`)) {
					files.delete(key);
					files.set(`${to}${key.slice(from.length)}`, value);
				}
			}
			if (explicitDirs.delete(from)) explicitDirs.add(to);
			return Promise.resolve();
		},
		listFilesRecursive: (root: string) =>
			Promise.resolve(
				[...files.keys()]
					.filter((path) => path.startsWith(`${root}/`))
					.map((path) => ({ name: path.split("/").pop() ?? path, path, relPath: path.slice(root.length + 1) })),
			),
	} as unknown as PluginFsApi;

	return { fs, files };
}

const MANIFEST = '{\n\t"version": 1,\n\t"type": "astravia-design",\n\t"frames": []\n}\n';

describe("migrateLegacyDesign", () => {
	it("把 manifest 收进旁挂目录，再让目录顶替原来的名字", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.astravia-design": MANIFEST,
			"/proj/app.astravia-design-dir/theme.css": ":root{}",
			"/proj/app.astravia-design-dir/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.astravia-design")).toBe(true);

		expect(files.get("/proj/app.astravia-design/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.astravia-design/frames/home.tsx")).toBe("export default null;");
		expect(files.get("/proj/app.astravia-design/theme.css")).toBe(":root{}");
		// 旧的两个条目都不复存在——留着任何一个都会让下一次扫描再迁移一遍。
		expect([...files.keys()].some((path) => path.includes(".astravia-design-dir/"))).toBe(false);
		expect(await fs.readFile("/proj/app.astravia-design").then(() => "file", () => "dir")).toBe("dir");
	});

	it("没有源码目录的空设计也能迁移，全程不删内容", async () => {
		const { fs, files } = fakeFs({ "/proj/empty.astravia-design": MANIFEST });

		expect(await migrateLegacyDesign(fs, "/proj/empty.astravia-design")).toBe(true);

		expect(files.get("/proj/empty.astravia-design/design.json")).toBe(MANIFEST);
		expect(files.has("/proj/empty.astravia-design.migrating")).toBe(false);
	});

	it("中断后重跑是幂等的：manifest 已经进了目录、旧文件还在", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.astravia-design": MANIFEST,
			"/proj/app.astravia-design-dir/design.json": MANIFEST,
			"/proj/app.astravia-design-dir/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.astravia-design")).toBe(true);

		expect(files.get("/proj/app.astravia-design/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.astravia-design/frames/home.tsx")).toBe("export default null;");
	});

	it("中断在「旧 manifest 已删、目录还没改名」时，重跑能把最后一步补上", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.astravia-design-dir/design.json": MANIFEST,
			"/proj/app.astravia-design-dir/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.astravia-design")).toBe(true);

		expect(files.get("/proj/app.astravia-design/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.astravia-design/frames/home.tsx")).toBe("export default null;");
	});

	it("既没有旧文件也没有旧目录时什么都不做", async () => {
		const { fs, files } = fakeFs({ "/proj/other.txt": "x" });
		expect(await migrateLegacyDesign(fs, "/proj/ghost.astravia-design")).toBe(false);
		expect([...files.keys()]).toEqual(["/proj/other.txt"]);
	});

	it("已经是设计包时什么都不做", async () => {
		const { fs, files } = fakeFs({ "/proj/app.astravia-design/design.json": MANIFEST });
		expect(await migrateLegacyDesign(fs, "/proj/app.astravia-design")).toBe(false);
		expect(files.get("/proj/app.astravia-design/design.json")).toBe(MANIFEST);
	});

	it("打包分享文件不是设计，不迁移", async () => {
		const { fs, files } = fakeFs({ "/proj/app-share.astravia-design": "PKbinary" });
		expect(await migrateLegacyDesign(fs, "/proj/app-share.astravia-design")).toBe(false);
		expect(files.get("/proj/app-share.astravia-design")).toBe("PKbinary");
	});
});

describe("findAstraviaDesignFiles", () => {
	it("同时列出设计包与刚被迁移的旧设计，并排除分享文件", async () => {
		const { fs } = fakeFs({
			"/proj/new.astravia-design/design.json": MANIFEST,
			"/proj/old.astravia-design": MANIFEST,
			"/proj/old.astravia-design-dir/frames/home.tsx": "export default null;",
			"/proj/old-share.astravia-design": "PKbinary",
			"/proj/notes.md": "# hi",
		});

		expect(await findAstraviaDesignFiles(fs, "/proj")).toEqual(["/proj/new.astravia-design", "/proj/old.astravia-design"]);
	});

	it("迁移停在「旧 manifest 已删、目录还没改名」时仍能找到并救回这份设计", async () => {
		// 这个中间态里磁盘上没有任何叫 `.astravia-design` 的条目，只按后缀找设计会彻底看不见它。
		const { fs, files } = fakeFs({
			"/proj/app.astravia-design-dir/design.json": MANIFEST,
			"/proj/app.astravia-design-dir/frames/home.tsx": "export default null;",
		});

		expect(await findAstraviaDesignFiles(fs, "/proj")).toEqual(["/proj/app.astravia-design"]);
		expect(files.get("/proj/app.astravia-design/frames/home.tsx")).toBe("export default null;");
	});

	it("旁挂目录里有 manifest 但旧文件还在时，仍走正常的 v1 迁移路径、不重复上报", async () => {
		// 迁移停在第 1 步之后：两份 manifest 并存。这不是「落单的旁挂目录」。
		const { fs } = fakeFs({
			"/proj/app.astravia-design": MANIFEST,
			"/proj/app.astravia-design-dir/design.json": MANIFEST,
			"/proj/app.astravia-design-dir/theme.css": ":root{}",
		});

		expect(await findAstraviaDesignFiles(fs, "/proj")).toEqual(["/proj/app.astravia-design"]);
	});

	it("同名设计包已经存在时，残留的旁挂目录不被当成另一份设计", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.astravia-design/design.json": MANIFEST,
			"/proj/app.astravia-design-dir/design.json": MANIFEST,
		});

		expect(await findAstraviaDesignFiles(fs, "/proj")).toEqual(["/proj/app.astravia-design"]);
		expect(files.get("/proj/app.astravia-design-dir/design.json")).toBe(MANIFEST);
	});
});
