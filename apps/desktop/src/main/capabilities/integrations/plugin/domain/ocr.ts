import { DOMAIN_OCR_CAPABILITIES, type OcrProviderDescriptor, type OcrResult } from "@vetta/capability-sdk";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginOcrMethods = {
	listOcrProviders(this: PluginCapabilitySessionAccess, sessionId: string): Promise<OcrProviderDescriptor[]> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.OCR_RECOGNIZE }).invoke(
			DOMAIN_OCR_CAPABILITIES.LIST_PROVIDERS,
			{},
		);
	},
	recognizeOcr(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<OcrResult> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.OCR_RECOGNIZE });
		if (!input || typeof input !== "object" || !Array.isArray((input as { inputs?: unknown }).inputs))
			throw new Error("OCR inputs are required");
		const normalized = {
			...(input as Record<string, unknown>),
			ownerId: session.pluginId,
			inputs: (input as { inputs: unknown[] }).inputs.map((item) => {
				if (!item || typeof item !== "object") return item;
				const value = item as Record<string, unknown>;
				const source = value.source;
				if (!source || typeof source !== "object") return value;
				const sourceValue = source as Record<string, unknown>;
				if (sourceValue.type === "plugin-blob") {
					this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
					return {
						...value,
						source: { type: "storage-blob", namespace: session.pluginId, id: sourceValue.blobId },
					};
				}
				if (sourceValue.type === "workspace-file")
					this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ });
				return value;
			}),
		};
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.OCR_RECOGNIZE }).invoke(
			DOMAIN_OCR_CAPABILITIES.RECOGNIZE,
			DOMAIN_OCR_CAPABILITIES.RECOGNIZE.parseInput(normalized),
		);
	},
};

export type PluginOcrMethods = typeof pluginOcrMethods;
