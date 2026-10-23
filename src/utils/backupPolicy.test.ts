import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Module CommonJS partagé avec le processus principal d'Electron.
const policy = createRequire(import.meta.url)('../../desktop/backupPolicy.cjs') as {
  KEEP_COPIES: number;
  MAX_BYTES: number;
  parseBackupName: (n: unknown) => { base: string; date: string } | null;
  filesToPrune: (files: string[], base: string, keep?: number) => string[];
};

describe('nom d’un fichier de sauvegarde', () => {
  it.each([
    ['Comptes_2026-10-23.cbjson', 'Comptes', '2026-10-23'],
    ['Mes_comptes-perso_2026-02-28.cbjson', 'Mes_comptes-perso', '2026-02-28'],
    ['Base_2024-02-29.cbjson', 'Base', '2024-02-29'],       // 29 février d'une année bissextile
  ])('accepte %s', (nom, base, date) => expect(policy.parseBackupName(nom)).toEqual({ base, date }));

  it.each([
    '', 'Comptes.cbjson', 'Comptes_2026-10-23.json', 'Comptes_2026-10-23.cbjson.exe', 'Comptes_2026-10-23.exe',
    'Comptes_2026-13-01.cbjson', 'Comptes_2026-02-30.cbjson', 'Base_2025-02-29.cbjson', 'Comptes_26-10-23.cbjson',
    '../Comptes_2026-10-23.cbjson', '..\\Comptes_2026-10-23.cbjson', 'C:\\Comptes_2026-10-23.cbjson', 'sous/Comptes_2026-10-23.cbjson',
    'Comptes 2026_2026-10-23.cbjson', 'Comptes:flux_2026-10-23.cbjson', '_2026-10-23.cbjson', `${'a'.repeat(81)}_2026-10-23.cbjson`,
    'Comptes_2026-10-23.cbjson\u0000.exe', 'Comptes_2026-10-23.cbjson ',
  ])('refuse %j', nom => expect(policy.parseBackupName(nom)).toBeNull());

  it('refuse les noms réservés de Windows, quelle que soit la casse', () => {
    for (const n of ['CON', 'nul', 'Aux', 'PRN', 'com1', 'LPT9']) expect(policy.parseBackupName(`${n}_2026-10-23.cbjson`), n).toBeNull();
    expect(policy.parseBackupName('console_2026-10-23.cbjson')).not.toBeNull();
  });

  it('refuse ce qui n’est pas du texte', () => {
    for (const v of [undefined, null, 42, {}, ['a_2026-10-23.cbjson']]) expect(policy.parseBackupName(v)).toBeNull();
  });
});

describe('purge des copies anciennes', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];
  const fichiers = dates.map(d => `Comptes_${d}.cbjson`);

  it('garde les dix plus récentes et désigne les plus anciennes', () => {
    expect(policy.KEEP_COPIES).toBe(10);
    expect(policy.filesToPrune(fichiers, 'Comptes')).toEqual(['Comptes_2026-10-02.cbjson', 'Comptes_2026-10-01.cbjson']);
  });

  it('ne dépend pas de l’ordre dans lequel le dossier liste ses fichiers', () => {
    expect(policy.filesToPrune([...fichiers].reverse(), 'Comptes').sort()).toEqual(['Comptes_2026-10-01.cbjson', 'Comptes_2026-10-02.cbjson']);
  });

  it('ne touche jamais aux sauvegardes d’une autre base ni aux fichiers de l’utilisateur', () => {
    const melange = [...fichiers, 'Autre_2020-01-01.cbjson', 'Comptes_2026-10-23.cbjson.tmp', 'facture.pdf', 'Comptes.cbjson',
      'notes.txt', 'Comptes2_2026-10-01.cbjson', 'Comptes_ancien.cbjson'];
    const purge = policy.filesToPrune(melange, 'Comptes');
    expect(purge).toEqual(['Comptes_2026-10-02.cbjson', 'Comptes_2026-10-01.cbjson']);
    for (const intact of ['Autre_2020-01-01.cbjson', 'facture.pdf', 'notes.txt', 'Comptes2_2026-10-01.cbjson', 'Comptes_ancien.cbjson']) {
      expect(purge).not.toContain(intact);
    }
  });

  it('ne supprime rien sous le seuil et respecte un seuil personnalisé', () => {
    expect(policy.filesToPrune(fichiers.slice(0, 10), 'Comptes')).toEqual([]);
    expect(policy.filesToPrune(fichiers, 'Comptes', 12)).toEqual([]);
    expect(policy.filesToPrune(fichiers, 'Comptes', 11)).toEqual(['Comptes_2026-10-01.cbjson']);
    expect(policy.filesToPrune([], 'Comptes')).toEqual([]);
  });

  it('plafonne la taille acceptée', () => {
    expect(policy.MAX_BYTES).toBe(250 * 1024 * 1024);
  });
});

describe('fichier .cbjson passé en argument', () => {
  const arg = (policy as unknown as { backupArgFrom: (a: unknown) => string | null }).backupArgFrom;
  const exe = String.raw`C:\Program Files\Comptes et Budget\Comptes et Budget.exe`;

  it('retient le premier chemin absolu qui finit par .cbjson, après les options', () => {
    expect(arg([exe, '--remote-debugging-port=9333', String.raw`D:\Docs\Ma base_2026-10-23.cbjson`])).toBe(String.raw`D:\Docs\Ma base_2026-10-23.cbjson`);
    expect(arg([exe, String.raw`\\nas\compta\copie.CBJSON`])).toBe(String.raw`\\nas\compta\copie.CBJSON`);
    expect(arg(['/opt/app', '/home/moi/copie.cbjson'])).toBe('/home/moi/copie.cbjson');
  });

  it('ignore le programme lui-même, les options et tout ce qui n’est pas une sauvegarde', () => {
    expect(arg([exe])).toBeNull();
    expect(arg([exe, '--flag', String.raw`C:\Docs\facture.pdf`, String.raw`C:\Docs\a.json`])).toBeNull();
    expect(arg([exe, String.raw`--user-data-dir=C:\x\copie.cbjson`])).toBeNull();      // une option, pas un fichier
  });

  it('refuse les chemins relatifs, avec remontée ou contenant un caractère de contrôle', () => {
    const refuses = ['copie.cbjson', String.raw`Docs\copie.cbjson`, String.raw`.\copie.cbjson`, String.raw`C:\a\..\b\copie.cbjson`,
      '/a/../b/copie.cbjson', 'C:\\a\u0000\\copie.cbjson'];
    for (const a of refuses) expect(arg([exe, a]), a).toBeNull();
  });

  it('passe au candidat suivant quand le premier est refusé', () => {
    expect(arg(['copie.cbjson', String.raw`C:\Docs\bonne.cbjson`])).toBe(String.raw`C:\Docs\bonne.cbjson`);
  });

  it('refuse un chemin trop long et tout argument qui n’est pas une liste de textes', () => {
    expect(arg(['C:\\' + 'a'.repeat(600) + '.cbjson'])).toBeNull();
    for (const v of [undefined, null, String.raw`C:\a.cbjson`, 42]) expect(arg(v)).toBeNull();
    expect(arg([42, null, undefined, String.raw`C:\Docs\a.cbjson`])).toBe(String.raw`C:\Docs\a.cbjson`);
  });
});
