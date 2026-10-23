import { db, uid, stamp } from './db';
import { amortization, summarize, validateLoan, type LoanInstallment, type LoanSummary } from '../utils/loan';
import { today, type Ymd } from '../utils/date';
import type { Account, LoanTerms, Operation } from '../types';

/**
 * Prêts à mensualités constantes.
 *
 * Un prêt est un compte de type « pret » dont le solde est la dette restante
 * (négatif). Comptabiliser une mensualité écrit, dans une seule transaction :
 *  · un virement du compte de financement vers le prêt pour le CAPITAL — le
 *    patrimoine total ne bouge pas, la dette baisse de ce que le compte courant
 *    perd, et le virement reste hors des bilans recettes/dépenses ;
 *  · une dépense sur le compte de financement pour les INTÉRÊTS et l'assurance,
 *    rangée dans la catégorie choisie : c'est le vrai coût du crédit.
 * `postedCount` mémorise le rang de la dernière mensualité comptabilisée : rejouer
 * la comptabilisation ne peut donc jamais produire de doublon.
 */

export interface NewLoanInput {
  dbId: string;
  name: string;
  logo?: string;
  group?: string;
  number?: string;
  /** Date à laquelle le prêt a été accordé. */
  loanDate: Ymd;
  principalCents: LoanTerms['principalCents'];
  rateBp: number;
  months: number;
  firstPaymentDate: Ymd;
  insuranceMonthlyCents: number;
  fundingAccountId: string;
  interestCategoryId?: string;
  autoPost: boolean;
  /**
   * Mensualités déjà remboursées avant d'utiliser l'application : elles ne
   * génèrent aucune opération, le solde initial reflète la dette restante.
   */
  alreadyPaid?: number;
}

const label = (acc: Account, row: LoanInstallment, total: number, part: string) =>
  `Prêt « ${acc.name} » — échéance ${row.index}/${total} (${part})`;

export const loanService = {
  async create(input: NewLoanInput): Promise<Account> {
    const problem = validateLoan(input);
    if (problem) throw new Error(problem);
    const alreadyPaid = Math.max(0, Math.floor(input.alreadyPaid ?? 0));
    if (alreadyPaid >= input.months) throw new Error('Toutes les mensualités sont déjà remboursées : il n’y a rien à suivre.');
    const funding = await db.accounts.get(input.fundingAccountId);
    if (!funding || funding.dbId !== input.dbId) throw new Error('Le compte de financement est introuvable.');
    if (funding.type === 'pret') throw new Error('Le compte de financement ne peut pas être un autre prêt.');
    if (funding.currency) throw new Error('Le compte de financement doit être dans la devise de la base : les prêts ne sont pas suivis en devise étrangère.');

    const terms: LoanTerms = {
      principalCents: input.principalCents, rateBp: input.rateBp, months: input.months,
      firstPaymentDate: input.firstPaymentDate, insuranceMonthlyCents: input.insuranceMonthlyCents,
      fundingAccountId: input.fundingAccountId, interestCategoryId: input.interestCategoryId,
      postedCount: alreadyPaid, autoPost: input.autoPost,
    };
    const rows = amortization(terms);
    const remaining = alreadyPaid === 0 ? input.principalCents : rows[alreadyPaid - 1].remainingCents;

    const acc: Account = {
      id: uid(), dbId: input.dbId, name: input.name.trim(), type: 'pret',
      initialBalanceCents: -remaining, startDate: input.loanDate,
      logo: input.logo, group: input.group, number: input.number,
      archived: false, updatedAt: stamp(), loan: terms,
    };
    await db.accounts.add(acc);
    return acc;
  },

  /** Prêts de la base (comptes archivés exclus), du plus proche d'être soldé au plus lointain. */
  async list(dbId: string): Promise<Account[]> {
    const rows = await db.accounts.where('dbId').equals(dbId).toArray();
    return rows.filter(a => a.type === 'pret' && a.loan && !a.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },

  schedule: (acc: Account): LoanInstallment[] => (acc.loan ? amortization(acc.loan) : []),

  summary(acc: Account, asOf: Ymd = today()): LoanSummary | undefined {
    return acc.loan ? summarize(acc.loan, acc.loan.postedCount, asOf) : undefined;
  },

  /**
   * Comptabilise toutes les mensualités échues à `asOf`. Renvoie le nombre de
   * mensualités écrites. Chaque mensualité est une transaction à part, qui relit
   * le prêt : deux appels simultanés ne peuvent pas la comptabiliser deux fois.
   */
  async postDue(accountId: string, asOf: Ymd = today()): Promise<number> {
    const first = await db.accounts.get(accountId);
    if (!first?.loan || first.archived) return 0;
    const rows = amortization(first.loan);
    let posted = 0;

    for (const row of rows) {
      if (row.date > asOf) break;
      const done = await db.transaction('rw', db.accounts, db.operations, async () => {
        const acc = await db.accounts.get(accountId);
        if (!acc?.loan || row.index !== acc.loan.postedCount + 1) return false;
        const loan = acc.loan;
        const now = stamp();
        const base = {
          dbId: acc.dbId, date: row.date, checked: false, createdAt: now, updatedAt: now,
        };
        const ops: Operation[] = [];
        if (row.principalCents > 0) {
          const transferId = uid();
          ops.push(
            {
              ...base, id: uid(), accountId: loan.fundingAccountId, amountCents: -row.principalCents,
              kind: 'virement', transferId, label: label(acc, row, rows.length, 'capital'),
            },
            {
              ...base, id: uid(), accountId: acc.id, amountCents: row.principalCents,
              kind: 'virement', transferId, label: label(acc, row, rows.length, 'capital'),
            },
          );
        }
        const cost = row.interestCents + row.insuranceCents;
        if (cost > 0) {
          ops.push({
            ...base, id: uid(), accountId: loan.fundingAccountId, amountCents: -cost,
            kind: 'depense', categoryId: loan.interestCategoryId,
            label: label(acc, row, rows.length, 'intérêts et assurance'),
          });
        }
        await db.operations.bulkAdd(ops);
        await db.accounts.update(acc.id, { loan: { ...loan, postedCount: row.index }, updatedAt: now });
        return true;
      });
      if (done) posted++;
    }
    return posted;
  },

  /** Comptabilisation automatique des prêts qui l'ont demandé. Renvoie le nombre de mensualités écrites. */
  async runAutoPost(dbId: string, asOf: Ymd = today()): Promise<number> {
    let n = 0;
    for (const acc of await this.list(dbId)) {
      if (acc.loan?.autoPost) n += await this.postDue(acc.id, asOf);
    }
    return n;
  },
};
