import type { UserMessage } from "@vetta/ai";
import type { AgentFeatureDefinition, Clock, ContinuationPolicyContext } from "../kernel/contracts.js";
import type { RuntimeDocumentParticipant } from "../runtime-host/runtime-document-participant.js";

declare const serviceType: unique symbol;
declare const endpointInputType: unique symbol;
declare const endpointOutputType: unique symbol;
declare const signalType: unique symbol;

export interface SessionExtensionServiceToken<T> {
	readonly id: string;
	readonly extensionId: string;
	readonly [serviceType]?: T;
}

export interface SessionExtensionEndpointToken<Input, Output> {
	readonly id: string;
	readonly extensionId: string;
	readonly [endpointInputType]?: Input;
	readonly [endpointOutputType]?: Output;
}

export interface SessionExtensionSignalToken<Payload> {
	readonly id: string;
	readonly extensionId: string;
	readonly [signalType]?: Payload;
}

export function defineSessionExtensionService<T>(extensionId: string, name: string): SessionExtensionServiceToken<T> {
	return Object.freeze({ id: qualifiedId(extensionId, name), extensionId: requireId(extensionId, "extension") });
}

export function defineSessionExtensionEndpoint<Input, Output>(
	extensionId: string,
	name: string,
): SessionExtensionEndpointToken<Input, Output> {
	return Object.freeze({ id: qualifiedId(extensionId, name), extensionId: requireId(extensionId, "extension") });
}

export function defineSessionExtensionSignal<Payload>(
	extensionId: string,
	name: string,
): SessionExtensionSignalToken<Payload> {
	return Object.freeze({ id: qualifiedId(extensionId, name), extensionId: requireId(extensionId, "extension") });
}

export interface SessionExtensionServiceResolver {
	optional<T>(token: SessionExtensionServiceToken<T>): T | undefined;
	require<T>(token: SessionExtensionServiceToken<T>): T;
}

export interface SessionExtensionSignalPublisher {
	publish<Payload>(token: SessionExtensionSignalToken<Payload>, payload: Payload): void;
}

export interface SessionExtensionContext {
	readonly signal: AbortSignal;
	readonly clock: Clock;
	readonly createId: () => string;
	readonly services: SessionExtensionServiceResolver;
	readonly signals: SessionExtensionSignalPublisher;
}

export interface SessionExtensionContinuationSource {
	readonly id: string;
	readonly priority: number;
	collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]>;
}

export interface SessionExtensionServiceContribution<T = unknown> {
	readonly kind: "service";
	readonly token: SessionExtensionServiceToken<T>;
	readonly value: T;
}

export interface SessionExtensionEndpointContribution<Input = unknown, Output = unknown> {
	readonly kind: "endpoint";
	readonly token: SessionExtensionEndpointToken<Input, Output>;
	handle(input: Input, signal: AbortSignal): Promise<Output> | Output;
}

export type SessionExtensionContribution =
	| { readonly kind: "agent-feature"; readonly feature: AgentFeatureDefinition }
	| { readonly kind: "document-participant"; readonly participant: RuntimeDocumentParticipant }
	| { readonly kind: "continuation-source"; readonly source: SessionExtensionContinuationSource }
	| SessionExtensionServiceContribution
	| SessionExtensionEndpointContribution;

export interface SessionExtensionInstance {
	readonly contributions: readonly SessionExtensionContribution[];
	dispose(): Promise<void> | void;
}

export interface SessionExtensionDefinition {
	readonly id: string;
	readonly dependencies?: readonly string[];
	readonly conflicts?: readonly string[];
	create(context: SessionExtensionContext): Promise<SessionExtensionInstance> | SessionExtensionInstance;
}

function qualifiedId(extensionId: string, name: string): string {
	return `${requireId(extensionId, "extension")}.${requireId(name, "member")}`;
}

function requireId(value: string, kind: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`Session extension ${kind} id must not be empty`);
	return normalized;
}
