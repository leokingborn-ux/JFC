import React from 'react';

type Props = { children: React.ReactNode };

type State = { hasError: boolean; error?: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    // Could send to main process or remote logging here
    try {
      if ((window as any).electron && typeof (window as any).electron?.onSystemStatus === 'function') {
        // noop - avoid bundling heavy logging
      }
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#020617] text-slate-200">
          <div className="max-w-xl p-6 bg-slate-900/80 border border-rose-800 rounded-lg">
            <h2 className="text-xl font-bold text-rose-400 mb-2">Application Error</h2>
            <p className="text-sm text-slate-300 mb-4">An unexpected error occurred while rendering the UI.</p>
            <pre className="text-xs font-mono text-slate-200 bg-slate-800 p-3 rounded overflow-auto">{String(this.state.error)}</pre>
            <div className="mt-4 text-sm text-slate-400">Try restarting the app. Check the main process logs for details.</div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
