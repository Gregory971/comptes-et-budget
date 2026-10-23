import { useState } from 'react';
import { Modal } from './Modal';
import { MoneyInput } from './MoneyInput';
import { useAccounts, useReferentials } from '../hooks/useData';
import { securityService, type BankLink } from '../services/securityService';
import { fmtQty, grossCents } from '../utils/portfolio';
import { today, type Ymd } from '../utils/date';
import { formatEur, type Cents } from '../utils/money';
import type { Security, SecurityTxType } from '../types';

/** Décimal saisi à la française (« 12,5 », « 0.25 ») ; NaN si illisible. Pas un montant : aucune conversion en centimes. */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t)) return NaN;
  return Number(t);
}

/** Création ou renommage d'un titre. */
export function SecurityModal({ dbId, security, onClose }: { dbId: string; security?: Security; onClose: () => void }) {
  const [name, setName] = useState(security?.name ?? '');
  const [symbol, setSymbol] = useState(security?.symbol ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (security) await securityService.update(security.id, { name, symbol });
      else await securityService.create({ dbId, name, symbol });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={security ? 'Modifier le titre' : 'Nouveau titre'} onClose={onClose} width={480}>
      <div className="field"><label htmlFor="sec-name">Désignation</label>
        <input id="sec-name" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Ex : Action Air Liquide, ETF World" /></div>
      <div className="field"><label htmlFor="sec-sym">ISIN / code / symbole (facultatif)</label>
        <input id="sec-sym" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Ex : FR0000120073" /></div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}

const TITLE: Record<SecurityTxType, string> = {
  achat: 'Acheter', vente: 'Vendre', dividende: 'Enregistrer un dividende', ajustement: 'Ajuster le nombre de parts',
};

/** Saisie d'un mouvement : achat, vente, dividende ou ajustement de parts. */
export function SecurityTxModal({ dbId, security, type, held, lastPrice, onClose }: {
  dbId: string;
  security: Security;
  type: SecurityTxType;
  /** Parts actuellement détenues (borne d'une vente). */
  held: number;
  /** Dernier cours connu, proposé par défaut. */
  lastPrice?: number;
  onClose: () => void;
}) {
  const accounts = useAccounts(dbId).filter(a => a.type !== 'pret' && !a.currency);
  const ref = useReferentials(dbId);
  const [date, setDate] = useState<Ymd>(today());
  const [quantity, setQuantity] = useState(type === 'vente' ? String(held).replace('.', ',') : '');
  const [price, setPrice] = useState(lastPrice !== undefined && type !== 'dividende' && type !== 'ajustement' ? String(lastPrice).replace('.', ',') : '');
  const [fees, setFees] = useState<Cents | null>(0);
  const [amount, setAmount] = useState<Cents | null>(null);
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [feesCategoryId, setFeesCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trade = type === 'achat' || type === 'vente';
  const q = parseDecimal(quantity);
  const p = parseDecimal(price);
  const gross = trade && q > 0 && p >= 0 ? grossCents(q, p) : null;
  const totalLabel = type === 'achat' ? 'Total débité' : 'Produit net';
  const total = gross === null ? null : type === 'achat' ? gross + (fees ?? 0) : gross - (fees ?? 0);
  // Catégories proposées : dépense pour un achat, recette pour une vente ou un dividende.
  const cats = ref.catsForKind(type === 'achat' ? 'depense' : 'recette');
  const feeCats = ref.catsForKind('depense');

  async function save() {
    setError(null);
    if (fees === null) { setError('Les frais sont invalides (exemple : 1,50).'); return; }
    if (trade && !(q > 0)) { setError('Indiquez une quantité supérieure à zéro.'); return; }
    if (trade && !(p >= 0)) { setError('Indiquez le cours unitaire (exemple : 52,30).'); return; }
    if (type === 'dividende' && (amount === null || amount <= 0)) { setError('Indiquez le montant du dividende.'); return; }
    if (type === 'ajustement' && !(Math.abs(q) > 0)) { setError('Indiquez la variation du nombre de parts (négative pour un regroupement).'); return; }
    const bank: BankLink | undefined = accountId && type !== 'ajustement'
      ? { accountId, categoryId: categoryId || undefined, feesCategoryId: feesCategoryId || undefined } : undefined;
    setBusy(true);
    try {
      await securityService.addTx({
        dbId, securityId: security.id, date, type,
        quantity: trade || type === 'ajustement' ? q : 0,
        unitPrice: trade ? p : 0,
        feesCents: trade ? fees : 0,
        amountCents: type === 'dividende' ? amount ?? 0 : undefined,
        note, bank,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${TITLE[type]} — ${security.name}`} onClose={onClose} width={560}>
      <div className="grid two">
        <div className="field"><label htmlFor="stx-date">Date</label>
          <input id="stx-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        {type === 'dividende'
          ? <MoneyInput label="Montant perçu (€)" valueCents={amount} onChange={setAmount} required />
          : (
            <div className="field"><label htmlFor="stx-qty">
              {type === 'ajustement' ? 'Variation du nombre de parts (+ / −)' : 'Quantité (parts)'}</label>
              <input id="stx-qty" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus />
              {type !== 'achat' && <small className="muted">Détenues : {fmtQty(held)}</small>}
            </div>
          )}
      </div>

      {trade && (
        <div className="grid two">
          <div className="field"><label htmlFor="stx-price">Cours unitaire (€)</label>
            <input id="stx-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <MoneyInput label="Frais (€)" valueCents={fees} onChange={setFees} />
        </div>
      )}

      {type === 'ajustement' && (
        <p className="muted" style={{ fontSize: 12 }}>
          Division du titre, attribution gratuite, regroupement : la quantité change, le coût de revient total reste le même.
        </p>
      )}

      {total !== null && (
        <div className="card" role="status" style={{ margin: '8px 0' }}>
          Montant brut : <strong>{formatEur(gross ?? 0)}</strong> · {totalLabel} : <strong>{formatEur(total)}</strong>
        </div>
      )}

      {type !== 'ajustement' && (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', margin: '8px 0' }}>
          <legend style={{ padding: '0 6px', fontSize: 13 }}>Enregistrer aussi dans un compte (facultatif)</legend>
          <div className="field"><label htmlFor="stx-acc">Compte</label>
            <select id="stx-acc" value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">Ne pas enregistrer dans les comptes</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          {accountId && (
            <div className="grid two">
              <div className="field"><label htmlFor="stx-cat">Catégorie de l’opération</label>
                <select id="stx-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                  <option value="">—</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select></div>
              {type === 'achat' && (fees ?? 0) > 0 && (
                <div className="field"><label htmlFor="stx-fcat">Catégorie des frais</label>
                  <select id="stx-fcat" value={feesCategoryId} onChange={e => setFeesCategoryId(e.target.value)}>
                    <option value="">— (avec le reste)</option>
                    {feeCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </select></div>
              )}
            </div>
          )}
        </fieldset>
      )}

      <div className="field"><label htmlFor="stx-note">Commentaire</label>
        <input id="stx-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)} /></div>

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save} disabled={busy}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/** Actualisation du cours d'un titre. */
export function SecurityPriceModal({ dbId, security, lastPrice, onClose }: {
  dbId: string; security: Security; lastPrice?: number; onClose: () => void;
}) {
  const [date, setDate] = useState<Ymd>(today());
  const [price, setPrice] = useState(lastPrice !== undefined ? String(lastPrice).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const p = parseDecimal(price);
    if (!(p >= 0)) { setError('Indiquez un cours valide (exemple : 52,30).'); return; }
    try {
      await securityService.setPrice({ dbId, securityId: security.id, date, price: p });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={`Actualiser le cours — ${security.name}`} onClose={onClose} width={440}>
      <div className="grid two">
        <div className="field"><label htmlFor="spr-date">Date</label>
          <input id="spr-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="spr-price">Cours (€)</label>
          <input id="spr-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} autoFocus /></div>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
