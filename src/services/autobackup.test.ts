// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import {
  chooseFile, daysSince, forgetFile, needsReminder, noteManualExport,
  REMINDER_DAYS, run, status,
} from './autoBackupService';
import { dbService } from './dbService';

function fauxFichier(nom = 'sauvegarde.cbjson') {
  const ecrits: string[] = [];
  const handle = {
    name: nom,
    ecrits,
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
    createWritable: async () => ({
      write: async (data: string) => { ecrits.push(data); },
      close: async () => {},
    }),
  };
  return handle;
}

describe('sauvegarde automatique', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.databases.clear();
    vi.unstubAllGlobals();
  });

  it('se déclare indisponible sans File System Access API', async () => {
    expect((await status()).supported).toBe(false);
    expect((await status()).configured).toBe(false);
  });

  it('écrit la sauvegarde dans le fichier désigné', async () => {
    await dbService.create('Base test');
    const handle = fauxFichier();
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));

    const s = await chooseFile('base.cbjson');
    expect(s.configured).toBe(true);
    expect(s.fileName).toBe('sauvegarde.cbjson');
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

    const s = await chooseFile('base.cbjson');
    expect(s.lastError).toMatch(/refusée/);
    expect(handle.ecrits).toHaveLength(0);
  });

  it('oublie le fichier sur demande', async () => {
    await dbService.create('Base test');
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => fauxFichier()));
    await chooseFile('base.cbjson');
    await forgetFile();
    expect((await status()).configured).toBe(false);
    // Sans fichier désigné, l'exécution ne fait rien et n'échoue pas.
    expect((await run()).configured).toBe(false);
  });

  it('compte les jours depuis la dernière sauvegarde', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    expect(daysSince('2026-08-20T12:00:00Z', now)).toBe(2);
    expect(daysSince(undefined, now)).toBeUndefined();
    expect(daysSince('pas une date', now)).toBeUndefined();
  });

  it('rappelle l’export passé le délai, et se tait avant', async () => {
    const now = new Date('2026-08-22T12:00:00Z');
    const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const vieux = new Date(now.getTime() - (REMINDER_DAYS + 1) * 86_400_000).toISOString();

    expect(needsReminder({ supported: false, configured: false }, now)).toBe(true);
    expect(needsReminder({ supported: false, configured: false, lastManualExportAt: recent }, now)).toBe(false);
    expect(needsReminder({ supported: false, configured: false, lastManualExportAt: vieux }, now)).toBe(true);
    // Fichier automatique en échec : c'est l'export manuel qui fait foi.
    expect(needsReminder({
      supported: true, configured: true, lastRunAt: recent, lastError: 'refusée',
    }, now)).toBe(true);
    expect(needsReminder({ supported: true, configured: true, lastRunAt: recent }, now)).toBe(false);
  });

  it('mémorise la date d’un export manuel', async () => {
    await noteManualExport();
    expect((await status()).lastManualExportAt).toBeDefined();
  });
});
