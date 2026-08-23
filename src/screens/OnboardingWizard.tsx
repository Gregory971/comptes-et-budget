import { useState } from 'react';
import { useStore } from '../store/useStore';
import { MoneyInput } from '../components/MoneyInput';
import { ImportButton } from '../components/ImportButton';
import { accountService } from '../services/accountService';
import { today, type Ymd } from '../utils/date';
import type { AccountType, Cents, Database } from '../types';

/** Premier usage guidé : nom de la base → compte principal. */
export function OnboardingWizard({ database }: { database?: Database }) {
  const createBase = useStore(s => s.createBase);
  const [step, setStep] = useState(database ? 1 : 0);
  const [dbName, setDbName] = useState('Mes comptes');
  const [name, setName] = useState('Compte courant');
  const [type, setType] = useState<AccountType>('courant');
  const [initial, setInitial] = useState<Cents | null>(0);
  const [startDate, setStartDate] = useState<Ymd>(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function next() {
    setError(null);
    setBusy(true);
    try {
      if (step === 0) {
        await createBase(dbName);
        setStep(1);
        return;
      }
      const dbId = database?.id ?? useStore.getState().activeDbId;
      if (!dbId) { setError('La base n’a pas pu être créée. Rechargez l’application.'); return; }
      if (initial === null) { setError('Le solde initial est invalide (exemple : 1250,00).'); return; }
      await accountService.create({
        dbId, name: name.trim() || 'Compte', type,
        initialBalanceCents: initial, startDate,
      });
      // L'application bascule sur l'accueil dès qu'un compte existe.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div className="box">
        <div className="steps" aria-hidden="true">
          <span className={step >= 0 ? 'on' : ''} />
          <span className={step >= 1 ? 'on' : ''} />
        </div>

        {step === 0 ? (
          <>
            <h1>Bienvenue 👋</h1>
            <p className="lead">Créons votre base de données pour démarrer.</p>
            <div className="field">
              <label htmlFor="ob-db">Nom de la base</label>
              <input id="ob-db" value={dbName} onChange={e => setDbName(e.target.value)} autoFocus />
            </div>
            {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
            <button className="btn" style={{ width: '100%' }} onClick={next} disabled={busy}>Continuer</button>
            <div style={{ marginTop: 10 }}>
              <ImportButton label="Restaurer une sauvegarde" />
            </div>
          </>
        ) : (
          <>
            <h1>Votre compte principal</h1>
            <p className="lead">Renseignez son solde de départ.</p>
            <div className="field">
              <label htmlFor="ob-acc">Nom du compte</label>
              <input id="ob-acc" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ob-type">Type</label>
              <select id="ob-type" value={type} onChange={e => setType(e.target.value as AccountType)}>
                <option value="courant">Compte courant</option>
                <option value="epargne">Épargne</option>
                <option value="especes">Espèces</option>
                <option value="carte">Carte</option>
              </select>
            </div>
            <div className="grid two">
              <MoneyInput label="Solde initial (€)" valueCents={initial} onChange={setInitial} allowNegative />
              <div className="field">
                <label htmlFor="ob-date">Date de départ</label>
                <input id="ob-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
            </div>
            {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
            <button className="btn" style={{ width: '100%' }} onClick={next} disabled={busy}>
              Créer mon compte</button>
          </>
        )}
      </div>
    </div>
  );
}
