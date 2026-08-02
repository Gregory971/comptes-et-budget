import { useState } from 'react';
import { useReferentials } from '../hooks/useData';
import { MoneyInput } from './MoneyInput';
import { transferService } from '../services/transferService';
import { today, type Ymd } from '../utils/date';
import type { Account, Cents } from '../types';

/**
 * Virement entre deux comptes — fonctionnalité manquante (P1).
 * Crée deux écritures liées : débit sur le compte source, crédit sur le compte
 * destinataire. Le patrimoine total reste inchangé et les bilans excluent ces
 * écritures des recettes comme des dépenses.
 */
export function TransferForm({ dbId, accounts, onDone, onCancel }: {
  dbId: string; accounts: Account[]; onDone: () => void; onCancel?: () => void;
}) {
  const ref = useReferentials(dbId);
  const [date, setDate] = useState<Ymd>(today());
  const [amountCents, setAmountCents] = useState<Cents | null>(null);
  const [fromAccountId, setFrom] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setTo] = useState(accounts[1]?.id ?? '');
  const [paymentMethodId, setPm] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Comptes chargés après le premier rendu : on adopte les deux premiers dès
  // qu'ils sont disponibles, sinon les sélecteurs restaient vides en interne.
  if (!fromAccountId && accounts.length > 0) setFrom(accounts[0].id);
  if (!toAccountId && accounts.length > 1) setTo(accounts[1].id);

  async function submit() {
    if (amountCents === null || amountCents <= 0) { setError('Indiquez un montant supérieur à zéro.'); return; }
    if (!fromAccountId || !toAccountId) { setError('Sélectionnez les deux comptes.'); return; }
    if (fromAccountId === toAccountId) { setError('Le compte source et le compte destinataire doivent être différents.'); return; }
    setError(null); setBusy(true);
    try {
      await transferService.create({
        dbId, fromAccountId, toAccountId, date, amountCents,
        label: label.trim() || undefined, paymentMethodId: paymentMethodId || undefined,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length < 2) {
    return <p className="muted">Un virement nécessite au moins deux comptes actifs.</p>;
  }

  return (
    <div>
      <div className="grid two">
        <div className="field"><label htmlFor="tr-date">Date</label>
          <input id="tr-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <MoneyInput label="Montant (€)" valueCents={amountCents} onChange={setAmountCents} required autoFocus />
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="tr-from">Du compte</label>
          <select id="tr-from" value={fromAccountId} onChange={e => setFrom(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="tr-to">Vers le compte</label>
          <select id="tr-to" value={toAccountId} onChange={e => setTo(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="tr-pm">Mode de paiement</label>
          <select id="tr-pm" value={paymentMethodId} onChange={e => setPm(e.target.value)}>
            <option value="">—</option>
            {ref.methods.filter(m => !m.archived).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div className="field"><label htmlFor="tr-label">Libellé (optionnel)</label>
          <input id="tr-label" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="Ex : Alimentation épargne" /></div>
      </div>

      {error && <p role="alert" style={{ color: 'var(--red)', margin: '4px 0 10px' }}>{error}</p>}

      <div className="row">
        {onCancel ? <button className="btn ghost" onClick={onCancel}>Annuler</button> : <span />}
        <button className="btn" onClick={submit} disabled={busy}>Enregistrer le virement</button>
      </div>
    </div>
  );
}
