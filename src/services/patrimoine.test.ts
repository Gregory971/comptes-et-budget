import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { projectService, savedFrom } from './patrimoineService';
import { toCents } from '../utils/money';

const DB = 'test-projets';

async function reset() {
  await Promise.all([db.operations.clear(), db.accounts.clear(), db.projects.clear()]);
  await accountService.create({
    dbId: DB, name: 'Courant', type: 'courant',
    initialBalanceCents: toCents(3000), startDate: '2026-01-01',
  });
}

describe('projets d’épargne : une seule épargne affichée', () => {
  beforeEach(reset);

  it('additionne le solde d’ouverture et les mouvements rattachés', async () => {
    // Avant correction, l'écran montrait côte à côte « déjà épargné » (saisi à
    // la main) et le total des opérations rattachées, sans qu'aucun des deux
    // ne fasse foi : deux vérités pour un même projet.
    const p = await projectService.create(DB, {
      name: 'Vacances', targetAmountCents: toCents(2000), openingSavedCents: toCents(500),
    });
    const acc = (await accountService.list(DB))[0];

    // Une somme mise de côté quitte le compte : elle est enregistrée en négatif.
    await operationService.create({
      dbId: DB, accountId: acc.id, date: '2026-08-05',
      amountCents: toCents(300), kind: 'depense', projectId: p.id,
    });

    const [st] = await projectService.status(DB);
    expect(st.savedCents).toBe(toCents(800));
    expect(st.percent).toBeCloseTo(40, 5);
  });

  it('diminue l’épargne quand une reprise est rattachée au projet', async () => {
    const p = await projectService.create(DB, {
      name: 'Apport', targetAmountCents: toCents(1000), openingSavedCents: toCents(400),
    });
    const acc = (await accountService.list(DB))[0];
    await operationService.create({
      dbId: DB, accountId: acc.id, date: '2026-08-06',
      amountCents: toCents(150), kind: 'recette', projectId: p.id,
    });
    const [st] = await projectService.status(DB);
    expect(st.savedCents).toBe(toCents(250));
  });

  it('borne l’avancement entre 0 et 100 %', async () => {
    const p = await projectService.create(DB, {
      name: 'Dépassé', targetAmountCents: toCents(100), openingSavedCents: toCents(300),
    });
    expect((await projectService.status(DB))[0].percent).toBe(100);
    await projectService.update(p.id, { openingSavedCents: toCents(-50) });
    expect((await projectService.status(DB))[0].percent).toBe(0);
  });

  it('n’affecte que le solde d’ouverture lors d’un ajustement manuel', async () => {
    const p = await projectService.create(DB, {
      name: 'Livret', targetAmountCents: toCents(1000), openingSavedCents: toCents(100),
    });
    await projectService.addSaving(p.id, toCents(50));
    expect((await db.projects.get(p.id))?.openingSavedCents).toBe(toCents(150));
    // Le solde ne descend jamais sous zéro.
    await projectService.addSaving(p.id, toCents(-500));
    expect((await db.projects.get(p.id))?.openingSavedCents).toBe(0);
  });

  it('applique la convention de signe de façon isolée', () => {
    expect(savedFrom(toCents(500), toCents(-300))).toBe(toCents(800));
    expect(savedFrom(toCents(500), toCents(120))).toBe(toCents(380));
  });
});
