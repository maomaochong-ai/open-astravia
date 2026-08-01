import type { PluginContext } from "@vetta-org/plugin-sdk";
import { strToU8, zipSync, type Zippable } from "fflate";
import { buildDesign } from "../engine/engine-manager";
import type { DesignSession } from "../vetd/design-session";

const BUILD_DIR = ".vetd-build";
const EXCLUDED_PREFIXES = [`${BUILD_DIR}/`, "node_modules/", ".snapshots/"];

function base64FromBytes(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

const TEXT_EXTENSIONS = new Set(["tsx", "ts", "css", "json", "html", "svg", "md", "txt", "js", "mjs"]);

/**
 * Inline the vite build output (single chunk, see engine config) into one
 * self-contained snapshot.html so packaged previews render offline without a
 * server. Relative asset references (design assets/) are a documented v1
 * limitation of packaged previews.
 */
async function buildSnapshotHtml(ctx: PluginContext, outDir: string): Promise<string> {
	let html = (await ctx.fs.readFile(`${outDir}/index.html`)).content;
	const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
	if (scriptMatch) {
		const src = scriptMatch[1].replace(/^\//, "");
		const js = (await ctx.fs.readFile(`${outDir}/${src}`)).content.replaceAll("</script>", "<\\/script>");
		html = html.replace(scriptMatch[0], `<script type="module">${js}</script>`);
	}
	const linkPattern = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
	const links = [...html.matchAll(linkPattern)];
	for (const link of links) {
		const href = link[1].replace(/^\//, "");
		const css = (await ctx.fs.readFile(`${outDir}/${href}`)).content;
		html = html.replace(link[0], `<style>${css}</style>`);
	}
	return html;
}

/**
 * Export the working design into a self-contained packaged .vetd (zip):
 * manifest.json + design sources + snapshot.html. Written next to the design
 * as `<name>-share.vetd`; returns the path.
 */
export async function exportDesign(ctx: PluginContext, session: DesignSession): Promise<string> {
	const outDir = `${session.dirPath}/${BUILD_DIR}`;
	await buildDesign(ctx, session.dirPath, outDir);
	const snapshotHtml = await buildSnapshotHtml(ctx, outDir);

	const zipEntries: Zippable = {
		"manifest.json": strToU8(`${JSON.stringify(session.manifest, null, "\t")}\n`),
		"snapshot.html": strToU8(snapshotHtml),
	};
	const files = await ctx.fs.listFilesRecursive(session.dirPath);
	for (const file of files) {
		const rel = file.relPath.replaceAll("\\", "/");
		if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
		const extension = rel.split(".").pop()?.toLowerCase() ?? "";
		if (TEXT_EXTENSIONS.has(extension)) {
			const text = await ctx.fs.readFile(file.path);
			zipEntries[`design/${rel}`] = strToU8(text.content);
		} else {
			const binary = await ctx.fs.readBinaryFile(file.path);
			zipEntries[`design/${rel}`] = bytesFromBase64(binary.data);
		}
	}
	const zipped = zipSync(zipEntries, { level: 6 });

	const parent = session.vetdPath.slice(0, session.vetdPath.lastIndexOf("/"));
	const exportPath = `${parent}/${session.name}-share.vetd`;
	await ctx.fs.writeFile(exportPath, base64FromBytes(zipped), "base64");
	await ctx.fs.delete(outDir).catch(() => {});
	return exportPath;
}
