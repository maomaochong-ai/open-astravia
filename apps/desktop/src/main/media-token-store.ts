import { randomUUID } from "node:crypto";

export interface EphemeralMediaToken {
	path: string;
	mimeType: string;
	expiresAt: number;
}

const tokens = new Map<string, EphemeralMediaToken>();

export function createEphemeralMediaToken(path: string, mimeType: string, ttlMs = 10 * 60_000): string {
	const token = randomUUID();
	tokens.set(token, { path, mimeType, expiresAt: Date.now() + ttlMs });
	return token;
}

export function resolveEphemeralMediaToken(token: string): EphemeralMediaToken | null {
	const value = tokens.get(token);
	if (!value) return null;
	if (value.expiresAt <= Date.now()) {
		tokens.delete(token);
		return null;
	}
	return value;
}

export function revokeEphemeralMediaToken(token: string): void {
	tokens.delete(token);
}
