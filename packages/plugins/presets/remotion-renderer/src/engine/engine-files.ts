import serverSource from "../../engine/server.mjs?raw";

export const ENGINE_FILES: Record<string, string> = {
	"server.mjs": serverSource,
};

export function engineFilesHash(): string {
	let hash = 5381;
	for (const key of Object.keys(ENGINE_FILES).sort()) {
		const text = `${key}\0${ENGINE_FILES[key]}`;
		for (let index = 0; index < text.length; index += 1) {
			hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
		}
	}
	return (hash >>> 0).toString(36);
}

