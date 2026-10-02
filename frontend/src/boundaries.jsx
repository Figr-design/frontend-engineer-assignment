import { Component } from "react";
import { reportFailure } from "./failures.js";

export class RegionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    reportFailure(error, {
      region: this.props.region,
      screenId: this.props.screenId ?? null,
      elementKey: this.props.elementKey,
    });
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className={this.props.className || "region-error"}>
          <p>{this.props.message || "Something went wrong"}</p>
          <button type="button" onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
