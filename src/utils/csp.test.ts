import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, gatewayContentSecurityPolicy } from './csp';

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

  it('n’autorise les polices en data: que dans le fichier autonome', () => {
    // Celui-ci porte ses polices en base64 ; la version servie en HTTP les
    // charge comme fichiers et n'a aucune raison d'élargir la directive.
    expect(directives(true)['font-src']).toBe("'self' data:");
    expect(directives(false)['font-src']).toBe("'self'");
  });

  it('omet frame-ancestors, sans effet en balise meta', () => {
    // Voir csp.ts : l'écrire laisserait croire à une protection inexistante.
    expect(contentSecurityPolicy(false)).not.toContain('frame-ancestors');
  });
});

/**
 * La passerelle OneDrive est le seul document autorisé à sortir. Ces contrôles
 * délimitent exactement ce qu'elle peut joindre : le jour où quelqu'un y
 * ajouterait un service de mesure d'audience ou un dépôt de fichiers tiers, la
 * construction échouerait au lieu de le laisser passer.
 */
describe('politique de la passerelle OneDrive', () => {
  const d = Object.fromEntries(gatewayContentSecurityPolicy().split('; ').map(x => {
    const [name, ...values] = x.split(' ');
    return [name, values.join(' ')];
  }));
  const hotes = d['connect-src'].split(' ');

  it('n’autorise que Microsoft, et rien d’autre', () => {
    expect(hotes.sort()).toEqual([
      'https://*.files.1drv.com',
      'https://*.sharepoint.com',
      'https://graph.microsoft.com',
      'https://login.microsoftonline.com',
    ]);
  });

  it('n’ouvre jamais connect-src en grand', () => {
    expect(hotes).not.toContain('*');
    expect(hotes).not.toContain("'self'");
    expect(hotes).not.toContain('https:');
    for (const h of hotes) expect(h.startsWith('https://')).toBe(true);
  });

  it('conserve les verrous de la page principale', () => {
    expect(d['default-src']).toBe("'self'");
    expect(d['script-src']).toBe("'self'");
    expect(d['object-src']).toBe("'none'");
    expect(d['base-uri']).toBe("'none'");
    // Aucun formulaire ne part d'ici : la connexion se fait par navigation.
    expect(d['form-action']).toBe("'none'");
    // La passerelle n'encadre rien : elle est encadrée.
    expect(d['frame-src']).toBe("'none'");
  });

  it('laisse la page principale hermétique', () => {
    // Le point capital de toute cette architecture : ajouter OneDrive n'a rien
    // changé à la politique du document où vivent les données.
    expect(contentSecurityPolicy(false)).toContain("connect-src 'none'");
    expect(contentSecurityPolicy(true)).toContain("connect-src 'none'");
  });
});
