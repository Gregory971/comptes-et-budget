import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useReferentials } from '../hooks/useData';
import { MoneyInput } from '../components/MoneyInput';
import { ConfirmDialog } from '../components/Modal';
import { budgetService } from '../services/budgetService';
import { formatEur, type Cents } from '../utils/money';
import type { Database, Budget } from '../types';

export function BudgetScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const ref = useReferentials(dbId);
  const [catId, setCatId] = useState('');
  const [amountCents, setAmountCents] = useState<Cents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Budget | null>(null);

  // Une seule lecture de la tranche du mois, agrégée par catégorie.
  const rows = useLiveQuery(() => budgetService.monthlyStatus(dbId), [dbId], []) ?? [];
  const sorted = [...rows].sort((a, b) =>
    ref.catName(a.budget.categoryId).localeCompare(ref.catName(b.budget.categoryId), 'fr'));

  const totalBudget = rows.reduce((s, r) => s + r.budget.monthlyAmountCents, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spentCents, 0);
  const budgeted = new Set(rows.map(r => r.budget.categoryId));
  const available = ref.catsForKind('depense').filter(c => !budgeted.has(c.id));

  async function define() {
    if (!catId) { setError('Choisissez une catégorie.'); return; }
    if (amountCents === null || amountCents <= 0) { setError('Indiquez un montant supérieur à zéro.'); return; }
    setError(null);
    await budgetService.set(dbId, catId, amountCents);
    setCatId(''); setAmountCents(null);
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
          <div style={{ width: 190 }}>
            <MoneyInput label="Budget mensuel (€)" valueCents={amountCents} onChange={setAmountCents} />
          </div>
          <button className="btn" onClick={define}>Définir</button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--red)', margin: 0 }}>{error}</p>}
        {available.length === 0 && (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Toutes les catégories de dépense ont déjà un budget.</p>
        )}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <strong className="panel-t">Suivi des budgets</strong>
        <span className="muted">{formatEur(totalSpent)} / {formatEur(totalBudget)}</span>
      </div>

      {sorted.length === 0 ? <p className="muted">Aucun budget défini.</p> : (
        <div className="bud-grid">
          {sorted.map(r => {
            const cat = ref.cat(r.budget.categoryId);
            const over = r.percent >= 100;
            // Teintes de la maquette : turquoise tant que la marge est
            // confortable, corail à l'approche du plafond, rouge au-delà.
            const hue = over ? 30 : r.percent >= 85 ? 45 : 195;
            return (
              <div className="bud" key={r.budget.id}>
                <div className="row" style={{ alignItems: 'baseline', marginBottom: 12 }}>
                  <span className="bud-cat">
                    <span aria-hidden="true">{cat?.icon}</span> {cat?.name ?? 'Catégorie supprimée'}
                  </span>
                  <span className="bud-num">
                    {formatEur(r.spentCents)} / {formatEur(r.budget.monthlyAmountCents)}
                    <button className="iconbtn" style={{ marginLeft: 8 }}
                      aria-label={`Supprimer le budget ${cat?.name ?? ''}`}
                      onClick={() => setConfirmRemove(r.budget)}>🗑</button>
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(r.percent)}
                  aria-valuemin={0} aria-valuemax={100}
                  aria-label={`Consommation du budget ${cat?.name ?? ''}`}>
                  <div style={{
                    width: Math.min(100, r.percent) + '%', height: '100%',
                    borderRadius: 999, background: `oklch(0.62 0.14 ${hue})`,
                  }} />
                </div>
                <div className="bud-status" style={over ? { color: 'var(--red)' } : undefined}>
                  {r.remainingCents >= 0
                    ? `${r.percent.toFixed(0)} % utilisé · reste ${formatEur(r.remainingCents)}`
                    : `Budget dépassé de ${formatEur(-r.remainingCents)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog title="Supprimer le budget" danger confirmLabel="Supprimer"
          message={`Supprimer le budget de la catégorie « ${ref.catName(confirmRemove.categoryId)} » ? Les opérations ne sont pas affectées.`}
          onConfirm={() => budgetService.remove(confirmRemove.id)}
          onClose={() => setConfirmRemove(null)} />
      )}
    </>
  );
}
