import { useState } from 'react';
import { baseName, documentKind, MAX_DOCUMENTS, validateDocument } from '../utils/documents';
import { getBridge, openDocument } from '../utils/desktopBridge';
import type { DocumentLink } from '../types';

/**
 * Documents liés à une opération : chemins de fichiers ou liens https.
 *
 * On retient OÙ trouver le document, pas son contenu : la base reste légère et la
 * sauvegarde ne grossit pas. Dans l'édition bureau, « Choisir un fichier » ouvre la
 * boîte de dialogue du système ; dans le navigateur, qui ne révèle pas les chemins,
 * on saisit le lien ou le chemin complet.
 */
export function DocumentsField({ docs, onChange }: { docs: DocumentLink[]; onChange: (docs: DocumentLink[]) => void }) {
  const bridge = getBridge();
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(next: DocumentLink) {
    const problem = validateDocument(next);
    if (problem) { setError(problem); return; }
    if (docs.length >= MAX_DOCUMENTS) { setError(`Une opération accepte ${MAX_DOCUMENTS} documents au plus.`); return; }
    onChange([...docs, { label: next.label.trim() || baseName(next.path), path: next.path.trim() }]);
    setLabel(''); setPath(''); setError(null);
  }

  async function choose() {
    if (!bridge) return;
    setError(null);
    const chosen = await bridge.pickFile();
    if (chosen) add({ label: label.trim(), path: chosen });
  }

  async function open(d: DocumentLink) {
    setError(null);
    const r = await openDocument(d.path);
    if (!r.ok) setError(r.error ?? 'Ouverture impossible.');
  }

  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', margin: '8px 0' }}>
      <legend style={{ padding: '0 6px', fontSize: 13 }}>Documents liés</legend>

      {docs.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
          {docs.map((d, i) => (
            <li key={`${d.path}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span aria-hidden="true">{documentKind(d.path) === 'lien' ? '🔗' : '📎'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{d.label}</strong>
                <span className="muted" title={d.path} style={{ display: 'block', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.path}</span>
              </span>
              <button type="button" className="btn ghost" aria-label={`Ouvrir le document ${d.label}`} onClick={() => open(d)}>Ouvrir</button>
              <button type="button" className="iconbtn" aria-label={`Retirer le document ${d.label}`}
                onClick={() => onChange(docs.filter((_, k) => k !== i))}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="inline" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 160 }}><label htmlFor="doc-label">Nom (facultatif)</label>
          <input id="doc-label" value={label} maxLength={60} placeholder="Facture" onChange={e => setLabel(e.target.value)} /></div>
        <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="doc-path">Chemin du fichier ou lien https</label>
          <input id="doc-path" value={path} maxLength={500} placeholder="C:\Documents\facture.pdf"
            onChange={e => setPath(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add({ label, path }); } }} /></div>
        <button type="button" className="btn ghost" onClick={() => add({ label, path })} disabled={!path.trim()}>Associer</button>
        {bridge && <button type="button" className="btn ghost" onClick={choose}>Choisir un fichier…</button>}
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '6px 0 0' }}>{error}</p>}
    </fieldset>
  );
}
