// Accès par identifiants — verrou local de l'application.
//
// CE QUE C'EST, ET CE QUE CE N'EST PAS
// ------------------------------------
// L'application est statique et « local-first » : aucun serveur, et une CSP
// (`connect-src 'none'`) qui interdit au navigateur tout appel réseau. Une
// authentification au sens de Softr — identité vérifiée par un serveur, lien
// magique envoyé par courriel — est donc impossible ici sans renoncer à la
// garantie centrale de l'application : que rien ne quitte l'appareil.
//
// Ce module met en place l'équivalent compatible : un VERROU LOCAL. Il barre
// l'accès à l'interface à qui n'a pas les identifiants (appareil partagé,
// ordinateur laissé ouvert, curieux de passage). Il ne CHIFFRE PAS la base :
// quelqu'un qui disposerait du profil du navigateur et d'outils de développement
// pourrait lire IndexedDB sans passer par ici. Le chiffrer exigerait de rendre
// illisibles les champs indexés (dates, comptes), donc de renoncer aux requêtes
// de Dexie. L'interface le dit, plutôt que de laisser croire à une protection
// qui n'existe pas.
//
// CHOIX DE CONCEPTION
// -------------------
//  · Aucun secret n'est stocké. Ni le mot de passe ni le code de récupération :
//    seulement leur empreinte PBKDF2-HMAC-SHA256 (600 000 itérations, sel de
//    16 octets propre à chaque secret) — mêmes paramètres que la sauvegarde
//    chiffrée, recommandation OWASP « Password Storage Cheat Sheet ».
//  · Comparaison en temps constant, et empreinte TOUJOURS calculée, même si
//    l'adresse saisie est fausse : le temps de réponse ne révèle pas laquelle
//    des deux informations était erronée.
//  · Le mot de passe est normalisé en Unicode NFKC avant dérivation : « é »
//    saisi sur un clavier qui le compose ou sur un autre qui le décompose doit
//    donner la même empreinte, sans quoi un mot de passe valable ici cesserait
//    de l'être sur un autre appareil.
//  · Les paramètres de dérivation sont conservés AVEC l'empreinte : on peut
//    relever le coût plus tard, et l'empreinte est recalculée à la connexion
//    suivante (voir `verify`).
//  · Ralentissement progressif des essais, persisté (recharger la page ne le
//    remet pas à zéro). C'est un frein d'usage, non une barrière : quiconque
//    exécute du code dans la page peut le contourner. La vraie barrière est le
//    coût de PBKDF2 et la qualité du mot de passe — d'où une longueur minimale
//    et un refus des mots de passe triviaux, plutôt que des règles de
//    composition qui poussent à choisir « Motdepasse1! ».
//  · Un code de récupération de 100 bits d'entropie, affiché une seule fois :
//    sans serveur, il n'existe aucun moyen de « renvoyer un lien ». Le perdre
//    avec le mot de passe ne laisse que l'effacement des données locales — la
//    sauvegarde exportée devient alors la seule voie de retour, et l'interface
//    le dit avant de proposer cet effacement.
//  · Les identifiants vivent dans la table `settings` : réglage d'appareil,
//    jamais écrit dans un fichier de sauvegarde. Restaurer une sauvegarde sur un
//    autre appareil n'y apporte donc pas l'accès de celui-ci, et n'écrase pas
//    celui de l'appareil qui la restaure.

import { db, stamp } from './db';
import { KDF_ITERATIONS, fromB64, toB64 } from './cryptoService';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;
export const IDLE_CHOICES = [5, 15, 30, 60] as const;
export const DEFAULT_IDLE_MINUTES = 15;

const CREDENTIALS = 'auth.credentials';
const ATTEMPTS = 'auth.attempts';

/** Empreinte d'un secret : jamais le secret lui-même. */
interface Secret {
  salt: string;        // base64
  iterations: number;
  hash: string;        // base64 — 256 bits
}

interface Credentials {
  version: 1;
  mode: 'on';
  email: string;       // normalisée : minuscules, sans espaces
  password: Secret;
  recovery: Secret;
  idleMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/** Protection désactivée par l'utilisateur : évite de la lui redemander à chaque lancement. */
interface Disabled {
  version: 1;
  mode: 'off';
  updatedAt: string;
}

interface Attempts {
  failures: number;
  lockedUntil: number; // epoch ms
}

export type AccessState =
  | { kind: 'none' }                                     // jamais configuré
  | { kind: 'off' }                                      // désactivé volontairement
  | { kind: 'on'; email: string; idleMinutes: number };  // verrou actif

/** Résultat d'une vérification soumise au ralentissement. */
export type Attempt = { ok: true } | { ok: false; retryAfterMs: number };
export type RecoveryAttempt = { ok: true; recoveryCode: string } | { ok: false; retryAfterMs: number };

/**
 * Paramètres d'injection, réservés aux tests : un coût de dérivation réduit
 * (600 000 itérations par appel rendraient la suite interminable) et une
 * horloge maîtrisée pour le ralentissement.
 */
export interface Ctx {
  iterations?: number;
  now?: number;
}

const enc = new TextEncoder();

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('Ce navigateur ne fournit pas WebCrypto : l’accès sécurisé est indisponible.');
  }
  return c.subtle;
};

// --- Normalisation et règles ------------------------------------------------

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

export function validateEmail(s: string): boolean {
  const e = normalizeEmail(s);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Mots de passe refusés d'emblée : ceux que n'importe quel dictionnaire essaie
 * en premier. Liste volontairement courte — l'objet est d'écarter l'évident,
 * non de simuler un moteur d'évaluation que l'application n'embarque pas.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '12345678910', '1234512345', '0000000000', '1111111111',
  'password12', 'password123', 'passw0rd123', 'motdepasse', 'motdepasse1', 'motdepasse12',
  'motdepasse123', 'azertyuiop', 'azerty1234', 'azerty12345', 'qwertyuiop', 'qwerty1234',
  'qwerty12345', 'bienvenue1', 'bienvenue12', 'iloveyou12', 'administrateur', 'comptes123',
  'comptesbudget', 'monmotdepasse', 'changeme123', 'letmein1234', 'welcome1234',
]);

/** Message d'erreur si le mot de passe est refusé, `null` s'il est acceptable. */
export function validatePassword(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Au plus ${MAX_PASSWORD_LENGTH} caractères.`;
  }
  const bas = password.toLowerCase();
  if (COMMON_PASSWORDS.has(bas)) return 'Ce mot de passe est trop courant.';
  if (/^(.)\1+$/.test(password)) return 'Ce mot de passe répète un seul caractère.';
  const local = normalizeEmail(email).split('@')[0];
  if (local.length >= 4 && bas.includes(local)) {
    return 'Ne reprenez pas votre adresse dans le mot de passe.';
  }
  return null;
}

/** Évaluation grossière pour l'indicateur : 0 refusé, 1 juste, 2 correct, 3 solide. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (validatePassword(password) !== null) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  if (password.length >= 16 || (password.length >= 14 && classes >= 3)) return 3;
  if (password.length >= 12 && classes >= 2) return 2;
  return 1;
}

// --- Code de récupération ----------------------------------------------------

/**
 * 32 symboles, sans I ni O ni 0 ni 1 : un code recopié à la main ne doit pas se
 * heurter à des caractères que l'œil confond. 32 divise 256, donc tirer un octet
 * et le réduire modulo 32 ne biaise aucun symbole.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 20; // 20 × 5 bits = 100 bits

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_LENGTH));
  const brut = Array.from(bytes, b => RECOVERY_ALPHABET[b % 32]).join('');
  return brut.match(/.{5}/g)!.join('-');
}

/** Forme canonique : sans séparateurs ni casse, telle qu'elle est empreinte. */
export const normalizeRecoveryCode = (s: string): string =>
  s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// --- Empreintes ---------------------------------------------------------------

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await subtle().importKey(
    'raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256);
  return new Uint8Array(bits);
}

/** Comparaison à durée constante : ne s'arrête pas au premier octet différent. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function seal(secret: string, iterations: number): Promise<Secret> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), iterations, hash: toB64(await derive(secret, salt, iterations)) };
}

async function matches(secret: string, stored: Secret): Promise<boolean> {
  const obtenu = await derive(secret, fromB64(stored.salt), stored.iterations);
  return timingSafeEqual(obtenu, fromB64(stored.hash));
}

// --- Ralentissement progressif ------------------------------------------------

/**
 * Délai imposé après `failures` échecs consécutifs : aucun jusqu'au deuxième,
 * puis 5 s doublées à chaque échec, plafonnées à 30 minutes. Les deux premières
 * erreurs sont gratuites — une faute de frappe n'est pas une attaque.
 */
export function lockoutMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(30 * 60_000, 5_000 * 2 ** (failures - 3));
}

async function read<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

const write = (key: string, value: unknown) =>
  db.settings.put({ key, value, updatedAt: stamp() });

/**
 * Exécute une vérification sous ralentissement. Pendant un blocage, la
 * vérification n'est même pas tentée : on ne dépense ni le calcul ni un essai.
 */
async function guarded(ctx: Ctx, check: () => Promise<boolean>): Promise<Attempt> {
  const now = ctx.now ?? Date.now();
  const a = (await read<Attempts>(ATTEMPTS)) ?? { failures: 0, lockedUntil: 0 };
  if (a.lockedUntil > now) return { ok: false, retryAfterMs: a.lockedUntil - now };

  if (await check()) {
    await db.settings.delete(ATTEMPTS);
    return { ok: true };
  }
  const failures = a.failures + 1;
  const wait = lockoutMs(failures);
  await write(ATTEMPTS, { failures, lockedUntil: now + wait } satisfies Attempts);
  return { ok: false, retryAfterMs: wait };
}

// --- Accès aux identifiants ----------------------------------------------------

async function stored(): Promise<Credentials | Disabled | undefined> {
  return read<Credentials | Disabled>(CREDENTIALS);
}

async function credentials(): Promise<Credentials | undefined> {
  const s = await stored();
  return s?.mode === 'on' ? s : undefined;
}

async function requireCredentials(): Promise<Credentials> {
  const c = await credentials();
  if (!c) throw new Error('Aucun accès n’est configuré sur cet appareil.');
  return c;
}

const save = (c: Credentials) => write(CREDENTIALS, c);

/**
 * WebCrypto n'existe que dans un contexte sécurisé (https, localhost, et file://
 * dans la plupart des navigateurs). Quand il manque, aucune empreinte ne peut être
 * calculée : l'accès ne peut être ni créé ni vérifié. Savoir le détecter permet à
 * l'application de ne pas s'enfermer dehors — voir `useAuth.init`.
 */
export const cryptoAvailable = (): boolean => Boolean(globalThis.crypto?.subtle);

export const authService = {
  async state(): Promise<AccessState> {
    const s = await stored();
    if (!s) return { kind: 'none' };
    if (s.mode === 'off') return { kind: 'off' };
    return { kind: 'on', email: s.email, idleMinutes: s.idleMinutes };
  },

  /**
   * Crée l'accès. Une seule fois : tant qu'un accès existe, la création est
   * refusée — l'équivalent de l'inscription fermée d'une application Softr. La
   * remplacer exige de connaître le mot de passe (ou le code de récupération).
   */
  async create(email: string, password: string, ctx: Ctx = {}): Promise<{ recoveryCode: string }> {
    if ((await stored())?.mode === 'on') throw new Error('Un accès existe déjà sur cet appareil.');
    const adresse = normalizeEmail(email);
    if (!validateEmail(adresse)) throw new Error('Adresse électronique invalide.');
    const probleme = validatePassword(password, adresse);
    if (probleme) throw new Error(probleme);

    const it = ctx.iterations ?? KDF_ITERATIONS;
    const recoveryCode = newRecoveryCode();
    const [pw, rec] = await Promise.all([
      seal(password, it), seal(normalizeRecoveryCode(recoveryCode), it),
    ]);
    const now = stamp();
    await save({
      version: 1, mode: 'on', email: adresse, password: pw, recovery: rec,
      idleMinutes: DEFAULT_IDLE_MINUTES, createdAt: now, updatedAt: now,
    });
    await db.settings.delete(ATTEMPTS);
    return { recoveryCode };
  },

  /**
   * Vérifie l'adresse ET le mot de passe. L'empreinte est calculée même si
   * l'adresse est fausse, et le résultat ne dit jamais lequel des deux a échoué.
   */
  async verify(email: string, password: string, ctx: Ctx = {}): Promise<Attempt> {
    const c = await credentials();
    if (!c) return { ok: false, retryAfterMs: 0 };

    const r = await guarded(ctx, async () => {
      const motDePasseOk = await matches(password, c.password);
      const adresseOk = timingSafeEqual(
        enc.encode(normalizeEmail(email)), enc.encode(c.email));
      return motDePasseOk && adresseOk;
    });

    // Relèvement du coût : si les paramètres stockés sont plus faibles que ceux
    // d'aujourd'hui, l'empreinte est refaite maintenant — seul moment où le mot
    // de passe en clair est disponible.
    const cible = ctx.iterations ?? KDF_ITERATIONS;
    if (r.ok && c.password.iterations < cible) {
      await save({ ...c, password: await seal(password, cible), updatedAt: stamp() });
    }
    return r;
  },

  /** Mot de passe oublié : le code de récupération le remplace, puis se renouvelle. */
  async recover(code: string, newPassword: string, ctx: Ctx = {}): Promise<RecoveryAttempt> {
    const c = await requireCredentials();
    const probleme = validatePassword(newPassword, c.email);
    if (probleme) throw new Error(probleme);

    const r = await guarded(ctx, () => matches(normalizeRecoveryCode(code), c.recovery));
    if (!r.ok) return r;

    const it = ctx.iterations ?? KDF_ITERATIONS;
    const recoveryCode = newRecoveryCode();
    const [pw, rec] = await Promise.all([
      seal(newPassword, it), seal(normalizeRecoveryCode(recoveryCode), it),
    ]);
    await save({ ...c, password: pw, recovery: rec, updatedAt: stamp() });
    return { ok: true, recoveryCode };
  },

  async changePassword(current: string, next: string, ctx: Ctx = {}): Promise<Attempt> {
    const c = await requireCredentials();
    const probleme = validatePassword(next, c.email);
    if (probleme) throw new Error(probleme);
    const r = await guarded(ctx, () => matches(current, c.password));
    if (r.ok) {
      await save({ ...c, password: await seal(next, ctx.iterations ?? KDF_ITERATIONS), updatedAt: stamp() });
    }
    return r;
  },

  async changeEmail(password: string, email: string, ctx: Ctx = {}): Promise<Attempt> {
    const c = await requireCredentials();
    const adresse = normalizeEmail(email);
    if (!validateEmail(adresse)) throw new Error('Adresse électronique invalide.');
    const r = await guarded(ctx, () => matches(password, c.password));
    if (r.ok) await save({ ...c, email: adresse, updatedAt: stamp() });
    return r;
  },

  /** Nouveau code de récupération ; l'ancien cesse aussitôt de fonctionner. */
  async regenerateRecovery(password: string, ctx: Ctx = {}): Promise<RecoveryAttempt> {
    const c = await requireCredentials();
    const r = await guarded(ctx, () => matches(password, c.password));
    if (!r.ok) return r;
    const recoveryCode = newRecoveryCode();
    const rec = await seal(normalizeRecoveryCode(recoveryCode), ctx.iterations ?? KDF_ITERATIONS);
    await save({ ...c, recovery: rec, updatedAt: stamp() });
    return { ok: true, recoveryCode };
  },

  async setIdleMinutes(minutes: number): Promise<void> {
    if (!(IDLE_CHOICES as readonly number[]).includes(minutes)) {
      throw new Error('Délai de verrouillage non proposé.');
    }
    const c = await requireCredentials();
    await save({ ...c, idleMinutes: minutes, updatedAt: stamp() });
  },

  /** Désactive la protection — sur présentation du mot de passe, pas sur simple clic. */
  async disable(password: string, ctx: Ctx = {}): Promise<Attempt> {
    const c = await requireCredentials();
    const r = await guarded(ctx, () => matches(password, c.password));
    if (r.ok) {
      await write(CREDENTIALS, { version: 1, mode: 'off', updatedAt: stamp() } satisfies Disabled);
      await db.settings.delete(ATTEMPTS);
    }
    return r;
  },

  /**
   * Dernier recours quand le mot de passe ET le code de récupération sont
   * perdus : efface la base et les réglages de cet appareil. Il n'existe pas de
   * contournement qui conserverait les données — en offrir un viderait le verrou
   * de son sens. La sauvegarde exportée est le chemin de retour.
   */
  async wipeEverything(): Promise<void> {
    await db.delete();
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('cb_')) localStorage.removeItem(k);
    } catch {
      // Stockage refusé : la base est déjà effacée, le reste est sans conséquence.
    }
  },
};
