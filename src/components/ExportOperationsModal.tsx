import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from './Modal';
import { exportService, FORMAT_LABEL, type ExportFormat, type ExportScope } from '../services/exportService';
import { DEFAULT_CSV, type CsvOptions, type DateFormat } from '../utils/exportFormats';
import { downloadFile } from '../utils/download';
import { formatFr, type Ymd } from '../utils/date';
import type { Account } from '../types';

/** Export des opérations : format, période, compte et options d'écriture. */
export function ExportOperationsModal({ dbId, accounts, accountId, from, to, onClose }: {
  dbId: string;
  accounts: Account[];
  /** Compte et période affichés à l'écran, proposés par défaut. */
  accountId?: string;
  from: Ymd;
  to: Ymd;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [period, setPeriod] = useState<'affichee' | 'tout'>('affichee');
  const [account, setAccount] = useState(accountId ?? '');
  const [splitDetail, setSplitDetail] = useState(false);
  const [includeTransfers, setIncludeTransfers] = useState(true);
  const [dateFormat, setDateFormat] = useState<DateFormat>('fr');
  const [csv, setCsv] = useState<CsvOptions>(DEFAULT_CSV);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scope: ExportScope = {
    dbId, accountId: account || undefined,
    from: period === 'affichee' ? from : undefined, to: period === 'affichee' ? to : undefined,
    splitDetail, includeTransfers,
  };
  // Compteur en direct : ce qui sera réellement écrit, avant de cliquer.
  const count = useLiveQuery(
    () => exportService.rows(scope).then(r => r.length),
    [dbId, account, period, from, to, splitDetail, includeTransfers], undefined,
  );

  async function exporter() {
    setError(null); setBusy(true);
    try {
      const f = await exportService.build(scope, format, { csv: { ...csv, dateFormat }, dateFormat });
      downloadFile(f.name, f.data, f.mime);
      setDone(`${f.count} opération(s) exportée(s) dans « ${f.name} ».`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Exporter les opérations" onClose={onClose} width={560}>
      <div className="field"><label htmlFor="xo-format">Format</label>
        <select id="xo-format" value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
          {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map(k => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}
        </select></div>

      <div className="grid two">
        <div className="field"><label htmlFor="xo-period">Période</label>
          <select id="xo-period" value={period} onChange={e => setPeriod(e.target.value as 'affichee' | 'tout')}>
            <option value="affichee">Affichée : du {formatFr(from)} au {formatFr(to)}</option>
            <option value="tout">Toutes les opérations</option>
          </select></div>
        <div className="field"><label htmlFor="xo-account">Compte</label>
          <select id="xo-account" value={account} onChange={e => setAccount(e.target.value)}>
            <option value="">Tous les comptes</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
      </div>

      {(format === 'csv' || format === 'xlsx' || format === 'qif') && (
        <div className="field"><label htmlFor="xo-date">Format des dates</label>
          <select id="xo-date" value={dateFormat} onChange={e => setDateFormat(e.target.value as DateFormat)}>
            <option value="fr">JJ/MM/AAAA</option>
            <option value="iso">AAAA-MM-JJ</option>
          </select></div>
      )}

      {format === 'csv' && (
        <div className="grid two">
          <div className="field"><label htmlFor="xo-sep">Séparateur de colonnes</label>
            <select id="xo-sep" value={csv.separator} onChange={e => setCsv({ ...csv, separator: e.target.value as CsvOptions['separator'] })}>
              <option value=";">Point-virgule ( ; )</option>
              <option value=",">Virgule ( , )</option>
              <option value={'\t'}>Tabulation</option>
            </select></div>
          <div className="field"><label htmlFor="xo-dec">Séparateur des décimales</label>
            <select id="xo-dec" value={csv.decimal} onChange={e => setCsv({ ...csv, decimal: e.target.value as CsvOptions['decimal'] })}>
              <option value=",">Virgule ( 12,50 )</option>
              <option value=".">Point ( 12.50 )</option>
            </select></div>
          <label className="inline-check">
            <input type="checkbox" checked={csv.header} onChange={e => setCsv({ ...csv, header: e.target.checked })} />
            Avec l’en-tête des colonnes
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={csv.bom} onChange={e => setCsv({ ...csv, bom: e.target.checked })} />
            Accents lisibles dans Excel (UTF-8 avec BOM)
          </label>
        </div>
      )}

      <label className="inline-check">
        <input type="checkbox" checked={includeTransfers} onChange={e => setIncludeTransfers(e.target.checked)} />
        Inclure les virements entre comptes
      </label>
      {format !== 'qif' && format !== 'ofx' && (
        <label className="inline-check">
          <input type="checkbox" checked={splitDetail} onChange={e => setSplitDetail(e.target.checked)} />
          Détailler les opérations ventilées (une ligne par catégorie)
        </label>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Les montants sont dans la devise de chaque compte. Le fichier est créé sur votre appareil, rien n’est envoyé.
      </p>

      <p role="status" style={{ margin: '4px 0' }}>
        {done ?? (count === undefined ? 'Calcul…' : count === 0 ? 'Aucune opération à exporter.' : `${count} opération(s) seront exportées.`)}
      </p>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="row">
        <button className="btn ghost" onClick={onClose}>{done ? 'Fermer' : 'Annuler'}</button>
        <button className="btn" onClick={exporter} disabled={busy || !count}>Exporter</button>
      </div>
    </Modal>
  );
}
