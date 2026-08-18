import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	type ActionRpcEndpoint,
	type LocalRpcRuntime,
	type LocalRpcServerHandle,
	startLocalRpcServer,
} from "@vetta/action-rpc";
import { getAppLogger } from "../logger.js";
import { getLocalRpcServerEndpointFilePath } from "./endpoint-file.js";

const log = getAppLogger("local-rpc");

export interface DesktopLocalRpcServerHandle {
	endpoint: ActionRpcEndpoint;
	close: () => Promise<void>;
}

export interface StartDesktopLocalRpcServerOptions {
	endpointFilePath?: string;
}

function createToken(): string {
	return randomBytes(32).toString("hex");
}

export async function startDesktopLocalRpcServer(
	runtime: LocalRpcRuntime,
	options: StartDesktopLocalRpcServerOptions = {},
): Promise<DesktopLocalRpcServerHandle> {
	const endpointFilePath = options.endpointFilePath ?? getLocalRpcServerEndpointFilePath();
	const token = createToken();
	log.info("server: starting", { endpointFilePath, debugEnabled: runtime.debug !== undefined });
	await mkdir(dirname(endpointFilePath), { recursive: true });

	let server: LocalRpcServerHandle;
	try {
		server = await startLocalRpcServer(runtime, { host: "127.0.0.1", port: 0, token });
	} catch (error) {
		log.error("server: start failed", error);
		throw error;
	}

	try {
		await writeFile(endpointFilePath, `${JSON.stringify(server.endpoint, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	} catch (error) {
		await server.close();
		log.error("server: endpoint write failed", { endpointFilePath }, error);
		throw error;
	}

	log.info("server: started", {
		endpointFilePath,
		transport: server.endpoint.transport,
		url: server.endpoint.url,
		debugEnabled: runtime.debug !== undefined,
	});

	return {
		endpoint: server.endpoint,
		close: async () => {
			try {
				await server.close();
				log.info("server: closed", { endpointFilePath });
			} catch (error) {
				log.warn("server: close failed", error);
			}
			try {
				await rm(endpointFilePath, { force: true });
			} catch (error) {
				log.warn("server: endpoint removal failed", { endpointFilePath }, error);
			}
		},
	};
}
