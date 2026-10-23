import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ConfirmDialog } from '../components/Modal';
import { useAccounts, useReferentials } from '../hooks/useData';
import { operationService } from '../services/operationService';
import {
  deleteOperations, mergeCategories, mergePayees, previewReplace, purgeUnusedPayees, replaceInOperations,
  selectForDeletion, unusedPayees, type ReplaceField,
} from '../services/maintenanceService';
import { addYears, today, formatFr, type Ymd } from '../utils/date';
import type { Database } from '../types';

/** Message de résultat commun aux outils : succès en neutre, refus en rouge. */
function Result({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--green)' : 'var(--red)', margin: '8px 0 0' }}>{msg.text}</p>;
}

const plural = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`;

/** Préférences → Maintenance : fusionner, épurer, remplacer et supprimer en masse. */
export function MaintenanceTab({ database }: { database: Database }) {
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Outils de nettoyage. Chacun annonce ce qu’il va modifier avant de s’exécuter. Pensez à exporter une
        sauvegarde avant une opération importante.
      </p>
      <MergeCard dbId={database.id} />
      <PurgeCard dbId={database.id} />
      <ReplaceCard dbId={database.id} />
      <DeleteCard dbId={database.id} />
    </>
  );
}

/* --------------------------------------------------------------- fusion */

function MergeCard({ dbId }: { dbId: string }) {
  const ref = useReferentials(dbId);
  const [what, setWhat] = useState<'categories' | 'payees'>('categories');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const items = what === 'categories'
    ? ref.cats.filter(c => !c.archived).map(c => ({ id: c.id, name: `${c.icon ?? ''} ${c.name}`.trim() }))
    : ref.payees.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name }));
  const field = what === 'categories' ? 'categoryId' : 'payeeId';
  const uses = useLiveQuery(async () => (from ? operationService.countByRef(dbId, field, from) : 0), [dbId, from, field], 0) ?? 0;
  const nameOf = (id: string) => items.find(i => i.id === id)?.name ?? '';

  async function run() {
    try {
      const r = what === 'categories' ? await mergeCategories(dbId, from, to) : await mergePayees(dbId, from, to);
      setMsg({ ok: true, text: `Fusion faite : ${plural(r.operations, 'opération modifiée', 'opérations modifiées')}`
        + (r.schedules ? `, ${plural(r.schedules, 'échéance', 'échéances')}` : '') + '.' });
      setFrom(''); setTo('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="card">
      <strong>Fusionner</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
        Remplace un élément par un autre partout (opérations, ventilations, échéances, règles, budgets), puis supprime
        le premier.
      </p>
      <div className="inline" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field"><label htmlFor="mg-what">Élément</label>
          <select id="mg-what" value={what} onChange={e => { setWhat(e.target.value as 'categories' | 'payees'); setFrom(''); setTo(''); setMsg(null); }}>
            <option value="categories">Catégories</option><option value="payees">Tiers</option>
          </select></div>
        <div className="field grow"><label htmlFor="mg-from">À supprimer (remplacé par le suivant)</label>
          <select id="mg-from" value={from} onChange={e => { setFrom(e.target.value); setMsg(null); }}>
            <option value="">—</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <div className="field grow"><label htmlFor="mg-to">À conserver</label>
          <select id="mg-to" value={to} onChange={e => { setTo(e.target.value); setMsg(null); }}>
            <option value="">—</option>
            {items.filter(i => i.id !== from).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <button className="btn" disabled={!from || !to} onClick={() => setConfirm(true)}>Fusionner</button>
      </div>
      {from && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>« {nameOf(from)} » est utilisé par {plural(uses, 'opération', 'opérations')}.</p>}
      <Result msg={msg} />
      {confirm && (
        <ConfirmDialog title="Fusionner" confirmLabel="Fusionner"
          message={`Remplacer « ${nameOf(from)} » par « ${nameOf(to)} » partout, puis supprimer « ${nameOf(from)} » ? Cette opération ne s’annule pas.`}
          onConfirm={run} onClose={() => setConfirm(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ épuration */

function PurgeCard({ dbId }: { dbId: string }) {
  const [before, setBefore] = useState<Ymd>(() => addYears(today(), -3));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const liste = useLiveQuery(() => unusedPayees(dbId, before), [dbId, before], []) ?? [];

  return (
    <div className="card">
      <strong>Épurer les tiers inutilisés</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
        Archive les tiers sans opération depuis la date choisie (et sans échéance en cours). Ils disparaissent des
        listes de saisie mais restent lisibles dans l’historique, et reviennent si vous ressaisissez leur nom.
      </p>
      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="pg-date">Sans opération depuis le</label>
          <input id="pg-date" type="date" value={before} onChange={e => { setBefore(e.target.value); setMsg(null); }} /></div>
        <button className="btn" disabled={liste.length === 0} onClick={() => setConfirm(true)}>
          Archiver {plural(liste.length, 'tiers', 'tiers')}</button>
      </div>
      <p role="status" className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
        {liste.length === 0 ? 'Aucun tiers concerné.' : `${plural(liste.length, 'tiers concerné', 'tiers concernés')} (dernière utilisation avant le ${formatFr(before)}).`}
      </p>
      {liste.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Voir la liste</summary>
          <ul style={{ fontSize: 13, maxHeight: 160, overflow: 'auto' }}>
            {liste.map(p => <li key={p.id}>{p.name} <span className="muted">— {p.lastUse ? `dernière opération le ${formatFr(p.lastUse)}` : 'jamais utilisé'}</span></li>)}
          </ul>
        </details>
      )}
      <Result msg={msg} />
      {confirm && (
        <ConfirmDialog title="Archiver les tiers" confirmLabel="Archiver"
          message={`Archiver ${plural(liste.length, 'tiers', 'tiers')} sans opération depuis le ${formatFr(before)} ?`}
          onConfirm={async () => { const n = await purgeUnusedPayees(dbId, before); setMsg({ ok: true, text: `${plural(n, 'tiers archivé', 'tiers archivés')}.` }); }}
          onClose={() => setConfirm(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------ remplacement en masse */

const FIELD_LABEL: Record<ReplaceField, string> = { categoryId: 'Catégorie', payeeId: 'Tiers', paymentMethodId: 'Mode de paiement' };

function ReplaceCard({ dbId }: { dbId: string }) {
  const ref = useReferentials(dbId);
  const accounts = useAccounts(dbId, true);
  const [field, setField] = useState<ReplaceField>('categoryId');
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [schedules, setSchedules] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const options = field === 'categoryId' ? ref.cats.filter(c => !c.archived).map(c => ({ id: c.id, name: c.name }))
    : field === 'payeeId' ? ref.payees.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name }))
    : ref.methods.filter(m => !m.archived).map(m => ({ id: m.id, name: m.name }));
  const scope = { dbId, accountId: accountId || undefined, from: from || undefined, to: to || undefined };
  const spec = { field, fromValue: fromValue || undefined, toValue: toValue || undefined, includeSchedules: schedules };
  const preview = useLiveQuery(() => previewReplace(scope, spec),
    [dbId, field, fromValue, toValue, accountId, from, to, schedules], { operations: 0, schedules: 0, skipped: 0 });
  const nom = (id: string) => (id ? options.find(o => o.id === id)?.name ?? '' : `(aucun ${FIELD_LABEL[field].toLowerCase()})`);
  const sameValue = fromValue === toValue;

  async function run() {
    try {
      const r = await replaceInOperations(scope, spec);
      setMsg({ ok: true, text: `${plural(r.operations, 'opération modifiée', 'opérations modifiées')}`
        + (schedules ? `, ${plural(r.schedules, 'échéance modifiée', 'échéances modifiées')}` : '') + '.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="card">
      <strong>Remplacer en masse</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
        Change la catégorie, le tiers ou le mode de paiement de toutes les opérations qui correspondent. Les virements ne sont jamais modifiés.
      </p>
      <div className="grid two">
        <div className="field"><label htmlFor="rp-field">Champ</label>
          <select id="rp-field" value={field} onChange={e => { setField(e.target.value as ReplaceField); setFromValue(''); setToValue(''); setMsg(null); }}>
            {(Object.keys(FIELD_LABEL) as ReplaceField[]).map(k => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="rp-acc">Compte</label>
          <select id="rp-acc" value={accountId} onChange={e => { setAccountId(e.target.value); setMsg(null); }}>
            <option value="">Tous les comptes</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="rp-from-v">Remplacer</label>
          <select id="rp-from-v" value={fromValue} onChange={e => { setFromValue(e.target.value); setMsg(null); }}>
            <option value="">(aucune valeur)</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="field"><label htmlFor="rp-to-v">Par</label>
          <select id="rp-to-v" value={toValue} onChange={e => { setToValue(e.target.value); setMsg(null); }}>
            <option value="">(vider le champ)</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="field"><label htmlFor="rp-d1">Du (facultatif)</label>
          <input id="rp-d1" type="date" value={from} onChange={e => { setFrom(e.target.value); setMsg(null); }} /></div>
        <div className="field"><label htmlFor="rp-d2">Au (facultatif)</label>
          <input id="rp-d2" type="date" value={to} onChange={e => { setTo(e.target.value); setMsg(null); }} /></div>
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={schedules} onChange={e => setSchedules(e.target.checked)} />
        Inclure aussi les échéances programmées
      </label>
      <p role="status" className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
        {sameValue ? 'Choisissez deux valeurs différentes.'
          : `${plural(preview?.operations ?? 0, 'opération sera modifiée', 'opérations seront modifiées')}`
            + (schedules ? `, ${plural(preview?.schedules ?? 0, 'échéance', 'échéances')}` : '')
            + (preview?.skipped ? ` — ${plural(preview.skipped, 'opération écartée', 'opérations écartées')} (sens différent de la catégorie choisie)` : '') + '.'}
      </p>
      <button className="btn" disabled={sameValue || ((preview?.operations ?? 0) + (preview?.schedules ?? 0)) === 0} onClick={() => setConfirm(true)}>Remplacer</button>
      <Result msg={msg} />
      {confirm && (
        <ConfirmDialog title="Remplacer en masse" confirmLabel="Remplacer"
          message={`Remplacer « ${nom(fromValue)} » par « ${toValue ? nom(toValue) : '(vide)'} » dans ${plural(preview?.operations ?? 0, 'opération', 'opérations')} ? Cette opération ne s’annule pas.`}
          onConfirm={run} onClose={() => setConfirm(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------ suppression en masse */

const MOT = 'SUPPRIMER';

function DeleteCard({ dbId }: { dbId: string }) {
  const ref = useReferentials(dbId);
  const accounts = useAccounts(dbId, true);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [keepChecked, setKeepChecked] = useState(true);
  const [includeTransfers, setIncludeTransfers] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const spec = {
    dbId, accountId: accountId || undefined, from: from || undefined, to: to || undefined,
    categoryId: categoryId || undefined, payeeId: payeeId || undefined, keepChecked, includeTransfers,
  };
  const picked = useLiveQuery(() => selectForDeletion(spec),
    [dbId, accountId, from, to, categoryId, payeeId, keepChecked, includeTransfers], []) ?? [];
  // Un virement compte pour une seule suppression (ses deux écritures partent ensemble).
  const count = new Set(picked.map(o => o.transferId ?? o.id)).size;
  const hasCriteria = !!(accountId || from || to || categoryId || payeeId);

  async function run() {
    try {
      const n = await deleteOperations(spec);
      setMsg({ ok: true, text: `${plural(n, 'opération supprimée', 'opérations supprimées')}.` });
      setTyped('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="card">
      <strong>Supprimer des opérations en masse</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
        Supprime toutes les opérations qui correspondent aux critères. Les soldes se recalculent aussitôt ; seule
        une sauvegarde exportée permet de les récupérer.
      </p>
      <div className="grid two">
        <div className="field"><label htmlFor="dl-acc">Compte</label>
          <select id="dl-acc" value={accountId} onChange={e => { setAccountId(e.target.value); setMsg(null); }}>
            <option value="">Tous les comptes</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="dl-cat">Catégorie</label>
          <select id="dl-cat" value={categoryId} onChange={e => { setCategoryId(e.target.value); setMsg(null); }}>
            <option value="">Toutes</option>
            {ref.cats.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="dl-d1">Du</label>
          <input id="dl-d1" type="date" value={from} onChange={e => { setFrom(e.target.value); setMsg(null); }} /></div>
        <div className="field"><label htmlFor="dl-d2">Au</label>
          <input id="dl-d2" type="date" value={to} onChange={e => { setTo(e.target.value); setMsg(null); }} /></div>
        <div className="field"><label htmlFor="dl-pay">Tiers</label>
          <select id="dl-pay" value={payeeId} onChange={e => { setPayeeId(e.target.value); setMsg(null); }}>
            <option value="">Tous</option>
            {ref.payees.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={keepChecked} onChange={e => setKeepChecked(e.target.checked)} />
        Garder les opérations pointées (rapprochées avec un relevé)
      </label>
      <label className="inline-check">
        <input type="checkbox" checked={includeTransfers} onChange={e => setIncludeTransfers(e.target.checked)} />
        Inclure les virements entre comptes (leurs deux écritures sont supprimées)
      </label>
      <p role="status" style={{ margin: '4px 0' }}>
        {count === 0 ? 'Aucune opération ne correspond.' : `${plural(count, 'opération sera supprimée', 'opérations seront supprimées')}.`}
        {!hasCriteria && count > 0 && <strong style={{ color: 'var(--red)' }}> Aucun critère : TOUTES les opérations sont visées.</strong>}
      </p>
      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="dl-typed">Pour confirmer, tapez {MOT}</label>
          <input id="dl-typed" value={typed} autoComplete="off" onChange={e => setTyped(e.target.value)} /></div>
        <button className="btn" disabled={count === 0 || typed.trim() !== MOT} onClick={run}>Supprimer</button>
      </div>
      <Result msg={msg} />
    </div>
  );
}
