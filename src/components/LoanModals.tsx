import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { MoneyInput } from './MoneyInput';
import { useReferentials } from '../hooks/useData';
import { loanService } from '../services/loanService';
import { amortization, monthlyPayment, summarize, validateLoan } from '../utils/loan';
import { addMonths, formatFr, today, type Ymd } from '../utils/date';
import { formatEur, type Cents } from '../utils/money';
import type { Account } from '../types';

/** Taux saisi en pourcentage (« 3,5 », « 3.50 ») → centièmes de pour cent ; NaN si illisible. */
export function parseRate(text: string): number {
  const t = text.trim().replace(',', '.').replace('%', '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/** Assistant de création d'un prêt. */
export function LoanModal({ dbId, fundingChoices, onClose }: {
  dbId: string;
  /** Comptes pouvant porter les mensualités (comptes de trésorerie actifs). */
  fundingChoices: Account[];
  onClose: () => void;
}) {
  const ref = useReferentials(dbId);
  const [name, setName] = useState('Prêt immobilier');
  const [logo, setLogo] = useState('🏠');
  const [group, setGroup] = useState('');
  const [loanDate, setLoanDate] = useState<Ymd>(today());
  const [principal, setPrincipal] = useState<Cents | null>(null);
  const [rate, setRate] = useState('3,50');
  const [months, setMonths] = useState('240');
  const [first, setFirst] = useState<Ymd>(addMonths(today(), 1));
  const [insurance, setInsurance] = useState<Cents | null>(0);
  const [funding, setFunding] = useState(fundingChoices[0]?.id ?? '');
  const [category, setCategory] = useState('');
  const [autoPost, setAutoPost] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rateBp = parseRate(rate);
  const nMonths = Number(months);
  const paid = Number(alreadyPaid);

  // Aperçu en direct : seulement quand les conditions sont valides.
  const preview = useMemo(() => {
    if (principal === null || insurance === null) return null;
    const terms = {
      principalCents: principal, rateBp, months: nMonths,
      firstPaymentDate: first, insuranceMonthlyCents: insurance,
    };
    if (validateLoan(terms)) return null;
    return { payment: monthlyPayment(principal, rateBp, nMonths), summary: summarize(terms, 0, today()) };
  }, [principal, insurance, rateBp, nMonths, first]);

  async function save() {
    if (!name.trim()) { setError('Le nom du prêt est obligatoire.'); return; }
    if (principal === null || insurance === null) { setError('Un montant est invalide (exemple : 150000,00).'); return; }
    if (Number.isNaN(rateBp)) { setError('Le taux est invalide (exemple : 3,50).'); return; }
    if (!Number.isInteger(paid) || paid < 0) { setError('Le nombre de mensualités déjà remboursées est invalide.'); return; }
    if (!funding) { setError('Choisissez le compte qui paie les mensualités.'); return; }
    setError(null); setBusy(true);
    try {
      await loanService.create({
        dbId, name, logo, group: group.trim() || undefined, loanDate,
        principalCents: principal, rateBp, months: nMonths, firstPaymentDate: first,
        insuranceMonthlyCents: insurance, fundingAccountId: funding,
        interestCategoryId: category || undefined, autoPost, alreadyPaid: paid,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouveau prêt" onClose={onClose} width={620}>
      <div className="inline">
        <div className="field" style={{ width: 80 }}><label htmlFor="ln-logo">Logo</label>
          <input id="ln-logo" value={logo} onChange={e => setLogo(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="ln-name">Nom</label>
          <input id="ln-name" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      </div>

      <div className="grid two">
        <MoneyInput label="Montant emprunté (€)" valueCents={principal} onChange={setPrincipal} required />
        <div className="field"><label htmlFor="ln-rate">Taux annuel (%)</label>
          <input id="ln-rate" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ln-months">Durée (mensualités)</label>
          <input id="ln-months" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)} /></div>
        <MoneyInput label="Assurance par mois (€)" valueCents={insurance} onChange={setInsurance} />
        <div className="field"><label htmlFor="ln-date">Date du prêt</label>
          <input id="ln-date" type="date" value={loanDate} onChange={e => setLoanDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ln-first">Première mensualité</label>
          <input id="ln-first" type="date" value={first} onChange={e => setFirst(e.target.value)} /></div>
      </div>

      <div className="grid two">
        <div className="field"><label htmlFor="ln-fund">Compte qui paie les mensualités</label>
          <select id="ln-fund" value={funding} onChange={e => setFunding(e.target.value)}>
            {fundingChoices.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ln-cat">Catégorie des intérêts et de l’assurance</label>
          <select id="ln-cat" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— Aucune —</option>
            {ref.catsForKind('depense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ln-paid">Mensualités déjà remboursées</label>
          <input id="ln-paid" inputMode="numeric" value={alreadyPaid} onChange={e => setAlreadyPaid(e.target.value)} /></div>
        <div className="field"><label htmlFor="ln-group">Groupe de comptes (facultatif)</label>
          <input id="ln-group" value={group} onChange={e => setGroup(e.target.value)} /></div>
      </div>

      <label className="inline-check">
        <input type="checkbox" checked={autoPost} onChange={e => setAutoPost(e.target.checked)} />
        Comptabiliser automatiquement les mensualités échues au lancement
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Chaque mensualité écrit un virement pour le capital et une dépense pour les intérêts et l’assurance.
        Le versement initial des fonds sur votre compte n’est pas enregistré : saisissez-le si besoin.
        Si le prêt a démarré avant votre suivi, indiquez les mensualités déjà payées : elles ne génèrent aucune
        écriture et la dette de départ en tient compte.
      </p>

      {preview && (
        <div className="card" role="status" style={{ margin: '8px 0' }}>
          <div>Mensualité : <strong>{formatEur(preview.payment)}</strong>
            {insurance ? <> + assurance {formatEur(insurance)} = <strong>{formatEur(preview.payment + insurance)}</strong></> : null}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Coût total du crédit : {formatEur(preview.summary.totalCostCents)}
            {' '}(intérêts {formatEur(preview.summary.totalInterestCents)}
            {insurance ? <>, assurance {formatEur(preview.summary.totalInsuranceCents)}</> : null})
          </div>
        </div>
      )}

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save} disabled={busy}>Créer le prêt</button>
      </div>
    </Modal>
  );
}

/** Situation du prêt et tableau d'amortissement. */
export function LoanDetailModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const loan = account.loan;
  const rows = useMemo(() => (loan ? amortization(loan) : []), [loan]);
  if (!loan) return null;
  const now = today();
  const s = summarize(loan, loan.postedCount, now);

  return (
    <Modal title={`Prêt « ${account.name} »`} onClose={onClose} width={760}>
      <div className="grid two" style={{ marginBottom: 10 }}>
        <div>Capital emprunté : <strong>{formatEur(loan.principalCents)}</strong></div>
        <div>Taux : <strong>{(loan.rateBp / 100).toFixed(2).replace('.', ',')} %</strong> sur {loan.months} mois</div>
        <div>Reste dû : <strong>{formatEur(s.remainingCents)}</strong></div>
        <div>Coût total du crédit : <strong>{formatEur(s.totalCostCents)}</strong></div>
      </div>

      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="simple">
          <thead><tr>
            <th scope="col">N°</th><th scope="col">Date</th>
            <th scope="col" style={{ textAlign: 'right' }}>Capital</th>
            <th scope="col" style={{ textAlign: 'right' }}>Intérêts</th>
            <th scope="col" style={{ textAlign: 'right' }}>Assurance</th>
            <th scope="col" style={{ textAlign: 'right' }}>Total</th>
            <th scope="col" style={{ textAlign: 'right' }}>Reste dû</th>
            <th scope="col">État</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const etat = r.index <= loan.postedCount ? 'Comptabilisée' : r.date <= now ? 'À comptabiliser' : '';
              return (
                <tr key={r.index}>
                  <td>{r.index}</td><td>{formatFr(r.date)}</td>
                  <td style={{ textAlign: 'right' }}>{formatEur(r.principalCents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatEur(r.interestCents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatEur(r.insuranceCents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatEur(r.totalCents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatEur(r.remainingCents)}</td>
                  <td>{etat && <span className={'chip' + (etat === 'Comptabilisée' ? ' rec' : ' dep')}>{etat}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row"><button className="btn" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}
