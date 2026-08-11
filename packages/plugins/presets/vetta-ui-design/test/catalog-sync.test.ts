import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESIGN_CATALOG_SOURCES, isCacheFresh, refreshDesignCatalog, repoRootUrl } from "../src/design-systems/catalog-sync";
import { catalogState, designSystems, resetDesignSystems } from "../src/design-systems/registry";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function remoteEntry(slug: string): Record<string, unknown> {
	return {
		kind: "design-system",
		slug,
		name: slug,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources: [
			{ path: "DESIGN.md", role: "spec", encoding: "text", bytes: 8, content: `# ${slug}` },
			{ path: "theme.css", role: "theme", encoding: "text", bytes: 34, content: "@theme { --color-primary: #000; }" },
		],
	};
}

function catalogOf(slugs: string[]): Record<string, unknown> {
	return { schemaVersion: 1, templates: slugs.map(remoteEntry) };
}

interface RequestLog {
	url: string;
	headers?: Record<string, string>;
}

interface FakeOptions {
	cached?: unknown;
	/** 按调用顺序返回；返回 null 表示这一次抛错（模拟离线）。 */
	responses?: Array<{ ok: boolean; status: number; body: unknown; headers?: Record<string, string> } | null>;
}

/** 复刻宿主 capability 层的入参约束：不接受值为 undefined 的键。 */
function assertJsonSafe(value: Record<string, unknown>): void {
	for (const [key, entry] of Object.entries(value)) {
		if (entry === undefined) {
			throw new Error(`Capability input validation failed: .${key} is undefined, which is not a JSON value`);
		}
	}
}

function fakeCtx(options: FakeOptions) {
	const writes: unknown[] = [];
	const requests: RequestLog[] = [];
	/** 原样留存的请求对象，用来断言可选字段是「没有这个键」而不是「值为 undefined」。 */
	const sent: Record<string, unknown>[] = [];
	let call = 0;
	const ctx = {
		storage: {
			readJson: async () => options.cached ?? null,
			writeJson: async (_key: string, value: unknown) => {
				writes.push(value);
			},
		},
		network: {
			request: async (request: { url: string; headers?: Record<string, string> }) => {
				// 宿主的 capability 层按 JSON 值校验入参：值为 undefined 的键会让整个请求失败
				// （真机上就是这么炸的）。fake 复刻这条约束，否则本地全绿、装到 app 里全挂。
				assertJsonSafe(request);
				sent.push(request);
				requests.push({ url: request.url, headers: request.headers });
				const next = options.responses?.[call++];
				if (!next) throw new Error("offline");
				return next;
			},
		},
	} as unknown as PluginContext;
	return { ctx, writes, requests, sent };
}

function cacheOf(slugs: string[], overrides: Partial<Record<string, unknown>> = {}) {
	return {
		catalog: catalogOf(slugs),
		fetchedAt: new Date(NOW).toISOString(),
		sourceUrl: DESIGN_CATALOG_SOURCES[0],
		etag: 'W/"abc"',
		...overrides,
	};
}

afterEach(() => {
	resetDesignSystems();
	vi.restoreAllMocks();
});

describe("isCacheFresh", () => {
	it.each([
		["刚写入", 0, true],
		["5 小时前", 5 * HOUR, true],
		["7 小时前（超过 TTL）", 7 * HOUR, false],
	])("%s → %s", (_label, ageMs, expected) => {
		expect(isCacheFresh(new Date(NOW - ageMs).toISOString(), NOW)).toBe(expected);
	});

	it("时钟回拨按已过期处理，宁可多发一次请求", () => {
		expect(isCacheFresh(new Date(NOW + HOUR).toISOString(), NOW)).toBe(false);
	});

	it("时间戳无法解析时按已过期处理", () => {
		expect(isCacheFresh("not-a-date", NOW)).toBe(false);
	});
});

describe("refreshDesignCatalog 的请求预算", () => {
	it("缓存新鲜时一个请求都不发", async () => {
		const { ctx, requests } = fakeCtx({ cached: cacheOf(["cached-one"]) });
		await refreshDesignCatalog(ctx, NOW + HOUR);
		expect(requests).toHaveLength(0);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
	});

	it("缓存过期后带 If-None-Match 条件请求", async () => {
		const { ctx, requests } = fakeCtx({
			cached: cacheOf(["cached-one"]),
			responses: [{ ok: false, status: 304, body: null }],
		});
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(requests).toHaveLength(1);
		expect(requests[0].headers).toEqual({ "if-none-match": 'W/"abc"' });
	});

	it("304 时沿用缓存内容，只把 fetchedAt 推后", async () => {
		const { ctx, writes } = fakeCtx({
			cached: cacheOf(["cached-one"]),
			responses: [{ ok: false, status: 304, body: null }],
		});
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		expect(writes).toHaveLength(1);
		expect((writes[0] as { catalog: unknown }).catalog).toEqual(catalogOf(["cached-one"]));
		expect(Date.parse((writes[0] as { fetchedAt: string }).fetchedAt)).toBeGreaterThan(NOW);
	});

	it("换源时不带上一个源的 ETag", async () => {
		const { ctx, requests } = fakeCtx({
			cached: cacheOf(["cached-one"], { sourceUrl: "https://elsewhere.example/catalog.json" }),
			responses: [{ ok: true, status: 200, body: catalogOf(["fresh"]) }],
		});
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(requests[0].url).toBe(DESIGN_CATALOG_SOURCES[0]);
		expect(requests[0].headers).toBeUndefined();
	});

	it("没有可用 ETag 时根本不带 headers 这个键", async () => {
		const { ctx, sent } = fakeCtx({ responses: [{ ok: true, status: 200, body: catalogOf(["fresh"]) }] });
		await refreshDesignCatalog(ctx, NOW);
		// 带一个 undefined 会被宿主判非法——必须是键不存在。
		expect(Object.hasOwn(sent[0], "headers")).toBe(false);
	});

	it("首选源失败时回落到下一个源", async () => {
		const { ctx, requests } = fakeCtx({
			responses: [null, { ok: true, status: 200, body: catalogOf(["from-fallback"]) }],
		});
		await refreshDesignCatalog(ctx, NOW);
		expect(requests.map((request) => request.url)).toEqual([...DESIGN_CATALOG_SOURCES]);
		expect(designSystems().map((system) => system.id)).toEqual(["from-fallback"]);
	});
});

describe("refreshDesignCatalog 的回退链", () => {
	it("网络成功时整体替换并记下 ETag", async () => {
		const { ctx, writes } = fakeCtx({
			responses: [{ ok: true, status: 200, body: catalogOf(["alpha", "beta"]), headers: { ETag: 'W/"new"' } }],
		});
		await refreshDesignCatalog(ctx, NOW);
		expect(designSystems().map((system) => system.id)).toEqual(["alpha", "beta"]);
		expect(writes[0]).toMatchObject({ etag: 'W/"new"', sourceUrl: DESIGN_CATALOG_SOURCES[0] });
	});

	it("网络全挂时沿用缓存，不清空列表", async () => {
		const { ctx, writes } = fakeCtx({ cached: cacheOf(["cached-one"]) });
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		expect(writes).toHaveLength(0);
	});

	it("缓存与网络都不可用时标成 failed，且不抛错", async () => {
		const { ctx } = fakeCtx({});
		await expect(refreshDesignCatalog(ctx, NOW)).resolves.toBeUndefined();
		// 没有随包兜底了：一套都没有是真实状态，必须让 UI 能说明原因。
		expect(designSystems()).toEqual([]);
		expect(catalogState().status).toBe("failed");
	});

	it("远端返回畸形内容时不污染当前列表", async () => {
		const { ctx, writes } = fakeCtx({
			cached: cacheOf(["cached-one"]),
			responses: [
				{ ok: true, status: 200, body: { schemaVersion: 1, templates: [{ kind: "design-system" }] } },
				{ ok: true, status: 200, body: { schemaVersion: 1, templates: [{ kind: "design-system" }] } },
			],
		});
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		expect(writes).toHaveLength(0);
	});

	it("HTTP 非 2xx 按失败处理", async () => {
		const { ctx } = fakeCtx({
			responses: [
				{ ok: false, status: 500, body: catalogOf(["nope"]) },
				{ ok: false, status: 500, body: catalogOf(["nope"]) },
			],
		});
		await refreshDesignCatalog(ctx, NOW);
		expect(designSystems()).toEqual([]);
		expect(catalogState().status).toBe("failed");
	});

	it("有缓存但网络失败时不降级成 failed——旧内容仍然可用", async () => {
		const { ctx } = fakeCtx({ cached: cacheOf(["cached-one"]) });
		await refreshDesignCatalog(ctx, NOW + 7 * HOUR);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		expect(catalogState().status).toBe("ready");
	});

	it("缓存损坏时丢弃它并照常联网", async () => {
		const { ctx, requests } = fakeCtx({
			cached: { catalog: "garbage", fetchedAt: new Date(NOW).toISOString(), etag: 'W/"stale"' },
			responses: [{ ok: true, status: 200, body: catalogOf(["fresh"]) }],
		});
		// 缓存解析不出来就不能算「新鲜」，也不能拿它的 ETag 去换 304——否则会一直空手而归。
		await refreshDesignCatalog(ctx, NOW);
		expect(requests[0].headers).toBeUndefined();
		expect(designSystems().map((system) => system.id)).toEqual(["fresh"]);
	});

	it("storage 读取抛错时静默继续", async () => {
		const ctx = {
			storage: {
				readJson: async () => {
					throw new Error("storage down");
				},
				writeJson: async () => {},
			},
			network: {
				request: async () => ({ ok: true, status: 200, body: catalogOf(["fresh"]) }),
			},
		} as unknown as PluginContext;
		await expect(refreshDesignCatalog(ctx, NOW)).resolves.toBeUndefined();
		expect(designSystems().map((system) => system.id)).toEqual(["fresh"]);
	});
});

describe("repoRootUrl", () => {
	it("剥掉清单自身的路径，得到仓库根", () => {
		// 资源地址是相对仓库根的；直接拿清单地址当 base 会多出一段 .vetta/。
		expect(repoRootUrl(DESIGN_CATALOG_SOURCES[0])).toBe(
			"https://cdn.jsdelivr.net/gh/openvetta/vetta-design-templates@main/",
		);
		expect(repoRootUrl(DESIGN_CATALOG_SOURCES[1])).toBe(
			"https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/",
		);
	});

	it("地址形状不认识时回落到清单所在目录", () => {
		expect(repoRootUrl("https://example.com/a/b/catalog.json")).toBe("https://example.com/a/b/");
	});
});
