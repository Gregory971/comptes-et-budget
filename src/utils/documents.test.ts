import { describe, expect, it } from 'vitest';
import {
  baseName, documentKind, MAX_DOCUMENTS, MAX_LABEL, MAX_PATH, normalizeDocuments, replacePathPrefix, validateDocument,
} from './documents';

const doc = (path: string, label = 'Facture') => ({ label, path });

describe('nature d’un document', () => {
  it.each([
    ['https://exemple.fr/a.pdf', 'lien'], ['HTTP://exemple.fr', 'lien'],
    ['C:\\Docs\\a.pdf', 'fichier'], ['d:/Docs/a.pdf', 'fichier'], ['\\\\nas\\compta\\a.pdf', 'fichier'], ['/home/moi/a.pdf', 'fichier'],
  ])('%s → %s', (p, k) => expect(documentKind(p)).toBe(k));
  it.each(['a.pdf', 'Docs\\a.pdf', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x/a', 'file:///C:/a.pdf', '', '  '])('ne reconnaît pas %j', p =>
    expect(documentKind(p)).toBeNull());
});

describe('nom affiché', () => {
  it.each([
    ['C:\\Docs\\facture 2026.pdf', 'facture 2026.pdf'], ['/a/b/c.txt', 'c.txt'], ['https://x.fr/dossier/f.pdf?v=2#p3', 'f.pdf'],
    ['C:\\Docs\\Dossier\\', 'Dossier'], ['seul', 'seul'],
  ])('%s → %s', (p, n) => expect(baseName(p)).toBe(n));
});

describe('validation', () => {
  it('accepte un lien https et un chemin complet', () => {
    expect(validateDocument(doc('https://exemple.fr/a.pdf'))).toBeNull();
    expect(validateDocument(doc('C:\\Docs\\a.pdf'))).toBeNull();
    expect(validateDocument({ label: '', path: '/home/a.pdf' })).toBeNull();
  });

  it('refuse vide, relatif, schéma dangereux, http, caractères de contrôle et dépassements', () => {
    expect(validateDocument(doc('  '))).toMatch(/Indiquez le chemin/);
    expect(validateDocument(doc('facture.pdf'))).toMatch(/https:\/\/ ou le chemin complet/);
    expect(validateDocument(doc('javascript:alert(1)'))).toMatch(/https:\/\/ ou le chemin complet/);
    expect(validateDocument(doc('file:///C:/a.pdf'))).toMatch(/https:\/\/ ou le chemin complet/);
    expect(validateDocument(doc('http://exemple.fr/a'))).toMatch(/Seuls les liens https/);
    expect(validateDocument(doc('C:\\a\u0000.pdf'))).toMatch(/interdit/);
    expect(validateDocument(doc('C:\\a.pdf', 'x\ny'))).toMatch(/interdit/);
    expect(validateDocument(doc('C:\\' + 'a'.repeat(MAX_PATH)))).toMatch(/limité à 500/);
    expect(validateDocument(doc('C:\\a.pdf', 'x'.repeat(MAX_LABEL + 1)))).toMatch(/limité à 60/);
    expect(validateDocument(doc('https://'))).toMatch(/pas valide/);
  });
});

describe('normalisation d’une liste', () => {
  it('rend undefined pour une liste vide, nettoie et donne un nom par défaut', () => {
    expect(normalizeDocuments(undefined)).toBeUndefined();
    expect(normalizeDocuments([])).toBeUndefined();
    expect(normalizeDocuments([{ label: '  ', path: '  C:\\Docs\\facture.pdf ' }, doc('https://x.fr/t.pdf', ' Ticket ')]))
      .toEqual([{ label: 'facture.pdf', path: 'C:\\Docs\\facture.pdf' }, { label: 'Ticket', path: 'https://x.fr/t.pdf' }]);
  });
  it('lève une erreur lisible et plafonne la liste', () => {
    expect(() => normalizeDocuments([doc('relatif.pdf')])).toThrow(/chemin complet/);
    const trop = Array.from({ length: MAX_DOCUMENTS + 1 }, (_, i) => doc(`C:\\d\\${i}.pdf`));
    expect(() => normalizeDocuments(trop)).toThrow(/10 documents au plus/);
    expect(normalizeDocuments(trop.slice(0, MAX_DOCUMENTS))).toHaveLength(MAX_DOCUMENTS);
  });
});

describe('changement de début de chemin', () => {
  it('remplace le début, séparateurs et casse équivalents, le reste inchangé', () => {
    expect(replacePathPrefix('C:\\MesDocuments\\Compta\\a.pdf', 'C:\\MesDocuments', 'D:\\Archives')).toBe('D:\\Archives\\Compta\\a.pdf');
    expect(replacePathPrefix('c:/mesdocuments/Compta/a.pdf', 'C:\\MesDocuments', 'D:\\Archives')).toBe('D:\\Archives/Compta/a.pdf');
    expect(replacePathPrefix('C:\\MesDocuments\\a.pdf', 'C:\\MesDocuments\\', 'D:\\X\\')).toBe('D:\\X\\a.pdf');
    expect(replacePathPrefix('C:\\MesDocuments', 'C:\\MesDocuments', 'D:\\X')).toBe('D:\\X');
  });
  it('ne coupe pas au milieu d’un nom de dossier et ignore ce qui ne correspond pas', () => {
    expect(replacePathPrefix('C:\\Documents\\a.pdf', 'C:\\Doc', 'D:\\X')).toBeNull();
    expect(replacePathPrefix('D:\\Autre\\a.pdf', 'C:\\Doc', 'D:\\X')).toBeNull();
    expect(replacePathPrefix('https://x.fr/a.pdf', 'C:\\Doc', 'D:\\X')).toBeNull();
    expect(replacePathPrefix('C:\\Doc\\a.pdf', '  ', 'D:\\X')).toBeNull();
  });
});
