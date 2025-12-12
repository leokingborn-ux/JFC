import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import StartupGate from './components/StartupGate';

const rootElement = document.getElementById('root');
if (!rootElement) {
  // Show a minimal fallback in case the DOM is malformed
  document.body.innerHTML = '<div style="background:#020617;color:#fff;padding:24px;font-family:sans-serif">Renderer failed to mount: root element missing</div>';
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <StartupGate>
        <App />
      </StartupGate>
    </ErrorBoundary>
  </React.StrictMode>
);