import { useState, useId } from 'react';
import { parseEuro, centsToInput, type Cents } from '../utils/money';

/**
 * Saisie monétaire tolérante à la virgule décimale.
 *
 * Correction P2 : les champs utilisaient input type="number" + parseFloat.
 * Selon le navigateur, « 12,50 » — réflexe naturel en français — était rejeté et
 * renvoyait une chaîne vide ; le bouton « Enregistrer » restait alors sans effet
 * et sans message. Le champ accepte désormais la virgule comme le point, et
 * signale explicitement une saisie invalide.
 */
export function MoneyInput({ label, valueCents, onChange, autoFocus, allowNegative, required }: {
  label?: string;
  valueCents: Cents | null;
  onChange: (cents: Cents | null) => void;
  autoFocus?: boolean;
  allowNegative?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(valueCents == null ? '' : centsToInput(valueCents));
  const [touched, setTouched] = useState(false);

  // Synchronisation avec la valeur externe (édition d'une ligne, remise à zéro
  // après enregistrement) selon le motif recommandé par React : ajustement
  // pendant le rendu plutôt qu'effet déclenchant un rendu en cascade.
  const [lastExternal, setLastExternal] = useState(valueCents);
  if (lastExternal !== valueCents) {
    setLastExternal(valueCents);
    if (parseEuro(text) !== valueCents) {
      setText(valueCents == null ? '' : centsToInput(valueCents));
    }
  }

  const parsed = parseEuro(text);
  const empty = text.trim() === '';
  const invalid = touched && !empty && (parsed === null || (!allowNegative && parsed < 0));
  const missing = touched && required && empty;

  return (
    <div className="field grow">
      {label && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder="0,00"
        value={text}
        aria-invalid={invalid || missing}
        aria-describedby={invalid || missing ? `${id}-err` : undefined}
        onBlur={() => setTouched(true)}
        onChange={e => {
          const v = e.target.value;
          setText(v);
          const cents = parseEuro(v);
          onChange(cents === null || (!allowNegative && cents < 0) ? null : cents);
        }}
      />
      {(invalid || missing) && (
        <small id={`${id}-err`} style={{ color: 'var(--red)' }}>
          {missing ? 'Montant obligatoire.' : 'Montant invalide — exemple : 12,50'}
        </small>
      )}
    </div>
  );
}
