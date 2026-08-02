import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store/useStore';
import { useAccounts, useBalances, useReferentials } from '../hooks/useData';
import { operationService } from '../services/operationService';
import { formatEur } from '../utils/money';
import { formatFr } from '../utils/date';
import type { Database } from '../types';

export function HomeScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const setScreen = useStore(s => s.setScreen);
  const accounts = useAccounts(dbId);
  const balances = useBalances(dbId);
  const ref = useReferentials(dbId);
  const recent = useLiveQuery(() => operationService.recent(dbId, 5), [dbId], []) ?? [];

  const total = accounts.reduce((s, a) => s + (balances[a.id] ?? a.initialBalanceCents), 0);

  return (
    <>
      <h1 className="page-title">Accueil</h1>
      <p className="page-sub">Vue d’ensemble de vos comptes.</p>

      <div className="card">
        <div className="row">
          <div>
            <div className="muted">Solde total</div>
            <div className={'balance ' + (total >= 0 ? 'pos' : 'neg')}>{formatEur(total)}</div>
          </div>
          <button className="btn" onClick={() => setScreen('comptabiliser')}>+ Nouvelle opération</button>
        </div>
      </div>

      <div className="grid two">
        {accounts.map(a => {
          const solde = balances[a.id] ?? a.initialBalanceCents;
          return (
            <div className="card" key={a.id}>
              <div className="muted"><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</div>
              <div className={'balance ' + (solde >= 0 ? 'pos' : 'neg')} style={{ fontSize: 26 }}>
                {formatEur(solde)}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{a.type}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Dernières opérations</strong>
          <button className="btn ghost" onClick={() => setScreen('operations')}>Tout voir</button>
        </div>
        <table className="simple">
          <caption className="sr-only">Cinq dernières opérations enregistrées</caption>
          <tbody>
            {recent.map(o => (
              <tr key={o.id}>
                <td>{formatFr(o.date)}</td>
                <td>{o.label ?? ref.catName(o.categoryId)}</td>
                <td style={{
                  textAlign: 'right',
                  color: o.amountCents < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600,
                }}>{formatEur(o.amountCents)}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td className="muted">Aucune opération.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
