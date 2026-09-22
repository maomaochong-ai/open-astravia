import {
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	type RemoteIdentityKeyPair,
	toBase64Url,
} from "@vetta/remote-control";
import type { DesktopRecord, KeyValueStore } from "./types";

const IDENTITY_KEY = "vetta.identity.secret";
const DESKTOPS_KEY = "vetta.desktops";
const CURRENT_KEY = "vetta.desktops.current";
const secretKeyFor = (desktopIdentityKey: string) => `vetta.desktop.${desktopIdentityKey}.secret`;

type StoredDesktop = Omit<DesktopRecord, "mobileSecret">;

export interface PairingStoreOptions {
	/** Plain persisted settings (safe for non-secret metadata). */
	readonly settings: KeyValueStore;
	/** OS keychain / keystore; identity secret and per-desktop secrets live here. */
	readonly secrets: KeyValueStore;
}

/**
 * Persists the phone's identity and every paired desktop. Only one desktop is
 * "current" (what the UI shows), but records for several are kept so a later
 * multi-computer UI needs no migration.
 */
export class PairingStore {
	private identity: RemoteIdentityKeyPair | undefined;
	private desktops: StoredDesktop[] = [];
	private currentKey: string | undefined;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly options: PairingStoreOptions) {}

	async load(): Promise<void> {
		const secret = await this.options.secrets.get(IDENTITY_KEY);
		if (secret) {
			this.identity = identityKeyPairFromSecret(fromBase64Url(secret));
		} else {
			this.identity = generateIdentityKeyPair();
			await this.options.secrets.set(IDENTITY_KEY, toBase64Url(this.identity.secretKey));
		}
		const raw = await this.options.settings.get(DESKTOPS_KEY);
		this.desktops = raw ? parseDesktops(raw) : [];
		this.currentKey = (await this.options.settings.get(CURRENT_KEY)) ?? this.desktops[0]?.desktopIdentityKey;
		this.notify();
	}

	getIdentity(): RemoteIdentityKeyPair {
		if (!this.identity) throw new Error("pairing store is not loaded");
		return this.identity;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	listDesktops(): readonly StoredDesktop[] {
		return this.desktops;
	}

	async getCurrent(): Promise<DesktopRecord | undefined> {
		const stored = this.desktops.find((entry) => entry.desktopIdentityKey === this.currentKey);
		if (!stored) return undefined;
		const mobileSecret = await this.options.secrets.get(secretKeyFor(stored.desktopIdentityKey));
		if (!mobileSecret) return undefined;
		return { ...stored, mobileSecret };
	}

	hasCurrent(): boolean {
		return this.desktops.some((entry) => entry.desktopIdentityKey === this.currentKey);
	}

	async save(record: DesktopRecord): Promise<void> {
		const { mobileSecret, ...stored } = record;
		await this.options.secrets.set(secretKeyFor(record.desktopIdentityKey), mobileSecret);
		const others = this.desktops.filter((entry) => entry.desktopIdentityKey !== record.desktopIdentityKey);
		this.desktops = [stored, ...others];
		this.currentKey = record.desktopIdentityKey;
		await this.persist();
	}

	async update(
		desktopIdentityKey: string,
		patch: Partial<Omit<DesktopRecord, "desktopIdentityKey" | "mobileSecret">>,
	): Promise<void> {
		const index = this.desktops.findIndex((entry) => entry.desktopIdentityKey === desktopIdentityKey);
		if (index < 0) return;
		const current = this.desktops[index]!;
		this.desktops = this.desktops.map((entry, position) => (position === index ? { ...current, ...patch } : entry));
		await this.persist();
	}

	async revoke(desktopIdentityKey: string): Promise<void> {
		this.desktops = this.desktops.filter((entry) => entry.desktopIdentityKey !== desktopIdentityKey);
		await this.options.secrets.remove(secretKeyFor(desktopIdentityKey));
		if (this.currentKey === desktopIdentityKey) this.currentKey = this.desktops[0]?.desktopIdentityKey;
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.options.settings.set(DESKTOPS_KEY, JSON.stringify(this.desktops));
		if (this.currentKey) await this.options.settings.set(CURRENT_KEY, this.currentKey);
		else await this.options.settings.remove(CURRENT_KEY);
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function parseDesktops(raw: string): StoredDesktop[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((entry): StoredDesktop[] => {
			if (typeof entry !== "object" || entry === null) return [];
			const record = entry as Record<string, unknown>;
			if (typeof record.desktopIdentityKey !== "string" || typeof record.pairingId !== "string") return [];
			return [
				{
					desktopIdentityKey: record.desktopIdentityKey,
					desktopName: typeof record.desktopName === "string" ? record.desktopName : "Vetta Desktop",
					pairingId: record.pairingId,
					lanEndpoints: Array.isArray(record.lanEndpoints)
						? record.lanEndpoints.filter((value): value is string => typeof value === "string")
						: [],
					relayBaseUrl: typeof record.relayBaseUrl === "string" ? record.relayBaseUrl : undefined,
					lastEventSequence: typeof record.lastEventSequence === "number" ? record.lastEventSequence : 0,
					pairedAt: typeof record.pairedAt === "number" ? record.pairedAt : 0,
					lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : 0,
				},
			];
		});
	} catch {
		return [];
	}
}

export class MemoryKeyValueStore implements KeyValueStore {
	private readonly values = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.values.get(key) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		this.values.set(key, value);
	}

	async remove(key: string): Promise<void> {
		this.values.delete(key);
	}
}
