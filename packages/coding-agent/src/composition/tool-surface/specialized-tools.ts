import type { AgentFeatureDefinition, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import {
	createDocToPdfToolRegistration,
	createExtractTextFromImageToolRegistration,
	createExtractTextFromPdfToolRegistration,
	createHtmlToPdfToolRegistration,
	createNodeCommandProcessHost,
	createNodeDocToPdfOperations,
	createNodeVettaDesktopCommandPort,
	createProgressToolRegistration,
	createRenderPdfPageToolRegistration,
	NodeCommandProcessAbortedError,
	RenderPdfPageProcessAbortedError,
} from "@vetta/runtime-node/coding";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools";
import {
	type CodingAgentKnowledgeWriteOperations,
	createCodingAgentKnowledgeWritePageToolRegistration,
} from "../../features/knowledge/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import { getCodingAgentOcrExecutionGate } from "../../tool-policy/ocr-execution-gate.js";

export interface CodingAgentSpecializedToolOptions {
	readonly cwd: string;
	readonly knowledgePageWriter?: CodingAgentKnowledgeWriteOperations;
}

export interface CodingAgentSpecializedToolFeatureOptions {
	readonly registrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly resolveActivation: (
		context: ModelCallContributionContext,
	) => Promise<CodingToolActivation> | CodingToolActivation;
}

/** 组装文档、OCR、进度与知识写入工具；工具执行合同由 runtime-tools 提供。 */
export function createCodingAgentSpecializedToolRegistrations(
	options: CodingAgentSpecializedToolOptions,
): readonly CodingAgentRuntimeToolRegistration[] {
	const commandProcess = createNodeCommandProcessHost();
	const desktop = createNodeVettaDesktopCommandPort({ commandProcess });
	const ocrExecutionGate = getCodingAgentOcrExecutionGate();
	return [
		createDocToPdfToolRegistration(options.cwd, {
			operations: createNodeDocToPdfOperations({ commandProcess }),
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
						if (error instanceof NodeCommandProcessAbortedError) {
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
		...(options.knowledgePageWriter
			? [
					createCodingAgentKnowledgeWritePageToolRegistration({
						operations: options.knowledgePageWriter,
						modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.knowledgeWrite,
					}),
				]
			: []),
	];
}

/** 专用工具按 Session 创建，避免把 Composition Root cwd 固化到其他会话。 */
export function createCodingAgentSpecializedToolFeature(
	options: CodingAgentSpecializedToolFeatureOptions,
): AgentFeatureDefinition {
	return {
		id: "coding-agent.specialized-tools",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute() {
					return {
						modelCallProviders: [
							{
								id: "coding-agent.specialized-tools",
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
