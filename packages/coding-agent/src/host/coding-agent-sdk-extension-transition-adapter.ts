import { type GreenfieldRuntimeSession, InitializationRollbackScope } from "@vetta/runtime-core";
import type { GreenfieldRuntimeComposition } from "../composition/greenfield-runtime-composition-contract.js";
import type { CodingAgentExtensionEventHost, CodingAgentExtensionInitialization } from "./extensions/contracts.js";
import type {
	GreenfieldSdkOwnedResource,
	GreenfieldSdkSessionInitializationContext,
} from "./sdk-session/runtime-factory.js";
import type {
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionLifecycle,
} from "./session-transition/contracts.js";

type ExtensionEventHostFactory = (
	session: GreenfieldRuntimeSession,
	composition: GreenfieldRuntimeComposition,
	options?: { readonly replaceExisting?: boolean },
) => CodingAgentExtensionEventHost;

/** 把 Session 级 Extension Event Host 纳入 SDK 活动会话的 prepare/commit/rollback 事务。 */
export class CodingAgentSdkExtensionTransitionAdapter {
	readonly lifecycle: CodingAgentSessionTransitionLifecycle;
	private current: CodingAgentExtensionEventHost | undefined;
	private readonly hosts = new Map<string, CodingAgentExtensionEventHost>();

	constructor(
		private readonly createHost: ExtensionEventHostFactory,
		private readonly initialization: CodingAgentExtensionInitialization = {},
	) {
		this.lifecycle = {
			before: (transition) => this.before(transition),
			prepare: (transition) => this.prepare(transition),
			after: (transition) => this.after(transition),
		};
	}

	initializeSession = async (
		context: GreenfieldSdkSessionInitializationContext,
	): Promise<GreenfieldSdkOwnedResource> => {
		const host = this.createHost(context.session, context.composition);
		this.hosts.set(context.session.sessionId, host);
		try {
			await host.initialize(this.initialization, { emitSessionStart: context.source === "initial" });
			if (context.source === "initial") {
				this.current = host;
				await host.discoverResources("startup");
			}
		} catch (error) {
			this.hosts.delete(context.session.sessionId);
			await host.dispose({ emitSessionShutdown: false });
			throw error;
		}
		return {
			id: `sdk-extension-event-host:${context.session.sessionId}`,
			dispose: async () => {
				const currentHost = this.hosts.get(context.session.sessionId);
				if (!currentHost) return;
				this.hosts.delete(context.session.sessionId);
				await currentHost.dispose({ emitSessionShutdown: this.current === currentHost });
			},
		};
	};

	readRunner() {
		if (!this.current) throw new Error("Greenfield SDK Extension session is not initialized");
		return this.current.runner;
	}

	readRunnerOrUndefined() {
		return this.current?.runner;
	}

	readSystemPrompt(): string {
		return this.current?.readSystemPrompt() ?? "";
	}

	hasHandlers(eventType: string): boolean {
		return this.current?.runner.hasHandlers(eventType) ?? false;
	}

	async reload(
		session: GreenfieldRuntimeSession,
		composition: GreenfieldRuntimeComposition,
		operation: () => Promise<void>,
	): Promise<void> {
		const previous = this.current;
		if (!previous) throw new Error("Greenfield SDK Extension session is not initialized");
		const rollback = new InitializationRollbackScope();
		let next: CodingAgentExtensionEventHost | undefined;
		let replacementAttempted = false;
		try {
			await previous.runner.emit({ type: "session_shutdown" });
			rollback.defer({
				id: "previous-session-start",
				rollback: () => previous.runner.emit({ type: "session_start" }),
			});
			rollback.defer({
				id: "previous-runtime-binding",
				rollback: () => {
					if (replacementAttempted) previous.rebindRuntimeBindings();
					else previous.rebindRuntimeActions();
				},
			});
			await operation();
			replacementAttempted = true;
			next = this.createHost(session, composition, { replaceExisting: true });
			const nextHost = next;
			rollback.defer({
				id: "next-extension-host",
				rollback: () => nextHost.dispose({ emitSessionShutdown: false }),
			});
			await next.initialize(this.initialization, { emitSessionStart: false });
			await next.runner.emit({ type: "session_start" });
			await next.discoverResources("reload");
			this.current = next;
			this.hosts.set(session.sessionId, next);
			rollback.commit();
		} catch (error) {
			return rollback.rollback(error, "Greenfield SDK Extension reload and rollback failed");
		}
		await previous.dispose({ emitSessionShutdown: false });
	}

	private async before(transition: CodingAgentSessionTransition) {
		const runner = this.readRunner();
		if (transition.kind === "fork") {
			if (!transition.entryId || !runner.hasHandlers("session_before_fork")) return undefined;
			const result = await runner.emit({ type: "session_before_fork", entryId: transition.entryId });
			return {
				cancelled: result?.cancel === true,
				...(result?.skipConversationRestore === true ? { skipConversationRestore: true } : {}),
			};
		}
		if (!runner.hasHandlers("session_before_switch")) return undefined;
		const result = await runner.emit({
			type: "session_before_switch",
			reason: transition.kind,
			...(transition.targetSessionPath ? { targetSessionFile: transition.targetSessionPath } : {}),
		});
		return { cancelled: result?.cancel === true };
	}

	private async prepare(
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	): Promise<CodingAgentPreparedSessionBinding> {
		const previous = this.current;
		const next = this.hosts.get(transition.next.sessionId);
		if (!previous || !next) throw new Error("Greenfield SDK Extension transition binding is unavailable");
		return {
			commit: async () => {
				this.current = next;
			},
			rollback: async () => {
				this.current = previous;
				previous.rebindRuntimeActions();
			},
			finalize: async () => {},
		};
	}

	private async after(
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	): Promise<void> {
		if (transition.kind === "fork") {
			await this.readRunner().emit({
				type: "session_fork",
				previousSessionFile: transition.previousSessionPath,
			});
			return;
		}
		await this.readRunner().emit({
			type: "session_switch",
			reason: transition.kind,
			previousSessionFile: transition.previousSessionPath,
		});
	}
}
