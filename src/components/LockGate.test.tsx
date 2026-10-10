// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Le coût de dérivation réel (600 000 itérations) rend chaque connexion de test
// lente. Le service lit cette constante : on la réduit pour l'interface, tandis
// que auth.test.ts éprouve le service lui-même.
vi.mock('../services/cryptoService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/cryptoService')>()),
  KDF_ITERATIONS: 1000,
}));

import { LockGate } from './LockGate';
import { useAuth } from '../store/useAuth';
import { authService } from '../services/authService';
import { db } from '../services/db';

const EMAIL = 'gregory@example.com';
const MDP = 'un mot de passe solide';
const CONTENU = 'CONTENU DE L’APPLICATION';

const reset = () => useAuth.setState({
  status: 'checking', guarded: false, email: '', idleMinutes: 15,
});

function monter() {
  return render(<LockGate><p>{CONTENU}</p></LockGate>);
}

/** Attend la fin de la lecture de configuration (l'écran affiche d'abord « Chargement… »). */
const attendre = () =>
  waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull());

const champ = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const saisir = (label: RegExp | string, valeur: string) =>
  fireEvent.change(champ(label), { target: { value: valeur } });

/** Parcours d'ouverture : adresse, « Continuer », mot de passe, « Se connecter ». */
async function seConnecter(email: string, motDePasse: string) {
  await screen.findByLabelText('Adresse électronique');
  saisir('Adresse électronique', email);
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await screen.findByText('Votre mot de passe');
  saisir('Mot de passe', motDePasse);
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
}

beforeEach(async () => {
  reset();
  await db.settings.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('premier lancement', () => {
  it('impose la création d’un accès avant d’afficher quoi que ce soit', async () => {
    monter();
    expect(await screen.findByRole('heading', { name: 'Sécurisez votre accès' })).toBeTruthy();
    // Rien de l'application n'est monté : aucun écran, aucune requête.
    expect(screen.queryByText(CONTENU)).toBeNull();
  });

  it('crée l’accès, impose d’accuser réception du code, puis ouvre l’application', async () => {
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));

    saisir('Mot de passe', MDP);
    saisir('Confirmer le mot de passe', MDP);
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’accès' }));

    expect(await screen.findByRole('heading', { name: 'Conservez ce code' })).toBeTruthy();
    const code = screen.getByLabelText('Code de récupération').textContent ?? '';
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);

    // Tant que le code n'est pas reconnu comme conservé, on n'entre pas.
    const entrer = screen.getByRole('button', { name: 'Entrer dans l’application' }) as HTMLButtonElement;
    expect(entrer.disabled).toBe(true);
    expect(screen.queryByText(CONTENU)).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(entrer.disabled).toBe(false);
    fireEvent.click(entrer);

    expect(await screen.findByText(CONTENU)).toBeTruthy();
    expect((await authService.state()).kind).toBe('on');
  });

  it('refuse un mot de passe trop court ou deux saisies différentes', async () => {
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));

    saisir('Mot de passe', 'court');
    saisir('Confirmer le mot de passe', 'court');
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’accès' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Au moins 10/);

    saisir('Mot de passe', MDP);
    saisir('Confirmer le mot de passe', 'une autre saisie ici');
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’accès' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/ne correspondent pas/));
    expect((await authService.state()).kind).toBe('none');
  });

  it('refuse une adresse invalide dès la première étape', async () => {
    monter();
    await attendre();
    saisir('Adresse électronique', 'pas une adresse');
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    expect(screen.getByRole('alert').textContent).toMatch(/adresse électronique valide/);
  });
});

describe('connexion', () => {
  beforeEach(async () => { await authService.create(EMAIL, MDP); });

  it('demande l’adresse puis le mot de passe, et ouvre l’application', async () => {
    monter();
    expect(await screen.findByRole('heading', { name: 'Bon retour' })).toBeTruthy();
    expect(screen.queryByText(CONTENU)).toBeNull();

    await seConnecter(EMAIL, MDP);
    expect(await screen.findByText(CONTENU)).toBeTruthy();
  });

  it('ne montre pas l’adresse enregistrée au lancement à froid', async () => {
    monter();
    await screen.findByRole('heading', { name: 'Bon retour' });
    expect(champ('Adresse électronique').value).toBe('');
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('répond par le même message à une mauvaise adresse et à un mauvais mot de passe', async () => {
    monter();
    await seConnecter('inconnue@example.com', MDP);
    const parAdresse = (await screen.findByRole('alert')).textContent;

    cleanup(); reset(); await db.settings.delete('auth.attempts');
    monter();
    await seConnecter(EMAIL, 'mauvais mot de passe');
    const parMotDePasse = (await screen.findByRole('alert')).textContent;

    expect(parAdresse).toBe('Adresse ou mot de passe incorrect.');
    expect(parMotDePasse).toBe(parAdresse);
    expect(screen.queryByText(CONTENU)).toBeNull();
  });

  it('ralentit après trois échecs et désactive le bouton pendant l’attente', async () => {
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    await screen.findByText('Votre mot de passe');

    for (let i = 0; i < 3; i++) {
      saisir('Mot de passe', `mauvais ${i} mot de passe`);
      fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
      await waitFor(() => expect(
        (screen.getByRole('button', { name: /Se connecter|Vérification/ }) as HTMLButtonElement).disabled
          === (i === 2)).toBe(true));
    }
    expect(await screen.findByText(/Trop d’essais/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Se connecter' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pose les attributs qui permettent à un gestionnaire de mots de passe de travailler', async () => {
    monter();
    expect(await screen.findByLabelText('Adresse électronique'))
      .toHaveProperty('autocomplete', 'username');
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Votre mot de passe');
    expect(champ('Mot de passe').autocomplete).toBe('current-password');
    expect(champ('Mot de passe').type).toBe('password');
  });

  it('permet d’afficher puis de masquer le mot de passe', async () => {
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    await screen.findByText('Votre mot de passe');

    fireEvent.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }));
    expect(champ('Mot de passe').type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Masquer le mot de passe' }));
    expect(champ('Mot de passe').type).toBe('password');
  });
});

describe('mot de passe oublié', () => {
  it('rouvre l’accès avec le code de récupération, puis en délivre un nouveau', async () => {
    const { recoveryCode } = await authService.create(EMAIL, MDP);
    monter();
    await attendre();

    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mot de passe oublié ?' }));

    saisir('Code de récupération', recoveryCode.toLowerCase());
    saisir('Nouveau mot de passe', 'un tout nouveau mot de passe');
    saisir('Confirmer le nouveau mot de passe', 'un tout nouveau mot de passe');
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));

    expect(await screen.findByRole('heading', { name: 'Conservez ce code' })).toBeTruthy();
    const nouveau = screen.getByLabelText('Code de récupération').textContent;
    expect(nouveau).not.toBe(recoveryCode);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Entrer dans l’application' }));
    expect(await screen.findByText(CONTENU)).toBeTruthy();

    // L'ancien mot de passe ne fonctionne plus.
    expect((await authService.verify(EMAIL, MDP)).ok).toBe(false);
  });

  it('refuse un code faux, sans rien changer', async () => {
    await authService.create(EMAIL, MDP);
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mot de passe oublié ?' }));

    saisir('Code de récupération', 'AAAAA-AAAAA-AAAAA-AAAAA');
    saisir('Nouveau mot de passe', 'un tout nouveau mot de passe');
    saisir('Confirmer le nouveau mot de passe', 'un tout nouveau mot de passe');
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Code de récupération incorrect.');
    expect((await authService.verify(EMAIL, MDP)).ok).toBe(true);
  });

  it('n’autorise l’effacement qu’après avoir tapé EFFACER', async () => {
    await authService.create(EMAIL, MDP);
    monter();
    await attendre();
    saisir('Adresse électronique', EMAIL);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mot de passe oublié ?' }));

    const effacer = screen.getByRole('button', { name: /Effacer toutes les données/ }) as HTMLButtonElement;
    expect(effacer.disabled).toBe(true);
    saisir('Tapez EFFACER pour confirmer', 'effacer');          // la casse compte
    expect(effacer.disabled).toBe(true);
    saisir('Tapez EFFACER pour confirmer', 'EFFACER');
    expect(effacer.disabled).toBe(false);
  });
});

describe('protection désactivée', () => {
  it('ouvre l’application directement, sans verrou', async () => {
    await authService.create(EMAIL, MDP);
    await authService.disable(MDP);
    monter();
    expect(await screen.findByText(CONTENU)).toBeTruthy();
    expect(useAuth.getState().guarded).toBe(false);
  });

  it('ne verrouille pas quand rien n’est protégé', () => {
    useAuth.setState({ status: 'unlocked', guarded: false });
    useAuth.getState().lock();
    expect(useAuth.getState().status).toBe('unlocked');
  });
});

describe('navigateur sans WebCrypto', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('n’impose pas un verrou impossible à créer : l’application s’ouvre', async () => {
    // Sans WebCrypto aucune empreinte ne peut être calculée. Imposer la création
    // d'un accès au premier lancement rendrait l'application inutilisable.
    vi.stubGlobal('crypto', {});
    monter();
    expect(await screen.findByText(CONTENU)).toBeTruthy();
    expect(useAuth.getState().guarded).toBe(false);
  });

  it('ne contourne jamais un accès existant, même si le navigateur est déficient', async () => {
    await authService.create(EMAIL, MDP);          // créé alors que WebCrypto existait
    vi.stubGlobal('crypto', {});
    monter();
    await attendre();
    expect(screen.queryByText(CONTENU)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Bon retour' })).toBeTruthy();
  });
});

describe('verrouillage pour inactivité', () => {
  const ouverte = () => useAuth.setState({
    status: 'unlocked', guarded: true, email: EMAIL, idleMinutes: 5,
  });

  it('verrouille après le délai, et ne redemande que le mot de passe', () => {
    vi.useFakeTimers();
    ouverte();
    monter();
    expect(screen.getByText(CONTENU)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect(screen.getByText(CONTENU)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(screen.queryByText(CONTENU)).toBeNull();
    // L'adresse est déjà connue de la page : seule l'étape du mot de passe revient.
    expect(screen.getByRole('heading', { name: 'Votre mot de passe' })).toBeTruthy();
  });

  it('repousse l’échéance à chaque geste', () => {
    vi.useFakeTimers();
    ouverte();
    monter();

    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect(screen.getByText(CONTENU)).toBeTruthy();   // 8 min au total, mais 4 depuis le geste

    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(screen.queryByText(CONTENU)).toBeNull();
  });

  it('verrouille au retour d’un onglet resté en arrière-plan, sans attendre le minuteur', () => {
    vi.useFakeTimers({ toFake: ['Date'] });   // les minuteurs sont suspendus, comme en arrière-plan
    ouverte();
    monter();

    vi.setSystemTime(Date.now() + 30 * 60_000);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByText(CONTENU)).toBeNull();
  });

  it('ne démonte l’application qu’une fois le verrou posé : rien ne reste dans le DOM', () => {
    vi.useFakeTimers();
    ouverte();
    monter();
    act(() => { vi.advanceTimersByTime(6 * 60_000); });
    expect(document.body.textContent).not.toContain(CONTENU);
  });

  it('un déverrouillage manuel (bouton Verrouiller) agit immédiatement', () => {
    ouverte();
    monter();
    expect(screen.getByText(CONTENU)).toBeTruthy();
    act(() => { useAuth.getState().lock(); });
    expect(screen.queryByText(CONTENU)).toBeNull();
  });
});
