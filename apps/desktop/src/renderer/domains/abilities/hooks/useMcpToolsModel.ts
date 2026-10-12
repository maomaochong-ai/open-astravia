import type { McpAvailableTool } from "@preload/api-types/mcp";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useEffect, useState } from "react";

export function useMcpToolsModel(serverName: string, enabled: boolean, revision: unknown) {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<{
		tools: McpAvailableTool[];
		phase: "loading" | "ready" | "error";
		error?: string;
	}>({
		tools: [],
		phase: "loading",
	});
	useEffect(() => {
		// Configuration changes and explicit retries start a fresh discovery.
		void revision;
		void attempt;
		let active = true;
		setState({ tools: [], phase: "loading" });
		if (enabled) {
			void waitForCommittedPaint().then(async () => {
				if (!active) return;
				try {
					const tools = await window.vetta.mcp.listTools(serverName);
					if (active) setState({ tools, phase: "ready" });
				} catch (reason) {
					const error = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : undefined;
					if (active) setState({ tools: [], phase: "error", error });
				}
			});
		}
		return () => {
			active = false;
		};
	}, [serverName, enabled, revision, attempt]);
	return { ...state, retry: () => setAttempt((value) => value + 1) };
}
