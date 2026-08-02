import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Filet de sécurité applicatif.
 *
 * Correction P3 : aucun accès Dexie n'était protégé et aucune limite d'erreur
 * n'existait. Un quota IndexedDB dépassé, ou un navigateur en navigation privée
 * refusant le stockage, produisait un écran blanc sans le moindre message.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur non rattrapée :', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="onb">
        <div className="box" role="alert">
          <h1>Une erreur est survenue</h1>
          <p className="lead">
            L’application a rencontré un problème et n’a pas pu afficher cet écran.
            Vos données enregistrées ne sont pas affectées.
          </p>
          <pre style={{
            background: '#f4f6f8', padding: 12, borderRadius: 8, fontSize: 12,
            whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto',
          }}>{error.message}</pre>
          <button className="btn" style={{ width: '100%', marginTop: 12 }}
            onClick={() => location.reload()}>Recharger l’application</button>
        </div>
      </div>
    );
  }
}
