import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { KIND_LABEL, KIND_ORDER, MIN_QUERY, globalSearch, type SearchHit, type SearchKind } from '../services/searchService';
import { formatFr } from '../utils/date';
import { formatEur } from '../utils/money';

const DEBOUNCE_MS = 150;

/** Recherche globale (Ctrl+K) : opérations, comptes, tiers, catégories, titres, tâches, échéances, biens et projets. */
export function GlobalSearch({ dbId, onClose }: { dbId: string; onClose: () => void }) {
  const setScreen = useStore(s => s.setScreen);
  const setPendingFocus = useStore(s => s.setPendingFocus);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'' | SearchKind>('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const listId = useId();
  const first = useRef<HTMLButtonElement>(null);

  // Recherche différée, et la réponse d'une frappe périmée est ignorée : sans cela,
  // une réponse lente pouvait écraser celle de la saisie suivante.
  const tooShort = query.trim().length < MIN_QUERY;
  useEffect(() => {
    if (tooShort) return;
    let obsolete = false;
    const t = setTimeout(() => {
      globalSearch(dbId, query, { kinds: kind ? [kind] : undefined })
        .then(r => { if (!obsolete) setHits(r); })
        .catch(() => { if (!obsolete) setHits([]); });
    }, DEBOUNCE_MS);
    return () => { obsolete = true; clearTimeout(t); };
  }, [dbId, query, kind, tooShort]);

  // Trop court : on n'affiche rien, même si des résultats d'une saisie précédente traînent encore.
  const shown = tooShort ? null : hits;
  const groups = useMemo(() => KIND_ORDER
    .map(k => ({ kind: k, items: (shown ?? []).filter(h => h.kind === k) }))
    .filter(g => g.items.length > 0), [shown]);

  function open(h: SearchHit) {
    // Une opération s'ouvre dans l'écran Opérations, au mois voulu et déjà filtrée.
    if (h.kind === 'operation') setPendingFocus({ search: query.trim(), date: h.date });
    setScreen(h.screen);
    onClose();
  }

  return (
    <Modal title="Rechercher" onClose={onClose} width={640}>
      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div className="field grow"><label htmlFor="gs-q">Rechercher dans toute la base</label>
          <input id="gs-q" value={query} autoFocus autoComplete="off" role="searchbox" aria-controls={listId}
            placeholder="Libellé, tiers, catégorie, montant (42,50), date (25/10/2026)…"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); first.current?.focus(); } }} /></div>
        <div className="field"><label htmlFor="gs-kind">Dans</label>
          <select id="gs-kind" value={kind} onChange={e => setKind(e.target.value as '' | SearchKind)}>
            <option value="">Tout</option>
            {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
      </div>

      <p role="status" className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
        {shown === null ? `Tapez au moins ${MIN_QUERY} caractères.`
          : shown.length === 0 ? 'Aucun résultat.'
          : `${shown.length} résultat${shown.length > 1 ? 's' : ''}.`}
      </p>

      <div id={listId} style={{ maxHeight: '52vh', overflow: 'auto' }}>
        {groups.map((g, gi) => (
          <section key={g.kind} aria-label={KIND_LABEL[g.kind]}>
            <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', margin: '10px 0 4px' }}>
              {KIND_LABEL[g.kind]}
            </h3>
            {g.items.map((h, i) => (
              <button key={`${h.kind}:${h.id}`} ref={gi === 0 && i === 0 ? first : undefined} className="base-item"
                style={{ width: '100%', textAlign: 'left' }} onClick={() => open(h)}>
                <span style={{ flex: 1 }}>
                  <strong>{h.title}</strong>
                  {h.detail && <span className="muted" style={{ display: 'block', fontSize: 12 }}>{h.detail}</span>}
                </span>
                {h.date && <span className="muted" style={{ fontSize: 12, marginRight: 10 }}>{formatFr(h.date)}</span>}
                {h.amountCents !== undefined && (
                  <span className={h.amountCents < 0 ? 'neg' : ''} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatEur(h.amountCents)}</span>
                )}
              </button>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
