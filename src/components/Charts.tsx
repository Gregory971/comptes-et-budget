// Graphiques SVG légers (sans dépendance externe) — montants en centimes.
import { useId } from 'react';
import { formatInt, formatEur, type Cents } from '../utils/money';
import { formatFr } from '../utils/date';

// Palette catégorielle : volontairement fixe, pour qu'une catégorie garde sa
// couleur d'un thème à l'autre. Les teintes sont assez soutenues pour rester
// lisibles sur fond clair comme sur fond sombre ; seuls les axes, la grille et
// le trait principal suivent les variables du thème.
const PALETTE = ['#00a8a9', '#4a86e8', '#e05c52', '#f5a623', '#a76fce', '#2bb673',
  '#e67e22', '#3498db', '#fd79a8', '#95a5a6', '#00cec9', '#e84393'];

export function DonutChart({ data }: { data: { name: string; valueCents: Cents }[] }) {
  const titleId = useId();
  const total = data.reduce((s, d) => s + d.valueCents, 0);
  if (total <= 0) return <p className="muted">Aucune donnée sur la période.</p>;
  const R = 80, r = 48, cx = 100, cy = 100;

  // Bornes angulaires précalculées : aucune variable n'est mutée pendant le rendu.
  const bounds = data.reduce<{ start: number; end: number }[]>((acc, d, i) => {
    const start = i === 0 ? 0 : acc[i - 1].end;
    acc.push({ start, end: start + d.valueCents });
    return acc;
  }, []);

  const arcs = data.map((d, i) => {
    const a0 = bounds[i].start / total * 2 * Math.PI;
    const a1 = bounds[i].end / total * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    return (
      <path key={d.name} fill={PALETTE[i % PALETTE.length]}
        d={`M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`}>
        <title>{d.name} : {formatEur(d.valueCents)} ({(d.valueCents / total * 100).toFixed(0)} %)</title>
      </path>
    );
  });

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0 }}
        role="img" aria-labelledby={titleId}>
        <title id={titleId}>Répartition des dépenses par catégorie, total {formatEur(total)}</title>
        {arcs}
      </svg>
      <ul style={{ flex: 1, minWidth: 160, listStyle: 'none', margin: 0, padding: 0 }}>
        {data.map((d, i) => (
          <li key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 13 }}>
            <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 3, background: PALETTE[i % PALETTE.length] }} />
            <span style={{ flex: 1 }}>{d.name}</span>
            <span className="muted">{formatEur(d.valueCents)} · {(d.valueCents / total * 100).toFixed(0)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarsChart({ data }: { data: { mois: string; recettesCents: Cents; depensesCents: Cents }[] }) {
  const titleId = useId();
  if (data.length === 0) return <p className="muted">Aucune donnée sur la période.</p>;
  const W = 600, H = 240, pad = 36;
  const max = Math.max(1, ...data.flatMap(d => [d.recettesCents, d.depensesCents]));
  const bw = (W - pad * 2) / data.length;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 240 }} role="img" aria-labelledby={titleId}>
      <title id={titleId}>Recettes et dépenses par mois</title>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
      {data.map((d, i) => {
        const x = pad + i * bw;
        const w = bw / 3;
        return (
          <g key={d.mois}>
            <rect x={x + bw / 2 - w - 2} y={y(d.recettesCents)} width={w} height={H - pad - y(d.recettesCents)} fill="var(--green)">
              <title>{d.mois} — recettes : {formatEur(d.recettesCents)}</title>
            </rect>
            <rect x={x + bw / 2 + 2} y={y(d.depensesCents)} width={w} height={H - pad - y(d.depensesCents)} fill="var(--red)">
              <title>{d.mois} — dépenses : {formatEur(d.depensesCents)}</title>
            </rect>
            <text x={x + bw / 2} y={H - pad + 14} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.mois}</text>
          </g>
        );
      })}
      <g fontSize="11" fill="var(--muted)">
        <rect x={W - 150} y={8} width={10} height={10} fill="var(--green)" /><text x={W - 135} y={17}>Recettes</text>
        <rect x={W - 80} y={8} width={10} height={10} fill="var(--red)" /><text x={W - 65} y={17}>Dépenses</text>
      </g>
    </svg>
  );
}

export function LineChartSimple({ data }: { data: { date: string; soldeCents: Cents }[] }) {
  const titleId = useId();
  if (data.length === 0) return <p className="muted">Aucune donnée sur la période.</p>;
  const W = 600, H = 240, pad = 40;
  const vals = data.map(d => d.soldeCents);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const pts = data.map((d, i) => `${x(i)},${y(d.soldeCents)}`).join(' ');
  const zero = y(0);
  const last = data[data.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 240 }} role="img" aria-labelledby={titleId}>
      <title id={titleId}>
        Évolution du solde, de {formatEur(data[0].soldeCents)} le {formatFr(data[0].date)}
        {' '}à {formatEur(last.soldeCents)} le {formatFr(last.date)}
      </title>
      <line x1={pad} y1={zero} x2={W - pad} y2={zero} stroke="var(--line)" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={pts} />
      {data.map((d, i) => (
        <circle key={`${d.date}-${i}`} cx={x(i)} cy={y(d.soldeCents)} r={6} fill="transparent">
          <title>{formatFr(d.date)} : {formatEur(d.soldeCents)}</title>
        </circle>
      ))}
      <text x={pad} y={14} fontSize="11" fill="var(--muted)">{formatInt(max)} €</text>
      <text x={pad} y={H - pad + 14} fontSize="11" fill="var(--muted)">{formatInt(min)} €</text>
    </svg>
  );
}

/**
 * Courbe de trésorerie prévisionnelle, mois par mois.
 *
 * Deux tracés : le solde certain (échéances seules, trait plein) et le solde
 * prudent (enveloppes budgétaires consommées, trait pointillé). Les mêler en
 * une seule courbe reviendrait à présenter une estimation comme une certitude.
 * La bande sous zéro marque le découvert.
 */
export function HorizonChart({ data }: {
  data: { label: string; closingCents: Cents; closingWithBudgetCents: Cents; lowestCents: Cents }[];
}) {
  const titleId = useId();
  if (data.length === 0) return <p className="muted">Aucune projection disponible.</p>;

  const W = 620, H = 260, padX = 46, padY = 28;
  const vals = data.flatMap(d => [d.closingCents, d.closingWithBudgetCents, d.lowestCents]);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const x = (i: number) => padX + (i / Math.max(1, data.length - 1)) * (W - padX * 2);
  const y = (v: number) => H - padY - ((v - min) / (max - min || 1)) * (H - padY * 2);
  const ligne = (get: (d: typeof data[number]) => Cents) =>
    data.map((d, i) => `${x(i)},${y(get(d))}`).join(' ');
  const zero = y(0);
  const dernier = data[data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 260 }} role="img" aria-labelledby={titleId}>
      <title id={titleId}>
        Trésorerie prévisionnelle sur {data.length} mois, de {formatEur(data[0].closingCents)}
        {' '}fin {data[0].label} à {formatEur(dernier.closingCents)} fin {dernier.label}
      </title>
      {min < 0 && (
        <rect x={padX} y={zero} width={W - padX * 2} height={H - padY - zero}
          fill="var(--red)" opacity="0.10" />
      )}
      <line x1={padX} y1={zero} x2={W - padX} y2={zero} stroke="var(--red)" strokeWidth="1" opacity="0.6" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={ligne(d => d.closingCents)} />
      <polyline fill="none" stroke="var(--orange)" strokeWidth="2" strokeDasharray="5 4"
        points={ligne(d => d.closingWithBudgetCents)} />
      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.closingCents)} r={7} fill="transparent">
            <title>{d.label} : {formatEur(d.closingCents)} (échéances seules)</title>
          </circle>
          {(i === 0 || i === data.length - 1 || i % 2 === 0) && (
            <text x={x(i)} y={H - 6} fontSize="10" fill="var(--muted)" textAnchor="middle">
              {d.label.slice(0, 3)}
            </text>
          )}
        </g>
      ))}
      <text x={4} y={y(max) + 4} fontSize="11" fill="var(--muted)">{formatInt(max)} €</text>
      <text x={4} y={y(min) + 4} fontSize="11" fill="var(--muted)">{formatInt(min)} €</text>
    </svg>
  );
}
