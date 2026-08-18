import type { PluginNetworkRequest, PluginNetworkResponse } from "@vetta-org/plugin-sdk";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type PluginNetworkPolicy = Pick<InstalledPlugin, "allowedNetworkHosts" | "id" | "trustLevel">;

function parseUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported network protocol: ${url.protocol}`);
	}
	return url;
}

function normalizeHostname(value: string): string {
	return value
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "")
		.toLowerCase();
}

export function isPluginNetworkHostAllowed(policy: PluginNetworkPolicy, hostname: string): boolean {
	const normalized = normalizeHostname(hostname);
	return policy.allowedNetworkHosts.some((entry) => {
		if (entry === "*") return policy.trustLevel === "official";
		if (!entry.startsWith("*.")) return normalized === entry;
		const suffix = entry.slice(1);
		return normalized.endsWith(suffix) && normalized.length > suffix.length;
	});
}

function assertAllowedNetworkTarget(policy: PluginNetworkPolicy, url: URL): void {
	if (!isPluginNetworkHostAllowed(policy, url.hostname)) {
		throw new Error(`Plugin network host is not declared: ${url.hostname}`);
	}
}

async function fetchAllowedTarget(policy: PluginNetworkPolicy, url: URL, init: RequestInit): Promise<Response> {
	let currentUrl = url;
	for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
		assertAllowedNetworkTarget(policy, currentUrl);
		const response = await fetch(currentUrl, { ...init, redirect: "manual" });
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		if (redirectCount === MAX_REDIRECTS) throw new Error("Plugin network request exceeded redirect limit");
		const method = String(init.method ?? "GET").toUpperCase();
		if (method !== "GET" && method !== "HEAD") {
			throw new Error("Plugin network redirects are only allowed for GET and HEAD requests");
		}
		const location = response.headers.get("location");
		if (!location) throw new Error("Plugin network redirect is missing Location");
		const nextUrl = parseUrl(new URL(location, currentUrl).toString());
		if (nextUrl.origin !== currentUrl.origin && init.headers) {
			const headers = new Headers(init.headers);
			headers.delete("authorization");
			headers.delete("cookie");
			init = { ...init, headers };
		}
		currentUrl = nextUrl;
	}
	throw new Error("Plugin network request exceeded redirect limit");
}

function buildBody(request: PluginNetworkRequest): {
	body?: BodyInit;
	headers: Headers;
} {
	const headers = new Headers(request.headers);
	if (!request.body) return { headers };
	if (request.body.type === "json") {
		if (!headers.has("content-type")) headers.set("content-type", "application/json");
		const body = JSON.stringify(request.body.value);
		if (body === undefined) throw new Error("Plugin network JSON body must be serializable");
		if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
			throw new Error(`Plugin network request exceeds ${MAX_REQUEST_BYTES} bytes`);
		}
		return { body, headers };
	}
	const form = new FormData();
	let bodyBytes = 0;
	for (const [name, value] of Object.entries(request.body.fields ?? {})) {
		bodyBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
		if (bodyBytes > MAX_REQUEST_BYTES) {
			throw new Error(`Plugin network request exceeds ${MAX_REQUEST_BYTES} bytes`);
		}
		form.set(name, value);
	}
	for (const file of request.body.files ?? []) {
		const bytes = Buffer.from(file.data, "base64");
		bodyBytes += bytes.byteLength;
		if (bodyBytes > MAX_REQUEST_BYTES) {
			throw new Error(`Plugin network request exceeds ${MAX_REQUEST_BYTES} bytes`);
		}
		form.append(file.fieldName, new Blob([new Uint8Array(bytes)], { type: file.mimeType }), file.fileName);
	}
	return { body: form, headers };
}

function responseHeaders(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

async function readResponseBytes(response: Response): Promise<Buffer> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error(`Plugin network response exceeds ${MAX_RESPONSE_BYTES} bytes`);
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error(`Plugin network response exceeds ${MAX_RESPONSE_BYTES} bytes`);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, size);
}

export async function requestForPlugin<T = unknown>(
	plugin: PluginNetworkPolicy,
	request: PluginNetworkRequest,
	signal?: AbortSignal,
): Promise<PluginNetworkResponse<T>> {
	const url = parseUrl(request.url);
	const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error("Plugin network request timed out")), timeoutMs);
	const abortFromCaller = (): void => controller.abort(signal?.reason);
	if (signal?.aborted) abortFromCaller();
	else signal?.addEventListener("abort", abortFromCaller, { once: true });
	try {
		const { body, headers } = buildBody(request);
		const response = await fetchAllowedTarget(plugin, url, {
			method: request.method ?? (body ? "POST" : "GET"),
			headers,
			body,
			signal: controller.signal,
		});
		const bytes = await readResponseBytes(response);
		const responseType = request.responseType ?? "json";
		let responseBody: unknown;
		if (responseType === "base64") {
			responseBody = bytes.toString("base64");
		} else if (responseType === "text") {
			responseBody = bytes.toString("utf8");
		} else {
			const text = bytes.toString("utf8");
			try {
				responseBody = text.length > 0 ? JSON.parse(text) : null;
			} catch (error) {
				if (response.ok) throw error;
				responseBody = text;
			}
		}
		return {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders(response.headers),
			body: responseBody as T,
		};
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abortFromCaller);
	}
}
