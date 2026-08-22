// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { decryptText, encryptText, isEncrypted, KDF_ITERATIONS } from './cryptoService';
import { backupService } from './backupService';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { db } from './db';
import { toCents } from '../utils/money';

// Les tests portent sur des textes courts : la dérivation PBKDF2 à 600 000
// itérations coûte quelques centaines de millisecondes par appel.
describe('sauvegarde chiffrée', () => {
  it('restitue exactement le contenu d’origine', async () => {
    const clair = JSON.stringify({ comptes: ['Courant'], soldeCents: 123456, note: 'accentué € œ' });
    const chiffre = await encryptText(clair, 'phrase de passe correcte');
    expect(await decryptText(chiffre, 'phrase de passe correcte')).toBe(clair);
  }, 20_000);

  it('ne laisse rien transparaître du contenu', async () => {
    const chiffre = await encryptText('SOLDE SECRET 4321', 'phrase');
    expect(chiffre).not.toContain('SOLDE');
    expect(chiffre).not.toContain('4321');
  }, 20_000);

  it('produit deux fichiers différents pour le même contenu', async () => {
    // Sel et vecteur d'initialisation tirés au hasard : sans cela, deux
    // sauvegardes identiques trahiraient qu'aucune modification n'a eu lieu.
    const a = await encryptText('même contenu', 'phrase');
    const b = await encryptText('même contenu', 'phrase');
    expect(a).not.toBe(b);
  }, 30_000);

  it('rejette une phrase secrète fausse', async () => {
    const chiffre = await encryptText('contenu', 'bonne phrase');
    await expect(decryptText(chiffre, 'mauvaise phrase'))
      .rejects.toThrow(/Phrase secrète incorrecte/);
  }, 30_000);

  it('rejette un fichier altéré au lieu de rendre des données fausses', async () => {
    const chiffre = await encryptText('contenu', 'phrase');
    const envelope = JSON.parse(chiffre);
    const bytes = atob(envelope.data).split('');
    bytes[0] = bytes[0] === 'A' ? 'B' : 'A';
    envelope.data = btoa(bytes.join(''));
    await expect(decryptText(JSON.stringify(envelope), 'phrase'))
      .rejects.toThrow(/incorrecte, ou fichier endommagé/);
  }, 30_000);

  it('annonce les paramètres de dérivation dans le fichier', async () => {
    const envelope = JSON.parse(await encryptText('x', 'phrase'));
    expect(envelope).toMatchObject({
      format: 'comptes-budget-chiffre', kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS,
    });
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  }, 20_000);

  it('reconnaît une sauvegarde chiffrée d’une sauvegarde en clair', async () => {
    expect(isEncrypted(await encryptText('x', 'phrase'))).toBe(true);
    expect(isEncrypted('{"format":"comptes-budget","version":3}')).toBe(false);
    expect(isEncrypted('n’importe quoi')).toBe(false);
  }, 20_000);

  it('refuse une phrase secrète vide', async () => {
    await expect(encryptText('x', '')).rejects.toThrow(/vide/);
  });
});

describe('sauvegarde chiffrée de bout en bout', () => {
  beforeEach(async () => {
    await Promise.all([db.databases.clear(), db.accounts.clear(), db.operations.clear()]);
    localStorage.clear();
  });

  it('se relit avec la bonne phrase et résiste sans elle', async () => {
    const base = await dbService.create('Comptes chiffrés');
    await accountService.create({
      dbId: base.id, name: 'Courant', type: 'courant',
      initialBalanceCents: toCents(1234.56), startDate: '2026-01-01',
    });

    const fichier = await backupService.serialize('phrase secrète du coffre');
    expect(isEncrypted(fichier)).toBe(true);
    expect(fichier).not.toContain('Comptes chiffrés');

    // Sans phrase : refus explicite, pas de plantage.
    await expect(backupService.inspect(fichier)).rejects.toThrow(/phrase secrète/i);

    const { summary } = await backupService.inspect(fichier, 'phrase secrète du coffre');
    expect(summary.databaseName).toBe('Comptes chiffrés');
    expect(summary.accounts).toBe(1);
  }, 40_000);

  it('laisse la sauvegarde en clair lisible comme avant', async () => {
    await dbService.create('Comptes en clair');
    const fichier = await backupService.serialize();
    expect(isEncrypted(fichier)).toBe(false);
    expect((await backupService.inspect(fichier)).summary.databaseName).toBe('Comptes en clair');
  });
});
