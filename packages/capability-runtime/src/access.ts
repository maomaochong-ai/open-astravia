import {
	type AccessSubject,
	type AuthorizedCapabilityClient,
	CAPABILITY_ERROR_CODES,
	type CapabilityAccessHandle,
	type CapabilityAccessSessionOptions,
	type CapabilityConstraint,
	CapabilityError,
	type CapabilityGrant,
	type CapabilityId,
	type CapabilityInvokeOptions,
	type CapabilityToken,
} from "@vetta/capability-sdk";
import { type CapabilityConstraintEvaluator, namespaceConstraintEvaluator } from "./constraints.js";
import type { CapabilityHub } from "./hub.js";

export const CAPABILITY_ACCESS_DECISIONS = {
	ALLOW: "allow",
	DENY: "deny",
} as const;

export const CAPABILITY_ACCESS_REASONS = {
	GRANTED: "granted",
	GRANT_EXPIRED: "grant-expired",
	INVALID_CONSTRAINT: "invalid-constraint",
	MISSING_GRANT: "missing-grant",
	SESSION_EXPIRED: "session-expired",
	SESSION_REVOKED: "session-revoked",
} as const;

export interface CapabilityAccessAuditEvent {
	readonly capabilityId: CapabilityId;
	readonly decision: (typeof CAPABILITY_ACCESS_DECISIONS)[keyof typeof CAPABILITY_ACCESS_DECISIONS];
	readonly reason: (typeof CAPABILITY_ACCESS_REASONS)[keyof typeof CAPABILITY_ACCESS_REASONS];
	readonly subject: AccessSubject;
	readonly timestamp: number;
}

export interface CapabilityAccessControllerOptions {
	readonly audit?: (event: CapabilityAccessAuditEvent) => void;
	readonly constraintEvaluators?: readonly CapabilityConstraintEvaluator[];
}

interface CapabilityAccessSessionSnapshot {
	readonly expiresAt?: number;
	readonly subject: AccessSubject;
}

function createCombinedSignal(
	sessionSignal: AbortSignal,
	requestSignal: AbortSignal | undefined,
	deadline: number | undefined,
): AbortSignal {
	const signals = requestSignal ? [sessionSignal, requestSignal] : [sessionSignal];
	if (deadline !== undefined) {
		const remainingMs = Math.max(0, Math.min(2_147_483_647, Math.ceil(deadline - Date.now())));
		signals.push(AbortSignal.timeout(remainingMs));
	}
	return signals.length === 1 ? sessionSignal : AbortSignal.any(signals);
}

export class CapabilityAccessController {
	private readonly audit?: (event: CapabilityAccessAuditEvent) => void;
	private readonly constraintEvaluators = new Map<string, CapabilityConstraintEvaluator>();

	constructor(
		private readonly hub: CapabilityHub,
		options: CapabilityAccessControllerOptions = {},
	) {
		this.audit = options.audit;
		for (const evaluator of [namespaceConstraintEvaluator, ...(options.constraintEvaluators ?? [])]) {
			this.constraintEvaluators.set(evaluator.kind, evaluator);
		}
	}

	createSession(options: CapabilityAccessSessionOptions): CapabilityAccessHandle {
		if (options.subject.id.trim().length === 0 || options.subject.sessionId.trim().length === 0) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ACCESS_DENIED, "Capability access subject is invalid");
		}
		if (options.expiresAt !== undefined && !Number.isFinite(options.expiresAt)) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.SESSION_EXPIRED, "Capability session expiry is invalid");
		}
		const session: CapabilityAccessSessionSnapshot = Object.freeze({
			subject: Object.freeze({ ...options.subject }),
			...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
		});
		const grants = new Map<CapabilityId, CapabilityGrant>();
		for (const grant of options.grants) {
			if (grant.expiresAt !== undefined && !Number.isFinite(grant.expiresAt)) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.ACCESS_DENIED,
					`Capability grant expiry is invalid: ${grant.capabilityId}`,
				);
			}
			if (!this.hub.has(grant.capabilityId)) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.NOT_FOUND,
					`Cannot grant unregistered capability: ${grant.capabilityId}`,
				);
			}
			if (grants.has(grant.capabilityId)) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.ACCESS_DENIED,
					`Capability session contains duplicate grant: ${grant.capabilityId}`,
				);
			}
			grants.set(
				grant.capabilityId,
				Object.freeze({
					capabilityId: grant.capabilityId,
					...(grant.constraints === undefined
						? {}
						: {
								constraints: Object.freeze(
									grant.constraints.map((constraint) => Object.freeze({ ...constraint })),
								),
							}),
					...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
				}),
			);
		}

		const sessionController = new AbortController();
		let revoked = false;
		const client: AuthorizedCapabilityClient = {
			invoke: <Input, Output>(
				capability: CapabilityToken<Input, Output>,
				input: Input,
				invokeOptions?: CapabilityInvokeOptions,
			): Promise<Output> =>
				this.invoke(session, grants, sessionController.signal, () => revoked, capability, input, invokeOptions),
		};
		return {
			client,
			subject: session.subject,
			isRevoked: () => revoked,
			revoke: () => {
				if (revoked) return;
				revoked = true;
				sessionController.abort();
			},
		};
	}

	private async invoke<Input, Output>(
		session: CapabilityAccessSessionSnapshot,
		grants: ReadonlyMap<CapabilityId, CapabilityGrant>,
		sessionSignal: AbortSignal,
		isRevoked: () => boolean,
		capability: CapabilityToken<Input, Output>,
		input: Input,
		options: CapabilityInvokeOptions | undefined,
	): Promise<Output> {
		if (isRevoked()) {
			this.record(
				session.subject,
				capability.id,
				CAPABILITY_ACCESS_DECISIONS.DENY,
				CAPABILITY_ACCESS_REASONS.SESSION_REVOKED,
			);
			throw new CapabilityError(CAPABILITY_ERROR_CODES.SESSION_REVOKED, "Capability access session is revoked");
		}
		if (session.expiresAt !== undefined && session.expiresAt <= Date.now()) {
			this.record(
				session.subject,
				capability.id,
				CAPABILITY_ACCESS_DECISIONS.DENY,
				CAPABILITY_ACCESS_REASONS.SESSION_EXPIRED,
			);
			throw new CapabilityError(CAPABILITY_ERROR_CODES.SESSION_EXPIRED, "Capability access session is expired");
		}
		const grant = grants.get(capability.id);
		if (!grant) {
			this.record(
				session.subject,
				capability.id,
				CAPABILITY_ACCESS_DECISIONS.DENY,
				CAPABILITY_ACCESS_REASONS.MISSING_GRANT,
			);
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ACCESS_DENIED, `Capability access denied: ${capability.id}`);
		}
		if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) {
			this.record(
				session.subject,
				capability.id,
				CAPABILITY_ACCESS_DECISIONS.DENY,
				CAPABILITY_ACCESS_REASONS.GRANT_EXPIRED,
			);
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ACCESS_DENIED, `Capability grant expired: ${capability.id}`);
		}
		const parsedInput = capability.parseInput(input);
		for (const constraint of grant.constraints ?? []) {
			this.assertConstraint(session.subject, capability.id, constraint, parsedInput);
		}
		this.record(session.subject, capability.id, CAPABILITY_ACCESS_DECISIONS.ALLOW, CAPABILITY_ACCESS_REASONS.GRANTED);

		const signal = createCombinedSignal(sessionSignal, options?.signal, options?.deadline);
		if (signal.aborted) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, `Capability invocation aborted: ${capability.id}`);
		}
		return this.hub.invoke(capability, parsedInput, {
			signal,
			traceId: globalThis.crypto.randomUUID(),
			deadline: options?.deadline,
		});
	}

	private assertConstraint(
		subject: AccessSubject,
		capabilityId: CapabilityId,
		constraint: CapabilityConstraint,
		input: unknown,
	): void {
		const evaluator = this.constraintEvaluators.get(constraint.kind);
		if (!evaluator || !evaluator.evaluate({ capabilityId, constraint, input })) {
			this.record(
				subject,
				capabilityId,
				CAPABILITY_ACCESS_DECISIONS.DENY,
				CAPABILITY_ACCESS_REASONS.INVALID_CONSTRAINT,
			);
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.INVALID_CONSTRAINT,
				`Capability constraint rejected: ${capabilityId}/${constraint.kind}`,
			);
		}
	}

	private record(
		subject: AccessSubject,
		capabilityId: CapabilityId,
		decision: CapabilityAccessAuditEvent["decision"],
		reason: CapabilityAccessAuditEvent["reason"],
	): void {
		this.audit?.({ capabilityId, decision, reason, subject, timestamp: Date.now() });
	}
}
