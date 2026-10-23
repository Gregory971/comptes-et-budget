/** Déclenche le téléchargement d'un fichier généré dans la page. */
export function downloadFile(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  // Révocation différée : Firefox annule le téléchargement si l'URL part trop tôt.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
