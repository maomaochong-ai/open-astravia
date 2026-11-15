import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";
import { atomicWriteJSON } from "@astravia/toolkit/atomic-write";
import type { Disposable } from "@astravia-org/capability-sdk";
import type { CredentialVault } from "../credentials/credential-vault.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import type { MediaArtifactStore } from "./media-artifact-store.js";
import type { MediaProviderRegistry } from "./media-provider-registry.js";
import {
	type CustomImageFetch,
	type CustomImageProviderConfig,
	createOpenAiCompatibleImageProvider,
} from "./openai-compatible-image-provider.js";

/**
 * 自定义「OpenAI 兼容」图片服务的持久化与注册。
 *
 * - 非机密字段（名称、Base URL、模型名、能力开关）存
 *   `~/.astravia/desktop-app/custom-image-providers.json`。
 * - API Key 只进 CredentialVault（Electron safeStorage 加密），命名空间 `image-providers`；
 *   永远不写进上面的 JSON、不经 `desktop-config.json`、不回传给渲染进程（列表只给 `hasApiKey`）。
 */

const CREDENTIAL_NAMESPACE = "image-providers";
const CREDENTIAL_NAME = "api-key";
const STORE_FILE_NAME = "custom-image-providers.json";
const MAX_PROVIDERS = 20;
const NAME_MAX_LENGTH = 64;
const MODEL_MAX_LENGTH = 128;
const log = getAppLogger("custom-image-providers");

export type CustomImageProviderEntry = CustomImageProviderConfig;

export interface CustomImageProviderSummary extends CustomImageProviderEntry {
	readonly hasApiKey: boolean;
}

export interface CustomImageProviderInput {
	/** 缺省表示新增。 */
	readonly id?: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly model: string;
	readonly supportsTextToImage: boolean;
	readonly supportsImageToImage: boolean;
	/** 编辑时留空表示沿用已存的 key；新增时必填。 */
	readonly apiKey?: string;
}

export class CustomImageProviderError extends Error {
	constructor(
		readonly code:
			| "invalid-name"
			| "invalid-base-url"
			| "invalid-model"
			| "no-capability"
			| "api-key-required"
			| "not-found"
			| "too-many"
			| "secret-storage-unavailable",
		message: string,
	) {
		super(message);
		this.name = "CustomImageProviderError";
	}
}

interface StoreFile {
	schemaVersion: 1;
	providers: CustomImageProviderEntry[];
}

export interface CustomImageProviderManagerOptions {
	readonly storePath?: string;
	readonly vault?: CredentialVault;
	readonly fetch: CustomImageFetch;
}

function credentialRef(id: string) {
	return { namespace: CREDENTIAL_NAMESPACE, ownerId: id, name: CREDENTIAL_NAME };
}

function parseEntry(value: unknown): CustomImageProviderEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const raw = value as Record<string, unknown>;
	if (
		typeof raw.id !== "string" ||
		typeof raw.name !== "string" ||
		typeof raw.baseUrl !== "string" ||
		typeof raw.model !== "string"
	) {
		return undefined;
	}
	return {
		id: raw.id,
		name: raw.name,
		baseUrl: raw.baseUrl,
		model: raw.model,
		supportsTextToImage: raw.supportsTextToImage === true,
		supportsImageToImage: raw.supportsImageToImage === true,
	};
}

function normalizeBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new CustomImageProviderError("invalid-base-url", "Base URL is not a valid URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new CustomImageProviderError("invalid-base-url", "Base URL must start with http:// or https://");
	}
	if (url.username || url.password) {
		throw new CustomImageProviderError("invalid-base-url", "Base URL must not embed credentials");
	}
	if (url.search || url.hash) {
		throw new CustomImageProviderError("invalid-base-url", "Base URL must not contain a query or fragment");
	}
	return url.toString().replace(/\/+$/, "");
}

export class CustomImageProviderManager {
	private readonly storePath: string;
	private readonly vault: CredentialVault;
	private readonly registrations = new Map<string, Disposable>();
	private entries: CustomImageProviderEntry[];

	constructor(
		private readonly registry: MediaProviderRegistry,
		private readonly artifacts: MediaArtifactStore,
		private readonly options: CustomImageProviderManagerOptions,
	) {
		this.storePath = options.storePath ?? join(getAstraviaHomePath(), "desktop-app", STORE_FILE_NAME);
		this.vault = options.vault ?? getDesktopCredentialVault();
		this.entries = this.readStore();
		for (const entry of this.entries) this.register(entry);
	}

	list(): CustomImageProviderSummary[] {
		return this.entries.map((entry) => ({ ...entry, hasApiKey: this.vault.has(credentialRef(entry.id)) }));
	}

	save(input: CustomImageProviderInput): CustomImageProviderSummary {
		const existing = input.id ? this.entries.find((entry) => entry.id === input.id) : undefined;
		if (input.id && !existing) throw new CustomImageProviderError("not-found", "Image service was not found");
		if (!existing && this.entries.length >= MAX_PROVIDERS) {
			throw new CustomImageProviderError("too-many", `At most ${MAX_PROVIDERS} custom image services are allowed`);
		}
		const name = input.name.trim();
		if (!name || name.length > NAME_MAX_LENGTH) {
			throw new CustomImageProviderError("invalid-name", "Name is required (max 64 characters)");
		}
		const model = input.model.trim();
		if (!model || model.length > MODEL_MAX_LENGTH) {
			throw new CustomImageProviderError("invalid-model", "Model name is required (max 128 characters)");
		}
		const baseUrl = normalizeBaseUrl(input.baseUrl);
		if (!input.supportsTextToImage && !input.supportsImageToImage) {
			throw new CustomImageProviderError("no-capability", "Select at least one of text-to-image or image-to-image");
		}
		const apiKey = input.apiKey?.trim() ?? "";
		const id = existing?.id ?? randomUUID();
		// 换了主机后沿用旧 key，等于把 key 悄悄发给另一个服务；要求重新输入。
		const originChanged = existing !== undefined && new URL(existing.baseUrl).origin !== new URL(baseUrl).origin;
		if (!apiKey && (!existing || originChanged || !this.vault.has(credentialRef(id)))) {
			throw new CustomImageProviderError("api-key-required", "API key is required");
		}
		if (apiKey) {
			if (!this.vault.isAvailable()) {
				throw new CustomImageProviderError(
					"secret-storage-unavailable",
					"Secure credential storage is unavailable on this system",
				);
			}
			this.vault.put(credentialRef(id), apiKey, { kind: "api-key", consumer: "custom-image-provider" });
		}
		const entry: CustomImageProviderEntry = {
			id,
			name,
			baseUrl,
			model,
			supportsTextToImage: input.supportsTextToImage,
			supportsImageToImage: input.supportsImageToImage,
		};
		this.entries = existing
			? this.entries.map((candidate) => (candidate.id === id ? entry : candidate))
			: [...this.entries, entry];
		this.writeStore();
		this.register(entry);
		return { ...entry, hasApiKey: true };
	}

	remove(id: string): void {
		if (!this.entries.some((entry) => entry.id === id)) return;
		this.registrations.get(id)?.dispose();
		this.registrations.delete(id);
		this.entries = this.entries.filter((entry) => entry.id !== id);
		this.writeStore();
		this.vault.remove(credentialRef(id));
	}

	dispose(): void {
		for (const registration of this.registrations.values()) registration.dispose();
		this.registrations.clear();
	}

	private register(entry: CustomImageProviderEntry): void {
		this.registrations.get(entry.id)?.dispose();
		try {
			this.registrations.set(
				entry.id,
				this.registry.registerProvider(
					createOpenAiCompatibleImageProvider(
						this.artifacts,
						entry,
						() => this.readApiKey(entry.id),
						this.options.fetch,
					),
				),
			);
		} catch (error) {
			log.warn("自定义图片服务注册失败", {
				id: entry.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private readApiKey(id: string): string | undefined {
		try {
			return this.vault.get(credentialRef(id));
		} catch (error) {
			// 只记录原因，不记录任何密文或明文。
			log.warn("自定义图片服务的 API Key 无法解密，将按未配置处理", {
				id,
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	}

	private readStore(): CustomImageProviderEntry[] {
		if (!existsSync(this.storePath)) return [];
		try {
			const parsed = JSON.parse(readFileSync(this.storePath, "utf8")) as { providers?: unknown };
			if (!Array.isArray(parsed.providers)) return [];
			return parsed.providers.flatMap((value) => {
				const entry = parseEntry(value);
				return entry ? [entry] : [];
			});
		} catch (error) {
			log.warn("自定义图片服务配置读取失败，按空列表处理", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	private writeStore(): void {
		const file: StoreFile = { schemaVersion: 1, providers: this.entries };
		atomicWriteJSON(this.storePath, file);
	}
}
