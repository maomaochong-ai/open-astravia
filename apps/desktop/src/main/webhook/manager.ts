import { randomUUID } from "node:crypto";
import { mainT } from "../i18n/index.js";
import { loadWebhookConfig, saveWebhookConfig } from "./config-store.js";
import {
	loadWebhookCredentials,
	maskWebhookUrl,
	saveWebhookCredentials,
	type WebhookCredentialsMap,
} from "./credential-store.js";
import { getProvider, listProviderDescriptors, type WebhookProviderDescriptor } from "./providers/registry.js";
import type {
	WebhookCreateInput,
	WebhookDispatchResult,
	WebhookEndpointPublic,
	WebhookMessage,
	WebhookSendResult,
	WebhookUpdatePatch,
} from "./types.js";

interface BroadcastOptions {
	onlyKinds?: WebhookEndpointPublic["kind"][];
	onlyIds?: string[];
	/** If true, also dispatches to endpoints with `enabled === false`. */
	includeDisabled?: boolean;
}

/**
 * In-memory snapshot of webhook endpoints. The two source-of-truth files
 * (config + credentials) are joined by endpoint id; the manager keeps them
 * in sync on every mutation and atomically writes both to disk.
 */
export class WebhookManager {
	private endpoints: WebhookEndpointPublic[] = [];
	private credentials: WebhookCredentialsMap = {};

	constructor() {
		this.reload();
	}

	private reload(): void {
		this.endpoints = loadWebhookConfig();
		this.credentials = loadWebhookCredentials();
		// Drop config entries whose credentials are missing — these would
		// always fail to send and clutter the UI.
		const valid: WebhookEndpointPublic[] = [];
		for (const ep of this.endpoints) {
			if (this.credentials[ep.id]?.webhookUrl) {
				valid.push(this.refreshDerived(ep));
			}
		}
		this.endpoints = valid;
	}

	private refreshDerived(ep: WebhookEndpointPublic): WebhookEndpointPublic {
		const cred = this.credentials[ep.id];
		return {
			...ep,
			urlMask: cred ? maskWebhookUrl(cred.webhookUrl) : undefined,
			hasSignSecret: Boolean(cred?.signSecret),
		};
	}

	private persist(): void {
		const stripped = this.endpoints.map((ep) => {
			const { urlMask: _u, hasSignSecret: _h, ...rest } = ep;
			return rest;
		});
		saveWebhookConfig(stripped);
		saveWebhookCredentials(this.credentials);
	}

	listProviderDescriptors(): WebhookProviderDescriptor[] {
		return listProviderDescriptors();
	}

	list(): WebhookEndpointPublic[] {
		return this.endpoints.map((ep) => this.refreshDerived(ep));
	}

	create(input: WebhookCreateInput): WebhookEndpointPublic {
		const trimmedUrl = input.webhookUrl.trim();
		const urlError = getProvider(input.kind).validateUrl(trimmedUrl);
		if (urlError) {
			throw new Error(urlError);
		}
		const displayName = mainT(`common:manageApproval.webhook.${input.kind}`) || getProvider(input.kind).displayName;
		const botSuffix = mainT("common:manageApproval.webhook.botSuffix") || "bot";
		const name = (input.name ?? "").trim() || `${displayName} ${botSuffix}`;
		const id = randomUUID();
		const now = new Date().toISOString();
		const endpoint: WebhookEndpointPublic = {
			id,
			kind: input.kind,
			name,
			enabled: input.enabled ?? true,
			createdAt: now,
			updatedAt: now,
		};
		if (input.feishu) endpoint.feishu = { mentionAll: Boolean(input.feishu.mentionAll) };
		if (input.dingtalk) {
			endpoint.dingtalk = {
				mentionAll: Boolean(input.dingtalk.mentionAll),
				atMobiles: input.dingtalk.atMobiles?.filter((m) => m && m.trim().length > 0),
				keyword: input.dingtalk.keyword?.trim() || undefined,
			};
		}
		this.credentials[id] = {
			webhookUrl: trimmedUrl,
			signSecret: input.signSecret?.trim() || undefined,
		};
		this.endpoints.push(endpoint);
		this.persist();
		return this.refreshDerived(endpoint);
	}

	update(id: string, patch: WebhookUpdatePatch): WebhookEndpointPublic {
		const idx = this.endpoints.findIndex((ep) => ep.id === id);
		if (idx === -1) throw new Error("webhook not found");
		const prev = this.endpoints[idx];
		const cred = this.credentials[id] ?? { webhookUrl: "" };

		const next: WebhookEndpointPublic = { ...prev, updatedAt: new Date().toISOString() };

		if (patch.name !== undefined) {
			const trimmed = patch.name.trim();
			if (!trimmed) throw new Error("名称不能为空");
			next.name = trimmed;
		}
		if (patch.enabled !== undefined) next.enabled = patch.enabled;
		if (patch.feishu !== undefined) {
			next.feishu = { mentionAll: Boolean(patch.feishu.mentionAll) };
		}
		if (patch.dingtalk !== undefined) {
			next.dingtalk = {
				mentionAll: Boolean(patch.dingtalk.mentionAll),
				atMobiles: patch.dingtalk.atMobiles?.filter((m) => m && m.trim().length > 0),
				keyword: patch.dingtalk.keyword?.trim() || undefined,
			};
		}

		const nextCred = { ...cred };
		if (patch.webhookUrl !== undefined) {
			const trimmedUrl = patch.webhookUrl.trim();
			const urlError = getProvider(prev.kind).validateUrl(trimmedUrl);
			if (urlError) throw new Error(urlError);
			nextCred.webhookUrl = trimmedUrl;
		}
		if (patch.signSecret !== undefined) {
			// Empty string clears the secret; undefined leaves it.
			nextCred.signSecret = patch.signSecret.trim() || undefined;
		}

		this.endpoints[idx] = next;
		this.credentials[id] = nextCred;
		this.persist();
		return this.refreshDerived(next);
	}

	delete(id: string): void {
		const before = this.endpoints.length;
		this.endpoints = this.endpoints.filter((ep) => ep.id !== id);
		if (this.endpoints.length === before) return;
		delete this.credentials[id];
		this.persist();
	}

	setEnabled(id: string, enabled: boolean): WebhookEndpointPublic {
		return this.update(id, { enabled });
	}

	async send(id: string, message: WebhookMessage): Promise<WebhookSendResult> {
		const ep = this.endpoints.find((e) => e.id === id);
		if (!ep) return { ok: false, error: "webhook not found" };
		const cred = this.credentials[id];
		if (!cred) return { ok: false, error: "credentials missing" };
		return getProvider(ep.kind).send(ep, cred, message);
	}

	async test(id: string): Promise<WebhookSendResult> {
		const time = new Date().toLocaleString();
		return this.send(id, {
			title: mainT("settings:whTestTitle"),
			text: mainT("settings:whTestText", { time }),
			level: "info",
		});
	}

	async broadcast(message: WebhookMessage, opts: BroadcastOptions = {}): Promise<WebhookDispatchResult[]> {
		const targets = this.endpoints.filter((ep) => {
			if (!opts.includeDisabled && !ep.enabled) return false;
			if (opts.onlyIds && !opts.onlyIds.includes(ep.id)) return false;
			if (opts.onlyKinds && !opts.onlyKinds.includes(ep.kind)) return false;
			return true;
		});
		const results = await Promise.all(
			targets.map(async (ep): Promise<WebhookDispatchResult> => {
				const r = await this.send(ep.id, message);
				return { id: ep.id, kind: ep.kind, name: ep.name, ok: r.ok, error: r.error };
			}),
		);
		return results;
	}
}
