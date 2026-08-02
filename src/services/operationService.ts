import { db, uid, stamp } from './db';
import type { Operation, Kind, Ymd, Cents } from '../types';

export interface OperationInput {
  dbId: string; accountId: string; date: Ymd; amountCents: Cents; kind: Kind;
  payeeId?: string; categoryId?: string; paymentMethodId?: string;
  label?: string; reference?: string; note?: string;
  /** Rattachement facultatif à un bien du patrimoine ou à un projet d'épargne. */
  assetId?: string; projectId?: string;
  transferId?: string;
}

/**
 * Le signe est dérivé du type d'opération.
 * Correction P1 : « virement » n'était pas traité et retombait sur la branche
 * « recette » — un transfert entre comptes gonflait donc le patrimoine. Un
 * virement conserve désormais le signe fourni par transferService (débit sur le
 * compte source, crédit sur le compte destinataire).
 */
export function signed(kind: Kind, amountCents: Cents): Cents {
  const a = Math.abs(amountCents);
  if (kind === 'depense') return -a;
  if (kind === 'recette') return a;
  return amountCents; // virement : signe déjà porté par l'appelant
}

export interface OpFilter {
  accountId?: string; from?: Ymd; to?: Ymd; categoryId?: string; payeeId?: string;
  assetId?: string; projectId?: string;
  includeTransfers?: boolean;
}

export const operationService = {
  async create(input: OperationInput): Promise<Operation> {
    const now = stamp();
    const op: Operation = {
      id: uid(), checked: false, createdAt: now, updatedAt: now,
      ...input, amountCents: signed(input.kind, input.amountCents),
    };
    await db.operations.add(op);
    return op;
  },

  async update(id: string, patch: Partial<OperationInput>): Promise<void> {
    const cur = await db.operations.get(id);
    if (!cur) return;
    const kind = patch.kind ?? cur.kind;
    const raw = patch.amountCents ?? Math.abs(cur.amountCents);
    await db.operations.update(id, {
      ...patch, kind, amountCents: signed(kind, raw), updatedAt: stamp(),
    });
  },

  /** Suppression logique ; les deux écritures d'un virement partent ensemble. */
  async remove(id: string): Promise<void> {
    const op = await db.operations.get(id);
    if (!op) return;
    const deletedAt = stamp();
    if (op.transferId) {
      await db.operations.where('transferId').equals(op.transferId)
        .modify({ deletedAt, updatedAt: deletedAt });
    } else {
      await db.operations.update(id, { deletedAt, updatedAt: deletedAt });
    }
  },

  toggleChecked: (id: string, v: boolean) =>
    db.operations.update(id, { checked: v, updatedAt: stamp() }),

  /**
   * Optimisation P2 : lecture par index composé [dbId+date] ou [accountId+date],
   * au lieu de charger tout l'historique de la base puis de filtrer en mémoire.
   */
  async list(dbId: string, f: OpFilter = {}): Promise<Operation[]> {
    const from = f.from ?? '0000-01-01';
    const to = f.to ?? '9999-12-31';

    const rows = f.accountId
      ? await db.operations.where('[accountId+date]')
          .between([f.accountId, from], [f.accountId, to], true, true).toArray()
      : await db.operations.where('[dbId+date]')
          .between([dbId, from], [dbId, to], true, true).toArray();

    return rows
      .filter(o => !o.deletedAt)
      .filter(o => (f.accountId ? o.dbId === dbId : true))
      .filter(o => (f.categoryId ? o.categoryId === f.categoryId : true))
      .filter(o => (f.payeeId ? o.payeeId === f.payeeId : true))
      .filter(o => (f.assetId ? o.assetId === f.assetId : true))
      .filter(o => (f.projectId ? o.projectId === f.projectId : true))
      .filter(o => (f.includeTransfers === false ? o.kind !== 'virement' : true))
      .sort((a, b) => (b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
  },

  async recent(dbId: string, n = 5): Promise<Operation[]> {
    return (await this.list(dbId)).slice(0, n);
  },

  /** Nombre d'opérations non supprimées référençant un élément de référentiel. */
  async countByRef(
    dbId: string,
    field: 'categoryId' | 'payeeId' | 'paymentMethodId' | 'assetId' | 'projectId',
    id: string,
  ): Promise<number> {
    const rows = await db.operations.where('[dbId+date]')
      .between([dbId, '0000-01-01'], [dbId, '9999-12-31'], true, true).toArray();
    return rows.filter(o => !o.deletedAt && o[field] === id).length;
  },

  /** Total signé des opérations rattachées à un bien ou à un projet. */
  async totalForRef(dbId: string, field: 'assetId' | 'projectId', id: string): Promise<Cents> {
    const rows = await this.list(dbId, field === 'assetId' ? { assetId: id } : { projectId: id });
    return rows.reduce((s, o) => s + o.amountCents, 0);
  },
};
