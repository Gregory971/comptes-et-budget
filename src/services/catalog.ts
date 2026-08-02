// Catalogue par défaut, repris du logiciel « Comptes et Budget ».
export const DEFAULT_PAYMENT_METHODS = [
  'VIR',  // Virement
  'PRL',  // Prélèvement
  'CB',   // Carte bancaire
  'ESP',  // Espèces
  'CHQ',  // Chèque
  'AU',   // Autre
];

export interface CatalogGroup {
  name: string; kind: 'depense' | 'recette'; icon: string; categories: { name: string; icon: string }[];
}

export const DEFAULT_CATEGORY_CATALOG: CatalogGroup[] = [
  { name: 'Revenus', kind: 'recette', icon: '💼', categories: [
    { name: 'Salaires', icon: '🏭' },
    { name: 'Revenus financiers', icon: '📊' },
    { name: 'Remboursements', icon: '💶' },
    { name: 'Revenus à catégoriser', icon: '➕' },
  ]},
  { name: 'Logement', kind: 'depense', icon: '🏠', categories: [
    { name: 'Loyer', icon: '🏠' },
    { name: 'Electricité Gaz', icon: '💡' },
    { name: 'Eau', icon: '💧' },
    { name: 'Assurance logement', icon: '🛡️' },
    { name: 'Charges / Copropriété', icon: '🏢' },
  ]},
  { name: 'Transport', kind: 'depense', icon: '🚗', categories: [
    { name: 'Assurance et taxes auto', icon: '🛡️' },
    { name: 'Carburant', icon: '⛽' },
    { name: 'Entretien véhicule', icon: '🔧' },
    { name: 'Transports en commun', icon: '🚆' },
  ]},
  { name: 'Télécommunications', kind: 'depense', icon: '📡', categories: [
    { name: 'Téléphone fixe', icon: '☎️' },
    { name: 'Téléphone mobile', icon: '📱' },
    { name: 'Télécom / Internet', icon: '🌐' },
  ]},
  { name: 'Banque & crédits', kind: 'depense', icon: '🏦', categories: [
    { name: 'Abonnement bancaire', icon: '🏦' },
    { name: 'Frais bancaires', icon: '💳' },
    { name: 'Credit pret conso', icon: '📉' },
    { name: 'Épargne', icon: '🐷' },
  ]},
  { name: 'Santé', kind: 'depense', icon: '⚕️', categories: [
    { name: 'Mutuelle', icon: '🧰' },
    { name: 'Médecin / Pharmacie', icon: '💊' },
  ]},
  { name: 'Vie quotidienne', kind: 'depense', icon: '🛒', categories: [
    { name: 'Alimentation', icon: '🛒' },
    { name: 'Restaurants', icon: '🍽️' },
    { name: 'Divers achats conso', icon: '🛍️' },
    { name: 'Jardinerie', icon: '🌱' },
    { name: 'Loisirs', icon: '🎬' },
    { name: 'Dépenses à catégoriser', icon: '➖' },
  ]},
];
