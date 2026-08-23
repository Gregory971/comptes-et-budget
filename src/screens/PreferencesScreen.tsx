import { useEffect, useState } from 'react';
import { useReferentials } from '../hooks/useData';
import { Modal, ConfirmDialog } from '../components/Modal';
import { ImportButton } from '../components/ImportButton';
import { ExportButton } from '../components/ExportButton';
import { IconPicker } from '../components/IconPicker';
import { payeeService, paymentMethodService, categoryService, type RemoveResult } from '../services/referentialService';
import {
  chooseFile, chooseFolder, forgetFile, run as runAutoBackup,
  status as autoBackupStatus, daysSince, KEEP_COPIES, type AutoBackupStatus,
} from '../services/autoBackupService';
import { dbService } from '../services/dbService';
import { readTheme, writeTheme, THEME_LABEL, type ThemeMode } from '../services/themeService';
import {
  ensurePersistentStorage, formatBytes, storageStatus, type StorageStatus,
} from '../services/storageService';
import { REGION_LABEL, holidaysOfYear, type Region } from '../utils/holidays';
import { formatFr } from '../utils/date';
import type { Category, CategoryGroup, Database } from '../types';

type Tab = 'tiers' | 'categories' | 'modes' | 'general';

const TABS: [Tab, string][] = [
  ['tiers', 'Tiers'], ['categories', 'Catégories'],
  ['modes', 'Modes de paiement'], ['general', 'Général'],
];

export function PreferencesScreen({ database }: { database: Database }) {
  const [tab, setTab] = useState<Tab>('tiers');
  return (
    <>
      <h1 className="page-title">Préférences</h1>
      <p className="page-sub">Gérez les référentiels utilisés lors de la saisie.</p>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'tiers' && <TiersTab database={database} />}
      {tab === 'categories' && <CategoriesTab database={database} />}
      {tab === 'modes' && <ModesTab database={database} />}
      {tab === 'general' && <GeneralTab database={database} />}
    </>
  );
}

/**
 * Message commun lorsqu'une suppression est refusée pour cause de références.
 * Correction P2 : la suppression physique laissait auparavant des références
 * orphelines dans les opérations passées, sans le moindre avertissement.
 */
function refusalMessage(result: RemoveResult, what: string): string | null {
  if (result.removed) return null;
  return `Impossible de supprimer définitivement ${what} : ${result.references} opération(s) y font référence. Vous pouvez l’archiver — il disparaîtra des listes de saisie tout en restant lisible dans l’historique.`;
}

function TiersTab({ database }: { database: Database }) {
  const dbId = database.id;
  const { payees } = useReferentials(dbId);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = payees.filter(p => showArchived || !p.archived);

  return (
    <div className="card">
      <div className="inline">
        <div className="field grow"><label htmlFor="pa-name">Nouveau tiers</label>
          <input id="pa-name" value={name} onChange={e => setName(e.target.value)}
            placeholder="Ex : Carrefour, Employeur" /></div>
        <button className="btn" onClick={async () => {
          if (name.trim()) { await payeeService.create(dbId, name); setName(''); }
        }}>Ajouter</button>
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
        Afficher les tiers archivés
      </label>
      <table className="simple">
        <tbody>
          {visible.map(p => (
            <tr key={p.id} style={{ opacity: p.archived ? 0.55 : 1 }}>
              <td>{p.name}{p.archived && <span className="chip" style={{ marginLeft: 8 }}>archivé</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {p.archived ? (
                  <button className="btn ghost" onClick={() => payeeService.restore(p.id)}>Réactiver</button>
                ) : (
                  <button className="btn ghost" onClick={() => payeeService.archive(p.id)}>Archiver</button>
                )}
                <button className="iconbtn" style={{ marginLeft: 6 }}
                  aria-label={`Supprimer définitivement le tiers ${p.name}`}
                  onClick={async () => setNotice(refusalMessage(await payeeService.remove(dbId, p.id), `le tiers « ${p.name} »`))}>🗑</button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && <tr><td className="muted">Aucun tiers.</td></tr>}
        </tbody>
      </table>
      {notice && (
        <Modal title="Suppression impossible" onClose={() => setNotice(null)} width={480}>
          <p role="alert">{notice}</p>
          <div className="row"><span /><button className="btn" onClick={() => setNotice(null)}>Fermer</button></div>
        </Modal>
      )}
    </div>
  );
}

function ModesTab({ database }: { database: Database }) {
  const dbId = database.id;
  const { methods } = useReferentials(dbId);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="inline">
        <div className="field grow"><label htmlFor="pm-name">Nouveau mode de paiement</label>
          <input id="pm-name" value={name} onChange={e => setName(e.target.value)}
            placeholder="Ex : CB, Espèces, Virement" /></div>
        <button className="btn" onClick={async () => {
          if (name.trim()) { await paymentMethodService.create(dbId, name); setName(''); }
        }}>Ajouter</button>
      </div>
      <table className="simple">
        <tbody>
          {methods.map(m => (
            <tr key={m.id} style={{ opacity: m.archived ? 0.55 : 1 }}>
              <td>{m.name}{m.archived && <span className="chip" style={{ marginLeft: 8 }}>archivé</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {m.archived ? (
                  <button className="btn ghost" onClick={() => paymentMethodService.restore(m.id)}>Réactiver</button>
                ) : (
                  <button className="btn ghost" onClick={() => paymentMethodService.archive(m.id)}>Archiver</button>
                )}
                <button className="iconbtn" style={{ marginLeft: 6 }}
                  aria-label={`Supprimer définitivement le mode ${m.name}`}
                  onClick={async () => setNotice(refusalMessage(await paymentMethodService.remove(dbId, m.id), `le mode « ${m.name} »`))}>🗑</button>
              </td>
            </tr>
          ))}
          {methods.length === 0 && <tr><td className="muted">Aucun mode de paiement.</td></tr>}
        </tbody>
      </table>
      {notice && (
        <Modal title="Suppression impossible" onClose={() => setNotice(null)} width={480}>
          <p role="alert">{notice}</p>
          <div className="row"><span /><button className="btn" onClick={() => setNotice(null)}>Fermer</button></div>
        </Modal>
      )}
    </div>
  );
}

function CategoriesTab({ database }: { database: Database }) {
  const dbId = database.id;
  const { groups, cats } = useReferentials(dbId);
  const [gName, setGName] = useState('');
  const [gKind, setGKind] = useState<'depense' | 'recette'>('depense');
  const [gIcon, setGIcon] = useState('📁');
  const [catInputs, setCatInputs] = useState<Record<string, string>>({});
  const [catIcons, setCatIcons] = useState<Record<string, string | undefined>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<CategoryGroup | null>(null);
  const [confirmCat, setConfirmCat] = useState<Category | null>(null);

  return (
    <div className="card">
      <div className="inline">
        <div className="field" style={{ width: 'auto' }}><label>Icône</label>
          <IconPicker value={gIcon} label="Icône du groupe"
            onChange={icon => setGIcon(icon ?? '')} /></div>
        <div className="field grow"><label htmlFor="cg-name">Nouveau groupe</label>
          <input id="cg-name" value={gName} onChange={e => setGName(e.target.value)}
            placeholder="Ex : Alimentation" /></div>
        <div className="field" style={{ width: 140 }}><label htmlFor="cg-kind">Type</label>
          <select id="cg-kind" value={gKind} onChange={e => setGKind(e.target.value as 'depense' | 'recette')}>
            <option value="depense">Dépense</option><option value="recette">Recette</option></select></div>
        <button className="btn" onClick={async () => {
          if (gName.trim()) { await categoryService.createGroup(dbId, gName, gKind, gIcon); setGName(''); }
        }}>Ajouter le groupe</button>
      </div>

      {groups.map(g => (
        <div key={g.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0', opacity: g.archived ? 0.55 : 1 }}>
          <div className="row">
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconPicker value={g.icon} label={`Icône du groupe ${g.name}`}
                onChange={icon => categoryService.updateGroup(g.id, { icon })} />
              {g.name}
              <span className={'chip ' + (g.kind === 'depense' ? 'dep' : 'rec')}>{g.kind}</span>
              {g.archived && <span className="chip">archivé</span>}
            </strong>
            <span style={{ whiteSpace: 'nowrap' }}>
              {g.archived ? (
                <button className="btn ghost" onClick={() => categoryService.restoreGroup(g.id)}>Réactiver</button>
              ) : (
                <button className="btn ghost" onClick={() => categoryService.archiveGroup(g.id)}>Archiver</button>
              )}
              <button className="iconbtn" style={{ marginLeft: 6 }}
                aria-label={`Supprimer définitivement le groupe ${g.name}`}
                onClick={() => setConfirmGroup(g)}>🗑</button>
            </span>
          </div>
          <ul className="sub-list">
            {cats.filter(c => c.groupId === g.id).map(c => (
              <li key={c.id} style={{ opacity: c.archived ? 0.55 : 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconPicker value={c.icon} label={`Icône de la catégorie ${c.name}`}
                    onChange={icon => categoryService.updateCategory(c.id, { icon })} />
                  {c.name}
                  {c.archived && <span className="chip">archivée</span>}</span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {c.archived ? (
                    <button className="btn ghost" style={{ padding: '2px 8px' }}
                      onClick={() => categoryService.restoreCategory(c.id)}>Réactiver</button>
                  ) : (
                    <button className="btn ghost" style={{ padding: '2px 8px' }}
                      onClick={() => categoryService.archiveCategory(c.id)}>Archiver</button>
                  )}
                  <button className="iconbtn" style={{ marginLeft: 6 }}
                    aria-label={`Supprimer définitivement la catégorie ${c.name}`}
                    onClick={() => setConfirmCat(c)}>🗑</button>
                </span>
              </li>
            ))}
          </ul>
          <div className="inline" style={{ marginTop: 8 }}>
            <IconPicker value={catIcons[g.id]} label={`Icône de la nouvelle catégorie dans ${g.name}`}
              onChange={icon => setCatIcons({ ...catIcons, [g.id]: icon })} />
            <div className="field grow" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor={`cat-${g.id}`}>Nouvelle catégorie dans {g.name}</label>
              <input id={`cat-${g.id}`} placeholder="+ catégorie dans ce groupe"
                value={catInputs[g.id] || ''}
                onChange={e => setCatInputs({ ...catInputs, [g.id]: e.target.value })} /></div>
            <button className="btn ghost" onClick={async () => {
              const v = (catInputs[g.id] || '').trim();
              if (!v) return;
              // Sans icône choisie, la catégorie hérite de celle du groupe plutôt
              // que de rester vide : une ligne sans pictogramme se repère mal
              // dans les listes d'opérations.
              await categoryService.createCategory(dbId, g.id, v, catIcons[g.id] ?? g.icon);
              setCatInputs({ ...catInputs, [g.id]: '' });
              setCatIcons({ ...catIcons, [g.id]: undefined });
            }}>Ajouter</button>
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="muted">Aucun groupe de catégories.</p>}

      {confirmGroup && (
        <ConfirmDialog title="Supprimer le groupe" danger confirmLabel="Supprimer définitivement"
          message={`Supprimer le groupe « ${confirmGroup.name} » et toutes ses catégories ? La suppression est refusée si des opérations y font référence — préférez l’archivage.`}
          onConfirm={async () => setNotice(refusalMessage(
            await categoryService.removeGroup(dbId, confirmGroup.id), `le groupe « ${confirmGroup.name} »`))}
          onClose={() => setConfirmGroup(null)} />
      )}
      {confirmCat && (
        <ConfirmDialog title="Supprimer la catégorie" danger confirmLabel="Supprimer définitivement"
          message={`Supprimer la catégorie « ${confirmCat.name} » ? Le budget associé sera également supprimé.`}
          onConfirm={async () => setNotice(refusalMessage(
            await categoryService.removeCategory(dbId, confirmCat.id), `la catégorie « ${confirmCat.name} »`))}
          onClose={() => setConfirmCat(null)} />
      )}
      {notice && (
        <Modal title="Suppression impossible" onClose={() => setNotice(null)} width={500}>
          <p role="alert">{notice}</p>
          <div className="row"><span /><button className="btn" onClick={() => setNotice(null)}>Fermer</button></div>
        </Modal>
      )}
    </div>
  );
}

function GeneralTab({ database }: { database: Database }) {
  const [name, setName] = useState(database.name);
  const [msg, setMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [asking, setAsking] = useState(false);

  const [auto, setAuto] = useState<AutoBackupStatus | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => { void storageStatus().then(setStorage); }, []);
  useEffect(() => { void autoBackupStatus().then(setAuto); }, []);
  const year = new Date().getFullYear();
  const holidays = [...holidaysOfYear(year, database.holidayRegion).entries()]
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="card">
      <div className="inline">
        <div className="field grow"><label htmlFor="ge-name">Nom de la base</label>
          <input id="ge-name" value={name} onChange={e => setName(e.target.value)} /></div>
        <button className="btn" disabled={!name.trim() || name === database.name}
          onClick={async () => { await dbService.rename(database.id, name); setMsg('Nom enregistré.'); }}>
          Renommer</button>
      </div>
      <div className="field"><label htmlFor="ge-cur">Devise</label>
        <input id="ge-cur" value="Euro (€)" disabled /></div>

      <hr className="sep" />

      <strong>Apparence</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Réglage propre à cet appareil : il n’entre pas dans la sauvegarde.
        « Système » suit le mode clair ou sombre de l’ordinateur ou du téléphone.
      </p>
      <div className="segmented" role="group" aria-label="Thème d’affichage">
        {(['systeme', 'clair', 'sombre'] as ThemeMode[]).map(m => (
          <button key={m} type="button" className={theme === m ? 'on' : ''}
            aria-pressed={theme === m}
            onClick={() => { writeTheme(m); setTheme(m); }}>{THEME_LABEL[m]}</button>
        ))}
      </div>

      <hr className="sep" />

      <strong>Stockage de la base sur cet appareil</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Sans classement « persistant », le navigateur peut effacer la base pour
        récupérer de l’espace disque, et Safari le fait d’office au bout de sept
        jours sans ouverture. Le classement demandé ici met la base à l’abri de
        cette suppression automatique ; vous seul pouvez encore l’effacer.
        Une sauvegarde exportée régulièrement reste la protection de dernier ressort.
      </p>
      <table className="simple" style={{ maxWidth: 460 }}>
        <tbody>
          <tr><td className="muted">État</td><td><strong>{
            storage === null ? '…'
              : storage.state === 'persistant' ? '🔒 Persistant — à l’abri de l’éviction'
              : storage.state === 'temporaire' ? '⚠️ Temporaire — suppression possible par le navigateur'
              : 'Non géré par ce navigateur'
          }</strong></td></tr>
          {storage?.usageBytes !== undefined && (
            <tr><td className="muted">Occupation</td>
              <td>{formatBytes(storage.usageBytes)} sur {formatBytes(storage.quotaBytes)} accordés</td></tr>
          )}
        </tbody>
      </table>
      {storage?.state === 'temporaire' && (
        <button className="btn" style={{ marginTop: 10 }} disabled={asking}
          onClick={async () => {
            setAsking(true);
            const next = await ensurePersistentStorage();
            setStorage(next);
            setMsg(next.state === 'persistant'
              ? 'Stockage persistant accordé : la base ne sera plus évincée automatiquement.'
              : 'Le navigateur a refusé pour l’instant. Il l’accorde en général après quelques ouvertures de l’application, ou après son installation sur l’appareil.');
            setAsking(false);
          }}>
          {asking ? 'Demande en cours…' : 'Demander le stockage persistant'}
        </button>
      )}

      <hr className="sep" />

      <strong>Jours fériés et jours ouvrés</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Détermine le report des échéances tombant un jour férié ou non ouvré.
        Source : code du travail, articles L3133-1 (11 jours nationaux) et L3422-2
        (commémoration de l’abolition de l’esclavage, propre à chaque territoire).
      </p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="ge-region">Territoire de référence</label>
        <select id="ge-region" value={database.holidayRegion}
          onChange={async e => {
            await dbService.setHolidayRegion(database.id, e.target.value as Region);
            setMsg('Calendrier des jours fériés mis à jour.');
          }}>
          {(Object.keys(REGION_LABEL) as Region[]).map(r =>
            <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
        </select>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          Voir les {holidays.length} jours fériés de {year}
        </summary>
        <ul className="sub-list" style={{ marginTop: 8 }}>
          {holidays.map(([date, label]) => (
            <li key={date}><span>{formatFr(date)}</span><span className="muted">{label}</span></li>
          ))}
        </ul>
      </details>

      <hr className="sep" />

      <strong>Sauvegarde &amp; synchronisation (OneDrive, Google Drive…)</strong>
      <ol className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
        <li><strong>Exporter</strong> : génère un fichier <code>.cbjson</code> contenant toute la base.</li>
        <li>Enregistrez-le dans le dossier synchronisé de votre service — « OneDrive » sous
          Windows, « Google Drive pour ordinateur », iCloud Drive sur Mac. La synchronisation
          est alors assurée par ce service, l’application n’émettant aucune requête.</li>
        <li>Sur l’autre appareil : <strong>Importer</strong>, puis choisissez <em>Fusionner</em> pour
          conserver les saisies faites des deux côtés.</li>
      </ol>
      <div className="inline">
        <ExportButton className="btn" label="Exporter la sauvegarde" />
        <ImportButton label="Importer une sauvegarde" />
      </div>

      <hr className="sep" />

      <strong>Sauvegarde automatique — OneDrive, Google Drive, iCloud…</strong>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Désignez une destination une seule fois, dans le dossier synchronisé de
        votre service — <code>C:\Users\…\OneDrive\</code> sous Windows,{' '}
        <code>~/OneDrive/</code> sur Mac — et l’application y écrit la sauvegarde à
        chaque ouverture et à chaque passage de l’onglet en arrière-plan, sans
        nouvelle question. C’est le client de synchronisation, déjà installé sur
        votre machine, qui l’envoie ensuite dans le nuage : l’application, elle,
        n’émet aucune requête réseau.
      </p>
      <ul className="muted" style={{ fontSize: 13, paddingLeft: 20, marginTop: 4 }}>
        <li><strong>Un dossier</strong> (recommandé) : une copie datée par jour, les
          {' '}{KEEP_COPIES} plus récentes conservées. Une base vidée par erreur
          n’écrase pas la dernière copie valide.</li>
        <li><strong>Un fichier</strong> : une seule copie, réécrite à chaque fois.
          L’historique dépend alors du versionnage de votre service.</li>
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>
        <strong>Ces fichiers sont écrits en clair</strong> : chiffrer supposerait de
        retenir la phrase secrète d’une session à l’autre, donc de l’écrire quelque
        part. Si le dossier est partagé avec d’autres personnes, préférez l’export
        manuel chiffré ci-dessus.
      </p>
      {auto && !auto.supported ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Ce navigateur ne permet pas d’écrire directement dans un fichier
          (fonction disponible sur Chrome, Edge et Opera). L’application se limite
          ici à rappeler la date du dernier export
          {auto.lastManualExportAt
            ? ` — il remonte à ${daysSince(auto.lastManualExportAt)} jour(s).`
            : ' — aucun export effectué depuis cet appareil.'}
        </p>
      ) : auto && (
        <>
          <table className="simple" style={{ maxWidth: 520 }}>
            <tbody>
              <tr><td className="muted">Destination</td>
                <td>{auto.configured
                  ? <><strong>{auto.targetName}</strong>
                    <span className="muted"> ({auto.kind === 'dossier' ? 'dossier' : 'fichier'})</span></>
                  : 'aucune'}</td></tr>
              {auto.configured && (
                <tr><td className="muted">Dernière écriture</td>
                  <td>{auto.lastRunAt
                    ? <>{new Date(auto.lastRunAt).toLocaleString('fr-FR')} (il y a {daysSince(auto.lastRunAt)} j)
                      {auto.lastFileName && auto.kind === 'dossier' && (
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {auto.lastFileName}</span>)}</>
                    : 'jamais'}</td></tr>
              )}
              {auto.lastError && (
                <tr><td className="muted">Dernière erreur</td>
                  <td style={{ color: 'var(--red)' }}>{auto.lastError}</td></tr>
              )}
            </tbody>
          </table>
          <div className="inline" style={{ marginTop: 10 }}>
            {auto.folderSupported && (
              <button className="btn" disabled={autoBusy} onClick={async () => {
                setAutoBusy(true);
                try {
                  setAuto(await chooseFolder(database.name));
                  setMsg('Sauvegarde automatique activée dans le dossier choisi.');
                } catch (e) {
                  setMsg((e as Error).message);
                } finally { setAutoBusy(false); }
              }}>
                📁 {auto.kind === 'dossier' ? 'Changer de dossier' : 'Choisir un dossier'}
              </button>
            )}
            <button className="btn ghost" disabled={autoBusy} onClick={async () => {
              setAutoBusy(true);
              try {
                setAuto(await chooseFile(database.name));
                setMsg('Sauvegarde automatique activée sur ce fichier.');
              } catch (e) {
                setMsg((e as Error).message);
              } finally { setAutoBusy(false); }
            }}>
              📄 {auto.kind === 'fichier' ? 'Changer de fichier' : 'Choisir un fichier'}
            </button>
            {auto.configured && (
              <>
                <button className="btn ghost" disabled={autoBusy} onClick={async () => {
                  setAutoBusy(true);
                  setAuto(await runAutoBackup());
                  setMsg('Sauvegarde écrite.');
                  setAutoBusy(false);
                }}>Sauvegarder maintenant</button>
                <button className="btn ghost" disabled={autoBusy} onClick={async () => {
                  await forgetFile();
                  setAuto(await autoBackupStatus());
                  setMsg('Sauvegarde automatique désactivée.');
                }}>Désactiver</button>
              </>
            )}
          </div>
        </>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
