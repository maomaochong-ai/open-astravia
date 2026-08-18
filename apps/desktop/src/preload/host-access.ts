import type { DesktopHostAccessApi } from "./api.js";

type ProtectedFunction = (...args: unknown[]) => unknown;

function createAccessToken(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function protectValue(value: unknown, owner: object | undefined, token: string): unknown {
	if (typeof value === "function") {
		const fn = value as ProtectedFunction;
		return (providedToken: unknown, ...args: unknown[]) => {
			if (providedToken !== token) throw new Error("Host API access denied");
			return Reflect.apply(fn, owner, args);
		};
	}
	if (Array.isArray(value)) {
		return value.map((item) => protectValue(item, value, token));
	}
	if (value === null || typeof value !== "object") return value;

	const protectedObject: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		protectedObject[key] = protectValue(nestedValue, value, token);
	}
	return protectedObject;
}

export function createHostAccessGate<T extends object>(
	rawApi: T,
): {
	readonly api: T;
	readonly hostAccess: DesktopHostAccessApi;
} {
	const token = createAccessToken();
	let claimed = false;
	return {
		api: protectValue(rawApi, undefined, token) as T,
		hostAccess: {
			claim: () => {
				if (claimed) throw new Error("Host API access token has already been claimed");
				claimed = true;
				return token;
			},
		},
	};
}
