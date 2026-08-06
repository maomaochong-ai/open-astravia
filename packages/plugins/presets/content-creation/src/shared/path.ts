export function joinContentPath(root: string, ...parts: string[]): string {
	const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	let result = root.replace(/[/\\]+$/, "");
	for (const part of parts) {
		const clean = part.replace(/^[/\\]+/, "").replace(/[/\\]+/g, separator);
		result = `${result}${separator}${clean}`;
	}
	return result;
}
