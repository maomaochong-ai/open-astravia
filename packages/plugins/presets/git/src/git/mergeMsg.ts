import { getFsApi } from "./runtime";

/**
 * The message git prepared for an in-progress merge (`.git/MERGE_MSG`), or null
 * when there is none.
 *
 * Native git shows this in the editor when the merge commit is made, so a panel
 * that silently dropped it would look like it lost information the user expects
 * to see ("Merge branch 'x'" plus any conflict notes).
 */
export async function readMergeMessage(root: string): Promise<string | null> {
	try {
		const result = await getFsApi().readFile(`${root}/.git/MERGE_MSG`);
		if (result.encoding !== "utf8") return null;
		// Comment lines are git's own instructions to the editor, not message text.
		const text = result.content
			.split("\n")
			.filter((line) => !line.startsWith("#"))
			.join("\n")
			.trim();
		return text.length > 0 ? text : null;
	} catch {
		return null;
	}
}
