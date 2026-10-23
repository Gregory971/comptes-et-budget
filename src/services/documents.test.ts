// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { backupService } from './backupService';
import { previewDocumentPrefix, replaceDocumentPrefix } from './maintenanceService';
import type { Database } from '../types';

let base: Database;
let compte: string;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base documents', 'perso');
  compte = (await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
});

const op = (documents?: { label: string; path: string }[], over: object = {}) => operationService.create({
  dbId: base.id, accountId: compte, date: '2026-08-05', kind: 'depense', amountCents: 1000, documents, ...over,
});

describe('documents sur une opération', () => {
  it('enregistre des documents nettoyés, avec un nom par défaut', async () => {
    const o = await op([{ label: '', path: ' C:\\Docs\\facture.pdf ' }, { label: 'Ticket', path: 'https://x.fr/t.pdf' }]);
    expect(o.documents).toEqual([{ label: 'facture.pdf', path: 'C:\\Docs\\facture.pdf' }, { label: 'Ticket', path: 'https://x.fr/t.pdf' }]);
    expect((await db.operations.get(o.id))?.documents).toHaveLength(2);
  });

  it('refuse un document invalide sans rien écrire', async () => {
    await expect(op([{ label: 'x', path: 'relatif.pdf' }])).rejects.toThrow(/chemin complet/);
    await expect(op([{ label: 'x', path: 'javascript:alert(1)' }])).rejects.toThrow(/chemin complet/);
    expect(await db.operations.count()).toBe(0);
  });

  it('une opération sans document n’en porte pas', async () => {
    expect((await op()).documents).toBeUndefined();
    expect((await op([])).documents).toBeUndefined();
  });

  it('une modification sans rapport garde les documents, une liste vide les efface', async () => {
    const o = await op([{ label: 'F', path: 'C:\\Docs\\f.pdf' }]);
    await operationService.update(o.id, { label: 'Courses' });
    expect((await db.operations.get(o.id))?.documents).toHaveLength(1);
    await operationService.update(o.id, { documents: [{ label: 'G', path: 'C:\\Docs\\g.pdf' }] });
    expect((await db.operations.get(o.id))?.documents?.[0].label).toBe('G');
    await operationService.update(o.id, { documents: undefined });
    expect((await db.operations.get(o.id))?.documents).toBeUndefined();
  });

  it('refuse une modification invalide et garde l’ancienne valeur', async () => {
    const o = await op([{ label: 'F', path: 'C:\\Docs\\f.pdf' }]);
    await expect(operationService.update(o.id, { documents: [{ label: 'x', path: 'oups' }] })).rejects.toThrow(/chemin complet/);
    expect((await db.operations.get(o.id))?.documents?.[0].path).toBe('C:\\Docs\\f.pdf');
  });

  it('suit la sauvegarde', async () => {
    await op([{ label: 'F', path: 'C:\\Docs\\f.pdf' }]);
    const copie = await backupService.export();
    await db.operations.clear();
    await backupService.restore(copie, 'replace', false);
    expect((await db.operations.toArray())[0].documents?.[0].path).toBe('C:\\Docs\\f.pdf');
  });
});

describe('organisation des liens', () => {
  const doc = (path: string) => ({ label: 'D', path });

  it('compte puis remplace le début des chemins, sans toucher aux liens https ni aux autres dossiers', async () => {
    const a = await op([doc('C:\\MesDocuments\\Compta\\a.pdf'), doc('https://x.fr/a.pdf')]);
    const b = await op([doc('c:/mesdocuments/b.pdf')]);
    const c = await op([doc('D:\\Ailleurs\\c.pdf')]);
    const d = await op([doc('C:\\MesDocumentsBis\\d.pdf')]);

    expect(await previewDocumentPrefix(base.id, 'C:\\MesDocuments')).toEqual({ documents: 2, operations: 2 });
    expect(await replaceDocumentPrefix(base.id, 'C:\\MesDocuments', 'E:\\Archives')).toEqual({ documents: 2, operations: 2 });

    expect((await db.operations.get(a.id))?.documents?.map(x => x.path)).toEqual(['E:\\Archives\\Compta\\a.pdf', 'https://x.fr/a.pdf']);
    expect((await db.operations.get(b.id))?.documents?.[0].path).toBe('E:\\Archives/b.pdf');
    expect((await db.operations.get(c.id))?.documents?.[0].path).toBe('D:\\Ailleurs\\c.pdf');
    expect((await db.operations.get(d.id))?.documents?.[0].path).toBe('C:\\MesDocumentsBis\\d.pdf');
    expect(await previewDocumentPrefix(base.id, 'C:\\MesDocuments')).toEqual({ documents: 0, operations: 0 });
  });

  it('refuse un nouveau début invalide sans rien modifier, même quand seule une partie des liens est concernée', async () => {
    const a = await op([doc('C:\\MesDocuments\\a.pdf')]);
    const b = await op([doc('C:\\MesDocuments\\b.pdf')]);
    await expect(replaceDocumentPrefix(base.id, 'C:\\MesDocuments', 'relatif')).rejects.toThrow(/refusé/);
    await expect(replaceDocumentPrefix(base.id, 'C:\\MesDocuments', 'http://x.fr')).rejects.toThrow(/refusé/);
    expect((await db.operations.get(a.id))?.documents?.[0].path).toBe('C:\\MesDocuments\\a.pdf');
    expect((await db.operations.get(b.id))?.documents?.[0].path).toBe('C:\\MesDocuments\\b.pdf');
  });

  it('exige les deux débuts', async () => {
    await expect(replaceDocumentPrefix(base.id, '', 'D:\\X')).rejects.toThrow(/début du chemin à remplacer/);
    await expect(replaceDocumentPrefix(base.id, 'C:\\X', '  ')).rejects.toThrow(/nouveau début/);
  });

  it('ne touche qu’aux opérations de la base', async () => {
    const autre = await dbService.create('Autre', 'perso');
    const c2 = (await accountService.create({ dbId: autre.id, name: 'X', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })).id;
    const o = await operationService.create({ dbId: autre.id, accountId: c2, date: '2026-08-05', kind: 'depense', amountCents: 1, documents: [doc('C:\\MesDocuments\\x.pdf')] });
    await op([doc('C:\\MesDocuments\\a.pdf')]);
    await replaceDocumentPrefix(base.id, 'C:\\MesDocuments', 'E:\\Z');
    expect((await db.operations.get(o.id))?.documents?.[0].path).toBe('C:\\MesDocuments\\x.pdf');
  });
});
