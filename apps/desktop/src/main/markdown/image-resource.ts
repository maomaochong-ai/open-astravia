import { readPublicResource } from "./public-resource.js";

let active = 0;
export async function readMarkdownImage(url: string): Promise<string> {
	if (active >= 4) throw new Error("Image request limit exceeded");
	active++;
	try {
		const response = await readPublicResource(new URL(url), 8_000_000, AbortSignal.timeout(15_000));
		const type = response.type.split(";", 1)[0].trim().toLowerCase();
		if (!/^image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type))
			throw new Error("Unsupported image format");
		return `data:${type};base64,${response.body.toString("base64")}`;
	} finally {
		active--;
	}
}
