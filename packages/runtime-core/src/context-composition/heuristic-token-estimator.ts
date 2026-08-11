import type { TokenEstimate, TokenEstimateRequest, TokenEstimator } from "./contracts.js";

export interface HeuristicTokenEstimatorOptions {
	readonly charactersPerToken?: number;
	readonly tokenizerId?: string;
}

export class HeuristicTokenEstimator implements TokenEstimator {
	readonly #charactersPerToken: number;
	readonly #tokenizerId: string;

	constructor(options: HeuristicTokenEstimatorOptions = {}) {
		this.#charactersPerToken = options.charactersPerToken ?? 4;
		if (!Number.isFinite(this.#charactersPerToken) || this.#charactersPerToken <= 0) {
			throw new RangeError("charactersPerToken must be a positive finite number");
		}
		this.#tokenizerId = options.tokenizerId ?? `chars-per-token:${this.#charactersPerToken}`;
	}

	estimate(request: TokenEstimateRequest): TokenEstimate {
		return {
			tokens: Math.ceil(Array.from(request.content).length / this.#charactersPerToken),
			method: "heuristic",
			tokenizerId: this.#tokenizerId,
		};
	}
}
