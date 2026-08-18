import { RpcClient as PortableRpcClient } from "@vetta/coding-agent/rpc";
import {
	NodeRpcClientTransport,
	type NodeRpcClientTransportOptions,
	type RpcClientProcessLaunch,
	resolveRpcClientProcessLaunch,
} from "./node-rpc-client-transport.js";

export type RpcClientOptions = NodeRpcClientTransportOptions;
export type { ModelInfo, RpcEventListener } from "@vetta/coding-agent/rpc";
export type { RpcClientProcessLaunch };
export { resolveRpcClientProcessLaunch };

/** Node convenience client that binds the portable RPC client to a child process. */
export class RpcClient extends PortableRpcClient {
	constructor(options: RpcClientOptions = {}) {
		super(new NodeRpcClientTransport(options));
	}
}
