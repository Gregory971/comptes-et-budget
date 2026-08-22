// Rapprochement bancaire.
//
// Le pointage existait déjà (champ `checked` sur chaque opération) mais ne
// servait à rien : rien ne confrontait le total pointé au solde du relevé. Or
// c'est cette confrontation qui décèle l'oubli de saisie, la double saisie et
// l'erreur de montant — les trois défauts qu'aucun contrôle interne ne peut
// repérer, puisque la base est cohérente avec elle-même.
//
// Convention retenue, celle des relevés bancaires : le solde pointé rapproché
// vaut le solde initial du compte augmenté des seules opérations POINTÉES
// jusqu'à la date du relevé. L'écart avec le solde annoncé par la banque doit
// être nul ; toute autre valeur désigne exactement ce qui manque.

import { db } from './db';
import { accountService } from './accountService';
import { operationService } from './operationService';
import type { Cents, Operation, Ymd } from '../types';

export interface ReconcileSummary {
  accountId: string;
  upTo: Ymd;
  /** Solde de toutes les opérations, pointées ou non, jusqu'à la date. */
  theoreticalCents: Cents;
  /** Solde des seules opérations pointées : à comparer au relevé. */
  checkedCents: Cents;
  /** Opérations non pointées à cette date, les plus anciennes d'abord. */
  pending: Operation[];
  /** Total signé des opérations non pointées. */
  pendingCents: Cents;
}

export const reconcileService = {
  async summary(dbId: string, accountId: string, upTo: Ymd): Promise<ReconcileSummary> {
    const [account, vivantes, theoreticalCents] = await Promise.all([
      db.accounts.get(accountId),
      // list() écarte déjà les suppressions logiques et borne à la date.
      operationService.list(dbId, { accountId, to: upTo }),
      accountService.balance(accountId, upTo),
    ]);
    const pending = vivantes.filter(o => !o.checked)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      accountId, upTo, theoreticalCents,
      checkedCents: vivantes.filter(o => o.checked)
        .reduce((s, o) => s + o.amountCents, account?.initialBalanceCents ?? 0),
      pending,
      pendingCents: pending.reduce((s, o) => s + o.amountCents, 0),
    };
  },

  /**
   * Écart entre le relevé de la banque et le solde pointé.
   * Zéro : le compte est rapproché. Positif : la banque a encaissé quelque
   * chose qui n'est ni saisi ni pointé.
   */
  difference: (statementBalanceCents: Cents, s: ReconcileSummary): Cents =>
    statementBalanceCents - s.checkedCents,

  /** Pointe ou dépointe un lot d'opérations en une seule transaction. */
  async setChecked(ids: string[], checked: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    await db.transaction('rw', db.operations, async () => {
      for (const id of ids) await operationService.toggleChecked(id, checked);
    });
    return ids.length;
  },
};
