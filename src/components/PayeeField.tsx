import { useId } from 'react';
import type { Payee } from '../types';

/**
 * Champ « Tiers » en saisie libre avec autocomplétion.
 *
 * Correction : le tiers était un menu déroulant alimenté par le seul référentiel,
 * or la création d'une base n'initialise aucun tiers (contrairement aux
 * catégories et aux modes de paiement). Le menu était donc vide et il fallait
 * passer par Préférences → Tiers avant de pouvoir saisir la moindre opération.
 *
 * Le champ manipule le NOM du tiers, pas son identifiant : la résolution
 * (réutilisation ou création) a lieu à l'enregistrement, via
 * payeeService.resolveByName. Résoudre à la sortie du champ aurait laissé passer
 * un clic direct sur « Enregistrer », la création en base étant asynchrone.
 */
export function PayeeField({ payees, value, onChange, label = 'Qui — tiers' }: {
  payees: Payee[];
  value: string;                       // nom saisi
  onChange: (name: string) => void;
  label?: string;
}) {
  const id = useId();
  const active = payees.filter(p => !p.archived);
  const trimmed = value.trim();
  const known = payees.some(
    p => p.name.localeCompare(trimmed, 'fr', { sensitivity: 'base' }) === 0);

  return (
    <div className="field grow">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list={`${id}-list`}
        value={value}
        maxLength={60}
        autoComplete="off"
        placeholder="Ex : Carrefour, Employeur…"
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={`${id}-list`}>
        {active.map(p => <option key={p.id} value={p.name} />)}
      </datalist>
      <small className="muted">
        {trimmed && !known
          ? `« ${trimmed} » sera ajouté à vos tiers.`
          : 'Saisie libre — les tiers déjà enregistrés vous sont proposés.'}
      </small>
    </div>
  );
}
