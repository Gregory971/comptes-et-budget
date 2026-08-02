import { useStore } from './store/useStore';
import { useAccounts, useActiveDatabase } from './hooks/useData';
import { Layout } from './components/Layout';
import { DueSchedules } from './components/DueSchedules';
import { OnboardingWizard } from './screens/OnboardingWizard';
import { HomeScreen } from './screens/HomeScreen';
import { PreferencesScreen } from './screens/PreferencesScreen';
import { ComptesScreen } from './screens/ComptesScreen';
import { ComptabiliserScreen } from './screens/ComptabiliserScreen';
import { OperationsScreen } from './screens/OperationsScreen';
import { EcheancesScreen } from './screens/EcheancesScreen';
import { BilansScreen } from './screens/BilansScreen';
import { BudgetScreen } from './screens/BudgetScreen';
import { BiensScreen } from './screens/BiensScreen';

export default function App() {
  const screen = useStore(s => s.screen);
  const { database, loading } = useActiveDatabase();
  const accounts = useAccounts(database?.id, true);

  if (loading) {
    return <div className="onb"><div className="box"><p className="lead">Chargement…</p></div></div>;
  }

  // L'assistant ne s'affiche que si aucun compte n'existe, archivés compris :
  // archiver tous ses comptes ne renvoie plus l'utilisateur au premier démarrage.
  if (!database || accounts.length === 0) return <OnboardingWizard database={database} />;

  // Écrans à mise en page propre (barre d'actions contextuelle).
  if (screen === 'operations') {
    return <><OperationsScreen database={database} /><DueSchedules database={database} /></>;
  }
  if (screen === 'echeances') {
    return <><EcheancesScreen database={database} /><DueSchedules database={database} /></>;
  }

  const content = {
    accueil: <HomeScreen database={database} />,
    comptes: <ComptesScreen database={database} />,
    comptabiliser: <ComptabiliserScreen database={database} />,
    budget: <BudgetScreen database={database} />,
    bilans: <BilansScreen database={database} />,
    biens: <BiensScreen database={database} />,
    preferences: <PreferencesScreen database={database} />,
  }[screen];

  return (
    <Layout>
      <div className="content-pad">{content}</div>
      <DueSchedules database={database} />
    </Layout>
  );
}
