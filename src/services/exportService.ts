import { db } from './db';
import { operationService } from './operationService';
import { currencyService } from './currencyService';
import { toCsv, toOfx, toQif, toXlsx, type CsvOptions, type DateFormat, type ExportRow } from '../utils/exportFormats';
import { toYmd, type Ymd } from '../utils/date';

/**
 * Export des opérations vers un tableur ou un autre logiciel de comptes.
 *
 * Les montants sortent dans la devise de CHAQUE compte (colonne « Devise ») :
 * un export est une copie fidèle des écritures, pas un état converti.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'qif' | 'ofx';

export interface ExportScope {
  dbId: string;
  /** Un seul compte ; absent : tous les comptes. */
  accountId?: string;
  from?: Ymd;
  to?: Ymd;
  /** Une ligne par part de ventilation plutôt qu'une ligne « Ventilée (n) ». */
  splitDetail: boolean;
  /** Inclure les deux écritures des virements entre comptes. */
  includeTransfers: boolean;
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV (texte, tous tableurs)', xlsx: 'Excel (.xlsx)', qif: 'QIF (Quicken, Money…)', ofx: 'OFX (logiciels bancaires)',
};

export const exportService = {
  /** Lignes à exporter, du plus ancien au plus récent. */
  async rows(scope: ExportScope): Promise<ExportRow[]> {
    const [ops, accounts, payees, cats, methods, base] = await Promise.all([
      operationService.list(scope.dbId, {
        accountId: scope.accountId, from: scope.from, to: scope.to, includeTransfers: scope.includeTransfers,
      }),
      db.accounts.where('dbId').equals(scope.dbId).toArray(),
      db.payees.where('dbId').equals(scope.dbId).toArray(),
      db.categories.where('dbId').equals(scope.dbId).toArray(),
      db.paymentMethods.where('dbId').equals(scope.dbId).toArray(),
      currencyService.baseCode(scope.dbId),
    ]);
    const nameOf = <T extends { id: string; name: string }>(rows: T[]) => {
      const m = new Map(rows.map(r => [r.id, r.name]));
      return (id?: string) => (id ? m.get(id) ?? '' : '');
    };
    const account = nameOf(accounts), payee = nameOf(payees), cat = nameOf(cats), method = nameOf(methods);
    const currencyOf = new Map(accounts.map(a => [a.id, a.currency || base]));

    const out: ExportRow[] = [];
    for (const o of [...ops].reverse()) {
      const common = {
        date: o.date, account: account(o.accountId), currency: currencyOf.get(o.accountId) ?? base,
        payee: payee(o.payeeId), method: method(o.paymentMethodId), reference: o.reference ?? '',
        label: o.label ?? '', note: o.note ?? '', checked: o.checked,
      };
      const parts = o.splits ?? [];
      if (o.kind === 'virement') {
        out.push({ ...common, id: o.id, category: 'Virement', amountCents: o.amountCents });
      } else if (parts.length > 1 && scope.splitDetail) {
        parts.forEach((p, i) => out.push({ ...common, id: `${o.id}#${i + 1}`, category: cat(p.categoryId), amountCents: p.amountCents }));
      } else if (parts.length > 1) {
        out.push({ ...common, id: o.id, category: `Ventilée : ${parts.map(p => cat(p.categoryId) || 'Sans catégorie').join(' · ')}`, amountCents: o.amountCents });
      } else {
        out.push({ ...common, id: o.id, category: cat(o.categoryId), amountCents: o.amountCents });
      }
    }
    return out;
  },

  /** Contenu du fichier : texte (CSV, QIF, OFX) ou octets (Excel), avec nom et type MIME. */
  async build(
    scope: ExportScope, format: ExportFormat, options: { csv: CsvOptions; dateFormat: DateFormat },
    now: Date = new Date(),
  ): Promise<{ name: string; data: string | Uint8Array; mime: string; count: number }> {
    const rows = await this.rows(scope);
    const base = `Comptes-et-Budget_operations_${toYmd(now)}`;
    switch (format) {
      case 'csv': return { name: `${base}.csv`, data: toCsv(rows, options.csv), mime: 'text/csv;charset=utf-8', count: rows.length };
      case 'xlsx': return {
        name: `${base}.xlsx`, data: toXlsx(rows, options.dateFormat),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', count: rows.length,
      };
      case 'qif': return { name: `${base}.qif`, data: toQif(rows, options.dateFormat), mime: 'application/qif', count: rows.length };
      case 'ofx': return { name: `${base}.ofx`, data: toOfx(rows, now), mime: 'application/x-ofx', count: rows.length };
    }
  },
};
