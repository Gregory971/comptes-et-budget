import { useEffect, useState } from 'react';
import { ImportButton } from './ImportButton';
import { getBridge } from '../utils/desktopBridge';

/**
 * Sauvegarde .cbjson ouverte depuis l'explorateur (double-clic, « Ouvrir avec »).
 *
 * Édition bureau seulement. Le processus principal a lu le fichier ; on le fait passer
 * par la confirmation d'import habituelle — résumé du contenu, fusion ou remplacement,
 * phrase secrète si besoin, copie de sécurité préalable. Rien n'est jamais restauré
 * sans que l'utilisateur ait confirmé. Monté sous le verrou d'accès : une sauvegarde
 * ouverte avant la connexion attend que l'utilisateur soit connecté.
 */
export function OpenedBackup() {
  const bridge = getBridge();
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let vivant = true;
    const prendre = async () => {
      const p = await bridge.takePendingBackup();
      if (vivant && p) setFile(new File([p.content], p.name, { type: 'application/json' }));
    };
    void prendre();
    // Un autre double-clic pendant que l'application tourne.
    const seDesabonner = bridge.onBackupOpened(() => { void prendre(); });
    return () => { vivant = false; seDesabonner(); };
  }, [bridge]);

  if (!bridge) return null;
  return <ImportButton hideButton externalFile={file} onExternalHandled={() => setFile(null)} />;
}
