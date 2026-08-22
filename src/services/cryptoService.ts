// Chiffrement du fichier de sauvegarde.
//
// La sauvegarde .cbjson est destinée à un dossier Google Drive : elle quitte
// donc l'appareil, contrairement à la base elle-même. En clair, elle expose
// l'intégralité des comptes à qui accède au dossier synchronisé — la promesse
// de confidentialité de l'application s'arrêtait à l'export.
//
// Chiffrement effectué par le navigateur (WebCrypto), sans dépendance :
//  · clé dérivée de la phrase secrète par PBKDF2-HMAC-SHA256, 600 000
//    itérations — recommandation OWASP « Password Storage Cheat Sheet » pour
//    PBKDF2-SHA256 ;
//  · sel de 16 octets et vecteur d'initialisation de 12 octets tirés au hasard
//    à chaque export : deux sauvegardes du même contenu ne se ressemblent pas ;
//  · AES-GCM 256 bits, qui authentifie le message : un fichier altéré est
//    rejeté au lieu d'être déchiffré en données fausses.
//
// La phrase secrète n'est écrite nulle part. Perdue, la sauvegarde est
// irrécupérable — l'interface le dit avant l'export.

export const KDF_ITERATIONS = 600_000;
const ENVELOPE_FORMAT = 'comptes-budget-chiffre';
const ENVELOPE_VERSION = 1;

export interface EncryptedEnvelope {
  format: typeof ENVELOPE_FORMAT;
  version: number;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;   // base64
  iv: string;     // base64
  data: string;   // base64 — chiffré et authentifié
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const octet of bytes) s += String.fromCharCode(octet);
  return btoa(s);
};

const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('Ce navigateur ne fournit pas WebCrypto : le chiffrement est indisponible.');
  }
  return c.subtle;
};

async function deriveKey(
  passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number,
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Chiffre un texte et renvoie l'enveloppe JSON à écrire dans le fichier. */
export async function encryptText(plain: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('Phrase secrète vide.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));

  const envelope: EncryptedEnvelope = {
    format: ENVELOPE_FORMAT, version: ENVELOPE_VERSION, kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data),
  };
  return JSON.stringify(envelope);
}

/** Reconnaît une sauvegarde chiffrée sans tenter de la déchiffrer. */
export function isEncrypted(text: string): boolean {
  const debut = text.slice(0, 200);
  if (!debut.includes(ENVELOPE_FORMAT)) return false;
  try {
    return (JSON.parse(text) as EncryptedEnvelope).format === ENVELOPE_FORMAT;
  } catch {
    return false;
  }
}

/** Déchiffre une enveloppe. Une phrase fausse échoue franchement. */
export async function decryptText(text: string, passphrase: string): Promise<string> {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(text) as EncryptedEnvelope;
  } catch {
    throw new Error('Fichier illisible : ce n’est pas une sauvegarde chiffrée.');
  }
  if (envelope.format !== ENVELOPE_FORMAT) {
    throw new Error('Fichier illisible : ce n’est pas une sauvegarde chiffrée.');
  }
  if (envelope.version > ENVELOPE_VERSION) {
    throw new Error(`Fichier chiffré par une version plus récente de l’application (v${envelope.version}).`);
  }
  const key = await deriveKey(passphrase, fromB64(envelope.salt), envelope.iterations);
  try {
    const clear = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    return dec.decode(clear);
  } catch {
    // AES-GCM ne distingue pas la mauvaise clé du fichier altéré : les deux
    // font échouer la vérification d'authenticité.
    throw new Error('Phrase secrète incorrecte, ou fichier endommagé.');
  }
}
