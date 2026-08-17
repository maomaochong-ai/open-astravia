import type { UserMessage } from "@vetta/ai";
import type { AgentFeatureDefinition, Clock, ContinuationPolicyContext } from "../kernel/contracts.js";
import type { RuntimeDocumentParticipant } from "../runtime-host/runtime-document-participant.js";

declare const serviceType: unique symbol;
declare const endpointInputType: unique symbol;
declare const endpointOutputType: unique symbol;
declare const signalType: unique symbol;
declare const observationType: unique symbol;

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

export interface SessionExtensionObservationToken<Payload> {
	readonly id: string;
	readonly extensionId: string;
	readonly event: string;
	readonly [observationType]?: Payload;
}

export interface SessionExtensionObservation<Payload = unknown> {
	readonly type: "session.extension";
	readonly extensionId: string;
	readonly event: string;
	readonly payload: Payload;
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

export function defineSessionExtensionObservation<Payload>(
	extensionId: string,
	event: string,
): SessionExtensionObservationToken<Payload> {
	return Object.freeze({
		id: qualifiedId(extensionId, event),
		extensionId: requireId(extensionId, "extension"),
		event: requireId(event, "observation"),
	});
}

export function sessionExtensionObservation<Payload>(
	token: SessionExtensionObservationToken<Payload>,
	payload: Payload,
): SessionExtensionObservation<Payload> {
	return {
		type: "session.extension",
		extensionId: token.extensionId,
		event: token.event,
		payload,
	};
}

export interface SessionExtensionServiceResolver {
	optional<T>(token: SessionExtensionServiceToken<T>): T | undefined;
	require<T>(token: SessionExtensionServiceToken<T>): T;
}

export interface SessionExtensionSignalPublisher {
	publish<Payload>(token: SessionExtensionSignalToken<Payload>, payload: Payload): void;
}

/** Session 宿主可调用的最小扩展控制面；具体 endpoint 仍由扩展实例拥有。 */
export interface SessionExtensionEndpointHost {
	hasEndpoint<Input, Output>(token: SessionExtensionEndpointToken<Input, Output>): boolean;
	invoke<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Promise<Output>;
	invokeSync<Input, Output>(
		token: SessionExtensionEndpointToken<Input, Output>,
		input: Input,
		signal?: AbortSignal,
	): Output;
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

/** 扩展为迟订阅宿主提供的同步初始状态投影。 */
export interface SessionExtensionInitialObservationSource {
	readonly id: string;
	read(): readonly SessionExtensionObservation[];
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
	| { readonly kind: "initial-observation-source"; readonly source: SessionExtensionInitialObservationSource }
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
