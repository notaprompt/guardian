import React from 'react';

/**
 * ErrorBoundary — catches render errors in child panels so a crash
 * in one zone doesn't take down the entire cockpit.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.name || 'unknown'}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__icon">&#x26A0;</div>
          <div className="error-boundary__title">
            {this.props.name || 'Panel'} crashed
          </div>
          <div className="error-boundary__msg">
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button className="error-boundary__retry" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
