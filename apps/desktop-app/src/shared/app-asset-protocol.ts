export const APP_ASSET_PROTOCOL_SCHEME = "vetta-asset";

export const APP_ASSET_SCOPES = ["renderer"] as const;

export type AppAssetScope = (typeof APP_ASSET_SCOPES)[number];

export function isAppAssetScope(value: string): value is AppAssetScope {
	return (APP_ASSET_SCOPES as readonly string[]).includes(value);
}

export function createAppAssetUrl(scope: AppAssetScope, relativePath: string): string {
	const segments = relativePath.replaceAll("\\", "/").split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new Error(`Invalid app asset path: ${relativePath}`);
	}
	return `${APP_ASSET_PROTOCOL_SCHEME}://${scope}/${segments.map(encodeURIComponent).join("/")}`;
}
