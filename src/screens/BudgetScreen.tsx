import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useReferentials } from '../hooks/useData';
import { MoneyInput } from '../components/MoneyInput';
import { ConfirmDialog } from '../components/Modal';
import { BudgetAssistant } from '../components/BudgetAssistant';
import { PERIOD_LABEL, budgetService } from '../services/budgetService';
import { budgetState, LEVEL_LABEL } from '../services/budgetAlertService';
import { useBudgetAlertPrefs } from '../hooks/useBudgetAlerts';
import { formatEur, type Cents } from '../utils/money';
import type { Database, Budget, BudgetPeriod } from '../types';

export function BudgetScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const ref = useReferentials(dbId);
  const [catId, setCatId] = useState('');
  const [amountCents, setAmountCents] = useState<Cents | null>(null);
  const [period, setPeriod] = useState<BudgetPeriod>(1);
  const [editing, setEditing] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Budget | null>(null);

  // Seuil d'attention choisi dans les Préférences (80 % par défaut).
  const { threshold } = useBudgetAlertPrefs();
  // Une seule lecture de la tranche du mois, agrégée par catégorie.
  // Sans valeur initiale : tant que la lecture n'a pas abouti, on n'affiche pas « aucun budget ».
  const lues = useLiveQuery(() => budgetService.monthlyStatus(dbId), [dbId]);
  const chargees = lues !== undefined;
  const rows = lues ?? [];
  const sorted = [...rows].sort((a, b) =>
    ref.catName(a.budget.categoryId).localeCompare(ref.catName(b.budget.categoryId), 'fr'));

  const totalBudget = rows.reduce((s, r) => s + r.budget.monthlyAmountCents, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spentCents, 0);
  const budgeted = new Set(rows.map(r => r.budget.categoryId));
  // En modification, la catégorie du budget édité reste proposée (elle a déjà un budget).
  const available = ref.catsForKind('depense').filter(c => !budgeted.has(c.id) || (editing && c.id === catId));

  async function define() {
    if (!catId) { setError('Choisissez une catégorie.'); return; }
    if (amountCents === null || amountCents <= 0) { setError('Indiquez un montant supérieur à zéro.'); return; }
    setError(null);
    try {
      await budgetService.setPeriodic(dbId, catId, amountCents, period);
      setCatId(''); setAmountCents(null); setPeriod(1); setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Reprend un budget dans le formulaire, tel qu'il a été saisi (montant et période d'origine). */
  function edit(b: Budget) {
    setCatId(b.categoryId); setAmountCents(b.periodAmountCents ?? b.monthlyAmountCents);
    setPeriod(b.periodMonths ?? 1); setEditing(true); setError(null);
  }

  return (
    <>
      <h1 className="page-title">Budget</h1>
      <p className="page-sub">Budgets prévisionnels mensuels par catégorie — suivi du mois en cours.</p>

      <div className="card">
        <div className="inline">
          <div className="field grow"><label htmlFor="bu-cat">Catégorie de dépense</label>
            <select id="bu-cat" value={catId} onChange={e => setCatId(e.target.value)}>
              <option value="">Choisir…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select></div>
          <div style={{ width: 170 }}>
            <MoneyInput label="Montant du budget (€)" valueCents={amountCents} onChange={setAmountCents} />
          </div>
          <div className="field" style={{ width: 150 }}><label htmlFor="bu-period">Période</label>
            <select id="bu-period" value={period} onChange={e => setPeriod(Number(e.target.value) as BudgetPeriod)}>
              {([1, 3, 6, 12] as BudgetPeriod[]).map(p => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></div>
          <button className="btn" onClick={define}>{editing ? 'Enregistrer' : 'Définir'}</button>
          {editing && <button className="btn ghost" onClick={() => { setEditing(false); setCatId(''); setAmountCents(null); setPeriod(1); }}>Annuler</button>}
        </div>
        {period > 1 && amountCents !== null && amountCents > 0 && (
          <p className="muted" role="status" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Soit {formatEur(Math.round(amountCents / period))} par mois : le suivi du mois s’appuie sur ce lissage.
          </p>
        )}
        {error && <p role="alert" style={{ color: 'var(--red)', margin: 0 }}>{error}</p>}
        {chargees && available.length === 0 && (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Toutes les catégories de dépense ont déjà un budget.</p>
        )}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <strong className="panel-t">Suivi des budgets</strong>
        <span>
          <span className="muted" style={{ marginRight: 12 }}>{formatEur(totalSpent)} / {formatEur(totalBudget)}</span>
          <button className="btn ghost" onClick={() => setAssistant(true)}>Initialiser d’après les dépenses…</button>
        </span>
      </div>
      {notice && (
        <div className="toast" role="status">{notice}
          <button className="linklike" style={{ marginLeft: 10 }} onClick={() => setNotice(null)}>Fermer</button></div>
      )}

      {sorted.length === 0 ? (chargees ? <p className="muted">Aucun budget défini.</p> : null) : (
        <div className="bud-grid">
          {sorted.map(r => {
            const cat = ref.cat(r.budget.categoryId);
            // État d'après la consommation réelle : « 100 % pile » est une
            // attention (budget atteint), pas encore un dépassement.
            const state = budgetState(r.spentCents, r.budget.monthlyAmountCents, threshold);
            const over = state === 'depasse';
            // Teintes de la maquette : turquoise tant que la marge est
            // confortable, corail à l'approche du plafond, rouge au-delà.
            const hue = over ? 30 : state === 'attention' ? 45 : 195;
            const shown = Math.round(r.rawPercent);
            return (
              <div className={'bud' + (state === 'ok' ? '' : ' ' + state)} key={r.budget.id}>
                <div className="row" style={{ alignItems: 'baseline', marginBottom: 12 }}>
                  <span className="bud-cat">
                    <span aria-hidden="true">{cat?.icon}</span> {cat?.name ?? 'Catégorie supprimée'}
                  </span>
                  <span className="bud-num">
                    {formatEur(r.spentCents)} / {formatEur(r.budget.monthlyAmountCents)}
                    <button className="iconbtn" style={{ marginLeft: 8 }}
                      aria-label={`Modifier le budget ${cat?.name ?? ''}`}
                      onClick={() => edit(r.budget)}>✏️</button>
                    <button className="iconbtn" style={{ marginLeft: 4 }}
                      aria-label={`Supprimer le budget ${cat?.name ?? ''}`}
                      onClick={() => setConfirmRemove(r.budget)}>🗑</button>
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(r.percent)}
                  aria-valuemin={0} aria-valuemax={100}
                  aria-valuetext={`${shown} % du budget${over ? ', dépassé' : ''}`}
                  aria-label={`Consommation du budget ${cat?.name ?? ''}`}>
                  <div style={{
                    width: Math.min(100, r.percent) + '%', height: '100%',
                    borderRadius: 999, background: `oklch(0.62 0.14 ${hue})`,
                  }} />
                </div>
                {r.budget.periodMonths && r.budget.periodAmountCents !== undefined && (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    Budget de {formatEur(r.budget.periodAmountCents)} {PERIOD_LABEL[r.budget.periodMonths]}, lissé sur le mois.
                  </div>
                )}
                <div className={'bud-status' + (state === 'ok' ? '' : ' ' + state)}>
                  {state !== 'ok' && (
                    <span className="bud-flag">
                      <span aria-hidden="true">{over ? '⛔' : '⚠️'}</span> {LEVEL_LABEL[state]}
                    </span>
                  )}
                  {r.remainingCents >= 0
                    ? `${Math.floor(r.percent)} % utilisé · reste ${formatEur(r.remainingCents)}`
                    : `Budget dépassé de ${formatEur(-r.remainingCents)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assistant && <BudgetAssistant dbId={dbId} onClose={() => setAssistant(false)} onApplied={setNotice} />}

      {confirmRemove && (
        <ConfirmDialog title="Supprimer le budget" danger confirmLabel="Supprimer"
          message={`Supprimer le budget de la catégorie « ${ref.catName(confirmRemove.categoryId)} » ? Les opérations ne sont pas affectées.`}
          onConfirm={() => budgetService.remove(confirmRemove.id)}
          onClose={() => setConfirmRemove(null)} />
      )}
    </>
  );
}
