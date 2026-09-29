import type { RemoteInputState, RemoteScreenCursor, RemoteScreenStatus } from "@vetta/remote-control";

/** The part of a desktop screen host the subscription needs. */
export interface ScreenShareHost {
	/** Starts or stops capturing; resolves to whether frames now flow. Idempotent. */
	setScreen(active: boolean): Promise<boolean>;
	/** Re-checks input injection, e.g. after Accessibility was granted; true when taps reach the desktop. */
	refreshInput(): boolean;
}

export interface ScreenSharePermissions {
	/** macOS Screen Recording; always true elsewhere. */
	screenAllowed(): boolean;
	/** macOS Accessibility; always true elsewhere. */
	inputAllowed(): boolean;
}

export interface RemoteScreenShareOptions {
	readonly permissions: ScreenSharePermissions;
	/** The screen host serving this phone's P2P link, while there is one. */
	readonly hostFor: (deviceId: string) => ScreenShareHost | undefined;
	/** Sends `screen.status` to one phone. */
	readonly emit: (deviceId: string, status: RemoteScreenStatus) => void;
	/** Asks the person at the desktop to grant what is missing; called once per subscription. */
	readonly notifyMissing: (deviceId: string, missing: { readonly screen: boolean; readonly input: boolean }) => void;
	/** How often a missing permission is checked again while a phone waits for it. */
	readonly pollMs?: number;
	/** The pointer the desktop shows now; left out where it cannot be read. */
	readonly readCursor?: () => RemoteScreenCursor | undefined;
	/** Sends `screen.cursor` to one phone. */
	readonly emitCursor?: (deviceId: string, cursor: RemoteScreenCursor) => void;
	/** How often the pointer's shape is checked while a phone draws it. */
	readonly cursorPollMs?: number;
}

/**
 * Which phones are looking at the desktop's screen (ADR-0140). The screen is
 * captured only while at least one phone served by a host subscribes, and every
 * answer carries why frames or taps might not arrive, so the phone never shows
 * an unexplained black picture or ignores taps silently.
 */
export class RemoteScreenShare {
	private readonly subscribed = new Map<string, RemoteScreenStatus>();
	private readonly notified = new Set<string>();
	private poll: ReturnType<typeof setInterval> | undefined;
	private readonly pollMs: number;
	/** Phones drawing the pointer themselves, with the image they last got. */
	private readonly cursorWatchers = new Map<string, string | undefined>();
	private cursorPoll: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly options: RemoteScreenShareOptions) {
		this.pollMs = options.pollMs ?? 3_000;
	}

	/** `cursor`: the phone draws the pointer itself and is sent its shape as it changes. */
	async subscribe(deviceId: string, active: boolean, cursor = false): Promise<RemoteScreenStatus> {
		if (!active) {
			const host = this.options.hostFor(deviceId);
			this.release(deviceId);
			if (host && !this.watchedBy(host)) await host.setScreen(false);
			return { screen: "stopped", input: this.inputState(host) };
		}
		// Counted as watching from now on, so another phone leaving meanwhile keeps the capture.
		if (!this.subscribed.has(deviceId))
			this.subscribed.set(deviceId, { screen: "unavailable", input: "unsupported" });
		const status = await this.evaluate(deviceId);
		// Unsubscribed while capture was starting: that later answer stands.
		if (!this.subscribed.has(deviceId)) return status;
		this.subscribed.set(deviceId, status);
		const missing = { screen: status.screen === "permission_denied", input: status.input === "permission_denied" };
		if ((missing.screen || missing.input) && !this.notified.has(deviceId)) {
			this.notified.add(deviceId);
			this.options.notifyMissing(deviceId, missing);
		}
		this.schedulePoll();
		if (cursor) this.watchCursor(deviceId);
		else this.cursorWatchers.delete(deviceId);
		return status;
	}

	/** A host for this phone just came up: a phone already subscribed gets its screen back. */
	async hostReady(deviceId: string): Promise<void> {
		if (this.subscribed.has(deviceId)) await this.refresh(deviceId);
	}

	/** The phone went offline or may no longer use the screen. */
	forget(deviceId: string): void {
		this.release(deviceId);
	}

	isSubscribed(deviceId: string): boolean {
		return this.subscribed.has(deviceId);
	}

	stop(): void {
		this.subscribed.clear();
		this.notified.clear();
		this.stopPoll();
		this.cursorWatchers.clear();
		this.stopCursorPoll();
	}

	private release(deviceId: string): void {
		this.subscribed.delete(deviceId);
		this.notified.delete(deviceId);
		if (this.subscribed.size === 0) this.stopPoll();
		this.cursorWatchers.delete(deviceId);
		if (this.cursorWatchers.size === 0) this.stopCursorPoll();
	}

	/** Sends the pointer now, then again each time its shape changes. */
	private watchCursor(deviceId: string): void {
		const { readCursor, emitCursor } = this.options;
		if (!readCursor || !emitCursor) return;
		this.cursorWatchers.set(deviceId, undefined);
		this.sendCursor(readCursor());
		if (this.cursorPoll) return;
		this.cursorPoll = setInterval(() => this.sendCursor(readCursor()), this.options.cursorPollMs ?? 100);
		this.cursorPoll.unref?.();
	}

	private sendCursor(cursor: RemoteScreenCursor | undefined): void {
		if (!cursor) return;
		for (const [deviceId, sent] of this.cursorWatchers) {
			if (sent === cursor.image) continue;
			this.cursorWatchers.set(deviceId, cursor.image);
			this.options.emitCursor?.(deviceId, cursor);
		}
	}

	private stopCursorPoll(): void {
		if (!this.cursorPoll) return;
		clearInterval(this.cursorPoll);
		this.cursorPoll = undefined;
	}

	private watchedBy(host: ScreenShareHost): boolean {
		return [...this.subscribed.keys()].some((deviceId) => this.options.hostFor(deviceId) === host);
	}

	private async evaluate(deviceId: string): Promise<RemoteScreenStatus> {
		const host = this.options.hostFor(deviceId);
		const input = this.inputState(host);
		if (!host) return { screen: "unavailable", input };
		if (!this.options.permissions.screenAllowed()) return { screen: "permission_denied", input };
		return { screen: (await host.setScreen(true)) ? "streaming" : "unavailable", input };
	}

	private inputState(host: ScreenShareHost | undefined): RemoteInputState {
		if (!this.options.permissions.inputAllowed()) return "permission_denied";
		return host?.refreshInput() ? "ready" : "unsupported";
	}

	private async refresh(deviceId: string): Promise<void> {
		const previous = this.subscribed.get(deviceId);
		if (!previous) return;
		const next = await this.evaluate(deviceId);
		// Unsubscribed while capture was starting.
		if (!this.subscribed.has(deviceId)) return;
		this.subscribed.set(deviceId, next);
		if (next.screen !== previous.screen || next.input !== previous.input) this.options.emit(deviceId, next);
	}

	private schedulePoll(): void {
		if (this.poll) return;
		this.poll = setInterval(() => {
			for (const [deviceId, status] of this.subscribed) {
				if (status.screen === "permission_denied" || status.input === "permission_denied")
					void this.refresh(deviceId);
			}
		}, this.pollMs);
		this.poll.unref?.();
	}

	private stopPoll(): void {
		if (!this.poll) return;
		clearInterval(this.poll);
		this.poll = undefined;
	}
}
