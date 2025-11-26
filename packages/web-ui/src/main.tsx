import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Note: StrictMode is disabled because it causes issues with WebSocket connections
// in development (double-mounting closes the connection prematurely)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
