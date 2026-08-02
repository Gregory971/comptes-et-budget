import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

/**
 * Garde-fou de confidentialité.
 *
 * La CSP est le seul mécanisme qui rende la promesse « vos données ne quittent
 * jamais votre appareil » vérifiable par le navigateur plutôt que par relecture
 * du code. Un assouplissement de `connect-src` — ajouté un jour pour une police
 * de caractères distante, une carte ou un service de synchronisation — ouvrirait
 * une voie de sortie sans qu'aucun test existant ne s'en aperçoive.
 *
 * Vérifié en conditions réelles sur le site construit : fetch, XMLHttpRequest,
 * WebSocket et sendBeacon vers un domaine tiers émettent tous une violation
 * `connect-src`, le service worker restant actif.
 */
describe('politique de sécurité du contenu', () => {
  const directives = (single: boolean) =>
    Object.fromEntries(contentSecurityPolicy(single).split('; ').map(d => {
      const [name, ...values] = d.split(' ');
      return [name, values.join(' ')];
    }));

  it.each([
    ['servie en HTTP', false],
    ['fichier autonome', true],
  ])('interdit toute requête sortante (%s)', (_, single) => {
    expect(directives(single)['connect-src']).toBe("'none'");
  });

  it.each([
    ['servie en HTTP', false],
    ['fichier autonome', true],
  ])('verrouille les vecteurs d’exfiltration annexes (%s)', (_, single) => {
    const d = directives(single);
    // Un formulaire pointant vers un tiers exfiltrerait les champs saisis ;
    // <base> détournerait toutes les URL relatives de la page.
    expect(d['form-action']).toBe("'none'");
    expect(d['base-uri']).toBe("'none'");
    expect(d['object-src']).toBe("'none'");
    expect(d['default-src']).toBe("'self'");
  });

  it('n’autorise les scripts en ligne que dans le fichier autonome', () => {
    // Le mode servi en HTTP charge des fichiers séparés : rien ne justifie d'y
    // relâcher script-src, et cette dérogation est la plus coûteuse de toutes.
    expect(directives(false)['script-src']).toBe("'self'");
    expect(directives(true)['script-src']).toContain("'unsafe-inline'");
  });

  it('laisse passer l’icône incorporée en URI data:', () => {
    expect(directives(false)['img-src']).toBe("'self' data:");
  });

  it('omet frame-ancestors, sans effet en balise meta', () => {
    // Voir csp.ts : l'écrire laisserait croire à une protection inexistante.
    expect(contentSecurityPolicy(false)).not.toContain('frame-ancestors');
  });
});
