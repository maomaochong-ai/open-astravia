import type {
	AuthorizedCapabilityClient,
	CapabilityAccessHandle,
	CapabilityAccessSessionFactory,
	CapabilityAccessSessionOptions,
	CapabilityId,
	CapabilityInvokeOptions,
	CapabilityToken,
} from "@vetta/capability-sdk";
import { DOMAIN_AI_CAPABILITIES } from "@vetta/capability-sdk";
import { capabilityOutputFor } from "./capability-outputs.js";

export class RecordingAccessFactory implements CapabilityAccessSessionFactory {
	readonly invocations: Array<{ readonly capabilityId: CapabilityId; readonly input: unknown }> = [];
	readonly sessions: CapabilityAccessSessionOptions[] = [];

	createSession(options: CapabilityAccessSessionOptions): CapabilityAccessHandle {
		this.sessions.push(options);
		let revoked = false;
		const grants = new Set(options.grants.map((grant) => grant.capabilityId));
		const client: AuthorizedCapabilityClient = {
			invoke: async <Input, Output, Event = never>(
				capability: CapabilityToken<Input, Output, Event>,
				input: Input,
				invokeOptions?: CapabilityInvokeOptions<Event>,
			): Promise<Output> => {
				if (revoked) throw new Error("revoked");
				if (!grants.has(capability.id)) throw new Error(`missing grant: ${capability.id}`);
				this.invocations.push({ capabilityId: capability.id, input });
				if (capability.id === DOMAIN_AI_CAPABILITIES.COMPLETE.id) {
					invokeOptions?.onEvent?.({ type: "text_delta", delta: "ok" } as Event);
				}
				return capability.parseOutput(capabilityOutputFor(capability.id));
			},
		};
		return {
			client,
			subject: options.subject,
			isRevoked: () => revoked,
			revoke: () => {
				revoked = true;
			},
		};
	}
}
