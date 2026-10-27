import '@vibe/core/tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import './theme/tokens.css';
import './theme/table-tokens.css';
import './theme/kanban-tokens.css';
import './theme/scrollbar-tokens.css';
import './theme/editor-tokens.css';
import './index.css';
import { startThemeSync } from './theme/theme';

startThemeSync();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
