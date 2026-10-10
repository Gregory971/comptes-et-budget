import { useId, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from './Modal';
import { useReferentials } from '../hooks/useData';
import { parseStatement, type StatementParse } from '../utils/statement';
import {
  prepareImport, commitImport, type ImportCandidate,
} from '../services/importService';
import { ruleService } from '../services/categorizationService';
import { isApplied, normalizeText, type Proposal } from '../utils/categorize';
import { formatEur } from '../utils/money';
import { formatFr } from '../utils/date';
import type { Account, Payee } from '../types';

const SOURCE_LABEL: Record<Proposal['source'], string> = {
  regle: 'Règle apprise', tiers: 'Tiers reconnu', historique: 'Historique',
};
const CONFIDENCE_LABEL: Record<Proposal['confidence'], string> = {
  haute: 'sûr', moyenne: 'probable — à vérifier', faible: 'incertain',
};

/** Le tiers ou la catégorie diffère-t-il de ce que le moteur avait posé d'office ? */
const isEdited = (r: ImportCandidate) =>
  (r.categoryId ?? '') !== (r.autoCategoryId ?? '')
  || (r.payeeId ?? '') !== (r.autoPayeeId ?? '')
  || (!r.payeeId && !!r.payeeName?.trim());

/**
 * Import d'un relevé bancaire (CSV ou OFX).
 *
 * Trois refus délibérés :
 *  · rien n'est écrit avant confirmation — la fenêtre montre chaque ligne,
 *    son classement proposé et les doublons détectés ;
 *  · les doublons sont décochés, non supprimés : la banque a parfois raison
 *    contre la détection, et l'utilisateur peut les recocher ;
 *  · les lignes illisibles sont listées telles quelles, jamais devinées ;
 *  · le classement proposé affiche son origine (règle apprise, tiers reconnu,
 *    historique) et sa confiance. Une proposition incertaine n'est pas posée,
 *    seulement suggérée ; chaque choix de l'utilisateur est mémorisé en règle.
 */
export function StatementImport({ dbId, accounts }: { dbId: string; accounts: Account[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const referentials = useReferentials(dbId);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [parse, setParse] = useState<StatementParse | null>(null);
  const [rows, setRows] = useState<ImportCandidate[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const payeeListId = useId();

  const totals = useMemo(() => {
    const retenues = rows.filter(r => r.selected);
    return {
      selected: retenues.length,
      duplicates: rows.filter(r => r.duplicateOfId).length,
      classees: rows.filter(r => isApplied(r.proposal) && !isEdited(r)).length,
      suggerees: rows.filter(r => r.proposal && !isApplied(r.proposal) && !isEdited(r)).length,
      soldeCents: retenues.reduce((s, r) => s + r.amountCents, 0),
    };
  }, [rows]);

  /**
   * Lecture du fichier. Les exports bancaires français sont encore souvent en
   * Windows-1252 : décodé en UTF-8, « VIREMENT SÉCURISÉ » devient illisible.
   * Le caractère de remplacement sert de test, et le décodage est refait.
   */
  async function readFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('�')) return utf8;
    try {
      return new TextDecoder('windows-1252').decode(buffer);
    } catch {
      return utf8;
    }
  }

  async function onFile(file: File) {
    setError(null); setDone(null);
    const compte = accountId || accounts[0]?.id;
    if (!compte) { setError('Créez d’abord un compte.'); return; }
    try {
      const result = parseStatement(await readFile(file));
      setFileName(file.name);
      setParse(result);
      setRows(result.entries.length ? await prepareImport(dbId, compte, result.entries) : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggle = (key: string) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, selected: !r.selected } : r)));

  const setCategory = (key: string, categoryId: string) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, categoryId: categoryId || undefined } : r)));

  const setPayee = (key: string, name: string) =>
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r;
      const connu = referentials.payees.find(
        p => !p.archived && normalizeText(p.name) === normalizeText(name) && name.trim() !== '');
      return { ...r, payeeName: name, payeeId: connu?.id };
    }));

  /** Applique la suggestion d'une proposition incertaine : c'est un choix de l'utilisateur. */
  const applySuggestion = (key: string) =>
    setRows(rs => rs.map(r => {
      if (r.key !== key || !r.proposal) return r;
      const payee = r.proposal.payeeId ? referentials.payees.find(p => p.id === r.proposal!.payeeId) : undefined;
      return {
        ...r,
        categoryId: r.proposal.categoryId ?? r.categoryId,
        payeeId: payee?.id ?? r.payeeId,
        payeeName: payee?.name ?? r.payeeName,
      };
    }));

  async function confirm() {
    setBusy(true);
    try {
      const res = await commitImport(dbId, accountId || accounts[0].id, rows);
      setDone(`${res.imported} opération(s) importée(s), ${res.skipped} écartée(s).`
        + (res.rulesLearned ? ` ${res.rulesLearned} règle(s) de classement mémorisée(s) ou mise(s) à jour.` : ''));
      setParse(null); setRows([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn ghost" onClick={() => ref.current?.click()}>
        <span aria-hidden="true">📄</span> Importer un relevé (CSV / OFX)
      </button>
      <input ref={ref} type="file" accept=".csv,.txt,.ofx,.qfx" style={{ display: 'none' }}
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await onFile(f);
        }} />

      {error && (
        <Modal title="Import impossible" onClose={() => setError(null)} width={460}>
          <p role="alert">{error}</p>
          <div className="row"><span />
            <button className="btn" onClick={() => setError(null)}>Fermer</button></div>
        </Modal>
      )}

      {done && (
        <Modal title="Relevé importé" onClose={() => setDone(null)} width={420}>
          <p role="status">{done}</p>
          <div className="row"><span />
            <button className="btn" onClick={() => setDone(null)}>Fermer</button></div>
        </Modal>
      )}

      {parse && (
        <Modal title={`Relevé « ${fileName} »`} onClose={() => { setParse(null); setRows([]); }} width={920}>
          <div className="inline">
            <div className="field" style={{ minWidth: 220 }}>
              <label htmlFor="imp-acc">Compte destinataire</label>
              <select id="imp-acc" value={accountId}
                onChange={async e => {
                  setAccountId(e.target.value);
                  if (parse.entries.length) {
                    setRows(await prepareImport(dbId, e.target.value, parse.entries));
                  }
                }}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Format {parse.format.toUpperCase()}
              {parse.mapping && ` · date : ${parse.mapping.date} · libellé : ${parse.mapping.label} · montant : ${parse.mapping.amount}`}
            </p>
          </div>

          {rows.length === 0 ? (
            <p role="alert">Aucune opération exploitable dans ce fichier.</p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                {rows.length} ligne(s) lue(s), dont <strong>{totals.duplicates}</strong> déjà
                présente(s) dans la base — décochée(s) d’office. Recochez-les si la banque
                a raison contre la détection.
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                <strong>{totals.classees}</strong> ligne(s) classée(s) d’office — l’origine et la
                confiance sont indiquées sous chaque catégorie, à vérifier avant de confirmer.
                {totals.suggerees > 0 && (
                  <> <strong>{totals.suggerees}</strong> suggestion(s) incertaine(s) <strong>non
                  appliquée(s)</strong> : à valider ligne par ligne.</>
                )}{' '}
                Vos corrections sont mémorisées (après confirmation) pour les prochains relevés.
              </p>
              <datalist id={payeeListId}>
                {referentials.payees.filter(p => !p.archived).map(p => <option key={p.id} value={p.name} />)}
              </datalist>
              <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
                <table className="simple">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}><span className="sr-only">Retenir</span></th>
                      <th>Date</th><th>Libellé</th><th>Tiers</th><th>Catégorie</th>
                      <th style={{ textAlign: 'right' }}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key} style={r.duplicateOfId ? { opacity: 0.62 } : undefined}>
                        <td>
                          <input type="checkbox" checked={r.selected} onChange={() => toggle(r.key)}
                            aria-label={`Importer la ligne du ${formatFr(r.date)}`} />
                        </td>
                        <td>{formatFr(r.date)}</td>
                        <td>
                          {r.label || <span className="muted">sans libellé</span>}
                          {r.duplicateOfId && (
                            <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                              ⚠️ déjà saisie le {r.duplicateDate && formatFr(r.duplicateDate)}
                            </span>
                          )}
                        </td>
                        <td>
                          <input list={payeeListId} value={r.payeeName ?? ''} maxLength={60}
                            autoComplete="off" placeholder="—" style={{ minWidth: 120, width: '100%' }}
                            aria-label={`Tiers de la ligne du ${formatFr(r.date)}`}
                            onChange={e => setPayee(r.key, e.target.value)} />
                          {r.payeeName?.trim() && !r.payeeId && (
                            <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                              sera ajouté à vos tiers
                            </span>
                          )}
                        </td>
                        <td>
                          <select value={r.categoryId ?? ''} style={{ minWidth: 150 }}
                            aria-label={`Catégorie de la ligne du ${formatFr(r.date)}`}
                            onChange={e => setCategory(r.key, e.target.value)}>
                            <option value="">— sans catégorie —</option>
                            {referentials.catsForKind(r.amountCents < 0 ? 'depense' : 'recette')
                              .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <ProposalNote row={r} catName={referentials.catName}
                            payees={referentials.payees} onApply={() => applySuggestion(r.key)} />
                        </td>
                        <td className="num" style={{ textAlign: 'right' }}>{formatEur(r.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <RulesPanel dbId={dbId} catName={referentials.catName} payeeName={referentials.payeeName} />

          {parse.warnings.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                {parse.warnings.length} ligne(s) non lue(s)
              </summary>
              <ul className="muted" style={{ fontSize: 12 }}>
                {parse.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted">
              {totals.selected} à importer · solde du lot {formatEur(totals.soldeCents)}
            </span>
            <span>
              <button className="btn ghost" style={{ marginRight: 8 }}
                onClick={() => { setParse(null); setRows([]); }}>Annuler</button>
              <button className="btn" onClick={confirm} disabled={busy || totals.selected === 0}>
                {busy ? 'Import en cours…' : `Importer ${totals.selected} opération(s)`}
              </button>
            </span>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Origine et confiance du classement d'une ligne, avec de quoi agir. */
function ProposalNote({ row, catName, payees, onApply }: {
  row: ImportCandidate;
  catName: (id?: string) => string;
  payees: Payee[];
  onApply: () => void;
}) {
  const p = row.proposal;
  const note: React.CSSProperties = { display: 'block', fontSize: 11, marginTop: 2 };

  if (isEdited(row)) {
    return (
      <span className="muted" style={note}>
        Votre choix{p ? ' (modifie la proposition)' : ''} — sera mémorisé à la confirmation
      </span>
    );
  }
  if (!p) return null;

  if (isApplied(p)) {
    return (
      <span style={{ ...note, color: p.confidence === 'haute' ? 'var(--green)' : 'var(--orange)' }}
        title={p.basis}>
        {SOURCE_LABEL[p.source]} · {CONFIDENCE_LABEL[p.confidence]}
        <span className="sr-only"> : {p.basis}</span>
      </span>
    );
  }

  if (p.ambiguous) {
    const detail = p.alternatives.slice(0, 3).map(a => `${catName(a.categoryId)} ×${a.count}`).join(', ');
    return (
      <span className="muted" style={note} title={p.basis}>
        Libellé ambigu ({detail}) — non classé, à choisir
      </span>
    );
  }

  const payee = p.payeeId ? payees.find(x => x.id === p.payeeId) : undefined;
  const cible = [p.categoryId ? catName(p.categoryId) : null, payee ? `tiers ${payee.name}` : null]
    .filter(Boolean).join(' / ');
  return (
    <span className="muted" style={note} title={p.basis}>
      Incertain, non appliqué : {SOURCE_LABEL[p.source].toLowerCase()} → {cible || '—'}{' '}
      <button type="button" className="btn ghost" style={{ padding: '0 8px', fontSize: 11, minHeight: 0 }}
        onClick={onApply}>Appliquer</button>
    </span>
  );
}

/** Règles apprises : consultables, et oubliables en un clic. */
function RulesPanel({ dbId, catName, payeeName }: {
  dbId: string;
  catName: (id?: string) => string;
  payeeName: (id?: string) => string;
}) {
  const rules = useLiveQuery(() => ruleService.list(dbId), [dbId], []) ?? [];
  if (rules.length === 0) return null;
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13 }}>
        {rules.length} règle(s) de classement apprise(s)
      </summary>
      <ul className="muted" style={{ fontSize: 12, listStyle: 'none', paddingLeft: 0 }}>
        {rules.map(r => (
          <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
            <span style={{ flex: 1 }}>
              « {r.pattern} » ({r.kind === 'depense' ? 'dépense' : 'recette'}) →{' '}
              {[r.categoryId ? catName(r.categoryId) : null, r.payeeId ? `tiers ${payeeName(r.payeeId)}` : null]
                .filter(Boolean).join(' / ')} · {r.hits} confirmation(s)
            </span>
            <button type="button" className="btn ghost" style={{ padding: '0 8px', fontSize: 11, minHeight: 0 }}
              onClick={() => ruleService.disable(r.id)}>Oublier</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
