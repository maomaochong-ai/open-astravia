/**
 * 只读预览画布的两处节流：裁剪矩形够用就不重算（平移途中不每帧重渲染），
 * iframe 超过上限时卸掉最久没出现在可见范围里的（来回平移不无限累积）。
 */
import { expect, it } from "vitest";
import { nextCullRect, planMounted } from "../src/preview/PreviewCanvas";

const SIZE = { width: 1000, height: 800 };

it("keeps the cull rect while the viewport pans within the slack", () => {
	const first = nextCullRect(null, { x: 0, y: 0, zoom: 1 }, SIZE);
	expect(first).not.toBeNull();
	// 平移 100px：离预留边缘还远，不该产生新矩形（否则每帧都 setState）。
	expect(nextCullRect(first, { x: -100, y: -50, zoom: 1 }, SIZE)).toBeNull();
	// 平移超过预留：必须重算，否则会露出没建 iframe 的区域。
	expect(nextCullRect(first, { x: -900, y: 0, zoom: 1 }, SIZE)).not.toBeNull();
});

it("shrinks the cull rect after zooming in far enough", () => {
	const wide = nextCullRect(null, { x: 0, y: 0, zoom: 0.25 }, SIZE);
	// 放大到 1 倍：可见范围仍在旧矩形里，但旧矩形大了一倍以上，要收回来。
	expect(nextCullRect(wide, { x: 0, y: 0, zoom: 1 }, SIZE)).not.toBeNull();
});

it("admits at most two loading iframes at a time", () => {
	const plan = planMounted(["a", "b", "c"], new Set(), new Set(), new Map());
	expect([...(plan?.mounted ?? [])]).toEqual(["a", "b"]);
	expect(planMounted(["a", "b", "c"], new Set(["a", "b"]), new Set(), new Map())).toBeNull();
});

it("evicts the least recently seen off-screen iframes beyond the cap", () => {
	const mounted = new Set(["o1", "o2", "o3", "o4", "o5", "v1"]);
	const loaded = new Set(mounted);
	const lastSeen = new Map([
		["o1", 5],
		["o2", 1],
		["o3", 4],
		["o4", 2],
		["o5", 3],
		["v1", 9],
	]);
	const plan = planMounted(["v1", "v2", "v3"], mounted, loaded, lastSeen);
	// 新进来两个可见的，总数 8 超过上限 6：先卸最久没见的 o2、o4。
	expect(plan?.evicted).toEqual(["o2", "o4"]);
	expect(plan?.mounted.has("v2")).toBe(true);
	expect(plan?.mounted.has("v3")).toBe(true);
	expect(plan?.mounted.size).toBe(6);
});

it("never evicts a visible iframe even when over the cap", () => {
	const visible = ["a", "b", "c", "d", "e", "f", "g"];
	const all = new Set(visible);
	expect(planMounted(visible, all, all, new Map())).toBeNull();
});
