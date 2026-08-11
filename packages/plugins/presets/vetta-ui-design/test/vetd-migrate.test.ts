/**
 * v1（`x.vetd` 文件 + `x.vetd.d/` 目录）→ v2 设计包（`x.vetd/` 目录）的就地迁移。
 *
 * 关注三件事：迁完之后 discover 认得出、源码一个不少、打包分享文件不会被当成设计
 * 拆掉。中断重跑的幂等性单独覆盖——用户的设计只有一份，迁移不能有丢内容的窗口。
 */
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { findVetdFiles } from "../src/vetd/discover";
import { migrateLegacyDesign } from "../src/vetd/migrate";

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

const MANIFEST = '{\n\t"version": 1,\n\t"type": "vetta-design",\n\t"frames": []\n}\n';

describe("migrateLegacyDesign", () => {
	it("把 manifest 收进旁挂目录，再让目录顶替原来的名字", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.vetd": MANIFEST,
			"/proj/app.vetd.d/theme.css": ":root{}",
			"/proj/app.vetd.d/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.vetd")).toBe(true);

		expect(files.get("/proj/app.vetd/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.vetd/frames/home.tsx")).toBe("export default null;");
		expect(files.get("/proj/app.vetd/theme.css")).toBe(":root{}");
		// 旧的两个条目都不复存在——留着任何一个都会让下一次扫描再迁移一遍。
		expect([...files.keys()].some((path) => path.includes(".vetd.d/"))).toBe(false);
		expect(await fs.readFile("/proj/app.vetd").then(() => "file", () => "dir")).toBe("dir");
	});

	it("没有源码目录的空设计也能迁移，全程不删内容", async () => {
		const { fs, files } = fakeFs({ "/proj/empty.vetd": MANIFEST });

		expect(await migrateLegacyDesign(fs, "/proj/empty.vetd")).toBe(true);

		expect(files.get("/proj/empty.vetd/design.json")).toBe(MANIFEST);
		expect(files.has("/proj/empty.vetd.migrating")).toBe(false);
	});

	it("中断后重跑是幂等的：manifest 已经进了目录、旧文件还在", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.vetd": MANIFEST,
			"/proj/app.vetd.d/design.json": MANIFEST,
			"/proj/app.vetd.d/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.vetd")).toBe(true);

		expect(files.get("/proj/app.vetd/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.vetd/frames/home.tsx")).toBe("export default null;");
	});

	it("中断在「旧 manifest 已删、目录还没改名」时，重跑能把最后一步补上", async () => {
		const { fs, files } = fakeFs({
			"/proj/app.vetd.d/design.json": MANIFEST,
			"/proj/app.vetd.d/frames/home.tsx": "export default null;",
		});

		expect(await migrateLegacyDesign(fs, "/proj/app.vetd")).toBe(true);

		expect(files.get("/proj/app.vetd/design.json")).toBe(MANIFEST);
		expect(files.get("/proj/app.vetd/frames/home.tsx")).toBe("export default null;");
	});

	it("既没有旧文件也没有旧目录时什么都不做", async () => {
		const { fs, files } = fakeFs({ "/proj/other.txt": "x" });
		expect(await migrateLegacyDesign(fs, "/proj/ghost.vetd")).toBe(false);
		expect([...files.keys()]).toEqual(["/proj/other.txt"]);
	});

	it("已经是设计包时什么都不做", async () => {
		const { fs, files } = fakeFs({ "/proj/app.vetd/design.json": MANIFEST });
		expect(await migrateLegacyDesign(fs, "/proj/app.vetd")).toBe(false);
		expect(files.get("/proj/app.vetd/design.json")).toBe(MANIFEST);
	});

	it("打包分享文件不是设计，不迁移", async () => {
		const { fs, files } = fakeFs({ "/proj/app-share.vetd": "PKbinary" });
		expect(await migrateLegacyDesign(fs, "/proj/app-share.vetd")).toBe(false);
		expect(files.get("/proj/app-share.vetd")).toBe("PKbinary");
	});
});

describe("findVetdFiles", () => {
	it("同时列出设计包与刚被迁移的旧设计，并排除分享文件", async () => {
		const { fs } = fakeFs({
			"/proj/new.vetd/design.json": MANIFEST,
			"/proj/old.vetd": MANIFEST,
			"/proj/old.vetd.d/frames/home.tsx": "export default null;",
			"/proj/old-share.vetd": "PKbinary",
			"/proj/notes.md": "# hi",
		});

		expect(await findVetdFiles(fs, "/proj")).toEqual(["/proj/new.vetd", "/proj/old.vetd"]);
	});
});
