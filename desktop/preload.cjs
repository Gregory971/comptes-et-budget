// Pont entre la page et le processus principal : deux actions, rien de plus.
//
// La page tourne sans accès à Node (contextIsolation, sandbox). Elle ne reçoit que
// ces deux fonctions, qui ne font passer que du texte : le processus principal
// revérifie tout (origine de l'appelant, chemin, existence, type de fichier).

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('comptesBudget', Object.freeze({
  desktop: true,
  /** Boîte de dialogue « Ouvrir » : renvoie le chemin choisi, ou null si l'utilisateur annule. */
  pickFile: () => ipcRenderer.invoke('cb:pick-file'),
  /** Ouvre un document lié avec le programme associé : { ok } ou { ok: false, error }. */
  openPath: (chemin) => ipcRenderer.invoke('cb:open-path', String(chemin)),
}));
