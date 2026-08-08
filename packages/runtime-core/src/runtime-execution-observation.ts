import type { ToolPhase } from "@vetta/agent-core";
import type { AssistantMessageEvent, Message, ToolResultMessage } from "@vetta/ai";
import type { RuntimeToolResult, SessionContextRecord } from "./kernel/contracts.js";

/** 非外部用户输入的消息来源；缺省的 user 消息视为真实用户输入。 */
export interface RuntimeMessageOrigin {
	readonly kind: "continuation";
	readonly source: string;
}

/** 保留产品上下文身份的执行期消息信封；不进入模型消息或 Conversation 投影。 */
export type RuntimeMessageEnvelope =
	| {
			readonly kind: "message";
			readonly message: Message;
			readonly origin?: RuntimeMessageOrigin;
	  }
	| {
			readonly kind: "context";
			readonly record: SessionContextRecord;
			readonly timestamp: number;
	  }
	| {
			/** 产品消息身份；Kernel 只负责在调用期原样传递。 */
			readonly kind: "opaque";
			readonly identity: unknown;
			/** 该身份对应的模型投影；缺省表示模型不可见。 */
			readonly modelMessage?: Message;
			readonly timestamp: number;
	  };

/**
 * Turn Engine 暴露给 Session 级运行时适配器的完整执行观察事件。
 *
 * 它与面向应用的 SessionEvent 分离：这里保留 Extension 等执行期适配器需要的
 * 消息、工具结果和时序，同时不引入任何产品事件类型。
 */
export type RuntimeExecutionObservationEvent =
	| { readonly type: "agent.start" }
	| {
			readonly type: "agent.end";
			readonly messages: readonly RuntimeMessageEnvelope[];
	  }
	| { readonly type: "turn.start" }
	| {
			readonly type: "turn.end";
			readonly message: Message;
			readonly toolResults: readonly ToolResultMessage[];
	  }
	| {
			readonly type: "message.start";
			readonly message: RuntimeMessageEnvelope;
	  }
	| {
			readonly type: "message.update";
			readonly message: RuntimeMessageEnvelope;
			readonly assistantMessageEvent: AssistantMessageEvent;
	  }
	| {
			readonly type: "message.end";
			readonly message: RuntimeMessageEnvelope;
	  }
	| {
			readonly type: "tool.execution.start";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly args: unknown;
			readonly startedAt: number;
	  }
	| {
			readonly type: "tool.execution.update";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly args: unknown;
			readonly partialResult: RuntimeToolResult;
	  }
	| {
			readonly type: "tool.execution.phase";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly label: string;
			readonly atMs: number;
	  }
	| {
			readonly type: "tool.execution.end";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly result: RuntimeToolResult;
			readonly isError: boolean;
			readonly startedAt: number;
			readonly durationMs: number;
			readonly phases: readonly ToolPhase[];
	  };
