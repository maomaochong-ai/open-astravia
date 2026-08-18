import { randomUUID } from "node:crypto";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { WebContents } from "electron";
import type { PluginAppActionRegistration } from "../../preload/api-types/plugins.js";
import { PLUGIN_CONTRIBUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import type { AppActionCatalog } from "../app-actions/catalog.js";
import {
	type ActionApprovalMetadata,
	type ActionContext,
	type ActionDefinition,
	ActionError,
	type JsonValue,
} from "../app-actions/types.js";
import { getAppLogger } from "../logger.js";
import { CORE_ACTION_PLUGIN_ID, getPluginSettings, listPlugins } from "./plugin-catalog.js";

const REGISTER_PERMISSION = "app.actions.register";
const EXECUTE_PERMISSION = "app.actionHandler.execute";
const DEFAULT_TIMEOUT_MS = 30_000;

const log = getAppLogger("plugin-action");
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

interface RegisteredPluginAction {
	activationId: string;
	handlerId: string;
	localActionId: string;
	globalActionId: string;
	timeoutMs: number;
	definition: ActionDefinition;
	unregisterCatalogAction?: () => void;
}

interface PluginActionActivation {
	activationId: string;
	actions: Map<string, RegisteredPluginAction>;
}

interface PendingInvocation {
	pluginId: string;
	handlerId: string;
	timer: ReturnType<typeof setTimeout>;
	signal?: AbortSignal;
	onAbort?: () => void;
	resolve: (value: JsonValue) => void;
	reject: (error: ActionError) => void;
}

function toJsonValue(value: unknown, code: string, message: string): JsonValue {
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new Error("Value is undefined");
		return JSON.parse(serialized) as JsonValue;
	} catch (error) {
		log.warn("JSON serialization failed", {
			code,
			error: error instanceof Error ? error.message : String(error),
		});
		throw new ActionError(code, message);
	}
}

function summarizeValidationErrors(errors: ErrorObject[] | null | undefined): JsonValue {
	return (errors ?? []).map((error) => ({
		path: error.instancePath,
		keyword: error.keyword,
		message: error.message ?? "JSON Schema validation failed",
	}));
}

function hasPermission(pluginId: string, permission: typeof REGISTER_PERMISSION | typeof EXECUTE_PERMISSION): boolean {
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	return Boolean(
		plugin?.enabled && plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission),
	);
}

function assertPluginAvailable(pluginId: string): void {
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin?.enabled) {
		throw new ActionError("PLUGIN_ACTION_UNAVAILABLE", `Plugin not found or disabled: ${pluginId}`);
	}
}

function assertPluginCanRegister(pluginId: string): void {
	assertPluginAvailable(pluginId);
	if (!hasPermission(pluginId, REGISTER_PERMISSION)) {
		throw new ActionError("PLUGIN_PERMISSION_DENIED", `Plugin permission denied: ${REGISTER_PERMISSION}`);
	}
}

function assertPluginCanExecute(pluginId: string): void {
	assertPluginCanRegister(pluginId);
	if (!hasPermission(pluginId, EXECUTE_PERMISSION)) {
		throw new ActionError("PLUGIN_PERMISSION_DENIED", `Plugin permission denied: ${EXECUTE_PERMISSION}`);
	}
}

function isTrustedOfficialPlugin(pluginId: string): boolean {
	return listPlugins().some((plugin) => plugin.id === pluginId && plugin.trustLevel === "official");
}

function buildGlobalActionId(pluginId: string, localActionId: string, publicId: string | undefined): string {
	if (publicId) {
		if (!isTrustedOfficialPlugin(pluginId)) {
			throw new ActionError(
				"PLUGIN_ACTION_RESERVED_ID_DENIED",
				`Only trusted official plugins can register a public action id: ${publicId}`,
			);
		}
		return publicId;
	}
	return `plugin.${pluginId}.${localActionId}`;
}

function buildProviderId(pluginId: string, activationId: string): string {
	return `plugin:${pluginId}:${activationId}`;
}

function buildApprovalMetadata(
	pluginId: string,
	registration: PluginAppActionRegistration,
): ActionApprovalMetadata | undefined {
	if (registration.effect === "read") {
		if (registration.approval) {
			throw new ActionError(
				"PLUGIN_ACTION_APPROVAL_INVALID",
				"Read-only plugin actions cannot declare approval UI.",
			);
		}
		return undefined;
	}
	if (!registration.approval) {
		return {
			defaultPresentation: "generic",
			presentations: [
				{
					id: "generic",
					title: registration.title,
					description: registration.description ?? registration.summary,
				},
			],
		};
	}
	if (!isTrustedOfficialPlugin(pluginId)) {
		throw new ActionError(
			"PLUGIN_ACTION_APPROVAL_DENIED",
			"Only trusted official plugins can select host approval presentations.",
		);
	}
	const approval = registration.approval;
	if (
		typeof approval.defaultPresentation !== "string" ||
		approval.defaultPresentation.length === 0 ||
		!Array.isArray(approval.presentations) ||
		approval.presentations.length === 0 ||
		(approval.presentationByOperation !== undefined &&
			(typeof approval.presentationByOperation !== "object" ||
				approval.presentationByOperation === null ||
				Array.isArray(approval.presentationByOperation)))
	) {
		throw new ActionError("PLUGIN_ACTION_APPROVAL_INVALID", "Plugin action approval metadata is incomplete.");
	}
	const presentations = [...approval.presentations];
	if (!presentations.some((presentation) => presentation.id === "generic")) {
		presentations.push({
			id: "generic",
			title: registration.title,
			description: registration.description ?? registration.summary,
		});
	}
	const presentationIds = new Set<string>();
	for (const presentation of presentations) {
		if (
			typeof presentation !== "object" ||
			presentation === null ||
			typeof presentation.id !== "string" ||
			presentation.id.length === 0 ||
			typeof presentation.title !== "string" ||
			presentation.title.length === 0 ||
			typeof presentation.description !== "string" ||
			presentation.description.length === 0 ||
			presentationIds.has(presentation.id)
		) {
			throw new ActionError("PLUGIN_ACTION_APPROVAL_INVALID", "Plugin action approval presentations are invalid.");
		}
		presentationIds.add(presentation.id);
	}
	if (!presentationIds.has(approval.defaultPresentation)) {
		throw new ActionError(
			"PLUGIN_ACTION_APPROVAL_INVALID",
			"Plugin action default approval presentation must be declared.",
		);
	}
	for (const presentation of Object.values(approval.presentationByOperation ?? {})) {
		if (!presentationIds.has(presentation)) {
			throw new ActionError(
				"PLUGIN_ACTION_APPROVAL_INVALID",
				`Plugin action operation references an undeclared approval presentation: ${presentation}`,
			);
		}
	}
	for (const alternatives of Object.values(approval.alternativePresentationsByOperation ?? {})) {
		if (!Array.isArray(alternatives) || alternatives.some((presentation) => !presentationIds.has(presentation))) {
			throw new ActionError(
				"PLUGIN_ACTION_APPROVAL_INVALID",
				"Plugin action operation references an undeclared alternative approval presentation.",
			);
		}
	}
	return {
		defaultPresentation: approval.defaultPresentation,
		presentations,
	};
}

function prepareApprovalInput(
	input: JsonValue,
	registration: PluginAppActionRegistration,
): { schemaInput: JsonValue; requestedPresentation?: string } {
	if (!registration.approval || typeof input !== "object" || input === null || Array.isArray(input)) {
		return { schemaInput: input };
	}
	if (typeof input.approvalUi !== "string") return { schemaInput: input };
	const { approvalUi, ...schemaInput } = input;
	return { schemaInput, requestedPresentation: approvalUi };
}

function applyApprovalPresentation(
	input: JsonValue,
	requestedPresentation: string | undefined,
	registration: PluginAppActionRegistration,
): JsonValue {
	if (!registration.approval || typeof input !== "object" || input === null || Array.isArray(input)) return input;
	// appearance/navigation 等用 type 字段区分操作；多数域用 operation。
	const operation =
		typeof input.operation === "string" ? input.operation : typeof input.type === "string" ? input.type : undefined;
	const mappedPresentation =
		(operation ? registration.approval.presentationByOperation?.[operation] : undefined) ??
		registration.approval.defaultPresentation;
	const allowedAlternatives = operation
		? (registration.approval.alternativePresentationsByOperation?.[operation] ?? [])
		: [];
	const presentation =
		requestedPresentation === undefined || requestedPresentation === mappedPresentation
			? mappedPresentation
			: requestedPresentation === "generic" || allowedAlternatives.includes(requestedPresentation)
				? requestedPresentation
				: (() => {
						throw new ActionError(
							"ACTION_INVALID_INPUT",
							`Approval UI does not match operation: ${operation ?? "unknown"}`,
							{
								...(operation === undefined ? {} : { operation }),
								requestedPresentation,
								allowed: [mappedPresentation, "generic", ...allowedAlternatives],
							},
						);
					})();
	return { ...input, approvalUi: presentation };
}

export class PluginActionService {
	private readonly activeActivations = new Map<string, PluginActionActivation>();
	private readonly stagingActivations = new Map<string, PluginActionActivation>();
	private readonly pendingInvocations = new Map<string, PendingInvocation>();

	constructor(
		private readonly webContents: WebContents,
		private readonly catalog: AppActionCatalog,
	) {}

	beginLoad(pluginId: string, activationId: string): void {
		assertPluginAvailable(pluginId);
		this.stagingActivations.set(pluginId, {
			activationId,
			actions: new Map<string, RegisteredPluginAction>(),
		});
		log.info("activation began", { pluginId, activationId });
	}

	register(pluginId: string, registration: PluginAppActionRegistration): void {
		assertPluginCanExecute(pluginId);
		const staging = this.stagingActivations.get(pluginId);
		const active = this.activeActivations.get(pluginId);
		const activation =
			staging?.activationId === registration.activationId
				? staging
				: active?.activationId === registration.activationId
					? active
					: undefined;
		if (!activation) {
			throw new ActionError("PLUGIN_ACTION_STALE_ACTIVATION", `Stale plugin action activation: ${pluginId}`);
		}

		if (activation.actions.has(registration.id)) {
			throw new ActionError(
				"PLUGIN_ACTION_DUPLICATE",
				`Plugin action is already registered: ${pluginId}/${registration.id}`,
			);
		}

		const inputSchema = toJsonValue(
			registration.inputSchema,
			"PLUGIN_ACTION_SCHEMA_INVALID",
			`Plugin action schema is not JSON serializable: ${pluginId}/${registration.id}`,
		);
		let validateInput: ValidateFunction<unknown>;
		try {
			validateInput = ajv.compile(inputSchema as object);
		} catch (error) {
			throw new ActionError(
				"PLUGIN_ACTION_SCHEMA_INVALID",
				`Invalid JSON Schema for plugin action ${pluginId}/${registration.id}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		const examples = registration.examples.map((example) => ({
			description: example.description,
			input: toJsonValue(
				example.input,
				"PLUGIN_ACTION_SCHEMA_INVALID",
				`Plugin action example is not JSON serializable: ${pluginId}/${registration.id}`,
			),
		}));
		const globalActionId = buildGlobalActionId(pluginId, registration.id, registration.publicId);
		const approval = buildApprovalMetadata(pluginId, registration);
		let registered: RegisteredPluginAction;
		const definition: ActionDefinition = {
			id: globalActionId,
			domain: registration.publicId
				? (registration.publicId.split(".")[0] ?? `plugin.${pluginId}`)
				: `plugin.${pluginId}`,
			title: registration.title,
			summary: registration.summary,
			availability: "gui-renderer",
			permission: `plugin.${pluginId}.app-action.${registration.effect}`,
			keywords: registration.keywords,
			approval,
			inputSchema: {
				description: registration.description ?? registration.summary,
				jsonSchema: inputSchema,
			},
			examples,
			validateInput: (input) => {
				const normalizedInput = toJsonValue(
					input,
					"ACTION_INVALID_INPUT",
					`Input is not JSON serializable for ${globalActionId}`,
				);
				const { schemaInput, requestedPresentation } = prepareApprovalInput(normalizedInput, registration);
				if (!validateInput(schemaInput)) {
					throw new ActionError("ACTION_INVALID_INPUT", `Input must match the ${globalActionId} schema.`, {
						issues: summarizeValidationErrors(validateInput.errors),
					});
				}
				return applyApprovalPresentation(schemaInput, requestedPresentation, registration);
			},
			assertReady: registration.hasAssertReady
				? async (input, context) => {
						await this.invoke(pluginId, registered, input, context, "assert-ready");
					}
				: undefined,
			requiresApproval:
				registration.effect === "read" ? undefined : (_input, context) => context.source === "local-server",
			run: (input, context) => this.invoke(pluginId, registered, input, context),
		};
		registered = {
			activationId: registration.activationId,
			handlerId: registration.handlerId,
			localActionId: registration.id,
			globalActionId,
			timeoutMs: registration.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			definition,
		};

		if (activation === active) {
			registered.unregisterCatalogAction = this.catalog.register(registered.definition, {
				providerId: buildProviderId(pluginId, activation.activationId),
			});
		}
		activation.actions.set(registration.id, registered);
		log.info("action registered", {
			pluginId,
			localActionId: registration.id,
			globalActionId,
			activationId: registration.activationId,
			effect: registration.effect,
		});
	}

	commit(pluginId: string, activationId: string): void {
		const staging = this.stagingActivations.get(pluginId);
		if (!staging || staging.activationId !== activationId) {
			throw new ActionError("PLUGIN_ACTION_STALE_ACTIVATION", `Stale plugin action activation: ${pluginId}`);
		}
		if (pluginId === CORE_ACTION_PLUGIN_ID && staging.actions.size === 0) {
			throw new ActionError("PLUGIN_ACTION_ACTIVATION_EMPTY", "Core Action plugin registered no actions.");
		}
		const previous = this.activeActivations.get(pluginId);
		const unregisterByActionId = this.catalog.replaceProvider(
			[...staging.actions.values()].map((action) => action.definition),
			{
				providerId: buildProviderId(pluginId, activationId),
			},
			previous ? buildProviderId(pluginId, previous.activationId) : undefined,
		);
		for (const action of staging.actions.values()) {
			action.unregisterCatalogAction = unregisterByActionId.get(action.globalActionId);
		}

		this.activeActivations.set(pluginId, staging);
		this.stagingActivations.delete(pluginId);
		if (previous) this.disposeActivation(pluginId, previous, "Plugin action activation was replaced");
		log.info("activation committed", { pluginId, activationId, actionCount: staging.actions.size });
	}

	abort(pluginId: string, activationId: string): void {
		const staging = this.stagingActivations.get(pluginId);
		if (!staging || staging.activationId !== activationId) return;
		this.stagingActivations.delete(pluginId);
		log.info("activation aborted", { pluginId, activationId });
	}

	unregister(pluginId: string, localActionId: string, activationId?: string): void {
		for (const candidate of [this.stagingActivations.get(pluginId), this.activeActivations.get(pluginId)]) {
			if (!candidate || (activationId && candidate.activationId !== activationId)) continue;
			const action = candidate.actions.get(localActionId);
			if (!action) continue;
			action.unregisterCatalogAction?.();
			candidate.actions.delete(localActionId);
			if (candidate === this.activeActivations.get(pluginId)) {
				this.cancelInvocations(pluginId, action.handlerId, "Plugin action was unregistered");
			}
			log.info("action unregistered", { pluginId, localActionId, activationId: candidate.activationId });
		}
	}

	clear(pluginId: string, activationId?: string): void {
		const staging = this.stagingActivations.get(pluginId);
		if (staging && (!activationId || staging.activationId === activationId)) {
			this.stagingActivations.delete(pluginId);
		}
		const active = this.activeActivations.get(pluginId);
		if (active && (!activationId || active.activationId === activationId)) {
			this.activeActivations.delete(pluginId);
			this.disposeActivation(pluginId, active, "Plugin action activation was cleared");
		}
		log.info("plugin actions cleared", { pluginId, activationId });
	}

	respond(requestId: string, result: unknown): void {
		const pending = this.pendingInvocations.get(requestId);
		if (!pending) return;
		this.detachPending(requestId, pending);
		if (typeof result === "object" && result !== null && "error" in result) {
			const error = (result as { error?: unknown }).error;
			if (typeof error === "object" && error !== null) {
				const structured = error as { code?: unknown; message?: unknown; details?: unknown };
				const code = typeof structured.code === "string" ? structured.code : "PLUGIN_ACTION_FAILED";
				const message = typeof structured.message === "string" ? structured.message : "Plugin action failed";
				try {
					const details =
						structured.details === undefined
							? undefined
							: toJsonValue(
									structured.details,
									"ACTION_SERIALIZE_ERROR",
									"Plugin action error details must be JSON serializable.",
								);
					pending.reject(new ActionError(code, message, details));
				} catch (serializationError) {
					pending.reject(
						serializationError instanceof ActionError
							? serializationError
							: new ActionError("ACTION_SERIALIZE_ERROR", "Plugin action error details are invalid."),
					);
				}
				return;
			}
			pending.reject(new ActionError("PLUGIN_ACTION_FAILED", String(error ?? "Plugin action failed")));
			return;
		}
		try {
			const value =
				typeof result === "object" && result !== null && "value" in result
					? (result as { value?: unknown }).value
					: result;
			pending.resolve(
				toJsonValue(value, "ACTION_SERIALIZE_ERROR", "Plugin action result must be JSON serializable."),
			);
		} catch (error) {
			pending.reject(
				error instanceof ActionError
					? error
					: new ActionError("ACTION_SERIALIZE_ERROR", "Plugin action result must be JSON serializable."),
			);
		}
	}

	dispose(): void {
		for (const pluginId of new Set([...this.activeActivations.keys(), ...this.stagingActivations.keys()])) {
			this.clear(pluginId);
		}
		for (const [requestId, pending] of this.pendingInvocations) {
			this.cancelPending(requestId, pending, "Plugin action service was disposed");
		}
	}

	private invoke(
		pluginId: string,
		action: RegisteredPluginAction,
		input: JsonValue,
		context: ActionContext,
		phase: "assert-ready" | "run" = "run",
	): Promise<JsonValue> {
		assertPluginCanExecute(pluginId);
		const active = this.activeActivations.get(pluginId);
		if (active?.activationId !== action.activationId || active.actions.get(action.localActionId) !== action) {
			throw new ActionError(
				"PLUGIN_ACTION_UNAVAILABLE",
				`Plugin action is no longer registered: ${action.globalActionId}`,
			);
		}
		if (this.webContents.isDestroyed()) {
			throw new ActionError("PLUGIN_ACTION_UNAVAILABLE", "Plugin host renderer is unavailable");
		}

		return new Promise<JsonValue>((resolve, reject) => {
			const requestId = randomUUID();
			const pending: PendingInvocation = {
				pluginId,
				handlerId: action.handlerId,
				timer: setTimeout(() => {
					this.cancelPending(requestId, pending, `Plugin action timed out after ${action.timeoutMs}ms`, true);
				}, action.timeoutMs),
				signal: context.signal,
				resolve,
				reject,
			};
			pending.onAbort = () => this.cancelPending(requestId, pending, "Plugin action invocation was aborted", true);
			if (context.signal?.aborted) {
				this.cancelPending(requestId, pending, "Plugin action invocation was aborted", false);
				return;
			}
			context.signal?.addEventListener("abort", pending.onAbort, { once: true });
			this.pendingInvocations.set(requestId, pending);
			try {
				this.webContents.send(PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_REQUEST, {
					requestId,
					pluginId,
					actionId: action.globalActionId,
					localActionId: action.localActionId,
					handlerId: action.handlerId,
					settings: getPluginSettings(pluginId),
					input,
					phase,
				});
			} catch (error) {
				this.detachPending(requestId, pending);
				reject(
					new ActionError(
						"PLUGIN_ACTION_UNAVAILABLE",
						error instanceof Error ? error.message : "Failed to invoke plugin action",
					),
				);
			}
		});
	}

	private disposeActivation(pluginId: string, activation: PluginActionActivation, reason: string): void {
		for (const action of activation.actions.values()) {
			action.unregisterCatalogAction?.();
			this.cancelInvocations(pluginId, action.handlerId, reason);
		}
	}

	private cancelInvocations(pluginId: string, handlerId: string | undefined, reason: string): void {
		for (const [requestId, pending] of this.pendingInvocations) {
			if (pending.pluginId !== pluginId || (handlerId && pending.handlerId !== handlerId)) continue;
			this.cancelPending(requestId, pending, reason, true);
		}
	}

	private cancelPending(requestId: string, pending: PendingInvocation, reason: string, notifyRenderer = false): void {
		if (this.pendingInvocations.get(requestId) === pending) this.detachPending(requestId, pending);
		else clearTimeout(pending.timer);
		if (notifyRenderer && !this.webContents.isDestroyed()) {
			try {
				this.webContents.send(PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_CANCEL, { requestId });
			} catch (error) {
				log.debug("failed to notify renderer about action cancellation", {
					requestId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		pending.reject(
			new ActionError(reason.includes("timed out") ? "PLUGIN_ACTION_TIMEOUT" : "ACTION_ABORTED", reason),
		);
	}

	private detachPending(requestId: string, pending: PendingInvocation): void {
		this.pendingInvocations.delete(requestId);
		clearTimeout(pending.timer);
		if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
	}
}
