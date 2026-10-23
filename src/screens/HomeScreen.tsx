import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store/useStore';
import { useAccounts, useBalances, useRates, useReferentials } from '../hooks/useData';
import { operationService } from '../services/operationService';
import { ACCOUNT_TYPE_LABEL, isCash } from '../services/accountService';
import { periodRange, reportService } from '../services/reportService';
import { scheduleService } from '../services/scheduleService';
import { BudgetAlertBanner } from '../components/BudgetAlerts';
import { TasksCard } from '../components/TasksCard';
import { formatEur, formatMoney } from '../utils/money';
import { convert } from '../services/currencyService';
import { formatFr, today } from '../utils/date';
import { hueOf } from '../utils/hue';
import { operationCategoryName } from '../utils/splits';
import type { Database } from '../types';

/**
 * Tableau de bord.
 *
 * Reprend la maquette : quatre indicateurs du mois, puis les dernières
 * opérations et les prochaines échéances côte à côte. Le quatrième indicateur
 * est le *solde* du mois et non une « épargne » : les virements vers un compte
 * d'épargne étant exclus des recettes et dépenses, recettes − dépenses est
 * exactement ce qui a été mis de côté, sans inventer de notion absente du
 * modèle de données.
 */

export function HomeScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const setScreen = useStore(s => s.setScreen);
  const accounts = useAccounts(dbId);
  const balances = useBalances(dbId);
  const rates = useRates(dbId);
  const ref = useReferentials(dbId);
  const recent = useLiveQuery(() => operationService.recent(dbId, 6), [dbId], []) ?? [];

  const range = periodRange(new Date(), 'mois');
  const report = useLiveQuery(
    () => reportService.build(dbId, undefined, range), [dbId, range.from, range.to]);

  const now = today();
  const echeances = useLiveQuery(async () => {
    const all = await scheduleService.list(dbId);
    return all
      .filter(s => s.nextDate >= now && (!s.endDate || s.nextDate <= s.endDate))
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
      .slice(0, 4);
  }, [dbId, now], []) ?? [];

  const total = accounts.filter(isCash).reduce(
    (s, a) => s + convert(balances[a.id] ?? a.initialBalanceCents, rates[a.id] ?? 1), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-sub">Vue d’ensemble de vos comptes.</p>
        </div>
        <span className="period-pill"><span className="pip" aria-hidden="true" />{range.label}</span>
      </div>

      <BudgetAlertBanner dbId={dbId} />

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-lbl">Solde total</div>
          <div className={'kpi-val ' + (total < 0 ? 'neg' : '')}>{formatEur(total)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Recettes du mois</div>
          <div className="kpi-val pos">{report ? formatEur(report.recettesCents) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Dépenses du mois</div>
          <div className="kpi-val neg">{report ? formatEur(-report.depensesCents) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Solde du mois</div>
          <div className={'kpi-val ' + (report && report.soldeCents < 0 ? 'neg' : 'pos')}>
            {report ? formatEur(report.soldeCents) : '—'}
          </div>
        </div>
      </div>

      <div className="dash">
        <div className="card">
          <div className="row" style={{ marginBottom: 16 }}>
            <strong className="panel-t">Dernières opérations</strong>
            <button className="btn ghost" onClick={() => setScreen('operations')}>Tout voir</button>
          </div>
          {recent.map(o => {
            const cat = ref.cat(o.categoryId);
            const virement = !!o.transferId;
            const nom = virement ? 'Virement' : operationCategoryName(o, ref.catName);
            const h = cat?.hue ?? hueOf(nom);
            return (
              <div className="tx" key={o.id}>
                <span className="tx-chip" aria-hidden="true"
                  style={{ background: `oklch(0.94 0.03 ${h})`, color: `oklch(0.4 0.1 ${h})` }}>
                  {virement ? '⇄' : cat?.icon || nom.charAt(0).toUpperCase()}
                </span>
                <span className="tx-main">
                  <span className="tx-lbl">{o.label || nom}</span>
                  <span className="tx-meta">{nom} · {formatFr(o.date)}</span>
                </span>
                <span className={'tx-amt ' + (o.amountCents < 0 ? 'neg' : 'pos')}>
                  {formatEur(o.amountCents)}
                </span>
              </div>
            );
          })}
          {recent.length === 0 && <p className="muted">Aucune opération.</p>}
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 16 }}>
            <strong className="panel-t">Prochaines échéances</strong>
            <button className="btn ghost" onClick={() => setScreen('echeances')}>Voir</button>
          </div>
          <div className="ech-list">
            {echeances.map(s => (
              <div className="ech" key={s.id}>
                <span>
                  <span className="ech-lbl">{s.label || ref.catName(s.categoryId)}</span>
                  <span className="ech-date">{formatFr(s.nextDate)}</span>
                </span>
                <span className="ech-amt">{formatEur(s.amountCents)}</span>
              </div>
            ))}
            {echeances.length === 0 && <p className="muted">Aucune échéance à venir.</p>}
          </div>
        </div>
      </div>

      <div className="acc-grid">
        {accounts.map(a => {
          const solde = balances[a.id] ?? a.initialBalanceCents;
          return (
            <div className="acc" key={a.id}>
              <div className="acc-type">{ACCOUNT_TYPE_LABEL[a.type]}</div>
              <div className="acc-name"><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</div>
              <div className={'acc-val ' + (solde < 0 ? 'neg' : '')}>{formatMoney(solde, a.currency)}</div>
              {a.currency && <div className="muted" style={{ fontSize: 12 }}>≈ {formatEur(convert(solde, rates[a.id] ?? 1))}</div>}
            </div>
          );
        })}
      </div>

      <TasksCard dbId={dbId} />
    </>
  );
}
