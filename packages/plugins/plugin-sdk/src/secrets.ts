import type { Disposable } from "./disposable.js";

/**
 * Encrypted, per-plugin secret storage (`secrets.read` / `secrets.write`).
 *
 * Values are kept in the host credential vault rather than the plugin's private
 * JSON storage, so API keys and tokens stay encrypted at rest. Ownership is
 * derived from the calling plugin's capability session: a plugin can only read
 * and write its own secrets, never another plugin's.
 *
 * Use it for credentials only. Ordinary configuration belongs in
 * `ctx.storage.writeJson("settings", …)`, which the plugin renders and validates
 * in its own workspace view (ADR-0105).
 */
export interface PluginSecretsApi {
	/** Resolved secret, or `undefined` when unset or the vault is unavailable. */
	get(key: string): Promise<string | undefined>;
	/** Whether a value is stored, without decrypting it. */
	has(key: string): Promise<boolean>;
	/** Stored key names only — never the values. */
	keys(): Promise<string[]>;
	/** Store a secret. Writing an empty string deletes it. */
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	/** Fired when this plugin's secrets change, with the affected key names. */
	onChange(listener: (keys: readonly string[]) => void): Disposable;
}
