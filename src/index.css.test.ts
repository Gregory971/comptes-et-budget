// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Garde-fou de mise en page.
 *
 * La feuille de style applique « input, select { width: 100% } » à TOUS les
 * champs. Appliquée à une case à cocher ou à un bouton radio, cette règle lui
 * donnait la largeur entière de la ligne, avec bordure et padding : le bouton
 * occupait la moitié du bloc et rejetait son libellé hors de la fenêtre
 * (bloc « Comptabiliser » du formulaire d'échéance).
 *
 * Ce test résout la cascade réelle sur un DOM et vérifie que les contrôles à
 * cocher échappent bien à la règle générique.
 */
describe('feuille de style — contrôles à cocher', () => {
  // Lecture du fichier source tel quel : on teste la feuille de style réelle,
  // sans passer par la transformation du bundler.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  });

  const computed = (type: string, className = '') => {
    const el = document.createElement('input');
    el.type = type;
    if (className) el.className = className;
    document.body.appendChild(el);
    return getComputedStyle(el);
  };

  it('laisse le bouton radio à sa taille naturelle', () => {
    const s = computed('radio');
    expect(s.width).toBe('auto');
    expect(s.padding).toBe('0px');
    expect(s.borderStyle).toBe('none');
  });

  it('laisse la case à cocher à sa taille naturelle', () => {
    const s = computed('checkbox');
    expect(s.width).toBe('auto');
    expect(s.padding).toBe('0px');
  });

  it('conserve la largeur pleine pour les champs de saisie', () => {
    expect(computed('text').width).toBe('100%');
    expect(computed('date').width).toBe('100%');
  });

  it('déclare la règle spécifique après la règle générique', () => {
    // La cascade se joue aussi sur l'ordre : la règle ciblée doit venir après.
    const generic = css.indexOf('input,select{');
    const specific = css.indexOf('input[type="radio"]');
    expect(generic).toBeGreaterThan(-1);
    expect(specific).toBeGreaterThan(generic);
  });

  it('plafonne la hauteur de la modale et fait défiler son corps', () => {
    // Sans plafond ni défilement, le formulaire d'échéance — le plus long de
    // l'application — dépassait la fenêtre : le bas était rogné et le bouton
    // d'enregistrement devenait inatteignable, sans barre de défilement.
    const modal = css.slice(css.indexOf('.modal{'), css.indexOf('.modal-body'));
    expect(modal).toContain('max-height:90vh');
    expect(modal).toContain('flex-direction:column');

    const body = css.slice(css.indexOf('.modal-body{'));
    expect(body.slice(0, body.indexOf('}'))).toContain('overflow-y:auto');

    // Repli sur les écrans très bas : le voile défile à son tour.
    const overlay = css.slice(css.indexOf('.modal-overlay{'), css.indexOf('.modal{'));
    expect(overlay).toContain('overflow-y:auto');
  });

  it('redéfinit toutes les couleurs pour le thème sombre', () => {
    // Une variable oubliée dans le bloc sombre laisserait une couleur claire
    // sur fond sombre — texte gris pâle sur gris pâle, illisible. Le contrôle
    // porte sur la couverture complète, non sur un échantillon.
    const tokens = (block: string) =>
      new Set([...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1]));

    const clair = css.slice(css.indexOf(':root{'), css.indexOf('/* ---- Thème sombre'));
    const sombre = css.slice(css.indexOf(':root[data-mode="sombre"]{'));
    const sombreBloc = sombre.slice(0, sombre.indexOf('}'));

    // Les variables de forme (rayons, largeurs, police) ne dépendent pas du thème.
    const formes = new Set(['r-card', 'r-card-sm', 'r-ctl', 'r-pill', 'sidebar-w', 'font-title']);
    const couleurs = [...tokens(clair)].filter(t => !formes.has(t));
    const definies = tokens(sombreBloc);

    expect(couleurs.length).toBeGreaterThan(15);
    expect(couleurs.filter(t => !definies.has(t))).toEqual([]);
  });

  it('suit le réglage du système tant qu’aucun thème n’est imposé', () => {
    // Le défaut « systeme » ne pose aucun attribut : sans requête média, le
    // mode sombre du système resterait sans effet.
    expect(css).toContain('@media (prefers-color-scheme:dark)');
    expect(css).toContain(':root:not([data-mode="clair"])');
    // color-scheme : sans lui, les contrôles natifs restent en blanc.
    expect(css).toContain('color-scheme:dark');
  });

  it('n’écrit plus de fond blanc en dur sur les surfaces', () => {
    // Ces règles doivent suivre le thème : un #fff figé y resterait blanc en
    // mode sombre. Le blanc reste légitime comme couleur de TEXTE sur fond
    // sombre (barre latérale, boutons pleins).
    for (const regle of ['.modal{', '.btn.ghost{', '.onb .box{', 'input,select{']) {
      const i = css.indexOf(regle);
      expect(i).toBeGreaterThan(-1);
      const bloc = css.slice(i, css.indexOf('}', i));
      expect(bloc).not.toContain('background:#fff');
      expect(bloc).not.toContain('background: #fff');
    }
  });

  it('rend le libellé des lignes radio lisible et extensible', () => {
    const label = document.createElement('label');
    label.className = 'radio-row';
    document.body.appendChild(label);
    const s = getComputedStyle(label);
    expect(s.display).toBe('flex');
    expect(s.alignItems).toBe('flex-start');
    // Le style global des <label> (gris, gras, 12 px) ne doit pas s'appliquer ici.
    expect(s.fontWeight).toBe('400');
  });
});
