import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshDesignCatalog } from "../src/design-systems/catalog-sync";
import { BUILTIN_DESIGN_SYSTEMS } from "../src/design-systems/builtin";
import { designSystems, resetDesignSystems } from "../src/design-systems/registry";

function remoteEntry(slug: string): Record<string, unknown> {
	return {
		kind: "design-system",
		slug,
		name: slug,
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		content: { spec: `# ${slug}`, theme: "@theme { --color-primary: #000; }" },
	};
}

function catalogOf(slugs: string[]): Record<string, unknown> {
	return { schemaVersion: 1, templates: slugs.map(remoteEntry) };
}

interface FakeOptions {
	cached?: unknown;
	remote?: (() => Promise<{ ok: boolean; body: unknown }>) | null;
}

function fakeCtx(options: FakeOptions) {
	const writes: unknown[] = [];
	const ctx = {
		storage: {
			readJson: async () => options.cached ?? null,
			writeJson: async (_key: string, value: unknown) => {
				writes.push(value);
			},
		},
		network: {
			request: async () => {
				if (!options.remote) throw new Error("offline");
				return options.remote();
			},
		},
	} as unknown as PluginContext;
	return { ctx, writes };
}

afterEach(() => {
	resetDesignSystems();
	vi.restoreAllMocks();
});

describe("refreshDesignCatalog", () => {
	it("网络成功时整体替换为远端列表并写缓存", async () => {
		const { ctx, writes } = fakeCtx({
			remote: async () => ({ ok: true, body: catalogOf(["alpha", "beta"]) }),
		});
		await refreshDesignCatalog(ctx);
		expect(designSystems().map((system) => system.id)).toEqual(["alpha", "beta"]);
		expect(writes).toHaveLength(1);
	});

	it("网络挂掉时用缓存，不回落到内置", async () => {
		const { ctx, writes } = fakeCtx({
			cached: { catalog: catalogOf(["cached-one"]), fetchedAt: "2026-08-11T00:00:00.000Z" },
			remote: null,
		});
		await refreshDesignCatalog(ctx);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		// 网络没成功就不该刷新缓存。
		expect(writes).toHaveLength(0);
	});

	it("缓存与网络都不可用时保持内置那份，且不抛错", async () => {
		const { ctx } = fakeCtx({ remote: null });
		await expect(refreshDesignCatalog(ctx)).resolves.toBeUndefined();
		expect(designSystems()).toEqual(BUILTIN_DESIGN_SYSTEMS);
	});

	it("远端返回畸形内容时不污染当前列表", async () => {
		const { ctx, writes } = fakeCtx({
			cached: { catalog: catalogOf(["cached-one"]) },
			remote: async () => ({ ok: true, body: { schemaVersion: 1, templates: [{ kind: "design-system" }] } }),
		});
		await refreshDesignCatalog(ctx);
		expect(designSystems().map((system) => system.id)).toEqual(["cached-one"]);
		expect(writes).toHaveLength(0);
	});

	it("HTTP 非 2xx 按失败处理", async () => {
		const { ctx } = fakeCtx({ remote: async () => ({ ok: false, body: catalogOf(["should-not-apply"]) }) });
		await refreshDesignCatalog(ctx);
		expect(designSystems()).toEqual(BUILTIN_DESIGN_SYSTEMS);
	});

	it("缓存损坏不影响后续网络刷新", async () => {
		const { ctx } = fakeCtx({
			cached: { catalog: "garbage" },
			remote: async () => ({ ok: true, body: catalogOf(["fresh"]) }),
		});
		await refreshDesignCatalog(ctx);
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
				request: async () => ({ ok: true, body: catalogOf(["fresh"]) }),
			},
		} as unknown as PluginContext;
		await expect(refreshDesignCatalog(ctx)).resolves.toBeUndefined();
		expect(designSystems().map((system) => system.id)).toEqual(["fresh"]);
	});
});
