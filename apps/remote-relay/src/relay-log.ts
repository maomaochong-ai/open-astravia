type RelayLogFields = Readonly<Record<string, string | number | boolean | undefined>>;

/** Emits structured metadata only. Callers must never pass credentials, URLs, payloads, or prompt text. */
export function relayInfo(event: string, fields: RelayLogFields = {}): void {
	console.info(JSON.stringify(compact({ component: "remote-relay", level: "info", event, ...fields })));
}

export function relayWarn(event: string, fields: RelayLogFields = {}): void {
	console.warn(JSON.stringify(compact({ component: "remote-relay", level: "warn", event, ...fields })));
}

function compact(fields: RelayLogFields): Record<string, string | number | boolean> {
	return Object.fromEntries(
		Object.entries(fields).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
	);
}
