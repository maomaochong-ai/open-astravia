import type {
	ConversationDocument,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "@vetta/runtime-core";
import { selectConversationDocumentEntries } from "@vetta/runtime-core";
import type { RuntimeSnapshotAcquireContext, StoredSessionEvent } from "@vetta/runtime-core/kernel";
import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";
import { AGENT_CONFIGURATION_OBSERVATION } from "./configuration-observability.js";
import { AgentConfigurationResolution } from "./configuration-resolution.js";
import {
	type AgentConfiguration,
	type AgentConfigurationDocument,
	AgentConfigurationError,
	type AgentConfigurationFailureCode,
	type AgentConfigurationSelection,
	DEFAULT_AGENT_CONFIGURATION,
	freezeConfiguration,
	parseAgentConfigurationDocument,
	parseAgentConfigurationSelection,
} from "./configuration-schema.js";
import type { AgentConfigurationResourceCatalog, AgentConfigurationStatus } from "./session-configuration-contract.js";

export const AGENT_CONFIGURATION_CUSTOM_TYPE = "coding-agent.configuration.v1";

export interface AgentConfigurationAdmission {
	commit(): void;
	rollback(error: unknown): void;
}

/** Owns a conversation's persisted selection; resource adapters only consume the admitted value. */
export class AgentSessionConfiguration implements RuntimeDocumentParticipant {
	private readonly resolution = new AgentConfigurationResolution();
	private desired: AgentConfigurationDocument;
	private resolved: AgentConfiguration = DEFAULT_AGENT_CONFIGURATION;
	private admitted: AgentConfiguration = DEFAULT_AGENT_CONFIGURATION;
	private effectiveRevision: number | null = null;
	private failure: AgentConfigurationStatus["failure"] = null;
	private context: RuntimeDocumentParticipantContext | undefined;
	private writeTail: Promise<void> = Promise.resolve();
	private closed = false;
	private activeTurn = false;
	private pendingDocument: AgentConfigurationDocument | undefined;
	private catalog: (() => AgentConfigurationResourceCatalog) | undefined;

	constructor(
		initial: AgentConfigurationSelection | undefined,
		private readonly createId: () => string,
		private readonly now: () => number,
		private readonly observations?: RuntimeObservationPublisher,
	) {
		this.desired = parseAgentConfigurationDocument({
			schemaVersion: 1,
			revision: 0,
			selection: initial ?? { template: null, overrides: {} },
		});
	}

	async prepare(): Promise<void> {
		this.resolved = await this.resolution.resolve(this.desired);
		this.admitted = this.resolved;
	}

	attachCatalog(read: () => AgentConfigurationResourceCatalog): void {
		if (this.catalog) throw new AgentConfigurationError("AGENT_CONFIGURATION_CONFLICT");
		this.catalog = read;
	}

	readCatalog(): AgentConfigurationResourceCatalog {
		this.assertOpen();
		if (!this.catalog) throw new AgentConfigurationError("AGENT_CONFIGURATION_NOT_READY");
		return this.catalog();
	}

	readAdmitted(): AgentConfiguration {
		return this.admitted;
	}

	read(): AgentConfigurationStatus {
		return freezeConfiguration({
			desired: this.desired,
			resolved: this.resolved,
			effectiveRevision: this.effectiveRevision,
			pending: this.desired.revision !== this.effectiveRevision,
			failure: this.failure,
		});
	}

	update(input: unknown): Promise<AgentConfigurationStatus> {
		this.assertOpen();
		if (typeof input !== "object" || input === null || !("selection" in input) || !("expectedRevision" in input))
			throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
		const selection = parseAgentConfigurationSelection(input.selection);
		const expectedRevision = input.expectedRevision;
		if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
			throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
		const operation = this.writeTail.then(async () => {
			this.assertOpen();
			if (!this.context) throw new AgentConfigurationError("AGENT_CONFIGURATION_NOT_READY");
			if (expectedRevision !== this.desired.revision)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_CONFLICT");
			const next = parseAgentConfigurationDocument({
				schemaVersion: 1,
				revision: this.desired.revision + 1,
				selection,
			});
			const resolved = await this.resolution.resolve(next);
			await this.persist(next);
			this.desired = next;
			this.resolved = resolved;
			this.failure = null;
			this.record("save", "completed", next.revision);
			return this.read();
		});
		this.writeTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	async admit(
		context: RuntimeSnapshotAcquireContext | undefined,
		apply: (configuration: AgentConfiguration) => Promise<void>,
	): Promise<AgentConfigurationAdmission> {
		this.assertOpen();
		await this.writeTail;
		const desired = this.desired;
		const configuration = this.activeTurn && context?.reason !== "turn" ? this.admitted : this.resolved;
		const previous = this.admitted;
		const turnId = context?.reason === "turn" ? context.operationId : undefined;
		this.record("apply", "started", desired.revision, undefined, turnId);
		const rollback = (error: unknown) => {
			this.admitted = previous;
			this.failure = {
				revision: desired.revision,
				code: error instanceof AgentConfigurationError ? error.code : "AGENT_CONFIGURATION_APPLY_FAILED",
			};
			this.record("apply", "failed", desired.revision, this.failure.code, turnId);
		};
		try {
			this.admitted = configuration;
			await apply(configuration);
			context?.signal.throwIfAborted();
			return {
				commit: () => {
					this.record(
						"apply",
						"completed",
						desired.revision,
						undefined,
						context?.reason === "turn" ? context.operationId : undefined,
					);
					if (context?.reason === "turn") {
						this.effectiveRevision = desired.revision;
						this.failure = null;
					}
				},
				rollback,
			};
		} catch (error) {
			rollback(error);
			throw error;
		}
	}

	async initialize(document: ConversationDocument, context: RuntimeDocumentParticipantContext): Promise<void> {
		this.context = context;
		const restored = readDocumentConfiguration(document);
		if (restored) this.desired = restored;
		await this.prepare();
		if (
			!restored &&
			(this.desired.selection.template !== null || Object.keys(this.desired.selection.overrides).length > 0)
		)
			await this.persist(this.desired);
	}

	async onDocumentChanged(document: ConversationDocument): Promise<void> {
		const next =
			readDocumentConfiguration(document) ??
			parseAgentConfigurationDocument({
				schemaVersion: 1,
				revision: 0,
				selection: { template: null, overrides: {} },
			});
		// appendCustomEntry synchronously notifies participants before its promise resolves.
		if (sameDocument(next, this.pendingDocument) || sameDocument(next, this.desired)) return;
		this.desired = next;
		await this.prepare();
		this.effectiveRevision = null;
		this.failure = null;
	}

	async dispose(): Promise<void> {
		this.closed = true;
		await this.writeTail;
		await this.resolution.close();
	}

	onSessionEvent(event: StoredSessionEvent): void {
		if (event.type === "turn.started") this.activeTurn = true;
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed")
			this.activeTurn = false;
	}

	private async persist(document: AgentConfigurationDocument): Promise<void> {
		if (!this.context) throw new AgentConfigurationError("AGENT_CONFIGURATION_NOT_READY");
		this.pendingDocument = document;
		try {
			await this.context.appendCustomEntry({
				entryId: this.createId(),
				customType: AGENT_CONFIGURATION_CUSTOM_TYPE,
				data: document,
				timestamp: new Date(this.now()).toISOString(),
			});
		} finally {
			this.pendingDocument = undefined;
		}
	}

	private assertOpen(): void {
		if (this.closed) throw new AgentConfigurationError("AGENT_CONFIGURATION_CLOSED");
	}

	private record(
		operation: "save" | "apply",
		phase: "started" | "completed" | "failed",
		revision: number,
		code?: AgentConfigurationFailureCode,
		turnId?: string,
	): void {
		try {
			this.observations?.record(
				AGENT_CONFIGURATION_OBSERVATION,
				{
					operation,
					phase,
					revision,
					...(code ? { code } : {}),
				},
				turnId ? { turnId } : undefined,
			);
		} catch {
			/* Diagnostics cannot change configuration admission. */
		}
	}
}

function sameDocument(left: AgentConfigurationDocument, right: AgentConfigurationDocument | undefined): boolean {
	return right !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function readDocumentConfiguration(document: ConversationDocument): AgentConfigurationDocument | undefined {
	for (const entry of [...selectConversationDocumentEntries(document)].reverse()) {
		if (
			entry.type === "custom" &&
			entry.customType.startsWith("coding-agent.configuration.") &&
			entry.customType !== AGENT_CONFIGURATION_CUSTOM_TYPE
		)
			throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
		if (entry.type === "custom" && entry.customType === AGENT_CONFIGURATION_CUSTOM_TYPE)
			return parseAgentConfigurationDocument(entry.data);
	}
	return undefined;
}
