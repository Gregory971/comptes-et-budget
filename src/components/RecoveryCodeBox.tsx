import { useState } from 'react';

/**
 * Affichage du code de récupération — la seule fois où il est visible.
 *
 * Le code n'est stocké nulle part (seule son empreinte l'est) : il est donc
 * impossible de le « réafficher ». D'où trois précautions : copie et
 * téléchargement offerts, avertissement placé AVANT le code et non en note de bas
 * de page, et une case à cocher qui tient lieu d'accusé de réception — sans elle,
 * on passe à côté de ce seul écran par réflexe, et on le regrette le jour où on
 * oublie son mot de passe.
 */
export function RecoveryCodeBox({ code, confirmLabel, onConfirm }: {
  code: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Presse-papiers refusé : le code reste lisible et téléchargeable.
      setCopied(false);
    }
  }

  function download() {
    const texte = [
      'Comptes & Budget — code de récupération',
      '',
      code,
      '',
      'Ce code permet de choisir un nouveau mot de passe si vous oubliez l’actuel.',
      'Il ne sert qu’une fois : un nouveau code est alors généré.',
      '',
      'Conservez-le hors de l’appareil (gestionnaire de mots de passe, papier),',
      'et PAS dans le même dossier que votre sauvegarde exportée.',
      '',
      `Généré le ${new Date().toLocaleDateString('fr-FR')}.`,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code-de-recuperation-comptes-et-budget.txt';
    a.click();
    // Révocation différée : Firefox annule le téléchargement si l'URL part trop tôt.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="recovery">
      <p className="auth-warn" role="note">
        ⚠️ Ce code ne sera <strong>plus jamais affiché</strong>. Sans lui et sans votre
        mot de passe, il n’existe aucun moyen de rouvrir l’application.
      </p>
      <code className="auth-code" aria-label="Code de récupération">{code}</code>
      <div className="inline" style={{ marginBottom: 12 }}>
        <button type="button" className="btn ghost" onClick={copy}>
          {copied ? '✅ Copié' : '📋 Copier'}
        </button>
        <button type="button" className="btn ghost" onClick={download}>⬇️ Télécharger</button>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
        <span>Je l’ai conservé dans un endroit sûr, hors de cet appareil.</span>
      </label>
      <button type="button" className="btn" disabled={!saved} onClick={onConfirm}
        style={{ width: '100%', marginTop: 8 }}>{confirmLabel}</button>
    </div>
  );
}
