// @vitest-environment jsdom
import type { OpenMarketplaceCatalog, OpenMarketplaceSourceSnapshot } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cloud: true, fetchMarket: vi.fn(), language: { language: "en" } }));
vi.mock("@shared/components/cloud-slots", () => ({
	get cloudEnabled() { return mocks.cloud; },
}));
vi.mock("@shared/lib/api", () => ({ fetchMarketAbilities: mocks.fetchMarket }));
vi.mock("@shared/i18n", () => ({
	i18n: {
		t: (key: string, options?: { names?: string }) => options?.names ? `${key}: ${options.names}` : key,
	},
}));
vi.mock("@shared/store/atoms", () => ({ authTokenAtom: {} }));
vi.mock("jotai", () => ({ useAtomValue: () => undefined }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: mocks.language }) }));
import { useAbilityData } from "./useAbilityData";

function catalog(slug = "existing", failed = false, id = "official"): OpenMarketplaceCatalog {
	const repository = `https://github.com/example/${id}`;
	const source = {
		id,
		name: id === "official" ? "Official" : id,
		type: "github" as const,
		repository,
		archiveUrl: `${repository}/archive/refs/heads/main.zip`,
		ref: "main",
		enabled: true,
		builtin: id === "official",
		autoUpdate: true,
		priority: 100,
		createdAt: "2026-08-30T00:00:00.000Z",
		updatedAt: "2026-08-30T00:00:00.000Z",
	};
	const snapshot: OpenMarketplaceSourceSnapshot = {
		source,
		sourceId: source.id,
		repository,
		marketplaceVersion: "v1",
		syncedAt: "2026-08-30T00:00:00.000Z",
		stale: failed,
		...(failed ? { error: "sync-failed" as const } : {}),
		abilities: [{
			slug,
			type: "mcp",
			name: slug,
			description: "",
			license: "MIT",
			version: "1.0.0",
			configVersion: 1,
			author: "",
			icon: "",
			category: "",
			tags: [],
			config: { mcp: { type: "http", url: "https://api.example/mcp" } },
			detail: {},
			origin: {
				kind: "github-marketplace",
				sourceId: source.id,
				marketplace: source.name,
				marketplaceVersion: "v1",
				repository,
			},
		}],
	};
	return { sources: [source], snapshots: [snapshot], abilities: snapshot.abilities, failedSourceIds: failed ? [source.id] : [] };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let updated: () => void;
const api = {
	getLedger: vi.fn(async () => ({})),
	listBuiltinPresentations: vi.fn(async () => ({})),
	listOpenMarketplaces: vi.fn(async () => catalog()),
	refreshOpenMarketplaces: vi.fn(async () => catalog("x-api-mcp")),
	refreshMarketplaceSource: vi.fn(async (_id: string) => catalog("x-api-mcp").snapshots[0]),
	addMarketplaceSource: vi.fn(async () => catalog().sources[0]),
	updateMarketplaceSource: vi.fn(async () => undefined),
	removeMarketplaceSource: vi.fn(async () => undefined),
	onOpenMarketplacesUpdated: vi.fn((listener: () => void) => {
		updated = listener;
		return () => undefined;
	}),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.cloud = true;
	mocks.fetchMarket.mockResolvedValue([]);
	api.listOpenMarketplaces.mockResolvedValue(catalog());
	api.refreshOpenMarketplaces.mockResolvedValue(catalog("x-api-mcp"));
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			abilities: api,
			skills: { getMarketManifest: async () => ({}), list: async () => [] },
			plugins: { listAll: async () => [] },
		},
	});
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("useAbilityData independent markets", () => {
	it("merges cloud and GitHub, and replaces the old catalog on refresh", async () => {
		mocks.fetchMarket.mockResolvedValue([{ slug: "cloud-mcp", type: "mcp" } as MarketAbility]);
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		expect(result.current.market.map((ability) => ability.slug)).toEqual(["cloud-mcp", "existing"]);
		act(() => result.current.refresh());
		await waitFor(() => expect(result.current.market.map((ability) => ability.slug)).toEqual(["cloud-mcp", "x-api-mcp"]));
	});

	it("does not count disabled cloud as a successful request hiding GitHub failure", async () => {
		mocks.cloud = false;
		api.listOpenMarketplaces.mockResolvedValue({ ...catalog("cached", true), abilities: [], snapshots: [] });
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		expect(mocks.fetchMarket).not.toHaveBeenCalled();
		expect(result.current.error).toContain("abilities:error.loadFailed");
		expect(result.current.error).toContain("Official");
	});

	it("keeps GitHub usable when cloud fails and shows the separate failure", async () => {
		mocks.fetchMarket.mockRejectedValue(new Error("offline"));
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		expect(result.current.market).toHaveLength(1);
		expect(result.current.error).toContain("abilities:error.serverFailed");
	});

	it("retains stale content and clears the warning after a successful single-source retry", async () => {
		api.listOpenMarketplaces.mockResolvedValue(catalog("cached", true));
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		expect(result.current.error).toContain("Official");
		api.listOpenMarketplaces.mockResolvedValue(catalog("fresh"));
		await act(() => result.current.refreshMarketplaceSource("official"));
		expect(api.refreshMarketplaceSource).toHaveBeenCalledWith("official");
		expect(result.current.market[0]?.slug).toBe("fresh");
		expect(result.current.error).toBeNull();
	});

	it("does not let an earlier list response overwrite a completed refresh", async () => {
		const old = deferred<OpenMarketplaceCatalog>();
		api.listOpenMarketplaces.mockReturnValueOnce(old.promise);
		const { result } = renderHook(() => useAbilityData());
		act(() => result.current.refresh());
		await waitFor(() => expect(result.current.market[0]?.slug).toBe("x-api-mcp"));
		await act(async () => old.resolve(catalog("old")));
		expect(result.current.market[0]?.slug).toBe("x-api-mcp");
	});

	it("keeps multiple GitHub sources usable without cloud when one source fails", async () => {
		mocks.cloud = false;
		const healthy = catalog("fresh");
		const broken = catalog("cached", true, "community");
		api.listOpenMarketplaces.mockResolvedValue({
			sources: [...healthy.sources, ...broken.sources],
			snapshots: [...healthy.snapshots, ...broken.snapshots],
			abilities: [...healthy.abilities, ...broken.abilities],
			failedSourceIds: broken.failedSourceIds,
		});
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		expect(result.current.market.map((ability) => ability.slug)).toEqual(["fresh", "cached"]);
		expect(result.current.error).toContain("community");
		expect(result.current.error).not.toContain("abilities:error.loadFailed");
		expect(mocks.fetchMarket).not.toHaveBeenCalled();
	});

	it("retains a newly added source after sync failure so it can be retried", async () => {
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		const failed = catalog("", true, "community");
		api.addMarketplaceSource.mockResolvedValueOnce(failed.sources[0]);
		api.refreshMarketplaceSource.mockResolvedValueOnce(failed.snapshots[0]);
		api.listOpenMarketplaces.mockResolvedValue({ ...failed, snapshots: [], abilities: [] });
		await act(() => result.current.addMarketplaceSource({ repository: "example/community" }));
		expect(result.current.marketplaceSources[0]?.id).toBe("community");
		expect(result.current.error).toContain("community");
		expect(api.removeMarketplaceSource).not.toHaveBeenCalled();
	});

	it("removes disabled source entries without refreshing cloud or changing local installation state", async () => {
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		const ledger = result.current.ledger;
		const disabled = catalog();
		disabled.sources[0]!.enabled = false;
		api.listOpenMarketplaces.mockResolvedValue({ ...disabled, snapshots: [], abilities: [] });
		await act(() => result.current.updateMarketplaceSource("official", { enabled: false }));
		expect(api.updateMarketplaceSource).toHaveBeenCalledWith("official", { enabled: false });
		expect(result.current.market).toEqual([]);
		expect(result.current.ledger).toBe(ledger);
		expect(mocks.fetchMarket).toHaveBeenCalledOnce();
		expect(api.refreshMarketplaceSource).not.toHaveBeenCalled();
	});

	it("reconciles a background notification after an in-flight refresh", async () => {
		const next = deferred<OpenMarketplaceCatalog>();
		const { result } = renderHook(() => useAbilityData());
		await waitFor(() => expect(result.current.refreshing).toBe(false));
		api.refreshOpenMarketplaces.mockReturnValueOnce(next.promise);
		act(() => result.current.refresh());
		api.listOpenMarketplaces.mockResolvedValue(catalog("background"));
		act(() => updated());
		await act(async () => next.resolve(catalog("refreshed")));
		await waitFor(() => expect(result.current.market[0]?.slug).toBe("background"));
	});
});
