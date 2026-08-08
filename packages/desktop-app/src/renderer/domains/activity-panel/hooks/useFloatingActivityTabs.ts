import type { TabBarDragEvent } from "@shared/components/ui/tab-bar";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	ACTIVITY_PANEL_MIN_WIDTH,
	type FloatingActivityTabPlacement,
	floatingActivityTabsByProjectAtom,
} from "@shared/store/atoms";
import { useAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ActivityTabBounds,
	type ActivityTabPoint,
	clampFloatingTabRect,
	createFloatingTabRect,
	type FloatingActivityTabRect,
	hasLeftTabStrip,
	insertDockedTabAtPoint,
	isInsideTabStrip,
	mergeDockedTabOrder,
	moveFloatingTabRect,
	resizeFloatingTabRect,
} from "../services/floating-activity-tab";

const GLOBAL_ACTIVITY_SCOPE = "__global_activity_panel__";

interface FloatingTabDragSession {
	detached: boolean;
	initialPlacements: FloatingActivityTabPlacement[];
	key: ActivityTabKey;
	offset: ActivityTabPoint;
	rect: FloatingActivityTabRect;
	source: "docked" | "floating";
	workspace: ActivityTabBounds;
}

export interface UseFloatingActivityTabsInput {
	allTabKeys: readonly ActivityTabKey[];
	mainTabListRef: RefObject<HTMLDivElement | null>;
	onActiveTabChange: (key: ActivityTabKey) => void;
	onTabOrderChange: (keys: ActivityTabKey[]) => void;
	panelRef: RefObject<HTMLDivElement | null>;
	panelWidth: number;
	scopeKey: string | null;
}

export interface FloatingActivityTabsModel {
	dockPreviewBounds: ActivityTabBounds | null;
	floatingKeys: ReadonlySet<ActivityTabKey>;
	floatingTabs: readonly FloatingActivityTabPlacement[];
}

export interface FloatingActivityTabsActions {
	clearFloatingTab: (key: ActivityTabKey) => void;
	onDockedTabDragEnd: (event: TabBarDragEvent<ActivityTabKey>) => boolean | undefined;
	onDockedTabDragMove: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onDockedTabDragStart: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onFloatingResize: (key: ActivityTabKey, delta: ActivityTabPoint) => void;
	onFloatingResizeEnd: (key: ActivityTabKey) => void;
	onFloatingTabDragEnd: (event: TabBarDragEvent<ActivityTabKey>) => boolean | undefined;
	onFloatingTabDragMove: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onFloatingTabDragStart: (event: TabBarDragEvent<ActivityTabKey>) => void;
	onFloatingTabFocus: (key: ActivityTabKey) => void;
}

function toBounds(rect: DOMRect): ActivityTabBounds {
	return {
		bottom: rect.bottom,
		height: rect.height,
		left: rect.left,
		right: rect.right,
		top: rect.top,
		width: rect.width,
	};
}

function viewportBounds(): ActivityTabBounds {
	const width = document.documentElement.clientWidth || window.innerWidth;
	const height = document.documentElement.clientHeight || window.innerHeight;
	return { left: 0, top: 0, right: width, bottom: height, width, height };
}

function placementRect(placement: FloatingActivityTabPlacement): FloatingActivityTabRect {
	return {
		x: placement.x,
		y: placement.y,
		width: placement.width,
		height: placement.height,
	};
}

export function useFloatingActivityTabs({
	allTabKeys,
	mainTabListRef,
	onActiveTabChange,
	onTabOrderChange,
	panelRef,
	panelWidth,
	scopeKey,
}: UseFloatingActivityTabsInput): {
	actions: FloatingActivityTabsActions;
	model: FloatingActivityTabsModel;
} {
	const projectKey = scopeKey ?? GLOBAL_ACTIVITY_SCOPE;
	const [tabsByProject, setTabsByProject] = useAtom(floatingActivityTabsByProjectAtom);
	const floatingTabs = tabsByProject.get(projectKey) ?? [];
	const floatingTabsRef = useRef(floatingTabs);
	floatingTabsRef.current = floatingTabs;
	const dragSessionRef = useRef<FloatingTabDragSession | null>(null);
	const resizeRectsRef = useRef(new Map<ActivityTabKey, FloatingActivityTabRect>());
	const [dockPreviewBounds, setDockPreviewBounds] = useState<ActivityTabBounds | null>(null);

	const updatePlacements = useCallback(
		(update: (current: FloatingActivityTabPlacement[]) => FloatingActivityTabPlacement[]): void => {
			setTabsByProject((current) => {
				const next = new Map(current);
				const updated = update(next.get(projectKey) ?? []);
				if (updated.length === 0) next.delete(projectKey);
				else next.set(projectKey, updated);
				return next;
			});
		},
		[projectKey, setTabsByProject],
	);

	const setPlacement = useCallback(
		(key: ActivityTabKey, rect: FloatingActivityTabRect, zIndex?: number): void => {
			updatePlacements((current) => {
				const existing = current.find((item) => item.key === key);
				const nextZIndex = zIndex ?? existing?.zIndex ?? 1;
				const placement = { key, ...rect, zIndex: nextZIndex };
				return existing ? current.map((item) => (item.key === key ? placement : item)) : [...current, placement];
			});
		},
		[updatePlacements],
	);

	const clearFloatingTab = useCallback(
		(key: ActivityTabKey): void => {
			updatePlacements((current) => current.filter((item) => item.key !== key));
		},
		[updatePlacements],
	);

	const onFloatingTabFocus = useCallback(
		(key: ActivityTabKey): void => {
			updatePlacements((current) => {
				const target = current.find((item) => item.key === key);
				if (!target) return current;
				const nextZIndex = Math.max(0, ...current.map((item) => item.zIndex)) + 1;
				if (target.zIndex === nextZIndex) return current;
				return current.map((item) => (item.key === key ? { ...item, zIndex: nextZIndex } : item));
			});
		},
		[updatePlacements],
	);

	const currentTabStripBounds = useCallback((): ActivityTabBounds | null => {
		const element = mainTabListRef.current;
		return element ? toBounds(element.getBoundingClientRect()) : null;
	}, [mainTabListRef]);

	const updateDockPreview = useCallback(
		(point: ActivityTabPoint): void => {
			const bounds = currentTabStripBounds();
			setDockPreviewBounds(bounds && isInsideTabStrip(point, bounds) ? bounds : null);
		},
		[currentTabStripBounds],
	);

	const onDockedTabDragStart = useCallback(
		(event: TabBarDragEvent<ActivityTabKey>): void => {
			const panel = panelRef.current;
			if (!panel) return;
			const panelBounds = toBounds(panel.getBoundingClientRect());
			dragSessionRef.current = {
				detached: false,
				initialPlacements: floatingTabsRef.current,
				key: event.key,
				offset: { x: 0, y: 0 },
				rect: {
					x: panelBounds.left,
					y: panelBounds.top,
					width: panelBounds.width || panelWidth,
					height: panelBounds.height,
				},
				source: "docked",
				workspace: viewportBounds(),
			};
		},
		[panelRef, panelWidth],
	);

	const onDockedTabDragMove = useCallback(
		(event: TabBarDragEvent<ActivityTabKey>): void => {
			const session = dragSessionRef.current;
			if (!session || session.source !== "docked") return;
			if (!session.detached) {
				if (!hasLeftTabStrip(event.point, event.bounds)) return;
				const created = createFloatingTabRect({
					panel: {
						left: session.rect.x,
						top: session.rect.y,
						right: session.rect.x + session.rect.width,
						bottom: session.rect.y + session.rect.height,
						width: session.rect.width,
						height: session.rect.height,
					},
					point: event.point,
					workspace: session.workspace,
					minWidth: ACTIVITY_PANEL_MIN_WIDTH,
				});
				session.detached = true;
				session.offset = created.offset;
				session.rect = created.rect;
				const nextZIndex = Math.max(0, ...floatingTabsRef.current.map((item) => item.zIndex)) + 1;
				setPlacement(event.key, created.rect, nextZIndex);
				const remaining = allTabKeys.filter(
					(key) => key !== event.key && !floatingTabsRef.current.some((item) => item.key === key),
				);
				if (remaining[0]) onActiveTabChange(remaining[0]);
			}
			const moved = moveFloatingTabRect(
				session.rect,
				event.point,
				session.offset,
				session.workspace,
				ACTIVITY_PANEL_MIN_WIDTH,
			);
			session.rect = moved;
			setPlacement(event.key, moved);
			updateDockPreview(event.point);
		},
		[allTabKeys, onActiveTabChange, setPlacement, updateDockPreview],
	);

	const dockTab = useCallback(
		(key: ActivityTabKey, point: ActivityTabPoint): void => {
			const currentFloatingKeys = new Set(floatingTabsRef.current.map((item) => item.key));
			currentFloatingKeys.delete(key);
			const dockedKeys = allTabKeys.filter((candidate) => !currentFloatingKeys.has(candidate) && candidate !== key);
			const centers = Array.from(mainTabListRef.current?.children ?? []).flatMap((child) => {
				if (!(child instanceof HTMLElement)) return [];
				const childKey = child.dataset.tabkey as ActivityTabKey | undefined;
				if (!childKey) return [];
				const bounds = child.getBoundingClientRect();
				return [{ key: childKey, centerX: (bounds.left + bounds.right) / 2 }];
			});
			const inserted = insertDockedTabAtPoint(dockedKeys, key, centers, point.x);
			const fullOrder = mergeDockedTabOrder(allTabKeys, currentFloatingKeys, inserted);
			clearFloatingTab(key);
			onTabOrderChange(fullOrder);
			onActiveTabChange(key);
		},
		[allTabKeys, clearFloatingTab, mainTabListRef, onActiveTabChange, onTabOrderChange],
	);

	const finishDrag = useCallback(
		(event: TabBarDragEvent<ActivityTabKey>): boolean | undefined => {
			const session = dragSessionRef.current;
			dragSessionRef.current = null;
			setDockPreviewBounds(null);
			if (!session) return;
			if (event.cancelled) {
				updatePlacements(() => session.initialPlacements);
				if (session.source === "docked" && session.detached) onActiveTabChange(session.key);
				return session.detached ? false : undefined;
			}
			const stripBounds = currentTabStripBounds();
			if (stripBounds && isInsideTabStrip(event.point, stripBounds)) {
				dockTab(session.key, event.point);
			}
			return session.detached ? false : undefined;
		},
		[currentTabStripBounds, dockTab, onActiveTabChange, updatePlacements],
	);

	const onFloatingTabDragStart = useCallback(
		(event: TabBarDragEvent<ActivityTabKey>): void => {
			const placement = floatingTabsRef.current.find((item) => item.key === event.key);
			if (!placement) return;
			onFloatingTabFocus(event.key);
			dragSessionRef.current = {
				detached: true,
				initialPlacements: floatingTabsRef.current,
				key: event.key,
				offset: { x: event.point.x - placement.x, y: event.point.y - placement.y },
				rect: placementRect(placement),
				source: "floating",
				workspace: viewportBounds(),
			};
		},
		[onFloatingTabFocus],
	);

	const onFloatingTabDragMove = useCallback(
		(event: TabBarDragEvent<ActivityTabKey>): void => {
			const session = dragSessionRef.current;
			if (!session || session.source !== "floating" || session.key !== event.key) return;
			const moved = moveFloatingTabRect(
				session.rect,
				event.point,
				session.offset,
				session.workspace,
				ACTIVITY_PANEL_MIN_WIDTH,
			);
			session.rect = moved;
			setPlacement(event.key, moved);
			updateDockPreview(event.point);
		},
		[setPlacement, updateDockPreview],
	);

	const onFloatingResize = useCallback(
		(key: ActivityTabKey, delta: ActivityTabPoint): void => {
			const placement = floatingTabsRef.current.find((item) => item.key === key);
			if (!placement) return;
			const next = resizeFloatingTabRect(
				resizeRectsRef.current.get(key) ?? placementRect(placement),
				delta,
				viewportBounds(),
				ACTIVITY_PANEL_MIN_WIDTH,
			);
			resizeRectsRef.current.set(key, next);
			setPlacement(key, next);
		},
		[setPlacement],
	);

	const onFloatingResizeEnd = useCallback((key: ActivityTabKey): void => {
		resizeRectsRef.current.delete(key);
	}, []);

	useEffect(() => {
		dragSessionRef.current = null;
		resizeRectsRef.current.clear();
		setDockPreviewBounds(null);
		const workspace = viewportBounds();
		updatePlacements((current) =>
			current.map((placement) => ({
				...placement,
				...clampFloatingTabRect(placementRect(placement), workspace, ACTIVITY_PANEL_MIN_WIDTH),
			})),
		);
	}, [updatePlacements]);

	useEffect(() => {
		const constrain = (): void => {
			const workspace = viewportBounds();
			updatePlacements((current) =>
				current.map((placement) => ({
					...placement,
					...clampFloatingTabRect(placementRect(placement), workspace, ACTIVITY_PANEL_MIN_WIDTH),
				})),
			);
		};
		window.addEventListener("resize", constrain);
		return () => window.removeEventListener("resize", constrain);
	}, [updatePlacements]);

	const floatingKeys = useMemo(() => new Set(floatingTabs.map((item) => item.key)), [floatingTabs]);

	return {
		actions: {
			clearFloatingTab,
			onDockedTabDragEnd: finishDrag,
			onDockedTabDragMove,
			onDockedTabDragStart,
			onFloatingResize,
			onFloatingResizeEnd,
			onFloatingTabDragEnd: finishDrag,
			onFloatingTabDragMove,
			onFloatingTabDragStart,
			onFloatingTabFocus,
		},
		model: {
			dockPreviewBounds,
			floatingKeys,
			floatingTabs,
		},
	};
}
