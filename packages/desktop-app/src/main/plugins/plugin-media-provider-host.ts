import type { openAsBlob } from "node:fs";
import { basename } from "node:path";
import {
	MEDIA_PROTOCOL_VERSION,
	type MediaArtifact,
	type MediaInput,
	type MediaProviderJob,
} from "@vetta/capability-sdk";
import type {
	PluginMediaInputUploadRequest,
	PluginMediaProviderJob,
	PluginMediaProviderSubmitRequest,
	PluginMediaTransferResponse,
	PluginPermission,
} from "@vetta-org/plugin-sdk";
import type { WebContents } from "electron";
import type {
	InstalledPlugin,
	PluginMediaProviderHostRegistration,
	PluginMediaProviderInvocationResult,
} from "../../preload/api-types/plugins.js";
import { PLUGIN_MEDIA_CHANNELS } from "../../shared/plugin-ipc.js";
import type { DesktopMediaRuntime } from "../capabilities/media-providers.js";
import {
	cloneMediaProviderCapabilities,
	type MediaProviderCallContext,
} from "../media-generation/media-provider-registry.js";

const PROVIDER_TIMEOUT_MS = 30 * 60_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const MAX_TRANSFER_RESPONSE_BYTES = 4 * 1024 * 1024;

interface PendingInvocation {
	pluginId: string;
	sender: WebContents;
	inputs: ReadonlyMap<string, MediaInput>;
	signal: AbortSignal;
	resolve: (result: PluginMediaProviderJob) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	disposeAbort: () => void;
}

interface ProviderHandle {
	activationId: string;
	dispose(): void;
}

export interface PluginMediaProviderHostDependencies {
	listPlugins(): InstalledPlugin[];
	getMediaRuntime(): DesktopMediaRuntime;
	createRequestId(): string;
	fetch: typeof fetch;
	openAsBlob: typeof openAsBlob;
}

export class PluginMediaProviderHost {
	private readonly pending = new Map<string, PendingInvocation>();
	private readonly providers = new Map<string, ProviderHandle>();

	constructor(private readonly dependencies: PluginMediaProviderHostDependencies) {}

	register(sender: WebContents, pluginIdValue: unknown, registrationValue: unknown): void {
		const pluginId = requireString(pluginIdValue, "Plugin id");
		this.assertProviderPermission(pluginId);
		const registration = registrationValue as PluginMediaProviderHostRegistration;
		const localId = requireString(registration?.id, "Media provider id");
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(localId)) throw new Error("Invalid media provider id");
		const handlerId = requireString(registration.handlerId, "Media provider handler id");
		const activationId = requireString(registration.activationId, "Media provider activation id");
		const qualifiedId = `${pluginId}:${localId}`;
		this.providers.get(qualifiedId)?.dispose();
		const handle = this.dependencies.getMediaRuntime().providers.registerProvider({
			descriptor: {
				id: qualifiedId,
				displayName: registration.displayName?.trim() || undefined,
				ownerId: pluginId,
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: cloneMediaProviderCapabilities(registration.capabilities),
			},
			submit: async (input, context) => {
				this.assertProviderPermission(pluginId);
				const inputs = opaqueInputs(input.inputs);
				const { inputs: _inputs, ...request } = input;
				const job = await this.invoke(
					sender,
					pluginId,
					handlerId,
					"submit",
					{ ...request, inputs: inputs.input } as PluginMediaProviderSubmitRequest,
					inputs.lookup,
					context,
				);
				return this.materializeJob(job, pluginId, context);
			},
			getJob: registration.hasGetJob
				? async (jobId, context) => {
						this.assertProviderPermission(pluginId);
						const job = await this.invoke(sender, pluginId, handlerId, "getJob", { jobId }, new Map(), context);
						return this.materializeJob(job, pluginId, context);
					}
				: undefined,
			cancelJob: registration.hasCancelJob
				? async (jobId, context) => {
						this.assertProviderPermission(pluginId);
						const job = await this.invoke(
							sender,
							pluginId,
							handlerId,
							"cancelJob",
							{ jobId },
							new Map(),
							context,
						);
						return this.materializeJob(job, pluginId, context);
					}
				: undefined,
		});
		this.providers.set(qualifiedId, { activationId, dispose: () => handle.dispose() });
		sender.send(PLUGIN_MEDIA_CHANNELS.CHANGED);
	}

	unregister(sender: WebContents, pluginIdValue: unknown, providerIdValue: unknown, activationIdValue: unknown): void {
		const pluginId = requireString(pluginIdValue, "Plugin id");
		const qualifiedId = `${pluginId}:${requireString(providerIdValue, "Media provider id")}`;
		const handle = this.providers.get(qualifiedId);
		if (!handle || handle.activationId !== requireString(activationIdValue, "Media provider activation id")) return;
		this.providers.delete(qualifiedId);
		handle.dispose();
		sender.send(PLUGIN_MEDIA_CHANNELS.CHANGED);
	}

	respond(sender: WebContents, requestIdValue: unknown, resultValue: unknown): void {
		const requestId = requireString(requestIdValue, "Media provider request id");
		const invocation = this.pending.get(requestId);
		if (!invocation || invocation.sender.id !== sender.id) return;
		const settled = this.settlePending(requestId);
		if (!settled) return;
		if (!resultValue || typeof resultValue !== "object") {
			settled.reject(new Error("Media provider returned an invalid response"));
			return;
		}
		const result = resultValue as PluginMediaProviderInvocationResult;
		if ("error" in result) settled.reject(new Error(requireString(result.error, "Media provider error")));
		else if ("value" in result) settled.resolve(result.value);
		else settled.reject(new Error("Media provider returned an invalid response"));
	}

	async uploadInput(
		sender: WebContents,
		requestIdValue: unknown,
		inputIdValue: unknown,
		requestValue: unknown,
	): Promise<PluginMediaTransferResponse> {
		const requestId = requireString(requestIdValue, "Media provider request id");
		const invocation = this.pending.get(requestId);
		if (!invocation || invocation.sender.id !== sender.id) {
			throw new Error("Media provider invocation is unavailable");
		}
		this.assertProviderPermission(invocation.pluginId, "network.fetch");
		const inputId = requireString(inputIdValue, "Media input id");
		const input = invocation.inputs.get(inputId);
		if (!input) throw new Error(`Media input is unavailable: ${inputId}`);
		const request = requestValue as PluginMediaInputUploadRequest;
		const file = await this.dependencies.getMediaRuntime().artifacts.resolveInputFile(input);
		const form = new FormData();
		for (const [name, value] of Object.entries(request.fields ?? {})) form.set(name, value);
		form.append(
			requireString(request.fieldName, "Media upload field name"),
			await this.dependencies.openAsBlob(file.path, { type: file.mimeType }),
			request.fileName?.trim() || basename(file.path),
		);
		const headers = new Headers(request.headers);
		headers.delete("content-type");
		const transfer = linkTransferSignal(invocation.signal, normalizedTimeout(request.timeoutMs));
		try {
			const response = await this.dependencies.fetch(parseNetworkUrl(request.url), {
				method: "POST",
				headers,
				body: form,
				signal: transfer.signal,
			});
			return readTransferResponse(response);
		} finally {
			transfer.dispose();
		}
	}

	dispose(): void {
		for (const invocation of this.pending.values()) {
			invocation.reject(new Error("Plugin media provider host was disposed"));
			clearTimeout(invocation.timer);
			invocation.disposeAbort();
		}
		this.pending.clear();
		for (const provider of this.providers.values()) provider.dispose();
		this.providers.clear();
	}

	private assertProviderPermission(pluginId: string, additional?: PluginPermission): void {
		const plugin = this.dependencies.listPlugins().find((candidate) => candidate.id === pluginId);
		if (!plugin?.enabled) throw new Error(`Plugin is unavailable: ${pluginId}`);
		const required: readonly PluginPermission[] = additional
			? ["media.provider.register", additional]
			: ["media.provider.register"];
		for (const permission of required) {
			if (!plugin.permissions.includes(permission) || !plugin.grantedPermissions.includes(permission)) {
				throw new Error(`Plugin permission denied: ${permission}`);
			}
		}
	}

	private settlePending(requestId: string): PendingInvocation | undefined {
		const invocation = this.pending.get(requestId);
		if (!invocation) return undefined;
		this.pending.delete(requestId);
		clearTimeout(invocation.timer);
		invocation.disposeAbort();
		return invocation;
	}

	private invoke(
		sender: WebContents,
		pluginId: string,
		handlerId: string,
		operation: "submit" | "getJob" | "cancelJob",
		input: PluginMediaProviderSubmitRequest | { jobId: string },
		inputs: ReadonlyMap<string, MediaInput>,
		context: MediaProviderCallContext,
	): Promise<PluginMediaProviderJob> {
		const requestId = this.dependencies.createRequestId();
		return new Promise((resolve, reject) => {
			const abort = (): void =>
				this.settlePending(requestId)?.reject(new Error("Media provider invocation was cancelled"));
			if (context.signal.aborted) {
				reject(new Error("Media provider invocation was cancelled"));
				return;
			}
			context.signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(() => {
				this.settlePending(requestId)?.reject(new Error("Media provider invocation timed out"));
			}, PROVIDER_TIMEOUT_MS);
			this.pending.set(requestId, {
				pluginId,
				sender,
				inputs,
				signal: context.signal,
				resolve,
				reject,
				timer,
				disposeAbort: () => context.signal.removeEventListener("abort", abort),
			});
			try {
				sender.send(PLUGIN_MEDIA_CHANNELS.REQUEST, { requestId, pluginId, handlerId, operation, input });
			} catch (error) {
				this.settlePending(requestId)?.reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private async materializeJob(
		job: PluginMediaProviderJob,
		pluginId: string,
		context: MediaProviderCallContext,
	): Promise<MediaProviderJob> {
		if (!job.artifacts || job.artifacts.length === 0) return { ...job, artifacts: [] };
		const stored: MediaArtifact[] = [];
		try {
			for (const artifact of job.artifacts) {
				if (artifact.source.type === "remote-url") {
					this.assertProviderPermission(pluginId, "network.fetch");
					const transfer = linkTransferSignal(context.signal, TRANSFER_TIMEOUT_MS);
					try {
						const response = await this.dependencies.fetch(parseNetworkUrl(artifact.source.url), {
							headers: artifact.source.headers,
							signal: transfer.signal,
						});
						if (!response.ok || !response.body) {
							throw new Error(
								`Media artifact download failed: HTTP ${response.status} ${response.statusText}`.trim(),
							);
						}
						const mimeType =
							artifact.mimeType ??
							response.headers.get("content-type")?.split(";", 1)[0] ??
							(artifact.kind === "video" ? "video/mp4" : artifact.kind === "audio" ? "audio/mpeg" : "image/png");
						stored.push(
							await this.dependencies.getMediaRuntime().artifacts.putStream(context.ownerId, response.body, {
								kind: artifact.kind,
								mimeType,
								name: artifact.name,
								width: artifact.width,
								height: artifact.height,
								durationSeconds: artifact.durationSeconds,
							}),
						);
					} finally {
						transfer.dispose();
					}
					continue;
				}
				this.assertProviderPermission(
					pluginId,
					artifact.source.type === "plugin-blob" ? "storage.read" : "fs.read",
				);
				const input: MediaInput = {
					kind: artifact.kind,
					mimeType: artifact.mimeType,
					source:
						artifact.source.type === "plugin-blob"
							? { type: "plugin-blob", namespace: pluginId, blobId: artifact.source.blobId }
							: { type: "workspace-file", path: artifact.source.path },
				};
				const file = await this.dependencies.getMediaRuntime().artifacts.resolveInputFile(input);
				stored.push(
					await this.dependencies.getMediaRuntime().artifacts.putFile(context.ownerId, file.path, {
						kind: artifact.kind,
						mimeType: artifact.mimeType ?? file.mimeType,
						name: artifact.name,
						width: artifact.width,
						height: artifact.height,
						durationSeconds: artifact.durationSeconds,
					}),
				);
			}
			return { ...job, artifacts: stored };
		} catch (error) {
			await Promise.all(
				stored.map((artifact) =>
					this.dependencies.getMediaRuntime().artifacts.release(context.ownerId, artifact.id),
				),
			);
			throw error;
		}
	}
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
	return value.trim();
}

function parseNetworkUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported network protocol: ${url.protocol}`);
	}
	return url;
}

function linkTransferSignal(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const abort = (): void => controller.abort(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error("Media transfer timed out")), timeoutMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		},
	};
}

async function readTransferResponse(response: Response): Promise<PluginMediaTransferResponse> {
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_TRANSFER_RESPONSE_BYTES) {
		throw new Error(`Media transfer response exceeds ${MAX_TRANSFER_RESPONSE_BYTES} bytes`);
	}
	let body: unknown = text;
	if (text.length > 0) {
		try {
			body = JSON.parse(text);
		} catch {
			// Some providers return plain text for uploads.
		}
	} else {
		body = null;
	}
	return {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		headers: Object.fromEntries(response.headers.entries()),
		body,
	};
}

function opaqueInputs(inputs: readonly MediaInput[]): {
	input: PluginMediaProviderSubmitRequest["inputs"];
	lookup: ReadonlyMap<string, MediaInput>;
} {
	const lookup = new Map<string, MediaInput>();
	const input = inputs.map((mediaInput, index) => {
		const baseId = mediaInput.id?.trim() || `input-${index + 1}`;
		let id = baseId;
		for (let suffix = 2; lookup.has(id); suffix += 1) id = `${baseId}-${suffix}`;
		lookup.set(id, mediaInput);
		return { id, role: mediaInput.role, kind: mediaInput.kind, mimeType: mediaInput.mimeType };
	});
	return { input, lookup };
}

function normalizedTimeout(value: number | undefined): number {
	if (!Number.isFinite(value)) return TRANSFER_TIMEOUT_MS;
	return Math.min(Math.max(value ?? TRANSFER_TIMEOUT_MS, 1), TRANSFER_TIMEOUT_MS);
}
