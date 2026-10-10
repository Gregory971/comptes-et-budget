// Intégration de bout en bout de la passerelle OneDrive contre un FAUX serveur
// Microsoft tenu en mémoire (voir testing/fakeGraph.ts).
//
// Ce que ces tests prouvent : que le code de la passerelle, face à un serveur
// qui applique les règles d'OAuth et de Graph, fait ce qu'on attend — connexion
// PKCE, envoi, rotation, liste, restauration, rafraîchissement, limitation
// (429), perte réseau, déconnexion.
// Ce qu'ils NE prouvent PAS : que le vrai OneDrive se comporte comme le faux.
// Seul un essai avec un vrai compte le dit (voir docs/TEST-ONEDRIVE.md).

import { describe, expect, it } from 'vitest';
import { json } from './testing/fakeGraph';
import { CLE_COMPTE, CLE_REFRESH, routeOf } from './gatewayCore';
import { CLIENT, monde } from './testing/monde';

const DOSSIER = '/v1.0/me/drive/special/approot';
const jour = (n: number) => `Mes_comptes_2026-09-${String(n).padStart(2, '0')}.cbjson`;

describe('connexion (code d’autorisation + PKCE)', () => {
  it('obtient les jetons, retient le compte et ne garde que le jeton de rafraîchissement', async () => {
    const w = monde();
    expect(await w.etat()).toEqual({ connected: false, account: undefined });

    const r = await w.connecter();
    expect(r.account).toBe('gregory@exemple.test');
    expect(await w.etat()).toEqual({ connected: true, account: 'gregory@exemple.test' });

    // Aucun jeton d'accès sur disque, ni dans la session.
    const stocke = [...w.local.map.values(), ...w.session.map.values()].join('|');
    expect(stocke).not.toMatch(/at-\d+/);
    expect(w.local.map.get(CLE_REFRESH)).toMatch(/^rt-/);
    // Vérificateur et état à usage unique : effacés une fois la connexion terminée.
    expect(w.session.map.size).toBe(0);
    // Tout est passé par Microsoft, rien d'autre ; le faux serveur a refusé tout secret.
    expect(w.ms.requests.map(r => r.host)).toEqual(['login.microsoftonline.com']);
    expect(w.ms.cspViolations).toEqual([]);
  });

  it('rapporte un refus de consentement tel quel, sans rien retenir', async () => {
    const w = monde();
    const url = await w.core.commencerConnexion(CLIENT);
    await expect(w.core.terminerConnexion(w.ms.authorize(url, false))).rejects.toThrow(/AADSTS65004/);
    expect((await w.etat()).connected).toBe(false);
  });

  it('refuse un retour dont l’état a été falsifié, sans échanger le code', async () => {
    const w = monde();
    const url = await w.core.commencerConnexion(CLIENT);
    const retour = w.ms.authorize(url).replace(/state=.*/, 'state=forge');
    await expect(w.core.terminerConnexion(retour)).rejects.toThrow(/état invalide/);
    expect(w.ms.requests).toHaveLength(0);
  });

  it('refuse de rejouer un même retour (code à usage unique)', async () => {
    const w = monde();
    const url = await w.core.commencerConnexion(CLIENT);
    const retour = w.ms.authorize(url);
    await w.core.terminerConnexion(retour);
    await expect(w.core.terminerConnexion(retour)).rejects.toThrow(/état invalide/);
  });

  it('signale un vérificateur perdu (stockage de session vidé pendant la visite chez Microsoft)', async () => {
    const w = monde();
    const url = await w.core.commencerConnexion(CLIENT);
    const retour = w.ms.authorize(url);
    w.session.map.delete('cb-onedrive-verifier');
    await expect(w.core.terminerConnexion(retour)).rejects.toThrow(/Vérificateur PKCE introuvable/);
  });

  it('aiguille la page selon l’adresse d’ouverture', () => {
    expect(routeOf('?code=abc&state=x', '')).toEqual({ kind: 'complete' });
    expect(routeOf('?error=access_denied', '')).toEqual({ kind: 'complete' });
    expect(routeOf('', '#connect&client=abc')).toEqual({ kind: 'connect', clientId: 'abc' });
    expect(routeOf('', '#connect')).toEqual({ kind: 'listen' });
    expect(routeOf('', '')).toEqual({ kind: 'listen' });
  });
});

describe('sauvegarde', () => {
  it('dépose le fichier dans le dossier d’application, octet pour octet', async () => {
    const w = monde();
    await w.connecter();
    const contenu = JSON.stringify({ base: 'Comptes été 2026', note: 'é à ç — 💶' });
    const r = await w.envoyer(jour(1), contenu);

    expect(r).toMatchObject({ name: jour(1), pruned: [] });
    expect(w.ms.files.get(jour(1))?.content).toBe(contenu);
    expect(r.size).toBe(new TextEncoder().encode(contenu).length);
  });

  it('ne sort jamais du dossier d’application, ni des hôtes autorisés par la CSP', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}');
    await w.lister();
    await w.telecharger(jour(1));

    const graph = w.ms.requests.filter(r => r.host === 'graph.microsoft.com');
    expect(graph.length).toBeGreaterThan(0);
    for (const r of graph) expect(new URL(r.url).pathname.startsWith(DOSSIER)).toBe(true);
    expect(w.ms.cspViolations).toEqual([]);
    // Le téléchargement redirigé ne reçoit jamais le jeton d'accès.
    expect(w.ms.leakedAuth).toEqual([]);
  });

  it('écrase la copie du jour au lieu d’en créer une seconde', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{"v":1}');
    await w.envoyer(jour(1), '{"v":2}');
    expect(w.ms.files.size).toBe(1);
    expect(w.ms.files.get(jour(1))?.content).toBe('{"v":2}');
  });

  it('refuse un envoi sans compte connecté, sans toucher au réseau', async () => {
    const w = monde();
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/Aucun compte Microsoft connecté/);
    expect(w.ms.requests).toHaveLength(0);
  });
});

describe('copies datées et rotation (10 conservées)', () => {
  it('ne garde que les 10 plus récentes d’une même base', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 12; n++) await w.envoyer(jour(n), `{"jour":${n}}`);

    const noms = [...w.ms.files.keys()].sort();
    expect(noms).toHaveLength(10);
    expect(noms[0]).toBe(jour(3));
    expect(noms[noms.length - 1]).toBe(jour(12));
  });

  it('rapporte les copies supprimées', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 10; n++) await w.envoyer(jour(n), '{}');
    const r = await w.envoyer(jour(11), '{}');
    expect(r.pruned).toEqual([jour(1)]);
  });

  it('ne touche ni aux autres bases, ni aux fichiers étrangers, ni aux dossiers', async () => {
    const w = monde();
    w.ms.folders.push('Archives');
    await w.connecter();
    await w.envoyer('Autre_base_2025-01-01.cbjson', '{}');
    await w.envoyer('Autre_base_2025-01-02.cbjson', '{}');
    w.ms.files.set('notes.txt', { content: 'à moi', modifiedAt: 0 });
    w.ms.files.set('Mes_comptes_brouillon.cbjson', { content: 'x', modifiedAt: 0 });
    for (let n = 1; n <= 13; n++) await w.envoyer(jour(n), '{}');

    expect(w.ms.files.has('Autre_base_2025-01-01.cbjson')).toBe(true);
    expect(w.ms.files.has('Autre_base_2025-01-02.cbjson')).toBe(true);
    expect(w.ms.files.has('notes.txt')).toBe(true);
    expect(w.ms.files.has('Mes_comptes_brouillon.cbjson')).toBe(true);
    expect([...w.ms.files.keys()].filter(n => n.startsWith('Mes_comptes_2026'))).toHaveLength(10);
  });

  it('ne supprime jamais le fichier qu’on vient d’écrire, même si l’horloge a reculé', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 10; n <= 20; n++) await w.envoyer(jour(n), '{}'); // 11 copies → 10
    // Horloge de l'appareil en retard : le nouvel envoi est le PLUS ANCIEN par la date.
    const r = await w.envoyer(jour(1), '{"retard":true}');
    expect(w.ms.files.has(jour(1))).toBe(true);
    expect(r.pruned).not.toContain(jour(1));
  });

  it('ne fait aucune rotation sans consigne', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 12; n++) await w.envoyer(jour(n), '{}', 0);
    expect(w.ms.files.size).toBe(12);
  });

  it('une rotation en échec n’invalide pas la sauvegarde, et le dit', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 10; n++) await w.envoyer(jour(n), '{}');
    w.ms.inject(r => r.method === 'DELETE', () => json(403, { error: { code: 'accessDenied', message: 'Access denied' } }), 5);
    const r = await w.envoyer(jour(11), '{"ok":true}');
    expect(w.ms.files.get(jour(11))?.content).toBe('{"ok":true}');
    expect(r.pruneError).toMatch(/Accès refusé/);
  });

  it('tolère une copie déjà supprimée ailleurs (404 sur la suppression)', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 10; n++) await w.envoyer(jour(n), '{}');
    w.ms.inject(r => r.method === 'DELETE', () => json(404, { error: { code: 'itemNotFound', message: 'x' } }));
    const r = await w.envoyer(jour(11), '{}');
    expect(r.pruneError).toBeUndefined();
  });
});

describe('liste', () => {
  it('lit toutes les pages et ignore les sous-dossiers', async () => {
    const w = monde();
    w.ms.pageSize = 3;
    w.ms.folders.push('Archives');
    await w.connecter();
    for (let n = 1; n <= 8; n++) await w.envoyer(jour(n), '{}', 0);

    const noms = (await w.lister()).map(f => f.name);
    expect(noms).toHaveLength(8);
    expect(noms[0]).toBe(jour(8)); // plus récent d'abord
    expect(noms).not.toContain('Archives');
    expect((await w.lister())[0].modifiedAt).toMatch(/^2026-10-10T/);
  });

  it('renvoie une liste vide, sans erreur, tant que le dossier n’existe pas', async () => {
    const w = monde();
    await w.connecter();
    expect(await w.lister()).toEqual([]);
  });

  it('ne suit jamais une page suivante désignée vers un autre hôte', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}', 0);
    w.ms.inject(r => r.url.includes('/children'), () => json(200, {
      value: [{ name: jour(1), size: 2 }],
      '@odata.nextLink': 'https://pirate.exemple.test/volé',
    }));
    await w.lister();
    expect(w.ms.requests.some(r => r.host === 'pirate.exemple.test')).toBe(false);
  });
});

describe('restauration', () => {
  it('relit le contenu exact, par la redirection de téléchargement', async () => {
    const w = monde();
    await w.connecter();
    const contenu = JSON.stringify({ comptes: ['Livret A', 'Compte joint'], note: 'é — 💶' });
    await w.envoyer(jour(1), contenu);
    expect(await w.telecharger(jour(1))).toBe(contenu);
    expect(w.ms.requests.some(r => r.host === 'sg-by1.files.1drv.com')).toBe(true);
  });

  it('dit clairement qu’un fichier est introuvable', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}');
    await expect(w.telecharger('absent.cbjson')).rejects.toThrow(/introuvable/);
  });
});

describe('jeton expiré → rafraîchissement', () => {
  it('rafraîchit en silence à l’expiration et fait tourner le jeton de rafraîchissement', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}');
    const avant = w.local.map.get(CLE_REFRESH);

    w.ms.tick(2 * 3600 * 1000); // le jeton d'accès (1 h) est périmé
    await w.envoyer(jour(2), '{}');

    const refresh = w.ms.requests.filter(r => r.host === 'login.microsoftonline.com' && r.body?.includes('grant_type=refresh_token'));
    expect(refresh).toHaveLength(1);
    expect(w.local.map.get(CLE_REFRESH)).not.toBe(avant);
    expect(w.ms.files.has(jour(2))).toBe(true);
  });

  it('ne rafraîchit qu’une fois quand plusieurs ordres arrivent ensemble', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    await Promise.all([w.lister(), w.envoyer(jour(1), '{}', 0), w.lister()]);
    const refresh = w.ms.requests.filter(r => r.body?.includes('grant_type=refresh_token'));
    expect(refresh).toHaveLength(1);
  });

  it('rafraîchit puis réessaie une fois si Graph répond 401 à un jeton qu’il a révoqué', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}');
    w.ms.revokeAccessTokens(); // la passerelle croit encore son jeton valide
    await w.envoyer(jour(2), '{}');
    expect(w.ms.files.has(jour(2))).toBe(true);
  });

  it('n’insiste pas : un 401 persistant échoue après une seule nouvelle tentative', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.host === 'graph.microsoft.com', () => json(401, { error: { code: 'InvalidAuthenticationToken', message: 'x' } }), 10);
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/expirée/);
    expect(w.ms.requests.filter(r => r.host === 'graph.microsoft.com')).toHaveLength(2);
  });

  it('efface le jeton définitivement mort et demande de se reconnecter', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    w.ms.revokeRefreshTokens();
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/AADSTS70000/);
    expect(w.local.map.has(CLE_REFRESH)).toBe(false);
    expect((await w.etat()).connected).toBe(false);
  });

  it('explique l’expiration des 24 h d’une application monopage', async () => {
    const w = monde();
    w.ms.refreshLifetimeMs = 24 * 3600 * 1000;
    await w.connecter();
    w.ms.tick(25 * 3600 * 1000);
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/24 h.*reconnectez-vous/);
    expect((await w.etat()).connected).toBe(false);
  });

  it('GARDE le jeton de rafraîchissement lors d’une panne passagère du service d’authentification', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    w.ms.inject(r => r.host === 'login.microsoftonline.com',
      () => json(400, { error: 'temporarily_unavailable', error_description: 'AADSTS90033: service occupé' }));
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/AADSTS90033/);
    // Rien d'irréversible : l'utilisateur est toujours connecté et le prochain essai passe.
    expect(w.local.map.has(CLE_REFRESH)).toBe(true);
    expect(w.local.map.has(CLE_COMPTE)).toBe(true);
    await w.envoyer(jour(1), '{}');
    expect(w.ms.files.has(jour(1))).toBe(true);
  });

  it('GARDE le jeton de rafraîchissement quand le service d’authentification répond une page HTML', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    w.ms.inject(r => r.host === 'login.microsoftonline.com',
      () => new Response('<html>Bad gateway</html>', { status: 500 }));
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/momentanément indisponible \(code 500\)/);
    expect(w.local.map.has(CLE_REFRESH)).toBe(true);
  });

  it('GARDE le jeton de rafraîchissement quand le réseau tombe pendant le rafraîchissement', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    w.ms.offline = true;
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/Impossible de joindre Microsoft/);
    expect(w.local.map.has(CLE_REFRESH)).toBe(true);
    w.ms.offline = false;
    await w.envoyer(jour(1), '{}');
    expect(w.ms.files.has(jour(1))).toBe(true);
  });
});

describe('limitation (429) et pannes passagères', () => {
  const limite = (retry?: string) => () => json(429,
    { error: { code: 'TooManyRequests', message: 'Please retry again later.' } },
    retry ? { 'Retry-After': retry } : {});

  it('attend Retry-After puis réessaie', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'PUT', limite('7'), 2);
    await w.envoyer(jour(1), '{"ok":1}');
    expect(w.attentes).toEqual([7000, 7000]);
    expect(w.ms.files.get(jour(1))?.content).toBe('{"ok":1}');
    expect(w.ms.requests.filter(r => r.method === 'PUT')).toHaveLength(3);
  });

  it('applique un recul croissant quand Microsoft n’indique aucun délai', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'PUT', limite(), 2);
    await w.envoyer(jour(1), '{}');
    expect(w.attentes).toEqual([1000, 2000]);
  });

  it('comprend un Retry-After exprimé en date HTTP', async () => {
    const w = monde();
    await w.connecter();
    const dans5s = new Date(w.ms.clock + 5000).toUTCString();
    w.ms.inject(r => r.method === 'PUT', limite(dans5s));
    await w.envoyer(jour(1), '{}');
    expect(w.attentes[0]).toBeGreaterThanOrEqual(4000);
    expect(w.attentes[0]).toBeLessThanOrEqual(5000);
  });

  it('renonce sans attendre si Microsoft demande plus de 30 s, et le dit', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'PUT', limite('120'));
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/attendre 120 s/);
    expect(w.attentes).toEqual([]);
    expect(w.ms.files.size).toBe(0);
  });

  it('abandonne après trois reprises si la limitation persiste', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'PUT', limite('1'), 99);
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(/limite temporairement/);
    expect(w.ms.requests.filter(r => r.method === 'PUT')).toHaveLength(4);
  });

  it('réessaie sur 503 passager', async () => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'GET' && r.url.includes('/children'), () => json(503, {}, { 'Retry-After': '2' }));
    await w.envoyer(jour(1), '{}', 0);
    expect(await w.lister()).toHaveLength(1);
    expect(w.attentes).toEqual([2000]);
  });

  it('limitation du point de terminaison de jetons : reprise sans déconnecter', async () => {
    const w = monde();
    await w.connecter();
    w.ms.tick(2 * 3600 * 1000);
    w.ms.inject(r => r.host === 'login.microsoftonline.com', () => json(429, { error: 'temporarily_unavailable' }, { 'Retry-After': '3' }));
    await w.envoyer(jour(1), '{}');
    expect(w.attentes).toEqual([3000]);
    expect(w.local.map.has(CLE_REFRESH)).toBe(true);
  });
});

describe('perte réseau et erreurs de Graph', () => {
  it('traduit une coupure en phrase lisible, sans écrire à moitié', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{"v":1}');
    w.ms.offline = true;
    await expect(w.envoyer(jour(1), '{"v":2}')).rejects.toThrow(/Impossible de joindre Microsoft/);
    expect(w.ms.files.get(jour(1))?.content).toBe('{"v":1}');
    // Le réseau revient : l'utilisateur n'a rien à refaire, ni à se reconnecter.
    w.ms.offline = false;
    await w.envoyer(jour(1), '{"v":2}');
    expect(w.ms.files.get(jour(1))?.content).toBe('{"v":2}');
  });

  it('une coupure au milieu de la rotation n’invalide pas la sauvegarde', async () => {
    const w = monde();
    await w.connecter();
    for (let n = 1; n <= 10; n++) await w.envoyer(jour(n), '{}');
    w.ms.inject(r => r.method === 'GET' && r.url.includes('/children'), () => 'network');
    const r = await w.envoyer(jour(11), '{"ok":1}');
    expect(w.ms.files.get(jour(11))?.content).toBe('{"ok":1}');
    expect(r.pruneError).toMatch(/Impossible de joindre Microsoft/);
  });

  const cas: [string, number, unknown, RegExp][] = [
    ['403 accès refusé', 403, { error: { code: 'accessDenied', message: 'Access denied' } }, /Accès refusé/],
    ['403 service en lecture seule', 403, { error: { code: 'accessDenied', message: 'Access denied', innerError: { code: 'serviceReadOnly' } } }, /lecture seule/],
    ['409 conflit', 409, { error: { code: 'nameAlreadyExists', message: 'Conflict' } }, /Conflit/],
    ['423 verrouillé', 423, { error: { code: 'resourceLocked', message: 'Locked' } }, /verrouillé/],
    ['507 espace insuffisant', 507, { error: { code: 'quotaLimitReached', message: 'Insufficient Storage' } }, /Espace insuffisant/],
    ['500 erreur serveur', 500, { error: { code: 'generalException', message: 'boom' } }, /momentanément indisponible \(code 500\)/],
    ['réponse sans corps JSON', 500, undefined, /momentanément indisponible/],
  ];
  it.each(cas)('%s → message français', async (_nom, statut, corps, motif) => {
    const w = monde();
    await w.connecter();
    w.ms.inject(r => r.method === 'PUT', () => corps === undefined
      ? new Response('<html>erreur</html>', { status: statut })
      : json(statut, corps));
    await expect(w.envoyer(jour(1), '{}')).rejects.toThrow(motif);
  });

  it('refuse d’emblée un contenu trop gros, sans rien envoyer', async () => {
    const w = monde();
    await w.connecter();
    const avant = w.ms.requests.length;
    await expect(w.envoyer(jour(1), 'x'.repeat(251 * 1024 * 1024))).rejects.toThrow(/trop volumineuse/);
    expect(w.ms.requests.length).toBe(avant);
  });
});

describe('déconnexion', () => {
  it('efface le jeton et le compte, et plus aucun appel n’est possible', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{}');
    expect(await w.deconnecter()).toEqual({ connected: false });

    expect(w.local.map.has(CLE_REFRESH)).toBe(false);
    expect(w.local.map.has(CLE_COMPTE)).toBe(false);
    expect(await w.etat()).toEqual({ connected: false, account: undefined });

    const avant = w.ms.requests.length;
    await expect(w.envoyer(jour(2), '{}')).rejects.toThrow(/Aucun compte Microsoft connecté/);
    await expect(w.lister()).rejects.toThrow(/Aucun compte/);
    expect(w.ms.requests.length).toBe(avant);
  });

  it('permet de se reconnecter ensuite, et retrouve les sauvegardes', async () => {
    const w = monde();
    await w.connecter();
    await w.envoyer(jour(1), '{"a":1}');
    await w.deconnecter();
    await w.connecter();
    expect((await w.lister()).map(f => f.name)).toEqual([jour(1)]);
  });
});
