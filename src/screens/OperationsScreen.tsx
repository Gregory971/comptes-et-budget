import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store/useStore';
import { useAccounts, useReferentials } from '../hooks/useData';
import { Layout } from '../components/Layout';
import { Modal, ConfirmDialog } from '../components/Modal';
import { ImportButton } from '../components/ImportButton';
import { OperationForm } from '../components/OperationForm';
import { operationService } from '../services/operationService';
import { forecastService, type ForecastLine } from '../services/forecastService';
import { backupService } from '../services/backupService';
import { formatNum, formatEur } from '../utils/money';
import { formatFr, monthLabel, today } from '../utils/date';
import type { Database, Operation } from '../types';

type Mode = 'reel' | 'previsionnel';

/** Bouton de la barre d'actions latérale (déclaré hors rendu). */
function Act({ ic, label, on, dis }: { ic: string; label: string; on?: () => void; dis?: boolean }) {
  return (
    <button className="act" onClick={on} disabled={dis}>
      <span className="ic" aria-hidden="true">{ic}</span>{label}
    </button>
  );
}

/** Ligne du tableau : opération réelle ou prévision, avec le solde courant. */
type Row =
  | { type: 'reel'; key: string; o: Operation; solde: number }
  | { type: 'prevu'; key: string; f: ForecastLine; solde: number };

export function OperationsScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const region = database.holidayRegion;
  const setScreen = useStore(s => s.setScreen);
  const accounts = useAccounts(dbId);
  const ref = useReferentials(dbId);

  const [mode, setMode] = useState<Mode>('reel');
  const [accountId, setAccountId] = useState('');
  const [anchor, setAnchor] = useState(() => new Date());
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [duplicating, setDuplicating] = useState<Operation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Operation | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const label = monthLabel(anchor.getFullYear(), anchor.getMonth());
  const anchorKey = `${anchor.getFullYear()}-${anchor.getMonth()}`;

  // Projection du mois : opérations réelles, échéances à venir, reste à vivre.
  const data = useLiveQuery(
    () => forecastService.build(dbId, accountId || undefined, anchor, region),
    [dbId, accountId, anchorKey, region], undefined,
  );

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    let run = data.openingCents;
    for (const o of data.operations) {
      run += o.amountCents;
      out.push({ type: 'reel', key: o.id, o, solde: run });
    }
    if (mode === 'previsionnel') {
      for (const f of data.forecast) {
        run += f.amountCents;
        out.push({ type: 'prevu', key: f.id, f, solde: run });
      }
    }
    return out;
  }, [data, mode]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      if (r.type === 'prevu') return r.f.label.toLowerCase().includes(q);
      const o = r.o;
      return (o.label ?? '').toLowerCase().includes(q) ||
        (o.reference ?? '').toLowerCase().includes(q) ||
        (o.note ?? '').toLowerCase().includes(q) ||
        ref.catName(o.categoryId).toLowerCase().includes(q) ||
        ref.payeeName(o.payeeId).toLowerCase().includes(q);
    });
  }, [rows, search, ref]);

  const list = data?.operations ?? [];
  const debits = list.reduce((s, o) => (o.amountCents < 0 ? s - o.amountCents : s), 0);
  const credits = list.reduce((s, o) => (o.amountCents >= 0 ? s + o.amountCents : s), 0);
  const pointed = (data?.openingCents ?? 0) +
    list.reduce((s, o) => (o.checked ? s + o.amountCents : s), 0);
  const selected = list.find(o => o.id === selectedId) ?? null;

  const actions = (
    <>
      <Act ic="➕" label="Ajouter" on={() => setScreen('comptabiliser')} />
      <Act ic="✏️" label="Modifier" on={() => selected && setEditing(selected)} dis={!selected} />
      <Act ic="🗑️" label="Supprimer" on={() => selected && setConfirmDelete(selected)} dis={!selected} />
      <Act ic="📑" label="Dupliquer" on={() => selected && setDuplicating(selected)} dis={!selected} />
      <Act ic="✔️" label="Rapprocher"
        on={() => selected && operationService.toggleChecked(selected.id, !selected.checked)} dis={!selected} />
      <div className="act-sep" />
      <Act ic="🔍" label="Rechercher" on={() => searchRef.current?.focus()} />
      <div className="act-sep" />
      <Act ic="⬆️" label="Exporter" on={() => backupService.download()} />
      <ImportButton />
    </>
  );

  return (
    <Layout actions={actions}>
      <div className="toolbar2">
        <label className="sr-only" htmlFor="ops-account">Filtrer par compte</label>
        <select id="ops-account" className="selbox" value={accountId} onChange={e => setAccountId(e.target.value)}>
          <option value="">Tous les comptes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <div className="segmented" role="group" aria-label="Affichage">
          <button className={mode === 'reel' ? 'on' : ''} aria-pressed={mode === 'reel'}
            onClick={() => setMode('reel')}>Réel</button>
          <button className={mode === 'previsionnel' ? 'on' : ''} aria-pressed={mode === 'previsionnel'}
            onClick={() => setMode('previsionnel')}>Prévisionnel</button>
        </div>

        <label className="sr-only" htmlFor="ops-search">Rechercher une opération</label>
        <input id="ops-search" ref={searchRef} className="selbox" style={{ maxWidth: 200 }}
          placeholder="🔍 Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />

        <div className="monthnav">
          <button aria-label="Mois précédent"
            onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>‹</button>
          <span className="lbl" aria-live="polite">{label}</span>
          <button aria-label="Mois suivant"
            onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>›</button>
        </div>
      </div>

      {mode === 'previsionnel' && data && (
        <div className="forecast-bar">
          <div><small>Solde réel au {formatFr(lastRealDate(data.operations) ?? data.from)}</small>
            <strong className={data.actualCents >= 0 ? 'pos' : 'neg'}>{formatEur(data.actualCents)}</strong></div>
          <span className="op" aria-hidden="true">+</span>
          <div><small>Échéances à venir</small>
            <strong className={data.scheduledCents >= 0 ? 'pos' : 'neg'}>{formatEur(data.scheduledCents)}</strong>
            <em>montants certains</em></div>
          <span className="op" aria-hidden="true">−</span>
          <div><small>Reste à vivre budgété</small>
            <strong className="neg">{formatEur(data.budgetRemainingCents)}</strong>
            <em>estimation</em></div>
          <span className="op" aria-hidden="true">=</span>
          <div className="total"><small>Solde estimé au {formatFr(data.to)}</small>
            <strong className={data.projectedCents >= 0 ? 'pos' : 'neg'}>{formatEur(data.projectedCents)}</strong></div>
        </div>
      )}

      <div className="content-pad table-scroll" style={{ flex: 1 }}>
        <table className="opstable">
          <caption className="sr-only">
            Opérations de {label}{mode === 'previsionnel' ? ', prévisions incluses' : ''}
          </caption>
          <thead><tr>
            <th scope="col">Date</th><th scope="col">État</th>
            <th scope="col">Catégorie / Commentaire</th>
            <th scope="col" className="num">Montant</th><th scope="col" className="num">Solde</th>
            <th scope="col">Tiers</th><th scope="col">Paiement</th>
          </tr></thead>
          <tbody>
            {visible.map(r => r.type === 'reel'
              ? <RealRow key={r.key} o={r.o} solde={r.solde} ref_={ref}
                  selected={selectedId === r.o.id}
                  onSelect={() => setSelectedId(r.o.id)}
                  onEdit={() => r.o.kind !== 'virement' && setEditing(r.o)}
                  onDelete={() => setConfirmDelete(r.o)} />
              : <ForecastRow key={r.key} f={r.f} solde={r.solde} ref_={ref} />)}

            {data && visible.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>
                Aucune opération{search ? ' pour cette recherche' : ' ce mois-ci'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="statusbar">
        <div className="solde-pill bank"><small>Solde en banque</small>
          {formatNum(data?.actualCents ?? 0)}</div>
        <div className="solde-pill point"><small>Solde pointé</small>{formatNum(pointed)}</div>
        {mode === 'previsionnel' && data && (
          <div className="solde-pill est"><small>Solde estimé fin de mois</small>
            {formatNum(data.projectedCents)}</div>
        )}
        <div className="right">
          {formatNum(credits)} − {formatNum(debits)} = {formatNum(credits - debits)} · {list.length} op.
          {mode === 'previsionnel' && data && data.forecast.length > 0 &&
            ` · ${data.forecast.length} prévision(s)`}
        </div>
      </div>

      {editing && (
        <Modal title="Modifier l’opération" onClose={() => setEditing(null)} width={620}>
          <OperationForm dbId={dbId} accounts={accounts} submitLabel="Enregistrer"
            initial={{
              kind: editing.kind, date: editing.date, amountCents: editing.amountCents,
              accountId: editing.accountId, payeeId: editing.payeeId, categoryId: editing.categoryId,
              paymentMethodId: editing.paymentMethodId, label: editing.label,
              reference: editing.reference, note: editing.note,
              assetId: editing.assetId, projectId: editing.projectId,
            }}
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => { await operationService.update(editing.id, input); setEditing(null); }} />
        </Modal>
      )}

      {duplicating && (
        <Modal title="Dupliquer l’opération" onClose={() => setDuplicating(null)} width={620}>
          <OperationForm dbId={dbId} accounts={accounts} submitLabel="Créer la copie"
            initial={{
              kind: duplicating.kind, date: today(),
              amountCents: duplicating.amountCents, accountId: duplicating.accountId,
              payeeId: duplicating.payeeId, categoryId: duplicating.categoryId,
              paymentMethodId: duplicating.paymentMethodId, label: duplicating.label,
              reference: duplicating.reference, note: duplicating.note,
              assetId: duplicating.assetId, projectId: duplicating.projectId,
            }}
            onCancel={() => setDuplicating(null)}
            onSubmit={async (input) => { await operationService.create({ dbId, ...input }); setDuplicating(null); }} />
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog title="Supprimer l’opération" danger confirmLabel="Supprimer"
          message={
            <>
              <p>Supprimer « {confirmDelete.label ?? ref.catName(confirmDelete.categoryId)} » du
                {' '}{formatFr(confirmDelete.date)} ({formatNum(confirmDelete.amountCents)} €) ?</p>
              {confirmDelete.transferId && (
                <p className="muted">Il s’agit d’un virement : les deux écritures liées seront supprimées.</p>
              )}
            </>
          }
          onConfirm={async () => { await operationService.remove(confirmDelete.id); setSelectedId(null); }}
          onClose={() => setConfirmDelete(null)} />
      )}
    </Layout>
  );
}

type Refs = ReturnType<typeof useReferentials>;

function RealRow({ o, solde, ref_, selected, onSelect, onEdit, onDelete }: {
  o: Operation; solde: number; ref_: Refs; selected: boolean;
  onSelect: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const c = ref_.cat(o.categoryId);
  const isTransfer = o.kind === 'virement';
  return (
    <tr className={selected ? 'sel' : ''} tabIndex={0} aria-selected={selected}
      onClick={onSelect} onDoubleClick={onEdit}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
        if (e.key === 'Delete' && selected) onDelete();
      }}>
      <td><span className="dot bank" aria-hidden="true" />{formatFr(o.date)}</td>
      <td>
        <button className="statebtn"
          aria-label={o.checked ? 'Opération pointée — annuler le pointage' : 'Opération non pointée — pointer'}
          onClick={e => { e.stopPropagation(); operationService.toggleChecked(o.id, !o.checked); }}>
          {o.checked ? '✅' : '🕐'}
        </button>
      </td>
      <td><div className="cat-cell">
        <span className="em" aria-hidden="true">{isTransfer ? '🔁' : c?.icon ?? '🏷️'}</span>
        <span>{isTransfer ? 'Virement' : c?.name ?? 'Non catégorisé'}
          {o.label && <span className="muted" style={{ fontSize: 11, display: 'block' }}>{o.label}</span>}
          {o.note && <span className="muted" style={{ fontSize: 11, display: 'block', fontStyle: 'italic' }}>{o.note}</span>}
        </span></div></td>
      <td className={'num ' + (o.amountCents < 0 ? 'neg' : 'pos')}>{formatNum(o.amountCents)}</td>
      <td className="num">{formatNum(solde)}
        <span className={'dot ' + (solde >= 0 ? 'g' : 'r')} aria-hidden="true"
          style={{ marginLeft: 6, marginRight: 0 }} /></td>
      <td>{ref_.payeeName(o.payeeId)}</td>
      <td>{ref_.methodName(o.paymentMethodId)}
        {o.reference && <span className="muted" style={{ fontSize: 11, display: 'block' }}>{o.reference}</span>}
      </td>
    </tr>
  );
}

/** Ligne prévisionnelle : non sélectionnable, distinguée visuellement du réel. */
function ForecastRow({ f, solde, ref_ }: { f: ForecastLine; solde: number; ref_: Refs }) {
  const c = ref_.cat(f.categoryId);
  const estimated = f.kind === 'budget';
  return (
    <tr className={'prevu' + (estimated ? ' estime' : '')}>
      <td><span className="dot prevu" aria-hidden="true" />{formatFr(f.date)}</td>
      <td><span title={estimated ? 'Estimation budgétaire' : 'Échéance programmée'}>
        {estimated ? '📊' : '⏰'}</span></td>
      <td><div className="cat-cell">
        <span className="em" aria-hidden="true">{c?.icon ?? (estimated ? '📊' : '⏰')}</span>
        <span>{f.label}
          <span className="muted" style={{ fontSize: 11, display: 'block' }}>
            {estimated ? 'Reste à consommer sur le budget du mois' : 'Échéance programmée'}
            {f.shiftedFrom && ` — reporté du ${formatFr(f.shiftedFrom)} (${f.shiftReason})`}
          </span>
        </span></div></td>
      <td className={'num ' + (f.amountCents < 0 ? 'neg' : 'pos')}>{formatNum(f.amountCents)}</td>
      <td className="num">{formatNum(solde)}
        <span className={'dot ' + (solde >= 0 ? 'g' : 'r')} aria-hidden="true"
          style={{ marginLeft: 6, marginRight: 0 }} /></td>
      <td>{ref_.payeeName(f.payeeId)}</td>
      <td>{ref_.methodName(f.paymentMethodId)}</td>
    </tr>
  );
}

function lastRealDate(ops: Operation[]) {
  return ops.length ? ops[ops.length - 1].date : undefined;
}

