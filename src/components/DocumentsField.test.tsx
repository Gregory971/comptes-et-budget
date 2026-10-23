// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentsField } from './DocumentsField';
import { fauxPont } from '../utils/fauxPont';
import { OperationForm } from './OperationForm';
import { MaintenanceTab } from '../screens/MaintenanceTab';
import { OperationsScreen } from '../screens/OperationsScreen';
import { db } from '../services/db';
import { dbService } from '../services/dbService';
import { accountService } from '../services/accountService';
import { operationService, type OperationInput } from '../services/operationService';
import type { Account, Database, DocumentLink } from '../types';

let base: Database;
let comptes: Account[];

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base documents UI', 'perso');
  comptes = [await accountService.create({ dbId: base.id, name: 'Courant', type: 'courant', initialBalanceCents: 0, startDate: '2026-01-01' })];
  delete window.comptesBudget;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.comptesBudget; });

const saisir = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

/** Champ piloté comme dans un formulaire : l'état vit hors du composant. */
function Hote({ initial = [] as DocumentLink[], onChange }: { initial?: DocumentLink[]; onChange?: (d: DocumentLink[]) => void }) {
  const [docs, setDocs] = useState(initial);
  return <DocumentsField docs={docs} onChange={d => { setDocs(d); onChange?.(d); }} />;
}

describe('champ « Documents liés »', () => {
  it('associe un chemin saisi, avec un nom par défaut', () => {
    const vu: DocumentLink[][] = [];
    render(<Hote onChange={d => vu.push(d)} />);
    saisir(screen.getByLabelText('Chemin du fichier ou lien https'), 'C:\\Docs\\facture.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Associer' }));
    expect(vu[vu.length - 1]).toEqual([{ label: 'facture.pdf', path: 'C:\\Docs\\facture.pdf' }]);
    expect(screen.getByText('facture.pdf')).toBeTruthy();
    expect((screen.getByLabelText('Chemin du fichier ou lien https') as HTMLInputElement).value).toBe('');
  });

  it('associe avec la touche Entrée sans valider le formulaire', () => {
    const vu: DocumentLink[][] = [];
    render(<Hote onChange={d => vu.push(d)} />);
    saisir(screen.getByLabelText('Nom (facultatif)'), 'Facture EDF');
    saisir(screen.getByLabelText('Chemin du fichier ou lien https'), 'https://exemple.fr/edf.pdf');
    fireEvent.keyDown(screen.getByLabelText('Chemin du fichier ou lien https'), { key: 'Enter' });
    expect(vu[vu.length - 1]).toEqual([{ label: 'Facture EDF', path: 'https://exemple.fr/edf.pdf' }]);
  });

  it('refuse un chemin relatif et un schéma dangereux, en le disant', () => {
    render(<Hote />);
    const champ = screen.getByLabelText('Chemin du fichier ou lien https');
    for (const mauvais of ['facture.pdf', 'javascript:alert(1)', 'http://exemple.fr']) {
      saisir(champ, mauvais);
      fireEvent.click(screen.getByRole('button', { name: 'Associer' }));
      expect(screen.getByRole('alert')).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Ouvrir le document/ })).toBeNull();
  });

  it('désactive « Associer » tant que le chemin est vide', () => {
    render(<Hote />);
    expect((screen.getByRole('button', { name: 'Associer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('retire un document', () => {
    const vu: DocumentLink[][] = [];
    render(<Hote initial={[{ label: 'A', path: 'C:\\a.pdf' }, { label: 'B', path: 'C:\\b.pdf' }]} onChange={d => vu.push(d)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le document A' }));
    expect(vu[vu.length - 1]).toEqual([{ label: 'B', path: 'C:\\b.pdf' }]);
  });

  it('plafonne à dix documents', () => {
    const dix = Array.from({ length: 10 }, (_, i) => ({ label: `D${i}`, path: `C:\\d${i}.pdf` }));
    render(<Hote initial={dix} />);
    saisir(screen.getByLabelText('Chemin du fichier ou lien https'), 'C:\\onze.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Associer' }));
    expect(screen.getByRole('alert').textContent).toMatch(/10 documents au plus/);
  });

  it('ouvre un lien https dans un nouvel onglet, sans transmettre la page d’origine', () => {
    const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Hote initial={[{ label: 'Lien', path: 'https://exemple.fr/a.pdf' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document Lien' }));
    expect(ouvrir).toHaveBeenCalledWith('https://exemple.fr/a.pdf', '_blank', 'noopener,noreferrer');
  });

  it('explique qu’un fichier local ne s’ouvre que dans l’édition bureau', async () => {
    const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Hote initial={[{ label: 'Local', path: 'C:\\Docs\\a.pdf' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document Local' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/édition bureau/);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Choisir un fichier…' })).toBeNull();
  });

  describe('dans l’édition bureau', () => {
    it('choisit un fichier par la boîte de dialogue du système', async () => {
      window.comptesBudget = fauxPont({ pickFile: vi.fn().mockResolvedValue('D:\\Scans\\ticket.jpg') });
      const vu: DocumentLink[][] = [];
      render(<Hote onChange={d => vu.push(d)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }));
      await waitFor(() => expect(vu[vu.length - 1]).toEqual([{ label: 'ticket.jpg', path: 'D:\\Scans\\ticket.jpg' }]));
    });

    it('ne fait rien quand l’utilisateur annule la boîte de dialogue', async () => {
      const pickFile = vi.fn().mockResolvedValue(null);
      window.comptesBudget = fauxPont({ pickFile });
      const vu: DocumentLink[][] = [];
      render(<Hote onChange={d => vu.push(d)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }));
      await waitFor(() => expect(pickFile).toHaveBeenCalled());
      expect(vu).toEqual([]);
    });

    it('un fichier choisi est refusé s’il n’est pas valide, et le dit', async () => {
      window.comptesBudget = fauxPont({ pickFile: vi.fn().mockResolvedValue('relatif.pdf') });
      render(<Hote />);
      fireEvent.click(screen.getByRole('button', { name: 'Choisir un fichier…' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/chemin complet/);
    });

    it('ouvre un fichier par le pont et relaie son refus', async () => {
      const openPath = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'Fichier introuvable : il a peut-être été déplacé.' });
      window.comptesBudget = fauxPont({ openPath });
      render(<Hote initial={[{ label: 'Local', path: 'C:\\Docs\\a.pdf' }]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document Local' }));
      await waitFor(() => expect(openPath).toHaveBeenCalledWith('C:\\Docs\\a.pdf'));
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document Local' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/introuvable/);
    });
  });
});

describe('formulaire d’opération', () => {
  it('transmet les documents, et une liste vide pour effacer ceux d’une opération modifiée', async () => {
    const envois: Omit<OperationInput, 'dbId'>[] = [];
    render(<OperationForm dbId={base.id} accounts={comptes} submitLabel="Enregistrer"
      initial={{ kind: 'depense', amountCents: -1000, accountId: comptes[0].id, documents: [{ label: 'Facture', path: 'C:\\Docs\\f.pdf' }] }}
      onSubmit={i => { envois.push(i); }} />);
    expect(screen.getByText('Facture')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].documents).toEqual([{ label: 'Facture', path: 'C:\\Docs\\f.pdf' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Retirer le document Facture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(envois).toHaveLength(2));
    expect('documents' in envois[1]).toBe(true);
    expect(envois[1].documents).toBeUndefined();
  });
});

describe('liste des opérations', () => {
  it('signale les opérations qui portent des documents', async () => {
    const maintenant = new Date();
    const date = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-01`;
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date, kind: 'depense', amountCents: 500, label: 'Avec pièces',
      documents: [{ label: 'A', path: 'C:\\a.pdf' }, { label: 'B', path: 'C:\\b.pdf' }] });
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date, kind: 'depense', amountCents: 500, label: 'Sans pièce' });
    render(<OperationsScreen database={base} />);
    const ligne = (await screen.findByText('Avec pièces')).closest('tr') as HTMLElement;
    expect(ligne.textContent).toMatch(/2 documents/);
    expect(((await screen.findByText('Sans pièce')).closest('tr') as HTMLElement).textContent).not.toMatch(/document/);
  });
});

describe('Préférences → Maintenance → liens', () => {
  it('annonce combien de liens seront corrigés puis les corrige après confirmation', async () => {
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date: '2026-08-05', kind: 'depense', amountCents: 500,
      documents: [{ label: 'A', path: 'C:\\MesDocuments\\a.pdf' }] });
    render(<MaintenanceTab database={base} />);
    saisir(screen.getByLabelText('Début actuel du chemin'), 'C:\\MesDocuments');
    saisir(screen.getByLabelText('Nouveau début'), 'E:\\Archives');
    await waitFor(() => expect(document.body.textContent).toMatch(/1 lien sera corrigé dans 1 opération/));
    fireEvent.click(screen.getByRole('button', { name: 'Corriger les liens' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corriger les liens' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Corriger' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/1 lien corrigé dans 1 opération/));
    expect((await db.operations.toArray())[0].documents?.[0].path).toBe('E:\\Archives\\a.pdf');
  });

  it('refuse un nouveau début invalide en le disant', async () => {
    await operationService.create({ dbId: base.id, accountId: comptes[0].id, date: '2026-08-05', kind: 'depense', amountCents: 500,
      documents: [{ label: 'A', path: 'C:\\MesDocuments\\a.pdf' }] });
    render(<MaintenanceTab database={base} />);
    saisir(screen.getByLabelText('Début actuel du chemin'), 'C:\\MesDocuments');
    saisir(screen.getByLabelText('Nouveau début'), 'relatif');
    await waitFor(() => expect(document.body.textContent).toMatch(/1 lien sera corrigé/));
    fireEvent.click(screen.getByRole('button', { name: 'Corriger les liens' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Corriger les liens' })).getByRole('button', { name: 'Corriger' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/refusé/);
    expect((await db.operations.toArray())[0].documents?.[0].path).toBe('C:\\MesDocuments\\a.pdf');
  });
});
