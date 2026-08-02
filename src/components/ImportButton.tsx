import { useRef, useState } from 'react';
import { backupService, type Backup, type BackupSummary } from '../services/backupService';
import { useStore } from '../store/useStore';
import { Modal } from './Modal';

/**
 * Import d'une sauvegarde, précédé d'une confirmation détaillée.
 *
 * Correction P2 : l'ancien bouton restaurait le fichier immédiatement — il
 * supprimait puis réécrivait toutes les tables de la base, sans confirmation,
 * sans copie de sécurité et sans vérifier la version du fichier. Ce bouton étant
 * présent dans la barre d'actions de tous les écrans, un clic malencontreux
 * suffisait à écraser les saisies non exportées.
 */
export function ImportButton({ label = 'Importer' }: { label?: string }) {
  const setActiveDbId = useStore(s => s.setActiveDbId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: Backup; summary: BackupSummary } | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    try {
      setPending(await backupService.inspect(await file.text()));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await backupService.restore(pending.backup, mode);
      setActiveDbId(pending.backup.database.id);
      setDone(mode === 'merge' ? 'Sauvegarde fusionnée.' : 'Sauvegarde restaurée.');
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="act" onClick={() => inputRef.current?.click()}>
        <span className="ic" aria-hidden="true">⬇️</span>{label}
      </button>
      <input ref={inputRef} type="file" accept=".cbjson,.json" style={{ display: 'none' }}
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = '';           // permet de réimporter le même fichier
          if (f) await onFile(f);
        }} />

      {error && (
        <Modal title="Import impossible" onClose={() => setError(null)} width={460}>
          <p role="alert">{error}</p>
          <div className="row"><span />
            <button className="btn" onClick={() => setError(null)}>Fermer</button></div>
        </Modal>
      )}

      {done && (
        <Modal title="Import terminé" onClose={() => setDone(null)} width={420}>
          <p role="status">{done}</p>
          <div className="row"><span />
            <button className="btn" onClick={() => setDone(null)}>Fermer</button></div>
        </Modal>
      )}

      {pending && (
        <Modal title="Confirmer l’import" onClose={() => setPending(null)} width={560}>
          <table className="simple" style={{ marginBottom: 14 }}>
            <tbody>
              <tr><td className="muted">Base contenue dans le fichier</td>
                <td><strong>{pending.summary.databaseName}</strong></td></tr>
              <tr><td className="muted">Exportée le</td>
                <td>{new Date(pending.summary.exportedAt).toLocaleString('fr-FR')}</td></tr>
              <tr><td className="muted">Contenu</td>
                <td>{pending.summary.operations} opération(s) · {pending.summary.accounts} compte(s)</td></tr>
              {pending.summary.needsUpgrade && (
                <tr><td className="muted">Format</td>
                  <td>version {pending.summary.version} — sera converti automatiquement</td></tr>
              )}
            </tbody>
          </table>

          {pending.summary.isKnownBase ? (
            <fieldset className="fs">
              <legend>Cette base existe déjà sur cet appareil</legend>
              <label className="radio-row">
                <input type="radio" name="import-mode" checked={mode === 'merge'}
                  onChange={() => setMode('merge')} />
                <span><strong>Fusionner</strong> (recommandé) — pour chaque enregistrement, la
                  modification la plus récente est conservée. Aucune saisie faite sur cet
                  appareil n’est perdue.</span>
              </label>
              <label className="radio-row">
                <input type="radio" name="import-mode" checked={mode === 'replace'}
                  onChange={() => setMode('replace')} />
                <span><strong>Remplacer</strong> — le contenu local de cette base est effacé puis
                  remplacé par celui du fichier.</span>
              </label>
            </fieldset>
          ) : (
            <p className="muted">Cette base n’existe pas encore sur cet appareil : elle sera ajoutée
              sans toucher à vos autres profils.</p>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Une copie de sécurité de l’état actuel est téléchargée automatiquement avant l’opération.
          </p>

          <div className="row">
            <button className="btn ghost" onClick={() => setPending(null)}>Annuler</button>
            <button className="btn" onClick={confirm} disabled={busy}>
              {busy ? 'Import en cours…' : 'Importer'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
