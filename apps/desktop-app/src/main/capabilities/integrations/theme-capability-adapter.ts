import { randomUUID } from "node:crypto";
import {
	CAPABILITY_CONSTRAINT_KINDS,
	type CapabilityAccessHandle,
	type CapabilityAccessSessionFactory,
	type CapabilityJsonMap,
	createCapabilityGrant,
	FOUNDATION_STORAGE_CAPABILITIES,
	parseCapabilityJsonValue,
} from "@vetta/capability-sdk";

const THEME_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export const THEME_ADAPTER_CONSTANTS = {
	STORAGE_NAMESPACE_PREFIX: "theme:",
	STORAGE_SUBJECT_PREFIX: "system-adapter:theme-storage:",
} as const;

export function isValidThemeAdapterId(themeId: string): boolean {
	return THEME_ID_PATTERN.test(themeId) && !themeId.includes("..");
}

export function themeStorageCapabilityNamespace(themeId: string): string {
	if (!isValidThemeAdapterId(themeId)) throw new Error(`Invalid theme storage themeId: ${themeId}`);
	return `${THEME_ADAPTER_CONSTANTS.STORAGE_NAMESPACE_PREFIX}${themeId}`;
}

export function themeIdFromStorageCapabilityNamespace(namespace: string): string {
	if (!namespace.startsWith(THEME_ADAPTER_CONSTANTS.STORAGE_NAMESPACE_PREFIX)) {
		throw new Error(`Unsupported storage capability namespace: ${namespace}`);
	}
	const themeId = namespace.slice(THEME_ADAPTER_CONSTANTS.STORAGE_NAMESPACE_PREFIX.length);
	if (!isValidThemeAdapterId(themeId)) {
		throw new Error(`Invalid theme storage capability namespace: ${namespace}`);
	}
	return themeId;
}

/** Internal Theme-system adapter. Theme authors consume @vetta/theme-sdk instead. */
export class ThemeCapabilityAdapter {
	private readonly sessions = new Map<string, CapabilityAccessHandle>();

	constructor(private readonly access: CapabilityAccessSessionFactory) {}

	async getStorage(themeId: string): Promise<CapabilityJsonMap> {
		const { client, namespace } = this.getSession(themeId);
		return client.invoke(FOUNDATION_STORAGE_CAPABILITIES.GET_ALL, { namespace });
	}

	async setStorage(themeId: string, key: string, value: unknown): Promise<CapabilityJsonMap> {
		const { client, namespace } = this.getSession(themeId);
		return client.invoke(FOUNDATION_STORAGE_CAPABILITIES.SET, {
			namespace,
			key,
			value: parseCapabilityJsonValue(value),
		});
	}

	async removeStorage(themeId: string, key: string): Promise<CapabilityJsonMap> {
		const { client, namespace } = this.getSession(themeId);
		return client.invoke(FOUNDATION_STORAGE_CAPABILITIES.REMOVE, { namespace, key });
	}

	async clearStorage(themeId: string): Promise<CapabilityJsonMap> {
		const { client, namespace } = this.getSession(themeId);
		return client.invoke(FOUNDATION_STORAGE_CAPABILITIES.CLEAR, { namespace });
	}

	dispose(): void {
		for (const session of this.sessions.values()) session.revoke();
		this.sessions.clear();
	}

	private getSession(themeId: string): {
		readonly client: CapabilityAccessHandle["client"];
		readonly namespace: string;
	} {
		const namespace = themeStorageCapabilityNamespace(themeId);
		let session = this.sessions.get(themeId);
		if (!session || session.isRevoked()) {
			const namespaceConstraint = {
				kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE,
				value: namespace,
			} as const;
			session = this.access.createSession({
				subject: {
					id: `${THEME_ADAPTER_CONSTANTS.STORAGE_SUBJECT_PREFIX}${themeId}`,
					sessionId: randomUUID(),
				},
				grants: [
					createCapabilityGrant(FOUNDATION_STORAGE_CAPABILITIES.GET_ALL, {
						constraints: [namespaceConstraint],
					}),
					createCapabilityGrant(FOUNDATION_STORAGE_CAPABILITIES.SET, {
						constraints: [namespaceConstraint],
					}),
					createCapabilityGrant(FOUNDATION_STORAGE_CAPABILITIES.REMOVE, {
						constraints: [namespaceConstraint],
					}),
					createCapabilityGrant(FOUNDATION_STORAGE_CAPABILITIES.CLEAR, {
						constraints: [namespaceConstraint],
					}),
				],
			});
			this.sessions.set(themeId, session);
		}
		return { client: session.client, namespace };
	}
}
