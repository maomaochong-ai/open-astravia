import { filesystemBoundaryProbes } from "./filesystem-boundary";
import { networkBoundaryProbes } from "./network-boundary";
import { officialAndCommandProbes } from "./official-and-command";
import { permissionGateProbes } from "./permission-gates";
import { runtimeIsolationProbes } from "./runtime-isolation";
import { storageNamespaceProbes } from "./storage-namespace";
import type { ProbeContext, ProbeDefinition, ProbeResult } from "./types";

export type { ProbeContext, ProbeResult, ProbeStatus, ProbeSeverity } from "./types";

export const ALL_PROBES: ProbeDefinition[] = [
	...runtimeIsolationProbes,
	...permissionGateProbes,
	...storageNamespaceProbes,
	...filesystemBoundaryProbes,
	...networkBoundaryProbes,
	...officialAndCommandProbes,
];

export async function runAllProbes(probe: ProbeContext): Promise<ProbeResult[]> {
	const results: ProbeResult[] = [];
	for (const definition of ALL_PROBES) {
		results.push(await definition.run(probe));
	}
	return results;
}

export async function runProbeById(probe: ProbeContext, id: string): Promise<ProbeResult | null> {
	const definition = ALL_PROBES.find((item) => item.id === id);
	if (!definition) return null;
	return definition.run(probe);
}

export function summarizeResults(results: readonly ProbeResult[]) {
	const counts = {
		pass: 0,
		blocked: 0,
		finding: 0,
		skip: 0,
		error: 0,
	};
	for (const result of results) {
		counts[result.status] += 1;
	}
	const findings = results.filter((result) => result.status === "finding");
	const critical = findings.filter((result) => result.severity === "critical").length;
	const high = findings.filter((result) => result.severity === "high").length;
	return { counts, findings, critical, high };
}
