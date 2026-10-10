import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/useAuth';
import { PasswordInput, StrengthMeter } from '../components/PasswordInput';
import { RecoveryCodeBox } from '../components/RecoveryCodeBox';
import {
  authService, cryptoAvailable, validateEmail, validatePassword, IDLE_CHOICES, type Attempt,
} from '../services/authService';

/**
 * Préférences › Sécurité — gestion de l'accès.
 *
 * Toute action qui engage l'accès (changer le mot de passe ou l'adresse,
 * régénérer le code, désactiver la protection) redemande le mot de passe, même
 * session ouverte. Une session laissée ouverte ne doit pas suffire à en prendre
 * possession : sans cela, quelqu'un passant devant l'écran pourrait changer le
 * mot de passe et enfermer dehors son propriétaire.
 */

/** Traduit un échec de vérification en phrase, ralentissement compris. */
function failure(r: Extract<Attempt, { ok: false }>, what = 'Mot de passe incorrect.'): string {
  const s = Math.ceil(r.retryAfterMs / 1000);
  return s > 0 ? `${what} Trop d’essais : réessayez dans ${s} s.` : what;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

function Notice({ notice }: { notice: Feedback }) {
  if (!notice) return null;
  return (
    <p role={notice.kind === 'err' ? 'alert' : 'status'}
      className={notice.kind === 'err' ? 'auth-error' : 'auth-ok'}>{notice.text}</p>
  );
}

function ChangePassword() {
  const email = useAuth(s => s.email);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const probleme = validatePassword(next, email);
    if (probleme) { setNotice({ kind: 'err', text: probleme }); return; }
    if (next !== confirm) { setNotice({ kind: 'err', text: 'Les deux mots de passe ne correspondent pas.' }); return; }
    setBusy(true);
    try {
      const r = await authService.changePassword(current, next);
      if (r.ok) {
        setCurrent(''); setNext(''); setConfirm('');
        setNotice({ kind: 'ok', text: 'Mot de passe modifié.' });
      } else {
        setNotice({ kind: 'err', text: failure(r, 'Mot de passe actuel incorrect.') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
      <strong>Changer le mot de passe</strong>
      <input type="email" value={email} readOnly tabIndex={-1} className="sr-only"
        autoComplete="username" aria-hidden="true" />
      <PasswordInput id="sc-cur" label="Mot de passe actuel" value={current}
        onChange={setCurrent} autoComplete="current-password" />
      <PasswordInput id="sc-new" label="Nouveau mot de passe" value={next}
        onChange={setNext} autoComplete="new-password" describedBy="sc-meter" />
      <StrengthMeter id="sc-meter" password={next} />
      <PasswordInput id="sc-conf" label="Confirmer le nouveau mot de passe" value={confirm}
        onChange={setConfirm} autoComplete="new-password" />
      <Notice notice={notice} />
      <button className="btn" type="submit" disabled={busy || !current || !next}>Enregistrer</button>
    </form>
  );
}

function ChangeEmail() {
  const email = useAuth(s => s.email);
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [notice, setNotice] = useState<Feedback>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validateEmail(next)) { setNotice({ kind: 'err', text: 'Saisissez une adresse électronique valide.' }); return; }
    try {
      const r = await authService.changeEmail(password, next);
      if (r.ok) {
        await useAuth.getState().refresh();
        setPassword(''); setNext('');
        setNotice({ kind: 'ok', text: 'Adresse modifiée.' });
      } else {
        setNotice({ kind: 'err', text: failure(r) });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
      <strong>Adresse de connexion</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
        Actuelle : <strong>{email}</strong>. Elle ne sert que d’identifiant : aucun courriel n’est envoyé.
      </p>
      <div className="field"><label htmlFor="sc-mail">Nouvelle adresse</label>
        <input id="sc-mail" type="email" value={next} onChange={e => setNext(e.target.value)}
          autoComplete="off" spellCheck={false} autoCapitalize="none" /></div>
      <PasswordInput id="sc-mail-pw" label="Mot de passe" value={password}
        onChange={setPassword} autoComplete="current-password" />
      <Notice notice={notice} />
      <button className="btn" type="submit" disabled={!next || !password}>Enregistrer</button>
    </form>
  );
}

function Recovery() {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Feedback>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await authService.regenerateRecovery(password);
      if (r.ok) { setCode(r.recoveryCode); setPassword(''); setNotice(null); }
      else setNotice({ kind: 'err', text: failure(r) });
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message });
    }
  }

  if (code) {
    return (
      <div style={{ maxWidth: 420 }}>
        <strong>Nouveau code de récupération</strong>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
          L’ancien code ne fonctionne plus.
        </p>
        <RecoveryCodeBox code={code} confirmLabel="Terminé" onConfirm={() => setCode('')} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
      <strong>Code de récupération</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
        Il ne peut pas être réaffiché : seule son empreinte est conservée. Si vous l’avez
        perdu, ou s’il a pu être vu par un tiers, générez-en un nouveau — l’ancien cesse
        aussitôt de fonctionner.
      </p>
      <PasswordInput id="sc-rec-pw" label="Mot de passe" value={password}
        onChange={setPassword} autoComplete="current-password" />
      <Notice notice={notice} />
      <button className="btn" type="submit" disabled={!password}>Générer un nouveau code</button>
    </form>
  );
}

function Disable() {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<Feedback>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await authService.disable(password);
      if (r.ok) await useAuth.getState().refresh();
      else setNotice({ kind: 'err', text: failure(r) });
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
      <strong>Désactiver la protection</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
        L’application s’ouvrira de nouveau sans identifiants. Les données ne sont pas modifiées.
      </p>
      <PasswordInput id="sc-off-pw" label="Mot de passe" value={password}
        onChange={setPassword} autoComplete="current-password" />
      <Notice notice={notice} />
      <button className="btn danger" type="submit" disabled={!password}>Désactiver la protection</button>
    </form>
  );
}

export function SecurityTab() {
  const guarded = useAuth(s => s.guarded);
  const email = useAuth(s => s.email);
  const idle = useAuth(s => s.idleMinutes);
  const [notice, setNotice] = useState<Feedback>(null);

  async function setIdle(minutes: number) {
    try {
      await authService.setIdleMinutes(minutes);
      await useAuth.getState().refresh();
      setNotice({ kind: 'ok', text: 'Délai enregistré.' });
    } catch (err) {
      setNotice({ kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <div className="card">
      {guarded ? (
        <>
          <div className="row" style={{ marginBottom: 6 }}>
            <div>
              <strong>🔒 Protection activée</strong>
              <div className="muted" style={{ fontSize: 13 }}>Identifiant : {email}</div>
            </div>
            <button className="btn ghost" type="button" onClick={() => useAuth.getState().lock()}>
              Verrouiller maintenant
            </button>
          </div>

          <div className="field" style={{ maxWidth: 320, marginTop: 14 }}>
            <label htmlFor="sc-idle">Verrouillage après inactivité</label>
            <select id="sc-idle" value={idle} onChange={e => void setIdle(Number(e.target.value))}>
              {IDLE_CHOICES.map(m => (
                <option key={m} value={m}>{m < 60 ? `${m} minutes` : '1 heure'}</option>
              ))}
            </select>
          </div>
          <Notice notice={notice} />

          <hr className="sep" />
          <ChangePassword />
          <hr className="sep" />
          <ChangeEmail />
          <hr className="sep" />
          <Recovery />
          <hr className="sep" />
          <Disable />
        </>
      ) : (
        !cryptoAvailable() ? (
          <>
            <strong>🔓 Protection indisponible dans ce navigateur</strong>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Le verrou repose sur WebCrypto, que le navigateur ne fournit que sur une page
              servie en https (ou en localhost). Ouverte autrement — fichier local dans
              certains navigateurs, par exemple — l’application ne peut pas calculer
              l’empreinte d’un mot de passe, et reste donc sans verrou. Utilisez l’adresse
              publiée de l’application pour activer la protection.
            </p>
          </>
        ) : (
        <>
          <strong>🔓 Protection désactivée</strong>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Toute personne qui ouvre l’application sur cet appareil accède à vos comptes.
            Activez la protection pour exiger une adresse et un mot de passe à chaque ouverture.
          </p>
          <button className="btn" type="button" onClick={() => useAuth.getState().beginSetup()}>
            Activer la protection
          </button>
        </>
        )
      )}

      <hr className="sep" />
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Ce que protège ce verrou — et ce qu’il ne protège pas</summary>
        <div className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>
          <p><strong>Il protège</strong> l’accès à l’interface : un ordinateur partagé, un
            téléphone prêté, une session laissée ouverte. Les identifiants ne sont jamais
            enregistrés — seulement leur empreinte (PBKDF2-SHA256, 600 000 itérations) — et
            les essais répétés sont ralentis.</p>
          <p><strong>Il ne chiffre pas la base.</strong> Quelqu’un qui disposerait du profil
            de votre navigateur et d’outils de développement pourrait lire les données sans
            passer par cet écran. Contre cela, le chiffrement du disque de l’appareil est la
            bonne protection.</p>
          <p><strong>Il est propre à cet appareil.</strong> Il n’entre pas dans la
            sauvegarde : restaurer un fichier sur un autre appareil n’y apporte pas cet accès.
            Aucun serveur n’existe pour « renvoyer un lien » — d’où le code de récupération.</p>
        </div>
      </details>
    </div>
  );
}
