let nextLocalId = 0;

/** Process-local fallback for in-memory/test compositions; Hosts may inject stronger IDs. */
export function createLocalSubagentId(): string {
	nextLocalId += 1;
	return `subagent-${Date.now().toString(36)}-${nextLocalId.toString(36)}`;
}
