import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoneyInput } from '../components/MoneyInput';
import { Modal, ConfirmDialog } from '../components/Modal';
import { assetService, projectService } from '../services/patrimoineService';
import { operationService } from '../services/operationService';
import { formatEur, type Cents } from '../utils/money';
import { formatFr, type Ymd } from '../utils/date';
import { hueOf } from '../utils/hue';
import type { Asset, AssetType, Database, Project } from '../types';

const EMPTY_LINKS: Record<string, Cents> = {};

const ASSET_ICON: Record<AssetType, string> = {
  immobilier: '🏠', vehicule: '🚗', placement: '📈', autre: '📦',
};
const ASSET_LABEL: Record<AssetType, string> = {
  immobilier: 'Immobilier', vehicule: 'Véhicule', placement: 'Placement', autre: 'Autre',
};

export function BiensScreen({ database }: { database: Database }) {
  const dbId = database.id;
  const assets = useLiveQuery(() => assetService.list(dbId), [dbId], []) ?? [];
  const projects = useLiveQuery(() => projectService.list(dbId), [dbId], []) ?? [];

  // Dépenses et recettes rattachées à chaque bien / projet (nouveau champ de saisie).
  const linked = useLiveQuery(async () => {
    const out: Record<string, Cents> = {};
    for (const a of assets) out[`a:${a.id}`] = await operationService.totalForRef(dbId, 'assetId', a.id);
    for (const p of projects) out[`p:${p.id}`] = await operationService.totalForRef(dbId, 'projectId', p.id);
    return out;
  }, [dbId, assets, projects], EMPTY_LINKS) ?? EMPTY_LINKS;

  const [aName, setAName] = useState('');
  const [aType, setAType] = useState<AssetType>('immobilier');
  const [aValue, setAValue] = useState<Cents | null>(null);
  const [aError, setAError] = useState<string | null>(null);

  const [pName, setPName] = useState('');
  const [pTarget, setPTarget] = useState<Cents | null>(null);
  const [pSaved, setPSaved] = useState<Cents | null>(0);
  const [pDeadline, setPDeadline] = useState<Ymd>('');
  const [pError, setPError] = useState<string | null>(null);

  const [savingOn, setSavingOn] = useState<Project | null>(null);
  const [removeAsset, setRemoveAsset] = useState<Asset | null>(null);
  const [removeProject, setRemoveProject] = useState<Project | null>(null);

  const patrimoine = assets.reduce((s, a) => s + a.valueCents, 0);

  // Répartition par type de bien, reprise de la barre segmentée de la maquette.
  // Les types étant libres, on agrège ce qui existe plutôt qu'une liste figée.
  const repartition = (() => {
    const parType = new Map<AssetType, number>();
    for (const a of assets) parType.set(a.type, (parType.get(a.type) ?? 0) + a.valueCents);
    return [...parType.entries()]
      .map(([type, valueCents]) => ({
        // Libellé lisible, comme dans le tableau : « Véhicule », non « vehicule ».
        label: ASSET_LABEL[type], icon: ASSET_ICON[type], valueCents,
        pct: patrimoine ? (valueCents / patrimoine) * 100 : 0,
      }))
      .sort((x, y) => y.valueCents - x.valueCents);
  })();

  async function addAsset() {
    if (!aName.trim()) { setAError('Le nom du bien est obligatoire.'); return; }
    if (aValue === null) { setAError('Indiquez une valeur (exemple : 15 000).'); return; }
    setAError(null);
    await assetService.create(dbId, { name: aName.trim(), type: aType, valueCents: aValue });
    setAName(''); setAValue(null);
  }

  async function addProject() {
    if (!pName.trim()) { setPError('Le nom du projet est obligatoire.'); return; }
    if (pTarget === null || pTarget <= 0) { setPError('Indiquez un objectif supérieur à zéro.'); return; }
    setPError(null);
    await projectService.create(dbId, {
      name: pName.trim(), targetAmountCents: pTarget, savedAmountCents: pSaved ?? 0,
      deadline: pDeadline || undefined,
    });
    setPName(''); setPTarget(null); setPSaved(0); setPDeadline('');
  }

  return (
    <>
      <h1 className="page-title">Biens / Projets</h1>
      <p className="page-sub">Suivez votre patrimoine et vos projets d’épargne.</p>

      <div className="card">
        <div className="kpi-lbl">Patrimoine total estimé</div>
        <div className="patri-val">{formatEur(patrimoine)}</div>
        {repartition.length > 0 && (
          <div className="patri-bar" role="img"
            aria-label={`Répartition : ${repartition.map(s => `${s.label} ${s.pct.toFixed(0)} %`).join(', ')}`}>
            {repartition.map(s => (
              <div key={s.label} style={{
                width: s.pct + '%', background: `oklch(0.62 0.14 ${hueOf(s.label)})`,
              }} />
            ))}
          </div>
        )}
      </div>

      {repartition.length > 0 && (
        <div className="acc-grid">
          {repartition.map(s => (
            <div className="acc" key={s.label}>
              <div className="patri-head">
                <span className="patri-dot" aria-hidden="true"
                  style={{ background: `oklch(0.62 0.14 ${hueOf(s.label)})` }} />
                <span className="acc-type"><span aria-hidden="true">{s.icon}</span> {s.label}</span>
              </div>
              <div className="acc-val">{formatEur(s.valueCents)}</div>
              <div className="tx-meta">{s.pct.toFixed(1)} % du total</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <strong>Mes biens</strong>
        <div className="inline" style={{ marginTop: 12 }}>
          <div className="field grow"><label htmlFor="as-name">Nom</label>
            <input id="as-name" value={aName} onChange={e => setAName(e.target.value)}
              placeholder="Ex : Appartement, Voiture…" /></div>
          <div className="field" style={{ width: 150 }}><label htmlFor="as-type">Type</label>
            <select id="as-type" value={aType} onChange={e => setAType(e.target.value as AssetType)}>
              {(Object.keys(ASSET_LABEL) as AssetType[]).map(k =>
                <option key={k} value={k}>{ASSET_LABEL[k]}</option>)}</select></div>
          <div style={{ width: 170 }}>
            <MoneyInput label="Valeur (€)" valueCents={aValue} onChange={setAValue} /></div>
          <button className="btn" onClick={addAsset}>Ajouter</button>
        </div>
        {aError && <p role="alert" style={{ color: 'var(--red)', margin: 0 }}>{aError}</p>}
        <table className="simple">
          <thead><tr>
            <th scope="col">Bien</th><th scope="col">Type</th>
            <th scope="col" style={{ textAlign: 'right' }}>Valeur</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {assets.map(a => (
              <tr key={a.id}>
                <td><span aria-hidden="true">{ASSET_ICON[a.type]}</span> {a.name}</td>
                <td><span className="chip">{ASSET_LABEL[a.type]}</span></td>
                <td style={{ textAlign: 'right' }}>{formatEur(a.valueCents)}
                  {linked[`a:${a.id}`] ? (
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                      {formatEur(Math.abs(linked[`a:${a.id}`]))} d’opérations rattachées
                    </span>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="iconbtn" aria-label={`Supprimer le bien ${a.name}`}
                    onClick={() => setRemoveAsset(a)}>🗑</button></td>
              </tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={4} className="muted">Aucun bien enregistré.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong>Projets d’épargne</strong>
        <div className="inline" style={{ marginTop: 12 }}>
          <div className="field grow"><label htmlFor="pr-name">Projet</label>
            <input id="pr-name" value={pName} onChange={e => setPName(e.target.value)}
              placeholder="Ex : Vacances, Apport…" /></div>
          <div style={{ width: 150 }}>
            <MoneyInput label="Objectif (€)" valueCents={pTarget} onChange={setPTarget} /></div>
          <div style={{ width: 160 }}>
            <MoneyInput label="Déjà épargné (€)" valueCents={pSaved} onChange={setPSaved} /></div>
          <div className="field" style={{ width: 160 }}><label htmlFor="pr-dl">Échéance</label>
            <input id="pr-dl" type="date" value={pDeadline} onChange={e => setPDeadline(e.target.value)} /></div>
          <button className="btn" onClick={addProject}>Créer</button>
        </div>
        {pError && <p role="alert" style={{ color: 'var(--red)', margin: 0 }}>{pError}</p>}

        {projects.length === 0 ? <p className="muted">Aucun projet.</p> : projects.map(p => {
          const pct = p.targetAmountCents > 0
            ? Math.min(100, p.savedAmountCents / p.targetAmountCents * 100) : 0;
          return (
            <div key={p.id} style={{ marginBottom: 16 }}>
              <div className="row">
                <span><strong>{p.name}</strong>
                  {p.deadline && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    échéance {formatFr(p.deadline)}</span>}</span>
                <span className="muted">{linked[`p:${p.id}`] ? (
                  <span style={{ marginRight: 10 }}>
                    {formatEur(Math.abs(linked[`p:${p.id}`]))} d’opérations rattachées ·
                  </span>
                ) : null}{formatEur(p.savedAmountCents)} / {formatEur(p.targetAmountCents)}
                  <b style={{ color: 'var(--accent)', marginLeft: 6 }}>{pct.toFixed(0)} %</b></span>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)}
                aria-valuemin={0} aria-valuemax={100} aria-label={`Avancement du projet ${p.name}`}>
                <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} />
              </div>
              <div className="inline" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn ghost" style={{ padding: '4px 10px' }}
                  onClick={() => setSavingOn(p)}>Ajouter un versement</button>
                <button className="iconbtn" aria-label={`Supprimer le projet ${p.name}`}
                  onClick={() => setRemoveProject(p)}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>

      {savingOn && <SavingModal project={savingOn} onClose={() => setSavingOn(null)} />}

      {removeAsset && (
        <ConfirmDialog title="Supprimer le bien" danger confirmLabel="Supprimer"
          message={`Supprimer « ${removeAsset.name} » du patrimoine ?`}
          onConfirm={() => assetService.remove(removeAsset.id)}
          onClose={() => setRemoveAsset(null)} />
      )}
      {removeProject && (
        <ConfirmDialog title="Supprimer le projet" danger confirmLabel="Supprimer"
          message={`Supprimer le projet « ${removeProject.name} » ?`}
          onConfirm={() => projectService.remove(removeProject.id)}
          onClose={() => setRemoveProject(null)} />
      )}
    </>
  );
}

/** Versement libre — remplace les boutons figés « + 50 € » / « + 100 € ». */
function SavingModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [amount, setAmount] = useState<Cents | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(sign: 1 | -1) {
    if (amount === null || amount <= 0) { setError('Indiquez un montant supérieur à zéro.'); return; }
    await projectService.addSaving(project.id, sign * amount);
    onClose();
  }

  return (
    <Modal title={`Versement — ${project.name}`} onClose={onClose} width={440}>
      <p className="muted" style={{ marginTop: 0 }}>
        Déjà épargné : {formatEur(project.savedAmountCents)} sur {formatEur(project.targetAmountCents)}.
      </p>
      <MoneyInput label="Montant du versement (€)" valueCents={amount} onChange={setAmount} autoFocus />
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row">
        <button className="btn ghost" onClick={() => save(-1)}>Retirer</button>
        <button className="btn" onClick={() => save(1)}>Ajouter</button>
      </div>
    </Modal>
  );
}
