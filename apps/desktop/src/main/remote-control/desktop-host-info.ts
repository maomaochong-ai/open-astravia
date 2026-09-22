import { cpus, hostname, platform, release, totalmem } from "node:os";

export function desktopDisplayName(): string {
	return hostname().replace(/\.local$/i, "") || "Vetta Desktop";
}

export function desktopDeviceId(): string {
	return `desktop-${hostname()
		.replace(/[^A-Za-z0-9_-]/g, "-")
		.slice(0, 64)}`;
}

export function formatOsLabel(): string {
	const version = release();
	switch (platform()) {
		case "win32":
			return `Windows (${version})`;
		case "darwin":
			return `macOS (${version})`;
		case "linux":
			return `Linux (${version})`;
		default:
			return `${platform()} (${version})`;
	}
}

export function desktopHardware(): { cpu?: string; ram?: string } {
	return { cpu: cpus()[0]?.model, ram: formatMemory(totalmem()) };
}

function formatMemory(bytes: number): string {
	const gigabytes = bytes / 1024 ** 3;
	if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`;
	return `${Math.round(bytes / 1024 ** 2)} MB`;
}
