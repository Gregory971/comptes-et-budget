// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasPendingInput, watchPendingInput } from './pendingInput';

let stop: () => void;

beforeEach(() => { stop = watchPendingInput(); });
afterEach(() => { stop(); document.body.innerHTML = ''; });

/** Simule une frappe : pose la valeur puis émet l'évènement « input » comme le navigateur. */
function saisir(el: HTMLInputElement | HTMLTextAreaElement, valeur: string) {
  el.value = valeur;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('saisie en cours avant rechargement', () => {
  it('ne signale rien sur une page vierge', () => {
    document.body.innerHTML = '<input id="a" />';
    expect(hasPendingInput()).toBe(false);
  });

  it('signale un champ de texte rempli par l’utilisateur', () => {
    document.body.innerHTML = '<input id="a" type="text" />';
    saisir(document.getElementById('a') as HTMLInputElement, '12,50');
    expect(hasPendingInput()).toBe(true);
  });

  it('couvre le mot de passe, l’adresse, le montant et la zone de texte', () => {
    document.body.innerHTML = `
      <input id="p" type="password" /><input id="e" type="email" />
      <input id="n" type="number" /><textarea id="t"></textarea>`;
    for (const id of ['p', 'e', 'n', 't']) {
      const el = document.getElementById(id) as HTMLInputElement;
      saisir(el, '1');
      expect(hasPendingInput()).toBe(true);
      saisir(el, '');
      expect(hasPendingInput()).toBe(false);
    }
  });

  it('ne compte plus un champ vidé', () => {
    document.body.innerHTML = '<input id="a" />';
    const a = document.getElementById('a') as HTMLInputElement;
    saisir(a, 'abc');
    saisir(a, '');
    expect(hasPendingInput()).toBe(false);
  });

  it('ne compte plus un champ qui a quitté l’écran (formulaire envoyé puis démonté)', () => {
    document.body.innerHTML = '<form><input id="a" /></form>';
    saisir(document.getElementById('a') as HTMLInputElement, 'abc');
    expect(hasPendingInput()).toBe(true);
    document.body.innerHTML = '';
    expect(hasPendingInput()).toBe(false);
  });

  it('ignore une valeur préremplie que l’utilisateur n’a pas touchée', () => {
    document.body.innerHTML = '<input value="valeur par défaut" />';
    expect(hasPendingInput()).toBe(false);
  });

  it('ignore les cases à cocher et les listes (réglages appliqués aussitôt)', () => {
    document.body.innerHTML = '<input id="c" type="checkbox" /><select id="s"><option>a</option></select>';
    const c = document.getElementById('c') as HTMLInputElement;
    c.checked = true;
    c.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('s')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(hasPendingInput()).toBe(false);
  });

  it('signale toute fenêtre modale ouverte, même sans champ rempli', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><input /></div>';
    expect(hasPendingInput()).toBe(true);
  });

  it('cesse de suivre une fois arrêté', () => {
    document.body.innerHTML = '<input id="a" />';
    stop();
    saisir(document.getElementById('a') as HTMLInputElement, 'abc');
    expect(hasPendingInput()).toBe(false);
  });
});
