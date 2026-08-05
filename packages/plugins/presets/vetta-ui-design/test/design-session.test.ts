/**
 * manifest 是外部可写文件的回归测试。
 *
 * 复现的 bug：skill 里写着「never edit the .vetd manifest」，但 agent 照样会直接
 * Write 它，写出来的 frame 条目没有 `meta` 字段。reconcile 拿它去比对就读到
 * undefined.width，整个 open() 抛异常——画布停在「设计引擎启动失败」，而且
 * watchDirectory 在 reconcile 之后才注册，于是文件监听一次都没挂上：此后 agent
 * 写多少 frame 画布都不动，点「重试」只是再崩一次。
 */
import { expect, it, vi } from "vitest";
import { DesignSession } from "../src/vetd/design-session";

interface FakeFile {
	content: string;
}

function fakeCtx(files: Record<string, string>) {
	const written: Record<string, string> = {};
	const fs = {
		readFile: vi.fn(async (path: string): Promise<FakeFile> => {
			const content = written[path] ?? files[path];
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return { content };
		}),
		writeFile: vi.fn(async (path: string, content: string): Promise<void> => {
			written[path] = content;
		}),
		readDir: vi.fn(async (dir: string) => {
			const prefix = `${dir}/`;
			const names = new Set<string>();
			for (const path of [...Object.keys(files), ...Object.keys(written)]) {
				if (!path.startsWith(prefix)) continue;
				const rest = path.slice(prefix.length);
				if (rest.includes("/")) continue;
				names.add(rest);
			}
			if (names.size === 0) throw new Error(`ENOENT: ${dir}`);
			return [...names].map((name) => ({ name, path: `${dir}/${name}`, isDirectory: false }));
		}),
		watchDirectory: vi.fn(() => ({ dispose: vi.fn() })),
	};
	return { ctx: { fs } as never, fs, written };
}

const VETD = "/w/demo.vetd";
const DIR = "/w/demo.vetd.d";

const frameSource = (title: string) =>
	`export const frame = { width: 390, height: 844, title: "${title}" };\nexport default function F() { return null; }\n`;

it("agent 手写的、缺 meta 的 manifest 不会让 open 崩掉", async () => {
	// agent 直接 Write 出来的样子：有 frame 条目，但没有插件才会写的 meta 快照。
	const manifest = {
		version: 1,
		type: "vetta-design",
		canvas: { x: 0, y: 0, zoom: 1 },
		frames: [{ id: "index", file: "frames/index.tsx", x: 0, y: 0, width: 390, height: 844, title: "首页" }],
	};
	const { ctx, fs, written } = fakeCtx({
		[VETD]: JSON.stringify(manifest),
		[`${DIR}/frames/index.tsx`]: frameSource("首页"),
	});
	const session = new DesignSession(ctx, VETD);

	await expect(session.open()).resolves.toBeUndefined();

	// frame 必须还在画布上，并且 meta 被补齐（否则下一轮 reconcile 又崩）。
	expect(session.manifest.frames).toHaveLength(1);
	expect(session.manifest.frames[0].meta).toEqual({ width: 390, height: 844, title: "首页" });
	// 崩在 reconcile 里就等于监听一行都没挂上——那才是「画布永远不更新」的根源。
	expect(fs.watchDirectory).toHaveBeenCalledTimes(2);
	expect(written[VETD]).toBeDefined();

	session.dispose();
});

it("agent 自创 schema 写的 manifest：条目丢弃后由 tsx 全量重建，一帧不少", async () => {
	// 线上现场（parking-miniapp.vetd）原样：字段名是 agent 编的 `path`，没有 x/y，
	// 没有 meta。这种条目留不得——位置信息本来就是它凭空写的——但内容一帧都不能丢，
	// 因为 sidecar 里的 tsx 都在。
	const manifest = {
		version: 1,
		type: "vetta-design",
		canvas: { x: 0, y: 0, zoom: 1 },
		frames: [
			{ id: "index", title: "首页", path: "frames/index.tsx", width: 390, height: 844 },
			{ id: "search", title: "找车位", path: "frames/search.tsx", width: 390, height: 844 },
			"garbage",
		],
	};
	const { ctx } = fakeCtx({
		[VETD]: JSON.stringify(manifest),
		[`${DIR}/frames/index.tsx`]: frameSource("首页"),
		[`${DIR}/frames/search.tsx`]: frameSource("找车位"),
	});
	const session = new DesignSession(ctx, VETD);

	await expect(session.open()).resolves.toBeUndefined();

	const frames = session.manifest.frames;
	expect(frames.map((frame) => frame.id).sort()).toEqual(["index", "search"]);
	for (const frame of frames) {
		expect(Number.isFinite(frame.x)).toBe(true);
		expect(Number.isFinite(frame.y)).toBe(true);
		expect(frame.width).toBe(390);
		expect(frame.file).toBe(`frames/${frame.id}.tsx`);
	}
	// 重建的位置必须错开，否则两帧叠在一起等于只剩一帧。
	expect(new Set(frames.map((frame) => `${frame.x},${frame.y}`)).size).toBe(frames.length);

	session.dispose();
});
