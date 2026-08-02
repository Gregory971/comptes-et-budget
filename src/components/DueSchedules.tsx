import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { scheduleService, occurrenceOf } from '../services/scheduleService';
import { useReferentials } from '../hooks/useData';
import { Modal } from './Modal';
import { formatNum } from '../utils/money';
import { formatFr, today } from '../utils/date';
import type { Database } from '../types';

/**
 * Traitement des échéances arrivées à terme, au lancement de l'application.
 *
 *  · les échéances marquées « Automatiquement » sont comptabilisées sans
 *    intervention, en rattrapant les occurrences manquées après une absence ;
 *  · celles marquées « Manuellement, me prévenir avant » sont présentées ici
 *    pour confirmation, une par une ou en bloc.
 */
export function DueSchedules({ database }: { database: Database }) {
  const dbId = database.id;
  const region = database.holidayRegion;
  const ref = useReferentials(dbId);
  const [autoPosted, setAutoPosted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ranFor = useRef<string | null>(null);

  // Comptabilisation automatique : une seule fois par base et par session.
  useEffect(() => {
    if (ranFor.current === dbId) return;
    ranFor.current = dbId;
    let cancelled = false;
    scheduleService.runAutoPost(dbId, region)
      .then(n => { if (!cancelled && n > 0) setAutoPosted(n); })
      .catch(e => console.error('Comptabilisation automatique impossible :', e));
    return () => { cancelled = true; };
  }, [dbId, region]);

  const pending = useLiveQuery(() => scheduleService.pendingManual(dbId), [dbId], []) ?? [];

  if (autoPosted > 0 && pending.length === 0) {
    return (
      <div className="toast" role="status">
        {autoPosted} échéance(s) comptabilisée(s) automatiquement.
        <button className="linklike" style={{ marginLeft: 10 }}
          onClick={() => setAutoPosted(0)}>Fermer</button>
      </div>
    );
  }

  if (pending.length === 0 || dismissed) return null;

  const total = pending.reduce((s, x) => s + x.amountCents, 0);

  return (
    <Modal title="Échéances à comptabiliser" onClose={() => setDismissed(true)} width={640}>
      <p className="muted" style={{ marginTop: 0 }}>
        {pending.length} opération(s) programmée(s) ont atteint leur date au {formatFr(today())}
        {' '}et attendent votre confirmation.
      </p>

      <table className="simple">
        <thead><tr>
          <th scope="col">Date</th><th scope="col">Libellé</th>
          <th scope="col" style={{ textAlign: 'right' }}>Montant</th>
          <th scope="col"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody>
          {pending.map(s => {
            const occ = occurrenceOf(s, region);
            return (
              <tr key={s.id}>
                <td>
                  {formatFr(occ.effectiveDate)}
                  {occ.reason && (
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                      reporté du {formatFr(occ.plannedDate)} ({occ.reason})
                    </span>
                  )}
                </td>
                <td>{s.label ?? ref.catName(s.categoryId)}
                  <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                    {ref.payeeName(s.payeeId)}</span>
                </td>
                <td style={{ textAlign: 'right' }}
                  className={s.amountCents < 0 ? 'neg' : 'pos'}>{formatNum(s.amountCents)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn ghost" style={{ padding: '4px 10px' }} disabled={busy}
                    onClick={() => scheduleService.post(s.id, region)}>Comptabiliser</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="muted" style={{ textAlign: 'right' }}>
        Total : <strong>{formatNum(total)} €</strong>
      </p>

      <div className="row">
        <button className="btn ghost" onClick={() => setDismissed(true)}>Plus tard</button>
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            for (const s of pending) await scheduleService.post(s.id, region);
          } finally {
            setBusy(false);
          }
        }}>Tout comptabiliser</button>
      </div>
    </Modal>
  );
}
