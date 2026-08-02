import { useState } from 'react';
import { useReferentials, usePatrimoine } from '../hooks/useData';
import { payeeService } from '../services/referentialService';
import { MoneyInput } from './MoneyInput';
import { PayeeField } from './PayeeField';
import { today, type Ymd } from '../utils/date';
import type { Kind, Cents, Account } from '../types';
import type { OperationInput } from '../services/operationService';

export interface OpFormInitial {
  kind?: Kind; date?: Ymd; amountCents?: Cents; accountId?: string;
  payeeId?: string; categoryId?: string; paymentMethodId?: string;
  label?: string; reference?: string; note?: string;
  assetId?: string; projectId?: string;
}

/** Formulaire réutilisable : ajout, édition, duplication d'une opération. */
export function OperationForm({ dbId, accounts, initial, submitLabel, onSubmit, onCancel }: {
  dbId: string;
  accounts: Account[];
  initial?: OpFormInitial;
  submitLabel: string;
  onSubmit: (input: Omit<OperationInput, 'dbId'>) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const ref = useReferentials(dbId);
  const { assets, projects } = usePatrimoine(dbId);

  const [kind, setKind] = useState<Kind>(initial?.kind === 'recette' ? 'recette' : 'depense');
  const [date, setDate] = useState<Ymd>(initial?.date ?? today());
  const [amountCents, setAmountCents] = useState<Cents | null>(initial?.amountCents != null ? Math.abs(initial.amountCents) : null);
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  // Le tiers est saisi librement ; il n'est résolu en identifiant qu'à l'enregistrement.
  const [payeeName, setPayeeName] = useState('');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  // Un même sélecteur pour les deux rattachements possibles, préfixé a: ou p:.
  const [linkId, setLinkId] = useState(
    initial?.assetId ? `a:${initial.assetId}` : initial?.projectId ? `p:${initial.projectId}` : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  // Les comptes sont chargés de façon asynchrone : à la première image de rendu
  // la liste est vide, et l'état restait donc sur une chaîne vide alors que le
  // menu affichait un compte. « Enregistrer » répondait « Sélectionnez un
  // compte » sans que rien ne paraisse manquer. On adopte le premier compte dès
  // qu'il devient disponible (ajustement pendant le rendu, motif React).
  if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);

  // Reprise du nom du tiers lors d'une modification ou d'une duplication.
  const [payeeInit, setPayeeInit] = useState(false);
  if (!payeeInit && initial?.payeeId && ref.payees.length > 0) {
    setPayeeInit(true);
    const found = ref.payees.find(p => p.id === initial.payeeId);
    if (found) setPayeeName(found.name);
  }

  const visibleCats = ref.catsForKind(kind === 'recette' ? 'recette' : 'depense');

  async function submit() {
    // Correction P2 : les gardes se contentaient d'un « return » silencieux —
    // le bouton semblait inerte sans qu'aucune raison ne soit affichée.
    if (amountCents === null || amountCents <= 0) { setError('Indiquez un montant supérieur à zéro (exemple : 12,50).'); return; }
    if (!accountId) { setError('Sélectionnez un compte.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('La date est invalide.'); return; }
    setError(null); setBusy(true);
    try {
      const payeeId = await payeeService.resolveByName(dbId, payeeName);
      await onSubmit({
        accountId, date, amountCents, kind,
        payeeId, categoryId: categoryId || undefined,
        paymentMethodId: paymentMethodId || undefined,
        label: label.trim() || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        assetId: linkId.startsWith('a:') ? linkId.slice(2) : undefined,
        projectId: linkId.startsWith('p:') ? linkId.slice(2) : undefined,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="inline" role="group" aria-label="Type d’opération">
        <button type="button" className={'btn ' + (kind === 'depense' ? '' : 'ghost')}
          aria-pressed={kind === 'depense'}
          onClick={() => { setKind('depense'); setCategoryId(''); }}>Dépense</button>
        <button type="button" className={'btn ' + (kind === 'recette' ? '' : 'ghost')}
          aria-pressed={kind === 'recette'}
          onClick={() => { setKind('recette'); setCategoryId(''); }}>Recette</button>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="op-date">Quand — date</label>
          <input id="op-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <MoneyInput label="Combien — montant (€)" valueCents={amountCents} onChange={setAmountCents} required />
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="op-acc">Compte</label>
          <select id="op-acc" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <PayeeField payees={ref.payees} value={payeeName} onChange={setPayeeName} />
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="op-cat">Pourquoi — catégorie</label>
          <select id="op-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {visibleCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="op-pm">Comment — mode de paiement</label>
          <select id="op-pm" value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}>
            <option value="">—</option>
            {ref.methods.filter(m => !m.archived || m.id === paymentMethodId)
              .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="op-link">Projet / Bien</label>
          <select id="op-link" value={linkId} onChange={e => setLinkId(e.target.value)}>
            <option value="">—</option>
            {assets.length > 0 && (
              <optgroup label="Biens">
                {assets.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}
              </optgroup>
            )}
            {projects.length > 0 && (
              <optgroup label="Projets d’épargne">
                {projects.map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          {assets.length + projects.length === 0 && (
            <small className="muted">Créez un bien ou un projet dans « Biens / Projets ».</small>
          )}
        </div>
        <div className="field"><label htmlFor="op-ref">Référence</label>
          <input id="op-ref" maxLength={30} value={reference} onChange={e => setReference(e.target.value)}
            placeholder="N° de chèque, référence…" /></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="op-label">Libellé</label>
          <input id="op-label" maxLength={60} value={label} onChange={e => setLabel(e.target.value)}
            placeholder="Ex : Courses de la semaine" /></div>
        <div className="field"><label htmlFor="op-note">Commentaire</label>
          <input id="op-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Note libre" /></div>
      </div>

      {error && <p role="alert" style={{ color: 'var(--red)', margin: '4px 0 10px' }}>{error}</p>}

      <div className="row">
        {onCancel ? <button className="btn ghost" onClick={onCancel}>Annuler</button> : <span />}
        <button className="btn" onClick={submit} disabled={busy}>{submitLabel}</button>
      </div>
    </div>
  );
}
