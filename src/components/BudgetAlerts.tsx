import { useReferentials } from '../hooks/useData';
import {
  useBudgetAlertPrefs, useBudgetAlerts,
} from '../hooks/useBudgetAlerts';
import { useStore } from '../store/useStore';
import {
  budgetAlertService, LEVEL_LABEL, THRESHOLDS, type BudgetAlert,
} from '../services/budgetAlertService';
import { formatEur } from '../utils/money';

/**
 * Interface des alertes de budget : bandeau du tableau de bord, pastille de la
 * barre latérale et réglages des Préférences. La logique (niveaux, seuils,
 * masquage) vit dans budgetAlertService ; ce fichier ne fait que l'afficher.
 *
 * Accessibilité : le niveau est toujours écrit en toutes lettres
 * (« Dépassé », « Attention ») et doublé d'un pictogramme — la couleur n'est
 * qu'un renfort. Les changements sont annoncés par une zone `role="status"`.
 */

const ICON: Record<BudgetAlert['level'], string> = { attention: '⚠️', depasse: '⛔' };

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** « 2 alertes de budget, dont 1 dépassement » — lu par les lecteurs d'écran. */
export function alertsSummary(alerts: BudgetAlert[]): string {
  const over = alerts.filter(a => a.level === 'depasse').length;
  const base = `${alerts.length} ${plural(alerts.length, 'alerte', 'alertes')} de budget`;
  if (over === 0) return base;
  return `${base}, dont ${over} ${plural(over, 'dépassement', 'dépassements')}`;
}

/** Phrase décrivant la situation d'une catégorie, chiffres compris. */
export function alertMessage(a: BudgetAlert): string {
  if (a.level === 'depasse') {
    return `${formatEur(a.spentCents)} dépensés sur ${formatEur(a.budgetCents)} : `
      + `dépassement de ${formatEur(a.overCents)}.`;
  }
  // Arrondi vers le bas : 99,6 % ne doit pas s'afficher « 100 % » avant d'y être.
  return `${Math.floor(a.percent)} % du budget utilisé (${formatEur(a.spentCents)} sur `
    + `${formatEur(a.budgetCents)}), il reste ${formatEur(a.remainingCents)}.`;
}

/** Bandeau du tableau de bord ; ne rend rien s'il n'y a aucune alerte à montrer. */
export function BudgetAlertBanner({ dbId }: { dbId: string }) {
  const { alerts } = useBudgetAlerts(dbId);
  const ref = useReferentials(dbId);
  const setScreen = useStore(s => s.setScreen);
  if (alerts.length === 0) return null;

  const hasOver = alerts.some(a => a.level === 'depasse');
  return (
    <section className={'bud-alerts' + (hasOver ? ' depasse' : '')}
      aria-labelledby="bud-alerts-title">
      <div className="bud-alerts-head">
        <strong id="bud-alerts-title" className="panel-t">
          {hasOver ? 'Budget dépassé' : 'Budget bientôt atteint'}
        </strong>
        <button type="button" className="btn ghost" onClick={() => setScreen('budget')}>
          Voir le budget
        </button>
      </div>
      <p role="status" className="sr-only">{alertsSummary(alerts)}</p>
      <ul className="bud-alerts-list">
        {alerts.map(a => {
          const cat = ref.cat(a.categoryId);
          const name = cat?.name ?? 'Catégorie supprimée';
          return (
            <li key={a.categoryId} className={'bud-alert ' + a.level}>
              <span className="bud-alert-lvl">
                <span aria-hidden="true">{ICON[a.level]}</span> {LEVEL_LABEL[a.level]}
              </span>
              <span className="bud-alert-txt">
                <strong><span aria-hidden="true">{cat?.icon}</span> {name}</strong>
                {' — '}{alertMessage(a)}
              </span>
              <button type="button" className="btn ghost bud-alert-hide"
                aria-label={`Masquer pour ce mois l’alerte ${name}`}
                onClick={() => void budgetAlertService.dismiss(dbId, a)}>
                Masquer pour ce mois
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Pastille de l'entrée « Budget » de la barre latérale : le nombre d'alertes,
 * rouge dès qu'un budget est dépassé. Le décompte est aussi donné en texte
 * masqué, qui complète le nom accessible du bouton.
 */
export function BudgetNavBadge({ dbId }: { dbId: string }) {
  const { alerts } = useBudgetAlerts(dbId);
  if (alerts.length === 0) return null;
  const hasOver = alerts.some(a => a.level === 'depasse');
  return (
    <>
      <span className={'nav-alert ' + (hasOver ? 'depasse' : 'attention')} aria-hidden="true">
        {alerts.length}
      </span>
      <span className="sr-only">, {alertsSummary(alerts)}</span>
    </>
  );
}

/** Réglages des Préférences : activation, seuil d'attention, alertes masquées. */
export function BudgetAlertSettings({ dbId }: { dbId: string }) {
  const prefs = useBudgetAlertPrefs();
  const { hiddenCount: hidden } = useBudgetAlerts(dbId);
  return (
    <>
      <strong>Alertes de budget</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Un bandeau du tableau de bord et une pastille sur « Budget » signalent les
        catégories proches de leur budget mensuel, puis celles qui le dépassent.
        Réglage propre à cet appareil : il n’entre pas dans la sauvegarde. Les
        barres de l’écran Budget gardent leurs couleurs d’état dans tous les cas.
      </p>
      <label className="inline-check">
        <input type="checkbox" checked={prefs.enabled}
          onChange={e => void budgetAlertService.setEnabled(e.target.checked)} />
        Activer les alertes de budget
      </label>
      <div className="segmented" role="group" aria-label="Seuil d’attention">
        {THRESHOLDS.map(t => (
          <button key={t} type="button" className={prefs.threshold === t ? 'on' : ''}
            aria-pressed={prefs.threshold === t} disabled={!prefs.enabled}
            onClick={() => void budgetAlertService.setThreshold(t)}>{t} %</button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
        Seuil d’attention : l’alerte « Attention » apparaît dès que {prefs.threshold} % du
        budget d’une catégorie est dépensé ; « Dépassé » au-delà de 100 %.
      </p>
      {hidden > 0 && (
        <button type="button" className="btn ghost" style={{ marginTop: 10 }}
          onClick={() => void budgetAlertService.clearDismissed(dbId)}>
          Réafficher {hidden === 1 ? 'l’alerte masquée' : `les ${hidden} alertes masquées`} ce mois-ci
        </button>
      )}
    </>
  );
}
