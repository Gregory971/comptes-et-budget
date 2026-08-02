/**
 * Teinte stable déduite d'un libellé, pour colorer pastilles et segments.
 *
 * La maquette associait une teinte fixe à une liste figée de catégories. Les
 * catégories étant ici libres, la teinte est dérivée du nom : deux rendus
 * successifs donnent la même couleur, sans table à tenir à jour.
 */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
