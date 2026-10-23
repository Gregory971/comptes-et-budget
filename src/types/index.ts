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
export type AccountType = 'courant' | 'epargne' | 'especes' | 'carte' | 'pret';

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

/**
 * Conditions d'un prêt, portées par un compte de type « pret ».
 *
 * Le compte du prêt est une dette : son solde initial est le capital emprunté,
 * en négatif, et chaque mensualité comptabilisée le ramène vers zéro par un
 * virement du compte de financement (le capital) ; les intérêts et l'assurance
 * sont une dépense de ce même compte de financement.
 */
export interface LoanTerms {
  principalCents: Cents;          // capital emprunté (positif)
  /** Taux annuel en centièmes de pour cent : 350 = 3,50 %. */
  rateBp: number;
  months: number;                 // durée en mensualités
  firstPaymentDate: Ymd;          // date de la première mensualité
  /** Assurance ajoutée à chaque mensualité, hors capital et intérêts (0 si aucune). */
  insuranceMonthlyCents: Cents;
  /** Compte courant débité des mensualités. */
  fundingAccountId: string;
  /** Catégorie des intérêts et de l'assurance. */
  interestCategoryId?: string;
  /** Nombre de mensualités déjà comptabilisées ; évite tout doublon. */
  postedCount: number;
  /** true : les mensualités échues sont comptabilisées au lancement. */
  autoPost: boolean;
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
  /** Regroupement libre d'affichage (« Banque X », « Épargne »…). */
  group?: string;
  /** Numéro ou IBAN, pour s'y retrouver. */
  number?: string;
  /** Épinglé en tête des listes. */
  favorite?: boolean;
  /** Masqué des listes et du solde total, sans l'archiver ; réversible. */
  hidden?: boolean;
  /** Présent uniquement pour un compte de type « pret ». */
  loan?: LoanTerms;
  /**
   * Code de la devise du compte (« USD »). Absent : devise de la base. Voir
   * src/services/currencyService.ts pour la règle de conversion.
   */
  currency?: string;
}

export type TaskKind = 'tache' | 'note' | 'rappel';

/**
 * Pense-bête de la base : une tâche à faire, un rappel daté ou une simple note.
 * Une note n'a ni échéance ni état « fait ». Texte limité à 200 caractères.
 */
export interface Task extends Tracked {
  id: string; dbId: string;
  kind: TaskKind;
  text: string;
  /** Date limite ou date du rappel. */
  due?: Ymd;
  done: boolean;
  createdAt: string;
}

/** Titre financier suivi dans « Placements » (action, ETF, fonds…). */
export interface Security extends Tracked {
  id: string; dbId: string;
  name: string;
  /** ISIN, code ou symbole. */
  symbol?: string;
  archived: boolean;
}

export type SecurityTxType = 'achat' | 'vente' | 'dividende' | 'ajustement';

/**
 * Mouvement sur un titre. Pour un achat ou une vente : `quantity` et `unitPrice`
 * (euros par part, décimaux), `amountCents` = montant brut, `feesCents` = frais.
 * Dividende : `amountCents`. Ajustement (division, attribution gratuite,
 * regroupement) : `quantity` signée, sans montant.
 */
export interface SecurityTx extends Tracked {
  id: string; dbId: string; securityId: string;
  date: Ymd;
  type: SecurityTxType;
  quantity: number;
  unitPrice: number;
  feesCents: Cents;
  amountCents: Cents;
  /** Écritures bancaires créées avec le mouvement ; supprimées avec lui. */
  operationIds?: string[];
  note?: string;
  createdAt: string;
}

/** Cours d'un titre à une date (historique des cotations). */
export interface SecurityPrice extends Tracked {
  id: string; dbId: string; securityId: string;
  date: Ymd;
  /** Euros par part. */
  price: number;
}

/** Devise étrangère de la base, avec son taux de change vers la devise de la base. */
export interface Currency extends Tracked {
  id: string; dbId: string;
  code: string;      // ISO 4217, « USD »
  name: string;
  /** Valeur d'UNE unité de cette devise en devise de la base (1 USD = 0,92 → 0.92). */
  rate: number;
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

/** Document lié à une opération : un nom et un chemin de fichier ou un lien https (jamais le fichier). */
export interface DocumentLink {
  label: string;
  path: string;
}

/** Part d'une ventilation multiple : une catégorie et son montant, signé comme l'opération. */
export interface OperationSplit {
  categoryId?: string;
  amountCents: Cents;
  note?: string;
}

export interface Operation extends Tracked {
  id: string; dbId: string; accountId: string;
  date: Ymd;
  amountCents: Cents;      // signé : négatif pour une dépense
  kind: Kind;
  payeeId?: string;
  /** Absent quand l'opération est ventilée : voir `splits`. */
  categoryId?: string;
  /**
   * Ventilation multiple : répartition du montant sur plusieurs catégories (au
   * moins deux parts, dont la somme égale `amountCents`). Quand elle est
   * présente, `categoryId` est vide. Voir src/utils/splits.ts.
   */
  splits?: OperationSplit[];
  /** Documents liés (factures, tickets…) : chemins ou liens, voir src/utils/documents.ts. */
  documents?: DocumentLink[];
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
  // Le thème d'affichage n'est plus ici : c'est un réglage d'appareil, non une
  // donnée de la base — voir src/services/themeService.ts.
}

export type Periodicity = 'unique' | 'mensuelle' | 'trimestrielle' | 'annuelle';

export interface Schedule extends Tracked {   // Échéance (opération programmée)
  id: string; dbId: string; accountId: string;
  amountCents: Cents;        // signé
  kind: Kind;
  periodicity: Periodicity;
  nextDate: Ymd;             // prochaine échéance (date théorique)
  /**
   * Quantième d'origine de l'échéance (1 à 31), conservé pour que la date ne
   * dérive pas en traversant un mois court : un prélèvement du 31 revient au 31
   * après un passage au 28 ou 30 février. Absent des bases antérieures à la
   * v6 : le quantième de `nextDate` sert alors de repli.
   */
  anchorDay?: number;
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
  targetAmountCents: Cents;    // objectif
  /**
   * Solde d'OUVERTURE du projet : ce qui était déjà mis de côté avant tout
   * rattachement d'opération. L'épargne affichée est ce solde augmenté des
   * mouvements rattachés au projet (voir projectService.saved) — un seul
   * montant fait foi, là où l'ancien `savedAmountCents` cohabitait avec le
   * total des opérations rattachées sans qu'aucun des deux ne prime.
   */
  openingSavedCents: Cents;
  deadline?: Ymd; note?: string;
}

/**
 * Réglage propre à l'appareil (table `settings`), hors sauvegarde : il peut
 * porter un objet non sérialisable en JSON, tel qu'un FileSystemFileHandle.
 */
export interface Setting {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Règle de catégorisation apprise à l'import d'un relevé : un motif stable tiré
 * du libellé bancaire (« carrefour market ») renvoie à un tiers et/ou à une
 * catégorie. Créée ou ajustée quand l'utilisateur corrige une proposition à la
 * confirmation d'un import ; fait partie de la sauvegarde, comme les autres
 * référentiels. Jamais supprimée physiquement : `disabled` permet à la fusion
 * de sauvegardes de propager l'oubli d'une règle (la plus récente l'emporte).
 */
export interface CategorizationRule extends Tracked {
  id: string; dbId: string;
  /** Mots significatifs du libellé, en minuscules sans accents (1 ou 2 mots). */
  pattern: string;
  /** Sens de la ligne : une même enseigne peut débiter puis rembourser. */
  kind: 'depense' | 'recette';
  categoryId?: string;
  payeeId?: string;
  /** Nombre de fois où la règle a été posée ou confirmée par l'utilisateur. */
  hits: number;
  /** 'correction' : proposition modifiée ; 'ajout' : ligne jusque-là sans proposition. */
  origin: 'correction' | 'ajout';
  disabled: boolean;
  createdAt: string;
}
