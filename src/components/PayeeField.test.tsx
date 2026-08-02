// @vitest-environment jsdom
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { PayeeField } from './PayeeField';
import { payeeService } from '../services/referentialService';
import { db } from '../services/db';
import type { Payee } from '../types';

const DB = 'test-payee';

function Harness({ payees }: { payees: Payee[] }) {
  const [name, setName] = useState('');
  return <PayeeField payees={payees} value={name} onChange={setName} />;
}

describe('champ Tiers en saisie libre', () => {
  beforeEach(async () => { await db.payees.clear(); });
  afterEach(cleanup);

  it('accepte un nom libre sur une base sans aucun tiers', () => {
    // Régression : le menu déroulant était vide sur une base neuve — aucun tiers
    // n'étant créé à l'initialisation, la saisie était impossible.
    render(<Harness payees={[]} />);
    const input = screen.getByLabelText('Qui — tiers') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Carrefour' } });
    expect(input.value).toBe('Carrefour');
    expect(screen.getByText('« Carrefour » sera ajouté à vos tiers.')).toBeTruthy();
  });

  it('propose les tiers existants dans la liste d’autocomplétion', async () => {
    const a = await payeeService.create(DB, 'Carrefour');
    const b = await payeeService.create(DB, 'Employeur');
    render(<Harness payees={[a, b]} />);
    const options = document.querySelectorAll('datalist option');
    expect([...options].map(o => o.getAttribute('value'))).toEqual(['Carrefour', 'Employeur']);
  });

  it('n’annonce aucune création pour un tiers déjà connu', async () => {
    const edf = await payeeService.create(DB, 'EDF');
    render(<Harness payees={[edf]} />);
    fireEvent.change(screen.getByLabelText('Qui — tiers'), { target: { value: 'edf' } });
    expect(screen.queryByText(/sera ajouté/)).toBeNull();
  });

  it('masque les tiers archivés des propositions', async () => {
    const a = await payeeService.create(DB, 'Ancien fournisseur');
    await payeeService.archive(a.id);
    const all = await payeeService.list(DB, true);
    render(<Harness payees={all} />);
    expect(document.querySelectorAll('datalist option')).toHaveLength(0);
  });
});

describe('résolution du nom en identifiant de tiers', () => {
  beforeEach(async () => { await db.payees.clear(); });

  it('crée le tiers absent du référentiel', async () => {
    const id = await payeeService.resolveByName(DB, 'Netflix');
    expect(id).toBeTruthy();
    expect((await payeeService.list(DB)).map(p => p.name)).toEqual(['Netflix']);
  });

  it('réutilise un tiers existant sans le dupliquer', async () => {
    const edf = await payeeService.create(DB, 'EDF');
    expect(await payeeService.resolveByName(DB, 'EDF')).toBe(edf.id);
    expect(await payeeService.list(DB)).toHaveLength(1);
  });

  it('ignore casse, accents et espaces superflus', async () => {
    const p = await payeeService.create(DB, 'Épargne');
    expect(await payeeService.resolveByName(DB, '  epargne ')).toBe(p.id);
    expect(await payeeService.resolveByName(DB, 'ÉPARGNE')).toBe(p.id);
    expect(await payeeService.list(DB)).toHaveLength(1);
  });

  it('réactive un tiers archivé plutôt que d’en créer un doublon', async () => {
    const p = await payeeService.create(DB, 'GMF Assurance');
    await payeeService.archive(p.id);
    expect(await payeeService.resolveByName(DB, 'GMF Assurance')).toBe(p.id);
    expect((await payeeService.list(DB))).toHaveLength(1);   // non archivé
  });

  it('ne crée rien pour une saisie vide', async () => {
    expect(await payeeService.resolveByName(DB, '   ')).toBeUndefined();
    expect(await payeeService.list(DB, true)).toHaveLength(0);
  });
});
