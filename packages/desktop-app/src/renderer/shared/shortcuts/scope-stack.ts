import { isEditableKeyboardTarget } from "@vetta/theme-ui/file-preview";
import { matchesShortcut } from "../lib/platform";

/**
 * Keyboard shortcut scopes (priority high → low):
 * - modal: confirm dialogs, exclusive
 * - overlay: command / @ / skill pickers
 * - surface: file editor, image gallery, activity panels
 * - app: global configurable shortcuts (always bottom)
 *
 * Matching walks scopes by kind rank, then registration order (later wins).
 * No ad-hoc window keydown in feature code — register a scope instead.
 */

export type ShortcutScopeKind = "app" | "surface" | "overlay" | "modal";

export type ShortcutBindingWhen = "always" | "editable" | "not-editable";

export interface ShortcutBinding {
	/** Serialized combo, e.g. "mod+s", "arrowleft", "escape" (see eventToShortcut). */
	key: string;
	run: (event: KeyboardEvent) => void;
	/** Default "always". Restrict to / out of editable targets (CodeMirror, inputs). */
	when?: ShortcutBindingWhen;
	preventDefault?: boolean;
	stopPropagation?: boolean;
}

export interface ShortcutScopeRegistration {
	id: string;
	kind: ShortcutScopeKind;
	/** When true, unmatched keys do not fall through to lower scopes. */
	exclusive?: boolean;
	/** Dynamic gate; re-checked on every keydown. */
	enabled?: () => boolean;
	/** Latest bindings (read each keydown so handlers stay fresh). */
	getBindings: () => readonly ShortcutBinding[];
}

export interface ShortcutScopeHandle {
	id: string;
	dispose: () => void;
}

const KIND_RANK: Record<ShortcutScopeKind, number> = {
	app: 0,
	surface: 1,
	overlay: 2,
	modal: 3,
};

interface InternalScope extends ShortcutScopeRegistration {
	seq: number;
}

function bindingApplies(binding: ShortcutBinding, event: KeyboardEvent): boolean {
	const when = binding.when ?? "always";
	if (when === "always") return true;
	const editable = isEditableKeyboardTarget(event.target);
	if (when === "editable") return editable;
	return !editable;
}

export class ShortcutScopeStack {
	private scopes: InternalScope[] = [];
	private seq = 0;
	private listening = false;

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented) return;

		const ordered = this.scopes
			.filter((scope) => (scope.enabled ? scope.enabled() : true))
			.sort((a, b) => {
				const rank = KIND_RANK[b.kind] - KIND_RANK[a.kind];
				if (rank !== 0) return rank;
				return b.seq - a.seq;
			});

		for (const scope of ordered) {
			const bindings = scope.getBindings();
			for (const binding of bindings) {
				if (!matchesShortcut(event, binding.key)) continue;
				if (!bindingApplies(binding, event)) continue;

				binding.run(event);
				if (binding.preventDefault !== false) event.preventDefault();
				if (binding.stopPropagation !== false) event.stopPropagation();
				return;
			}
			if (scope.exclusive) return;
		}
	};

	private ensureListening(): void {
		if (this.listening || typeof document === "undefined") return;
		document.addEventListener("keydown", this.onKeyDown, true);
		this.listening = true;
	}

	private stopListeningIfEmpty(): void {
		if (this.scopes.length > 0 || !this.listening || typeof document === "undefined") return;
		document.removeEventListener("keydown", this.onKeyDown, true);
		this.listening = false;
	}

	register(registration: ShortcutScopeRegistration): ShortcutScopeHandle {
		const entry: InternalScope = { ...registration, seq: ++this.seq };
		this.scopes.push(entry);
		this.ensureListening();
		return {
			id: registration.id,
			dispose: () => {
				this.scopes = this.scopes.filter((s) => s !== entry);
				this.stopListeningIfEmpty();
			},
		};
	}

	/** Test / debug: current scope ids high→low priority. */
	debugSnapshot(): string[] {
		return this.scopes
			.slice()
			.sort((a, b) => {
				const rank = KIND_RANK[b.kind] - KIND_RANK[a.kind];
				if (rank !== 0) return rank;
				return b.seq - a.seq;
			})
			.map((s) => `${s.kind}:${s.id}`);
	}

	/** Test helper — invoke the dispatcher without a real document. */
	handleKeyDownForTests(event: KeyboardEvent): void {
		this.onKeyDown(event);
	}

	/** Test helper. */
	resetForTests(): void {
		this.scopes = [];
		this.seq = 0;
		if (this.listening && typeof document !== "undefined") {
			document.removeEventListener("keydown", this.onKeyDown, true);
		}
		this.listening = false;
	}
}

let singleton: ShortcutScopeStack | null = null;

export function getShortcutScopeStack(): ShortcutScopeStack {
	if (!singleton) singleton = new ShortcutScopeStack();
	return singleton;
}

/** Replace singleton (tests only). */
export function __setShortcutScopeStackForTests(stack: ShortcutScopeStack | null): void {
	singleton = stack;
}
