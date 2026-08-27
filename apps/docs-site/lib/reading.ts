export type FieldNoteTone = "info" | "warn" | "warning" | "error" | "success" | "idea";

const FIELD_NOTE_LABELS: Record<FieldNoteTone, string> = {
	info: "FIELD NOTE",
	warn: "WATCH",
	warning: "WATCH",
	error: "STOP",
	success: "LOCKED",
	idea: "IDEA",
};

export function fieldNoteLabel(type: FieldNoteTone | undefined): string {
	return FIELD_NOTE_LABELS[type ?? "info"];
}

export function fieldNoteIsAlert(type: FieldNoteTone | undefined): boolean {
	return type === "warn" || type === "warning" || type === "error";
}
