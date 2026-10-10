// Passerelle OneDrive — SEUL document de l'application autorisé à joindre le
// réseau.
//
// Le document principal porte « connect-src 'none' » : ni fetch, ni WebSocket,
// ni balise de mesure ne peuvent en sortir, et cela reste vrai après cette
// version. Cette page-ci, servie depuis la même origine mais avec sa propre
// politique de sécurité, n'autorise que login.microsoftonline.com,
// graph.microsoft.com et les hôtes de téléchargement de OneDrive. Elle ne
// contient aucune logique de comptes : elle reçoit un contenu déjà sérialisé,
// l'envoie, et rapporte le résultat.
//
// Ce fichier n'est que la COLLE avec le navigateur (fenêtres, postMessage,
// stockages). Toute la logique — jetons, reprises, rotation — vit dans
// `gatewayCore.ts`, qui s'éprouve de bout en bout contre un faux serveur.
//
// Deux emplois du même fichier :
//  · fenêtre surgissante, pour la connexion — Microsoft interdit l'affichage
//    de sa page de connexion dans une iframe (X-Frame-Options) ;
//  · iframe masquée, pour les envois suivants, sans aucune interaction.

import { createGatewayCore, routeOf } from './gatewayCore';
import { CONNECT_CHANNEL, NS, isOrder, type Answer, type ConnectEvent } from './protocol';

/** URI de redirection : cette page même, sans paramètre ni ancre. */
const redirectUri = (): string => location.origin + location.pathname;

const dire = (texte: string) => {
  const el = document.getElementById('etat');
  if (el) el.textContent = texte;
};

const core = createGatewayCore({
  // Fonction fléchée : un `fetch` détaché de `window` lèverait « Illegal invocation ».
  fetch: (url, init) => fetch(url, init),
  local: localStorage,
  session: sessionStorage,
  redirectUri,
});

/** Ouvre la page de connexion Microsoft dans CETTE fenêtre (la surgissante). */
async function demarrerConnexion(clientId: string) {
  dire('Ouverture de la connexion Microsoft…');
  location.assign(await core.commencerConnexion(clientId));
}

/** Prévient l'application, par deux voies : le lien d'ouverture et le canal de diffusion. */
function prevenir(m: ConnectEvent) {
  try {
    window.opener?.postMessage(m, location.origin);
  } catch {
    // Fenêtre parente fermée entre-temps : l'état reste lisible au prochain
    // démarrage, la connexion n'est pas perdue pour autant.
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const canal = new BroadcastChannel(CONNECT_CHANNEL);
      canal.postMessage(m);
      canal.close();
    }
  } catch { /* canal indisponible : le lien d'ouverture suffit dans le cas courant */ }
}

/** Termine la connexion au retour de Microsoft, puis referme la fenêtre. */
async function terminerConnexion() {
  try {
    const { account } = await core.terminerConnexion(location.search);
    dire('Compte Microsoft connecté. Cette fenêtre peut être fermée.');
    prevenir({ ns: NS, event: 'connected', account });
  } catch (e) {
    dire(`Connexion impossible : ${(e as Error).message}`);
    prevenir({ ns: NS, event: 'connect-failed', error: (e as Error).message });
    return; // fenêtre laissée ouverte : le message d'erreur doit rester lisible
  }
  setTimeout(() => window.close(), 1200);
}

function ecouterLesOrdres() {
  dire('Passerelle prête.');
  window.addEventListener('message', async (e: MessageEvent) => {
    // Deux vérifications indispensables : l'origine (aucun autre site ne peut
    // commander la passerelle) et la présence du marqueur de protocole.
    if (e.origin !== location.origin || !isOrder(e.data)) return;
    const ordre = e.data;
    const repondre = (a: Answer) => (e.source as Window | null)?.postMessage(a, location.origin);
    try {
      repondre({ ns: NS, id: ordre.id, ok: true, result: await core.executer(ordre) });
    } catch (err) {
      repondre({ ns: NS, id: ordre.id, ok: false, error: (err as Error).message });
    }
  });
  // L'application attend ce signal avant d'envoyer quoi que ce soit : une
  // iframe qui n'a pas fini de charger perdrait silencieusement les ordres.
  try {
    if (window.parent !== window) {
      window.parent.postMessage({ ns: NS, event: 'ready' } as ConnectEvent, location.origin);
    }
  } catch { /* pas de parent accessible : page ouverte seule */ }
}

async function demarrer() {
  const route = routeOf(location.search, location.hash);
  if (route.kind === 'complete') return terminerConnexion();
  if (route.kind === 'connect') return demarrerConnexion(route.clientId);
  ecouterLesOrdres();
}

void demarrer();
