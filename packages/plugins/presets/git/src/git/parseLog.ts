import type { ChangeCode, ChangeEntry, CommitNode } from "./types";

// graphLog's %x1f/%x1e expand to these bytes in git's output: US (0x1f) between
// fields, RS (0x1e) between records.
const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

/** Decoration string (`%D`) → ref name list, splitting "HEAD -> x" and keeping "tag: y". */
function parseRefs(decoration: string): string[] {
	const out: string[] = [];
	for (const raw of decoration.split(",")) {
		const token = raw.trim();
		if (!token) continue;
		if (token.startsWith("tag: ")) {
			out.push(token);
			continue;
		}
		const arrow = token.indexOf(" -> ");
		if (arrow >= 0) {
			out.push(token.slice(0, arrow).trim());
			out.push(token.slice(arrow + 4).trim());
		} else {
			out.push(token);
		}
	}
	return out;
}

/** Parse {@link graphLog} output into commits (newest first, as emitted). */
export function parseLog(raw: string): CommitNode[] {
	const out: CommitNode[] = [];
	for (const record of raw.split(RECORD)) {
		const text = record.replace(/^\n+/, "");
		if (!text) continue;
		const f = text.split(FIELD);
		if (f.length < 8) continue;
		const [hash, parents, decoration, authorName, authorEmail, timestamp, subject, body] = f;
		out.push({
			hash,
			parents: parents.trim() ? parents.trim().split(/\s+/) : [],
			refs: parseRefs(decoration),
			authorName,
			authorEmail,
			timestamp: Number(timestamp) || 0,
			subject,
			body,
		});
	}
	return out;
}

// name-status status letter → our collapsed ChangeCode (commits never have untracked).
function mapStatus(letter: string): ChangeCode {
	switch (letter) {
		case "A":
			return "A";
		case "D":
			return "D";
		case "R":
		case "C":
			return "R";
		default:
			// M, T (type change), and anything else collapse to modified.
			return "M";
	}
}

/** NUL-delimited names preserve tabs, newlines and quoted paths verbatim. */
export function parseNameStatus(raw: string): ChangeEntry[] {
	if (raw && !raw.endsWith("\0")) throw new Error("Truncated git name-status output");
	const out: ChangeEntry[] = [];
	const fields = raw.split("\0");
	for (let i = 0; i < fields.length - 1; ) {
		const status = fields[i++].trim();
		const first = fields[i++];
		if (!/^[ACDMRTUXB]\d*$/.test(status) || !first) throw new Error("Invalid git name-status output");
		if (status[0] === "R" || status[0] === "C") {
			const path = fields[i++];
			if (!path) throw new Error("Missing destination in git name-status output");
			out.push({ path, origPath: first, code: "R" });
		} else out.push({ path: first, code: mapStatus(status[0]) });
	}
	return out;
}
