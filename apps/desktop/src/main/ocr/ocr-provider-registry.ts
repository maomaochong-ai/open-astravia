import type { OcrProviderDescriptor, OcrProviderInput, OcrRequest, OcrResult } from "@vetta/capability-sdk";

export interface OcrProviderContext {
	readonly signal: AbortSignal;
	readonly invocationId: string;
	getInputPath(inputId: string): Promise<string>;
	reportProgress(event: {
		phase: "queued" | "uploading" | "processing" | "finalizing";
		completed: number;
		total: number;
		itemId?: string;
	}): void;
}

export interface OcrProviderRegistration {
	readonly descriptor: OcrProviderDescriptor;
	recognize(
		request: Omit<OcrRequest, "ownerId" | "providerId" | "inputs"> & { inputs: readonly OcrProviderInput[] },
		context: OcrProviderContext,
	): Promise<OcrResult>;
	dispose?(): void | Promise<void>;
}

export class OcrProviderRegistry {
	private readonly providers = new Map<string, OcrProviderRegistration>();
	private readonly listeners = new Set<() => void>();

	registerProvider(registration: OcrProviderRegistration): { dispose(): void } {
		const id = registration.descriptor.id;
		if (!/^[a-z0-9][a-z0-9._:-]{0,128}$/.test(id)) throw new Error("Invalid OCR provider id");
		if (registration.descriptor.protocolVersion !== 1) throw new Error("Unsupported OCR protocol version");
		if (registration.descriptor.input.mimeTypes.length === 0) throw new Error("OCR provider MIME types are required");
		this.providers.get(id)?.dispose?.();
		this.providers.set(id, registration);
		this.emit();
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.providers.get(id) === registration) {
					this.providers.delete(id);
					void registration.dispose?.();
					this.emit();
				}
			},
		};
	}

	listProviders(): OcrProviderDescriptor[] {
		return [...this.providers.values()].map(({ descriptor }) => structuredClone(descriptor));
	}

	get(providerId: string): OcrProviderRegistration | undefined {
		return this.providers.get(providerId);
	}

	onProvidersChanged(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	dispose(): void {
		const registrations = [...this.providers.values()];
		this.providers.clear();
		this.listeners.clear();
		for (const registration of registrations) void registration.dispose?.();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export function qualifyOcrProviderInputs(request: OcrRequest, ownerId: string): OcrRequest {
	return {
		...request,
		ownerId,
		inputs: request.inputs.map((input, index) => ({ ...input, id: input.id ?? `input-${index + 1}` })),
	};
}
