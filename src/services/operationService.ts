import { db, uid, stamp } from './db';
import { touchesCategory, validateSplits } from '../utils/splits';
import type { Operation, OperationSplit, Kind, Ymd, Cents } from '../types';

export interface OperationInput {
  dbId: string; accountId: string; date: Ymd; amountCents: Cents; kind: Kind;
  payeeId?: string; categoryId?: string; paymentMethodId?: string;
  label?: string; reference?: string; note?: string;
  /** Rattachement facultatif à un bien du patrimoine ou à un projet d'épargne. */
  assetId?: string; projectId?: string;
  transferId?: string;
  /**
   * Ventilation multiple, parts en MONTANTS POSITIFS : le signe est dérivé du
   * type de l'opération, comme pour le montant. Au moins deux parts, dont la
   * somme égale le montant. `categoryId` est alors ignoré.
   */
  splits?: OperationSplit[];
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

/**
 * Applique le signe de l'opération aux parts d'une ventilation et la valide.
 * Renvoie undefined quand il n'y a rien à ventiler.
 */
function normalizeSplits(kind: Kind, amountCents: Cents, splits?: OperationSplit[]): OperationSplit[] | undefined {
  if (!splits || splits.length === 0) return undefined;
  if (kind === 'virement') throw new Error('Un virement ne peut pas être ventilé par catégorie.');
  const parts = splits.map(s => ({ ...s, amountCents: signed(kind, s.amountCents) }));
  const problem = validateSplits(amountCents, parts);
  if (problem) throw new Error(problem);
  return parts;
}

export const operationService = {
  async create(input: OperationInput): Promise<Operation> {
    const now = stamp();
    const amountCents = signed(input.kind, input.amountCents);
    const splits = normalizeSplits(input.kind, amountCents, input.splits);
    const op: Operation = {
      id: uid(), checked: false, createdAt: now, updatedAt: now,
      ...input, amountCents, splits,
      categoryId: splits ? undefined : input.categoryId,
    };
    await db.operations.add(op);
    return op;
  },

  async update(id: string, patch: Partial<OperationInput>): Promise<void> {
    const cur = await db.operations.get(id);
    if (!cur) return;
    const kind = patch.kind ?? cur.kind;
    const raw = patch.amountCents ?? Math.abs(cur.amountCents);
    const amountCents = signed(kind, raw);

    // Sans nouvelle ventilation, celle qui existe doit rester juste : changer le
    // montant ou le sens d'une opération ventilée l'invaliderait en silence.
    const splitsGiven = 'splits' in patch;
    if (!splitsGiven && cur.splits?.length && (amountCents !== cur.amountCents)) {
      throw new Error('Le montant ne correspond plus à la ventilation : modifiez la ventilation en même temps.');
    }
    const splits = splitsGiven ? normalizeSplits(kind, amountCents, patch.splits) : cur.splits;
    await db.operations.update(id, {
      ...patch, kind, amountCents, splits,
      categoryId: splits ? undefined : ('categoryId' in patch ? patch.categoryId : cur.categoryId),
      updatedAt: stamp(),
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
      .filter(o => (f.categoryId ? touchesCategory(o, f.categoryId) : true))
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
    return rows.filter(o => !o.deletedAt
      && (field === 'categoryId' ? touchesCategory(o, id) : o[field] === id)).length;
  },

  /** Total signé des opérations rattachées à un bien ou à un projet. */
  async totalForRef(dbId: string, field: 'assetId' | 'projectId', id: string): Promise<Cents> {
    const rows = await this.list(dbId, field === 'assetId' ? { assetId: id } : { projectId: id });
    return rows.reduce((s, o) => s + o.amountCents, 0);
  },
};
