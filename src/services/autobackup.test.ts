// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import {
  chooseFile, chooseFolder, daysSince, forgetFile, KEEP_COPIES, needsReminder,
  noteManualExport, REMINDER_DAYS, run, safeBaseName, status,
} from './autoBackupService';
import { dbService } from './dbService';

/** Faux fichier : mémorise ce qui y est écrit. */
function fauxFichier(nom = 'sauvegarde.cbjson') {
  const ecrits: string[] = [];
  return {
    name: nom, kind: 'file' as const, ecrits,
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
    createWritable: async () => ({
      write: async (data: string) => { ecrits.push(data); },
      close: async () => {},
    }),
  };
}

/** Faux dossier : conserve les fichiers créés et les suppressions demandées. */
function fauxDossier(nom = 'Sauvegardes', existants: string[] = []) {
  const contenu = new Map<string, string>(existants.map(n => [n, '']));
  const supprimes: string[] = [];
  return {
    name: nom, kind: 'directory' as const, contenu, supprimes,
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
    getFileHandle: vi.fn(async (n: string) => ({
      name: n,
      createWritable: async () => ({
        write: async (data: string) => { contenu.set(n, data); },
        close: async () => {},
      }),
    })),
    removeEntry: vi.fn(async (n: string) => { contenu.delete(n); supprimes.push(n); }),
    keys: async function* () { for (const n of [...contenu.keys()]) yield n; },
  };
}

const aujourdhui = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('sauvegarde automatique', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.databases.clear();
    await forgetFile();
    vi.unstubAllGlobals();
  });

  it('se déclare indisponible sans File System Access API', async () => {
    const s = await status();
    expect(s.supported).toBe(false);
    expect(s.folderSupported).toBe(false);
    expect(s.configured).toBe(false);
  });

  it('écrit la sauvegarde dans le fichier désigné', async () => {
    await dbService.create('Base test');
    const handle = fauxFichier();
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));

    const s = await chooseFile('Base test');
    expect(s.configured).toBe(true);
    expect(s.kind).toBe('fichier');
    expect(s.targetName).toBe('sauvegarde.cbjson');
    expect(s.lastError).toBeUndefined();
    expect(handle.ecrits).toHaveLength(1);
    expect(JSON.parse(handle.ecrits[0]).format).toBe('comptes-budget');
  });

  it('enregistre l’échec au lieu de faire croire à une sauvegarde', async () => {
    await dbService.create('Base test');
    const handle = fauxFichier();
    handle.queryPermission = vi.fn(async () => 'prompt' as PermissionState);
    handle.requestPermission = vi.fn(async () => 'denied' as PermissionState);
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));

    const s = await chooseFile('Base test');
    expect(s.lastError).toMatch(/refusée/);
    expect(handle.ecrits).toHaveLength(0);
  });

  it('oublie la destination sur demande', async () => {
    await dbService.create('Base test');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => fauxFichier()));
    await chooseFile('Base test');
    await forgetFile();
    expect((await status()).configured).toBe(false);
    expect((await run()).configured).toBe(false);
  });
});

describe('sauvegarde automatique dans un dossier synchronisé', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.databases.clear();
    await forgetFile();
    vi.unstubAllGlobals();
  });

  it('dépose un fichier daté dans le dossier choisi', async () => {
    await dbService.create('Mes comptes');
    const dossier = fauxDossier('OneDrive-Sauvegardes');
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dossier));

    const s = await chooseFolder('Mes comptes');
    expect(s.kind).toBe('dossier');
    expect(s.targetName).toBe('OneDrive-Sauvegardes');
    expect(s.folderSupported).toBe(true);

    const attendu = `Mes_comptes_${aujourdhui()}.cbjson`;
    expect(s.lastFileName).toBe(attendu);
    expect([...dossier.contenu.keys()]).toEqual([attendu]);
    expect(JSON.parse(dossier.contenu.get(attendu)!).format).toBe('comptes-budget');
  });

  it('réécrit la copie du jour au lieu d’en accumuler une par ouverture', async () => {
    await dbService.create('Mes comptes');
    const dossier = fauxDossier();
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dossier));
    await chooseFolder('Mes comptes');
    await run();
    await run();
    expect(dossier.contenu.size).toBe(1);
  });

  it('ne conserve que les copies les plus récentes', async () => {
    await dbService.create('Mes comptes');
    // Douze copies antérieures : les deux plus anciennes doivent disparaître.
    const anciennes = Array.from({ length: 12 }, (_, i) =>
      `Mes_comptes_2026-0${1 + Math.floor(i / 6)}-${String(10 + (i % 6)).padStart(2, '0')}.cbjson`);
    const dossier = fauxDossier('Sauvegardes', anciennes);
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dossier));

    await chooseFolder('Mes comptes');
    expect(dossier.contenu.size).toBe(KEEP_COPIES);
    // La copie du jour survit, les plus anciennes partent.
    expect(dossier.contenu.has(`Mes_comptes_${aujourdhui()}.cbjson`)).toBe(true);
    expect(dossier.supprimes).toContain('Mes_comptes_2026-01-10.cbjson');
    expect(dossier.supprimes).toContain('Mes_comptes_2026-01-11.cbjson');
  });

  it('ne touche pas aux fichiers étrangers du dossier', async () => {
    await dbService.create('Mes comptes');
    const etrangers = ['Photo.jpg', 'Autre_base_2026-01-01.cbjson', 'notes.txt'];
    const dossier = fauxDossier('OneDrive', etrangers);
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dossier));

    await chooseFolder('Mes comptes');
    for (const f of etrangers) expect(dossier.contenu.has(f)).toBe(true);
    expect(dossier.supprimes).toEqual([]);
  });

  it('n’interrompt pas la sauvegarde si une purge échoue', async () => {
    await dbService.create('Mes comptes');
    const anciennes = Array.from({ length: 12 }, (_, i) =>
      `Mes_comptes_2026-01-${String(10 + i).padStart(2, '0')}.cbjson`);
    const dossier = fauxDossier('Sauvegardes', anciennes);
    // Fichier verrouillé par la synchronisation en cours.
    dossier.removeEntry = vi.fn(async () => { throw new Error('EBUSY'); });
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => dossier));

    const s = await chooseFolder('Mes comptes');
    expect(s.lastError).toBeUndefined();
    expect(dossier.contenu.has(`Mes_comptes_${aujourdhui()}.cbjson`)).toBe(true);
  });

  it('assainit le nom de la base pour en faire un nom de fichier', () => {
    expect(safeBaseName('Mes comptes')).toBe('Mes_comptes');
    expect(safeBaseName('Compte Pro / ATPro')).toBe('Compte_Pro_ATPro');
    expect(safeBaseName('  ')).toBe('Comptes');
    expect(safeBaseName('éèç')).toBe('Comptes');
  });
});

describe('rappel d’export', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await forgetFile();
    vi.unstubAllGlobals();
  });

  const base = { supported: false, folderSupported: false, configured: false };

  it('compte les jours depuis la dernière sauvegarde', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    expect(daysSince('2026-08-20T12:00:00Z', now)).toBe(2);
    expect(daysSince(undefined, now)).toBeUndefined();
    expect(daysSince('pas une date', now)).toBeUndefined();
  });

  it('rappelle l’export passé le délai, et se tait avant', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const vieux = new Date(now.getTime() - (REMINDER_DAYS + 1) * 86_400_000).toISOString();

    expect(needsReminder(base, now)).toBe(true);
    expect(needsReminder({ ...base, lastManualExportAt: recent }, now)).toBe(false);
    expect(needsReminder({ ...base, lastManualExportAt: vieux }, now)).toBe(true);
    // Destination automatique en échec : c'est l'export manuel qui fait foi.
    expect(needsReminder({
      ...base, supported: true, configured: true, lastRunAt: recent, lastError: 'refusée',
    }, now)).toBe(true);
    expect(needsReminder({ ...base, supported: true, configured: true, lastRunAt: recent }, now)).toBe(false);
  });

  it('mémorise la date d’un export manuel', async () => {
    await noteManualExport();
    expect((await status()).lastManualExportAt).toBeDefined();
  });
});
