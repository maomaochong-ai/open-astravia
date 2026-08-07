export interface TodoItem {
	id: number;
	content: string;
	status: "pending" | "in_progress" | "done";
}

export type TodoLockSource = "scene";

export interface TodoSnapshotEnvelope {
	items: TodoItem[];
	lockedBy: TodoLockSource | null;
}

export type TodoSnapshot = TodoSnapshotEnvelope | TodoItem[];
export type TodoUpdateListener = (items: ReadonlyArray<TodoItem>) => void;

export interface TodoContinuationState {
	getAll(): ReadonlyArray<TodoItem>;
	isLocked(): boolean;
}

export interface SceneTodoState {
	readSceneTodoState(): { readonly locked: boolean; readonly itemCount: number };
	initializeSceneTodoItems(contents: readonly string[]): void;
}

export interface CodingAgentTodoRuntime extends RuntimeDocumentParticipant, RuntimeSessionTodoController {
	getAll(): ReadonlyArray<TodoItem>;
	isLocked(): boolean;
	getLockSource(): TodoLockSource | null;
	createMany(contents: string[]): TodoItem[];
	update(id: number, status: TodoItem["status"]): TodoItem | undefined;
	initializeTodoItems(contents: readonly string[], lockSource?: TodoLockSource): void;
	readSceneTodoState(): { readonly locked: boolean; readonly itemCount: number };
	initializeSceneTodoItems(contents: readonly string[]): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

import type { RuntimeDocumentParticipant, RuntimeSessionTodoController } from "@vetta/runtime-core";
