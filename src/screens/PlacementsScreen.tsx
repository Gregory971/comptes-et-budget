import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal, ConfirmDialog } from '../components/Modal';
import { SecurityModal, SecurityPriceModal, SecurityTxModal } from '../components/SecurityModals';
import { securityService, type SecurityStatus } from '../services/securityService';
import { fmtQty } from '../utils/portfolio';
import { formatEur } from '../utils/money';
import { formatFr } from '../utils/date';
import type { Cents, Database, Security, SecurityTxType } from '../types';

const NO_STATUS: SecurityStatus[] = [];

const TX_LABEL: Record<SecurityTxType, string> = {
  achat: 'Achat', vente: 'Vente', dividende: 'Dividende', ajustement: 'Ajustement',
};

/** Montant coloré selon son signe : vert gain, rouge perte. */
function Gain({ cents }: { cents?: Cents }) {
  if (cents === undefined) return <span className="muted">—</span>;
  const signe = cents > 0 ? '+' : '';
  return <span className={cents < 0 ? 'neg' : cents > 0 ? 'pos' : ''}>{signe}{formatEur(cents)}</span>;
}

const percent = (gain?: Cents, cost?: Cents) =>
  gain === undefined || !cost ? '' : ` (${gain >= 0 ? '+' : ''}${((gain / cost) * 100).toFixed(1).replace('.', ',')} %)`;

/** Placements : titres, prix de revient, plus-values et dividendes. */
export function PlacementsScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const [showArchived, setShowArchived] = useState(false);
  const statuses = useLiveQuery(() => securityService.statuses(dbId, showArchived), [dbId, showArchived], NO_STATUS) ?? NO_STATUS;
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const actifs = statuses.filter(s => !s.security.archived);
  const total = actifs.reduce((t, s) => ({
    value: t.value + (s.position.marketValueCents ?? 0),
    cost: t.cost + s.position.costCents,
    latent: t.latent + (s.position.latentCents ?? 0),
    gains: t.gains + s.position.totalGainCents,
  }), { value: 0, cost: 0, latent: 0, gains: 0 });
  const ouvert = statuses.find(s => s.security.id === openId);

  return (
    <>
      <h1 className="page-title">Placements</h1>
      <p className="page-sub">Suivez vos titres : prix de revient, plus-values et dividendes.</p>

      <div className="kpis" style={{ marginBottom: 20 }}>
        <div className="kpi"><div className="kpi-lbl">Valeur du portefeuille</div><div className="kpi-val">{formatEur(total.value)}</div></div>
        <div className="kpi"><div className="kpi-lbl">Coût de revient</div><div className="kpi-val">{formatEur(total.cost)}</div></div>
        <div className="kpi"><div className="kpi-lbl">Plus-values latentes</div>
          <div className="kpi-val"><Gain cents={total.latent} /></div></div>
        <div className="kpi"><div className="kpi-lbl">Gains réalisés + dividendes</div>
          <div className="kpi-val"><Gain cents={total.gains} /></div></div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong className="panel-t">Mes titres</strong>
          <span>
            <label className="inline-check" style={{ display: 'inline-flex', marginRight: 12 }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Afficher les archivés
            </label>
            <button className="btn" onClick={() => setCreating(true)}>+ Nouveau titre</button>
          </span>
        </div>
        <table className="simple">
          <thead><tr>
            <th scope="col">Titre</th>
            <th scope="col" style={{ textAlign: 'right' }}>Quantité</th>
            <th scope="col" style={{ textAlign: 'right' }}>PRU</th>
            <th scope="col" style={{ textAlign: 'right' }}>Cours</th>
            <th scope="col" style={{ textAlign: 'right' }}>Valeur</th>
            <th scope="col" style={{ textAlign: 'right' }}>+/− latente</th>
            <th scope="col" style={{ textAlign: 'right' }}>Dividendes</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {statuses.map(s => (
              <tr key={s.security.id} style={{ opacity: s.security.archived ? 0.55 : 1 }}>
                <td>
                  <strong>{s.security.name}</strong>
                  {s.security.symbol && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{s.security.symbol}</span>}
                  {s.security.archived && <span className="chip" style={{ marginLeft: 8 }}>archivé</span>}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtQty(s.position.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{s.position.quantity > 0 ? s.position.avgCost.toFixed(4).replace('.', ',') : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {s.position.lastPrice !== undefined ? s.position.lastPrice.toFixed(4).replace('.', ',') : '—'}
                  {s.priceDate && <span className="muted" style={{ display: 'block', fontSize: 11 }}>{formatFr(s.priceDate)}</span>}
                </td>
                <td style={{ textAlign: 'right' }}>{s.position.marketValueCents !== undefined ? formatEur(s.position.marketValueCents) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <Gain cents={s.position.latentCents} />
                  <span className="muted" style={{ fontSize: 11 }}>{percent(s.position.latentCents, s.position.costCents)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{formatEur(s.position.dividendsCents)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost" onClick={() => setOpenId(s.security.id)}>Détail</button>
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr><td colSpan={8} className="muted">
                Aucun titre. Ajoutez-en un, puis saisissez vos achats : le prix de revient et les plus-values se calculent seuls.
              </td></tr>
            )}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Les cours sont ceux que vous saisissez : aucune cotation n’est récupérée sur Internet.
          Sans cours saisi, le dernier cours d’un achat ou d’une vente sert de repère.
        </p>
      </div>

      {creating && <SecurityModal dbId={dbId} onClose={() => setCreating(false)} />}
      {ouvert && <SecurityDetail dbId={dbId} status={ouvert} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SecurityDetail({ dbId, status, onClose }: { dbId: string; status: SecurityStatus; onClose: () => void }) {
  const { security, position } = status;
  const txs = useLiveQuery(() => securityService.txs(security.id), [security.id], []) ?? [];
  const prices = useLiveQuery(() => securityService.prices(security.id), [security.id], []) ?? [];
  const [action, setAction] = useState<SecurityTxType | 'cours' | 'renommer' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [removeTx, setRemoveTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <Modal title={security.name} onClose={onClose} width={820}>
      <div className="grid two" style={{ marginBottom: 10 }}>
        <div>Quantité : <strong>{fmtQty(position.quantity)}</strong> · PRU :{' '}
          <strong>{position.quantity > 0 ? position.avgCost.toFixed(4).replace('.', ',') : '—'} €</strong></div>
        <div>Valeur : <strong>{position.marketValueCents !== undefined ? formatEur(position.marketValueCents) : '—'}</strong> · +/− latente :{' '}
          <strong><Gain cents={position.latentCents} /></strong></div>
        <div>Plus-values réalisées : <strong><Gain cents={position.realizedCents} /></strong></div>
        <div>Dividendes : <strong>{formatEur(position.dividendsCents)}</strong> · Frais : <strong>{formatEur(position.feesCents)}</strong></div>
      </div>

      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn" onClick={() => setAction('achat')}>Acheter</button>
        <button className="btn" onClick={() => setAction('vente')} disabled={position.quantity <= 0}>Vendre</button>
        <button className="btn ghost" onClick={() => setAction('dividende')}>Dividende</button>
        <button className="btn ghost" onClick={() => setAction('cours')}>Actualiser le cours</button>
        <button className="btn ghost" onClick={() => setAction('ajustement')}>Ajuster les parts</button>
        <button className="btn ghost" onClick={() => setAction('renommer')}>Modifier</button>
        <button className="btn ghost" onClick={() => security.archived ? securityService.unarchive(security.id) : setConfirmArchive(true)}>
          {security.archived ? 'Réactiver' : 'Archiver'}</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <strong>Mouvements</strong>
      <div style={{ maxHeight: 240, overflow: 'auto', marginBottom: 12 }}>
        <table className="simple">
          <thead><tr>
            <th scope="col">Date</th><th scope="col">Type</th>
            <th scope="col" style={{ textAlign: 'right' }}>Quantité</th>
            <th scope="col" style={{ textAlign: 'right' }}>Cours</th>
            <th scope="col" style={{ textAlign: 'right' }}>Montant</th>
            <th scope="col" style={{ textAlign: 'right' }}>Frais</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {txs.map(t => (
              <tr key={t.id}>
                <td>{formatFr(t.date)}</td>
                <td><span className={'chip' + (t.type === 'achat' ? ' dep' : t.type === 'ajustement' ? '' : ' rec')}>{TX_LABEL[t.type]}</span>
                  {t.operationIds?.length ? <span className="muted" title="Écriture bancaire associée" style={{ marginLeft: 6 }}>🏦</span> : null}</td>
                <td style={{ textAlign: 'right' }}>{t.type === 'dividende' ? '' : fmtQty(t.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{t.type === 'achat' || t.type === 'vente' ? t.unitPrice.toFixed(4).replace('.', ',') : ''}</td>
                <td style={{ textAlign: 'right' }}>{t.amountCents ? formatEur(t.amountCents) : ''}</td>
                <td style={{ textAlign: 'right' }}>{t.feesCents ? formatEur(t.feesCents) : ''}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="iconbtn" aria-label={`Supprimer le mouvement du ${formatFr(t.date)}`} onClick={() => setRemoveTx(t.id)}>🗑</button>
                </td>
              </tr>
            ))}
            {txs.length === 0 && <tr><td colSpan={7} className="muted">Aucun mouvement.</td></tr>}
          </tbody>
        </table>
      </div>

      <strong>Cotations</strong>
      <div style={{ maxHeight: 140, overflow: 'auto' }}>
        <table className="simple">
          <tbody>
            {prices.map(p => (
              <tr key={p.id}>
                <td>{formatFr(p.date)}</td>
                <td style={{ textAlign: 'right' }}>{p.price.toFixed(4).replace('.', ',')} €</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="iconbtn" aria-label={`Supprimer le cours du ${formatFr(p.date)}`} onClick={() => run(() => securityService.removePrice(p.id))}>🗑</button>
                </td>
              </tr>
            ))}
            {prices.length === 0 && <tr><td className="muted">Aucune cotation saisie.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row"><span /><button className="btn" onClick={onClose}>Fermer</button></div>

      {action && action !== 'cours' && action !== 'renommer' && (
        <SecurityTxModal dbId={dbId} security={security} type={action} held={position.quantity}
          lastPrice={position.lastPrice} onClose={() => setAction(null)} />
      )}
      {action === 'cours' && <SecurityPriceModal dbId={dbId} security={security} lastPrice={position.lastPrice} onClose={() => setAction(null)} />}
      {action === 'renommer' && <SecurityModal dbId={dbId} security={security} onClose={() => setAction(null)} />}
      {confirmArchive && (
        <ConfirmDialog title="Archiver le titre" confirmLabel="Archiver"
          message={`Archiver « ${security.name} » ? Son historique est conservé ; il disparaît de la liste et du total.`}
          onConfirm={() => securityService.archive(security.id)} onClose={() => setConfirmArchive(false)} />
      )}
      {removeTx && (
        <ConfirmDialog title="Supprimer le mouvement" confirmLabel="Supprimer"
          message="Supprimer ce mouvement ? L’écriture bancaire associée, s’il y en a une, est supprimée avec lui."
          onConfirm={() => run(() => securityService.removeTx(removeTx))} onClose={() => setRemoveTx(null)} />
      )}
    </Modal>
  );
}

export type { Security };
