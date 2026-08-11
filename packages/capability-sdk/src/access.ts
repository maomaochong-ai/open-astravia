import type { CapabilityId, CapabilityToken } from "./contracts.js";

export const CAPABILITY_CONSTRAINT_KINDS = {
	NAMESPACE: "namespace",
} as const;

export type CapabilityConstraintKind = (typeof CAPABILITY_CONSTRAINT_KINDS)[keyof typeof CAPABILITY_CONSTRAINT_KINDS];

export interface CapabilityConstraint {
	readonly kind: CapabilityConstraintKind | (string & {});
	readonly value: string;
}

export interface CapabilityGrant {
	readonly capabilityId: CapabilityId;
	readonly constraints?: readonly CapabilityConstraint[];
	readonly expiresAt?: number;
}

export interface AccessSubject {
	readonly id: string;
	readonly sessionId: string;
}

export interface CapabilityAccessSessionOptions {
	readonly subject: AccessSubject;
	readonly grants: readonly CapabilityGrant[];
	readonly expiresAt?: number;
}

export interface CapabilityInvokeOptions {
	readonly signal?: AbortSignal;
	readonly deadline?: number;
}

export interface AuthorizedCapabilityClient {
	invoke<Input, Output>(
		capability: CapabilityToken<Input, Output>,
		input: Input,
		options?: CapabilityInvokeOptions,
	): Promise<Output>;
}

export interface CapabilityAccessHandle {
	readonly client: AuthorizedCapabilityClient;
	readonly subject: AccessSubject;
	isRevoked(): boolean;
	revoke(): void;
}

/** Host-provided boundary for creating authorized capability sessions. */
export interface CapabilityAccessSessionFactory {
	createSession(options: CapabilityAccessSessionOptions): CapabilityAccessHandle;
}

export function createCapabilityGrant<Input, Output>(
	capability: CapabilityToken<Input, Output>,
	options: Omit<CapabilityGrant, "capabilityId"> = {},
): CapabilityGrant {
	return Object.freeze({
		capabilityId: capability.id,
		...(options.constraints === undefined ? {} : { constraints: Object.freeze([...options.constraints]) }),
		...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
	});
}
