// Comptes et Budget — édition bureau.
//
// Coque Electron minimale autour de l'application web : aucune logique métier
// ici. Les données restent dans IndexedDB, dans le profil de l'utilisateur
// (%APPDATA%\Comptes et Budget) ; rien ne quitte l'appareil.
//
// Choix de sécurité :
//  · l'application est servie par un protocole privé `cb://app/…` plutôt que
//    par file:// — IndexedDB y a une origine stable, qui ne dépend pas du
//    dossier d'installation, et les chemins de fichiers restent confinés ;
//  · aucun accès Node dans la page (contextIsolation, sandbox) ;
//  · navigation hors de l'application, ouverture de fenêtres et permissions du
//    navigateur refusées par défaut ; la CSP de la page (connect-src 'none')
//    s'applique comme sur le site publié.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { refusalForPath } = require('./openPolicy.cjs');

const SCHEME = 'cb';
const HOST = 'app';
const RACINE = path.join(__dirname, 'app-dist');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Une seule instance : deux fenêtres sur la même base d'IndexedDB se
// disputeraient les écritures.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let fenetre = null;

// ---- Taille et position de la fenêtre, mémorisées d'une session à l'autre ----

const fichierEtat = () => path.join(app.getPath('userData'), 'fenetre.json');

function lireEtat() {
  try {
    const e = JSON.parse(fs.readFileSync(fichierEtat(), 'utf8'));
    if (Number.isFinite(e.width) && Number.isFinite(e.height)) return e;
  } catch { /* premier lancement ou fichier illisible */ }
  return { width: 1280, height: 820 };
}

function ecrireEtat(win) {
  try {
    if (win.isDestroyed()) return;
    const maximisee = win.isMaximized();
    const b = maximisee ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(fichierEtat(), JSON.stringify({ ...b, maximisee }));
  } catch { /* sans conséquence */ }
}

// ---- Protocole cb://app/… : sert le contenu de app-dist, rien d'autre ----

function installerProtocole() {
  protocol.handle(SCHEME, (requete) => {
    const url = new URL(requete.url);
    if (url.host !== HOST) return new Response('Hôte inconnu', { status: 404 });
    let chemin = decodeURIComponent(url.pathname);
    if (chemin === '/' || chemin === '') chemin = '/index.html';
    const complet = path.normalize(path.join(RACINE, chemin));
    // Confinement : le chemin résolu doit rester sous app-dist.
    if (complet !== RACINE && !complet.startsWith(RACINE + path.sep)) {
      return new Response('Accès refusé', { status: 403 });
    }
    return net.fetch(pathToFileURL(complet).toString());
  });
}

// ---- Documents liés : choisir un fichier, l'ouvrir ----
//
// Deux actions seulement, et chacune revérifie son appelant : un message IPC ne vaut
// que s'il vient de NOTRE page (cb://app), jamais d'une page chargée ailleurs.

function appelantAutorise(evenement) {
  const url = evenement.senderFrame && evenement.senderFrame.url;
  return typeof url === 'string' && url.startsWith(`${SCHEME}://${HOST}/`);
}

function installerPontDocuments() {
  ipcMain.handle('cb:pick-file', async (evenement) => {
    if (!appelantAutorise(evenement)) return null;
    const r = await dialog.showOpenDialog(fenetre ?? undefined, {
      title: 'Associer un document', properties: ['openFile'],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  ipcMain.handle('cb:open-path', async (evenement, chemin) => {
    if (!appelantAutorise(evenement)) return { ok: false, error: 'Appel refusé.' };
    const refus = refusalForPath(chemin);
    if (refus) return { ok: false, error: refus };
    try {
      if (!(await fs.promises.stat(chemin)).isFile()) return { ok: false, error: 'Ce chemin n’est pas un fichier.' };
    } catch {
      return { ok: false, error: 'Fichier introuvable : il a peut-être été déplacé ou renommé.' };
    }
    const erreur = await shell.openPath(chemin);   // chaîne vide quand tout va bien
    return erreur ? { ok: false, error: erreur } : { ok: true };
  });
}

function menuFrancais() {
  const modele = [
    {
      label: 'Fichier',
      submenu: [{ role: 'quit', label: 'Quitter' }],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
      ],
    },
  ];
  return Menu.buildFromTemplate(modele);
}

function creerFenetre() {
  const etat = lireEtat();
  fenetre = new BrowserWindow({
    width: etat.width,
    height: etat.height,
    x: etat.x,
    y: etat.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Comptes et Budget',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (etat.maximisee) fenetre.maximize();
  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.on('close', () => ecrireEtat(fenetre));
  fenetre.on('closed', () => { fenetre = null; });

  // La page ne quitte jamais l'application ; un lien externe s'ouvre dans le
  // navigateur du système, uniquement en https.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (evenement, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) evenement.preventDefault();
  });

  fenetre.loadURL(`${SCHEME}://${HOST}/index.html`);
}

app.on('second-instance', () => {
  if (!fenetre) return;
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.focus();
});

app.whenReady().then(() => {
  installerProtocole();
  installerPontDocuments();

  // Aucune permission accordée à la page (caméra, micro, position,
  // notifications…), hormis l'accès aux fichiers que l'utilisateur désigne lui-même
  // dans une boîte de dialogue (sauvegarde automatique dans un dossier choisi).
  const autorisee = (permission) => permission === 'fileSystem';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, rappel) => rappel(autorisee(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => autorisee(permission));

  Menu.setApplicationMenu(menuFrancais());
  creerFenetre();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

app.on('window-all-closed', () => app.quit());
