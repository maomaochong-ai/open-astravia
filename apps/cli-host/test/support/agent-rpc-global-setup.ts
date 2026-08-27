import type { TestProject } from "vitest/node";
import { buildAgentRpcExecutable } from "./agent-rpc-executable.js";

export default async function setupAgentRpcExecutable(project: TestProject): Promise<() => Promise<void>> {
	const executable = await buildAgentRpcExecutable();
	project.provide("agentRpcExecutablePath", executable.path);
	return () => executable.dispose();
}
