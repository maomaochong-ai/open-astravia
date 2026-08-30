import type { AddMarketplaceSourceInput, OpenMarketplaceCatalog, UpdateMarketplaceSourceInput } from "@preload/api";
import { i18n } from "@shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_CATALOG: OpenMarketplaceCatalog = { sources: [], snapshots: [], abilities: [], failedSourceIds: [] };

/** Owns GitHub catalog reads and mutations; all entry points share the same request ordering. */
export function useOpenMarketplaceData() {
	const [catalog, setCatalog] = useState<OpenMarketplaceCatalog>(EMPTY_CATALOG);
	const [refreshing, setRefreshing] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const generation = useRef(0);
	const active = useRef(0);
	const mounted = useRef(true);
	const pendingUpdate = useRef(false);

	const run = useCallback(async (task: () => Promise<OpenMarketplaceCatalog>): Promise<OpenMarketplaceCatalog> => {
		const ticket = ++generation.current;
		active.current++;
		setRefreshing(true);
		try {
			const value = await task();
			if (mounted.current && ticket === generation.current) {
				setCatalog(value);
				setLoadFailed(false);
			}
			return value;
		} catch (error) {
			if (mounted.current && ticket === generation.current) setLoadFailed(true);
			throw error;
		} finally {
			active.current--;
			if (mounted.current && active.current === 0) setRefreshing(false);
		}
	}, []);

	const load = useCallback(
		(force: boolean) =>
			run(() =>
				force ? window.vetta.abilities.refreshOpenMarketplaces() : window.vetta.abilities.listOpenMarketplaces(),
			),
		[run],
	);

	const refreshSource = useCallback(
		async (id: string): Promise<void> => {
			await run(async () => {
				await window.vetta.abilities.refreshMarketplaceSource(id);
				return window.vetta.abilities.listOpenMarketplaces();
			});
		},
		[run],
	);

	const addSource = useCallback(
		async (input: AddMarketplaceSourceInput): Promise<void> => {
			await run(async () => {
				const source = await window.vetta.abilities.addMarketplaceSource(input);
				// A valid source remains configured when syncing fails, so the user can retry it.
				await window.vetta.abilities.refreshMarketplaceSource(source.id);
				return window.vetta.abilities.listOpenMarketplaces();
			});
		},
		[run],
	);

	const updateSource = useCallback(
		async (id: string, input: UpdateMarketplaceSourceInput): Promise<void> => {
			await run(async () => {
				await window.vetta.abilities.updateMarketplaceSource(id, input);
				if (input.ref !== undefined || input.enabled === true)
					await window.vetta.abilities.refreshMarketplaceSource(id);
				return window.vetta.abilities.listOpenMarketplaces();
			});
		},
		[run],
	);

	const removeSource = useCallback(
		async (id: string): Promise<void> => {
			await run(async () => {
				await window.vetta.abilities.removeMarketplaceSource(id);
				return window.vetta.abilities.listOpenMarketplaces();
			});
		},
		[run],
	);

	useEffect(() => {
		mounted.current = true;
		const unsubscribe = window.vetta.abilities.onOpenMarketplacesUpdated(() => {
			if (active.current > 0) pendingUpdate.current = true;
			else void load(false).catch(() => undefined);
		});
		return () => {
			mounted.current = false;
			generation.current++;
			unsubscribe();
		};
	}, [load]);

	useEffect(() => {
		if (!refreshing && pendingUpdate.current) {
			pendingUpdate.current = false;
			void load(false).catch(() => undefined);
		}
	}, [load, refreshing]);

	const failedNames = catalog.sources
		.filter((source) => source.enabled && catalog.failedSourceIds.includes(source.id))
		.map((source) => source.name);
	const error = loadFailed
		? i18n.t("abilities:error.loadFailed")
		: failedNames.length
			? i18n.t("abilities:error.sourcesFailed", { names: failedNames.join(", ") })
			: null;
	return { catalog, refreshing, error, load, refreshSource, addSource, updateSource, removeSource };
}
