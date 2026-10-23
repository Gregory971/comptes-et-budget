import { useState } from 'react';
import { useAccounts, useBalances, useCurrencies, useRates } from '../hooks/useData';
import { Modal, ConfirmDialog } from '../components/Modal';
import { ReconcileModal } from '../components/ReconcileModal';
import { LoanDetailModal, LoanModal } from '../components/LoanModals';
import { MoneyInput } from '../components/MoneyInput';
import { ACCOUNT_TYPE_LABEL as TYPE_LABEL, accountService, isCash } from '../services/accountService';
import { loanService } from '../services/loanService';
import { formatEur, formatMoney, type Cents } from '../utils/money';
import { convert } from '../services/currencyService';
import { formatFr, today, type Ymd } from '../utils/date';
import type { Account, AccountType, Database } from '../types';

export function ComptesScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const accounts = useAccounts(dbId, true);
  const balances = useBalances(dbId);
  const rates = useRates(dbId);
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [detail, setDetail] = useState<Account | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Account | null>(null);
  const [reconciling, setReconciling] = useState<Account | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const actifs = accounts.filter(a => !a.archived);
  const tresorerie = actifs.filter(isCash);
  const prets = actifs.filter(a => a.type === 'pret');
  const archives = accounts.filter(a => a.archived);
  const visibles = tresorerie.filter(a => !a.hidden);

  async function comptabiliser(a: Account) {
    try {
      const n = await loanService.postDue(a.id);
      setNotice(n > 0 ? `${n} mensualité(s) comptabilisée(s) pour « ${a.name} ».` : `Aucune mensualité à comptabiliser pour « ${a.name} ».`);
    } catch (e) {
      setNotice(`Comptabilisation impossible : ${(e as Error).message}`);
    }
  }

  return (
    <>
      <h1 className="page-title">Comptes</h1>
      <p className="page-sub">Gérez les propriétés de vos comptes.</p>

      {notice && (
        <div className="toast" role="status">
          {notice}
          <button className="linklike" style={{ marginLeft: 10 }} onClick={() => setNotice(null)}>Fermer</button>
        </div>
      )}

      {/* Vue d'ensemble en cartes, reprise de la maquette. Le tableau qui suit
          reste nécessaire : lui seul porte la modification et l'archivage. */}
      {visibles.length > 0 && (
        <div className="acc-grid" style={{ marginTop: 0, marginBottom: 24 }}>
          {visibles.map(a => {
            const solde = balances[a.id] ?? a.initialBalanceCents;
            return (
              <div className="acc" key={a.id}>
                <div className="acc-type">{TYPE_LABEL[a.type]}{a.group && a.group !== TYPE_LABEL[a.type] ? ` · ${a.group}` : ''}</div>
                <div className="acc-name">
                  <span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}
                  {a.favorite && <span title="Favori" aria-label="Favori"> ⭐</span>}
                </div>
                <div className={'acc-val ' + (solde < 0 ? 'neg' : '')}>{formatMoney(solde, a.currency)}</div>
                {a.currency && <div className="muted" style={{ fontSize: 12 }}>≈ {formatEur(convert(solde, rates[a.id] ?? 1))}</div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong className="panel-t">Comptes actifs</strong>
          <button className="btn" onClick={() => setCreating(true)}>+ Nouveau compte</button>
        </div>
        <table className="simple">
          <thead><tr>
            <th scope="col">Compte</th><th scope="col">Groupe</th><th scope="col">Type</th>
            <th scope="col" style={{ textAlign: 'right' }}>Solde</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {tresorerie.map(a => (
              <tr key={a.id}>
                <td>
                  <span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}
                  {a.favorite && <span title="Favori" aria-label="Favori"> ⭐</span>}
                  {a.hidden && <span className="chip" style={{ marginLeft: 8 }}>Masqué</span>}
                </td>
                <td>{a.group ?? ''}</td>
                <td><span className="chip">{TYPE_LABEL[a.type]}</span></td>
                <td style={{ textAlign: 'right' }}>{formatMoney(balances[a.id] ?? a.initialBalanceCents, a.currency)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" onClick={() => setReconciling(a)}
                    title="Comparer le solde du relevé au total des opérations pointées"
                    style={{ marginRight: 6 }}>Rapprocher</button>
                  <button className="btn ghost" onClick={() => setEditing(a)}>Modifier</button>
                  <button className="btn ghost" style={{ marginLeft: 6 }}
                    disabled={tresorerie.length <= 1}
                    title={tresorerie.length <= 1 ? 'Au moins un compte actif est nécessaire' : 'Archiver ce compte'}
                    onClick={() => setConfirmArchive(a)}>Archiver</button>
                </td>
              </tr>
            ))}
            {accounts.length > 0 && tresorerie.length === 0 && <tr><td colSpan={5} className="muted">Aucun compte actif.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong className="panel-t">Prêts</strong>
          <button className="btn" onClick={() => setCreatingLoan(true)} disabled={tresorerie.length === 0}>+ Nouveau prêt</button>
        </div>
        {accounts.length > 0 && prets.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Aucun prêt. Un prêt suit la dette restante, comptabilise chaque mensualité (capital en virement,
            intérêts et assurance en dépense) et reste hors du solde total.
          </p>
        )}
        {prets.map(a => {
          const s = loanService.summary(a);
          if (!s || !a.loan) return null;
          return (
            <div key={a.id} style={{ borderTop: '1px solid var(--line)', padding: '14px 0' }}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <strong><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</strong>
                <span className="acc-val neg" style={{ fontSize: 18 }}>{formatEur(s.remainingCents)}</span>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(s.percent)} aria-valuemin={0}
                aria-valuemax={100} aria-label={`Capital remboursé du prêt ${a.name}`}
                aria-valuetext={`${Math.round(s.percent)} % du capital remboursé`}
                style={{ background: 'var(--track)', borderRadius: 999 }}>
                <div style={{ width: s.percent + '%', height: '100%', borderRadius: 999, background: 'var(--teal, #00a8a9)' }} />
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
                {Math.round(s.percent)} % remboursé sur {formatEur(a.loan.principalCents)}
                {s.next
                  ? <> · prochaine mensualité le {formatFr(s.next.date)} : {formatEur(s.next.totalCents)}</>
                  : <> · prêt soldé</>}
                {s.overdue.length > 0 && <> · <strong>{s.overdue.length} à comptabiliser</strong></>}
                {a.loan.autoPost && <> · comptabilisation automatique</>}
              </p>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {s.overdue.length > 0 && (
                  <button className="btn" style={{ marginRight: 6 }} onClick={() => comptabiliser(a)}>
                    Comptabiliser ({s.overdue.length})
                  </button>
                )}
                <button className="btn ghost" onClick={() => setDetail(a)}>Tableau d’amortissement</button>
                <button className="btn ghost" style={{ marginLeft: 6 }} onClick={() => setEditing(a)}>Modifier</button>
                <button className="btn ghost" style={{ marginLeft: 6 }} onClick={() => setConfirmArchive(a)}>Archiver</button>
              </div>
            </div>
          );
        })}
      </div>

      {archives.length > 0 && (
        <div className="card">
          <strong>Comptes archivés</strong>
          <p className="muted" style={{ fontSize: 12 }}>
            Leurs opérations restent dans l’historique mais ne sont plus comptées dans le solde total.
          </p>
          <table className="simple">
            <tbody>
              {archives.map(a => (
                <tr key={a.id}>
                  <td><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</td>
                  <td><span className="chip">{TYPE_LABEL[a.type]}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost" onClick={() => accountService.unarchive(a.id)}>Réactiver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <AccountModal dbId={dbId} account={editing ?? undefined}
          onClose={() => { setEditing(null); setCreating(false); }} />
      )}

      {creatingLoan && (
        <LoanModal dbId={dbId} fundingChoices={tresorerie} onClose={() => setCreatingLoan(false)} />
      )}

      {detail && <LoanDetailModal account={detail} onClose={() => setDetail(null)} />}

      {reconciling && (
        <ReconcileModal dbId={dbId} account={reconciling} onClose={() => setReconciling(null)} />
      )}

      {confirmArchive && (
        <ConfirmDialog title="Archiver le compte" confirmLabel="Archiver"
          message={`Archiver « ${confirmArchive.name} » ? Ses opérations sont conservées et le compte pourra être réactivé à tout moment.`}
          onConfirm={() => accountService.archive(confirmArchive.id)}
          onClose={() => setConfirmArchive(null)} />
      )}
    </>
  );
}

function AccountModal({ dbId, account, onClose }: { dbId: string; account?: Account; onClose: () => void }) {
  const isLoan = account?.type === 'pret';
  const devises = useCurrencies(dbId);
  const [currency, setCurrency] = useState(account?.currency ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'courant');
  const [logo, setLogo] = useState(account?.logo ?? '🏦');
  const [group, setGroup] = useState(account?.group ?? '');
  const [number, setNumber] = useState(account?.number ?? '');
  const [favorite, setFavorite] = useState(account?.favorite ?? false);
  const [hidden, setHidden] = useState(account?.hidden ?? false);
  const [initial, setInitial] = useState<Cents | null>(account?.initialBalanceCents ?? 0);
  const [startDate, setStartDate] = useState<Ymd>(account?.startDate ?? today());
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('Le nom du compte est obligatoire.'); return; }
    if (initial === null) { setError('Le solde initial est invalide (exemple : 1250,00).'); return; }
    setError(null);
    const common = {
      name: name.trim(), logo, startDate,
      group: group.trim() || undefined, number: number.trim() || undefined,
      favorite, hidden,
    };
    if (account) {
      // Le solde initial d'un prêt découle de ses conditions : on n'y touche pas.
      await accountService.update(account.id, isLoan ? common : { ...common, type, initialBalanceCents: initial });
    } else {
      await accountService.create({ dbId, type, initialBalanceCents: initial, currency: currency || undefined, ...common });
    }
    onClose();
  }

  const types = (Object.keys(TYPE_LABEL) as AccountType[]).filter(k => k !== 'pret');

  return (
    <Modal title={account ? 'Modifier le compte' : 'Nouveau compte'} onClose={onClose} width={520}>
      <div className="inline">
        <div className="field" style={{ width: 80 }}><label htmlFor="ac-logo">Logo</label>
          <input id="ac-logo" value={logo} onChange={e => setLogo(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="ac-name">Nom</label>
          <input id="ac-name" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="ac-type">Type</label>
          <select id="ac-type" value={type} disabled={isLoan} onChange={e => setType(e.target.value as AccountType)}>
            {isLoan ? <option value="pret">{TYPE_LABEL.pret}</option>
              : types.map(k => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="ac-start">Date de départ</label>
          <input id="ac-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ac-group">Groupe de comptes</label>
          <input id="ac-group" value={group} onChange={e => setGroup(e.target.value)}
            placeholder="Banque, épargne…" /></div>
        <div className="field"><label htmlFor="ac-number">Numéro de compte</label>
          <input id="ac-number" value={number} onChange={e => setNumber(e.target.value)} /></div>
      </div>
      {!isLoan && (devises.length > 0 || account?.currency) && (
        <div className="field"><label htmlFor="ac-cur">Devise</label>
          <select id="ac-cur" value={currency} disabled={!!account} onChange={e => setCurrency(e.target.value)}>
            <option value="">Devise de la base</option>
            {devises.map(c => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
            {account?.currency && !devises.some(c => c.code === account.currency) && <option value={account.currency}>{account.currency}</option>}
          </select>
          {account && <small className="muted">La devise ne peut plus changer une fois le compte créé.</small>}
        </div>
      )}
      {!isLoan && <MoneyInput label={`Solde initial (${currency || '€'})`} valueCents={initial} onChange={setInitial} allowNegative />}

      <label className="inline-check">
        <input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} />
        Favori : affiché en tête des listes
      </label>
      <label className="inline-check">
        <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />
        Masquer : retire le compte des listes et du solde total, sans l’archiver
      </label>

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
