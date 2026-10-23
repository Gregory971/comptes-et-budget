// Pont entre la page et le processus principal : deux actions, rien de plus.
//
// La page tourne sans accès à Node (contextIsolation, sandbox). Elle ne reçoit que
// ces deux fonctions, qui ne font passer que du texte : le processus principal
// revérifie tout (origine de l'appelant, type et contenu des paramètres, chemin, existence).
// Aucune conversion ici : une valeur qui n'est pas du texte doit être REFUSÉE, pas convertie
// en « [object Object] » et écrite quand même.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('comptesBudget', Object.freeze({
  desktop: true,
  /** Boîte de dialogue « Ouvrir » : renvoie le chemin choisi, ou null si l'utilisateur annule. */
  pickFile: () => ipcRenderer.invoke('cb:pick-file'),
  /** Ouvre un document lié avec le programme associé : { ok } ou { ok: false, error }. */
  openPath: (chemin) => ipcRenderer.invoke('cb:open-path', chemin),
  /** Dossier des sauvegardes automatiques de cet ordinateur, ou null s'il n'est pas choisi. */
  backupFolder: () => ipcRenderer.invoke('cb:backup-folder'),
  chooseBackupFolder: () => ipcRenderer.invoke('cb:backup-choose-folder'),
  forgetBackupFolder: () => ipcRenderer.invoke('cb:backup-forget'),
  /** Écrit « base_AAAA-MM-JJ.cbjson » dans ce dossier, puis ne garde que les 10 plus récentes. */
  writeBackup: (nom, contenu) => ipcRenderer.invoke('cb:backup-write', nom, contenu),
  /** Sauvegarde .cbjson ouverte depuis l'explorateur : { name, content }, ou null ; remise une seule fois. */
  takePendingBackup: () => ipcRenderer.invoke('cb:take-pending-backup'),
  /** Appelé quand un autre double-clic arrive pendant que l'application tourne ; renvoie la fonction qui se désabonne. */
  onBackupOpened: (rappel) => {
    if (typeof rappel !== 'function') return () => {};
    const ecouteur = () => rappel();
    ipcRenderer.on('cb:backup-opened', ecouteur);
    return () => ipcRenderer.removeListener('cb:backup-opened', ecouteur);
  },
}));
