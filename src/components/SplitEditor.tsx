import { MoneyInput } from './MoneyInput';
import { formatEur, type Cents } from '../utils/money';
import type { Category } from '../types';

export interface SplitRow {
  /** Clé de liste stable pendant la saisie. */
  key: string;
  categoryId: string;
  /** Montant POSITIF saisi ; null tant qu'il est vide ou invalide. */
  amountCents: Cents | null;
}

let compteur = 0;
export const newSplitRow = (categoryId = '', amountCents: Cents | null = null): SplitRow =>
  ({ key: `sp-${++compteur}`, categoryId, amountCents });

/**
 * Éditeur de ventilation : répartit le montant d'une opération sur plusieurs
 * catégories. Il affiche en continu ce qu'il reste à ventiler, et propose de
 * reporter ce reste sur la dernière ligne.
 */
export function SplitEditor({ rows, onChange, categories, totalCents }: {
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  categories: Category[];
  /** Montant de l'opération, positif ; null s'il n'est pas encore saisi. */
  totalCents: Cents | null;
}) {
  const saisi = rows.reduce((s, r) => s + (r.amountCents ?? 0), 0);
  const reste = totalCents === null ? null : totalCents - saisi;

  const set = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)));

  function reporterLeReste() {
    if (reste === null || reste === 0 || rows.length === 0) return;
    const derniere = rows[rows.length - 1];
    set(derniere.key, { amountCents: Math.max(0, (derniere.amountCents ?? 0) + reste) });
  }

  return (
    <fieldset className="split-editor" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', margin: '8px 0' }}>
      <legend style={{ padding: '0 6px', fontSize: 13 }}>Ventilation par catégorie</legend>
      {rows.map((r, i) => (
        <div className="inline" key={r.key} style={{ alignItems: 'flex-end', marginBottom: 6 }}>
          <div className="field grow" style={{ minWidth: 150 }}>
            <select aria-label={`Catégorie de la ligne ${i + 1}`} value={r.categoryId}
              onChange={e => set(r.key, { categoryId: e.target.value })}>
              <option value="">—</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <MoneyInput valueCents={r.amountCents} onChange={v => set(r.key, { amountCents: v })}
              ariaLabel={`Montant de la ligne ${i + 1}`} />
          </div>
          <button type="button" className="iconbtn" aria-label={`Retirer la ligne ${i + 1}`}
            disabled={rows.length <= 2} title={rows.length <= 2 ? 'Une ventilation compte au moins deux lignes' : undefined}
            onClick={() => onChange(rows.filter(x => x.key !== r.key))}>✕</button>
        </div>
      ))}

      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn ghost" onClick={() => onChange([...rows, newSplitRow()])}>+ Ajouter une ligne</button>
        <span role="status" style={{ fontSize: 13, color: reste === 0 ? 'var(--green)' : 'var(--muted)' }}>
          {reste === null ? 'Saisissez le montant de l’opération.'
            : reste === 0 ? '✓ Ventilation complète'
            : reste > 0 ? `Reste à ventiler : ${formatEur(reste)}`
            : `Dépassement de ${formatEur(-reste)}`}
          {reste !== null && reste !== 0 && reste > 0 && (
            <button type="button" className="linklike" style={{ marginLeft: 8 }} onClick={reporterLeReste}>
              Reporter sur la dernière ligne
            </button>
          )}
        </span>
      </div>
    </fieldset>
  );
}
