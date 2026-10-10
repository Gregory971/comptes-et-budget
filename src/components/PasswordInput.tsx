import { useState } from 'react';
import { passwordStrength } from '../services/authService';

/**
 * Champ de mot de passe, avec bascule d'affichage.
 *
 * Les attributs ne sont pas décoratifs. `autoComplete` distingue le mot de passe
 * existant (« current-password ») du nouveau (« new-password ») : c'est ce qui
 * permet à un gestionnaire de mots de passe de remplir l'un et de proposer d'en
 * générer l'autre — la meilleure protection qu'un utilisateur puisse avoir ici.
 * Les corrections automatiques sont coupées : elles ont déjà fait fuiter des
 * mots de passe vers des services de saisie prédictive.
 */
export function PasswordInput({ id, label, value, onChange, autoComplete, autoFocus, describedBy }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} type={shown ? 'text' : 'password'} value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete} autoFocus={autoFocus} aria-describedby={describedBy}
          spellCheck={false} autoCapitalize="none" autoCorrect="off" />
        <button type="button" className="pw-eye" aria-pressed={shown}
          aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onClick={() => setShown(s => !s)}>
          <span aria-hidden="true">{shown ? '🙈' : '👁️'}</span>
        </button>
      </div>
    </div>
  );
}

const LABELS = ['Refusé', 'Juste', 'Correct', 'Solide'] as const;

/** Indicateur de solidité : trois segments, et un texte pour ne pas reposer sur la couleur seule. */
export function StrengthMeter({ password, id }: { password: string; id: string }) {
  if (!password) return <div id={id} className="meter" aria-live="polite" />;
  const score = passwordStrength(password);
  return (
    <div id={id} className="meter" aria-live="polite">
      <span className="meter-bars" aria-hidden="true">
        {[1, 2, 3].map(n => <i key={n} className={n <= score ? `on s${score}` : ''} />)}
      </span>
      <span>Solidité : <strong>{LABELS[score]}</strong></span>
    </div>
  );
}
