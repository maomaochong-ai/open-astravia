import { Component, type ErrorInfo, type ReactNode } from "react";

interface ThemeErrorBoundaryProps {
	children: ReactNode;
	onError(error: Error, info: ErrorInfo): void;
}

interface ThemeErrorBoundaryState {
	failed: boolean;
}

export class ThemeErrorBoundary extends Component<
	ThemeErrorBoundaryProps,
	ThemeErrorBoundaryState
> {
	state: ThemeErrorBoundaryState = { failed: false };

	static getDerivedStateFromError(): ThemeErrorBoundaryState {
		return { failed: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onError(error, info);
	}

	render(): ReactNode {
		if (this.state.failed) {
			return null;
		}
		return this.props.children;
	}
}
