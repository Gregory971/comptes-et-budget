import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { oneDriveService, type OneDriveStatus } from '../services/oneDriveService';
import { backupService, type Backup, type BackupSummary } from '../services/backupService';
import { isEncrypted } from '../services/cryptoService';
import { useStore } from '../store/useStore';
import { formatBytes } from '../services/storageService';
import type { RemoteFile } from '../onedrive/protocol';
import type { Database } from '../types';

/**
 * Sauvegarde vers OneDrive par l'API Microsoft Graph.
 *
 * Fonction volontairement DÉSACTIVÉE par défaut : elle est la seule de
 * l'application à faire sortir des données de l'appareil. L'activer charge une
 * passerelle — un document séparé, seul autorisé par sa propre politique de
 * sécurité à joindre Microsoft. Tant qu'elle reste éteinte, aucune requête
 * n'est possible, et le document de l'application conserve « connect-src
 * 'none' » dans tous les cas.
 */
export function OneDrivePanel({ database }: { database: Database }) {
  const setActiveDbId = useStore(s => s.setActiveDbId);
  const [etat, setEtat] = useState<OneDriveStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [avance, setAvance] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fichiers, setFichiers] = useState<RemoteFile[] | null>(null);
  const [aRestaurer, setARestaurer] = useState<
    { backup: Backup; summary: BackupSummary; name: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  useEffect(() => {
    void oneDriveService.status().then(s => { setEtat(s); setClientId(s.clientId); });
  }, []);

  // L'état réel de la connexion demande de charger la passerelle : on ne le
  // fait qu'une fois la fonction activée, jamais à l'ouverture de l'écran.
  useEffect(() => {
    if (etat?.enabled && etat.supported) void oneDriveService.probe().then(setEtat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat?.enabled]);

  async function faire(nom: string, action: () => Promise<string | void>) {
    setBusy(nom); setErreur(null); setMsg(null);
    try {
      const r = await action();
      if (typeof r === 'string') setMsg(r);
      setEtat(await oneDriveService.status());
    } catch (e) {
      setErreur((e as Error).message);
      setEtat(await oneDriveService.status());
    } finally {
      setBusy(null);
    }
  }

  if (!etat) return <p className="muted">Chargement…</p>;

  if (!etat.supported) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Indisponible dans le fichier autonome : une connexion Microsoft exige une
        adresse web déclarée à l’avance, ce qu’un fichier ouvert depuis
        l’explorateur ne peut pas fournir. Utilisez la version en ligne, ou la
        sauvegarde automatique vers un dossier ci-dessus.
      </p>
    );
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Envoie la sauvegarde <strong>directement dans votre OneDrive</strong>, sans
        passer par le dossier synchronisé — utile depuis un téléphone ou un
        ordinateur où OneDrive n’est pas installé. C’est la seule fonction de
        l’application qui fasse sortir des données de l’appareil : elle est donc
        éteinte par défaut, et tout passe par une <strong>passerelle isolée</strong>,
        seul document autorisé à joindre Microsoft. L’autorisation demandée
        (<code>Files.ReadWrite.AppFolder</code>) ne donne accès qu’à un dossier créé
        pour l’application — le reste de votre OneDrive lui reste invisible.
      </p>

      <div className="inline" style={{ marginTop: 10 }}>
        {etat.enabled ? (
          <button className="btn ghost" disabled={busy !== null}
            onClick={() => faire('off', async () => {
              await oneDriveService.disable();
              return 'Sauvegarde OneDrive désactivée.';
            })}>Désactiver OneDrive</button>
        ) : (
          <button className="btn" disabled={busy !== null}
            onClick={() => faire('on', async () => {
              await oneDriveService.enable(clientId);
              return 'OneDrive activé : connectez maintenant votre compte Microsoft.';
            })}>Activer OneDrive</button>
        )}
      </div>

      {etat.enabled && (
        <>
          <table className="simple" style={{ maxWidth: 520, marginTop: 12 }}>
            <tbody>
              <tr><td className="muted">Compte Microsoft</td>
                <td>{etat.connected
                  ? <strong>{etat.account ?? 'connecté'}</strong>
                  : 'aucun — connexion requise'}</td></tr>
              {etat.lastRunAt && (
                <tr><td className="muted">Dernier envoi</td>
                  <td>{new Date(etat.lastRunAt).toLocaleString('fr-FR')}</td></tr>
              )}
              {etat.lastError && (
                <tr><td className="muted">Dernière erreur</td>
                  <td style={{ color: 'var(--red)' }}>{etat.lastError}</td></tr>
              )}
            </tbody>
          </table>

          <div className="inline" style={{ marginTop: 10 }}>
            {!etat.connected ? (
              <button className="btn" disabled={busy !== null}
                onClick={() => faire('connect', async () => {
                  const r = await oneDriveService.connect();
                  setEtat(await oneDriveService.probe());
                  return `Compte ${r.account ?? 'Microsoft'} connecté.`;
                })}>
                {busy === 'connect' ? 'Connexion en cours…' : '🔗 Connecter mon compte Microsoft'}
              </button>
            ) : (
              <>
                <button className="btn" disabled={busy !== null}
                  onClick={() => faire('send', async () => {
                    const r = await oneDriveService.send(database.name);
                    return `Sauvegarde envoyée : ${r.name}`;
                  })}>
                  {busy === 'send' ? 'Envoi en cours…' : '⬆️ Envoyer maintenant'}
                </button>
                <button className="btn ghost" disabled={busy !== null}
                  onClick={() => faire('list', async () => {
                    setFichiers(await oneDriveService.list());
                  })}>
                  {busy === 'list' ? 'Lecture…' : '⬇️ Restaurer depuis OneDrive'}
                </button>
                <button className="btn ghost" disabled={busy !== null}
                  onClick={() => faire('logout', async () => {
                    await oneDriveService.disconnect();
                    setEtat(await oneDriveService.probe());
                    return 'Compte Microsoft déconnecté.';
                  })}>Déconnecter</button>
              </>
            )}
          </div>

          <details style={{ marginTop: 10 }} open={avance}
            onToggle={e => setAvance((e.target as HTMLDetailsElement).open)}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Identifiant d’application</summary>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Identifiant public de l’application inscrite auprès de Microsoft. À ne
              changer que si vous déployez votre propre copie avec votre propre
              inscription.
            </p>
            <div className="inline">
              <div className="field grow"><label htmlFor="od-client">Identifiant client</label>
                <input id="od-client" value={clientId} onChange={e => setClientId(e.target.value)} /></div>
              <button className="btn ghost" disabled={busy !== null || clientId === etat.clientId}
                onClick={() => faire('client', async () => {
                  await oneDriveService.enable(clientId);
                  return 'Identifiant enregistré.';
                })}>Enregistrer</button>
            </div>
          </details>
        </>
      )}

      {msg && <p className="muted" role="status" style={{ marginTop: 8 }}>✓ {msg}</p>}
      {erreur && <p role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{erreur}</p>}

      {fichiers && (
        <Modal title="Sauvegardes présentes dans OneDrive" onClose={() => setFichiers(null)} width={620}>
          {fichiers.length === 0 ? (
            <p className="muted">Aucune sauvegarde dans le dossier de l’application.</p>
          ) : (
            <table className="simple">
              <thead><tr><th>Fichier</th><th>Modifié le</th>
                <th style={{ textAlign: 'right' }}>Taille</th><th /></tr></thead>
              <tbody>
                {fichiers.map(f => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td className="muted">{f.modifiedAt
                      ? new Date(f.modifiedAt).toLocaleString('fr-FR') : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatBytes(f.size)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn ghost" style={{ padding: '4px 10px' }}
                        disabled={busy !== null}
                        onClick={() => faire('get', async () => {
                          const texte = await oneDriveService.fetchBackup(f.name);
                          if (isEncrypted(texte)) {
                            throw new Error('Cette sauvegarde est chiffrée : restaurez-la par « Importer une sauvegarde », qui demandera la phrase secrète.');
                          }
                          setARestaurer({ ...(await backupService.inspect(texte)), name: f.name });
                          setFichiers(null);
                        })}>Restaurer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ marginTop: 12 }}><span />
            <button className="btn" onClick={() => setFichiers(null)}>Fermer</button></div>
        </Modal>
      )}

      {aRestaurer && (
        <Modal title="Restaurer depuis OneDrive" onClose={() => setARestaurer(null)} width={560}>
          <table className="simple" style={{ marginBottom: 14 }}>
            <tbody>
              <tr><td className="muted">Fichier</td><td><strong>{aRestaurer.name}</strong></td></tr>
              <tr><td className="muted">Base contenue</td>
                <td>{aRestaurer.summary.databaseName}</td></tr>
              <tr><td className="muted">Exportée le</td>
                <td>{new Date(aRestaurer.summary.exportedAt).toLocaleString('fr-FR')}</td></tr>
              <tr><td className="muted">Contenu</td>
                <td>{aRestaurer.summary.operations} opération(s) · {aRestaurer.summary.accounts} compte(s)</td></tr>
            </tbody>
          </table>
          <fieldset className="fs">
            <legend>Mode de restauration</legend>
            <label className="radio-row">
              <input type="radio" name="od-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span><strong>Fusionner</strong> (recommandé) — pour chaque enregistrement, la
                modification la plus récente est conservée.</span>
            </label>
            <label className="radio-row">
              <input type="radio" name="od-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span><strong>Remplacer</strong> — le contenu local de cette base est effacé.</span>
            </label>
          </fieldset>
          <p className="muted" style={{ fontSize: 12 }}>
            Une copie de sécurité de l’état actuel est téléchargée avant l’opération.
          </p>
          <div className="row">
            <button className="btn ghost" onClick={() => setARestaurer(null)}>Annuler</button>
            <button className="btn" disabled={busy !== null}
              onClick={() => faire('restore', async () => {
                await backupService.restore(aRestaurer.backup, mode);
                setActiveDbId(aRestaurer.backup.database.id);
                setARestaurer(null);
                return mode === 'merge' ? 'Sauvegarde fusionnée.' : 'Sauvegarde restaurée.';
              })}>Restaurer</button>
          </div>
        </Modal>
      )}
    </>
  );
}
