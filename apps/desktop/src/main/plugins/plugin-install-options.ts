import { validatePluginId, validatePluginVersion } from "@vetta-org/plugin-sdk/manifest";
import type {
	PluginInstallOptions,
	PluginManifest,
	PluginNpmDistribution,
	PluginPermission,
} from "../../preload/api-types/plugins.js";

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Invalid ${name}`);
	return value.trim();
}

function parseNpmDistribution(value: unknown): PluginNpmDistribution | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid npm plugin distribution");
	}
	const input = value as Record<string, unknown>;
	const packageName = optionalString(input.packageName, "npm packageName");
	const requestedSpec = optionalString(input.requestedSpec, "npm requestedSpec");
	const resolvedVersion = optionalString(input.resolvedVersion, "npm resolvedVersion");
	if (!packageName || !requestedSpec || !resolvedVersion) throw new Error("Invalid npm plugin distribution");
	validatePluginVersion(resolvedVersion);
	return {
		packageName,
		requestedSpec,
		resolvedVersion,
		integrity: optionalString(input.integrity, "npm integrity"),
	};
}

/** Normalize untrusted IPC / Action input at the plugin service boundary. */
export function parsePluginInstallOptions(value: unknown): PluginInstallOptions | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid plugin install options");
	const input = value as Record<string, unknown>;
	const source =
		input.source === "remote" || input.source === "archive" || input.source === "npm" ? input.source : undefined;
	const grantedPermissions =
		Array.isArray(input.grantedPermissions) && input.grantedPermissions.every((item) => typeof item === "string")
			? (input.grantedPermissions as PluginPermission[])
			: undefined;
	const expectedId = optionalString(input.expectedId, "expected plugin id");
	const expectedVersion = optionalString(input.expectedVersion, "expected plugin version");
	const expectedSha256 = optionalString(input.expectedSha256, "expected sha256");
	if (expectedId) validatePluginId(expectedId);
	if (expectedVersion) validatePluginVersion(expectedVersion);
	if (expectedSha256 && !/^[a-f0-9]{64}$/iu.test(expectedSha256)) throw new Error("Invalid expected sha256");
	const npm = parseNpmDistribution(input.npm);
	if ((source === "npm") !== Boolean(npm)) {
		throw new Error("npm plugin installs require source=npm and npm distribution metadata");
	}
	if (npm && expectedVersion !== npm.resolvedVersion) {
		throw new Error("npm resolvedVersion must match expectedVersion");
	}
	if (npm && (!expectedSha256 || !expectedId || !expectedVersion)) {
		throw new Error("npm plugin installs require expectedSha256, expectedId, and expectedVersion");
	}
	return {
		source,
		grantedPermissions,
		enable: input.enable === true ? true : input.enable === false ? false : undefined,
		expectedSha256,
		expectedId,
		expectedVersion,
		npm,
	};
}

/** Verify the extracted plugin identity before copying anything into the install store. */
export function assertPluginInstallIdentity(
	manifest: Pick<PluginManifest, "id" | "version">,
	options: PluginInstallOptions | undefined,
): void {
	if (options?.expectedId && manifest.id !== options.expectedId) {
		throw new Error(`Plugin id mismatch: expected ${options.expectedId}, received ${manifest.id}`);
	}
	if (options?.expectedVersion && manifest.version !== options.expectedVersion) {
		throw new Error(`Plugin version mismatch: expected ${options.expectedVersion}, received ${manifest.version}`);
	}
	if (options?.source === "npm") {
		if (!options.npm) throw new Error("npm plugin distribution metadata is required");
		if (options.npm.resolvedVersion !== manifest.version) {
			throw new Error("npm distribution version does not match plugin manifest version");
		}
	}
}
