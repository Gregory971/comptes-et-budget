// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BarsChart, DonutChart } from './Charts';

afterEach(cleanup);

describe('DonutChart', () => {
  it('dessine un anneau plein quand une seule part vaut tout', () => {
    const { container } = render(<DonutChart data={[{ name: 'Sans tiers', valueCents: 161548 }]} by="tiers" />);
    const chemins = container.querySelectorAll('svg path');
    expect(chemins).toHaveLength(1);
    const d = chemins[0].getAttribute('d') ?? '';
    // Un arc de 360° a ses extrémités confondues : il serait invisible. On attend deux cercles (extérieur et intérieur).
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d).not.toMatch(/NaN/);
    expect(chemins[0].getAttribute('fill-rule')).toBe('evenodd');
  });

  it('garde un arc par part quand il y en a plusieurs', () => {
    const { container } = render(<DonutChart data={[{ name: 'A', valueCents: 100 }, { name: 'B', valueCents: 300 }]} />);
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
  });

  it('annonce l’absence de données plutôt que de dessiner du vide', () => {
    const { container } = render(<DonutChart data={[]} />);
    expect(container.textContent).toMatch(/Aucune donnée/);
  });
});

describe('BarsChart', () => {
  it('limite la largeur des barres quand il n’y a qu’un mois', () => {
    const { container } = render(<BarsChart data={[{ mois: '2026-10', recettesCents: 230000, depensesCents: 161548 }]} />);
    const largeurs = [...container.querySelectorAll('svg rect')]
      .filter(r => r.querySelector('title'))                      // les barres, pas la légende
      .map(r => Number(r.getAttribute('width')));
    expect(largeurs).toHaveLength(2);
    for (const w of largeurs) expect(w).toBeLessThanOrEqual(40);
  });
});
