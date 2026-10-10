// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { accountService } from './accountService';
import { operationService } from './operationService';
import { transferService } from './transferService';
import { categoryService } from './referentialService';
import { budgetService } from './budgetService';
import {
  budgetAlertService, budgetState, computeAlerts, DEFAULT_THRESHOLD, isDismissed,
  monthKey, normalizeThreshold, visibleAlerts, type BudgetAlert, type Dismissed,
} from './budgetAlertService';
import type { Budget } from '../types';

const budget = (categoryId: string, monthlyAmountCents: number): Budget => ({
  id: 'b-' + categoryId, dbId: 'd', categoryId, monthlyAmountCents, updatedAt: '',
});
const row = (categoryId: string, budgetCents: number, spentCents: number) =>
  ({ budget: budget(categoryId, budgetCents), spentCents });

describe('budgetState — niveaux d’alerte', () => {
  it('reste « ok » sous le seuil', () => {
    expect(budgetState(7999, 10000)).toBe('ok');
    expect(budgetState(1, 10000)).toBe('ok');
  });

  it('passe en « attention » à exactement 80 %', () => {
    expect(budgetState(8000, 10000)).toBe('attention');
    expect(budgetState(9999, 10000)).toBe('attention');
  });

  it('ne compare pas de flottants : 80 % exact même sur un budget « rond » difficile', () => {
    // 0,1 + 0,2 ≠ 0,3 en virgule flottante ; en centimes entiers, aucun écart.
    expect(budgetState(24, 30)).toBe('attention'); // 80 %
    expect(budgetState(23, 30)).toBe('ok');         // 76,7 %
    expect(budgetState(2401, 3001, 80)).toBe('attention'); // 80,007 %
    expect(budgetState(2400, 3001, 80)).toBe('ok');        // 79,97 %
  });

  it('est « attention » — pas « dépassé » — à exactement 100 %', () => {
    expect(budgetState(10000, 10000)).toBe('attention');
  });

  it('est « dépassé » dès le premier centime au-delà du budget', () => {
    expect(budgetState(10001, 10000)).toBe('depasse');
    expect(budgetState(25000, 10000)).toBe('depasse');
  });

  it('respecte le seuil choisi (70, 80, 90)', () => {
    expect(budgetState(7000, 10000, 70)).toBe('attention');
    expect(budgetState(6999, 10000, 70)).toBe('ok');
    expect(budgetState(8000, 10000, 90)).toBe('ok');
    expect(budgetState(9000, 10000, 90)).toBe('attention');
  });

  it('ne signale rien pour un mois sans dépense, budget nul compris', () => {
    expect(budgetState(0, 10000)).toBe('ok');
    expect(budgetState(0, 0)).toBe('ok');
  });

  it('traite un budget à 0 € comme dépassé dès la moindre dépense, sans diviser par zéro', () => {
    expect(budgetState(1, 0)).toBe('depasse');
    expect(budgetState(500, -100)).toBe('depasse'); // budget négatif hérité d’un import
    const [a] = computeAlerts([row('c', 0, 500)]);
    expect(a).toMatchObject({ level: 'depasse', overCents: 500, remainingCents: -500, percent: 0 });
    expect(Number.isFinite(a.percent)).toBe(true);
  });
});

describe('normalizeThreshold', () => {
  it('accepte 70, 80 et 90 et retombe sur 80 % sinon', () => {
    expect([70, 80, 90].map(normalizeThreshold)).toEqual([70, 80, 90]);
    for (const v of [0, 50, 100, NaN, '80', null, undefined]) {
      expect(normalizeThreshold(v)).toBe(DEFAULT_THRESHOLD);
    }
  });
});

describe('computeAlerts — tri et contenu', () => {
  it('ignore les budgets sans alerte et les catégories sans budget', () => {
    // Une catégorie dépensée mais sans budget n'a pas de ligne : rien à comparer.
    expect(computeAlerts([row('a', 10000, 1000), row('b', 10000, 0)])).toEqual([]);
    expect(computeAlerts([])).toEqual([]);
  });

  it('range les dépassements avant les attentions, du plus grave au moins grave', () => {
    const alerts = computeAlerts([
      row('att-85', 10000, 8500),
      row('dep-petit', 10000, 10500),
      row('att-95', 10000, 9500),
      row('dep-gros', 5000, 9000),
    ]);
    expect(alerts.map(a => a.categoryId))
      .toEqual(['dep-gros', 'dep-petit', 'att-95', 'att-85']);
    expect(alerts.map(a => a.level))
      .toEqual(['depasse', 'depasse', 'attention', 'attention']);
  });

  it('calcule reste, dépassement et pourcentage réel non plafonné', () => {
    const [att, dep] = [
      computeAlerts([row('a', 20000, 17000)])[0],
      computeAlerts([row('b', 20000, 25000)])[0],
    ];
    expect(att).toMatchObject({ remainingCents: 3000, overCents: 0, percent: 85 });
    expect(dep).toMatchObject({ remainingCents: -5000, overCents: 5000, percent: 125 });
  });

  it('applique le seuil passé en paramètre', () => {
    const rows = [row('a', 10000, 7500)];
    expect(computeAlerts(rows, 80)).toHaveLength(0);
    expect(computeAlerts(rows, 70)).toHaveLength(1);
  });

  it('départage les ex æquo de façon stable', () => {
    const alerts = computeAlerts([row('z', 10000, 9000), row('a', 10000, 9000)]);
    expect(alerts.map(a => a.categoryId)).toEqual(['a', 'z']);
  });
});

describe('masquage pour le mois', () => {
  const alert = (categoryId: string, level: BudgetAlert['level']): BudgetAlert => ({
    categoryId, level, budgetCents: 100, spentCents: 100, remainingCents: 0, overCents: 0, percent: 100,
  });
  const d = (levels: Dismissed['levels'], month = '2026-05'): Dismissed => ({ month, levels });

  it('masque tant que le niveau ne s’aggrave pas', () => {
    expect(isDismissed(alert('a', 'attention'), d({ a: 'attention' }), '2026-05')).toBe(true);
    expect(isDismissed(alert('a', 'depasse'), d({ a: 'depasse' }), '2026-05')).toBe(true);
    expect(isDismissed(alert('a', 'attention'), d({ a: 'depasse' }), '2026-05')).toBe(true);
  });

  it('réaffiche une alerte masquée en « attention » qui devient « dépassé »', () => {
    expect(isDismissed(alert('a', 'depasse'), d({ a: 'attention' }), '2026-05')).toBe(false);
  });

  it('oublie le masquage d’un mois révolu et ignore les autres catégories', () => {
    expect(isDismissed(alert('a', 'attention'), d({ a: 'attention' }, '2026-04'), '2026-05')).toBe(false);
    expect(isDismissed(alert('b', 'attention'), d({ a: 'attention' }), '2026-05')).toBe(false);
    expect(isDismissed(alert('a', 'attention'), undefined, '2026-05')).toBe(false);
  });

  it('filtre une liste d’alertes', () => {
    const all = [alert('a', 'depasse'), alert('b', 'attention')];
    expect(visibleAlerts(all, d({ b: 'attention' }), '2026-05').map(x => x.categoryId)).toEqual(['a']);
  });

  it('monthKey lit le mois civil local', () => {
    expect(monthKey(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 1))).toBe('2026-12');
  });
});

// ---------------------------------------------------------------------------
// Intégration : vraies dépenses du mois dans IndexedDB (simulé)
// ---------------------------------------------------------------------------

const ANCHOR = new Date(2026, 4, 15); // mai 2026
const MAI = (j: number) => `2026-05-${String(j).padStart(2, '0')}`;

describe('alertes sur les dépenses du mois', () => {
  let dbId: string;
  let accountId: string;
  let otherAccountId: string;
  let cat: { courses: string; loisirs: string; sante: string };

  beforeEach(async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    dbId = (await dbService.create('Test alertes', 'perso')).id;
    accountId = (await accountService.create({
      dbId, name: 'Courant', type: 'courant', initialBalanceCents: 100000, startDate: '2026-01-01',
    })).id;
    otherAccountId = (await accountService.create({
      dbId, name: 'Livret', type: 'epargne', initialBalanceCents: 0, startDate: '2026-01-01',
    })).id;
    const g = await categoryService.createGroup(dbId, 'Vie courante', 'depense');
    cat = {
      courses: (await categoryService.createCategory(dbId, g.id, 'Courses')).id,
      loisirs: (await categoryService.createCategory(dbId, g.id, 'Loisirs')).id,
      sante: (await categoryService.createCategory(dbId, g.id, 'Santé')).id,
    };
  });

  const depense = (categoryId: string, amountCents: number, date = MAI(10)) =>
    operationService.create({ dbId, accountId, date, amountCents, kind: 'depense', categoryId });

  it('monthlyStatus expose la consommation réelle sans casser le pourcentage plafonné', async () => {
    await budgetService.set(dbId, cat.courses, 10000);
    await depense(cat.courses, 12500);
    const [s] = await budgetService.monthlyStatus(dbId, ANCHOR);
    expect(s.percent).toBe(100);     // plafonné : affichage de la barre inchangé
    expect(s.rawPercent).toBe(125);  // réel : détection du dépassement
    expect(s.remainingCents).toBe(-2500);
  });

  it('monthlyStatus : rawPercent vaut 0 pour un budget nul, comme percent', async () => {
    await budgetService.set(dbId, cat.courses, 0);
    await depense(cat.courses, 300);
    const [s] = await budgetService.monthlyStatus(dbId, ANCHOR);
    expect(s.percent).toBe(0);
    expect(s.rawPercent).toBe(0);
  });

  it('détecte attention, dépassé et ok sur trois catégories', async () => {
    await budgetService.set(dbId, cat.courses, 10000);
    await budgetService.set(dbId, cat.loisirs, 10000);
    await budgetService.set(dbId, cat.sante, 10000);
    await depense(cat.courses, 8000);   // 80 % pile
    await depense(cat.loisirs, 10001);  // 1 centime de trop
    await depense(cat.sante, 7999);     // juste sous le seuil
    const rows = await budgetService.monthlyStatus(dbId, ANCHOR);
    const alerts = computeAlerts(rows);
    expect(alerts.map(a => [a.categoryId, a.level])).toEqual([
      [cat.loisirs, 'depasse'], [cat.courses, 'attention'],
    ]);
  });

  it('exclut virements, opérations supprimées, recettes et autres mois — comme spentByCategory', async () => {
    await budgetService.set(dbId, cat.courses, 10000);
    // Dépense réelle : 50 %.
    await depense(cat.courses, 5000);
    // Supprimée : ne compte pas.
    const supprimee = await depense(cat.courses, 9000);
    await operationService.remove(supprimee.id);
    // Recette dans la même catégorie : ne compte pas.
    await operationService.create({
      dbId, accountId, date: MAI(11), amountCents: 20000, kind: 'recette', categoryId: cat.courses,
    });
    // Autre mois : ne compte pas.
    await depense(cat.courses, 9000, '2026-04-30');
    await depense(cat.courses, 9000, '2026-06-01');
    // Virement : ne compte pas, même rattaché à la catégorie.
    await transferService.create({
      dbId, fromAccountId: accountId, toAccountId: otherAccountId, date: MAI(12), amountCents: 9000,
    });
    // Dépense sans catégorie : ne compte pas.
    await operationService.create({ dbId, accountId, date: MAI(13), amountCents: 9000, kind: 'depense' });

    const alerts = computeAlerts(await budgetService.monthlyStatus(dbId, ANCHOR));
    expect(alerts).toEqual([]);
    expect((await budgetService.monthlyStatus(dbId, ANCHOR))[0].spentCents).toBe(5000);
  });

  it('mois sans aucune dépense : aucune alerte', async () => {
    await budgetService.set(dbId, cat.courses, 10000);
    const report = await budgetAlertService.evaluate(dbId, ANCHOR);
    expect(report.alerts).toEqual([]);
    expect(report.hiddenCount).toBe(0);
  });

  it('catégorie dépensée mais sans budget : aucune alerte', async () => {
    await depense(cat.courses, 999999);
    const report = await budgetAlertService.evaluate(dbId, ANCHOR);
    expect(report.alerts).toEqual([]);
  });

  describe('réglages dans la table settings', () => {
    it('vaut « activé, 80 % » par défaut', async () => {
      expect(await budgetAlertService.getPrefs()).toEqual({ enabled: true, threshold: 80 });
    });

    it('enregistre l’activation et le seuil sans créer d’autre table', async () => {
      const tablesAvant = db.tables.map(t => t.name).sort();
      await budgetAlertService.setEnabled(false);
      await budgetAlertService.setThreshold(90);
      expect(await budgetAlertService.getPrefs()).toEqual({ enabled: false, threshold: 90 });
      expect((await db.settings.get('budgetAlerts.threshold'))?.value).toBe(90);
      expect(db.tables.map(t => t.name).sort()).toEqual(tablesAvant);
    });

    it('rejette un seuil hors liste à l’écriture comme à la lecture', async () => {
      await budgetAlertService.setThreshold(42);
      expect((await budgetAlertService.getPrefs()).threshold).toBe(80);
      await db.settings.put({ key: 'budgetAlerts.threshold', value: 'abc', updatedAt: '' });
      await db.settings.put({ key: 'budgetAlerts.enabled', value: 'oui', updatedAt: '' });
      expect(await budgetAlertService.getPrefs()).toEqual({ enabled: true, threshold: 80 });
    });

    it('applique le seuil et la désactivation à l’évaluation', async () => {
      await budgetService.set(dbId, cat.courses, 10000);
      await depense(cat.courses, 7500);
      expect((await budgetAlertService.evaluate(dbId, ANCHOR)).alerts).toHaveLength(0);

      await budgetAlertService.setThreshold(70);
      expect((await budgetAlertService.evaluate(dbId, ANCHOR)).alerts).toHaveLength(1);

      await budgetAlertService.setEnabled(false);
      expect(await budgetAlertService.evaluate(dbId, ANCHOR))
        .toMatchObject({ alerts: [], hiddenCount: 0 });
    });
  });

  describe('masquer une alerte pour le mois', () => {
    beforeEach(async () => {
      await budgetService.set(dbId, cat.courses, 10000);
      await depense(cat.courses, 8500);
    });

    it('masque l’alerte du mois en cours et la compte comme masquée', async () => {
      const [a] = (await budgetAlertService.evaluate(dbId, ANCHOR)).alerts;
      await budgetAlertService.dismiss(dbId, a, ANCHOR);
      expect(await budgetAlertService.evaluate(dbId, ANCHOR))
        .toMatchObject({ alerts: [], hiddenCount: 1 });
    });

    it('réaffiche l’alerte au mois suivant', async () => {
      const [a] = (await budgetAlertService.evaluate(dbId, ANCHOR)).alerts;
      await budgetAlertService.dismiss(dbId, a, ANCHOR);
      // Même masquage lu en juin : sans effet (et les dépenses de juin sont vides,
      // on vérifie donc le prédicat sur le masquage stocké).
      const stored = await budgetAlertService.getDismissed(dbId);
      expect(isDismissed(a, stored, monthKey(new Date(2026, 5, 2)))).toBe(false);
    });

    it('réaffiche l’alerte quand elle passe de « attention » à « dépassé »', async () => {
      const [a] = (await budgetAlertService.evaluate(dbId, ANCHOR)).alerts;
      await budgetAlertService.dismiss(dbId, a, ANCHOR);
      await depense(cat.courses, 2000); // 105 %
      const report = await budgetAlertService.evaluate(dbId, ANCHOR);
      expect(report.alerts).toHaveLength(1);
      expect(report.alerts[0].level).toBe('depasse');
    });

    it('est propre à chaque base', async () => {
      const [a] = (await budgetAlertService.evaluate(dbId, ANCHOR)).alerts;
      await budgetAlertService.dismiss(dbId, a, ANCHOR);
      expect(await budgetAlertService.getDismissed('autre-base')).toBeUndefined();
    });

    it('remplace un masquage de mois révolu au lieu de le conserver', async () => {
      await budgetAlertService.dismiss(dbId, { categoryId: 'vieux', level: 'depasse' }, new Date(2026, 3, 10));
      await budgetAlertService.dismiss(dbId, { categoryId: cat.courses, level: 'attention' }, ANCHOR);
      expect(await budgetAlertService.getDismissed(dbId)).toEqual({
        month: '2026-05', levels: { [cat.courses]: 'attention' },
      });
    });

    it('« réafficher » supprime les masquages', async () => {
      const [a] = (await budgetAlertService.evaluate(dbId, ANCHOR)).alerts;
      await budgetAlertService.dismiss(dbId, a, ANCHOR);
      await budgetAlertService.clearDismissed(dbId);
      expect((await budgetAlertService.evaluate(dbId, ANCHOR)).alerts).toHaveLength(1);
    });

    it('ignore une valeur stockée illisible', async () => {
      await db.settings.put({ key: `budgetAlerts.dismissed.${dbId}`, value: 'n’importe quoi', updatedAt: '' });
      expect(await budgetAlertService.getDismissed(dbId)).toBeUndefined();
      await db.settings.put({
        key: `budgetAlerts.dismissed.${dbId}`, updatedAt: '',
        value: { month: '2026-05', levels: { a: 'rouge', b: 'attention' } },
      });
      expect(await budgetAlertService.getDismissed(dbId))
        .toEqual({ month: '2026-05', levels: { b: 'attention' } });
    });
  });
});
