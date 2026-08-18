/** Output and process lifecycle operations owned by the host running Print mode. */
export interface CodingAgentPrintOutputPort {
	readonly writeLine: (value: string) => void;
	readonly writeErrorLine: (value: string) => void;
	readonly flush: () => Promise<void>;
	readonly exit: (code: number) => never;
}
