import { type ImageContent, modelsAreEqual, Type } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type { RuntimeToolDefinition, SessionContextRecord } from "@vetta/runtime-core/kernel";
import type {
	ExtensionActions,
	ExtensionError,
	ExtensionRuntime,
	ModelSelectEvent,
	SetModelHandler,
	SlashCommandInfo,
	SlashCommandLocation,
	ToolInfo,
} from "../../extensions/index.js";
import { bindExtensionRuntimeActions } from "../../extensions/index.js";
import type { SessionResourceRuntime } from "../../resources/index.js";
import { CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY } from "../../runtime-contracts/extension-runtime.js";

export interface CodingAgentExtensionActionHostOptions {
	readonly session: GreenfieldRuntimeSession;
	readonly resourceLoader: Pick<SessionResourceRuntime, "getPrompts" | "getSkills">;
	readonly onModelSelect?: (event: ModelSelectEvent) => Promise<void>;
	readonly onError?: (error: ExtensionError) => void;
	readonly now?: () => number;
}

/** Provider/Flag-only Extension 的命令式宿主。 */
export class CodingAgentExtensionActionHost {
	readonly actions: ExtensionActions;
	private readonly pending = new Set<Promise<void>>();
	private mutationTail: Promise<void> = Promise.resolve();
	private sessionNameOverride: string | undefined;
	private disposed = false;

	constructor(private readonly options: CodingAgentExtensionActionHostOptions) {
		const assembly = options.session.createCoreAssembly();
		const toolController = assembly.toolController;
		if (!toolController) throw new Error("Greenfield Extension actions require a Runtime tool controller");
		const now = options.now ?? Date.now;
		const setModel: SetModelHandler = async (model) => {
			await this.mutationTail;
			if (!(await assembly.modelView.resolveApiKey(model))) return false;
			const previousModel = options.session.readState().model;
			await assembly.modelController.selectModel(`${model.provider}/${model.id}`, "always");
			const selectedModel = options.session.readState().model ?? model;
			if (!modelsAreEqual(previousModel, selectedModel)) {
				await options.onModelSelect?.({
					type: "model_select",
					model: selectedModel,
					previousModel,
					source: "set",
				});
			}
			return true;
		};

		this.actions = {
			sendMessage: (message, deliveryOptions) => {
				const record: SessionContextRecord = {
					type: message.customType,
					content: message.content,
					modelVisible: true,
					display: message.display,
					metadata: message.details,
					timestamp: now(),
				};
				const isStreaming = options.session.readState().isStreaming;
				const mode =
					deliveryOptions?.deliverAs === "nextTurn"
						? "nextTurn"
						: isStreaming
							? deliveryOptions?.deliverAs === "followUp"
								? "followUp"
								: "steer"
							: deliveryOptions?.triggerTurn
								? "triggerTurn"
								: "record";
				this.track(assembly.contextDeliveryController.deliver([record], mode), "send_message");
			},
			sendUserMessage: (content, deliveryOptions) => {
				const normalized = normalizeUserContent(content);
				this.track(
					options.session
						.prompt({
							text: normalized.text,
							images: normalized.images,
							streamingBehavior: deliveryOptions?.deliverAs,
							metadata: { [CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY]: "extension" },
						})
						.then(() => undefined),
					"send_user_message",
				);
			},
			appendEntry: (customType, data) => {
				this.enqueueMutation(() => assembly.metadataController.appendEntry(customType, data), "append_entry");
			},
			setSessionName: (name) => {
				this.sessionNameOverride = name;
				this.enqueueMutation(() => assembly.metadataController.setName(name), "set_session_name");
			},
			getSessionName: () => this.sessionNameOverride ?? assembly.metadataController.readName(),
			setLabel: (entryId, label) => {
				this.enqueueMutation(() => assembly.metadataController.setLabel(entryId, label), "set_label");
			},
			getActiveTools: () => [...options.session.readState().activeToolNames],
			getAllTools: () => toToolInfo(toolController.readAvailableTools()),
			setActiveTools: (toolNames) => toolController.setActiveToolNames(toolNames),
			getCommands: () => readResourceCommands(options.resourceLoader),
			setModel,
			getThinkingLevel: () => options.session.readState().thinkingLevel,
			setThinkingLevel: (level) => assembly.modelController.setThinkingLevel(level),
		};
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.mutationTail;
		await Promise.all([...this.pending]);
	}

	bind(runtime: ExtensionRuntime): void {
		bindExtensionRuntimeActions(runtime, this.actions);
	}

	private enqueueMutation(operation: () => Promise<void>, event: string): void {
		if (this.disposed) {
			this.report(event, new Error("Greenfield Extension action host is disposed"));
			return;
		}
		const task = this.mutationTail.then(operation);
		this.mutationTail = task.catch((error: unknown) => {
			this.report(event, error);
		});
	}

	private track(operation: Promise<void>, event: string): void {
		if (this.disposed) {
			this.report(event, new Error("Greenfield Extension action host is disposed"));
			return;
		}
		const tracked = operation
			.catch((error: unknown) => {
				this.report(event, error);
			})
			.finally(() => {
				this.pending.delete(tracked);
			});
		this.pending.add(tracked);
	}

	private report(event: string, error: unknown): void {
		this.options.onError?.({
			extensionPath: "<runtime>",
			event,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	}
}

function normalizeUserContent(content: Parameters<ExtensionActions["sendUserMessage"]>[0]): {
	readonly text: string;
	readonly images: ImageContent[] | undefined;
} {
	if (typeof content === "string") return { text: content, images: undefined };
	const text = content
		.filter((part): part is Extract<(typeof content)[number], { readonly type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const images = content.filter(
		(part): part is Extract<(typeof content)[number], { readonly type: "image" }> => part.type === "image",
	);
	return { text, images: images.length > 0 ? images : undefined };
}

function toToolInfo(tools: ReadonlyMap<string, RuntimeToolDefinition>): ToolInfo[] {
	return [...tools.values()].map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
	}));
}

function readResourceCommands(
	resourceLoader: Pick<SessionResourceRuntime, "getPrompts" | "getSkills">,
): SlashCommandInfo[] {
	const prompts = resourceLoader.getPrompts().prompts.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		location: normalizeLocation(template.source),
		path: template.filePath,
	}));
	const skills = resourceLoader.getSkills().skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		location: normalizeLocation(skill.source),
		path: skill.filePath,
	}));
	return [...prompts, ...skills];
}

function normalizeLocation(source: string): SlashCommandLocation | undefined {
	return source === "user" || source === "project" || source === "path" ? source : undefined;
}
