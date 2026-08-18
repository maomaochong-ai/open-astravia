import type { BatchTask } from "@shared/store/atoms";

export interface TaskCallbacks {
	delete: (task: BatchTask) => void;
	goToSession: (task: BatchTask) => void;
	resume: (taskId: string) => void;
	retry: (task: BatchTask) => void;
	run: (taskId: string) => void;
	stop: (taskId: string) => void;
}

export interface TaskTone {
	bg: string;
	dot: string;
	ring: string;
	text: string;
}
