/**
 * Windows batch shims need cmd.exe, but native executables must keep their argv
 * boundary. Passing an args array together with `shell: true` is deprecated by
 * Node and lets cmd.exe reinterpret paths and metacharacters.
 */
export function shouldUseWindowsCommandShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
	if (platform !== "win32") return false;
	const normalized = command.trim().toLowerCase();
	return !normalized.endsWith(".exe") && !normalized.endsWith(".com");
}
