import type { AgentFeatureDefinition, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import {
	type CodingToolActivation,
	type CodingToolRegistration,
	selectCodingToolRegistrations,
} from "@vetta/runtime-tools";
import {
	type CodingAgentKnowledgeWriteOperations,
	createCodingAgentKnowledgeWritePageToolRegistration,
} from "../../features/knowledge/index.js";
import { createProgressToolRegistration } from "../../features/progress/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";

export interface CodingAgentSpecializedToolOptions {
	readonly platformRegistrations?: readonly CodingToolRegistration[];
	readonly knowledgePageWriter?: CodingAgentKnowledgeWriteOperations;
}

export interface CodingAgentSpecializedToolFeatureOptions {
	readonly registrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly resolveActivation: (
		context: ModelCallContributionContext,
	) => Promise<CodingToolActivation> | CodingToolActivation;
}

/** 组装宿主专用 Tool 与 Coding Agent 的进度、知识写入产品 Tool。 */
export function createCodingAgentSpecializedToolRegistrations(
	options: CodingAgentSpecializedToolOptions,
): readonly CodingAgentRuntimeToolRegistration[] {
	return [
		...(options.platformRegistrations ?? []).map(withCodingAgentSpecializedToolOrder),
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

const SPECIALIZED_TOOL_MODEL_ORDER: Readonly<Record<string, number>> = {
	doc_to_pdf: CODING_AGENT_MODEL_TOOL_ORDER.docToPdf,
	html_to_pdf: CODING_AGENT_MODEL_TOOL_ORDER.htmlToPdf,
	extract_text_from_pdf: CODING_AGENT_MODEL_TOOL_ORDER.extractTextFromPdf,
	extract_text_from_img: CODING_AGENT_MODEL_TOOL_ORDER.extractTextFromImage,
	render_pdf_page: CODING_AGENT_MODEL_TOOL_ORDER.renderPdfPage,
};

function withCodingAgentSpecializedToolOrder(registration: CodingToolRegistration): CodingAgentRuntimeToolRegistration {
	const modelOrder = SPECIALIZED_TOOL_MODEL_ORDER[registration.tool.name];
	if (modelOrder === undefined) return registration;
	return {
		...registration,
		modelOrder,
		tool: { ...registration.tool, modelOrder },
	};
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
