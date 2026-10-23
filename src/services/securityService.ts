import { db, uid, stamp } from './db';
import { operationService } from './operationService';
import { computePosition, grossCents, validateTxs, type Position } from '../utils/portfolio';
import type { Ymd } from '../utils/date';
import type { Cents, Security, SecurityPrice, SecurityTx, SecurityTxType } from '../types';

/**
 * Suivi des placements.
 *
 * Un titre n'est pas un compte : c'est un portefeuille tenu à part (mouvements +
 * cotations), dont la position est RECALCULÉE à chaque lecture d'après ses
 * mouvements — jamais stockée, donc jamais périmée. Les écritures bancaires sont
 * facultatives : si l'on désigne un compte, le mouvement les crée dans la même
 * transaction et les supprime avec lui ; sinon le portefeuille reste indépendant
 * des comptes. Titres en devise de la base uniquement.
 */

export interface BankLink {
  accountId: string;
  /** Catégorie de l'écriture principale (achat de titres, vente, dividendes…). */
  categoryId?: string;
  /** Catégorie des frais ; à l'achat, la ventilation en isole la part. */
  feesCategoryId?: string;
}

export interface NewTx {
  dbId: string;
  securityId: string;
  date: Ymd;
  type: SecurityTxType;
  /** Parts (achat, vente) ou variation signée (ajustement). */
  quantity?: number;
  /** Euros par part (achat, vente). */
  unitPrice?: number;
  feesCents?: Cents;
  /** Montant d'un dividende. */
  amountCents?: Cents;
  note?: string;
  bank?: BankLink;
}

const LABEL: Record<SecurityTxType, string> = {
  achat: 'Achat', vente: 'Vente', dividende: 'Dividende', ajustement: 'Ajustement',
};

export interface SecurityStatus {
  security: Security;
  position: Position;
  /** Date du dernier cours, si renseigné. */
  priceDate?: Ymd;
  txCount: number;
}

export const securityService = {
  async list(dbId: string, includeArchived = false): Promise<Security[]> {
    const rows = await db.securities.where('dbId').equals(dbId).toArray();
    return (includeArchived ? rows : rows.filter(s => !s.archived)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },

  async create(input: { dbId: string; name: string; symbol?: string }): Promise<Security> {
    const name = input.name.trim();
    if (!name) throw new Error('Le nom du titre est obligatoire.');
    const symbol = input.symbol?.trim().toUpperCase() || undefined;
    if (symbol && (await db.securities.where('dbId').equals(input.dbId).toArray()).some(s => s.symbol === symbol && !s.archived)) {
      throw new Error(`Un titre porte déjà le code ${symbol}.`);
    }
    const row: Security = { id: uid(), dbId: input.dbId, name, symbol, archived: false, updatedAt: stamp() };
    await db.securities.add(row);
    return row;
  },

  async update(id: string, patch: { name?: string; symbol?: string }): Promise<void> {
    const cur = await db.securities.get(id);
    if (!cur) return;
    const name = (patch.name ?? cur.name).trim();
    if (!name) throw new Error('Le nom du titre est obligatoire.');
    await db.securities.update(id, {
      name, symbol: 'symbol' in patch ? patch.symbol?.trim().toUpperCase() || undefined : cur.symbol, updatedAt: stamp(),
    });
  },

  archive: (id: string) => db.securities.update(id, { archived: true, updatedAt: stamp() }),
  unarchive: (id: string) => db.securities.update(id, { archived: false, updatedAt: stamp() }),

  /** Supprime un titre sans mouvement ; sinon l'archivage reste possible. */
  async remove(id: string): Promise<void> {
    if ((await db.securityTxs.where('securityId').equals(id).count()) > 0) {
      throw new Error('Ce titre a des mouvements : archivez-le plutôt que de le supprimer.');
    }
    await db.transaction('rw', db.securities, db.securityPrices, async () => {
      await db.securityPrices.where('securityId').equals(id).delete();
      await db.securities.delete(id);
    });
  },

  txs: async (securityId: string): Promise<SecurityTx[]> =>
    (await db.securityTxs.where('securityId').equals(securityId).toArray())
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),

  /** Ajoute un mouvement, après avoir vérifié que toute la suite reste cohérente. */
  async addTx(input: NewTx): Promise<SecurityTx> {
    const sec = await db.securities.get(input.securityId);
    if (!sec || sec.dbId !== input.dbId) throw new Error('Titre introuvable.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('La date est invalide.');

    const quantity = input.quantity ?? 0;
    const unitPrice = input.unitPrice ?? 0;
    const feesCents = input.feesCents ?? 0;
    const gross = input.type === 'achat' || input.type === 'vente' ? grossCents(quantity, unitPrice) : 0;
    const amountCents = input.type === 'dividende' ? input.amountCents ?? 0 : gross;

    const now = stamp();
    const row: SecurityTx = {
      id: uid(), dbId: input.dbId, securityId: input.securityId, date: input.date, type: input.type,
      quantity, unitPrice, feesCents, amountCents, note: input.note?.trim() || undefined,
      createdAt: now, updatedAt: now,
    };
    const problem = validateTxs([...(await db.securityTxs.where('securityId').equals(input.securityId).toArray()), row]);
    if (problem) throw new Error(problem);
    if ((input.type === 'achat' || input.type === 'vente') && gross <= 0 && unitPrice === 0) {
      // Une opération à cours nul (don, attribution) se saisit comme un ajustement.
      throw new Error('Le cours ne peut pas être nul : utilisez « Ajuster les parts » pour une attribution gratuite.');
    }

    return db.transaction('rw', db.securityTxs, db.operations, db.accounts, async () => {
      if (input.bank && input.type !== 'ajustement') {
        const op = await bankOperation(input, sec, row, gross);
        if (op) row.operationIds = [op.id];
      }
      await db.securityTxs.add(row);
      return row;
    });
  },

  /** Supprime un mouvement et ses écritures bancaires, si la suite des mouvements le permet. */
  async removeTx(id: string): Promise<void> {
    const row = await db.securityTxs.get(id);
    if (!row) return;
    const restants = (await db.securityTxs.where('securityId').equals(row.securityId).toArray()).filter(t => t.id !== id);
    const problem = validateTxs(restants);
    if (problem) throw new Error(`Suppression impossible : ${problem}`);
    await db.transaction('rw', db.securityTxs, db.operations, async () => {
      for (const opId of row.operationIds ?? []) await operationService.remove(opId);
      await db.securityTxs.delete(id);
    });
  },

  // ---- Cotations

  prices: async (securityId: string): Promise<SecurityPrice[]> =>
    (await db.securityPrices.where('securityId').equals(securityId).toArray()).sort((a, b) => b.date.localeCompare(a.date)),

  /** Enregistre le cours d'un jour (remplace celui du même jour). */
  async setPrice(input: { dbId: string; securityId: string; date: Ymd; price: number }): Promise<SecurityPrice> {
    if (!Number.isFinite(input.price) || input.price < 0) throw new Error('Le cours doit être un nombre positif.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('La date est invalide.');
    const same = (await db.securityPrices.where('[securityId+date]').equals([input.securityId, input.date]).first());
    const row: SecurityPrice = { id: same?.id ?? uid(), dbId: input.dbId, securityId: input.securityId, date: input.date, price: input.price, updatedAt: stamp() };
    await db.securityPrices.put(row);
    return row;
  },

  removePrice: (id: string) => db.securityPrices.delete(id),

  /** Position de chaque titre (non archivé par défaut) au dernier cours connu. */
  async statuses(dbId: string, includeArchived = false): Promise<SecurityStatus[]> {
    const [secs, txs, prices] = await Promise.all([
      this.list(dbId, includeArchived),
      db.securityTxs.where('dbId').equals(dbId).toArray(),
      db.securityPrices.where('dbId').equals(dbId).toArray(),
    ]);
    return secs.map(security => {
      const mine = txs.filter(t => t.securityId === security.id);
      const last = prices.filter(p => p.securityId === security.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      // Sans cotation saisie, le dernier cours des mouvements fait office de repère.
      const lastTx = [...mine].filter(t => t.type === 'achat' || t.type === 'vente')
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
      const price = last?.price ?? lastTx?.unitPrice;
      return {
        security, txCount: mine.length, priceDate: last?.date ?? lastTx?.date,
        position: computePosition(mine, price),
      };
    });
  },

  /** Valeur totale du portefeuille et ses gains. */
  async totals(dbId: string): Promise<{ valueCents: Cents; costCents: Cents; latentCents: Cents; realizedCents: Cents; dividendsCents: Cents }> {
    const all = await this.statuses(dbId);
    return all.reduce((t, s) => ({
      valueCents: t.valueCents + (s.position.marketValueCents ?? 0),
      costCents: t.costCents + s.position.costCents,
      latentCents: t.latentCents + (s.position.latentCents ?? 0),
      realizedCents: t.realizedCents + s.position.realizedCents,
      dividendsCents: t.dividendsCents + s.position.dividendsCents,
    }), { valueCents: 0, costCents: 0, latentCents: 0, realizedCents: 0, dividendsCents: 0 });
  },

};

/** Écriture bancaire d'un mouvement : ce que la banque montre réellement. */
async function bankOperation(input: NewTx, sec: Security, row: SecurityTx, gross: Cents) {
  const bank = input.bank!;
  const account = await db.accounts.get(bank.accountId);
  if (!account || account.dbId !== input.dbId) throw new Error('Le compte bancaire est introuvable.');
  if (account.currency) throw new Error('Les placements se suivent dans la devise de la base : choisissez un compte dans cette devise.');
  if (account.type === 'pret') throw new Error('Un prêt ne peut pas recevoir une opération de placement.');
  const label = `${LABEL[row.type]} — ${sec.name}`;
  const common = { dbId: input.dbId, accountId: account.id, date: row.date, label, note: row.note };

  if (row.type === 'achat') {
    const total = gross + row.feesCents;
    // Les frais ressortent dans leur propre catégorie, par ventilation de la même écriture.
    if (row.feesCents > 0 && bank.feesCategoryId) {
      return operationService.create({
        ...common, kind: 'depense', amountCents: total,
        splits: [{ categoryId: bank.categoryId, amountCents: gross }, { categoryId: bank.feesCategoryId, amountCents: row.feesCents }],
      });
    }
    return operationService.create({ ...common, kind: 'depense', amountCents: total, categoryId: bank.categoryId });
  }
  if (row.type === 'vente') {
    // La banque crédite le produit net des frais.
    const net = gross - row.feesCents;
    if (net <= 0) return undefined;
    return operationService.create({ ...common, kind: 'recette', amountCents: net, categoryId: bank.categoryId });
  }
  // Dividende
  return operationService.create({ ...common, kind: 'recette', amountCents: row.amountCents, categoryId: bank.categoryId });
}
