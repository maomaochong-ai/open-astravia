import { readFile } from "node:fs/promises";
import { type ActionRpcEndpoint, getActionRpcEndpointFilePath } from "@vetta/action-rpc";

export function getLocalRpcServerEndpointFilePath(): string {
	return getActionRpcEndpointFilePath();
}

function isLocalRpcEndpoint(value: unknown): value is ActionRpcEndpoint {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return record.transport === "http" && typeof record.url === "string" && typeof record.token === "string";
}

export async function readLocalRpcServerEndpoint(): Promise<ActionRpcEndpoint> {
	const endpointFilePath = getLocalRpcServerEndpointFilePath();
	const raw = await readFile(endpointFilePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	if (!isLocalRpcEndpoint(parsed)) {
		throw new Error(`Invalid local RPC endpoint file: ${endpointFilePath}`);
	}
	return parsed;
}
