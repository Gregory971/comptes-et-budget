import { useState, type ReactNode } from 'react';
import { useStore, type Screen } from '../store/useStore';
import { useActiveDatabase, useBases } from '../hooks/useData';
import { ImportButton } from './ImportButton';
import { backupService } from '../services/backupService';
import { Modal } from './Modal';
import type { Profile } from '../types';

export { formatEur as eur, formatNum as eurn } from '../utils/money';

const NAV: { key: Screen; label: string; ic: string }[] = [
  { key: 'accueil', label: 'Accueil', ic: '🏠' },
  { key: 'comptes', label: 'Comptes', ic: '🏛️' },
  { key: 'operations', label: 'Opérations', ic: '🛒' },
  { key: 'echeances', label: 'Échéances', ic: '⏰' },
  { key: 'budget', label: 'Budget', ic: '📊' },
  { key: 'biens', label: 'Biens / Projets', ic: '✈️' },
  { key: 'bilans', label: 'Bilan', ic: '📈' },
  { key: 'preferences', label: 'Préférences', ic: '⚙️' },
];

function AtproLogo() {
  const TQ = '#00a8a9', DK = '#1f2530', GR = '#6b7785';
  return (
    <div className="atpro-badge">
      <svg viewBox="0 0 340 92" xmlns="http://www.w3.org/2000/svg" role="img"
        aria-label="Transitions Pro Guadeloupe" className="atpro-logo">
        <text x="6" y="16" fontSize="13" fontWeight="700" fill={TQ} letterSpacing="3"
          fontFamily="'Open Sans',Arial,sans-serif">PARTENAIRE D'AVENIR</text>
        <text x="4" y="58" fontSize="40" fontWeight="800" fill={DK} letterSpacing="1"
          fontFamily="'Open Sans',Arial,sans-serif">
          <tspan>TRANS</tspan><tspan fill={TQ}>I</tspan><tspan fill={DK}>TIONS</tspan>
        </text>
        <rect x="150" y="22" width="34" height="7" rx="3" fill={TQ} />
        <rect x="150" y="61" width="34" height="7" rx="3" fill={TQ} />
        <text x="150" y="88" fontSize="22" fontWeight="800" fill={TQ}
          fontFamily="'Open Sans',Arial,sans-serif">PRO</text>
        <text x="212" y="88" fontSize="22" fontWeight="700" fill={GR}
          fontFamily="'Open Sans',Arial,sans-serif">Guadeloupe</text>
      </svg>
    </div>
  );
}

export function Layout({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const { screen, setScreen } = useStore();
  const { database } = useActiveDatabase();
  const [showSwitcher, setShowSwitcher] = useState(false);
  const isPro = database?.profile === 'pro';

  return (
    <div className="shell" data-theme={isPro ? 'pro' : 'perso'}>
      <div className="topbar">
        <button className="multi" onClick={() => setShowSwitcher(true)}>Gérer plusieurs comptes</button>
        <nav className="topnav" aria-label="Navigation principale">
          {isPro ? <AtproLogo /> : (
            <div className="brandmini">{database?.name ?? 'Comptes'}<small>Gestion personnelle</small></div>
          )}
          {NAV.map(n => (
            <button key={n.key} className={screen === n.key ? 'active' : ''}
              aria-current={screen === n.key ? 'page' : undefined}
              onClick={() => setScreen(n.key)}>
              <span className="ic" aria-hidden="true">{n.ic}</span>{n.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="body">
        <aside className="actions" aria-label="Actions">
          <div className="cur-badge">EUR</div>
          {actions ?? <DefaultActions />}
        </aside>
        <section className="content">{children}</section>
      </div>
      {showSwitcher && <BaseSwitcher onClose={() => setShowSwitcher(false)} />}
    </div>
  );
}

function BaseSwitcher({ onClose }: { onClose: () => void }) {
  const bases = useBases() ?? [];
  const { database } = useActiveDatabase();
  const { switchBase, createBase } = useStore();
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>('pro');
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Gérer plusieurs comptes" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Basculez entre vos profils ou créez-en un nouveau.</p>

      <div className="base-list">
        {bases.map(b => {
          const pro = (b.profile ?? 'perso') === 'pro';
          const current = b.id === database?.id;
          return (
            <button key={b.id} className={'base-item' + (current ? ' active' : '')}
              aria-current={current ? 'true' : undefined}
              onClick={() => { switchBase(b.id); onClose(); }}>
              <span className={'prof-dot ' + (pro ? 'pro' : 'perso')} aria-hidden="true" />
              <span style={{ flex: 1, textAlign: 'left' }}>{b.name}</span>
              <span className={'chip ' + (pro ? 'rec' : '')}>{pro ? 'PRO · ATPro' : 'PERSO'}</span>
            </button>
          );
        })}
      </div>

      <div className="act-sep" />
      <strong>Nouveau profil</strong>
      <div className="inline" style={{ marginTop: 10 }}>
        <div className="field grow"><label htmlFor="nb-name">Nom</label>
          <input id="nb-name" value={name} onChange={e => setName(e.target.value)}
            placeholder={profile === 'pro' ? 'Compte Pro' : 'Compte Perso'} /></div>
        <div className="field" style={{ width: 150 }}><label htmlFor="nb-type">Type</label>
          <select id="nb-type" value={profile} onChange={e => setProfile(e.target.value as Profile)}>
            <option value="perso">Perso</option><option value="pro">Pro (ATPro)</option></select></div>
        <button className="btn" disabled={busy}
          onClick={async () => { setBusy(true); await createBase(name, profile); onClose(); }}>Créer</button>
      </div>
    </Modal>
  );
}

function DefaultActions() {
  const setScreen = useStore(s => s.setScreen);
  return (
    <>
      <button className="act" onClick={() => setScreen('comptabiliser')}>
        <span className="ic" aria-hidden="true">➕</span>Ajouter</button>
      <button className="act" onClick={() => setScreen('operations')}>
        <span className="ic" aria-hidden="true">📋</span>Voir les opérations</button>
      <div className="act-sep" />
      <button className="act" onClick={() => backupService.download()}>
        <span className="ic" aria-hidden="true">⬆️</span>Exporter</button>
      <ImportButton />
    </>
  );
}
