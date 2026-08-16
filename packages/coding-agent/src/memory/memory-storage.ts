export interface MemoryTextStorage {
	read(): string | undefined;
	replace(content: string): void;
	append(content: string): void;
}
