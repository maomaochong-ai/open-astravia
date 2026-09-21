/**
 * [PERF-message-scroll] Long-conversation scrolling diagnostics.
 *
 * Enable in Renderer DevTools and reload:
 *   localStorage.setItem("vetta-perf-message-scroll", "1"); location.reload()
 * Disable:
 *   localStorage.removeItem("vetta-perf-message-scroll")
 * Read the latest report after a gesture:
 *   JSON.parse(sessionStorage.getItem("vetta-perf-message-scroll:last-report") ?? "null")
 *
 * Each scroll gesture is reported after it has been idle for 1.5 seconds. Reports contain
 * indices, dimensions and timings only; message contents, ids and session paths are excluded.
 */

import type { ListItem, ListRange } from "react-virtuoso";

const ENABLED_KEY = "vetta-perf-message-scroll";
const LAST_REPORT_KEY = "vetta-perf-message-scroll:last-report";
const IDLE_REPORT_DELAY_MS = 1_500;
const MAX_EVENTS = 2_500;
const LARGE_HEIGHT_CORRECTION_PX = 48;

type ScrollTrigger = "wheel" | "scroll";

type DiagnosticEvent =
	| { readonly at: number; readonly type: "wheel"; readonly deltaY: number }
	| { readonly at: number; readonly type: "scroll"; readonly scrollTop: number }
	| {
			readonly at: number;
			readonly type: "range";
			readonly startIndex: number;
			readonly endIndex: number;
	  }
	| {
			readonly at: number;
			readonly type: "rendered";
			readonly startIndex: number;
			readonly endIndex: number;
			readonly totalSize: number;
	  }
	| { readonly at: number; readonly type: "total-height"; readonly height: number; readonly delta: number }
	| {
			readonly at: number;
			readonly type: "item-size";
			readonly index: number;
			readonly estimated: number;
			readonly measured: number;
			readonly correction: number;
	  }
	| {
			readonly at: number;
			readonly type: "react-commit";
			readonly id: string;
			readonly phase: "mount" | "update" | "nested-update";
			readonly actualDuration: number;
	  }
	| { readonly at: number; readonly type: "long-task"; readonly duration: number }
	| {
			readonly at: number;
			readonly type: "layout-shift";
			readonly value: number;
			readonly hadRecentInput: boolean;
	  };

interface LayoutShiftPerformanceEntry extends PerformanceEntry {
	readonly value: number;
	readonly hadRecentInput: boolean;
}

interface MessageScrollTrace {
	readonly startedAt: number;
	readonly trigger: ScrollTrigger;
	readonly events: DiagnosticEvent[];
	readonly observers: PerformanceObserver[];
	readonly measuredSizes: Map<number, number>;
	lastActivityAt: number;
	lastScrollTop?: number;
	lastRange?: string;
	lastRenderedRange?: string;
	lastTotalHeight?: number;
	droppedEvents: number;
	timer?: number;
	scrollFrame?: number;
	pendingScrollTop?: number;
}

let activeTrace: MessageScrollTrace | null = null;

function now(): number {
	return performance.now();
}

export function perfMessageScrollEnabled(): boolean {
	try {
		return window.localStorage.getItem(ENABLED_KEY) === "1";
	} catch {
		return false;
	}
}

function addEvent(trace: MessageScrollTrace, event: DiagnosticEvent): void {
	if (trace.events.length >= MAX_EVENTS) {
		trace.droppedEvents += 1;
		return;
	}
	trace.events.push(event);
}

function mark(label: string, properties: ReadonlyArray<readonly [string, string]>): void {
	try {
		performance.mark(`message-scroll:${label}`, {
			detail: {
				devtools: {
					dataType: "marker",
					color: "primary",
					properties,
					tooltipText: label,
				},
			},
		});
	} catch {
		// Older Chromium/test environments can omit User Timing detail support.
	}
}

function observe(trace: MessageScrollTrace, entryType: "longtask" | "layout-shift"): void {
	try {
		const observer = new PerformanceObserver((list) => {
			if (activeTrace !== trace) return;
			for (const entry of list.getEntries()) {
				if (entryType === "longtask") {
					addEvent(trace, {
						at: entry.startTime,
						type: "long-task",
						duration: entry.duration,
					});
				} else {
					const shift = entry as LayoutShiftPerformanceEntry;
					addEvent(trace, {
						at: entry.startTime,
						type: "layout-shift",
						value: shift.value,
						hadRecentInput: shift.hadRecentInput,
					});
				}
			}
		});
		observer.observe({ type: entryType, buffered: false });
		trace.observers.push(observer);
	} catch {
		// Unsupported observer types must not affect the scroll path.
	}
}

function begin(trigger: ScrollTrigger): MessageScrollTrace {
	if (activeTrace) return activeTrace;
	const startedAt = now();
	const trace: MessageScrollTrace = {
		startedAt,
		trigger,
		events: [],
		observers: [],
		measuredSizes: new Map(),
		lastActivityAt: startedAt,
		droppedEvents: 0,
	};
	activeTrace = trace;
	observe(trace, "longtask");
	observe(trace, "layout-shift");
	mark("begin", [["Trigger", trigger]]);
	return trace;
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function scheduleReport(trace: MessageScrollTrace): void {
	if (trace.timer !== undefined) window.clearTimeout(trace.timer);
	trace.timer = window.setTimeout(() => {
		const remaining = IDLE_REPORT_DELAY_MS - (now() - trace.lastActivityAt);
		if (remaining > 0) {
			trace.timer = window.setTimeout(() => report(trace), remaining);
			return;
		}
		report(trace);
	}, IDLE_REPORT_DELAY_MS);
}

function report(trace: MessageScrollTrace): void {
	if (activeTrace !== trace) return;
	activeTrace = null;
	if (trace.timer !== undefined) window.clearTimeout(trace.timer);
	if (trace.scrollFrame !== undefined) cancelAnimationFrame(trace.scrollFrame);
	for (const observer of trace.observers) observer.disconnect();

	const commits = trace.events.filter((event) => event.type === "react-commit");
	const corrections = trace.events.filter((event) => event.type === "item-size");
	const longTasks = trace.events.filter((event) => event.type === "long-task");
	const shifts = trace.events.filter((event) => event.type === "layout-shift");
	const relativeEvents = trace.events.map(({ at, ...event }) => ({
		...event,
		atMs: round(Math.max(0, at - trace.startedAt)),
	}));
	const payload = {
		version: 2,
		trigger: trace.trigger,
		durationMs: round(now() - trace.startedAt),
		summary: {
			wheelEvents: trace.events.filter((event) => event.type === "wheel").length,
			scrollSamples: trace.events.filter((event) => event.type === "scroll").length,
			rangeChanges: trace.events.filter((event) => event.type === "range").length,
			renderedRangeChanges: trace.events.filter((event) => event.type === "rendered").length,
			totalHeightChanges: trace.events.filter((event) => event.type === "total-height").length,
			itemSizeCorrections: corrections.length,
			largeItemSizeCorrections: corrections.filter(
				(event) => Math.abs(event.correction) >= LARGE_HEIGHT_CORRECTION_PX,
			).length,
			absoluteHeightCorrectionPx: round(corrections.reduce((total, event) => total + Math.abs(event.correction), 0)),
			reactCommits: commits.length,
			reactCommitTotalMs: round(commits.reduce((total, event) => total + event.actualDuration, 0)),
			reactCommitMaxMs: round(Math.max(0, ...commits.map((event) => event.actualDuration))),
			longTasks: longTasks.length,
			longTaskTotalMs: round(longTasks.reduce((total, event) => total + event.duration, 0)),
			layoutShifts: shifts.length,
			layoutShiftScore: round(shifts.reduce((total, event) => total + event.value, 0)),
		},
		droppedEvents: trace.droppedEvents,
		events: relativeEvents,
	};
	mark("report", [
		["Duration", `${payload.durationMs}ms`],
		["Height corrections", `${payload.summary.itemSizeCorrections}`],
	]);
	try {
		window.sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify(payload));
	} catch {
		// Diagnostics must not affect scrolling when storage is unavailable or full.
	}
	console.info(`[PERF-message-scroll] ${JSON.stringify(payload)}`);
}

export function perfMessageScrollAttach(scroller: HTMLElement): () => void {
	if (!perfMessageScrollEnabled()) return () => undefined;

	const onWheel = (event: WheelEvent): void => {
		const trace = begin("wheel");
		const at = now();
		trace.lastActivityAt = at;
		addEvent(trace, { at, type: "wheel", deltaY: round(event.deltaY) });
		scheduleReport(trace);
	};
	const onScroll = (): void => {
		const trace = begin("scroll");
		trace.lastActivityAt = now();
		trace.pendingScrollTop = scroller.scrollTop;
		if (trace.scrollFrame === undefined) {
			trace.scrollFrame = requestAnimationFrame(() => {
				trace.scrollFrame = undefined;
				const scrollTop = trace.pendingScrollTop;
				if (scrollTop === undefined || scrollTop === trace.lastScrollTop) return;
				trace.lastScrollTop = scrollTop;
				addEvent(trace, { at: now(), type: "scroll", scrollTop: round(scrollTop) });
			});
		}
		scheduleReport(trace);
	};

	scroller.addEventListener("wheel", onWheel, { capture: true, passive: true });
	scroller.addEventListener("scroll", onScroll, { capture: true, passive: true });
	return () => {
		scroller.removeEventListener("wheel", onWheel, true);
		scroller.removeEventListener("scroll", onScroll, true);
	};
}

function currentTrace(): MessageScrollTrace | null {
	return activeTrace;
}

export function perfMessageScrollRecordRange(range: ListRange): void {
	const trace = currentTrace();
	if (!trace) return;
	const signature = `${range.startIndex}:${range.endIndex}`;
	if (trace.lastRange === signature) return;
	trace.lastRange = signature;
	addEvent(trace, { at: now(), type: "range", ...range });
}

export function perfMessageScrollRecordRenderedItems<T>(items: ListItem<T>[]): void {
	const trace = currentTrace();
	const first = items.at(0);
	const last = items.at(-1);
	if (!trace || !first || !last) return;
	const signature = `${first.index}:${last.index}:${items.map((item) => item.size).join(",")}`;
	if (trace.lastRenderedRange === signature) return;
	trace.lastRenderedRange = signature;
	addEvent(trace, {
		at: now(),
		type: "rendered",
		startIndex: first.index,
		endIndex: last.index,
		totalSize: round(items.reduce((total, item) => total + item.size, 0)),
	});
}

export function perfMessageScrollRecordTotalHeight(height: number): void {
	const trace = currentTrace();
	if (!trace || trace.lastTotalHeight === height) return;
	const previous = trace.lastTotalHeight;
	trace.lastTotalHeight = height;
	addEvent(trace, {
		at: now(),
		type: "total-height",
		height: round(height),
		delta: round(previous === undefined ? 0 : height - previous),
	});
}

export function perfMessageScrollRecordItemSize(index: number, estimated: number, measured: number): void {
	const trace = currentTrace();
	if (!trace || !Number.isInteger(index) || measured <= 0) return;
	if (trace.measuredSizes.get(index) === measured) return;
	trace.measuredSizes.set(index, measured);
	const correction = measured - estimated;
	addEvent(trace, {
		at: now(),
		type: "item-size",
		index,
		estimated: round(estimated),
		measured: round(measured),
		correction: round(correction),
	});
	if (Math.abs(correction) >= LARGE_HEIGHT_CORRECTION_PX) {
		mark("height-correction", [
			["Index", `${index}`],
			["Estimate", `${round(estimated)}`],
			["Measured", `${round(measured)}`],
		]);
	}
}

export function perfMessageScrollRecordReactCommit(
	id: string,
	phase: "mount" | "update" | "nested-update",
	actualDuration: number,
): void {
	const trace = currentTrace();
	if (!trace) return;
	addEvent(trace, { at: now(), type: "react-commit", id, phase, actualDuration: round(actualDuration) });
}
