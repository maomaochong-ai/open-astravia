import type { RuntimeAgentSession } from "@vetta/runtime-core";
import {
	type ModelCallFrame,
	type RuntimeSnapshotLease,
	type RuntimeToolDefinition,
	resolveModelCallFrame,
} from "@vetta/runtime-core/kernel";

export interface AcquiredPreview {
	readonly frame: ModelCallFrame;
	readonly lease: RuntimeSnapshotLease;
}

/** 获取一次真实的 Turn snapshot，但不调用模型 Provider。调用方必须释放 lease。 */
export async function acquirePreview(session: RuntimeAgentSession, operationId: string): Promise<AcquiredPreview> {
	const signal = new AbortController().signal;
	const lease = await session.acquire({
		sessionId: session.id,
		operationId,
		reason: "preview",
		signal,
	});
	try {
		const frame = await resolveModelCallFrame(lease.snapshot, {
			sessionId: session.id,
			turnId: operationId,
			signal,
		});
		return { frame, lease };
	} catch (error) {
		await lease.release();
		throw error;
	}
}

export async function executeTextTool(
	tool: RuntimeToolDefinition,
	input: Readonly<Record<string, unknown>>,
	sessionId: string,
	turnId: string,
): Promise<string> {
	const result = await tool.execute({
		sessionId,
		turnId,
		toolCallId: `${turnId}:${tool.name}`,
		input,
		signal: new AbortController().signal,
	});
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}
