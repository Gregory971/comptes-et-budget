import { useState } from 'react';
import { Modal } from './Modal';
import { backupService } from '../services/backupService';
import { noteManualExport } from '../services/autoBackupService';

/**
 * Export de la sauvegarde, avec chiffrement facultatif.
 *
 * Le fichier est destiné à un dossier synchronisé : en clair, il expose tous
 * les comptes à qui accède au dossier. La phrase secrète n'est conservée nulle
 * part — l'avertissement le dit avant l'export, car une sauvegarde chiffrée
 * dont on a perdu la phrase ne se récupère pas.
 */
export function ExportButton({ className = 'act', label = 'Exporter' }: {
  className?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chiffrer, setChiffrer] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [phrase2, setPhrase2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function exporter() {
    setError(null);
    if (chiffrer) {
      if (phrase.length < 8) { setError('Choisissez une phrase secrète d’au moins 8 caractères.'); return; }
      if (phrase !== phrase2) { setError('Les deux phrases saisies diffèrent.'); return; }
    }
    setBusy(true);
    try {
      const nom = await backupService.download('', chiffrer ? phrase : undefined);
      await noteManualExport();
      setDone(nom);
      setPhrase(''); setPhrase2(''); setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        <span className="ic" aria-hidden="true">⬆️</span>{label}
      </button>

      {done && (
        <Modal title="Sauvegarde exportée" onClose={() => setDone(null)} width={460}>
          <p role="status">Fichier <strong>{done}</strong> téléchargé.</p>
          <p className="muted" style={{ fontSize: 13 }}>
            Déposez-le dans votre dossier « Google Drive pour ordinateur » pour le
            retrouver sur vos autres appareils.
          </p>
          <div className="row"><span />
            <button className="btn" onClick={() => setDone(null)}>Fermer</button></div>
        </Modal>
      )}

      {open && (
        <Modal title="Exporter la sauvegarde" onClose={() => setOpen(false)} width={520}>
          <label className="radio-row">
            <input type="checkbox" checked={chiffrer} onChange={e => setChiffrer(e.target.checked)} />
            <span><strong>Chiffrer le fichier</strong> avec une phrase secrète — recommandé si la
              sauvegarde part dans un dossier synchronisé (Google Drive, OneDrive, iCloud).</span>
          </label>

          {chiffrer && (
            <>
              <div className="field">
                <label htmlFor="ex-p1">Phrase secrète</label>
                <input id="ex-p1" type="password" value={phrase} autoComplete="new-password"
                  onChange={e => setPhrase(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ex-p2">Confirmation</label>
                <input id="ex-p2" type="password" value={phrase2} autoComplete="new-password"
                  onChange={e => setPhrase2(e.target.value)} />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                ⚠️ La phrase n’est enregistrée nulle part. Perdue, le fichier est
                définitivement illisible. Chiffrement AES-GCM 256 bits, clé dérivée
                par PBKDF2-SHA256 (600 000 itérations).
              </p>
            </>
          )}

          {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

          <div className="row">
            <button className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn" onClick={exporter} disabled={busy}>
              {busy ? 'Chiffrement en cours…' : 'Exporter'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
