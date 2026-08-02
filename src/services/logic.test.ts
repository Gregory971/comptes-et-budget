import { describe, expect, it } from 'vitest';
import { signed } from './operationService';
import { advance } from './scheduleService';
import { periodRange, shiftAnchor } from './reportService';
import { upgradeBackup, type Backup } from './backupService';

describe('signe des montants', () => {
  it('rend une dépense négative et une recette positive', () => {
    expect(signed('depense', 1250)).toBe(-1250);
    expect(signed('depense', -1250)).toBe(-1250);
    expect(signed('recette', 1250)).toBe(1250);
    expect(signed('recette', -1250)).toBe(1250);
  });

  it('préserve le signe d’un virement', () => {
    // Régression P1 : « virement » retombait sur la branche « recette » et
    // transformait le débit du compte source en crédit.
    expect(signed('virement', -1250)).toBe(-1250);
    expect(signed('virement', 1250)).toBe(1250);
  });
});

describe('périodicité des échéances', () => {
  it('avance selon la périodicité', () => {
    expect(advance('2026-08-15', 'mensuelle')).toBe('2026-09-15');
    expect(advance('2026-08-15', 'trimestrielle')).toBe('2026-11-15');
    expect(advance('2026-08-15', 'annuelle')).toBe('2027-08-15');
    expect(advance('2026-08-15', 'unique')).toBe('2026-08-15');
  });

  it('borne au dernier jour du mois cible', () => {
    expect(advance('2026-01-31', 'mensuelle')).toBe('2026-02-28');
    expect(advance('2026-11-30', 'trimestrielle')).toBe('2027-02-28');
  });
});

describe('bornes de période', () => {
  it('couvre le mois entier sans décalage de fuseau', () => {
    expect(periodRange(new Date(2026, 7, 15), 'mois'))
      .toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('couvre le trimestre et l’année', () => {
    expect(periodRange(new Date(2026, 7, 15), 'trimestre'))
      .toMatchObject({ from: '2026-07-01', to: '2026-09-30', label: 'T3 2026' });
    expect(periodRange(new Date(2026, 7, 15), 'annee'))
      .toMatchObject({ from: '2026-01-01', to: '2026-12-31', label: '2026' });
  });

  it('reste stable quel que soit le moment de la journée', () => {
    const minuit = periodRange(new Date(2026, 7, 1, 0, 0, 0), 'mois');
    const soir = periodRange(new Date(2026, 7, 31, 23, 59, 59), 'mois');
    expect(minuit).toEqual(soir);
  });

  it('navigue d’une période à l’autre', () => {
    const base = new Date(2026, 0, 31, 12);
    expect(periodRange(shiftAnchor(base, 'mois', 1), 'mois').from).toBe('2026-02-01');
    expect(periodRange(shiftAnchor(base, 'mois', -1), 'mois').from).toBe('2025-12-01');
    expect(periodRange(shiftAnchor(base, 'annee', 1), 'annee').label).toBe('2027');
  });
});

describe('reprise des sauvegardes v1', () => {
  it('convertit euros → centimes et ISO → date civile', () => {
    const v1 = {
      format: 'comptes-budget', version: 1, exportedAt: '2026-06-01T10:00:00.000Z',
      database: { id: 'b1', name: 'Perso', currency: 'EUR', createdAt: '2026-01-01T00:00:00.000Z' },
      accounts: [{ id: 'a1', dbId: 'b1', name: 'Courant', type: 'courant', initialBalance: 1500.5, startDate: '2026-01-01T00:00:00.000Z' }],
      operations: [{ id: 'o1', dbId: 'b1', accountId: 'a1', date: '2026-08-01T00:00:00.000Z', amount: -95.4, kind: 'depense', checked: false, createdAt: '2026-08-01T09:00:00.000Z' }],
      budgets: [{ id: 'bu1', dbId: 'b1', categoryId: 'c1', monthlyAmount: 300 }],
    } as unknown as Backup;

    const out = upgradeBackup(v1);
    expect(out.version).toBe(2);
    expect(out.accounts[0].initialBalanceCents).toBe(150050);
    expect(out.accounts[0].startDate).toBe('2026-01-01');
    expect(out.operations[0].amountCents).toBe(-9540);
    expect(out.operations[0].date).toBe('2026-08-01');
    expect(out.budgets[0].monthlyAmountCents).toBe(30000);
    expect(out.accounts[0].updatedAt).toBeTruthy();
  });
});
