import type { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { OcrProviderInput, OcrResult } from "@vetta/capability-sdk";
import type { OcrTransferResponse, OcrUploadRequest, PluginPermission } from "@vetta-org/plugin-sdk";
import type { WebContents } from "electron";
import type {
	InstalledPlugin,
	PluginOcrProviderHostRegistration,
	PluginOcrProviderInvocationResult,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_OCR_CHANNELS } from "../../shared/plugin-ipc.js";
import { createEphemeralMediaToken, revokeEphemeralMediaToken } from "../media-token-store.js";
import type { OcrProviderContext, OcrProviderRegistry } from "../ocr/ocr-provider-registry.js";
import { isPluginNetworkHostAllowed } from "./plugin-network-service.js";

const PROVIDER_TIMEOUT_MS = 30 * 60_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const MAX_TRANSFER_RESPONSE_BYTES = 4 * 1024 * 1024;

interface PendingInvocation {
	pluginId: string;
	sender: WebContents;
	context: OcrProviderContext;
	networkHosts: readonly string[];
	resolve(value: Omit<OcrResult, "providerId">): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	disposeAbort(): void;
	tokens: Set<string>;
}

interface ProviderHandle {
	activationId: string;
	dispose(): void;
}

export interface PluginOcrProviderHostDependencies {
	listPlugins(): InstalledPlugin[];
	createRequestId(): string;
	fetch: typeof fetch;
	openAsBlob: typeof openAsBlob;
	getRegistry(): OcrProviderRegistry;
}

export class PluginOcrProviderHost {
	private readonly pending = new Map<string, PendingInvocation>();
	private readonly providers = new Map<string, ProviderHandle>();

	constructor(private readonly dependencies: PluginOcrProviderHostDependencies) {}

	register(sender: WebContents, pluginIdValue: unknown, registrationValue: unknown): void {
		const pluginId = requireString(pluginIdValue, "Plugin id");
		const plugin = this.assertProviderPermission(pluginId);
		const registration = registrationValue as PluginOcrProviderHostRegistration;
		const localId = requireString(registration?.id, "OCR provider id");
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(localId)) throw new Error("Invalid OCR provider id");
		if (registration.protocolVersion !== 1) throw new Error("Unsupported OCR protocol version");
		const handlerId = requireString(registration.handlerId, "OCR provider handler id");
		const activationId = requireString(registration.activationId, "OCR provider activation id");
		const networkHosts = validateNetworkDescriptor(plugin, registration);
		const qualifiedId = `plugin:${pluginId}:${localId}`;
		this.providers.get(qualifiedId)?.dispose();
		const handle = this.dependencies.getRegistry().registerProvider({
			descriptor: {
				id: qualifiedId,
				displayName: requireString(registration.displayName, "OCR provider display name"),
				ownerId: pluginId,
				protocolVersion: 1,
				processing: registration.processing,
				execution: registration.execution,
				status: registration.configuration?.state ?? "ready",
				input: structuredClone(registration.input),
				output: structuredClone(registration.output),
				network: registration.network ? structuredClone(registration.network) : undefined,
				configuration: registration.configuration ? structuredClone(registration.configuration) : undefined,
			},
			recognize: async (request, context) => {
				this.assertProviderPermission(pluginId);
				const value = await this.invoke(sender, pluginId, handlerId, request, context, networkHosts);
				return { ...value, providerId: qualifiedId };
			},
		});
		this.providers.set(qualifiedId, { activationId, dispose: () => handle.dispose() });
	}

	unregister(pluginIdValue: unknown, providerIdValue: unknown, activationIdValue: unknown): void {
		const pluginId = requireString(pluginIdValue, "Plugin id");
		const qualifiedId = `plugin:${pluginId}:${requireString(providerIdValue, "OCR provider id")}`;
		const handle = this.providers.get(qualifiedId);
		if (!handle || handle.activationId !== requireString(activationIdValue, "OCR provider activation id")) return;
		this.providers.delete(qualifiedId);
		handle.dispose();
	}

	respond(sender: WebContents, requestIdValue: unknown, resultValue: unknown): void {
		const requestId = requireString(requestIdValue, "OCR provider request id");
		const invocation = this.pending.get(requestId);
		if (!invocation || invocation.sender.id !== sender.id) return;
		const settled = this.settle(requestId);
		if (!settled || !resultValue || typeof resultValue !== "object") {
			settled?.reject(new Error("Invalid OCR provider response"));
			return;
		}
		const result = resultValue as PluginOcrProviderInvocationResult;
		if ("error" in result) settled.reject(new Error(requireString(result.error, "OCR provider error")));
		else if ("value" in result) settled.resolve(result.value);
		else settled.reject(new Error("Invalid OCR provider response"));
	}

	progress(sender: WebContents, requestIdValue: unknown, eventValue: unknown): void {
		const invocation = this.requireInvocation(sender, requestIdValue);
		if (!eventValue || typeof eventValue !== "object") throw new Error("Invalid OCR progress event");
		const event = eventValue as { phase?: string; completed?: number; total?: number; itemId?: string };
		const completed = event.completed;
		const total = event.total;
		if (
			!["queued", "uploading", "processing", "finalizing"].includes(event.phase ?? "") ||
			typeof completed !== "number" ||
			typeof total !== "number" ||
			!Number.isInteger(completed) ||
			!Number.isInteger(total) ||
			completed < 0 ||
			total < 1 ||
			completed > total
		)
			throw new Error("Invalid OCR progress event");
		invocation.context.reportProgress({
			phase: event.phase as "queued" | "uploading" | "processing" | "finalizing",
			completed,
			total,
			...(typeof event.itemId === "string" ? { itemId: event.itemId } : {}),
		});
	}

	cancel(sender: WebContents, requestIdValue: unknown): void {
		const requestId = requireString(requestIdValue, "OCR provider request id");
		const invocation = this.pending.get(requestId);
		if (!invocation || invocation.sender.id !== sender.id) return;
		invocation.sender.send(PLUGIN_OCR_CHANNELS.CANCEL, { requestId });
		this.settle(requestId)?.reject(new Error("OCR provider invocation was cancelled"));
	}

	async getInputUrl(sender: WebContents, requestIdValue: unknown, inputIdValue: unknown): Promise<string> {
		const invocation = this.requireInvocation(sender, requestIdValue);
		const path = await invocation.context.getInputPath(requireString(inputIdValue, "OCR input id"));
		const token = createEphemeralMediaToken(path, "application/octet-stream");
		invocation.tokens.add(token);
		return `vetta-media://local/stream?token=${token}`;
	}

	async uploadInput(
		sender: WebContents,
		requestIdValue: unknown,
		inputIdValue: unknown,
		requestValue: unknown,
	): Promise<OcrTransferResponse> {
		const invocation = this.requireInvocation(sender, requestIdValue);
		const plugin = this.assertProviderPermission(invocation.pluginId, "network.fetch");
		const request = requestValue as OcrUploadRequest;
		const url = parseAllowedUploadUrl(plugin, invocation.networkHosts, request.url);
		const path = await invocation.context.getInputPath(requireString(inputIdValue, "OCR input id"));
		const form = new FormData();
		for (const [name, value] of Object.entries(request.fields ?? {})) form.set(name, value);
		form.append(
			requireString(request.fieldName, "OCR upload field name"),
			await this.dependencies.openAsBlob(path),
			request.fileName?.trim() || basename(path),
		);
		const headers = new Headers(request.headers);
		headers.delete("content-type");
		const transfer = linkSignal(invocation.context.signal, request.timeoutMs);
		try {
			const response = await this.dependencies.fetch(url, {
				method: "POST",
				headers,
				body: form,
				redirect: "error",
				signal: transfer.signal,
			});
			return readResponse(response);
		} finally {
			transfer.dispose();
		}
	}

	dispose(): void {
		for (const requestId of [...this.pending.keys()])
			this.settle(requestId)?.reject(new Error("OCR provider host disposed"));
		for (const provider of this.providers.values()) provider.dispose();
		this.providers.clear();
	}

	private invoke(
		sender: WebContents,
		pluginId: string,
		handlerId: string,
		request: { inputs: readonly OcrProviderInput[]; languages?: readonly string[]; granularity?: string },
		context: OcrProviderContext,
		networkHosts: readonly string[],
	): Promise<Omit<OcrResult, "providerId">> {
		const requestId = this.dependencies.createRequestId();
		return new Promise((resolve, reject) => {
			const abort = (): void => {
				sender.send(PLUGIN_OCR_CHANNELS.CANCEL, { requestId });
				this.settle(requestId)?.reject(new Error("OCR provider invocation was cancelled"));
			};
			if (context.signal.aborted) return reject(new Error("OCR provider invocation was cancelled"));
			context.signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(
				() => this.settle(requestId)?.reject(new Error("OCR provider invocation timed out")),
				PROVIDER_TIMEOUT_MS,
			);
			this.pending.set(requestId, {
				pluginId,
				sender,
				context,
				networkHosts,
				resolve,
				reject,
				timer,
				disposeAbort: () => context.signal.removeEventListener("abort", abort),
				tokens: new Set(),
			});
			sender.send(PLUGIN_OCR_CHANNELS.REQUEST, { requestId, pluginId, handlerId, input: request });
		});
	}

	private requireInvocation(sender: WebContents, requestIdValue: unknown): PendingInvocation {
		const invocation = this.pending.get(requireString(requestIdValue, "OCR provider request id"));
		if (!invocation || invocation.sender.id !== sender.id) throw new Error("OCR provider invocation is unavailable");
		return invocation;
	}

	private settle(requestId: string): PendingInvocation | undefined {
		const invocation = this.pending.get(requestId);
		if (!invocation) return undefined;
		this.pending.delete(requestId);
		clearTimeout(invocation.timer);
		invocation.disposeAbort();
		for (const token of invocation.tokens) revokeEphemeralMediaToken(token);
		invocation.tokens.clear();
		return invocation;
	}

	private assertProviderPermission(pluginId: string, additional?: PluginPermission): InstalledPlugin {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin?.enabled) throw new Error(`Plugin is unavailable: ${pluginId}`);
		for (const permission of ["ai.ocr.provider.register" as const, ...(additional ? [additional] : [])]) {
			if (!plugin.permissions.includes(permission) || !plugin.grantedPermissions.includes(permission)) {
				throw new Error(`Plugin permission denied: ${permission}`);
			}
		}
		return plugin;
	}
}

function validateNetworkDescriptor(plugin: InstalledPlugin, registration: PluginOcrProviderHostRegistration): string[] {
	const hosts = registration.network?.allowedHosts ?? [];
	if (registration.processing === "remote" && hosts.length === 0)
		throw new Error("Remote OCR providers must declare network hosts");
	for (const host of hosts) {
		if (!isPluginNetworkHostAllowed(plugin, host.replace(/^\*\./, "probe."))) {
			throw new Error(`OCR provider host is not declared by the plugin: ${host}`);
		}
	}
	return [...hosts];
}

function parseAllowedUploadUrl(plugin: InstalledPlugin, providerHosts: readonly string[], value: string): URL {
	const url = new URL(value);
	if ((url.protocol !== "https:" && url.protocol !== "http:") || !isPluginNetworkHostAllowed(plugin, url.hostname)) {
		throw new Error("OCR upload target is not allowed by the plugin manifest");
	}
	if (!isPluginNetworkHostAllowed({ id: plugin.id, allowedNetworkHosts: [...providerHosts] }, url.hostname)) {
		throw new Error("OCR upload target is not allowed by the provider descriptor");
	}
	return url;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
	return value.trim();
}

function linkSignal(signal: AbortSignal, timeoutMs?: number): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const abort = (): void => controller.abort(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	const duration = Math.min(Math.max(timeoutMs ?? TRANSFER_TIMEOUT_MS, 1), TRANSFER_TIMEOUT_MS);
	const timer = setTimeout(() => controller.abort(new Error("OCR transfer timed out")), duration);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		},
	};
}

async function readResponse(response: Response): Promise<OcrTransferResponse> {
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_TRANSFER_RESPONSE_BYTES) throw new Error("OCR transfer response is too large");
	let body: unknown = text;
	try {
		body = text.length > 0 ? JSON.parse(text) : null;
	} catch {
		/* plain text response */
	}
	return {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		headers: Object.fromEntries(response.headers.entries()),
		body,
	};
}
