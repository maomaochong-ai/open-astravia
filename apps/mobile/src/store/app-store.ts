import {
	type RemoteEvent,
	type RemoteQuestionAnswer,
	type RemoteSessionSummary,
	randomToken,
	readMessageEvent,
	readQuestionRequest,
	readSessionState,
	readSessionSummaries,
	readToolEvent,
} from "@vetta/remote-control";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { create } from "zustand";
import { t } from "../i18n/strings";
import type { SessionCache } from "../remote/cache";
import { MemorySessionCache } from "../remote/cache";
import { ChannelManager, LinkOfflineError } from "../remote/channel-manager";
import { PairingFlow, type PairingPhase } from "../remote/pairing-flow";
import { MemoryKeyValueStore, PairingStore } from "../remote/pairing-store";
import {
	emptyTranscript,
	isActiveStatus,
	reduceTranscript,
	type TranscriptAction,
	type TranscriptState,
} from "../remote/transcript";
import type { DesktopRecord, KeyValueStore, LinkIdentity, LinkSnapshot, TransportFactory } from "../remote/types";

export type ThemePreference = "dark" | "light";
export type ConfirmPolicy = "major" | "important" | "auto";

export interface Preferences {
	readonly theme: ThemePreference;
	readonly liveThinking: boolean;
	readonly haptics: boolean;
	readonly confirmPolicy: ConfirmPolicy;
}

const DEFAULT_PREFERENCES: Preferences = {
	theme: "dark",
	liveThinking: true,
	haptics: true,
	confirmPolicy: "important",
};
const PREFS_KEY = "vetta.preferences";

export interface AppPlatform {
	readonly settings: KeyValueStore;
	readonly secrets: KeyValueStore;
	readonly cache: SessionCache;
	readonly createTransport: TransportFactory;
	readonly deviceName: string;
	readonly loadDeviceId: (settings: KeyValueStore) => Promise<string>;
	readonly onTurnEnd?: () => void;
	readonly applyTheme?: (theme: ThemePreference) => void;
}

export interface AppStoreState {
	readonly ready: boolean;
	readonly paired: boolean;
	readonly desktop?: Omit<DesktopRecord, "mobileSecret">;
	readonly link: LinkSnapshot;
	readonly sessions: readonly RemoteSessionSummary[];
	readonly sessionsLoaded: boolean;
	readonly transcripts: Readonly<Record<string, TranscriptState>>;
	readonly preferences: Preferences;
	readonly pairing: PairingPhase;
	readonly lastError?: string;
}

export interface AppStoreActions {
	init(platform: AppPlatform): Promise<void>;
	pairWithCode(text: string): Promise<boolean>;
	pairManually(endpoint: string): Promise<boolean>;
	cancelPairing(): Promise<void>;
	unpair(): Promise<void>;
	refreshSessions(): Promise<void>;
	openSession(sessionId: string): Promise<void>;
	sendPrompt(sessionId: string | undefined, text: string): Promise<string | undefined>;
	respond(
		sessionId: string,
		requestId: string,
		answers: readonly RemoteQuestionAnswer[],
		cancelled?: boolean,
	): Promise<void>;
	abort(sessionId: string): Promise<void>;
	resync(sessionId: string): Promise<void>;
	setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void>;
	refreshLink(): void;
	clearError(): void;
}

export type AppStore = AppStoreState & AppStoreActions;

const OFFLINE_LINK: LinkSnapshot = { status: "offline", channel: null, peerOnline: false, reconnectAttempt: 0 };

interface Runtime {
	platform: AppPlatform;
	pairingStore: PairingStore;
	identity: LinkIdentity;
	manager?: ChannelManager;
	desktopKey?: string;
	flow?: PairingFlow;
	unsubscribe: (() => void)[];
	transcriptSave: Map<string, ReturnType<typeof setTimeout>>;
	appState: AppStateStatus;
}

let runtime: Runtime | undefined;

export const useAppStore = create<AppStore>((set, get) => {
	const dispatch = (sessionId: string, action: TranscriptAction) => {
		const current = get().transcripts[sessionId] ?? emptyTranscript;
		const next = reduceTranscript(current, action);
		set((state) => ({ transcripts: { ...state.transcripts, [sessionId]: next } }));
		scheduleTranscriptSave(sessionId, next);
	};

	const scheduleTranscriptSave = (sessionId: string, transcript: TranscriptState) => {
		if (!runtime?.desktopKey || transcript.stale || !transcript.loaded) return;
		const existing = runtime.transcriptSave.get(sessionId);
		if (existing) clearTimeout(existing);
		const desktopKey = runtime.desktopKey;
		runtime.transcriptSave.set(
			sessionId,
			setTimeout(() => {
				runtime?.transcriptSave.delete(sessionId);
				void runtime?.platform.cache.saveTranscript(desktopKey, sessionId, transcript.items).catch(() => undefined);
			}, 400),
		);
	};

	const patchSession = (sessionId: string, patch: Partial<RemoteSessionSummary>) => {
		set((state) => {
			const sessions = state.sessions.map((session) =>
				session.id === sessionId ? { ...session, ...patch } : session,
			);
			return { sessions };
		});
	};

	const handleEvent = (event: RemoteEvent) => {
		const sessionId = event.sessionId;
		switch (event.name) {
			case "session.list": {
				const sessions = readSessionSummaries(event.payload);
				set({ sessions, sessionsLoaded: true });
				if (runtime?.desktopKey)
					void runtime.platform.cache.saveSessions(runtime.desktopKey, sessions).catch(() => undefined);
				return;
			}
			case "session.state": {
				if (!sessionId) return;
				const state = readSessionState(event.payload);
				dispatch(sessionId, { type: "state", state });
				patchSession(sessionId, { status: state.status, updatedAt: Date.now() });
				return;
			}
			case "session.message": {
				if (!sessionId) return;
				const message = readMessageEvent(event.payload);
				if (!message) return;
				if (message.kind === "thinking_delta" && !get().preferences.liveThinking) return;
				dispatch(sessionId, { type: "message", event: message });
				if (message.kind === "turn_end" && get().preferences.haptics && runtime?.appState === "active") {
					runtime.platform.onTurnEnd?.();
				}
				if (message.kind === "user") patchSession(sessionId, { preview: message.text, updatedAt: message.at });
				return;
			}
			case "session.tool": {
				if (!sessionId) return;
				const tool = readToolEvent(event.payload);
				if (tool) dispatch(sessionId, { type: "tool", event: tool });
				return;
			}
			case "session.input": {
				if (!sessionId) return;
				const payload = event.payload as { kind?: string; request?: unknown; requestId?: string } | undefined;
				if (payload?.kind === "question") {
					const request = readQuestionRequest(payload.request);
					if (request) {
						dispatch(sessionId, { type: "question", request });
						patchSession(sessionId, { status: "waiting_input", updatedAt: Date.now() });
					}
				} else if (payload?.kind === "resolved" && typeof payload.requestId === "string") {
					dispatch(sessionId, { type: "question-resolved", requestId: payload.requestId });
				}
				return;
			}
			case "session.resync": {
				set((state) => ({
					transcripts: Object.fromEntries(
						Object.entries(state.transcripts).map(([id, transcript]) => [
							id,
							reduceTranscript(transcript, { type: "resync" }),
						]),
					),
				}));
				void get().refreshSessions();
				return;
			}
			default:
				return;
		}
	};

	const attachManager = async (record: DesktopRecord) => {
		if (!runtime) return;
		await detachManager();
		const desktopKey = record.desktopIdentityKey;
		runtime.desktopKey = desktopKey;
		const cached = await runtime.platform.cache.loadSessions(desktopKey).catch(() => []);
		set({
			paired: true,
			desktop: stripSecret(record),
			sessions: cached,
			sessionsLoaded: cached.length > 0,
			transcripts: {},
			link: OFFLINE_LINK,
		});
		const manager = new ChannelManager({
			desktop: record,
			link: runtime.identity,
			createTransport: runtime.platform.createTransport,
			onSequence: (sequence) =>
				void runtime?.pairingStore.update(desktopKey, { lastEventSequence: sequence, lastSeenAt: Date.now() }),
			onLanEndpoints: (endpoints) => void runtime?.pairingStore.update(desktopKey, { lanEndpoints: [...endpoints] }),
		});
		runtime.manager = manager;
		runtime.unsubscribe.push(
			manager.subscribe((link) => {
				const wasOnline = get().link.status === "online" && get().link.peerOnline;
				set({ link });
				if (!wasOnline && link.status === "online" && link.peerOnline) void get().refreshSessions();
			}),
			manager.onEvent(handleEvent),
		);
		manager.setForeground(runtime.appState === "active");
		manager.start();
	};

	const detachManager = async () => {
		if (!runtime) return;
		for (const off of runtime.unsubscribe.splice(0)) off();
		const manager = runtime.manager;
		runtime.manager = undefined;
		if (manager) await manager.stop();
	};

	const requireManager = (): ChannelManager => {
		const manager = runtime?.manager;
		if (!manager) throw new LinkOfflineError();
		return manager;
	};

	const reportError = (error: unknown) => {
		const message = error instanceof LinkOfflineError ? t.common.notConnected : t.common.unknownError;
		set({ lastError: message });
	};

	return {
		ready: false,
		paired: false,
		link: OFFLINE_LINK,
		sessions: [],
		sessionsLoaded: false,
		transcripts: {},
		preferences: DEFAULT_PREFERENCES,
		pairing: { kind: "idle" },

		async init(platform) {
			if (runtime) return;
			const pairingStore = new PairingStore({ settings: platform.settings, secrets: platform.secrets });
			await pairingStore.load();
			const deviceId = await platform.loadDeviceId(platform.settings);
			runtime = {
				platform,
				pairingStore,
				identity: { identity: pairingStore.getIdentity(), deviceId, deviceName: platform.deviceName },
				unsubscribe: [],
				transcriptSave: new Map(),
				appState: AppState.currentState ?? "active",
			};
			const preferences = await loadPreferences(platform.settings);
			set({ preferences });
			platform.applyTheme?.(preferences.theme);
			AppState.addEventListener("change", (status) => {
				if (!runtime) return;
				const wasActive = runtime.appState === "active";
				runtime.appState = status;
				runtime.manager?.setForeground(status === "active");
				if (status === "active" && !wasActive) runtime.manager?.refresh();
			});
			const current = await pairingStore.getCurrent();
			if (current) await attachManager(current);
			set({ ready: true });
		},

		async pairWithCode(text) {
			if (!runtime) return false;
			await runtime.flow?.cancel();
			const flow = new PairingFlow({
				link: runtime.identity,
				createTransport: runtime.platform.createTransport,
				onPhase: (pairing) => set({ pairing }),
			});
			runtime.flow = flow;
			const record = await flow.pairWithCode(text);
			if (!record) return false;
			await runtime.pairingStore.save(record);
			await attachManager(record);
			set({ pairing: { kind: "idle" } });
			return true;
		},

		async pairManually(endpoint) {
			if (!runtime) return false;
			await runtime.flow?.cancel();
			const flow = new PairingFlow({
				link: runtime.identity,
				createTransport: runtime.platform.createTransport,
				onPhase: (pairing) => set({ pairing }),
			});
			runtime.flow = flow;
			const record = await flow.pairManually(endpoint);
			if (!record) return false;
			await runtime.pairingStore.save(record);
			await attachManager(record);
			set({ pairing: { kind: "idle" } });
			return true;
		},

		async cancelPairing() {
			await runtime?.flow?.cancel();
			if (runtime) runtime.flow = undefined;
			set({ pairing: { kind: "idle" } });
		},

		async unpair() {
			if (!runtime) return;
			const key = runtime.desktopKey;
			await detachManager();
			if (key) {
				await runtime.pairingStore.revoke(key);
				await runtime.platform.cache.clearDesktop(key).catch(() => undefined);
			}
			runtime.desktopKey = undefined;
			set({
				paired: false,
				desktop: undefined,
				sessions: [],
				sessionsLoaded: false,
				transcripts: {},
				link: OFFLINE_LINK,
			});
		},

		async refreshSessions() {
			try {
				const result = await requireManager().request("session.list", { limit: 200 });
				const sessions = readSessionSummaries(result);
				set({ sessions, sessionsLoaded: true });
				if (runtime?.desktopKey)
					await runtime.platform.cache.saveSessions(runtime.desktopKey, sessions).catch(() => undefined);
			} catch (error) {
				if (!(error instanceof LinkOfflineError)) reportError(error);
			}
		},

		async openSession(sessionId) {
			const existing = get().transcripts[sessionId];
			if (!existing && runtime?.desktopKey) {
				const cached = await runtime.platform.cache
					.loadTranscript(runtime.desktopKey, sessionId)
					.catch(() => undefined);
				if (cached) {
					set((state) => ({
						transcripts: {
							...state.transcripts,
							[sessionId]: { ...emptyTranscript, items: cached, loaded: true, stale: true },
						},
					}));
				}
			}
			try {
				const manager = requireManager();
				const opened = await manager.request("session.open", undefined, sessionId);
				const history = await manager.request("session.history", undefined, sessionId);
				const entries = history.entries;
				const state = readSessionState(history.state ?? opened.state);
				dispatch(sessionId, { type: "history", entries, state });
				patchSession(sessionId, { status: state.status, live: true });
			} catch (error) {
				if (!(error instanceof LinkOfflineError)) reportError(error);
			}
		},

		async sendPrompt(sessionId, text) {
			const trimmed = text.trim();
			if (!trimmed) return sessionId;
			try {
				const manager = requireManager();
				let target = sessionId;
				if (!target) {
					const created = await manager.request("session.create", undefined);
					target = created.session.id;
					set((state) => ({
						sessions: [created.session, ...state.sessions.filter((session) => session.id !== target)],
					}));
					dispatch(target, { type: "history", entries: [], state: { status: "idle" } });
				}
				dispatch(target, { type: "local-user", text: trimmed, at: Date.now() });
				dispatch(target, { type: "state", state: { status: "running" } });
				patchSession(target, {
					status: "running",
					preview: trimmed,
					updatedAt: Date.now(),
					title: currentTitle(get().sessions, target, trimmed),
				});
				await manager.request("session.prompt", { text: trimmed }, target);
				return target;
			} catch (error) {
				reportError(error);
				return sessionId;
			}
		},

		async respond(sessionId, requestId, answers, cancelled = false) {
			try {
				await requireManager().request("session.respond", { requestId, cancelled, answers }, sessionId);
				dispatch(sessionId, { type: "question-resolved", requestId });
				patchSession(sessionId, { status: "running" });
			} catch (error) {
				reportError(error);
			}
		},

		async abort(sessionId) {
			try {
				await requireManager().request("session.abort", undefined, sessionId);
			} catch (error) {
				reportError(error);
			}
		},

		async resync(sessionId) {
			dispatch(sessionId, { type: "resync" });
			await get().openSession(sessionId);
			await get().refreshSessions();
		},

		async setPreference(key, value) {
			const preferences = { ...get().preferences, [key]: value };
			set({ preferences });
			if (key === "theme") runtime?.platform.applyTheme?.(preferences.theme);
			await runtime?.platform.settings.set(PREFS_KEY, JSON.stringify(preferences)).catch(() => undefined);
		},

		refreshLink() {
			runtime?.manager?.refresh();
		},

		clearError() {
			set({ lastError: undefined });
		},
	};
});

function stripSecret(record: DesktopRecord): Omit<DesktopRecord, "mobileSecret"> {
	const { mobileSecret: _secret, ...rest } = record;
	return rest;
}

function currentTitle(sessions: readonly RemoteSessionSummary[], sessionId: string, fallback: string): string {
	const existing = sessions.find((session) => session.id === sessionId)?.title;
	return existing && existing.trim().length > 0 ? existing : fallback.slice(0, 60);
}

async function loadPreferences(settings: KeyValueStore): Promise<Preferences> {
	try {
		const raw = await settings.get(PREFS_KEY);
		if (!raw) return DEFAULT_PREFERENCES;
		const parsed = JSON.parse(raw) as Partial<Preferences>;
		return {
			theme: parsed.theme === "light" ? "light" : "dark",
			liveThinking: parsed.liveThinking !== false,
			haptics: parsed.haptics !== false,
			confirmPolicy:
				parsed.confirmPolicy === "major" || parsed.confirmPolicy === "auto" ? parsed.confirmPolicy : "important",
		};
	} catch {
		return DEFAULT_PREFERENCES;
	}
}

/** Sessions counted as "处理中" on the home screen. */
export function isProcessing(session: RemoteSessionSummary): boolean {
	return isActiveStatus(session.status);
}

/** Test seam: an in-memory platform with a fake transport. */
export function createMemoryPlatform(createTransport: TransportFactory, deviceName = "Phone"): AppPlatform {
	return {
		settings: new MemoryKeyValueStore(),
		secrets: new MemoryKeyValueStore(),
		cache: new MemorySessionCache(),
		createTransport,
		deviceName,
		loadDeviceId: async () => `mobile-${randomToken(8)}`,
	};
}

export const isWeb = Platform.OS === "web";
