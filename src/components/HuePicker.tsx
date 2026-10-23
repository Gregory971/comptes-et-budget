/**
 * Choix de la couleur d'une catégorie parmi quelques teintes nommées.
 *
 * « Automatique » laisse la teinte dérivée du nom (`hueOf`) : une catégorie sans choix garde
 * donc la couleur qu'elle avait jusqu'ici. Une liste déroulante plutôt qu'une palette de
 * pastilles : elle se lit et se manipule au clavier et avec un lecteur d'écran.
 */
export const TEINTES: { nom: string; hue: number }[] = [
  { nom: 'Rouge', hue: 25 }, { nom: 'Orange', hue: 55 }, { nom: 'Jaune', hue: 90 },
  { nom: 'Vert', hue: 150 }, { nom: 'Turquoise', hue: 195 }, { nom: 'Bleu', hue: 250 },
  { nom: 'Violet', hue: 300 }, { nom: 'Rose', hue: 350 },
];

export function HuePicker({ value, label, onChange }: {
  value?: number; label: string; onChange: (hue: number | undefined) => void;
}) {
  return (
    <select className="hue-pick" aria-label={label} value={value === undefined ? '' : String(value)}
      style={value === undefined ? undefined : { borderLeft: `6px solid oklch(0.62 0.14 ${value})` }}
      onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      <option value="">Automatique</option>
      {TEINTES.map(t => <option key={t.hue} value={t.hue}>{t.nom}</option>)}
    </select>
  );
}
