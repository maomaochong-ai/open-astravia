export const WINDOWS_RELEASE_TARGETS = Object.freeze(["inno", "msi", "zip"]);

export const WINDOWS_SUPPLEMENTAL_EXTENSIONS = Object.freeze([".msi", ".zip"]);

export function windowsSupplementalArtifactNames(version) {
	return WINDOWS_SUPPLEMENTAL_EXTENSIONS.map((extension) => `Vetta-${version}-win-x64${extension}`);
}
