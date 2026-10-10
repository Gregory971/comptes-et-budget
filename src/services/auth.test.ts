// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  authService, lockoutMs, newRecoveryCode, normalizeRecoveryCode, passwordStrength,
  timingSafeEqual, validateEmail, validatePassword, type Ctx,
} from './authService';
import { backupService } from './backupService';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { db } from './db';
import { toCents } from '../utils/money';

// 600 000 itérations par calcul rendraient la suite interminable : les tests
// travaillent à coût réduit. Seul le test de relèvement du coût en dépend, et il
// le fait exprès.
const RAPIDE: Ctx = { iterations: 1000 };
const EMAIL = 'gregory@example.com';
const MDP = 'un mot de passe solide';

beforeEach(async () => {
  await db.settings.clear();
});

describe('règles de saisie', () => {
  it('accepte une adresse correcte et refuse le reste', () => {
    expect(validateEmail('  Gregory@Example.COM ')).toBe(true);
    for (const mauvaise of ['', 'gregory', 'gregory@', '@example.com', 'a b@example.com', 'a@b']) {
      expect(validateEmail(mauvaise)).toBe(false);
    }
  });

  it('exige une longueur minimale plutôt que des règles de composition', () => {
    expect(validatePassword('court')).toMatch(/Au moins 10/);
    // Longue et en minuscules seulement : acceptable. La longueur fait la force.
    expect(validatePassword('une phrase assez longue')).toBeNull();
  });

  it('écarte les mots de passe que tout dictionnaire essaie en premier', () => {
    expect(validatePassword('password123')).toMatch(/trop courant/);
    expect(validatePassword('AZERTYUIOP')).toMatch(/trop courant/);
    expect(validatePassword('aaaaaaaaaaaa')).toMatch(/répète/);
  });

  it('refuse un mot de passe bâti sur l’adresse', () => {
    expect(validatePassword('gregory-2026-ok', 'gregory@example.com')).toMatch(/adresse/);
  });

  it('classe la solidité en quatre niveaux', () => {
    expect(passwordStrength('court')).toBe(0);
    expect(passwordStrength('abcdefghjk')).toBe(1);
    expect(passwordStrength('Abcdefgh1234')).toBe(2);
    expect(passwordStrength('une phrase vraiment longue')).toBe(3);
  });
});

describe('code de récupération', () => {
  it('prend la forme XXXXX-XXXXX-XXXXX-XXXXX sans caractère ambigu', () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('ne se répète pas', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRecoveryCode()));
    expect(codes.size).toBe(200);
  });

  it('se saisit sans tenir compte de la casse ni des séparateurs', () => {
    expect(normalizeRecoveryCode('abcde-fghjk mnpqr_stuvw')).toBe('ABCDEFGHJKMNPQRSTUVW');
  });
});

describe('création de l’accès', () => {
  it('ne conserve que des empreintes, jamais un secret', async () => {
    const { recoveryCode } = await authService.create(EMAIL, MDP, RAPIDE);
    const brut = JSON.stringify(await db.settings.toArray());

    expect(brut).not.toContain(MDP);
    expect(brut).not.toContain(recoveryCode);
    expect(brut).not.toContain(normalizeRecoveryCode(recoveryCode));
    // L'adresse, elle, n'est pas un secret : c'est un identifiant.
    expect(brut).toContain(EMAIL);
    expect(brut).toContain('"iterations":1000');
  });

  it('refuse d’écraser un accès existant — inscription fermée', async () => {
    await authService.create(EMAIL, MDP, RAPIDE);
    await expect(authService.create('autre@example.com', 'un autre mot de passe', RAPIDE))
      .rejects.toThrow(/existe déjà/);
  });

  it('refuse une adresse ou un mot de passe invalides', async () => {
    await expect(authService.create('pas une adresse', MDP, RAPIDE)).rejects.toThrow(/Adresse/);
    await expect(authService.create(EMAIL, 'court', RAPIDE)).rejects.toThrow(/Au moins 10/);
    expect((await authService.state()).kind).toBe('none');
  });

  it('établit le verrou et le délai d’inactivité par défaut', async () => {
    await authService.create('  Gregory@Example.COM ', MDP, RAPIDE);
    expect(await authService.state()).toEqual({ kind: 'on', email: EMAIL, idleMinutes: 15 });
  });
});

describe('connexion', () => {
  beforeEach(async () => { await authService.create(EMAIL, MDP, RAPIDE); });

  it('accepte les bons identifiants, adresse insensible à la casse', async () => {
    expect(await authService.verify('GREGORY@example.com ', MDP, RAPIDE)).toEqual({ ok: true });
  });

  it('refuse un mauvais mot de passe', async () => {
    expect((await authService.verify(EMAIL, 'mauvais mot de passe', RAPIDE)).ok).toBe(false);
  });

  it('refuse le bon mot de passe associé à une autre adresse', async () => {
    // Les deux informations sont exigées : le mot de passe seul ne suffit pas.
    expect((await authService.verify('autre@example.com', MDP, RAPIDE)).ok).toBe(false);
  });

  it('ne distingue pas une mauvaise adresse d’un mauvais mot de passe', async () => {
    // La réponse doit être strictement identique : sans quoi l'écran de
    // connexion confirmerait quelle adresse est enregistrée.
    const mauvaiseAdresse = await authService.verify('autre@example.com', MDP, RAPIDE);
    await db.settings.delete('auth.attempts');
    const mauvaisMotDePasse = await authService.verify(EMAIL, 'mauvais mot de passe', RAPIDE);
    expect(mauvaiseAdresse).toEqual(mauvaisMotDePasse);
  });

  it('reconnaît un mot de passe accentué saisi sous une autre forme Unicode', async () => {
    await db.settings.clear();
    const compose = 'café très sûr à Paris';          // « é » = un seul caractère
    const decompose = compose.normalize('NFD');       // « e » + accent combinant
    expect(compose).not.toBe(decompose);

    await authService.create(EMAIL, compose, RAPIDE);
    expect(await authService.verify(EMAIL, decompose, RAPIDE)).toEqual({ ok: true });
  });

  it('refuse sans accès configuré', async () => {
    await db.settings.clear();
    expect((await authService.verify(EMAIL, MDP, RAPIDE)).ok).toBe(false);
  });

  it('refait l’empreinte quand le coût de dérivation a été relevé', async () => {
    expect((await db.settings.get('auth.credentials'))?.value).toMatchObject({
      password: { iterations: 1000 },
    });
    await authService.verify(EMAIL, MDP, { iterations: 2000 });
    expect((await db.settings.get('auth.credentials'))?.value).toMatchObject({
      password: { iterations: 2000 },
    });
    // Et le même mot de passe ouvre toujours.
    expect(await authService.verify(EMAIL, MDP, { iterations: 2000 })).toEqual({ ok: true });
  });
});

describe('ralentissement des essais', () => {
  it('suit une progression doublée, plafonnée à 30 minutes', () => {
    expect([0, 1, 2].map(lockoutMs)).toEqual([0, 0, 0]);
    expect([3, 4, 5, 6].map(lockoutMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(lockoutMs(40)).toBe(30 * 60_000);
  });

  it('laisse deux fautes de frappe sans conséquence', async () => {
    await authService.create(EMAIL, MDP, RAPIDE);
    const t = 1_000_000;
    for (let i = 0; i < 2; i++) {
      expect(await authService.verify(EMAIL, 'faux mot de passe', { ...RAPIDE, now: t }))
        .toEqual({ ok: false, retryAfterMs: 0 });
    }
    expect(await authService.verify(EMAIL, MDP, { ...RAPIDE, now: t })).toEqual({ ok: true });
  });

  it('bloque dès le troisième échec, et même le bon mot de passe est alors refusé', async () => {
    await authService.create(EMAIL, MDP, RAPIDE);
    const t = 1_000_000;
    await authService.verify(EMAIL, 'faux 1 mot de passe', { ...RAPIDE, now: t });
    await authService.verify(EMAIL, 'faux 2 mot de passe', { ...RAPIDE, now: t });
    const troisieme = await authService.verify(EMAIL, 'faux 3 mot de passe', { ...RAPIDE, now: t });
    expect(troisieme).toEqual({ ok: false, retryAfterMs: 5_000 });

    // Deux secondes plus tard : le bon mot de passe n'est pas même essayé.
    const enCours = await authService.verify(EMAIL, MDP, { ...RAPIDE, now: t + 2_000 });
    expect(enCours).toEqual({ ok: false, retryAfterMs: 3_000 });

    // Le délai écoulé, la porte se rouvre et le compteur repart de zéro.
    expect(await authService.verify(EMAIL, MDP, { ...RAPIDE, now: t + 6_000 })).toEqual({ ok: true });
    expect(await db.settings.get('auth.attempts')).toBeUndefined();
  });

  it('survit à un rechargement : le compteur est écrit, pas gardé en mémoire', async () => {
    await authService.create(EMAIL, MDP, RAPIDE);
    const t = 5_000_000;
    for (let i = 0; i < 3; i++) await authService.verify(EMAIL, `faux ${i} mot de passe`, { ...RAPIDE, now: t });
    expect((await db.settings.get('auth.attempts'))?.value).toEqual({ failures: 3, lockedUntil: t + 5_000 });
  });

  it('partage le même compteur entre mot de passe et code de récupération', async () => {
    // Sans cela, un attaquant disposerait de deux budgets d'essais.
    const { recoveryCode } = await authService.create(EMAIL, MDP, RAPIDE);
    const t = 9_000_000;
    await authService.verify(EMAIL, 'faux 1 mot de passe', { ...RAPIDE, now: t });
    await authService.verify(EMAIL, 'faux 2 mot de passe', { ...RAPIDE, now: t });
    const r = await authService.recover('AAAAA-AAAAA-AAAAA-AAAAA', 'nouveau mot de passe', { ...RAPIDE, now: t });
    expect(r).toEqual({ ok: false, retryAfterMs: 5_000 });
    // Le bon code est lui aussi refusé pendant le blocage.
    expect((await authService.recover(recoveryCode, 'nouveau mot de passe', { ...RAPIDE, now: t + 1_000 })).ok)
      .toBe(false);
  });
});

describe('mot de passe oublié', () => {
  it('le code de récupération remplace le mot de passe et se renouvelle', async () => {
    const { recoveryCode } = await authService.create(EMAIL, MDP, RAPIDE);
    const r = await authService.recover(recoveryCode.toLowerCase(), 'un tout nouveau mot de passe', RAPIDE);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recoveryCode).not.toBe(recoveryCode);

    expect(await authService.verify(EMAIL, 'un tout nouveau mot de passe', RAPIDE)).toEqual({ ok: true });
    expect((await authService.verify(EMAIL, MDP, RAPIDE)).ok).toBe(false);
  });

  it('un code déjà utilisé ne sert plus', async () => {
    const { recoveryCode } = await authService.create(EMAIL, MDP, RAPIDE);
    await authService.recover(recoveryCode, 'un tout nouveau mot de passe', RAPIDE);
    expect((await authService.recover(recoveryCode, 'encore un autre mot de passe', RAPIDE)).ok).toBe(false);
  });

  it('refuse un nouveau mot de passe invalide sans consommer d’essai', async () => {
    const { recoveryCode } = await authService.create(EMAIL, MDP, RAPIDE);
    await expect(authService.recover(recoveryCode, 'court', RAPIDE)).rejects.toThrow(/Au moins 10/);
    expect(await db.settings.get('auth.attempts')).toBeUndefined();
    // Le code reste utilisable.
    expect((await authService.recover(recoveryCode, 'un mot de passe valable', RAPIDE)).ok).toBe(true);
  });
});

describe('gestion de l’accès', () => {
  beforeEach(async () => { await authService.create(EMAIL, MDP, RAPIDE); });

  it('changer le mot de passe exige l’ancien', async () => {
    expect((await authService.changePassword('mauvais ancien mot', 'un nouveau mot de passe', RAPIDE)).ok).toBe(false);
    expect((await authService.changePassword(MDP, 'un nouveau mot de passe', RAPIDE)).ok).toBe(true);
    expect((await authService.verify(EMAIL, MDP, RAPIDE)).ok).toBe(false);
    expect(await authService.verify(EMAIL, 'un nouveau mot de passe', RAPIDE)).toEqual({ ok: true });
  });

  it('changer l’adresse exige le mot de passe', async () => {
    expect((await authService.changeEmail('faux mot de passe', 'neuve@example.com', RAPIDE)).ok).toBe(false);
    expect((await authService.changeEmail(MDP, 'Neuve@Example.com', RAPIDE)).ok).toBe(true);
    expect((await authService.state())).toMatchObject({ email: 'neuve@example.com' });
  });

  it('régénérer le code invalide l’ancien', async () => {
    const ancien = (await db.settings.get('auth.credentials'))!.value as { recovery: unknown };
    const r = await authService.regenerateRecovery(MDP, RAPIDE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const apres = (await db.settings.get('auth.credentials'))!.value as { recovery: unknown };
    expect(apres.recovery).not.toEqual(ancien.recovery);
    expect((await authService.recover(r.recoveryCode, 'un mot de passe valable', RAPIDE)).ok).toBe(true);
  });

  it('n’accepte que les délais d’inactivité proposés', async () => {
    await authService.setIdleMinutes(30);
    expect(await authService.state()).toMatchObject({ idleMinutes: 30 });
    await expect(authService.setIdleMinutes(1)).rejects.toThrow(/non proposé/);
    await expect(authService.setIdleMinutes(24 * 60)).rejects.toThrow(/non proposé/);
  });

  it('désactiver la protection exige le mot de passe, et se souvient du choix', async () => {
    expect((await authService.disable('faux mot de passe', RAPIDE)).ok).toBe(false);
    expect((await authService.state()).kind).toBe('on');

    expect((await authService.disable(MDP, RAPIDE)).ok).toBe(true);
    expect((await authService.state()).kind).toBe('off');
    // Une fois désactivée, un nouvel accès peut être créé.
    await expect(authService.create(EMAIL, MDP, RAPIDE)).resolves.toBeDefined();
  });
});

describe('séparation d’avec la sauvegarde', () => {
  it('n’inclut jamais les identifiants dans un fichier de sauvegarde', async () => {
    const base = await dbService.create('Base de test');
    await accountService.create({
      dbId: base.id, name: 'Courant', type: 'courant',
      initialBalanceCents: toCents(100), startDate: '2026-01-01',
    });
    await authService.create(EMAIL, MDP, RAPIDE);

    const fichier = JSON.stringify(await backupService.export());
    expect(fichier).not.toContain(EMAIL);
    expect(fichier).not.toContain('auth.credentials');
    expect(fichier).not.toContain('"password"');
    expect(fichier).not.toContain('"recovery"');
  });
});

describe('effacement de dernier recours', () => {
  it('supprime la base et les réglages d’appareil, accès compris', async () => {
    await dbService.create('À effacer');
    await authService.create(EMAIL, MDP, RAPIDE);
    expect(await db.databases.count()).toBeGreaterThan(0);

    await authService.wipeEverything();
    await db.open();

    expect(await db.databases.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect((await authService.state()).kind).toBe('none');
  });
});

describe('comparaison à durée constante', () => {
  it('distingue les contenus sans s’arrêter au premier octet', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqual(a, new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(timingSafeEqual(a, new Uint8Array([1, 2, 3, 5]))).toBe(false);
    expect(timingSafeEqual(a, new Uint8Array([9, 2, 3, 4]))).toBe(false);
    expect(timingSafeEqual(a, new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
