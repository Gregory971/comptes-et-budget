import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from './Modal';
import { MoneyInput } from './MoneyInput';
import { reconcileService } from '../services/reconcileService';
import { formatEur, type Cents } from '../utils/money';
import { formatFr, today, type Ymd } from '../utils/date';
import type { Account } from '../types';

/**
 * Rapprochement d'un compte avec son relevé.
 *
 * La fenêtre montre l'écart entre le solde annoncé par la banque et le total
 * des opérations pointées. Un écart nul valide le compte ; sinon, la liste des
 * opérations en attente permet de pointer au fil du relevé, l'écart se
 * recalculant à chaque coche — c'est ce chiffre qui désigne la saisie oubliée
 * ou le montant erroné.
 */
export function ReconcileModal({ dbId, account, onClose }: {
  dbId: string; account: Account; onClose: () => void;
}) {
  const [upTo, setUpTo] = useState<Ymd>(today());
  const [releve, setReleve] = useState<Cents | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useLiveQuery(
    () => reconcileService.summary(dbId, account.id, upTo),
    [dbId, account.id, upTo], undefined,
  );

  const ecart = useMemo(
    () => (summary && releve !== null ? reconcileService.difference(releve, summary) : null),
    [summary, releve],
  );

  async function pointer(id: string, checked: boolean) {
    setBusy(true);
    await reconcileService.setChecked([id], checked);
    setBusy(false);
  }

  return (
    <Modal title={`Rapprochement — ${account.name}`} onClose={onClose} width={760}>
      <div className="inline">
        <div className="field" style={{ width: 180 }}>
          <label htmlFor="rap-date">Date du relevé</label>
          <input id="rap-date" type="date" value={upTo}
            onChange={e => setUpTo(e.target.value as Ymd)} />
        </div>
        <div style={{ width: 200 }}>
          <MoneyInput label="Solde du relevé (€)" valueCents={releve} onChange={setReleve} allowNegative />
        </div>
      </div>

      {summary === undefined ? <p className="muted">Calcul en cours…</p> : (
        <>
          <table className="simple" style={{ maxWidth: 520 }}>
            <tbody>
              <tr><td className="muted">Solde pointé à cette date</td>
                <td className="num" style={{ textAlign: 'right' }}>{formatEur(summary.checkedCents)}</td></tr>
              <tr><td className="muted">Solde de la base, pointé ou non</td>
                <td className="num" style={{ textAlign: 'right' }}>{formatEur(summary.theoreticalCents)}</td></tr>
              <tr><td className="muted">Opérations non pointées</td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {summary.pending.length} · {formatEur(summary.pendingCents)}</td></tr>
            </tbody>
          </table>

          {ecart !== null && (
            <p style={{
              marginTop: 12, fontWeight: 700,
              color: ecart === 0 ? 'var(--green)' : 'var(--red)',
            }} role="status">
              {ecart === 0
                ? '✓ Compte rapproché : le relevé et les opérations pointées concordent.'
                : `Écart de ${formatEur(ecart)} entre le relevé et les opérations pointées.`}
            </p>
          )}
          {ecart !== null && ecart !== 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Écart négatif : la banque a débité quelque chose que la base ignore.
              Positif : une dépense est saisie ici sans exister sur le relevé, ou un
              encaissement manque.
            </p>
          )}

          <hr className="sep" />
          <strong>Opérations en attente de pointage</strong>
          {summary.pending.length === 0 ? (
            <p className="muted">Toutes les opérations de la période sont pointées.</p>
          ) : (
            <div style={{ maxHeight: '38vh', overflow: 'auto', marginTop: 8 }}>
              <table className="simple">
                <thead>
                  <tr><th style={{ width: 34 }}><span className="sr-only">Pointer</span></th>
                    <th>Date</th><th>Libellé</th>
                    <th style={{ textAlign: 'right' }}>Montant</th></tr>
                </thead>
                <tbody>
                  {summary.pending.map(o => (
                    <tr key={o.id}>
                      <td>
                        <input type="checkbox" checked={false} disabled={busy}
                          aria-label={`Pointer l’opération du ${formatFr(o.date)}`}
                          onChange={() => pointer(o.id, true)} />
                      </td>
                      <td>{formatFr(o.date)}</td>
                      <td>{o.label || <span className="muted">sans libellé</span>}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{formatEur(o.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn ghost" disabled={busy || summary.pending.length === 0}
              onClick={async () => {
                setBusy(true);
                await reconcileService.setChecked(summary.pending.map(o => o.id), true);
                setBusy(false);
              }}>
              Tout pointer jusqu’au {formatFr(upTo)}
            </button>
            <button className="btn" onClick={onClose}>Fermer</button>
          </div>
        </>
      )}
    </Modal>
  );
}
