declare const observationPayloadType: unique symbol;

export type RuntimeObservationLevel = "debug" | "info" | "warning" | "error";

export interface RuntimeObservationToken<Payload> {
	readonly id: string;
	readonly domain: string;
	readonly event: string;
	readonly level: RuntimeObservationLevel;
	readonly [observationPayloadType]?: Payload;
}

export interface RuntimeObservationContext {
	readonly agentId?: string;
	readonly revisionId?: string;
	readonly instanceId?: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly modelCallId?: string;
	readonly toolCallId?: string;
	readonly traceId?: string;
}

export interface RuntimeObservationRecord<Payload = unknown> {
	readonly token: RuntimeObservationToken<Payload>;
	readonly context: RuntimeObservationContext;
	readonly timestamp: number;
	readonly payload: Payload;
}

/** 具体日志、Trace、Metrics、JSONL 或 UI Adapter 实现的唯一输出端口。 */
export interface RuntimeObservationPort {
	record(observation: RuntimeObservationRecord): Promise<void> | void;
	flush?(): Promise<void>;
}

/** 已绑定安全 identity scope 的领域发布器；实现失败不得传播到主流程。 */
export interface RuntimeObservationPublisher {
	record<Payload>(
		token: RuntimeObservationToken<Payload>,
		payload: Payload,
		context?: RuntimeObservationContext,
	): void;
	scope(context: RuntimeObservationContext): RuntimeObservationPublisher;
	flush(): Promise<void>;
}

export interface RuntimeObservationFailure {
	readonly category: "cancelled" | "error";
	readonly errorName: string;
	readonly errorCode?: string;
}

export interface RuntimeObservationPublisherOptions {
	readonly port?: RuntimeObservationPort;
	readonly context?: RuntimeObservationContext;
	readonly now?: () => number;
	/** 只接收 Port 自身失败；回调同样被隔离，不能改变业务结果。 */
	readonly onPortError?: (error: unknown) => void;
}
