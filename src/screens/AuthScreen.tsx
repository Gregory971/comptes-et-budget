import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../store/useAuth';
import { PasswordInput, StrengthMeter } from '../components/PasswordInput';
import { RecoveryCodeBox } from '../components/RecoveryCodeBox';
import {
  authService, validateEmail, validatePassword, MIN_PASSWORD_LENGTH,
} from '../services/authService';

/**
 * Écran d'accès — création au premier lancement, connexion ensuite.
 *
 * Le parcours suit celui d'une application Softr : une adresse, un bouton
 * « Continuer », puis le secret. Trois traits en sont repris à dessein.
 *  · Deux étapes. L'écran ne dit pas, à l'étape de l'adresse, si elle est connue :
 *    il passe au mot de passe quelle que soit la saisie, et c'est la fin du
 *    parcours qui échoue, sans préciser sur quoi.
 *  · Message d'erreur unique. « Adresse ou mot de passe incorrect » : jamais
 *    « adresse inconnue » ni « mot de passe erroné ».
 *  · Inscription fermée. La création n'est proposée que s'il n'existe aucun accès ;
 *    ensuite, aucun lien, aucune route n'y ramène. Le seul chemin vers un
 *    nouvel accès passe par le mot de passe ou le code de récupération — ou par
 *    l'effacement des données, qui est dit pour ce qu'il est.
 */

type View = 'email' | 'password' | 'forgot' | 'setup-email' | 'setup-password' | 'code';

const TITLES: Record<View, { title: string; lead: string }> = {
  email: { title: 'Bon retour', lead: 'Connectez-vous pour continuer.' },
  password: { title: 'Votre mot de passe', lead: '' },
  forgot: {
    title: 'Mot de passe oublié',
    lead: 'Saisissez votre code de récupération, puis choisissez un nouveau mot de passe.',
  },
  'setup-email': {
    title: 'Sécurisez votre accès',
    lead: 'Créez l’identifiant qui protégera cette application sur cet appareil. '
      + 'Aucun courriel n’est envoyé : l’adresse ne sert que d’identifiant.',
  },
  'setup-password': {
    title: 'Choisissez un mot de passe',
    lead: `${MIN_PASSWORD_LENGTH} caractères au moins. Une phrase longue vaut mieux qu’un mot compliqué.`,
  },
  code: {
    title: 'Conservez ce code',
    lead: 'C’est le seul moyen de retrouver l’accès si vous oubliez votre mot de passe.',
  },
};

/** Secondes restantes avant la fin d'un blocage, rafraîchies chaque demi-seconde. */
function useRemaining(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function Shell({ view, email, children, onChangeEmail }: {
  view: View; email: string; children: ReactNode; onChangeEmail: () => void;
}) {
  const { title, lead } = TITLES[view];
  return (
    <main className="auth">
      <section className="auth-main">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">CB</span>
          <span className="auth-brand-name">Comptes &amp; Budget</span>
        </div>

        <div className="auth-card">
          <h1>{title}</h1>
          {view === 'password' ? (
            <p className="lead">
              Connexion en tant que <strong>{email}</strong>.{' '}
              <button type="button" className="auth-link" onClick={onChangeEmail}>Changer d’adresse</button>
            </p>
          ) : lead && <p className="lead">{lead}</p>}
          {children}
        </div>

        <p className="auth-foot">
          Ce verrou protège l’accès à l’application sur cet appareil. Il ne chiffre pas
          la base : pour la confidentialité d’une copie, utilisez la sauvegarde chiffrée.
        </p>
      </section>

      <aside className="auth-art" aria-label="À propos de la confidentialité">
        <div className="auth-art-inner">
          <h2>Vos comptes restent chez vous.</h2>
          <ul>
            <li>Les données sont enregistrées uniquement sur cet appareil.</li>
            <li>Aucune requête réseau, aucun traceur, aucun compte en ligne.</li>
            <li>Verrouillage automatique après une période d’inactivité.</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}

export function AuthScreen() {
  const status = useAuth(s => s.status);
  const knownEmail = useAuth(s => s.email);

  // Après un verrouillage en cours de session, l'adresse est déjà connue de la
  // page : on ne redemande que le mot de passe. Au lancement à froid, elle ne
  // l'est pas, et l'écran ne la montre donc pas.
  const [view, setView] = useState<View>(
    status === 'setup' ? 'setup-email' : knownEmail ? 'password' : 'email');
  const [email, setEmail] = useState(knownEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [shownCode, setShownCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [wipe, setWipe] = useState('');
  const remaining = useRemaining(retryAt);

  const go = (v: View) => { setError(null); setView(v); };

  function noteLockout(retryAfterMs: number) {
    if (retryAfterMs > 0) setRetryAt(Date.now() + retryAfterMs);
  }

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    if (!validateEmail(email)) { setError('Saisissez une adresse électronique valide.'); return; }
    go(status === 'setup' ? 'setup-password' : 'password');
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (busy || remaining > 0) return;
    setBusy(true); setError(null);
    try {
      const r = await authService.verify(email, password);
      if (r.ok) { await useAuth.getState().unlock(); return; }
      noteLockout(r.retryAfterMs);
      setPassword('');
      // Même message quelle que soit la cause : voir l'en-tête du fichier.
      setError('Adresse ou mot de passe incorrect.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(e: FormEvent) {
    e.preventDefault();
    const probleme = validatePassword(password, email);
    if (probleme) { setError(probleme); return; }
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setBusy(true); setError(null);
    try {
      const { recoveryCode } = await authService.create(email, password);
      setShownCode(recoveryCode);
      setPassword(''); setConfirm('');
      setView('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    if (busy || remaining > 0) return;
    const probleme = validatePassword(password, knownEmail);
    if (probleme) { setError(probleme); return; }
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await authService.recover(recoveryInput, password);
      if (r.ok) {
        setShownCode(r.recoveryCode);
        setPassword(''); setConfirm(''); setRecoveryInput('');
        setView('code');
        return;
      }
      noteLockout(r.retryAfterMs);
      setError('Code de récupération incorrect.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function wipeAll() {
    await authService.wipeEverything();
    window.location.reload();
  }

  const lockout = remaining > 0 && (
    <p className="auth-warn" role="status">
      Trop d’essais. Nouvel essai possible dans <strong>{remaining} s</strong>.
    </p>
  );
  const errorLine = error && <p className="auth-error" role="alert">{error}</p>;

  return (
    <Shell view={view} email={email} onChangeEmail={() => { setPassword(''); go('email'); }}>
      {(view === 'email' || view === 'setup-email') && (
        <form onSubmit={submitEmail} noValidate>
          <div className="field">
            <label htmlFor="au-email">Adresse électronique</label>
            <input id="au-email" type="email" value={email} autoFocus
              onChange={e => setEmail(e.target.value)}
              autoComplete="username" inputMode="email" spellCheck={false}
              autoCapitalize="none" aria-describedby={error ? 'au-err' : undefined} />
          </div>
          <div id="au-err">{errorLine}</div>
          <button className="btn auth-submit" type="submit">Continuer</button>
        </form>
      )}

      {view === 'password' && (
        <form onSubmit={submitLogin} noValidate>
          {/* Champ d'identifiant pour les gestionnaires de mots de passe : sans lui,
              ils ne savent pas à quel compte rattacher le secret qu'ils remplissent. */}
          <input type="email" value={email} readOnly tabIndex={-1} className="sr-only"
            autoComplete="username" aria-hidden="true" />
          <PasswordInput id="au-pw" label="Mot de passe" value={password} onChange={setPassword}
            autoComplete="current-password" autoFocus describedBy="au-err" />
          <div id="au-err" aria-live="polite">{errorLine}{lockout}</div>
          <button className="btn auth-submit" type="submit" disabled={busy || remaining > 0}>
            {busy ? 'Vérification…' : 'Se connecter'}
          </button>
          <p className="auth-aside">
            <button type="button" className="auth-link"
              onClick={() => { setPassword(''); setConfirm(''); go('forgot'); }}>
              Mot de passe oublié ?
            </button>
          </p>
        </form>
      )}

      {view === 'setup-password' && (
        <form onSubmit={submitSetup} noValidate>
          <input type="email" value={email} readOnly tabIndex={-1} className="sr-only"
            autoComplete="username" aria-hidden="true" />
          <PasswordInput id="au-new" label="Mot de passe" value={password} onChange={setPassword}
            autoComplete="new-password" autoFocus describedBy="au-meter au-err" />
          <StrengthMeter id="au-meter" password={password} />
          <PasswordInput id="au-confirm" label="Confirmer le mot de passe" value={confirm}
            onChange={setConfirm} autoComplete="new-password" describedBy="au-err" />
          <div id="au-err">{errorLine}</div>
          <button className="btn auth-submit" type="submit" disabled={busy}>
            {busy ? 'Création…' : 'Créer l’accès'}
          </button>
          <p className="auth-aside">
            <button type="button" className="auth-link" onClick={() => go('setup-email')}>
              ← Modifier l’adresse
            </button>
          </p>
        </form>
      )}

      {view === 'forgot' && (
        <>
          <form onSubmit={submitForgot} noValidate>
            <div className="field">
              <label htmlFor="au-rec">Code de récupération</label>
              <input id="au-rec" value={recoveryInput} autoFocus
                onChange={e => setRecoveryInput(e.target.value)}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false}
                autoCapitalize="characters" className="auth-mono" aria-describedby="au-err" />
            </div>
            <PasswordInput id="au-new" label="Nouveau mot de passe" value={password}
              onChange={setPassword} autoComplete="new-password" describedBy="au-meter au-err" />
            <StrengthMeter id="au-meter" password={password} />
            <PasswordInput id="au-confirm" label="Confirmer le nouveau mot de passe" value={confirm}
              onChange={setConfirm} autoComplete="new-password" describedBy="au-err" />
            <div id="au-err" aria-live="polite">{errorLine}{lockout}</div>
            <button className="btn auth-submit" type="submit" disabled={busy || remaining > 0}>
              {busy ? 'Vérification…' : 'Changer le mot de passe'}
            </button>
            <p className="auth-aside">
              <button type="button" className="auth-link" onClick={() => go(knownEmail ? 'password' : 'email')}>
                ← Retour à la connexion
              </button>
            </p>
          </form>

          <details className="auth-danger">
            <summary>Je n’ai plus mon code de récupération</summary>
            <p>
              Sans le mot de passe ni le code, <strong>aucun moyen n’existe</strong> de rouvrir
              l’application : aucun serveur ne peut le faire à votre place. Il reste à tout
              effacer. Cela supprime <strong>définitivement</strong> les comptes et opérations
              enregistrés sur cet appareil. Si vous avez exporté une sauvegarde (.cbjson),
              vous pourrez la restaurer ensuite.
            </p>
            <label htmlFor="au-wipe">Tapez EFFACER pour confirmer</label>
            <input id="au-wipe" value={wipe} onChange={e => setWipe(e.target.value)}
              autoComplete="off" spellCheck={false} />
            <button type="button" className="btn danger" style={{ marginTop: 10 }}
              disabled={wipe !== 'EFFACER'} onClick={wipeAll}>
              Effacer toutes les données de cet appareil
            </button>
          </details>
        </>
      )}

      {view === 'code' && (
        <RecoveryCodeBox code={shownCode}
          confirmLabel="Entrer dans l’application"
          onConfirm={() => { void useAuth.getState().unlock(); }} />
      )}
    </Shell>
  );
}
