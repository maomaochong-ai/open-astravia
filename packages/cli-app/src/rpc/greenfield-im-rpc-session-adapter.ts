import { GREENFIELD_IM_RPC_PROFILE } from "@vetta/coding-agent/rpc";
import {
	GreenfieldRpcSessionAdapter,
	type GreenfieldRpcSessionAdapterOptions,
} from "./greenfield-rpc-session-adapter.js";

export type GreenfieldImRpcSessionAdapterOptions = Omit<GreenfieldRpcSessionAdapterOptions, "profile">;

/** @deprecated Use GreenfieldRpcSessionAdapter for new host profiles. */
export class GreenfieldImRpcSessionAdapter extends GreenfieldRpcSessionAdapter {
	constructor(options: GreenfieldImRpcSessionAdapterOptions) {
		if (options.runtime.scenario !== "im-claw") {
			throw new Error(
				`Greenfield IM RPC adapter requires runtime scenario im-claw, received ${options.runtime.scenario}`,
			);
		}
		super({
			...options,
			profile: GREENFIELD_IM_RPC_PROFILE,
		});
	}

	override async dispose(): Promise<void> {
		try {
			await super.dispose();
		} catch (error) {
			throw new AggregateError(
				error instanceof AggregateError ? error.errors : [error],
				"Failed to dispose Greenfield IM RPC resources",
			);
		}
	}
}
