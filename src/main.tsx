import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LockGate } from './components/LockGate';
import { UpdateNotice } from './components/UpdateNotice';
import { startPwaUpdates } from './services/pwaUpdate';
import './index.css';

startPwaUpdates();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LockGate>
        <App />
      </LockGate>
    </ErrorBoundary>
    {/* Hors de LockGate (visible sur l'écran de connexion) et hors de
        ErrorBoundary (une version défectueuse doit pouvoir être remplacée). */}
    <UpdateNotice />
  </React.StrictMode>,
);
