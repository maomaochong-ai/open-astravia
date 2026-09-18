import type { OpenMarketplaceCatalog } from "@preload/api";
import { describe, expect, it } from "vitest";
import {
	areAllAttemptedMarketSourcesUnavailable,
	getOpenMarketplaceLoadState,
	shouldReportAbilityLoadFailure,
} from "./ability-load-policy";

function catalog(overrides: Partial<OpenMarketplaceCatalog> = {}): OpenMarketplaceCatalog {
	return {
		sources: [],
		snapshots: [],
		abilities: [],
		failedSourceIds: [],
		...overrides,
	};
}

describe("ability load policy", () => {
	it("does not surface a server failure when an open marketplace is usable", () => {
		expect(
			areAllAttemptedMarketSourcesUnavailable([
				{ attempted: true, usable: false },
				{ attempted: true, usable: true },
			]),
		).toBe(false);
	});

	it("treats a successful empty source and a cached stale source as usable", () => {
		const source = {
			id: "test",
			name: "Test",
			type: "github" as const,
			repository: "https://github.com/example/test",
			archiveUrl: "https://github.com/example/test/archive/main.zip",
			ref: "main",
			enabled: true,
			builtin: false,
			autoUpdate: true,
			priority: 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const emptyState = getOpenMarketplaceLoadState(
			catalog({
				sources: [source],
				snapshots: [
					{
						sourceId: source.id,
						source,
						abilities: [],
						marketplaceVersion: "1",
						repository: source.repository,
						syncedAt: "2026-01-01T00:00:00.000Z",
						stale: false,
					},
				],
			}),
		);
		expect(emptyState).toEqual({ attempted: true, usable: true });

		const cachedState = getOpenMarketplaceLoadState(
			catalog({
				sources: [source],
				snapshots: [
					{
						sourceId: source.id,
						source,
						abilities: [{ slug: "cached" } as OpenMarketplaceCatalog["abilities"][number]],
						marketplaceVersion: "1",
						repository: source.repository,
						syncedAt: "2026-01-01T00:00:00.000Z",
						stale: true,
						error: "sync-failed",
					},
				],
			}),
		);
		expect(cachedState).toEqual({ attempted: true, usable: true });
	});

	it("surfaces an error only when every attempted source is unavailable", () => {
		expect(
			areAllAttemptedMarketSourcesUnavailable([
				{ attempted: true, usable: false },
				{ attempted: true, usable: false },
			]),
		).toBe(true);
		expect(areAllAttemptedMarketSourcesUnavailable([{ attempted: false, usable: false }])).toBe(false);
	});

	it("reports failure for local errors or fully unavailable markets", () => {
		expect(
			shouldReportAbilityLoadFailure({
				localFailed: true,
				server: { attempted: true, usable: true },
				open: { attempted: false, usable: false },
			}),
		).toBe(true);
		expect(
			shouldReportAbilityLoadFailure({
				localFailed: false,
				server: { attempted: true, usable: false },
				open: { attempted: true, usable: false },
			}),
		).toBe(true);
		expect(
			shouldReportAbilityLoadFailure({
				localFailed: false,
				server: { attempted: true, usable: false },
				open: { attempted: true, usable: true },
			}),
		).toBe(false);
	});
});
