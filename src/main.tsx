import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { ClerkGate } from './components/auth/ClerkGate';
import { clerkConfig } from './lib/clerk';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ClerkGate>
        <App />
      </ClerkGate>
    </React.StrictMode>
  );
}

/* A missing or malformed key is a misconfiguration, not a runtime error worth
   masking. ClerkGate already renders an actionable error screen for it, so we
   only surface the developer-facing signal here. The key itself is never
   printed — only the validation verdict. */
if (clerkConfig.status !== 'ok') {
  const detail = `VITE_CLERK_PUBLISHABLE_KEY is ${
    clerkConfig.status === 'missing' ? 'missing' : 'malformed'
  }. Clerk auth cannot start.`;
  if (import.meta.env.DEV) {
    throw new Error(`${detail} Set VITE_CLERK_PUBLISHABLE_KEY in .env.local (publishable key only — never the secret key).`);
  }
  console.error(`[auth] ${detail}`);
}

renderApp();
