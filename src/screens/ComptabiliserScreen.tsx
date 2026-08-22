import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useAccounts } from '../hooks/useData';
import { operationService } from '../services/operationService';
import { OperationForm } from '../components/OperationForm';
import { TransferForm } from '../components/TransferForm';
import { StatementImport } from '../components/StatementImport';
import type { Database } from '../types';

type Tab = 'operation' | 'virement';

export function ComptabiliserScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const setScreen = useStore(s => s.setScreen);
  const accounts = useAccounts(dbId);
  const [tab, setTab] = useState<Tab>('operation');
  const [done, setDone] = useState<string | null>(null);

  const confirm = (msg: string) => {
    setDone(msg);
    window.setTimeout(() => setDone(null), 4000);
  };

  return (
    <>
      <h1 className="page-title">Comptabiliser</h1>
      <p className="page-sub">Enregistrez une opération ou un virement entre comptes.</p>

      <div className="tabs">
        <button className={'tab' + (tab === 'operation' ? ' active' : '')}
          onClick={() => setTab('operation')}>Dépense / Recette</button>
        <button className={'tab' + (tab === 'virement' ? ' active' : '')}
          onClick={() => setTab('virement')}>Virement entre comptes</button>
      </div>

      <div className="card" style={{ maxWidth: 660 }}>
        {tab === 'operation' ? (
          <OperationForm dbId={dbId} accounts={accounts} submitLabel="Enregistrer"
            onSubmit={async (input) => {
              await operationService.create({ dbId, ...input });
              confirm('Opération enregistrée.');
            }} />
        ) : (
          <TransferForm dbId={dbId} accounts={accounts}
            onDone={() => confirm('Virement enregistré sur les deux comptes.')} />
        )}

        <hr className="sep" />
        <strong>Importer un relevé de banque</strong>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Fichier CSV ou OFX téléchargé depuis votre banque. Il est analysé sur cet
          appareil ; chaque ligne est présentée avant écriture, et celles déjà
          présentes dans la base sont signalées.
        </p>
        <StatementImport dbId={dbId} accounts={accounts} />

        {done && (
          <p className="muted" style={{ marginTop: 10 }} role="status">
            ✓ {done} — <button className="linklike" onClick={() => setScreen('operations')}>
              voir les opérations</button>
          </p>
        )}
      </div>
    </>
  );
}
