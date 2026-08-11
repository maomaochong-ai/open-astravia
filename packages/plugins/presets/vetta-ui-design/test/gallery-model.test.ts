import type { PluginFsApi, PluginOfficialSessionSummary } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import {
	designCountBadge,
	filterGalleryProjects,
	type GalleryDesign,
	hasRunningSession,
	pickResumableSession,
	scanProjectDesigns,
	sortGalleryProjects,
	toGalleryProject,
} from "../src/gallery/gallery-model";

function design(name: string, modifiedAt: number): GalleryDesign {
	return { vetdPath: `/w/p/${name}.vetd`, name, modifiedAt };
}

function fsStub(entries: Array<{ name: string; isDirectory: boolean; modifiedAt?: number }>, manifests: Record<string, number> = {}) {
	return {
		readDir: vi.fn(async (dir: string) =>
			entries.map((entry) => ({
				name: entry.name,
				path: `${dir}/${entry.name}`,
				isDirectory: entry.isDirectory,
				size: 0,
				modifiedAt: entry.modifiedAt ?? 0,
			})),
		),
		stat: vi.fn(async (path: string) => {
			const found = manifests[path];
			return found === undefined ? null : { size: 1, modifiedAt: found, createdAt: 0 };
		}),
	} as unknown as PluginFsApi;
}

describe("scanProjectDesigns", () => {
	it("只认根目录一层里的 .vetd 目录", async () => {
		const fs = fsStub([
			{ name: "a.vetd", isDirectory: true },
			{ name: "notes.md", isDirectory: false },
			{ name: "b.vetd", isDirectory: false }, // 老的打包文件形态，不是设计包
			{ name: "src", isDirectory: true },
		]);
		const designs = await scanProjectDesigns(fs, "/w/p");
		expect(designs.map((item) => item.name)).toEqual(["a"]);
	});

	it("时间取 design.json 的 mtime，缺失时退回目录 mtime", async () => {
		const fs = fsStub(
			[
				{ name: "a.vetd", isDirectory: true, modifiedAt: 100 },
				{ name: "b.vetd", isDirectory: true, modifiedAt: 900 },
			],
			{ "/w/p/a.vetd/design.json": 5000 },
		);
		const designs = await scanProjectDesigns(fs, "/w/p");
		// a 的 manifest 更新，所以排在前面，即便它的目录 mtime 更小
		expect(designs.map((item) => [item.name, item.modifiedAt])).toEqual([
			["a", 5000],
			["b", 900],
		]);
	});

	it("目录读不了时当作没有设计，而不是让整页失败", async () => {
		const fs = { readDir: vi.fn(async () => Promise.reject(new Error("nope"))) } as unknown as PluginFsApi;
		await expect(scanProjectDesigns(fs, "/gone")).resolves.toEqual([]);
	});
});

describe("toGalleryProject", () => {
	it("没有设计的项目不进画廊", () => {
		expect(toGalleryProject({ path: "/w/p" }, [])).toBeNull();
	});

	it("卡面取最近改动的那份，项目名缺省时用目录名", () => {
		const card = toGalleryProject({ path: "/w/my-app", name: "  " }, [design("late", 900), design("old", 100)]);
		expect(card?.name).toBe("my-app");
		expect(card?.cover.name).toBe("late");
		expect(card?.modifiedAt).toBe(900);
	});
});

describe("sortGalleryProjects", () => {
	it("最近改动在前，同时间按名字稳定排", () => {
		const make = (name: string, modifiedAt: number) => ({
			cwd: `/w/${name}`,
			name,
			designs: [design(name, modifiedAt)],
			cover: design(name, modifiedAt),
			modifiedAt,
		});
		const sorted = sortGalleryProjects([make("b", 10), make("c", 99), make("a", 10)]);
		expect(sorted.map((item) => item.name)).toEqual(["c", "a", "b"]);
	});
});

describe("filterGalleryProjects", () => {
	const project = {
		cwd: "/w/shop",
		name: "Shop",
		designs: [design("checkout", 1), design("landing", 2)],
		cover: design("landing", 2),
		modifiedAt: 2,
	};

	it("空关键词返回全部", () => {
		expect(filterGalleryProjects([project], "   ")).toHaveLength(1);
	});

	it("项目名与设计名都能命中，且不分大小写", () => {
		expect(filterGalleryProjects([project], "SHO")).toHaveLength(1);
		expect(filterGalleryProjects([project], "checkout")).toHaveLength(1);
		expect(filterGalleryProjects([project], "nope")).toHaveLength(0);
	});
});

describe("pickResumableSession", () => {
	const session = (path: string, modifiedAt: number, interactiveResume: boolean): PluginOfficialSessionSummary => ({
		path,
		modifiedAt,
		access: { readHistory: true, interactiveResume, rename: false, delete: false },
	});

	it("挑最近的可续聊会话，跳过只读的", () => {
		const picked = pickResumableSession([session("/a", 10, false), session("/b", 5, true), session("/c", 1, true)]);
		expect(picked?.path).toBe("/b");
	});

	it("不依赖入参顺序", () => {
		const picked = pickResumableSession([session("/old", 1, true), session("/new", 100, true)]);
		expect(picked?.path).toBe("/new");
	});

	it("一个都不可续聊时返回 null，交给调用方落到新建会话页", () => {
		expect(pickResumableSession([session("/a", 10, false)])).toBeNull();
		expect(pickResumableSession([])).toBeNull();
	});
});

describe("designCountBadge", () => {
	it("只有一份设计时不出角标", () => {
		const one = { cwd: "/w/p", name: "p", designs: [design("a", 1)], cover: design("a", 1), modifiedAt: 1 };
		expect(designCountBadge(one)).toBeNull();
		expect(designCountBadge({ ...one, designs: [design("a", 1), design("b", 2)] })).toBe(2);
	});
});

describe("hasRunningSession", () => {
	it("按项目 cwd 精确匹配，尾部分隔符与反斜杠都归一", () => {
		expect(hasRunningSession("/w/p", ["/w/p/"])).toBe(true);
		expect(hasRunningSession("C:\\w\\p", ["C:/w/p"])).toBe(true);
	});

	it("同前缀的另一个项目不算在跑", () => {
		expect(hasRunningSession("/w/p", ["/w/p-two"])).toBe(false);
	});
});

/**
 * 迁移相关的用例需要一个能同时 readDir / rename / delete 的内存 fs，比上面
 * 只读的 fsStub 重，故单独放一份。
 */
function migratableFs(initial: Record<string, string>, dirs: string[] = []) {
	const files = new Map(Object.entries(initial));
	const explicitDirs = new Set(dirs);
	const isDir = (path: string): boolean =>
		explicitDirs.has(path) || [...files.keys()].some((candidate) => candidate.startsWith(`${path}/`));

	const fs = {
		// 与宿主一致：目录抛 EISDIR，不存在的路径返回空串。
		readFile: (path: string) =>
			isDir(path)
				? Promise.reject(new Error("EISDIR"))
				: Promise.resolve({ content: files.get(path) ?? "", encoding: "utf8" as const }),
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
		readDir: (dir: string) => {
			const names = new Map<string, boolean>();
			for (const path of [...files.keys(), ...explicitDirs]) {
				if (!path.startsWith(`${dir}/`)) continue;
				const rest = path.slice(dir.length + 1);
				const head = rest.split("/")[0];
				const isDirectory = rest.includes("/") || explicitDirs.has(`${dir}/${head}`);
				names.set(head, (names.get(head) ?? false) || isDirectory);
			}
			return Promise.resolve(
				[...names].map(([name, isDirectory]) => ({
					name,
					path: `${dir}/${name}`,
					isDirectory,
					size: 0,
					modifiedAt: 0,
				})),
			);
		},
	} as unknown as PluginFsApi;
	return { fs, files };
}

const MANIFEST = '{\n\t"version": 1,\n\t"type": "vetta-design",\n\t"frames": []\n}\n';

describe("scanProjectDesigns 的旧格式迁移", () => {
	it("扫描时就地把 v1（.vetd 文件 + .vetd.d/ 目录）升级成设计包并列出来", async () => {
		const { fs, files } = migratableFs({
			"/w/p/app.vetd": MANIFEST,
			"/w/p/app.vetd.d/theme.css": ":root{}",
			"/w/p/app.vetd.d/frames/home.tsx": "export default null;",
		});

		const designs = await scanProjectDesigns(fs, "/w/p");

		expect(designs.map((item) => item.vetdPath)).toEqual(["/w/p/app.vetd"]);
		expect(files.get("/w/p/app.vetd/design.json")).toBe(MANIFEST);
		expect(files.get("/w/p/app.vetd/frames/home.tsx")).toBe("export default null;");
		expect([...files.keys()].some((path) => path.includes(".vetd.d/"))).toBe(false);
	});

	it("重复扫描是幂等的：第二遍不再改动磁盘", async () => {
		const { fs, files } = migratableFs({
			"/w/p/app.vetd": MANIFEST,
			"/w/p/app.vetd.d/theme.css": ":root{}",
		});
		await scanProjectDesigns(fs, "/w/p");
		const after = JSON.stringify([...files.entries()].sort());

		const designs = await scanProjectDesigns(fs, "/w/p");

		expect(designs.map((item) => item.vetdPath)).toEqual(["/w/p/app.vetd"]);
		expect(JSON.stringify([...files.entries()].sort())).toBe(after);
	});

	it("打包分享文件同样叫 .vetd，不能被当成设计拆掉", async () => {
		const { fs, files } = migratableFs({ "/w/p/app-share.vetd": "PKbinary" });

		expect(await scanProjectDesigns(fs, "/w/p")).toEqual([]);
		expect(files.get("/w/p/app-share.vetd")).toBe("PKbinary");
	});

	it("迁移中断只剩 .vetd.d/ 时把它捞回来——只按文件名找设计的扫描器看不见它", async () => {
		const { fs, files } = migratableFs({
			"/w/p/app.vetd.d/design.json": MANIFEST,
			"/w/p/app.vetd.d/frames/home.tsx": "export default null;",
		});

		const designs = await scanProjectDesigns(fs, "/w/p");

		expect(designs.map((item) => item.vetdPath)).toEqual(["/w/p/app.vetd"]);
		expect(files.get("/w/p/app.vetd/frames/home.tsx")).toBe("export default null;");
	});

	it("同名设计包已经存在时不碰残留的旁挂目录（rename 会撞上已存在的目标）", async () => {
		const { fs, files } = migratableFs({
			"/w/p/app.vetd/design.json": MANIFEST,
			"/w/p/app.vetd.d/stale.txt": "x",
		});

		const designs = await scanProjectDesigns(fs, "/w/p");

		expect(designs.map((item) => item.vetdPath)).toEqual(["/w/p/app.vetd"]);
		expect(files.get("/w/p/app.vetd.d/stale.txt")).toBe("x");
		expect(files.get("/w/p/app.vetd/design.json")).toBe(MANIFEST);
	});
});
