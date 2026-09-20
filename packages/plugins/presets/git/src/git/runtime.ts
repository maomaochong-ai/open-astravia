import type { PluginAiApi, PluginCommandApi, PluginFsApi, PluginOfficialApi, PluginStorageApi, PluginUiApi } from "@vetta-org/plugin-sdk";
import type { ChangeCode, TurnChangeDelta } from "./types";

/**
 * Module Federation may duplicate this module across remote/host boundaries, so
 * shared mutable runtime state hangs on globalThis (see the host's plugin notes
 * about MF module singletons). Holds the command API and a refresh signal bus.
 */
/** Resize the activity panel that hosts the Git tab (px or "max"). */
export type PanelResizer = (width: number | "max") => void;

/** Bring the Git tab to the front, opening the activity panel if it is closed. */
export type PanelOpener = () => void;

/** Agent turn lifecycle phase, surfaced from `ctx.conversation.on` to plugin components. */
export type TurnPhase = "start" | "end";

/**
 * Per-cwd turn-card state, persisted on the runtime so it survives session
 * switches and component remounts: `baseline` = git status before the current
 * turn (to diff against), `delta` = the last computed "this turn's changes" to
 * re-show when the user switches back to this conversation.
 */
interface TurnCardState {
	baseline: Map<string, ChangeCode> | null;
	delta: TurnChangeDelta | null;
}

interface GitRuntime {
	command: PluginCommandApi | null;
	fs: PluginFsApi | null;
	official: PluginOfficialApi | null;
	storage: PluginStorageApi | null;
	ai: PluginAiApi | null;
	ui: PluginUiApi | null;
	resizePanel: PanelResizer | null;
	openPanel: PanelOpener | null;
	refreshListeners: Set<() => void>;
	turnPhaseListeners: Set<(phase: TurnPhase) => void>;
	turnCardStates: Map<string, TurnCardState>;
	/** Tail of the serialized write chain (see {@link enqueueWrite}). */
	writeQueue: Promise<void>;
	/** Pending debounce timer for {@link emitRefreshSignal}. */
	refreshTimer: ReturnType<typeof setTimeout> | null;
	/** Subscribers to settings saves (see `settings.ts`). */
	settingsListeners: Set<(settings: unknown) => void>;
	/** Subscribers to "the user asked to commit now" requests from the turn card. */
	commitRequestListeners: Set<(root: string) => void>;
	/** cwds whose tab this session already auto-attached (see {@link claimTabAttach}). */
	attachedCwds: Set<string>;
}

const KEY = "__vettaGitPluginRuntime__";

function runtime(): GitRuntime {
	const g = globalThis as Record<string, unknown>;
	if (!g[KEY]) {
		g[KEY] = {
			command: null,
			fs: null,
			official: null,
			storage: null,
			ai: null,
			ui: null,
			resizePanel: null,
			openPanel: null,
			refreshListeners: new Set<() => void>(),
			turnPhaseListeners: new Set<(phase: TurnPhase) => void>(),
			turnCardStates: new Map<string, TurnCardState>(),
			writeQueue: Promise.resolve(),
			refreshTimer: null,
			settingsListeners: new Set<(settings: unknown) => void>(),
			commitRequestListeners: new Set<(root: string) => void>(),
			attachedCwds: new Set<string>(),
		} satisfies GitRuntime;
	}
	return g[KEY] as GitRuntime;
}

/**
 * Serialize a git *write* (add / restore / commit / checkout / push …) against
 * every other write in this process.
 *
 * Git takes `.git/index.lock` for any index-touching command and fails outright
 * when it is already held, so two concurrent writes are not slow — the loser
 * errors. Staging is click-frequency (unlike the old push/pull-only toolbar),
 * and the agent may be running git in the same repo, so writes queue here while
 * reads (status / diff) stay parallel and unthrottled.
 */
export function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const rt = runtime();
	// Run `task` whether the previous write resolved or rejected — one failure
	// must not wedge the queue.
	const result = rt.writeQueue.then(task, task);
	rt.writeQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function turnCardState(cwd: string): TurnCardState {
	const states = runtime().turnCardStates;
	let state = states.get(cwd);
	if (!state) {
		state = { baseline: null, delta: null };
		states.set(cwd, state);
	}
	return state;
}

/** Read the persisted pre-turn baseline for a cwd (null = not yet established). */
export function getTurnBaseline(cwd: string): Map<string, ChangeCode> | null {
	return turnCardState(cwd).baseline;
}

export function setTurnBaseline(cwd: string, baseline: Map<string, ChangeCode> | null): void {
	turnCardState(cwd).baseline = baseline;
}

/** Read the persisted last-turn change delta for a cwd (re-shown on session switch-back). */
export function getTurnDelta(cwd: string): TurnChangeDelta | null {
	return turnCardState(cwd).delta;
}

export function setTurnDelta(cwd: string, delta: TurnChangeDelta | null): void {
	turnCardState(cwd).delta = delta;
}

export function setGitCommand(api: PluginCommandApi): void {
	runtime().command = api;
}

export function getGitCommand(): PluginCommandApi {
	const api = runtime().command;
	if (!api) throw new Error("Git plugin command API not initialized");
	return api;
}

export function setFsApi(api: PluginFsApi): void {
	runtime().fs = api;
}

export function getFsApi(): PluginFsApi {
	const api = runtime().fs;
	if (!api) throw new Error("Git plugin fs API not initialized");
	return api;
}

export function setStorageApi(api: PluginStorageApi): void {
	runtime().storage = api;
}

export function getStorageApi(): PluginStorageApi {
	const api = runtime().storage;
	if (!api) throw new Error("Git plugin storage API not initialized");
	return api;
}

export function setAiApi(api: PluginAiApi): void {
	runtime().ai = api;
}

export function getAiApi(): PluginAiApi {
	const api = runtime().ai;
	if (!api) throw new Error("Git plugin ai API not initialized");
	return api;
}

export function setUiApi(api: PluginUiApi): void {
	runtime().ui = api;
}

/**
 * Surface a failure as a host toast.
 *
 * Errors used to be drawn inside the panel, which cost permanent layout to a
 * transient event and gave the user no way to copy a hook's output. The host
 * toast formats the cause, adds a "copy stack" action and stays until dismissed.
 */
export function notifyError(message: string, error?: unknown): void {
	const ui = runtime().ui;
	if (!ui) return;
	ui.notify({ message, error, variant: "error" });
}

export function setOfficialApi(api: PluginOfficialApi): void {
	runtime().official = api;
}

export function getOfficialApi(): PluginOfficialApi {
	const api = runtime().official;
	if (!api) throw new Error("Git plugin official API not initialized");
	return api;
}

/**
 * Settings-change bus. Lives on the runtime for the same reason the rest does:
 * Module Federation may hand the settings page and the panel different copies of
 * a module, and a module-scoped Set would then never reach the other side.
 */
export function settingsListeners(): Set<(settings: unknown) => void> {
	return runtime().settingsListeners;
}

/**
 * Claim the one automatic tab attach allowed per cwd in this session.
 *
 * Returns false once the cwd has been claimed, so switching conversations back
 * and forth does not keep re-attaching a tab the user has since closed — the
 * host records a manual close as an explicit "hidden" entry, and the plugin has
 * no way to read it back.
 */
export function claimTabAttach(cwd: string): boolean {
	const set = runtime().attachedCwds;
	if (set.has(cwd)) return false;
	set.add(cwd);
	return true;
}

/** Register the host-backed panel resizer (wired in activate from ctx.ui). */
export function setPanelResizer(resize: PanelResizer): void {
	runtime().resizePanel = resize;
}

/** Resize the activity panel (no-op until the resizer is registered). */
export function resizePanel(width: number | "max"): void {
	runtime().resizePanel?.(width);
}

export function setPanelOpener(open: PanelOpener): void {
	runtime().openPanel = open;
}

/**
 * Open the Git tab. Surfaces outside the panel (the turn card) must use this
 * rather than {@link resizePanel}: widening a panel that is showing some other
 * tab — or is closed — leaves the user staring at the wrong thing.
 */
export function openPanel(): void {
	runtime().openPanel?.();
}

/** Subscribe a panel to global refresh signals (turn-end, etc). Returns unsubscribe. */
export function onRefreshSignal(listener: () => void): () => void {
	const set = runtime().refreshListeners;
	set.add(listener);
	return () => set.delete(listener);
}

/** Debounce window for refresh signals: long enough to collapse a burst of writes. */
const REFRESH_DEBOUNCE_MS = 150;

/**
 * Fire a refresh signal to all mounted panels, coalescing bursts.
 *
 * A batch action (stage 12 files, commit-then-push) emits one signal per step,
 * and each signal costs every panel a full `git status` + diff-stat sweep. The
 * debounce turns the burst into a single reload once the dust settles.
 */
export function emitRefreshSignal(): void {
	const rt = runtime();
	if (rt.refreshTimer !== null) clearTimeout(rt.refreshTimer);
	rt.refreshTimer = setTimeout(() => {
		rt.refreshTimer = null;
		for (const listener of rt.refreshListeners) listener();
	}, REFRESH_DEBOUNCE_MS);
}

/**
 * Subscribe to agent turn lifecycle phases (start / end). The turn card uses
 * this to snapshot a baseline at turn-start and diff against it at turn-end so
 * it shows only THIS turn's changes (not all pre-existing uncommitted files).
 */
export function onTurnPhase(listener: (phase: TurnPhase) => void): () => void {
	const set = runtime().turnPhaseListeners;
	set.add(listener);
	return () => set.delete(listener);
}

/**
 * Subscribe to commit requests raised elsewhere (the turn card's "commit this
 * turn"), so the commit box can take focus and draft a message for them.
 */
export function onCommitRequest(listener: (root: string) => void): () => void {
	const set = runtime().commitRequestListeners;
	set.add(listener);
	return () => set.delete(listener);
}

/** Ask the commit box for `root` to take over (it is the one that owns drafting). */
export function requestCommit(root: string): void {
	for (const listener of runtime().commitRequestListeners) listener(root);
}

/** Fire a turn lifecycle phase to subscribers. */
export function emitTurnPhase(phase: TurnPhase): void {
	for (const listener of runtime().turnPhaseListeners) listener(phase);
}
