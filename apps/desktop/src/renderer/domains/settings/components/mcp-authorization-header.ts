/** The convenience field and raw headers share one source of truth. */
export function getMcpAuthorization(headers: string): string {
	return headers.split("\n").reduce((value, line) => {
		const entry = line.trimStart();
		const separator = entry.indexOf("=");
		return separator > 0 && entry.slice(0, separator).trim().toLowerCase() === "authorization"
			? entry.slice(separator + 1)
			: value;
	}, "");
}

export function setMcpAuthorization(headers: string, value: string): string {
	const otherHeaders = headers.split("\n").filter((line) => {
		const separator = line.indexOf("=");
		return separator < 0 || line.slice(0, separator).trim().toLowerCase() !== "authorization";
	});
	if (value) otherHeaders.push(`Authorization=${value}`);
	return otherHeaders.filter((line) => line.trim()).join("\n");
}
