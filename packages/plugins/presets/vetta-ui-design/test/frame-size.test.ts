/**
 * 尺寸回落。
 *
 * 这组用例守的是一条产品结论：漏声明尺寸**不能**让画框掉出画布。实测现场
 * （design5 / 2026-08-06T02-48）5 个 frame 全漏声明，画布空了 141 秒，agent
 * 拿不到信号，跑去改了明令禁止的 .vetd manifest。
 */
import { expect, it } from "vitest";
import type { ParsedFrameMeta } from "../src/vetd/frame-meta";
import { FALLBACK_FRAME_SIZE, type FrameSizeInput, resolveFrameSizes } from "../src/vetd/frame-size";
import type { FrameMeta, FrameSize } from "../src/vetd/manifest-types";

const parsed = (width: number | null, height: number | null, title = "t"): ParsedFrameMeta => ({
	width,
	height,
	title,
});

const entry = (id: string, meta: ParsedFrameMeta, existing: FrameMeta | null = null): FrameSizeInput => ({
	id,
	parsed: meta,
	existing,
});

const sizesOf = (entries: FrameSizeInput[], designDefault?: FrameSize | null): Record<string, string> =>
	Object.fromEntries(
		[...resolveFrameSizes(entries, designDefault)].map(([id, size]) => [id, `${size.width}x${size.height}`]),
	);

it("keeps every frame on the canvas even when none declares a size", () => {
	// 实测翻车现场的形状：5 个 frame 一个尺寸都没声明。
	const ids = ["containers", "images", "overview", "settings", "volumes"];
	const resolved = resolveFrameSizes(ids.map((id) => entry(id, parsed(null, null))));
	expect([...resolved.keys()].sort()).toEqual(ids);
	for (const size of resolved.values()) expect(size).toEqual(FALLBACK_FRAME_SIZE);
});

it("falls back to the design's declared product size, not the desktop constant", () => {
	// 实测翻车现场（2026-08-06T04-29 / social-circle）：用户第一句就是「Mobile APP」，
	// agent 写的 4 个 frame 一个都没声明尺寸，整份设计静默落成桌面 1440x900。
	// vetd_create 现在把品类记在 manifest 里，同样的疏忽落到手机尺寸。
	const ids = ["chat", "circle", "explore", "home"];
	expect(sizesOf(ids.map((id) => entry(id, parsed(null, null))), { width: 390, height: 844 })).toEqual({
		chat: "390x844",
		circle: "390x844",
		explore: "390x844",
		home: "390x844",
	});
});

it("lets the design's existing frames outrank the declared product size", () => {
	// 中途改了品类：已经在画布上的那些帧才是现在的真相，manifest 里的品类是旧的。
	expect(
		sizesOf(
			[entry("a", parsed(1080, 1080)), entry("b", parsed(1080, 1080)), entry("c", parsed(null, null))],
			{ width: 390, height: 844 },
		).c,
	).toBe("1080x1080");
});

it("borrows the design's dominant size rather than the alphabetically previous frame", () => {
	// 关键点：containers 排在最前面且漏了声明。按「抄前一帧」的老规则它没有参考，
	// 会掉出画布并且带崩后面每一帧；按多数派它拿到 1440x900。
	expect(
		sizesOf([
			entry("containers", parsed(null, null)),
			entry("images", parsed(1440, 900)),
			entry("overview", parsed(1440, 900)),
			entry("settings", parsed(390, 844)),
		]),
	).toEqual({
		containers: "1440x900",
		images: "1440x900",
		overview: "1440x900",
		settings: "390x844",
	});
});

it("prefers the frame's own declaration over anything inferred", () => {
	expect(
		sizesOf([entry("poster", parsed(1080, 1440)), entry("a", parsed(1440, 900)), entry("b", parsed(1440, 900))]),
	).toMatchObject({ poster: "1080x1440" });
});

it("falls back to what the frame was last synced at when its declaration disappears", () => {
	// agent 重写文件时把 meta 行弄丢了：画框不该突然跳成别人的尺寸。
	expect(
		sizesOf([
			entry("detail", parsed(null, null), { width: 375, height: 812, title: "详情" }),
			entry("home", parsed(1440, 900)),
			entry("list", parsed(1440, 900)),
		]),
	).toMatchObject({ detail: "375x812" });
});

it("counts a half-declared size as no declaration", () => {
	expect(sizesOf([entry("solo", parsed(1200, null))])).toEqual({ solo: "1440x900" });
});

it("is stable when two sizes tie — first in input order wins", () => {
	const entries = [entry("a", parsed(390, 844)), entry("b", parsed(1440, 900)), entry("c", parsed(null, null))];
	expect(sizesOf(entries).c).toBe("390x844");
});
