/**
 * Détection d'une saisie en cours, avant un rechargement de la page.
 *
 * Recharger efface tout ce que l'écran contient et que la base ne connaît pas
 * encore : un montant à moitié tapé, un formulaire d'opération ouvert, l'adresse
 * saisie sur l'écran de connexion. L'application n'a pas d'état « modifié »
 * central ; on s'appuie donc sur deux indices lisibles dans le DOM, au prix
 * d'une prudence assumée — un faux positif ne coûte qu'une confirmation, un faux
 * négatif coûterait une saisie.
 *
 *  · une fenêtre modale est ouverte (`role="dialog"`, posé par Modal.tsx) : les
 *    formulaires d'opération, d'échéance, de virement, de rapprochement… y
 *    vivent tous ;
 *  · un champ de texte que l'utilisateur a modifié est encore affiché et non
 *    vide. Un champ qui a été vidé, ou qui a quitté l'écran (formulaire envoyé
 *    puis démonté), ne compte plus.
 *
 * Seule la présence d'une valeur est testée : son contenu n'est ni lu à d'autres
 * fins, ni conservé, ni journalisé — il peut s'agir d'un mot de passe.
 */

const TEXTUAL_TYPES = new Set([
  'text', 'search', 'email', 'password', 'number', 'tel', 'url',
  'date', 'time', 'datetime-local', 'month', 'week',
]);

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: EventTarget | null): el is TextField {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXTUAL_TYPES.has(el.type);
}

/** Champs modifiés par l'utilisateur depuis le chargement de la page. */
const edited = new Set<TextField>();

/**
 * Commence à suivre les champs modifiés. Renvoie la fonction qui arrête le suivi
 * (et oublie ce qui a été vu).
 */
export function watchPendingInput(doc: Document = document): () => void {
  // Phase de capture : un champ qui arrête la propagation reste vu. « change »
  // double « input » pour les remplissages automatiques et certains claviers.
  const onInput = (e: Event) => { if (isTextField(e.target)) edited.add(e.target); };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('change', onInput, true);
    edited.clear();
  };
}

/** Vrai si recharger la page risque de faire perdre une saisie. */
export function hasPendingInput(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"]')) return true;
  let pending = false;
  for (const field of edited) {
    if (!field.isConnected) edited.delete(field);
    else if (field.value !== '') pending = true;
  }
  return pending;
}
