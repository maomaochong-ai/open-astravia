import type { DesktopApi } from "@preload/api";

const rawApi = window.vetta;
const hostAccessToken = rawApi.hostAccess?.claim();

function bindHostAccess(value: unknown, owner?: object): unknown {
	if (hostAccessToken === undefined) return value;
	if (typeof value === "function") {
		return (...args: unknown[]) =>
			Reflect.apply(value as (...fnArgs: unknown[]) => unknown, owner, [hostAccessToken, ...args]);
	}
	if (Array.isArray(value)) return value.map((item) => bindHostAccess(item, value));
	if (value === null || typeof value !== "object") return value;

	const facade: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		facade[key] = bindHostAccess(nestedValue, value);
	}
	return facade;
}

export const hostApi = bindHostAccess(rawApi) as DesktopApi;
