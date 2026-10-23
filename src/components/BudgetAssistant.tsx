import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal, ConfirmDialog } from './Modal';
import { MoneyInput } from './MoneyInput';
import { useReferentials } from '../hooks/useData';
import { budgetService, type BudgetSuggestion } from '../services/budgetService';
import { formatEur, type Cents } from '../utils/money';
import { formatFr, type Ymd } from '../utils/date';

type Preset = '12m' | 'annee' | 'perso';

const NO_SUGGESTIONS: BudgetSuggestion[] = [];

/** Plage d'observation selon le choix : douze derniers mois complets, année civile précédente, ou dates libres. */
function rangeOf(preset: Preset, from: Ymd, to: Ymd, now = new Date()): { from: Ymd; to: Ymd } {
  if (preset === '12m') return budgetService.lastTwelveMonths(now);
  if (preset === 'annee') return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
  return { from, to };
}

/**
 * Assistant d'initialisation du budget : propose, catégorie par catégorie, la
 * moyenne mensuelle réellement dépensée sur une période passée. Rien n'est écrit
 * avant « Appliquer », et chaque montant reste modifiable ligne par ligne.
 */
export function BudgetAssistant({ dbId, onClose, onApplied }: { dbId: string; onClose: () => void; onApplied?: (msg: string) => void }) {
  const ref = useReferentials(dbId);
  const [preset, setPreset] = useState<Preset>('12m');
  const [from, setFrom] = useState<Ymd>('');
  const [to, setTo] = useState<Ymd>('');
  const [step, setStep] = useState<Cents>(500);
  const [replace, setReplace] = useState(false);
  const [edited, setEdited] = useState<Record<string, Cents | null>>({});
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = rangeOf(preset, from, to);
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const rows = useLiveQuery(
    async () => (valid ? budgetService.suggest(dbId, range, step) : NO_SUGGESTIONS),
    [dbId, range.from, range.to, step, valid], NO_SUGGESTIONS,
  ) ?? NO_SUGGESTIONS;

  const amountOf = (r: BudgetSuggestion): Cents | null => (r.categoryId in edited ? edited[r.categoryId] : r.suggestedCents);
  // Ce qui sera réellement écrit : coché, avec un montant valide, et sans écraser un budget existant hors mode « remplacer ».
  const willApply = (r: BudgetSuggestion) => !unchecked[r.categoryId] && (replace || !r.hasBudget) && (amountOf(r) ?? 0) > 0;
  const applicable = rows.filter(willApply);
  const total = applicable.reduce((s, r) => s + (amountOf(r) ?? 0), 0);

  async function apply() {
    setError(null);
    try {
      const r = await budgetService.applySuggestions(dbId,
        applicable.map(x => ({ categoryId: x.categoryId, monthlyCents: amountOf(x) as Cents })), replace);
      onApplied?.(`${r.created} budget(s) créé(s)${r.replaced ? `, ${r.replaced} remplacé(s)` : ''}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Initialiser le budget d’après les dépenses réelles" onClose={onClose} width={720}>
      <div className="grid two">
        <div className="field"><label htmlFor="ba-preset">Période observée</label>
          <select id="ba-preset" value={preset} onChange={e => { setPreset(e.target.value as Preset); setEdited({}); }}>
            <option value="12m">Les 12 derniers mois complets</option>
            <option value="annee">L’année précédente</option>
            <option value="perso">Une période à choisir</option>
          </select></div>
        <div className="field"><label htmlFor="ba-step">Arrondir au supérieur</label>
          <select id="ba-step" value={step} onChange={e => { setStep(Number(e.target.value)); setEdited({}); }}>
            <option value={1}>Au centime</option><option value={100}>À l’euro</option>
            <option value={500}>À 5 €</option><option value={1000}>À 10 €</option>
          </select></div>
        {preset === 'perso' && (
          <>
            <div className="field"><label htmlFor="ba-from">Du</label>
              <input id="ba-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="field"><label htmlFor="ba-to">Au</label>
              <input id="ba-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </>
        )}
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
        Remplacer aussi les budgets déjà définis (sinon ils sont conservés)
      </label>

      {!valid ? <p className="muted" role="status">Choisissez une période : la date de début doit précéder celle de fin.</p> : (
        <p className="muted" role="status" style={{ fontSize: 13 }}>
          {rows.length === 0 ? 'Aucune dépense catégorisée sur cette période.'
            : `Moyennes mensuelles du ${formatFr(range.from)} au ${formatFr(range.to)} — ${rows.length} catégorie(s).`}
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <table className="simple">
            <thead><tr>
              <th scope="col"><span className="sr-only">Retenir</span></th><th scope="col">Catégorie</th>
              <th scope="col" style={{ textAlign: 'right' }}>Moyenne / mois</th><th scope="col" style={{ width: 150 }}>Budget proposé</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const name = ref.catName(r.categoryId);
                const locked = r.hasBudget && !replace;
                return (
                  <tr key={r.categoryId} style={{ opacity: locked ? 0.55 : 1 }}>
                    <td><input type="checkbox" checked={!locked && !unchecked[r.categoryId]} disabled={locked}
                      aria-label={`Retenir ${name}`} onChange={e => setUnchecked({ ...unchecked, [r.categoryId]: !e.target.checked })} /></td>
                    <td>{ref.cat(r.categoryId)?.icon} {name}
                      {r.hasBudget && <span className="chip" style={{ marginLeft: 8 }}>{replace ? 'sera remplacé' : 'déjà un budget'}</span>}</td>
                    <td style={{ textAlign: 'right' }}>{formatEur(r.averageCents)}</td>
                    <td>
                      <MoneyInput ariaLabel={`Budget proposé pour ${name}`} valueCents={amountOf(r)}
                        onChange={v => setEdited({ ...edited, [r.categoryId]: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <span>
          <button className="linklike" onClick={() => setConfirmReset(true)}>Remettre tous les budgets à zéro</button>
        </span>
        <span>
          <span className="muted" style={{ marginRight: 12 }}>{applicable.length} budget(s) · {formatEur(total)} / mois</span>
          <button className="btn ghost" style={{ marginRight: 8 }} onClick={onClose}>Annuler</button>
          <button className="btn" disabled={applicable.length === 0} onClick={apply}>Appliquer</button>
        </span>
      </div>

      {confirmReset && (
        <ConfirmDialog title="Remettre le budget à zéro" danger confirmLabel="Tout supprimer"
          message="Supprimer TOUS les budgets mensuels ? Les opérations ne sont pas affectées."
          onConfirm={async () => { const n = await budgetService.reset(dbId); onApplied?.(`${n} budget(s) supprimé(s).`); onClose(); }}
          onClose={() => setConfirmReset(false)} />
      )}
    </Modal>
  );
}
