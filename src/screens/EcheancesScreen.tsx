import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAccounts, useReferentials, usePatrimoine } from '../hooks/useData';
import { Layout } from '../components/Layout';
import { Modal, ConfirmDialog } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { PayeeField } from '../components/PayeeField';
import { scheduleService, occurrenceOf, nextOccurrences } from '../services/scheduleService';
import { payeeService } from '../services/referentialService';
import { formatNum } from '../utils/money';
import { formatFr, today, type Ymd } from '../utils/date';
import { HOLIDAY_RULE_LABEL, type HolidayRule } from '../utils/holidays';
import type { Database, Schedule, Kind, Periodicity, Account, Cents } from '../types';

const PERIOD_LABEL: Record<Periodicity, string> = {
  unique: 'Une fois', mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle', annuelle: 'Annuelle',
};

export function EcheancesScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const region = database.holidayRegion;
  const accounts = useAccounts(dbId);
  const ref = useReferentials(dbId);
  const items = useLiveQuery(() => scheduleService.list(dbId), [dbId], []) ?? [];
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Schedule | null>(null);

  const selected = items.find(s => s.id === selectedId) ?? null;
  const now = today();
  const dueCount = items.filter(s => s.active && s.nextDate <= now).length;
  const autoCount = items.filter(s => s.active && s.autoPost).length;

  const actions = (
    <>
      <button className="act" onClick={() => setCreating(true)}>
        <span className="ic" aria-hidden="true">➕</span>Ajouter</button>
      <button className="act" disabled={!selected} onClick={() => selected && setEditing(selected)}>
        <span className="ic" aria-hidden="true">✏️</span>Modifier</button>
      <button className="act" disabled={!selected} onClick={() => selected && setConfirmRemove(selected)}>
        <span className="ic" aria-hidden="true">🗑️</span>Supprimer</button>
      <div className="act-sep" />
      <button className="act" disabled={!selected || !selected.active}
        onClick={() => selected && scheduleService.post(selected.id, region)}>
        <span className="ic" aria-hidden="true">✔️</span>Comptabiliser</button>
    </>
  );

  return (
    <Layout actions={actions}>
      <div className="toolbar2">
        <strong style={{ fontSize: 16 }}>Échéances — opérations programmées</strong>
        {dueCount > 0 && (
          <span className="chip dep" style={{ marginLeft: 12 }}>
            {dueCount} échéance(s) à comptabiliser
          </span>
        )}
        {autoCount > 0 && (
          <span className="chip" style={{ marginLeft: 8 }}>
            {autoCount} automatique(s)
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={() => setCreating(true)}>➕ Nouvelle échéance</button>
        </div>
      </div>

      <div className="content-pad table-scroll" style={{ flex: 1 }}>
        <table className="opstable">
          <caption className="sr-only">Liste des opérations programmées</caption>
          <thead><tr>
            <th scope="col">Prochaine date</th><th scope="col">Catégorie / Commentaire</th>
            <th scope="col" className="num">Montant</th><th scope="col">Périodicité</th>
            <th scope="col">Comptabilisation</th><th scope="col">Tiers</th>
            <th scope="col">Paiement</th><th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            {items.map(s => {
              const c = ref.cat(s.categoryId);
              const due = s.active && s.nextDate <= now;
              const occ = occurrenceOf(s, region);
              return (
                <tr key={s.id} tabIndex={0}
                  className={selectedId === s.id ? 'sel' : ''}
                  style={{ opacity: s.active ? 1 : 0.5 }}
                  onClick={() => setSelectedId(s.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(s.id); } }}>
                  <td>
                    <span className={'dot ' + (due ? 'r' : 'bank')} aria-hidden="true" />
                    {formatFr(s.nextDate)}
                    {occ.reason && (
                      <span className="muted" style={{ fontSize: 11, display: 'block' }}
                        title={`Report : ${occ.reason}`}>
                        → {formatFr(occ.effectiveDate)} ({occ.reason})
                      </span>
                    )}
                    {!s.active && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>terminée</span>}
                    {s.active && s.endDate && (
                      <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                        jusqu’au {formatFr(s.endDate)}
                      </span>
                    )}
                  </td>
                  <td><div className="cat-cell">
                    <span className="em" aria-hidden="true">{c?.icon ?? '🏷️'}</span>
                    <span>{c?.name ?? 'Non catégorisé'}
                      {s.label ? <span className="muted" style={{ fontSize: 11, display: 'block' }}>{s.label}</span> : null}
                    </span></div></td>
                  <td className={'num ' + (s.amountCents < 0 ? 'neg' : 'pos')}>{formatNum(s.amountCents)}</td>
                  <td>{PERIOD_LABEL[s.periodicity]}</td>
                  <td>
                    <span className={'chip ' + (s.autoPost ? 'rec' : '')}>
                      {s.autoPost ? 'Automatique' : 'Manuelle'}
                    </span>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                      {HOLIDAY_RULE_LABEL[s.holidayRule].replace('Comptabiliser ', '')}
                    </span>
                  </td>
                  <td>{ref.payeeName(s.payeeId)}</td>
                  <td>{ref.methodName(s.paymentMethodId)}</td>
                  <td className="num">
                    {s.active && (
                      <button className="btn ghost" style={{ padding: '4px 8px', marginRight: 6 }}
                        title={`Créer l’opération au ${formatFr(occ.effectiveDate)} et avancer l’échéance`}
                        onClick={e => { e.stopPropagation(); scheduleService.post(s.id, region); }}>
                        Comptabiliser</button>
                    )}
                    <button className="iconbtn" aria-label={`Supprimer l’échéance du ${formatFr(s.nextDate)}`}
                      onClick={e => { e.stopPropagation(); setConfirmRemove(s); }}>🗑</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>Aucune échéance programmée.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="statusbar">
        <span className="muted">
          {items.filter(i => i.active).length} opération(s) programmée(s) · calendrier des jours
          fériés : {database.holidayRegion === 'metropole' ? 'métropole' : database.holidayRegion}
        </span>
      </div>

      {(creating || editing) && (
        <ScheduleForm dbId={dbId} accounts={accounts} schedule={editing ?? undefined}
          region={database.holidayRegion}
          onClose={() => { setCreating(false); setEditing(null); }} />
      )}

      {confirmRemove && (
        <ConfirmDialog title="Supprimer l’échéance" danger confirmLabel="Supprimer"
          message={`Supprimer l’échéance « ${confirmRemove.label ?? ref.catName(confirmRemove.categoryId)} » du ${formatFr(confirmRemove.nextDate)} ? Les opérations déjà comptabilisées sont conservées.`}
          onConfirm={async () => { await scheduleService.remove(confirmRemove.id); setSelectedId(null); }}
          onClose={() => setConfirmRemove(null)} />
      )}
    </Layout>
  );
}

function ScheduleForm({ dbId, accounts, schedule, region, onClose }: {
  dbId: string; accounts: Account[]; schedule?: Schedule;
  region: Database['holidayRegion']; onClose: () => void;
}) {
  const ref = useReferentials(dbId);
  const { assets, projects } = usePatrimoine(dbId);

  const [kind, setKind] = useState<Kind>(schedule?.kind === 'recette' ? 'recette' : 'depense');
  const [periodicity, setPeriodicity] = useState<Periodicity>(schedule?.periodicity ?? 'mensuelle');
  const [nextDate, setNextDate] = useState<Ymd>(schedule?.nextDate ?? today());
  const [endDate, setEndDate] = useState<Ymd>(schedule?.endDate ?? '');
  const [autoPost, setAutoPost] = useState(schedule?.autoPost ?? false);
  const [holidayRule, setHolidayRule] = useState<HolidayRule>(schedule?.holidayRule ?? 'suivant');
  const [amountCents, setAmountCents] = useState<Cents | null>(
    schedule ? Math.abs(schedule.amountCents) : null);
  const [accountId, setAccountId] = useState(schedule?.accountId ?? accounts[0]?.id ?? '');
  const [payeeName, setPayeeName] = useState('');
  const [categoryId, setCategoryId] = useState(schedule?.categoryId ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState(schedule?.paymentMethodId ?? '');
  const [label, setLabel] = useState(schedule?.label ?? '');
  const [reference, setReference] = useState(schedule?.reference ?? '');
  const [note, setNote] = useState(schedule?.note ?? '');
  const [linkId, setLinkId] = useState(
    schedule?.assetId ? `a:${schedule.assetId}` : schedule?.projectId ? `p:${schedule.projectId}` : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleCats = ref.catsForKind(kind === 'recette' ? 'recette' : 'depense');

  // Aperçu des trois prochaines occurrences, report des jours fériés compris.
  const preview = nextOccurrences({
    nextDate, endDate: endDate || undefined, periodicity, holidayRule,
  } as Schedule, region, 3);

  async function save() {
    if (amountCents === null || amountCents <= 0) { setError('Indiquez un montant supérieur à zéro.'); return; }
    if (!accountId) { setError('Sélectionnez un compte.'); return; }
    if (endDate && endDate < nextDate) { setError('La date de fin doit être postérieure à la prochaine échéance.'); return; }
    setError(null); setBusy(true);
    const payeeId = await payeeService.resolveByName(dbId, payeeName);
    const payload = {
      dbId, accountId, amountCents, kind, periodicity, nextDate,
      endDate: endDate || undefined, autoPost, holidayRule,
      payeeId, categoryId: categoryId || undefined,
      paymentMethodId: paymentMethodId || undefined,
      label: label.trim() || undefined, reference: reference.trim() || undefined,
      note: note.trim() || undefined,
      assetId: linkId.startsWith('a:') ? linkId.slice(2) : undefined,
      projectId: linkId.startsWith('p:') ? linkId.slice(2) : undefined,
    };
    try {
      if (schedule) {
        await scheduleService.update(schedule.id, {
          ...payload, amountCents: kind === 'depense' ? -Math.abs(amountCents) : Math.abs(amountCents),
        });
      } else {
        await scheduleService.create(payload);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={schedule ? 'Modifier l’échéance' : 'Nouvelle échéance'} onClose={onClose} width={660}>
      <div className="inline" role="group" aria-label="Type d’échéance">
        <button className={'btn ' + (kind === 'depense' ? '' : 'ghost')} aria-pressed={kind === 'depense'}
          onClick={() => { setKind('depense'); setCategoryId(''); }}>Dépense</button>
        <button className={'btn ' + (kind === 'recette' ? '' : 'ghost')} aria-pressed={kind === 'recette'}
          onClick={() => { setKind('recette'); setCategoryId(''); }}>Recette</button>
      </div>

      <div className="grid two">
        <div className="field"><label htmlFor="sc-date">Prochaine date</label>
          <input id="sc-date" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} /></div>
        <MoneyInput label="Montant (€)" valueCents={amountCents} onChange={setAmountCents} required />
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="sc-acc">Compte</label>
          <select id="sc-acc" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="sc-cat">Catégorie</label>
          <select id="sc-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {visibleCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
      </div>
      <div className="grid two">
        <PayeeField payees={ref.payees} value={payeeName} onChange={setPayeeName} label="Tiers" />
        <div className="field"><label htmlFor="sc-pm">Mode de paiement</label>
          <select id="sc-pm" value={paymentMethodId} onChange={e => setPaymentMethodId(e.target.value)}>
            <option value="">—</option>
            {ref.methods.filter(m => !m.archived).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="sc-link">Projet / Bien</label>
          <select id="sc-link" value={linkId} onChange={e => setLinkId(e.target.value)}>
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
          </select></div>
        <div className="field"><label htmlFor="sc-ref">Référence</label>
          <input id="sc-ref" maxLength={30} value={reference} onChange={e => setReference(e.target.value)}
            placeholder="30 caractères max." /></div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="sc-label">Libellé</label>
          <input id="sc-label" maxLength={60} value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div className="field"><label htmlFor="sc-note">Commentaire</label>
          <input id="sc-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)} /></div>
      </div>

      <fieldset className="fs">
        <legend>Planifier</legend>
        <div className="grid two">
          <div className="field"><label htmlFor="sc-per">Périodicité</label>
            <select id="sc-per" value={periodicity} onChange={e => setPeriodicity(e.target.value as Periodicity)}>
              <option value="unique">Une seule fois</option>
              <option value="mensuelle">Mensuelle</option>
              <option value="trimestrielle">Trimestrielle</option>
              <option value="annuelle">Annuelle</option></select></div>
          <div className="field">
            <label htmlFor="sc-end">Jusqu’au (facultatif)</label>
            <input id="sc-end" type="date" value={endDate} min={nextDate}
              disabled={periodicity === 'unique'}
              onChange={e => setEndDate(e.target.value)} />
            <small className="muted">
              {periodicity === 'unique'
                ? 'Sans objet pour une échéance ponctuelle.'
                : 'Vide : la programmation se poursuit sans limite.'}
            </small>
          </div>
        </div>
      </fieldset>

      <fieldset className="fs">
        <legend>Comptabiliser</legend>
        <label className="radio-row">
          <input type="radio" name="sc-auto" checked={autoPost} onChange={() => setAutoPost(true)} />
          <span><strong>Automatiquement</strong> — l’opération est créée au lancement de
            l’application dès que la date est atteinte.</span>
        </label>
        <label className="radio-row">
          <input type="radio" name="sc-auto" checked={!autoPost} onChange={() => setAutoPost(false)} />
          <span><strong>Manuellement, me prévenir avant</strong> — l’échéance est signalée et
            attend votre confirmation.</span>
        </label>
      </fieldset>

      <fieldset className="fs">
        <legend>Règle en cas de jour férié ou non ouvré</legend>
        <div className="field">
          <label className="sr-only" htmlFor="sc-hol">Règle de report</label>
          <select id="sc-hol" value={holidayRule} onChange={e => setHolidayRule(e.target.value as HolidayRule)}>
            {(Object.keys(HOLIDAY_RULE_LABEL) as HolidayRule[]).map(r =>
              <option key={r} value={r}>{HOLIDAY_RULE_LABEL[r]}.</option>)}
          </select>
          <small className="muted">
            Le calendrier des jours fériés se règle dans Préférences → Général.
          </small>
        </div>
        {preview.length > 0 && (
          <div className="preview">
            <strong>Prochaines comptabilisations</strong>
            <ul>
              {preview.map(o => (
                <li key={o.plannedDate}>
                  {formatFr(o.effectiveDate)}
                  {o.reason && <span className="muted"> — reporté du {formatFr(o.plannedDate)} ({o.reason})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" onClick={save} disabled={busy}>Enregistrer</button>
      </div>
    </Modal>
  );
}
