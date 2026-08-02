import { useState } from 'react';
import { Modal } from './Modal';

/**
 * Choix de l'icône d'un groupe ou d'une catégorie.
 *
 * Le champ était auparavant une simple zone de texte, et seulement à la création
 * d'un groupe : composer un emoji supposait de connaître le raccourci du système
 * (Windows + point), et les catégories créées à la main n'avaient aucune icône —
 * elles s'affichaient avec un blanc là où les catégories du catalogue portent la
 * leur. La saisie libre reste possible pour les emoji absents de la palette.
 */

/** Palette organisée par usage, reprenant le vocabulaire du catalogue. */
const PALETTE: { theme: string; emojis: string[] }[] = [
  { theme: 'Alimentation', emojis: ['🛒', '🍽️', '🥖', '🍎', '☕', '🍷', '🍕', '🧀'] },
  { theme: 'Logement', emojis: ['🏠', '🏢', '💡', '💧', '🔥', '🛋️', '🔑', '🧹'] },
  { theme: 'Transport', emojis: ['🚗', '⛽', '🚌', '🚆', '✈️', '🚲', '🅿️', '🛵'] },
  { theme: 'Santé', emojis: ['⚕️', '💊', '🏥', '🦷', '👓', '🩺', '🧴', '🧘'] },
  { theme: 'Loisirs', emojis: ['🎬', '🎵', '🎮', '📚', '🏋️', '⚽', '🎨', '🎭'] },
  { theme: 'Abonnements', emojis: ['🔁', '📺', '🤖', '☁️', '📰', '🎧', '🕹️', '📀'] },
  { theme: 'Télécommunications', emojis: ['📱', '☎️', '🌐', '💻', '📡', '🖨️', '🔌', '📶'] },
  { theme: 'Banque et argent', emojis: ['🏦', '💳', '💶', '💰', '📈', '📉', '🧾', '🐷'] },
  { theme: 'Revenus', emojis: ['💼', '🏭', '🎁', '🏆', '📊', '🤝', '➕', '💵'] },
  { theme: 'Famille et quotidien', emojis: ['👶', '🐾', '🎓', '👕', '💇', '🧸', '🎂', '💐'] },
  { theme: 'Divers', emojis: ['📁', '🏷️', '⭐', '❤️', '🔧', '📦', '⚖️', '🗓️'] },
];

export function IconPicker({ value, onChange, label = 'Icône' }: {
  value?: string;
  onChange: (icon: string | undefined) => void;
  /** Décrit l'élément visé, pour les lecteurs d'écran. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [libre, setLibre] = useState('');

  const choisir = (icon: string | undefined) => {
    onChange(icon);
    setLibre('');
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="icon-pick" onClick={() => setOpen(true)}
        aria-label={value ? `${label} : ${value}. Modifier` : `${label} : aucune. Choisir`}>
        {value || <span className="icon-pick-vide" aria-hidden="true">＋</span>}
      </button>

      {open && (
        <Modal title={label} onClose={() => setOpen(false)} width={420}>
          {PALETTE.map(({ theme, emojis }) => (
            <div key={theme} className="icon-grid-bloc">
              <p className="icon-grid-titre">{theme}</p>
              <div className="icon-grid">
                {emojis.map(e => (
                  <button key={e} type="button" onClick={() => choisir(e)}
                    className={'icon-choix' + (e === value ? ' actif' : '')}
                    aria-label={`${theme} : ${e}`} aria-pressed={e === value}>{e}</button>
                ))}
              </div>
            </div>
          ))}

          <div className="inline" style={{ marginTop: 4 }}>
            <div className="field grow" style={{ margin: 0 }}>
              <label htmlFor="icone-libre">Autre emoji</label>
              <input id="icone-libre" value={libre} maxLength={8}
                placeholder="Collez un emoji"
                onChange={e => setLibre(e.target.value)} />
            </div>
            <button type="button" className="btn" disabled={!libre.trim()}
              onClick={() => choisir(libre.trim())}>Utiliser</button>
          </div>

          <div className="row">
            <button type="button" className="btn ghost" onClick={() => choisir(undefined)}>
              Aucune icône
            </button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
          </div>
        </Modal>
      )}
    </>
  );
}
