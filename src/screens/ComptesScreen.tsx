import { useState } from 'react';
import { useAccounts, useBalances } from '../hooks/useData';
import { Modal, ConfirmDialog } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { accountService } from '../services/accountService';
import { formatEur, type Cents } from '../utils/money';
import { today, type Ymd } from '../utils/date';
import type { Account, AccountType, Database } from '../types';

const TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Compte courant', epargne: 'Épargne', especes: 'Espèces', carte: 'Carte',
};

export function ComptesScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const accounts = useAccounts(dbId, true);
  const balances = useBalances(dbId);
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Account | null>(null);

  const actifs = accounts.filter(a => !a.archived);
  const archives = accounts.filter(a => a.archived);

  return (
    <>
      <h1 className="page-title">Comptes</h1>
      <p className="page-sub">Gérez les propriétés de vos comptes.</p>

      {/* Vue d'ensemble en cartes, reprise de la maquette. Le tableau qui suit
          reste nécessaire : lui seul porte la modification et l'archivage. */}
      {actifs.length > 0 && (
        <div className="acc-grid" style={{ marginTop: 0, marginBottom: 24 }}>
          {actifs.map(a => {
            const solde = balances[a.id] ?? a.initialBalanceCents;
            return (
              <div className="acc" key={a.id}>
                <div className="acc-type">{TYPE_LABEL[a.type]}</div>
                <div className="acc-name"><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</div>
                <div className={'acc-val ' + (solde < 0 ? 'neg' : '')}>{formatEur(solde)}</div>
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
            <th scope="col">Compte</th><th scope="col">Type</th>
            <th scope="col" style={{ textAlign: 'right' }}>Solde</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {actifs.map(a => (
              <tr key={a.id}>
                <td><span aria-hidden="true">{a.logo ?? '🏦'}</span> {a.name}</td>
                <td><span className="chip">{TYPE_LABEL[a.type]}</span></td>
                <td style={{ textAlign: 'right' }}>{formatEur(balances[a.id] ?? a.initialBalanceCents)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" onClick={() => setEditing(a)}>Modifier</button>
                  <button className="btn ghost" style={{ marginLeft: 6 }}
                    disabled={actifs.length <= 1}
                    title={actifs.length <= 1 ? 'Au moins un compte actif est nécessaire' : 'Archiver ce compte'}
                    onClick={() => setConfirmArchive(a)}>Archiver</button>
                </td>
              </tr>
            ))}
            {actifs.length === 0 && <tr><td colSpan={4} className="muted">Aucun compte actif.</td></tr>}
          </tbody>
        </table>
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
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'courant');
  const [logo, setLogo] = useState(account?.logo ?? '🏦');
  const [initial, setInitial] = useState<Cents | null>(account?.initialBalanceCents ?? 0);
  const [startDate, setStartDate] = useState<Ymd>(account?.startDate ?? today());
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('Le nom du compte est obligatoire.'); return; }
    if (initial === null) { setError('Le solde initial est invalide (exemple : 1250,00).'); return; }
    setError(null);
    if (account) {
      await accountService.update(account.id, {
        name: name.trim(), type, logo, initialBalanceCents: initial, startDate,
      });
    } else {
      await accountService.create({
        dbId, name: name.trim(), type, logo, initialBalanceCents: initial, startDate,
      });
    }
    onClose();
  }

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
          <select id="ac-type" value={type} onChange={e => setType(e.target.value as AccountType)}>
            {(Object.keys(TYPE_LABEL) as AccountType[]).map(k =>
              <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="ac-start">Date de départ</label>
          <input id="ac-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
      </div>
      <MoneyInput label="Solde initial (€)" valueCents={initial} onChange={setInitial} allowNegative />

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
