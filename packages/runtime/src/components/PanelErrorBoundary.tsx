import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Clears a caught error when its identity changes (e.g. the panel
   * object after an edit), so fixing the panel un-breaks it live. */
  resetKey: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Catches render crashes inside a single panel so one broken plugin (or
 * malformed spec) cannot take down the whole dashboard — the same
 * degrade-gracefully contract as unknown panel kinds.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="dashglass-panel-error" role="alert">
          <p>Panel crashed: {this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
