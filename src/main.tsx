import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import './styles.css';
import { clerkPublishableKey } from './lib/clerk';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    </React.StrictMode>
  );
}

/* Failure to load the publishable key is a misconfiguration, not a runtime
   error worth masking. Surface it loudly in development. The key itself is
   never printed. */
if (!clerkPublishableKey) {
  if (import.meta.env.DEV) {
    throw new Error(
      'Clerk is not configured. Set VITE_CLERK_PUBLISHABLE_KEY in .env.local (publishable key only — never the secret key).'
    );
  }
  console.error('[auth] VITE_CLERK_PUBLISHABLE_KEY is missing — Clerk auth is disabled.');
}

renderApp();
