// Faux Microsoft pour les tests : point de terminaison de jetons + Graph (dossier
// d'application) tenus en mémoire.
//
// Il n'imite pas Microsoft « à peu près » : il fait respecter les règles qui,
// en conditions réelles, font échouer une intégration naïve —
//  · le code d'autorisation est à usage unique et lié au défi PKCE (le
//    vérificateur est réellement recalculé et comparé) ;
//  · le jeton d'accès expire, et Graph répond 401 s'il a expiré ou été révoqué ;
//  · le jeton de rafraîchissement tourne à chaque usage (l'ancien reste valide) ;
//  · tout ce qui sort du dossier d'application est refusé en 403 ;
//  · un téléchargement est une redirection 302 vers un hôte de téléchargement,
//    suivie SANS l'en-tête Authorization (comme le fait un navigateur) ;
//  · chaque requête est confrontée à la politique de sécurité RÉELLE de la
//    passerelle (`connect-src`) : un hôte non autorisé échoue comme sous CSP.
//
// Aucun identifiant réel, aucun réseau.

import { challengeOf } from '../pkce';
import { gatewayContentSecurityPolicy } from '../../utils/csp';

export interface LoggedRequest {
  method: string;
  url: string;
  host: string;
  authorization?: string;
  body?: string;
}

export interface Planned {
  when: (r: LoggedRequest) => boolean;
  respond: () => Response | 'network';
  times: number;
}

const APPROOT = '/v1.0/me/drive/special/approot';

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

/** Hôtes autorisés par la politique réelle de la passerelle. */
function allowedHosts(): string[] {
  const connect = gatewayContentSecurityPolicy().split('; ').find(d => d.startsWith('connect-src')) ?? '';
  return connect.split(' ').slice(1);
}

function hostAllowed(host: string): boolean {
  return allowedHosts().some(source => {
    const motif = source.replace(/^https:\/\//, '');
    if (motif.startsWith('*.')) return host.endsWith(motif.slice(1)) && host.length > motif.length - 1;
    return host === motif;
  });
}

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class FakeMicrosoft {
  /** Horloge simulée, en ms. La passerelle de test la reçoit comme `now`. */
  clock = Date.UTC(2026, 9, 10, 8, 0, 0);
  readonly requests: LoggedRequest[] = [];
  /** Requêtes que la CSP de la passerelle aurait bloquées. */
  readonly cspViolations: string[] = [];
  /** En-têtes Authorization transmis à un hôte de téléchargement (fuite). */
  readonly leakedAuth: string[] = [];

  readonly files = new Map<string, { content: string; modifiedAt: number }>();
  readonly folders: string[] = [];
  /** Le dossier d'application n'existe qu'après la première écriture. */
  folderExists = false;
  offline = false;
  pageSize = 200;
  accessLifetimeS = 3600;
  /** Durée de vie d'un jeton de rafraîchissement (24 h pour une application monopage). */
  refreshLifetimeMs = Number.POSITIVE_INFINITY;
  user = 'gregory@exemple.test';

  private codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  private access = new Map<string, number>();
  private refresh = new Map<string, number>();
  private downloads = new Map<string, string>();
  private plan: Planned[] = [];
  private seq = 0;

  constructor(readonly clientId: string) {}

  /* ----------------------------------------------------- scénarios d'échec */

  /** Fait échouer les `times` prochaines requêtes qui satisfont `when`. */
  inject(when: (r: LoggedRequest) => boolean, respond: () => Response | 'network', times = 1) {
    this.plan.push({ when, respond, times });
  }

  /** Révoque tous les jetons d'accès (déconnexion forcée côté Microsoft). */
  revokeAccessTokens() { this.access.clear(); }
  revokeRefreshTokens() { this.refresh.clear(); }
  tick(ms: number) { this.clock += ms; }

  /* ------------------------------------------------------ page de connexion */

  /**
   * Joue la page de connexion Microsoft : vérifie la demande d'autorisation et
   * renvoie la chaîne de requête du retour (`?code=…&state=…` ou `?error=…`).
   */
  authorize(authorizeUrl: string, consent = true): string {
    const u = new URL(authorizeUrl);
    const q = u.searchParams;
    if (u.origin !== 'https://login.microsoftonline.com') throw new Error('Mauvaise autorité');
    if (q.get('client_id') !== this.clientId) {
      return `?error=unauthorized_client&error_description=AADSTS700016&state=${q.get('state')}`;
    }
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
      throw new Error('Demande d’autorisation sans PKCE S256');
    }
    if (!consent) {
      return `?error=access_denied&error_description=${encodeURIComponent('AADSTS65004: L’utilisateur a refusé')}&state=${q.get('state')}`;
    }
    const code = `code-${++this.seq}`;
    this.codes.set(code, {
      challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri')!, clientId: q.get('client_id')!,
    });
    return `?code=${code}&state=${q.get('state')}`;
  }

  /* ------------------------------------------------------------- réseau */

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    let url = input;
    let method = (init.method ?? 'GET').toUpperCase();
    let headers = new Headers(init.headers);
    for (let saut = 0; saut < 5; saut++) {
      const res = await this.once(url, method, headers, typeof init.body === 'string' ? init.body : undefined);
      const lieu = res.headers.get('Location');
      if (res.status === 302 && lieu) {
        // Redirection inter-origines : le navigateur retire l'en-tête Authorization.
        const dernierHote = new URL(url).host;
        url = lieu;
        method = 'GET';
        headers = new Headers(new URL(lieu).host === dernierHote ? headers : undefined);
        continue;
      }
      return res;
    }
    throw new TypeError('Trop de redirections');
  };

  private async once(url: string, method: string, headers: Headers, body?: string): Promise<Response> {
    const u = new URL(url);
    const req: LoggedRequest = {
      method, url, host: u.host, authorization: headers.get('Authorization') ?? undefined, body,
    };
    this.requests.push(req);

    if (!hostAllowed(u.host) || u.protocol !== 'https:') {
      this.cspViolations.push(url);
      throw new TypeError('Failed to fetch');
    }
    if (this.offline) throw new TypeError('Failed to fetch');

    const prevu = this.plan.find(p => p.times > 0 && p.when(req));
    if (prevu) {
      prevu.times--;
      const r = prevu.respond();
      if (r === 'network') throw new TypeError('Failed to fetch');
      return r;
    }

    if (u.host === 'login.microsoftonline.com') return this.token(u, method, body ?? '');
    if (u.host === 'graph.microsoft.com') return this.graph(u, method, req, body);
    return this.download(u, req);
  }

  /* ------------------------------------------------------------- jetons */

  private issue(): Record<string, unknown> {
    const at = `at-${++this.seq}`;
    const rt = `rt-${++this.seq}`;
    this.access.set(at, this.clock + this.accessLifetimeS * 1000);
    this.refresh.set(rt, this.clock + this.refreshLifetimeMs);
    const idToken = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ preferred_username: this.user }))}.sig`;
    return {
      token_type: 'Bearer', expires_in: this.accessLifetimeS, access_token: at,
      refresh_token: rt, id_token: idToken,
    };
  }

  private async token(u: URL, method: string, body: string): Promise<Response> {
    if (u.pathname !== '/common/oauth2/v2.0/token' || method !== 'POST') return json(404, { error: 'not_found' });
    const f = new URLSearchParams(body);
    if (f.get('client_id') !== this.clientId) {
      return json(401, { error: 'invalid_client', error_description: 'AADSTS700016: application introuvable' });
    }
    if (f.has('client_secret')) {
      return json(400, { error: 'invalid_request', error_description: 'AADSTS90023: un client public ne doit pas envoyer de secret' });
    }
    if (f.get('grant_type') === 'authorization_code') {
      const rec = this.codes.get(f.get('code') ?? '');
      this.codes.delete(f.get('code') ?? ''); // usage unique
      if (!rec) return json(400, { error: 'invalid_grant', error_description: 'AADSTS70000: code invalide ou déjà utilisé' });
      if (rec.redirectUri !== f.get('redirect_uri')) {
        return json(400, { error: 'invalid_grant', error_description: 'AADSTS50011: URI de redirection différente' });
      }
      if (await challengeOf(f.get('code_verifier') ?? '') !== rec.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'AADSTS50148: le vérificateur PKCE ne correspond pas' });
      }
      return json(200, this.issue());
    }
    if (f.get('grant_type') === 'refresh_token') {
      const jeton = f.get('refresh_token') ?? '';
      const fin = this.refresh.get(jeton);
      if (fin === undefined) {
        return json(400, { error: 'invalid_grant', error_description: 'AADSTS70000: jeton de rafraîchissement inconnu ou révoqué' });
      }
      if (fin <= this.clock) {
        this.refresh.delete(jeton);
        return json(400, { error: 'invalid_grant', error_description:
          'AADSTS700084: Le jeton a été émis pour une application monopage et vit au plus 24 h.\r\nTrace ID: x' });
      }
      const neuf = this.issue();
      // Le jeton neuf hérite de l'échéance du jeton d'origine (24 h non renouvelable).
      this.refresh.set(neuf.refresh_token as string, fin);
      return json(200, neuf);
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  /* -------------------------------------------------------------- Graph */

  private authorized(req: LoggedRequest): boolean {
    const m = /^Bearer (.+)$/.exec(req.authorization ?? '');
    const fin = m ? this.access.get(m[1]) : undefined;
    return fin !== undefined && fin > this.clock;
  }

  private graph(u: URL, method: string, req: LoggedRequest, body?: string): Response {
    if (!this.authorized(req)) {
      return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired or is not yet valid.' } });
    }
    // Portée Files.ReadWrite.AppFolder : rien hors du dossier d'application.
    if (!u.pathname.startsWith(APPROOT)) {
      return json(403, { error: { code: 'accessDenied', message: 'Access denied' } });
    }
    const reste = decodeURIComponent(u.pathname.slice(APPROOT.length));

    if (reste === '/children' && method === 'GET') return this.children(u);

    const contenu = /^:\/(.+):\/content$/.exec(reste);
    if (contenu && method === 'PUT') {
      const nom = contenu[1];
      const existait = this.files.has(nom);
      this.files.set(nom, { content: body ?? '', modifiedAt: this.clock });
      this.folderExists = true;
      return json(existait ? 200 : 201, { name: nom, size: new TextEncoder().encode(body ?? '').length });
    }
    if (contenu && method === 'GET') {
      const nom = contenu[1];
      if (!this.files.has(nom)) return json(404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
      const cle = `dl-${++this.seq}`;
      this.downloads.set(cle, nom);
      return new Response(null, { status: 302, headers: { Location: `https://sg-by1.files.1drv.com/y4m/${cle}` } });
    }
    const simple = /^:\/(.+)$/.exec(reste);
    if (simple && method === 'DELETE') {
      if (!this.files.delete(simple[1])) {
        return json(404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
      }
      return new Response(null, { status: 204 });
    }
    return json(400, { error: { code: 'invalidRequest', message: `Requête non gérée : ${method} ${reste}` } });
  }

  private children(u: URL): Response {
    if (!this.folderExists) {
      return json(404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
    }
    const tout = [
      ...[...this.files].map(([name, f]) => ({
        name, size: new TextEncoder().encode(f.content).length,
        lastModifiedDateTime: new Date(f.modifiedAt).toISOString(),
      })),
      ...this.folders.map(name => ({ name, size: 0, folder: { childCount: 0 } })),
    ].sort((a, b) => (a.name < b.name ? 1 : -1)); // name desc
    const debut = Number(u.searchParams.get('$skiptoken') ?? 0);
    const taille = Math.min(Number(u.searchParams.get('$top') ?? 200), this.pageSize);
    const page = tout.slice(debut, debut + taille);
    const suite = debut + taille < tout.length
      ? { '@odata.nextLink': `https://graph.microsoft.com${APPROOT}/children?$top=${taille}&$skiptoken=${debut + taille}` }
      : {};
    return json(200, { value: page, ...suite });
  }

  private download(u: URL, req: LoggedRequest): Response {
    if (req.authorization) this.leakedAuth.push(req.authorization);
    const nom = this.downloads.get(u.pathname.split('/').pop() ?? '');
    const f = nom ? this.files.get(nom) : undefined;
    if (!f) return new Response('introuvable', { status: 404 });
    return new Response(f.content, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  }
}
