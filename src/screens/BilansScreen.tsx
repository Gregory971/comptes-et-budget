import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAccounts } from '../hooks/useData';
import { reportService, periodRange, shiftAnchor, type Granularity } from '../services/reportService';
import { formatEur } from '../utils/money';
import { DonutChart, BarsChart, LineChartSimple } from '../components/Charts';
import type { Database } from '../types';

export function BilansScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const accounts = useAccounts(dbId);
  const [g, setG] = useState<Granularity>('mois');
  const [anchor, setAnchor] = useState(() => new Date());
  const [accountId, setAccountId] = useState('');

  const range = periodRange(anchor, g);
  const data = useLiveQuery(
    () => reportService.build(dbId, accountId || undefined, range),
    [dbId, accountId, range.from, range.to], undefined,
  );

  return (
    <>
      <h1 className="page-title">Bilans</h1>
      <p className="page-sub">Analyse de vos recettes et dépenses par période. Les virements entre
        comptes sont exclus des totaux.</p>

      <div className="card">
        <div className="inline" style={{ marginBottom: 0, justifyContent: 'space-between' }}>
          <div className="inline" style={{ margin: 0 }}>
            <button className="btn ghost" aria-label="Période précédente"
              onClick={() => setAnchor(shiftAnchor(anchor, g, -1))}>←</button>
            <strong style={{ minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }}
              aria-live="polite">{range.label}</strong>
            <button className="btn ghost" aria-label="Période suivante"
              onClick={() => setAnchor(shiftAnchor(anchor, g, 1))}>→</button>
          </div>
          <div className="inline" style={{ margin: 0 }}>
            <label className="sr-only" htmlFor="bi-gran">Granularité</label>
            <select id="bi-gran" value={g} onChange={e => setG(e.target.value as Granularity)} style={{ width: 130 }}>
              <option value="mois">Mois</option><option value="trimestre">Trimestre</option>
              <option value="annee">Année</option>
            </select>
            <label className="sr-only" htmlFor="bi-acc">Compte</label>
            <select id="bi-acc" value={accountId} onChange={e => setAccountId(e.target.value)} style={{ width: 170 }}>
              <option value="">Tous les comptes</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {data === undefined ? <p className="muted">Calcul en cours…</p> : (
        <>
          <div className="grid two">
            <div className="card"><div className="muted">Recettes</div>
              <div className="balance pos" style={{ fontSize: 26 }}>{formatEur(data.recettesCents)}</div></div>
            <div className="card"><div className="muted">Dépenses</div>
              <div className="balance neg" style={{ fontSize: 26 }}>{formatEur(data.depensesCents)}</div></div>
          </div>
          <div className="card"><div className="muted">Solde de la période</div>
            <div className={'balance ' + (data.soldeCents >= 0 ? 'pos' : 'neg')} style={{ fontSize: 26 }}>
              {formatEur(data.soldeCents)}</div></div>

          <div className="card"><strong>Dépenses par catégorie</strong>
            <div style={{ marginTop: 12 }}><DonutChart data={data.byCategory} /></div></div>
          <div className="card"><strong>Recettes vs dépenses</strong>
            <div style={{ marginTop: 12 }}><BarsChart data={data.byMonth} /></div></div>
          <div className="card"><strong>Évolution du solde</strong>
            <div style={{ marginTop: 12 }}><LineChartSimple data={data.balanceCurve} /></div></div>
        </>
      )}
    </>
  );
}
