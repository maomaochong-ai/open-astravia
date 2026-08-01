import type { FsEntry, FsFileRef } from "@preload/fs-types";
import { type ShortcutBinding, useShortcutScope } from "@shared/shortcuts";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelProps,
	AtPanelViewProps,
	SelectedFile,
} from "../components/at-panel/types";

interface DisplayItem {
	path: string;
	name: string;
	isDirectory: boolean;
	relPath?: string;
}

function fuzzyScore(query: string, path: string, name: string): number | null {
	const t = path.toLowerCase();
	let qi = 0;
	let score = 0;
	let prev = -2;
	for (let ti = 0; ti < t.length && qi < query.length; ti++) {
		if (t[ti] === query[qi]) {
			score += prev === ti - 1 ? 6 : 1;
			const before = ti === 0 ? "/" : t[ti - 1];
			if (before === "/" || before === "-" || before === "_" || before === ".") score += 4;
			prev = ti;
			qi++;
		}
	}
	if (qi < query.length) return null;
	if (name.toLowerCase().includes(query)) score += 15;
	score -= t.length * 0.02;
	return score;
}

const MAX_SEARCH_RESULTS = 100;
const HIDDEN = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db"]);

function fileIcon(name: string, isDir: boolean): string {
	if (isDir) return "icon-[solar--folder-linear]";
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "ts":
		case "tsx":
			return "icon-[mdi--language-typescript]";
		case "js":
		case "jsx":
			return "icon-[mdi--language-javascript]";
		case "json":
			return "icon-[mdi--code-json]";
		case "md":
		case "mdx":
			return "icon-[mdi--language-markdown]";
		case "css":
		case "scss":
			return "icon-[mdi--language-css3]";
		case "html":
			return "icon-[mdi--language-html5]";
		case "py":
			return "icon-[mdi--language-python]";
		case "rs":
			return "icon-[mdi--language-rust]";
		case "go":
			return "icon-[mdi--language-go]";
		case "yaml":
		case "yml":
			return "icon-[mdi--file-cog-outline]";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
		case "webp":
			return "icon-[mdi--file-image-outline]";
		case "pdf":
			return "icon-[mdi--file-pdf-box]";
		case "docx":
		case "doc":
			return "icon-[mdi--file-word-outline]";
		default:
			return "icon-[solar--file-linear]";
	}
}

function parentOf(path: string): string {
	return path.replace(/\/[^/]+\/?$/, "") || "/";
}

export interface AtPanelModel {
	hidden: boolean;
	viewProps: AtPanelViewProps;
}

export function useAtPanelModel({
	open,
	onClose,
	onSelect,
	filter,
	cwd,
	className,
	classNames,
}: AtPanelProps): AtPanelModel {
	const { t } = useTranslation("chat");
	const [currentDir, setCurrentDir] = useState(cwd);
	const [entries, setEntries] = useState<FsEntry[]>([]);
	const [allFiles, setAllFiles] = useState<FsFileRef[]>([]);
	const [loading, setLoading] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const panelRef = useRef<HTMLDivElement>(null);
	// 仅键盘导航需要把高亮滚进视口；鼠标 hover 只改高亮，不抢滚动位置。
	const shouldScrollActiveIntoViewRef = useRef(false);

	useEffect(() => {
		if (open) {
			setCurrentDir(cwd);
		}
	}, [open, cwd]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		void window.vetta.fs.readDir(currentDir).then((result) => {
			if (cancelled) return;
			const visible = result.filter((e) => !HIDDEN.has(e.name) && !e.name.startsWith("."));
			visible.sort((a, b) => {
				if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
			setEntries(visible);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, currentDir]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void window.vetta.fs.listFilesRecursive(cwd).then((files) => {
			if (!cancelled) setAllFiles(files);
		});
		return () => {
			cancelled = true;
		};
	}, [open, cwd]);

	const normalizedFilter = filter.startsWith("@") ? filter.slice(1) : filter;
	const isSearching = normalizedFilter.length > 0;

	const allItems = useMemo((): DisplayItem[] => {
		if (!isSearching) {
			return entries.map((e) => ({ path: e.path, name: e.name, isDirectory: e.isDirectory }));
		}
		const q = normalizedFilter.toLowerCase();
		const scored: { item: DisplayItem; score: number }[] = [];
		for (const f of allFiles) {
			const score = fuzzyScore(q, f.relPath, f.name);
			if (score !== null) {
				scored.push({ item: { path: f.path, name: f.name, isDirectory: false, relPath: f.relPath }, score });
			}
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, MAX_SEARCH_RESULTS).map((s) => s.item);
	}, [allFiles, entries, isSearching, normalizedFilter]);
	const isSearchWithNoResults = open && isSearching && (loading || allItems.length === 0);

	const canGoUp = !isSearching && currentDir !== cwd;

	useEffect(() => {
		if (isSearchWithNoResults) onClose();
	}, [isSearchWithNoResults, onClose]);

	// Reset highlight when filter/dir changes (deps intentional).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter/dir identity
	useEffect(() => {
		setActiveIndex(0);
	}, [filter, currentDir]);

	const totalCount = (canGoUp ? 1 : 0) + allItems.length;

	const handleEntrySelect = useCallback(
		(item: DisplayItem) => {
			if (item.isDirectory) {
				setCurrentDir(item.path);
				return;
			}
			onSelect({ path: item.path, name: item.name, isDirectory: false } satisfies SelectedFile);
		},
		[onSelect],
	);

	const handleGoUp = useCallback(() => {
		setCurrentDir((prev) => parentOf(prev));
	}, []);

	const keyBindings = useMemo((): ShortcutBinding[] => {
		return [
			{
				key: "arrowdown",
				run: () => {
					if (totalCount === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((i) => (i + 1) % totalCount);
				},
			},
			{
				key: "arrowup",
				run: () => {
					if (totalCount === 0) return;
					shouldScrollActiveIntoViewRef.current = true;
					setActiveIndex((i) => (i - 1 + totalCount) % totalCount);
				},
			},
			{
				key: "enter",
				run: () => {
					if (totalCount === 0) return;
					if (canGoUp && activeIndex === 0) {
						handleGoUp();
					} else {
						const item = allItems[canGoUp ? activeIndex - 1 : activeIndex];
						if (item) handleEntrySelect(item);
					}
				},
			},
			{
				key: "escape",
				run: () => onClose(),
			},
			{
				key: "tab",
				run: () => {
					const item = allItems[canGoUp ? activeIndex - 1 : activeIndex];
					if (item?.isDirectory) setCurrentDir(item.path);
				},
			},
		];
	}, [totalCount, canGoUp, activeIndex, allItems, handleEntrySelect, handleGoUp, onClose]);

	useShortcutScope({
		id: "overlay:at-panel",
		kind: "overlay",
		active: open,
		exclusive: false,
		bindings: keyBindings,
	});

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		const timer = setTimeout(() => {
			document.addEventListener("mousedown", handleClick);
		}, 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", handleClick);
		};
	}, [open, onClose]);

	useLayoutEffect(() => {
		if (!open || !shouldScrollActiveIntoViewRef.current) return;
		shouldScrollActiveIntoViewRef.current = false;
		panelRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const relDir = currentDir.startsWith(cwd) ? currentDir.slice(cwd.length) || "/" : currentDir;
	const viewEntries: AtPanelEntryModel[] = allItems.map((entry, i) => {
		const index = canGoUp ? i + 1 : i;
		return {
			...entry,
			index,
			active: index === activeIndex,
			icon: fileIcon(entry.name, entry.isDirectory),
		};
	});

	const labels: AtPanelLabels = {
		header: t("atPanel.header"),
		headingMeta: isSearching ? t("atPanel.searchResults", { count: allItems.length }) : relDir,
		loading: t("atPanel.loading"),
		noResults: t("atPanel.noResults"),
		emptyDirectory: t("atPanel.emptyDirectory"),
		goUp: t("atPanel.goUp"),
		enterDirectory: t("atPanel.enterDirectory"),
	};

	return {
		hidden: isSearchWithNoResults,
		viewProps: {
			open,
			loading,
			normalizedFilter,
			canGoUp,
			goUpActive: activeIndex === 0,
			entries: viewEntries,
			labels,
			panelRef: panelRef as RefObject<HTMLDivElement | null>,
			className,
			classNames,
			onGoUp: handleGoUp,
			onHoverIndex: setActiveIndex,
			onEntryClick: handleEntrySelect,
		},
	};
}
