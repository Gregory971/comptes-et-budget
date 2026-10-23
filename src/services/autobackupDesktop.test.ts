// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { chooseDesktopFolder, forgetFile, run, status, needsReminder } from './autoBackupService';
import { fauxPont } from '../utils/fauxPont';

const DOSSIER = String.raw`C:\Users\moi\Documents\Sauvegardes`;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  const base = await dbService.create('Ma base', 'perso');
  await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 1234, startDate: '2026-01-01' });
  delete window.comptesBudget;
});

afterEach(() => { delete window.comptesBudget; vi.restoreAllMocks(); });

describe('sauvegarde automatique — édition bureau', () => {
  it('n’est pas active tant que l’utilisateur ne l’a pas choisie', async () => {
    window.comptesBudget = fauxPont();
    const s = await status();
    expect(s).toMatchObject({ desktop: true, supported: true, folderSupported: true, configured: false });
    expect(s.kind).toBeUndefined();
    expect(await run()).toMatchObject({ configured: false });             // rien n'est écrit sans choix explicite
    expect(window.comptesBudget.writeBackup).not.toHaveBeenCalled();
  });

  it('choisit un dossier, écrit aussitôt une copie datée du nom de la base et mémorise le chemin réel', async () => {
    const ecritures: { nom: string; contenu: string }[] = [];
    let dossier: string | null = null;
    window.comptesBudget = fauxPont({
      chooseBackupFolder: vi.fn().mockImplementation(async () => (dossier = DOSSIER)),
      backupFolder: vi.fn().mockImplementation(async () => dossier),
      writeBackup: vi.fn().mockImplementation(async (nom: string, contenu: string) => { ecritures.push({ nom, contenu }); return { ok: true, path: `${DOSSIER}\\${nom}` }; }),
    });

    const s = await chooseDesktopFolder('Ma base');
    expect(s).toMatchObject({ configured: true, kind: 'bureau', targetName: DOSSIER });
    expect(s.lastError).toBeUndefined();
    expect(s.lastRunAt).toBeTruthy();

    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].nom).toMatch(/^Ma_base_\d{4}-\d{2}-\d{2}\.cbjson$/);
    expect(s.lastFileName).toBe(ecritures[0].nom);
    // Le contenu est bien la sauvegarde de la base, restaurable.
    const copie = JSON.parse(ecritures[0].contenu);
    expect(copie.format).toBe('comptes-budget');
    expect(copie.accounts[0].name).toBe('Courant');
  });

  it('une annulation de la boîte de dialogue ne change rien', async () => {
    window.comptesBudget = fauxPont({ chooseBackupFolder: vi.fn().mockResolvedValue(null) });
    const s = await chooseDesktopFolder('Ma base');
    expect(s.configured).toBe(false);
    expect(window.comptesBudget.writeBackup).not.toHaveBeenCalled();
    expect(await db.settings.get('autoBackupKind')).toBeUndefined();
  });

  it('réécrit à chaque exécution, sous le nom du jour', async () => {
    let dossier: string | null = DOSSIER;
    const writeBackup = vi.fn().mockResolvedValue({ ok: true });
    window.comptesBudget = fauxPont({ chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockImplementation(async () => dossier), writeBackup });
    await chooseDesktopFolder('Ma base');
    await run(); await run();
    expect(writeBackup).toHaveBeenCalledTimes(3);
    expect(new Set(writeBackup.mock.calls.map(c => c[0])).size).toBe(1);   // même jour : même fichier, pas de prolifération
    dossier = null;
  });

  it('enregistre l’échec plutôt que de le masquer, et le rapporte', async () => {
    window.comptesBudget = fauxPont({
      chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockResolvedValue(DOSSIER),
      writeBackup: vi.fn().mockResolvedValue({ ok: false, error: 'Le dossier de sauvegarde est introuvable ou protégé en écriture.' }),
    });
    const s = await chooseDesktopFolder('Ma base');
    expect(s.lastError).toMatch(/introuvable ou protégé/);
    expect(s.lastRunAt).toBeUndefined();                                   // aucune réussite affichée
    expect(needsReminder(s)).toBe(true);                                   // et le rappel d'export reste actif
  });

  it('un dossier retiré entre-temps est signalé à l’exécution suivante', async () => {
    let dossier: string | null = DOSSIER;
    const writeBackup = vi.fn().mockResolvedValue({ ok: true });
    window.comptesBudget = fauxPont({ chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockImplementation(async () => dossier), writeBackup });
    await chooseDesktopFolder('Ma base');
    dossier = null;
    const s = await run();
    expect(s.lastError).toMatch(/Aucun dossier de sauvegarde/);
    expect(s.configured).toBe(false);
    expect(writeBackup).toHaveBeenCalledTimes(1);
  });

  it('sans le pont (navigateur), une destination « bureau » restée en mémoire échoue proprement', async () => {
    window.comptesBudget = fauxPont({ chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockResolvedValue(DOSSIER), writeBackup: vi.fn().mockResolvedValue({ ok: true }) });
    await chooseDesktopFolder('Ma base');
    delete window.comptesBudget;
    const s = await run();
    expect(s.lastError).toMatch(/édition bureau/);
  });

  it('refuse de choisir un dossier hors de l’édition bureau', async () => {
    await expect(chooseDesktopFolder('Ma base')).rejects.toThrow(/édition bureau/);
  });

  it('désactiver oublie le dossier côté application ET côté processus principal', async () => {
    const forget = vi.fn().mockResolvedValue(true);
    let dossier: string | null = DOSSIER;
    window.comptesBudget = fauxPont({
      chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockImplementation(async () => dossier),
      writeBackup: vi.fn().mockResolvedValue({ ok: true }),
      forgetBackupFolder: forget.mockImplementation(async () => { dossier = null; return true; }),
    });
    await chooseDesktopFolder('Ma base');
    await forgetFile();
    expect(forget).toHaveBeenCalledTimes(1);
    expect(await status()).toMatchObject({ configured: false });
    expect(await db.settings.get('autoBackupKind')).toBeUndefined();
    await run();
    expect(window.comptesBudget.writeBackup).toHaveBeenCalledTimes(1);   // plus rien après la désactivation
  });

  it('oublier une destination de navigateur n’appelle pas le pont', async () => {
    window.comptesBudget = fauxPont();
    await forgetFile();
    expect(window.comptesBudget.forgetBackupFolder).not.toHaveBeenCalled();
  });

  it('nomme la sauvegarde d’après la base, sans caractère interdit', async () => {
    const ecrits: string[] = [];
    window.comptesBudget = fauxPont({
      chooseBackupFolder: vi.fn().mockResolvedValue(DOSSIER), backupFolder: vi.fn().mockResolvedValue(DOSSIER),
      writeBackup: vi.fn().mockImplementation(async (n: string) => { ecrits.push(n); return { ok: true }; }),
    });
    await chooseDesktopFolder('Comptes <perso> / 2026 : "été"');
    expect(ecrits[0]).toMatch(/^[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.cbjson$/);
  });
});
