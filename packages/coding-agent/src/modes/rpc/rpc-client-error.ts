import type { RpcFailureMetadata, RpcFailurePhase, RpcFailureRecoverability } from "./rpc-failure.js";
import type { RpcResponse } from "./rpc-types.js";

export class RpcClientError extends Error implements RpcFailureMetadata {
	readonly errorCode: string;
	readonly phase: RpcFailurePhase;
	readonly recoverability: RpcFailureRecoverability;
	readonly command: string | undefined;

	constructor(
		message: string,
		metadata: RpcFailureMetadata,
		options: { readonly command?: string; readonly cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "RpcClientError";
		this.errorCode = metadata.errorCode;
		this.phase = metadata.phase;
		this.recoverability = metadata.recoverability;
		this.command = options.command;
	}
}

export function rpcClientErrorFromResponse(response: Extract<RpcResponse, { success: false }>): RpcClientError {
	return new RpcClientError(response.error, response, { command: response.command });
}
