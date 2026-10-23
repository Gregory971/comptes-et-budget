import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TASK_LABEL, TASK_MAX, isOverdue, taskService } from '../services/taskService';
import { formatFr, today, type Ymd } from '../utils/date';
import type { Task, TaskKind } from '../types';

const NO_TASKS: Task[] = [];

/** Tâches, rappels et notes de la base, sur le tableau de bord. */
export function TasksCard({ dbId }: { dbId: string }) {
  const tasks = useLiveQuery(() => taskService.list(dbId), [dbId], NO_TASKS) ?? NO_TASKS;
  const [kind, setKind] = useState<TaskKind>('tache');
  const [text, setText] = useState('');
  const [due, setDue] = useState<Ymd>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; due: Ymd } | null>(null);

  const now = today();
  const ouvertes = tasks.filter(t => !t.done && t.kind !== 'note').length;
  const enRetard = tasks.filter(t => isOverdue(t, now)).length;
  const terminees = tasks.filter(t => t.done).length;

  async function add() {
    setError(null);
    try {
      await taskService.create({ dbId, kind, text, due: due || undefined });
      setText(''); setDue('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setError(null);
    try {
      await taskService.update(editing.id, { text: editing.text, due: editing.due || null });
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong className="panel-t">Tâches, notes, rappels</strong>
        <span className="muted" style={{ fontSize: 13 }} role="status">
          {ouvertes} à faire{enRetard > 0 && <strong style={{ color: 'var(--red)' }}> · {enRetard} en retard</strong>}
        </span>
      </div>

      <div className="inline" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field"><label htmlFor="tk-kind">Type</label>
          <select id="tk-kind" value={kind} onChange={e => setKind(e.target.value as TaskKind)}>
            {(Object.keys(TASK_LABEL) as TaskKind[]).map(k => <option key={k} value={k}>{TASK_LABEL[k]}</option>)}</select></div>
        <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="tk-text">Texte</label>
          <input id="tk-text" value={text} maxLength={TASK_MAX} placeholder="Ex : Envoyer l’attestation à la banque"
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} /></div>
        {kind !== 'note' && (
          <div className="field"><label htmlFor="tk-due">{kind === 'rappel' ? 'Date du rappel' : 'Avant le'}</label>
            <input id="tk-due" type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
        )}
        <button className="btn" onClick={add}>Ajouter</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '6px 0 0' }}>{error}</p>}

      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {tasks.map(t => {
          const retard = isOverdue(t, now);
          return (
            <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', opacity: t.done ? 0.55 : 1 }}>
              {t.kind === 'note'
                ? <span aria-hidden="true" title="Note">📝</span>
                : <input type="checkbox" checked={t.done} aria-label={`${t.done ? 'Rouvrir' : 'Terminer'} : ${t.text}`}
                    onChange={e => taskService.toggle(t.id, e.target.checked)} />}
              {editing?.id === t.id ? (
                <>
                  <input aria-label="Texte" value={editing.text} maxLength={TASK_MAX} style={{ flex: 1 }} autoFocus
                    onChange={e => setEditing({ ...editing, text: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
                  {t.kind !== 'note' && <input type="date" aria-label="Date" value={editing.due}
                    onChange={e => setEditing({ ...editing, due: e.target.value })} />}
                  <button className="btn" onClick={saveEdit}>Enregistrer</button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>Annuler</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none' }}>
                    {t.text}{' '}
                    <span className="chip" style={{ marginLeft: 4 }}>{TASK_LABEL[t.kind]}</span>
                  </span>
                  {t.due && (
                    <span className={'chip' + (retard ? ' dep' : '')} title={retard ? 'En retard' : undefined}>
                      {retard && <span aria-hidden="true">⚠️ </span>}{retard && <span className="sr-only">En retard : </span>}{formatFr(t.due)}
                    </span>
                  )}
                  <button className="iconbtn" aria-label={`Modifier : ${t.text}`}
                    onClick={() => setEditing({ id: t.id, text: t.text, due: t.due ?? '' })}>✏️</button>
                  <button className="iconbtn" aria-label={`Supprimer : ${t.text}`} onClick={() => taskService.remove(t.id)}>🗑</button>
                </>
              )}
            </li>
          );
        })}
        {tasks.length === 0 && <li className="muted" style={{ padding: '4px 0' }}>Rien pour l’instant. Notez ici ce que vous ne voulez pas oublier.</li>}
      </ul>

      {terminees > 0 && (
        <button className="linklike" style={{ marginTop: 8, fontSize: 13 }} onClick={() => taskService.clearDone(dbId)}>
          Supprimer les {terminees} terminée(s)
        </button>
      )}
    </div>
  );
}
