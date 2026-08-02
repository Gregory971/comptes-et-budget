// Modèle de données V2 — Comptes & Budget
//
// Deux conventions structurantes, appliquées partout :
//  · les dates métier sont des dates civiles « AAAA-MM-JJ » (type Ymd), jamais
//    des horodatages ISO — voir src/utils/date.ts ;
//  · les montants sont des centimes entiers (type Cents, suffixe « Cents »),
//    jamais des euros flottants — voir src/utils/money.ts.
// Les horodatages techniques (createdAt, updatedAt, deletedAt) restent en ISO
// complet : ce sont des instants, pas des dates métier.

import type { Ymd } from '../utils/date';
import type { Cents } from '../utils/money';
import type { HolidayRule, Region } from '../utils/holidays';

export type { Ymd, Cents, HolidayRule, Region };

export type Kind = 'depense' | 'recette' | 'virement';
export type AccountType = 'courant' | 'epargne' | 'especes' | 'carte';

export type Profile = 'perso' | 'pro';

/** Champs communs de traçabilité, utilisés par la fusion de sauvegardes. */
export interface Tracked {
  updatedAt: string;   // ISO — dernière modification
}

export interface Database extends Tracked {
  id: string;
  name: string;
  profile: Profile;      // 'perso' (bleu) ou 'pro' (charte ATPro)
  currency: string;      // "EUR"
  createdAt: string;     // ISO
  schemaVersion: number; // = SCHEMA_VERSION lors du dernier enregistrement
  /** Territoire de référence pour le calendrier des jours fériés. */
  holidayRegion: Region;
}

export interface Account extends Tracked {
  id: string;
  dbId: string;
  name: string;
  type: AccountType;
  initialBalanceCents: Cents;
  startDate: Ymd;
  logo?: string;          // emoji ou dataURL
  archived: boolean;
}

export interface Payee extends Tracked {   // Tiers
  id: string; dbId: string; name: string;
  defaultCategoryId?: string; archived: boolean;
}

export interface CategoryGroup extends Tracked {
  id: string; dbId: string; name: string;
  kind: 'depense' | 'recette'; icon?: string; sortOrder: number;
  archived: boolean;
}

export interface Category extends Tracked {
  id: string; dbId: string; groupId: string;
  name: string; icon?: string; archived: boolean;
}

export interface PaymentMethod extends Tracked {
  id: string; dbId: string; name: string; archived: boolean;
}

export interface Operation extends Tracked {
  id: string; dbId: string; accountId: string;
  date: Ymd;
  amountCents: Cents;      // signé : négatif pour une dépense
  kind: Kind;
  payeeId?: string;
  categoryId?: string;
  paymentMethodId?: string;
  label?: string;
  reference?: string;      // n° de chèque, référence de virement…
  note?: string;           // commentaire libre
  /** Rattachement facultatif à un bien du patrimoine ou à un projet d'épargne. */
  assetId?: string;
  projectId?: string;
  checked: boolean;        // pointé
  /** Identifiant commun aux deux écritures d'un virement entre comptes. */
  transferId?: string;
  createdAt: string;       // ISO
  deletedAt?: string;      // ISO — suppression logique
}

export interface Preferences extends Tracked {
  id: string; dbId: string;
  dateFormat: string; weekStart: number;
  defaultAccountId?: string; defaultPaymentMethodId?: string;
  theme: 'clair' | 'sombre';
}

export type Periodicity = 'unique' | 'mensuelle' | 'trimestrielle' | 'annuelle';

export interface Schedule extends Tracked {   // Échéance (opération programmée)
  id: string; dbId: string; accountId: string;
  amountCents: Cents;        // signé
  kind: Kind;
  periodicity: Periodicity;
  nextDate: Ymd;             // prochaine échéance (date théorique)
  /** Dernière échéance à produire ; au-delà, la programmation s'arrête. */
  endDate?: Ymd;
  /** true : comptabilisation automatique au lancement ; false : sur confirmation. */
  autoPost: boolean;
  /** Traitement d'une échéance tombant un jour férié ou non ouvré. */
  holidayRule: HolidayRule;
  /** Date effective de la dernière comptabilisation. */
  lastPostedDate?: Ymd;
  payeeId?: string; categoryId?: string; paymentMethodId?: string; label?: string;
  reference?: string; note?: string;
  assetId?: string; projectId?: string;
  active: boolean;
}

export interface Budget extends Tracked {     // Budget prévisionnel mensuel par catégorie
  id: string; dbId: string; categoryId: string; monthlyAmountCents: Cents;
}

export type AssetType = 'immobilier' | 'vehicule' | 'placement' | 'autre';

export interface Asset extends Tracked {      // Bien (patrimoine)
  id: string; dbId: string; name: string; type: AssetType;
  valueCents: Cents;        // valeur estimée actuelle
  acquiredDate?: Ymd; note?: string;
}

export interface Project extends Tracked {    // Projet d'épargne
  id: string; dbId: string; name: string;
  targetAmountCents: Cents; // objectif
  savedAmountCents: Cents;  // déjà épargné
  deadline?: Ymd; note?: string;
}
