import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { currencyService } from '../services/currencyService';
import { formatFr } from '../utils/date';
import type { Currency, Database } from '../types';

/** « 0,92 » → 0.92 ; NaN si illisible. Le taux n'est pas un montant : on garde des décimales. */
export function parseRateInput(text: string): number {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

const formatRate = (r: number) => r.toLocaleString('fr-FR', { maximumFractionDigits: 6 });

/** Préférences → Devises : devises étrangères et taux de change vers la devise de la base. */
export function CurrenciesTab({ database }: { database: Database }) {
  const dbId = database.id;
  const base = database.currency || 'EUR';
  const devises = useLiveQuery(() => currencyService.list(dbId), [dbId], [] as Currency[]) ?? [];
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; rate: string } | null>(null);

  async function add() {
    setError(null);
    try {
      await currencyService.create({ dbId, code, name, rate: parseRateInput(rate) });
      setCode(''); setName(''); setRate('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveRate(c: Currency) {
    if (!editing) return;
    setError(null);
    try {
      await currencyService.update(c.id, { rate: parseRateInput(editing.rate) });
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        Chaque compte est tenu dans sa devise. Les totaux qui réunissent plusieurs comptes (solde total, bilans,
        budgets, prévisions) sont exprimés en <strong>{base}</strong>, au taux indiqué ici. Ce taux est celui que vous
        saisissez : l’application ne consulte aucun service de cours, et il n’y a pas d’historique des taux.
      </p>

      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ width: 90 }}><label htmlFor="cu-code">Code</label>
          <input id="cu-code" value={code} maxLength={3} placeholder="USD"
            onChange={e => setCode(e.target.value.toUpperCase())} /></div>
        <div className="field grow"><label htmlFor="cu-name">Nom</label>
          <input id="cu-name" value={name} placeholder="Dollar américain" onChange={e => setName(e.target.value)} /></div>
        <div className="field" style={{ width: 150 }}><label htmlFor="cu-rate">1 unité = … {base}</label>
          <input id="cu-rate" inputMode="decimal" value={rate} placeholder="0,92" onChange={e => setRate(e.target.value)} /></div>
        <button className="btn" onClick={add}>Ajouter</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <table className="simple">
        <thead><tr>
          <th scope="col">Devise</th><th scope="col" style={{ textAlign: 'right' }}>Taux vers {base}</th>
          <th scope="col">Mis à jour</th><th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          <tr>
            <td><strong>{base}</strong> <span className="muted">devise de la base</span></td>
            <td style={{ textAlign: 'right' }}>1</td><td /><td />
          </tr>
          {devises.map(c => (
            <tr key={c.id}>
              <td><strong>{c.code}</strong> <span className="muted">{c.name}</span></td>
              <td style={{ textAlign: 'right' }}>
                {editing?.id === c.id ? (
                  <input aria-label={`Taux de ${c.code}`} inputMode="decimal" style={{ width: 110, textAlign: 'right' }}
                    value={editing.rate} autoFocus
                    onChange={e => setEditing({ id: c.id, rate: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') void saveRate(c); if (e.key === 'Escape') setEditing(null); }} />
                ) : formatRate(c.rate)}
              </td>
              <td>{formatFr(c.updatedAt.slice(0, 10))}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {editing?.id === c.id ? (
                  <>
                    <button className="btn" onClick={() => saveRate(c)}>Enregistrer</button>
                    <button className="btn ghost" style={{ marginLeft: 6 }} onClick={() => setEditing(null)}>Annuler</button>
                  </>
                ) : (
                  <>
                    <button className="btn ghost" onClick={() => setEditing({ id: c.id, rate: String(c.rate).replace('.', ',') })}>Modifier le taux</button>
                    <button className="iconbtn" style={{ marginLeft: 6 }} aria-label={`Supprimer la devise ${c.code}`}
                      onClick={async () => {
                        setError(null);
                        try { await currencyService.remove(c.id); } catch (e) { setError((e as Error).message); }
                      }}>🗑</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {devises.length === 0 && <tr><td colSpan={4} className="muted">Aucune devise étrangère.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
