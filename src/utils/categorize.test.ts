import { describe, expect, it } from 'vitest';
import {
  buildHistoryIndex, isApplied, patternOf, propose, significantTokens,
  type CategorizerContext, type LineKind,
} from './categorize';
import type { CategorizationRule, Operation, Payee } from '../types';

/* --------------------------------------------------------------- données */

const DB = 'b1';
const CATS: Record<string, LineKind> = {
  courses: 'depense', carburant: 'depense', energie: 'depense', restaurants: 'depense',
  abonnements: 'depense', loyer: 'depense', telephone: 'depense', liquide: 'depense',
  salaire: 'recette', remboursement: 'recette',
};
const categoryKinds = new Map<string, LineKind>(Object.entries(CATS));

let seq = 0;
const op = (label: string, categoryId: string, extra: Partial<Operation> = {}): Operation => ({
  id: `o${++seq}`, dbId: DB, accountId: 'a1', date: '2026-07-01',
  amountCents: CATS[categoryId] === 'recette' ? 10000 : -10000,
  kind: CATS[categoryId], label, categoryId, checked: true,
  createdAt: '', updatedAt: '', ...extra,
});
const many = (n: number, label: string, categoryId: string) =>
  Array.from({ length: n }, () => op(label, categoryId));

const payee = (id: string, name: string, defaultCategoryId?: string, archived = false): Payee =>
  ({ id, dbId: DB, name, defaultCategoryId, archived, updatedAt: '' });

const rule = (pattern: string, categoryId: string, extra: Partial<CategorizationRule> = {}): CategorizationRule => ({
  id: `r-${pattern}`, dbId: DB, pattern, kind: CATS[categoryId], categoryId, hits: 1,
  origin: 'correction', disabled: false, createdAt: '2026-08-01', updatedAt: '2026-08-01', ...extra,
});

function ctx(ops: Operation[] = [], payees: Payee[] = [], rules: CategorizationRule[] = []): CategorizerContext {
  return {
    payees, categoryKinds, rules,
    history: buildHistoryIndex(ops, {
      payeeNames: new Map(payees.map(p => [p.id, p.name])), categoryKinds,
    }),
  };
}

const ask = (label: string, euros: number, c: CategorizerContext) =>
  propose(label, Math.round(euros * 100), c);

/* ------------------------------------------------- normalisation des libellés */

describe('motif stable d’un libellé bancaire', () => {
  it('donne le même motif quelle que soit la mise en forme de la banque', () => {
    const variantes = [
      'CARREFOUR MARKET 0123 PARIS',
      'PAIEMENT CB 0508 CARREFOUR MARKET PARIS',
      'CARTE X1234 05/08 CARREFOUR MARKET',
      'PAIEMENT PAR CARTE X1234 CARREFOUR MARKET 05/08/26',
      'Carrefour Market 75012 Paris CB*1234',
    ];
    for (const v of variantes) expect(patternOf(v), v).toBe('carrefour market');
  });

  it('retire références de mandat, numéros et mots administratifs d’un prélèvement', () => {
    expect(patternOf('PRLV SEPA EDF CLIENTS PART. REF 1234567890 MDT A1B2C3')).toBe('edf');
    expect(patternOf('PRELEVEMENT FREE MOBILE 0123456789 08/26')).toBe('free mobile');
    expect(patternOf('PRLV SEPA NETFLIX.COM 0000123 ECH 05/08')).toBe('netflix');
  });

  it('écarte les mois et les formes juridiques d’un virement', () => {
    expect(patternOf('VIR SEPA RECU DE SARL DUPONT SALAIRE AOUT 2026')).toBe('dupont salaire');
    expect(patternOf('VIR SEPA RECU DE SARL DUPONT SALAIRE SEPTEMBRE 2026')).toBe('dupont salaire');
    expect(patternOf('VIR INST M JEAN MARTIN LOYER')).toBe('jean martin');
  });

  it('ramène tout retrait d’espèces au même motif', () => {
    expect(patternOf('RETRAIT DAB 05/08 BNP PARIS 75012')).toBe('retrait especes');
    expect(patternOf('CARTE X1234 RETRAIT DAB SG LYON')).toBe('retrait especes');
  });

  it('garde les enseignes collées à un intermédiaire de paiement', () => {
    expect(patternOf('AMZN MKTP FR*2K4TY')).toBe('amzn mktp');
    expect(patternOf('PAYPAL *SPOTIFY 35314369001')).toBe('paypal spotify');
  });

  it('ne retient rien d’un libellé fait de chiffres et de bruit', () => {
    expect(significantTokens('04/08 123456 CB')).toEqual([]);
    expect(patternOf('')).toBe('');
  });
});

/* ------------------------------------------------------- apprentissage */

describe('proposition d’après l’historique', () => {
  it('reconnaît une enseigne déjà classée plusieurs fois (confiance haute)', () => {
    const c = ctx(many(4, 'CARREFOUR MARKET 0123 PARIS', 'courses'));
    const p = ask('PAIEMENT CB 0509 CARREFOUR MARKET LYON', -37.2, c);
    expect(p).toMatchObject({ source: 'historique', confidence: 'haute', categoryId: 'courses' });
    expect(isApplied(p)).toBe(true);
    expect(p!.basis).toContain('carrefour market');
  });

  it('apprend aussi des libellés saisis à la main, plus courts que ceux de la banque', () => {
    const c = ctx(many(3, 'Courses Carrefour', 'courses'));
    const p = ask('CARREFOUR MARKET 0123 PARIS', -20, c);
    expect(p).toMatchObject({ categoryId: 'courses', confidence: 'moyenne' });
    expect(isApplied(p)).toBe(true);
  });

  it('apprend du tiers rattaché à l’opération, même sans libellé', () => {
    const edf = payee('p-edf', 'EDF');
    const ops = many(3, '', 'energie').map(o => ({ ...o, payeeId: 'p-edf' }));
    const p = ask('PRLV SEPA EDF CLIENTS REF 998877', -64, ctx(ops, [edf]));
    // Le nom du tiers est lui-même reconnu dans le libellé ; la catégorie vient de l’historique.
    expect(p).toMatchObject({ payeeId: 'p-edf', categoryId: 'energie' });
    expect(isApplied(p)).toBe(true);
  });

  it('propose le tiers dominant de l’historique avec la catégorie', () => {
    const ops = many(3, 'FREE MOBILE 0123', 'telephone').map(o => ({ ...o, payeeId: 'p-free' }));
    const p = ask('PRELEVEMENT FREE MOBILE 998877 08/26', -19.99, ctx(ops, [payee('p-free', 'Opérateur mobile')]));
    expect(p).toMatchObject({ source: 'historique', categoryId: 'telephone', payeeId: 'p-free' });
  });

  it('une seule occurrence passée ne suffit pas à classer : simple suggestion', () => {
    const p = ask('BOULANGERIE PAUL 0508', -4.5, ctx([op('BOULANGERIE PAUL 0101', 'courses')]));
    expect(p?.confidence).toBe('faible');
    expect(p?.categoryId).toBe('courses');
    expect(isApplied(p)).toBe(false);
  });

  it('distingue deux produits de la même enseigne grâce au second mot', () => {
    const ops = [...many(3, 'TOTAL ENERGIES 0508', 'energie'), ...many(3, 'TOTAL ACCESS 0508', 'carburant')];
    const c = ctx(ops);
    expect(ask('PRLV TOTAL ENERGIES 08/26', -80, c)).toMatchObject({ categoryId: 'energie' });
    expect(ask('CB TOTAL ACCESS 0508', -55, c)).toMatchObject({ categoryId: 'carburant' });
  });

  it('ne classe pas un libellé ambigu : plusieurs catégories, aucune imposée', () => {
    const ops = [...many(2, 'TOTAL 0508', 'carburant'), ...many(2, 'TOTAL 0608', 'energie')];
    const p = ask('CB TOTAL 0708', -50, ctx(ops));
    expect(p?.ambiguous).toBe(true);
    expect(p?.categoryId).toBeUndefined();
    expect(p?.alternatives.map(a => a.categoryId).sort()).toEqual(['carburant', 'energie']);
    expect(isApplied(p)).toBe(false);
  });

  it('traite la même enseigne en dépense et en remboursement séparément', () => {
    const c = ctx(many(4, 'CARREFOUR MARKET', 'courses'));
    expect(ask('CARREFOUR MARKET 0508', -30, c)?.categoryId).toBe('courses');
    // Un crédit « CARREFOUR » n’a jamais été vu : pas de catégorie de dépense plaquée dessus.
    expect(ask('VIR CARREFOUR MARKET REMBOURSEMENT', 30, c)).toBeUndefined();
  });
});

describe('absence de faux positifs', () => {
  const c = ctx([
    ...many(5, 'E.LECLERC 0508', 'courses'),
    ...many(3, 'RESTAURANT LE PARIS', 'restaurants'),
  ]);

  it('laisse sans proposition une ligne dont l’enseigne est inconnue', () => {
    expect(ask('BOULANGERIE DU BOURG 0508', -4.2, c)).toBeUndefined();
    expect(ask('PAIEMENT CB 0508 PHARMACIE CENTRALE', -12.4, c)).toBeUndefined();
  });

  it('ne confond pas deux enseignes qui se ressemblent', () => {
    expect(ask('LECLERCQ AVOCATS HONORAIRES', -300, c)).toBeUndefined();
  });

  it('ne retient pas une ville ou un numéro comme enseigne', () => {
    expect(ask('PAIEMENT CB 0508 PARIS 75012', -9, c)).toBeUndefined();
    expect(ask('04/08 123456', -9, c)).toBeUndefined();
  });

  it('ne propose rien sans historique, tiers ni règle', () => {
    expect(ask('CARREFOUR MARKET', -9, ctx())).toBeUndefined();
  });

  it('ignore les opérations supprimées, les virements et les catégories incohérentes', () => {
    const ops = [
      ...many(4, 'FNAC 0508', 'courses').map(o => ({ ...o, deletedAt: '2026-08-01' })),
      ...many(4, 'DARTY 0508', 'courses').map(o => ({ ...o, transferId: 't1' })),
      // dépense classée dans une catégorie de recette
      ...many(4, 'BOULANGER 0508', 'salaire').map(o => ({ ...o, kind: 'depense' as const })),
    ];
    const c2 = ctx(ops);
    expect(ask('FNAC 0509', -50, c2)).toBeUndefined();
    expect(ask('DARTY 0509', -50, c2)).toBeUndefined();
    expect(ask('BOULANGER 0509', -50, c2)).toBeUndefined();
  });
});

/* -------------------------------------------------- tiers et règles */

describe('tiers reconnu dans le libellé', () => {
  it('pose la catégorie par défaut du tiers, avec confiance haute', () => {
    const p = ask('PAIEMENT CB CARREFOUR 0805', -42, ctx([], [payee('p1', 'Carrefour', 'courses')]));
    expect(p).toMatchObject({ source: 'tiers', confidence: 'haute', payeeId: 'p1', categoryId: 'courses' });
  });

  it('n’applique pas une catégorie par défaut devenue invalide', () => {
    const p = ask('CB CARREFOUR 0805', -42, ctx([], [payee('p1', 'Carrefour', 'categorie-supprimee')]));
    expect(p).toMatchObject({ payeeId: 'p1' });
    expect(p?.categoryId).toBeUndefined();
  });

  it('n’applique pas une catégorie de dépense à un crédit', () => {
    const p = ask('VIR CARREFOUR REMBOURSEMENT', 25, ctx([], [payee('p1', 'Carrefour', 'courses')]));
    expect(p?.categoryId).toBeUndefined();
  });

  it('ne fait pas confiance à un nom de tiers collé à d’autres lettres', () => {
    const p = ask('CB TOTALENERGIESXYZ 0805', -42, ctx([], [payee('p1', 'Total', 'carburant')]));
    expect(p?.confidence).toBe('faible');
    expect(isApplied(p)).toBe(false);
  });

  it('signale un conflit entre la catégorie du tiers et l’historique du libellé', () => {
    const c = ctx(many(3, 'TOTAL ENERGIES 0508', 'energie'), [payee('p1', 'Total', 'carburant')]);
    const p = ask('PRLV TOTAL ENERGIES 08/26', -80, c);
    expect(p?.confidence).toBe('faible');
    expect(p?.basis).toMatch(/Conflit/);
    expect(isApplied(p)).toBe(false);
  });

  it('ignore un tiers archivé', () => {
    expect(ask('CB CARREFOUR 0805', -42, ctx([], [payee('p1', 'Carrefour', 'courses', true)]))).toBeUndefined();
  });
});

describe('règles apprises', () => {
  const history = many(5, 'CARREFOUR MARKET 0123', 'courses');

  it('l’emportent sur l’historique', () => {
    const p = ask('CARREFOUR MARKET 0509', -10, ctx(history, [], [rule('carrefour market', 'restaurants')]));
    expect(p).toMatchObject({ source: 'regle', categoryId: 'restaurants' });
  });

  it('gagnent en confiance à chaque confirmation', () => {
    const une = ask('CARREFOUR MARKET', -10, ctx([], [], [rule('carrefour market', 'courses', { hits: 1 })]));
    const deux = ask('CARREFOUR MARKET', -10, ctx([], [], [rule('carrefour market', 'courses', { hits: 2 })]));
    expect(une?.confidence).toBe('moyenne');
    expect(deux?.confidence).toBe('haute');
  });

  it('une règle sur un seul mot reste prudente tant qu’elle est peu confirmée', () => {
    const p = ask('CARREFOUR CITY 0123', -10, ctx([], [], [rule('carrefour', 'courses', { hits: 2 })]));
    expect(p?.confidence).toBe('moyenne');
  });

  it('la règle la plus spécifique gagne', () => {
    const c = ctx([], [], [rule('carrefour', 'courses'), rule('carrefour market', 'restaurants')]);
    expect(ask('CARREFOUR MARKET', -10, c)?.categoryId).toBe('restaurants');
    expect(ask('CARREFOUR CITY', -10, c)?.categoryId).toBe('courses');
  });

  it('une règle oubliée ou dont la catégorie a disparu est ignorée', () => {
    const oubliee = rule('carrefour market', 'restaurants', { disabled: true });
    expect(ask('CARREFOUR MARKET', -10, ctx(history, [], [oubliee]))?.source).toBe('historique');
    const orpheline = rule('carrefour market', 'courses', { categoryId: 'supprimee' });
    expect(ask('CARREFOUR MARKET', -10, ctx([], [], [orpheline]))).toBeUndefined();
  });

  it('ne s’applique qu’au sens de la ligne (dépense / recette)', () => {
    const c = ctx([], [], [rule('carrefour market', 'courses')]);
    expect(ask('CARREFOUR MARKET', 10, c)).toBeUndefined();
  });

  it('ne déborde pas sur un libellé qui ne commence pas par le motif', () => {
    const c = ctx([], [], [rule('market', 'courses')]);
    expect(ask('CARREFOUR MARKET', -10, c)).toBeUndefined();
  });
});

/* ------------------------------------------------ libellés réels français */

describe('cas réels de relevés français', () => {
  const ops = [
    ...many(4, 'CARTE X1234 05/07 CARREFOUR MARKET', 'courses'),
    ...many(3, 'PRLV SEPA EDF CLIENTS REF 111', 'energie'),
    ...many(3, 'PRELEVEMENT FREE MOBILE 0123', 'telephone'),
    ...many(3, 'VIR SEPA RECU DE ACME SAS SALAIRE JUIN', 'salaire'),
    ...many(3, 'RETRAIT DAB 05/07 BNP PARIS', 'liquide'),
    ...many(3, 'PRLV SEPA NETFLIX.COM 998', 'abonnements'),
  ];
  const c = ctx(ops);

  it.each([
    ['PAIEMENT CB 0208 PARIS CARREFOUR MARKET CARTE 4974****1234', -54.1, 'courses'],
    ['PRLV SEPA EDF CLIENTS PART. REF 22334455 MDT Z9Y8', -71.3, 'energie'],
    ['PRELEVEMENT FREE MOBILE 0198765432 08/26', -19.99, 'telephone'],
    ['VIR SEPA RECU DE ACME SAS SALAIRE AOUT 2026', 2150, 'salaire'],
    ['RETRAIT DAB 03/08 SG LYON 69003', -60, 'liquide'],
    ['PRLV SEPA NETFLIX.COM 0000777 ECH 12/08', -13.49, 'abonnements'],
  ])('%s', (label, euros, attendu) => {
    const p = ask(label, euros, c);
    expect(p?.categoryId).toBe(attendu);
    expect(isApplied(p)).toBe(true);
  });

  it('laisse sans catégorie un chèque ou un virement vers une personne jamais vue', () => {
    expect(ask('CHEQUE 4567890', -120, c)).toBeUndefined();
    expect(ask('VIR INST M PIERRE DURAND', -50, c)).toBeUndefined();
  });
});
