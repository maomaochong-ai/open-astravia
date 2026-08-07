import type { AgentFeatureDefinition, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import {
	type CodingToolActivation,
	createDocToPdfToolRegistration,
	createExtractTextFromImageToolRegistration,
	createExtractTextFromPdfToolRegistration,
	createHtmlToPdfToolRegistration,
	createKbWritePageToolRegistration,
	createProgressToolRegistration,
	createRenderPdfPageToolRegistration,
	type KbWritePageOperations,
	RenderPdfPageProcessAbortedError,
	selectCodingToolRegistrations,
} from "@vetta/runtime-tools/coding";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import { createCodingAgentDesktopCommandPort } from "../runtime-tools/desktop-command-port-adapter.js";
import {
	CodingAgentCommandProcessAbortedError,
	createCodingAgentCommandProcessHost,
	createCodingAgentDocToPdfOperations,
	getCodingAgentOcrExecutionGate,
} from "../runtime-tools/index.js";

export interface CodingAgentGreenfieldProductToolOptions {
	readonly cwd: string;
	readonly knowledgePageWriter: KbWritePageOperations;
}

export interface CodingAgentGreenfieldProductToolFeatureOptions {
	readonly registrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly resolveActivation: (
		context: ModelCallContributionContext,
	) => Promise<CodingToolActivation> | CodingToolActivation;
}

/** 组装产品级 Runtime 工具及其宿主端口；工具执行合同由 runtime-tools 提供。 */
export function createCodingAgentGreenfieldProductToolRegistrations(
	options: CodingAgentGreenfieldProductToolOptions,
): readonly CodingAgentRuntimeToolRegistration[] {
	const commandProcess = createCodingAgentCommandProcessHost();
	const desktop = createCodingAgentDesktopCommandPort(commandProcess);
	const ocrExecutionGate = getCodingAgentOcrExecutionGate();
	return [
		createDocToPdfToolRegistration(options.cwd, {
			operations: createCodingAgentDocToPdfOperations({ commandProcess }),
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.docToPdf,
		}),
		createHtmlToPdfToolRegistration(options.cwd, {
			desktop,
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.htmlToPdf,
		}),
		createExtractTextFromPdfToolRegistration(options.cwd, {
			desktop,
			process: desktop,
			executionGate: ocrExecutionGate,
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.extractTextFromPdf,
		}),
		createExtractTextFromImageToolRegistration(options.cwd, {
			desktop,
			executionGate: ocrExecutionGate,
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.extractTextFromImage,
		}),
		createRenderPdfPageToolRegistration(options.cwd, {
			process: {
				async run(args, signal) {
					try {
						return await commandProcess.run("pdftoppm", args, {
							signal,
							timeoutMs: 5 * 60 * 1_000,
							maxBufferBytes: 4 * 1_024 * 1_024,
						});
					} catch (error) {
						if (error instanceof CodingAgentCommandProcessAbortedError) {
							throw new RenderPdfPageProcessAbortedError();
						}
						throw error;
					}
				},
			},
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.renderPdfPage,
		}),
		createProgressToolRegistration({
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.progress,
		}),
		createKbWritePageToolRegistration({
			operations: options.knowledgePageWriter,
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeWrite,
		}),
	];
}

/** 产品工具按 Session 创建，避免把 Composition Root cwd 固化到其他会话。 */
export function createCodingAgentGreenfieldProductToolFeature(
	options: CodingAgentGreenfieldProductToolFeatureOptions,
): AgentFeatureDefinition {
	return {
		id: "coding-agent.product-tools",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute() {
					return {
						modelCallProviders: [
							{
								id: "coding-agent.product-tools",
								async contribute(callContext) {
									callContext.signal.throwIfAborted();
									const activation = await options.resolveActivation(callContext);
									return {
										tools: selectCodingToolRegistrations(options.registrations, activation).map(
											({ tool }) => tool,
										),
									};
								},
							},
						],
					};
				},
				async dispose() {},
			};
		},
	};
}
