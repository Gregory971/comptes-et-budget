import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Le module est partagé avec le processus principal d'Electron (CommonJS).
const policy = createRequire(import.meta.url)('../../desktop/openPolicy.cjs') as {
  isAbsoluteFilePath: (p: string) => boolean;
  isOpenableUrl: (v: string) => boolean;
  extensionOf: (p: string) => string;
  refusalForPath: (p: unknown) => string | null;
};

describe('chemin absolu', () => {
  it.each(['C:\\Docs\\a.pdf', 'c:/Docs/a.pdf', '\\\\serveur\\partage\\a.pdf', '/home/moi/a.pdf'])('reconnaît %s', p =>
    expect(policy.isAbsoluteFilePath(p)).toBe(true));
  it.each(['a.pdf', 'Docs\\a.pdf', './a.pdf', '../a.pdf', '//a.pdf', '\\\\serveur', 'C:a.pdf', '', 'https://x.fr/a.pdf'])('refuse %j', p =>
    expect(policy.isAbsoluteFilePath(p)).toBe(false));
});

describe('lien web', () => {
  it('n’accepte que https avec un hôte', () => {
    expect(policy.isOpenableUrl('https://exemple.fr/facture.pdf')).toBe(true);
    for (const v of ['http://exemple.fr', 'file:///C:/a.pdf', 'javascript:alert(1)', 'data:text/html,<b>', 'ftp://x', 'https://', 'exemple.fr', '']) {
      expect(policy.isOpenableUrl(v), v).toBe(false);
    }
  });
});

describe('extension', () => {
  it.each([['a.PDF', 'pdf'], ['C:\\x\\b.tar.gz', 'gz'], ['a', ''], ['.bashrc', ''], ['a.exe.', 'exe'], ['a.exe  ', 'exe'], ['C:\\x.y\\fichier', '']])('%s → %j', (p, e) =>
    expect(policy.extensionOf(p)).toBe(e));
});

describe('refus d’ouverture', () => {
  it.each(['C:\\Docs\\facture.pdf', 'D:/Scans/ticket.jpg', '\\\\nas\\compta\\2025\\bilan.xlsx', '/home/moi/note.txt', 'C:\\Docs\\sans-extension'])('autorise %s', p =>
    expect(policy.refusalForPath(p)).toBeNull());

  it.each([
    ['C:\\x\\setup.exe', /programmes/], ['C:\\x\\run.BAT', /programmes/], ['C:\\x\\a.ps1', /programmes/], ['C:\\x\\a.lnk', /programmes/],
    ['C:\\x\\a.js', /programmes/], ['C:\\x\\a.msi', /programmes/], ['C:\\x\\a.jar', /programmes/], ['/usr/bin/script.sh', /programmes/],
    ['C:\\x\\a.exe.', /programmes/], ['C:\\x\\A.ExE', /programmes/],
  ])('refuse le programme %s', (p, motif) => expect(policy.refusalForPath(p)).toMatch(motif));

  it('refuse les chemins relatifs, vides, trop longs, avec contrôle ou remontée', () => {
    expect(policy.refusalForPath('facture.pdf')).toMatch(/chemin complet/);
    expect(policy.refusalForPath('')).toMatch(/vide/);
    expect(policy.refusalForPath(undefined)).toMatch(/vide/);
    expect(policy.refusalForPath('C:\\' + 'a'.repeat(600) + '.pdf')).toMatch(/trop long/);
    expect(policy.refusalForPath('C:\\x\u0000.pdf')).toMatch(/interdit/);
    expect(policy.refusalForPath('C:\\x\\..\\y\\a.pdf')).toMatch(/remonter/);
    expect(policy.refusalForPath('/x/../etc/a.pdf')).toMatch(/remonter/);
  });

  it('refuse les flux de données alternatifs NTFS', () => {
    expect(policy.refusalForPath('C:\\x\\a.pdf:cache.exe')).toMatch(/invalide/);
    expect(policy.refusalForPath('/x/a.pdf:flux')).toMatch(/invalide/);
  });

  it('un nom de dossier contenant des points n’est pas pris pour une extension', () => {
    expect(policy.refusalForPath('C:\\x.exe\\readme.txt')).toBeNull();
  });
});
