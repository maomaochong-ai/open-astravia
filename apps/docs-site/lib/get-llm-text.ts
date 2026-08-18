import { llms } from "fumadocs-core/source";
import { source } from "./source";

export async function getLLMText(page: (typeof source)["$inferPage"]): Promise<string> {
	if (page.url === "/") return llms(source).index();

	const processed = await page.data.getText("processed");
	const description = page.data.description ? `\n> ${page.data.description}\n` : "";
	return `# ${page.data.title}\n${description}\nCanonical page: ${page.url}\n\n${processed}`;
}
