import '@vibe/core/tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import './theme/fonts/core.css';
import './theme/tokens.css';
import './theme/table-tokens.css';
import './theme/kanban-tokens.css';
import './theme/calendar-tokens.css';
import './theme/timeline-tokens.css';
import './theme/gantt-tokens.css';
import './theme/workload-tokens.css';
import './theme/automation-tokens.css';
import './theme/chart-tokens.css';
import './theme/form-tokens.css';
import './theme/dashboard-tokens.css';
import './theme/scrollbar-tokens.css';
import './theme/editor-tokens.css';
import './theme/print.css';
import './theme/emoji-tokens.css';
import './index.css';
import { registerServiceWorker } from './lib/register-sw';
import { startThemeSync } from './theme/theme';

startThemeSync();
registerServiceWorker();

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
