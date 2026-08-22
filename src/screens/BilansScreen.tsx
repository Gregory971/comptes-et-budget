import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAccounts } from '../hooks/useData';
import { reportService, periodRange, shiftAnchor, type Granularity } from '../services/reportService';
import { formatEur } from '../utils/money';
import { DonutChart, BarsChart, LineChartSimple, HorizonChart } from '../components/Charts';
import { buildHorizon } from '../services/horizonService';
import { formatFr } from '../utils/date';
import type { Database } from '../types';

export function BilansScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const accounts = useAccounts(dbId);
  const [g, setG] = useState<Granularity>('mois');
  const [anchor, setAnchor] = useState(() => new Date());
  const [accountId, setAccountId] = useState('');

  const [horizonMois, setHorizonMois] = useState(12);
  const range = periodRange(anchor, g);

  const horizon = useLiveQuery(
    () => buildHorizon(dbId, accountId || undefined, horizonMois, database.holidayRegion),
    [dbId, accountId, horizonMois, database.holidayRegion], undefined,
  );
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

      {horizon && (
        <div className="card">
          <div className="row">
            <strong>Trésorerie prévisionnelle</strong>
            <span className="inline" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="bi-horizon">Durée de la projection</label>
              <select id="bi-horizon" value={horizonMois} style={{ width: 130 }}
                onChange={e => setHorizonMois(Number(e.target.value))}>
                <option value={3}>3 mois</option>
                <option value={6}>6 mois</option>
                <option value={12}>12 mois</option>
                <option value={24}>24 mois</option>
              </select>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Solde projeté à partir des échéances programmées (trait plein, montants
            certains) et des enveloppes budgétaires non consommées (pointillé,
            estimations). Les opérations ponctuelles à venir non programmées n’y
            figurent pas.
          </p>

          {horizon.firstNegative ? (
            <p role="alert" style={{
              background: 'color-mix(in oklab, var(--red) 12%, transparent)',
              border: '1px solid var(--red)', borderRadius: 'var(--r-ctl)',
              padding: '10px 14px', fontWeight: 600,
            }}>
              ⚠️ Découvert prévu le {formatFr(horizon.firstNegative.date)} :
              {' '}{formatEur(horizon.firstNegative.balanceCents)} — sur les seules
              échéances programmées.
            </p>
          ) : horizon.firstNegativeWithBudget ? (
            <p role="status" style={{
              background: 'color-mix(in oklab, var(--orange) 14%, transparent)',
              border: '1px solid var(--orange)', borderRadius: 'var(--r-ctl)',
              padding: '10px 14px',
            }}>
              Aucun découvert sur les échéances certaines, mais le budget mensuel
              tenu jusqu’au bout mènerait sous zéro le
              {' '}{formatFr(horizon.firstNegativeWithBudget.date)}.
            </p>
          ) : (
            <p className="muted" role="status">
              Aucun découvert prévu sur {horizonMois} mois.
            </p>
          )}

          <div style={{ marginTop: 12 }}><HorizonChart data={horizon.months} /></div>

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Voir le détail mois par mois</summary>
            <table className="simple" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Mois</th>
                  <th style={{ textAlign: 'right' }}>Ouverture</th>
                  <th style={{ textAlign: 'right' }}>Échéances</th>
                  <th style={{ textAlign: 'right' }}>Point bas</th>
                  <th style={{ textAlign: 'right' }}>Clôture</th>
                  <th style={{ textAlign: 'right' }}>Clôture avec budget</th>
                </tr>
              </thead>
              <tbody>
                {horizon.months.map(m => (
                  <tr key={m.key}>
                    <td style={{ textTransform: 'capitalize' }}>{m.label}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{formatEur(m.openingCents)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{formatEur(m.scheduledCents)}</td>
                    <td className="num" style={{ textAlign: 'right', color: m.lowestCents < 0 ? 'var(--red)' : undefined }}>
                      {formatEur(m.lowestCents)}
                      <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                        {formatFr(m.lowestDate)}</span>
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>{formatEur(m.closingCents)}</td>
                    <td className="num" style={{ textAlign: 'right', opacity: 0.75 }}>
                      {formatEur(m.closingWithBudgetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}

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
