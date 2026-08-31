import { useEffect, useState } from "react";
import type {
	DesktopSessionSearchRequest,
	DesktopSessionSearchResult,
	DesktopSessionSearchSource,
} from "@/shared/session-search";
import { mergeSessionSearchResults } from "@/shared/session-search-results";

export function useSessionSearch(open: boolean, request: DesktopSessionSearchRequest) {
	const [results, setResults] = useState<DesktopSessionSearchResult[]>([]);
	const [sources, setSources] = useState<DesktopSessionSearchSource[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [limited, setLimited] = useState(false);
	const [skipped, setSkipped] = useState(0);
	const { query, sourceKind, projectCwd, modifiedFrom, modifiedBefore, limit } = request;
	useEffect(() => {
		let active = true;
		let cancel: (() => void) | undefined;
		setResults([]);
		setError(false);
		setLimited(false);
		setSkipped(0);
		setLoading(open);
		if (!open) return;
		const timer = window.setTimeout(
			() => {
				cancel = window.vetta.session.searchSessions(
					{ query: query.trim(), sourceKind, projectCwd, modifiedFrom, modifiedBefore, limit },
					(event) => {
						if (!active) return;
						if (event.sources) setSources(event.sources);
						if (event.results?.length) {
							const next = event.results;
							setResults((previous) => mergeSessionSearchResults(previous, next, limit));
						}
						if (event.error) setError(true);
						if (event.done) {
							setLoading(false);
							setLimited(event.limited ?? false);
							setSkipped(event.skipped ?? 0);
						}
					},
				);
			},
			query.trim() ? 180 : 0,
		);
		return () => {
			active = false;
			window.clearTimeout(timer);
			cancel?.();
		};
	}, [open, query, sourceKind, projectCwd, modifiedFrom, modifiedBefore, limit]);
	return { results, sources, loading, error, limited, skipped };
}
