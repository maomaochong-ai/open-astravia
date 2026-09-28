/**
 * Payload contracts carried inside protocol v2 requests, responses and events.
 *
 * The desktop is the producer and the phone the consumer of almost all of
 * these. Session ids are opaque keys the desktop derives from the session
 * file; they never expose a filesystem path and stay stable across runtime
 * restarts, unlike the runtime's live session ids.
 */

export type RemoteSessionStatus = "idle" | "running" | "thinking" | "waiting_input" | "completed" | "error" | "aborted";

export interface RemoteProjectSummary {
	readonly cwd: string;
	readonly name: string;
	readonly kind: "conversation" | "project";
	readonly sessionCount: number;
}

export interface RemoteSessionSummary {
	readonly id: string;
	readonly projectCwd: string;
	readonly projectName: string;
	readonly title: string;
	readonly preview?: string;
	readonly updatedAt: number;
	readonly status: RemoteSessionStatus;
	/** True when the desktop currently holds a live runtime instance for it. */
	readonly live: boolean;
	/** Set while the session is pinned (the desktop sidebar's pin); newer pins sort first. */
	readonly pinnedAt?: number;
}

export interface RemoteSessionState {
	readonly status: RemoteSessionStatus;
	/** Human-readable detail such as "compacting" or a retry counter. */
	readonly detail?: string;
	/** Display name of the session's model. */
	readonly model?: string;
	/** `provider/modelId`, as `session.configure` takes it. */
	readonly modelKey?: string;
	/** The session's current thinking level, e.g. "off" or "high". */
	readonly thinkingLevel?: string;
	readonly contextPercent?: number;
	readonly error?: { readonly code: string; readonly message: string };
	/** Present while the desktop waits for an answer that the phone may give. */
	readonly pendingQuestion?: RemoteQuestionRequest;
}

export interface RemoteQuestionOption {
	readonly label: string;
	readonly description: string;
}

export interface RemoteQuestionItem {
	readonly question: string;
	readonly header: string;
	readonly options: readonly RemoteQuestionOption[];
	readonly multiSelect?: boolean;
}

export interface RemoteQuestionRequest {
	readonly requestId: string;
	readonly questions: readonly RemoteQuestionItem[];
}

export interface RemoteQuestionAnswer {
	readonly question: string;
	readonly answers: readonly string[];
}

export type RemoteToolPhase = "generating" | "started" | "updated" | "phase" | "completed" | "failed";

export interface RemoteToolEvent {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly phase: RemoteToolPhase;
	readonly args?: string;
	readonly result?: string;
	readonly label?: string;
	readonly durationMs?: number;
}

export type RemoteMessageEvent =
	| { readonly kind: "user"; readonly text: string; readonly at: number }
	| { readonly kind: "assistant_delta"; readonly text: string }
	| { readonly kind: "thinking_delta"; readonly text: string }
	| { readonly kind: "turn_end"; readonly at: number };

export interface RemoteToolCallSummary {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args?: string;
	readonly result?: string;
	readonly isError?: boolean;
	readonly durationMs?: number;
}

export type RemoteTranscriptEntry =
	| { readonly kind: "user"; readonly id: string; readonly text: string; readonly at?: number }
	| {
			readonly kind: "assistant";
			readonly id: string;
			readonly text: string;
			readonly thinking?: string;
			readonly toolCalls: readonly RemoteToolCallSummary[];
			readonly at?: number;
			readonly error?: string;
	  }
	| { readonly kind: "marker"; readonly id: string; readonly text: string; readonly at?: number };

/** A model the session can switch to, with the thinking levels it accepts. */
export interface RemoteModelOption {
	/** `provider/modelId`. */
	readonly key: string;
	readonly name: string;
	readonly provider: string;
	/** Empty when the model has no thinking control; otherwise includes "off" or "none". */
	readonly thinkingLevels: readonly string[];
	readonly defaultThinkingLevel?: string;
	readonly supportsImage: boolean;
}

/**
 * A skill or scene the phone may reference by writing `@skill:<name>` /
 * `@scene:<name>` into a prompt. Already filtered and ordered as the desktop
 * composer's picker shows them.
 */
export interface RemoteSkillOption {
	/** What the token carries; the agent looks the skill up by it. */
	readonly name: string;
	/** Display name; omitted when it equals `name`. */
	readonly alias?: string;
	readonly description: string;
	readonly type: "skill" | "scene";
	/** Where it was installed: `builtin`, `plugin`, `user`, `project`, `market`, `agents-user`… */
	readonly source: string;
}

export type RemoteUploadKind = "image" | "file";

/**
 * Largest attachment the phone may upload in one `session.upload`, before
 * base64. One sealed frame carries at most ~1 MB of JSON, so each attachment
 * travels in its own request and prompts refer to it by `uploadId`.
 */
export const REMOTE_MAX_UPLOAD_BYTES = 700 * 1024;

/**
 * A file or folder the phone may look at, as `file.list` and `file.stat` describe it.
 *
 * `path` is the desktop's canonical form and what the phone passes back to
 * `file.stat`, `file.read` and `file.list`: relative to the session's working
 * directory inside it (the directory itself is ""), `~/…` under the home
 * directory, absolute anywhere else. The phone never builds paths itself
 * (ADR-0139).
 */
export interface RemoteFileEntry {
	readonly name: string;
	readonly path: string;
	readonly isDirectory: boolean;
	readonly size: number;
	/** Milliseconds since the epoch. */
	readonly modifiedAt: number;
}

export interface RemoteFileInfo extends RemoteFileEntry {
	/** Guessed from the extension; a chunk's `mimeType` says what was actually sent (scaled images arrive as JPEG). */
	readonly mimeType: string;
	/** The home directory abbreviated to `~`, for showing where the file lives. */
	readonly displayPath: string;
}

/** One chunk of `file.read`. */
export interface RemoteFileChunk {
	/** base64 of at most `REMOTE_FILE_CHUNK_BYTES`. */
	readonly data: string;
	readonly offset: number;
	/** Size of the whole content being read, which for images is the scaled-down copy. */
	readonly totalSize: number;
	readonly modifiedAt: number;
	readonly mimeType: string;
}

/** Most bytes one `file.read` returns; a chunk has to fit a sealed frame, like an upload. */
export const REMOTE_FILE_CHUNK_BYTES = 700 * 1024;

/** Largest file the phone may preview, the desktop's own preview limit. */
export const REMOTE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The desktop's screen as the phone may see it (ADR-0140). `stopped` while no phone
 * subscribes; `permission_denied` when macOS withholds Screen Recording, so the phone
 * explains it instead of showing black; `unavailable` when capture failed otherwise.
 */
export type RemoteScreenState = "stopped" | "streaming" | "permission_denied" | "unavailable";

/**
 * Whether taps and keys reach the desktop: `permission_denied` when macOS withholds
 * Accessibility, `unsupported` on a system without input injection.
 */
export type RemoteInputState = "ready" | "permission_denied" | "unsupported";

export interface RemoteScreenStatus {
	readonly screen: RemoteScreenState;
	readonly input: RemoteInputState;
}

/**
 * The pointer as the desktop shows it now (arrow, I-beam, hand…), for a phone that draws
 * the pointer itself where its finger put it instead of waiting for the video. Sizes are
 * in the desktop's points; `screenWidth` is the display's, so the phone can scale it.
 */
export interface RemoteScreenCursor {
	/** base64 PNG. */
	readonly image: string;
	readonly width: number;
	readonly height: number;
	/** The point of the image that is the pointer's position, from its top-left. */
	readonly hotspotX: number;
	readonly hotspotY: number;
	readonly screenWidth: number;
}

export interface RemoteDeviceStatus {
	readonly deviceName: string;
	readonly osLabel?: string;
	readonly lanEndpoints: readonly string[];
	readonly relayEnabled: boolean;
	readonly runningSessionCount: number;
	/**
	 * Whether the phone this status goes to may view and operate the desktop's screen.
	 * Desktops before it leave it out; they let every phone view.
	 */
	readonly desktopControl?: boolean;
	/**
	 * The relay this desktop uses now, when access away from its network is on. A phone
	 * that paired with another relay switches to this one. Older desktops leave it out.
	 */
	readonly relayBaseUrl?: string;
	/**
	 * Whether the desktop answers `file.list`, `file.stat` and `file.read` (ADR-0139).
	 * The phone learns it here rather than from the handshake, whose `hello_ack` does not
	 * carry the desktop's capabilities. Older desktops leave it out and drop the link on
	 * those methods, so the phone must not send them.
	 */
	readonly fileRead?: boolean;
	/**
	 * Whether the desktop answers `screen.subscribe` and captures only while a phone
	 * subscribes (ADR-0140). Older desktops leave it out and stream whenever a P2P link
	 * is up; the iPhone does not open one to them.
	 */
	readonly screen?: boolean;
}

/** Sealed follow-up to a manual pairing approval; carries the long-lived credential. */
export interface RemoteDevicePaired {
	readonly pairingId: string;
	readonly mobileSecret: string;
	readonly desktopName: string;
	readonly lanEndpoints: readonly string[];
	readonly relayBaseUrl?: string;
}

export interface RemoteDiagnosticsSnapshot extends RemoteDeviceStatus {
	readonly liveSessionCount: number;
	readonly cpu?: string;
	readonly ram?: string;
}

export interface RemoteRequestPayloads {
	readonly "project.list": undefined;
	readonly "session.list": { readonly projectCwd?: string; readonly limit?: number } | undefined;
	readonly "session.create": { readonly projectCwd?: string } | undefined;
	readonly "session.open": undefined;
	readonly "session.history": undefined;
	/** `attachments` are `uploadId`s returned by `session.upload` for the same session. */
	readonly "session.prompt": { readonly text: string; readonly attachments?: readonly string[] };
	readonly "session.upload": {
		readonly kind: RemoteUploadKind;
		readonly name: string;
		readonly mimeType: string;
		/** base64, at most `REMOTE_MAX_UPLOAD_BYTES` once decoded. */
		readonly data: string;
	};
	readonly "model.list": undefined;
	/** `cwd` must be one of `project.list`'s projects; anything else lists global skills only. */
	readonly "skill.list": { readonly cwd?: string } | undefined;
	readonly "session.configure": { readonly modelKey?: string; readonly thinkingLevel?: string };
	readonly "session.rename": { readonly title: string };
	readonly "session.pin": { readonly pinned: boolean };
	readonly "session.delete": undefined;
	readonly "session.respond": {
		readonly requestId: string;
		readonly cancelled: boolean;
		readonly answers: readonly RemoteQuestionAnswer[];
	};
	readonly "session.abort": undefined;
	readonly "session.resume": { readonly lastEventSequence: number };
	readonly "diagnostics.snapshot": undefined;
	/** Lists a folder inside the session's working directory; `path` omitted or "" is the directory itself. */
	readonly "file.list": { readonly path?: string } | undefined;
	/** `path` may be a link exactly as the assistant wrote it: relative, absolute, `~/…` or `file://`. */
	readonly "file.stat": { readonly path: string };
	readonly "file.read": {
		readonly path: string;
		readonly offset: number;
		/** Defaults to, and is capped at, `REMOTE_FILE_CHUNK_BYTES`. */
		readonly length?: number;
		/** From the first chunk, so a file rewritten mid-read answers `file_changed` instead of mixing versions. */
		readonly modifiedAt?: number;
	};
	/**
	 * `true` when the remote desktop screen opens, `false` when it closes or the app
	 * leaves the foreground. The desktop captures only between the two.
	 */
	readonly "screen.subscribe": {
		readonly active: boolean;
		/** The phone draws the pointer itself and wants `screen.cursor` whenever its shape changes. */
		readonly cursor?: boolean;
	};
}

export interface RemoteResponsePayloads {
	readonly "project.list": { readonly projects: readonly RemoteProjectSummary[] };
	readonly "session.list": { readonly sessions: readonly RemoteSessionSummary[] };
	readonly "session.create": { readonly session: RemoteSessionSummary };
	readonly "session.open": { readonly session: RemoteSessionSummary; readonly state: RemoteSessionState };
	readonly "session.history": {
		readonly entries: readonly RemoteTranscriptEntry[];
		readonly state: RemoteSessionState;
	};
	readonly "session.prompt": { readonly accepted: true };
	readonly "session.upload": { readonly uploadId: string };
	readonly "model.list": { readonly models: readonly RemoteModelOption[] };
	readonly "skill.list": { readonly skills: readonly RemoteSkillOption[] };
	readonly "session.configure": { readonly state: RemoteSessionState };
	readonly "session.rename": { readonly session: RemoteSessionSummary };
	readonly "session.pin": { readonly session: RemoteSessionSummary };
	readonly "session.delete": { readonly deleted: true };
	readonly "session.respond": { readonly responded: true };
	readonly "session.abort": { readonly aborted: true };
	readonly "session.resume": { readonly resumed: true };
	readonly "diagnostics.snapshot": RemoteDiagnosticsSnapshot;
	readonly "file.list": { readonly path: string; readonly entries: readonly RemoteFileEntry[] };
	readonly "file.stat": { readonly file: RemoteFileInfo };
	readonly "file.read": RemoteFileChunk;
	readonly "screen.subscribe": RemoteScreenStatus;
}

export interface RemoteEventPayloads {
	readonly "device.status": RemoteDeviceStatus;
	readonly "device.paired": RemoteDevicePaired;
	readonly "session.list": { readonly sessions: readonly RemoteSessionSummary[] };
	readonly "session.state": RemoteSessionState;
	readonly "session.message": RemoteMessageEvent;
	readonly "session.tool": RemoteToolEvent;
	readonly "session.input":
		| { readonly kind: "question"; readonly request: RemoteQuestionRequest }
		| {
				readonly kind: "resolved";
				readonly requestId: string;
		  };
	readonly "session.resync": undefined;
	readonly "diagnostics.updated": RemoteDiagnosticsSnapshot;
	/** The screen or input state changed while subscribed, e.g. a permission was granted. */
	readonly "screen.status": RemoteScreenStatus;
	readonly "screen.cursor": RemoteScreenCursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const sessionStatuses = new Set<RemoteSessionStatus>([
	"idle",
	"running",
	"thinking",
	"waiting_input",
	"completed",
	"error",
	"aborted",
]);

export function readSessionStatus(value: unknown): RemoteSessionStatus {
	return typeof value === "string" && sessionStatuses.has(value as RemoteSessionStatus)
		? (value as RemoteSessionStatus)
		: "idle";
}

/** Tolerant decoder for the phone: unknown fields are dropped, malformed entries are skipped. */
export function readSessionSummary(value: unknown): RemoteSessionSummary | undefined {
	if (!isRecord(value)) return undefined;
	const id = str(value.id);
	const projectCwd = str(value.projectCwd);
	if (!id || !projectCwd) return undefined;
	return {
		id,
		projectCwd,
		projectName: str(value.projectName) ?? projectCwd,
		title: str(value.title) ?? "",
		preview: str(value.preview),
		updatedAt: num(value.updatedAt) ?? 0,
		status: readSessionStatus(value.status),
		live: value.live === true,
		pinnedAt: num(value.pinnedAt),
	};
}

export function readSessionSummaries(value: unknown): RemoteSessionSummary[] {
	const list = isRecord(value) && Array.isArray(value.sessions) ? value.sessions : [];
	return list.map(readSessionSummary).filter((entry): entry is RemoteSessionSummary => entry !== undefined);
}

export function readQuestionRequest(value: unknown): RemoteQuestionRequest | undefined {
	if (!isRecord(value)) return undefined;
	const requestId = str(value.requestId);
	if (!requestId || !Array.isArray(value.questions)) return undefined;
	const questions = value.questions.filter(isRecord).flatMap((item): RemoteQuestionItem[] => {
		const question = str(item.question);
		if (!question) return [];
		const options = Array.isArray(item.options)
			? item.options.filter(isRecord).flatMap((option): RemoteQuestionOption[] => {
					const label = str(option.label);
					return label ? [{ label, description: str(option.description) ?? "" }] : [];
				})
			: [];
		return [{ question, header: str(item.header) ?? "", options, multiSelect: item.multiSelect === true }];
	});
	return { requestId, questions };
}

export function readSessionState(value: unknown): RemoteSessionState {
	if (!isRecord(value)) return { status: "idle" };
	const errorRecord = isRecord(value.error) ? value.error : undefined;
	return {
		status: readSessionStatus(value.status),
		detail: str(value.detail),
		model: str(value.model),
		modelKey: str(value.modelKey),
		thinkingLevel: str(value.thinkingLevel),
		contextPercent: num(value.contextPercent),
		error: errorRecord
			? { code: str(errorRecord.code) ?? "internal_error", message: str(errorRecord.message) ?? "" }
			: undefined,
		pendingQuestion: readQuestionRequest(value.pendingQuestion),
	};
}

export function readToolEvent(value: unknown): RemoteToolEvent | undefined {
	if (!isRecord(value)) return undefined;
	const toolCallId = str(value.toolCallId);
	const toolName = str(value.toolName);
	const phase = str(value.phase) as RemoteToolPhase | undefined;
	if (!toolCallId || !toolName || !phase) return undefined;
	return {
		toolCallId,
		toolName,
		phase,
		args: str(value.args),
		result: str(value.result),
		label: str(value.label),
		durationMs: num(value.durationMs),
	};
}

export function readMessageEvent(value: unknown): RemoteMessageEvent | undefined {
	if (!isRecord(value)) return undefined;
	switch (value.kind) {
		case "user": {
			const text = str(value.text);
			return text === undefined ? undefined : { kind: "user", text, at: num(value.at) ?? Date.now() };
		}
		case "assistant_delta":
		case "thinking_delta": {
			const text = str(value.text);
			return text === undefined ? undefined : { kind: value.kind, text };
		}
		case "turn_end":
			return { kind: "turn_end", at: num(value.at) ?? Date.now() };
		default:
			return undefined;
	}
}

export function readTranscriptEntries(value: unknown): RemoteTranscriptEntry[] {
	const list = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
	return list.flatMap((entry): RemoteTranscriptEntry[] => {
		if (!isRecord(entry)) return [];
		const id = str(entry.id);
		if (!id) return [];
		switch (entry.kind) {
			case "user":
				return [{ kind: "user", id, text: str(entry.text) ?? "", at: num(entry.at) }];
			case "assistant":
				return [
					{
						kind: "assistant",
						id,
						text: str(entry.text) ?? "",
						thinking: str(entry.thinking),
						toolCalls: Array.isArray(entry.toolCalls)
							? entry.toolCalls.filter(isRecord).flatMap((call): RemoteToolCallSummary[] => {
									const toolCallId = str(call.toolCallId);
									const toolName = str(call.toolName);
									if (!toolCallId || !toolName) return [];
									return [
										{
											toolCallId,
											toolName,
											args: str(call.args),
											result: str(call.result),
											isError: call.isError === true,
											durationMs: num(call.durationMs),
										},
									];
								})
							: [],
						at: num(entry.at),
						error: str(entry.error),
					},
				];
			case "marker":
				return [{ kind: "marker", id, text: str(entry.text) ?? "", at: num(entry.at) }];
			default:
				return [];
		}
	});
}

export function readDeviceStatus(value: unknown): RemoteDeviceStatus | undefined {
	if (!isRecord(value)) return undefined;
	const deviceName = str(value.deviceName);
	if (!deviceName) return undefined;
	return {
		deviceName,
		osLabel: str(value.osLabel),
		lanEndpoints: Array.isArray(value.lanEndpoints)
			? value.lanEndpoints.filter((entry): entry is string => typeof entry === "string")
			: [],
		relayEnabled: value.relayEnabled === true,
		runningSessionCount: num(value.runningSessionCount) ?? 0,
		desktopControl: typeof value.desktopControl === "boolean" ? value.desktopControl : undefined,
		relayBaseUrl: str(value.relayBaseUrl),
		fileRead: value.fileRead === true,
		screen: value.screen === true,
	};
}

export function readDevicePaired(value: unknown): RemoteDevicePaired | undefined {
	if (!isRecord(value)) return undefined;
	const pairingId = str(value.pairingId);
	const mobileSecret = str(value.mobileSecret);
	const desktopName = str(value.desktopName);
	if (!pairingId || !mobileSecret || !desktopName) return undefined;
	return {
		pairingId,
		mobileSecret,
		desktopName,
		lanEndpoints: Array.isArray(value.lanEndpoints)
			? value.lanEndpoints.filter((entry): entry is string => typeof entry === "string")
			: [],
		relayBaseUrl: str(value.relayBaseUrl),
	};
}

export function readProjectSummaries(value: unknown): RemoteProjectSummary[] {
	const list = isRecord(value) && Array.isArray(value.projects) ? value.projects : [];
	return list.flatMap((entry): RemoteProjectSummary[] => {
		if (!isRecord(entry)) return [];
		const cwd = str(entry.cwd);
		if (!cwd) return [];
		return [
			{
				cwd,
				name: str(entry.name) ?? cwd,
				kind: entry.kind === "conversation" ? "conversation" : "project",
				sessionCount: num(entry.sessionCount) ?? 0,
			},
		];
	});
}

export function readModelOptions(value: unknown): RemoteModelOption[] {
	const list = isRecord(value) && Array.isArray(value.models) ? value.models : [];
	return list.flatMap((entry): RemoteModelOption[] => {
		if (!isRecord(entry)) return [];
		const key = str(entry.key);
		if (!key) return [];
		const levels = Array.isArray(entry.thinkingLevels)
			? entry.thinkingLevels.filter((level): level is string => typeof level === "string" && level.length > 0)
			: [];
		return [
			{
				key,
				name: str(entry.name) ?? key,
				provider: str(entry.provider) ?? key.split("/")[0] ?? "",
				thinkingLevels: levels,
				defaultThinkingLevel: str(entry.defaultThinkingLevel),
				supportsImage: entry.supportsImage === true,
			},
		];
	});
}

function readFileEntry(value: unknown): RemoteFileEntry | undefined {
	if (!isRecord(value)) return undefined;
	const name = str(value.name);
	const path = str(value.path);
	if (!name || path === undefined) return undefined;
	return {
		name,
		path,
		isDirectory: value.isDirectory === true,
		size: num(value.size) ?? 0,
		modifiedAt: num(value.modifiedAt) ?? 0,
	};
}

export function readFileEntries(value: unknown): RemoteFileEntry[] {
	const list = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
	return list.map(readFileEntry).filter((entry): entry is RemoteFileEntry => entry !== undefined);
}

export function readFileInfo(value: unknown): RemoteFileInfo | undefined {
	const file = isRecord(value) ? value.file : undefined;
	const entry = readFileEntry(file);
	if (!entry || !isRecord(file)) return undefined;
	return {
		...entry,
		mimeType: str(file.mimeType) ?? "application/octet-stream",
		displayPath: str(file.displayPath) ?? entry.path,
	};
}

export function readFileChunk(value: unknown): RemoteFileChunk | undefined {
	if (!isRecord(value)) return undefined;
	const data = str(value.data);
	const offset = num(value.offset);
	const totalSize = num(value.totalSize);
	if (data === undefined || offset === undefined || totalSize === undefined) return undefined;
	return {
		data,
		offset,
		totalSize,
		modifiedAt: num(value.modifiedAt) ?? 0,
		mimeType: str(value.mimeType) ?? "application/octet-stream",
	};
}

const screenStates = new Set<RemoteScreenState>(["stopped", "streaming", "permission_denied", "unavailable"]);
const inputStates = new Set<RemoteInputState>(["ready", "permission_denied", "unsupported"]);

/** An unknown state from a newer desktop reads as `unavailable` / `unsupported`. */
export function readScreenStatus(value: unknown): RemoteScreenStatus | undefined {
	if (!isRecord(value)) return undefined;
	const screen = str(value.screen);
	const input = str(value.input);
	if (screen === undefined || input === undefined) return undefined;
	return {
		screen: screenStates.has(screen as RemoteScreenState) ? (screen as RemoteScreenState) : "unavailable",
		input: inputStates.has(input as RemoteInputState) ? (input as RemoteInputState) : "unsupported",
	};
}

export function readScreenCursor(value: unknown): RemoteScreenCursor | undefined {
	if (!isRecord(value)) return undefined;
	const image = str(value.image);
	const width = num(value.width);
	const height = num(value.height);
	const screenWidth = num(value.screenWidth);
	if (!image || !width || !height || !screenWidth || width <= 0 || height <= 0 || screenWidth <= 0) return undefined;
	return {
		image,
		width,
		height,
		hotspotX: Math.min(Math.max(num(value.hotspotX) ?? 0, 0), width),
		hotspotY: Math.min(Math.max(num(value.hotspotY) ?? 0, 0), height),
		screenWidth,
	};
}
