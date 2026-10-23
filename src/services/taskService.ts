import { db, uid, stamp } from './db';
import { today, type Ymd } from '../utils/date';
import type { Task, TaskKind } from '../types';

/** Longueur maximale d'un texte : un pense-bête, pas un document. */
export const TASK_MAX = 200;

export const TASK_LABEL: Record<TaskKind, string> = { tache: 'À faire', rappel: 'Rappel', note: 'Note' };

export interface NewTask { dbId: string; kind: TaskKind; text: string; due?: Ymd }

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pense-bêtes de la base : tâches, rappels et notes.
 *
 * Une note n'a pas d'échéance et ne se « termine » pas : elle reste jusqu'à sa
 * suppression. Tâches et rappels se cochent ; un rappel exige une date, une
 * tâche peut en avoir une.
 */
export function validateTask(t: { kind: TaskKind; text: string; due?: Ymd }): string | null {
  const text = t.text.trim();
  if (!text) return 'Le texte est obligatoire.';
  if (text.length > TASK_MAX) return `Le texte est limité à ${TASK_MAX} caractères.`;
  if (t.due && !YMD.test(t.due)) return 'La date est invalide.';
  if (t.kind === 'rappel' && !t.due) return 'Un rappel a besoin d’une date.';
  return null;
}

/** Tâches et rappels en retard : date dépassée et pas encore faits. */
export const isOverdue = (t: Pick<Task, 'kind' | 'due' | 'done'>, asOf: Ymd = today()): boolean =>
  t.kind !== 'note' && !t.done && !!t.due && t.due < asOf;

/** Ordre d'affichage : à faire d'abord (en retard, puis par date, sans date ensuite), notes, terminées en dernier. */
export function sortTasks(tasks: Task[], asOf: Ymd = today()): Task[] {
  const rang = (t: Task) => (t.done ? 3 : t.kind === 'note' ? 2 : isOverdue(t, asOf) ? 0 : 1);
  return [...tasks].sort((a, b) =>
    rang(a) - rang(b)
    || (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99')
    || b.createdAt.localeCompare(a.createdAt));
}

export const taskService = {
  async list(dbId: string): Promise<Task[]> {
    return sortTasks(await db.tasks.where('dbId').equals(dbId).toArray());
  },

  async create(input: NewTask): Promise<Task> {
    const due = input.kind === 'note' ? undefined : input.due || undefined;
    const problem = validateTask({ ...input, due });
    if (problem) throw new Error(problem);
    const now = stamp();
    const row: Task = {
      id: uid(), dbId: input.dbId, kind: input.kind, text: input.text.trim(), due, done: false, createdAt: now, updatedAt: now,
    };
    await db.tasks.add(row);
    return row;
  },

  async update(id: string, patch: { text?: string; due?: Ymd | null; kind?: TaskKind }): Promise<void> {
    const cur = await db.tasks.get(id);
    if (!cur) return;
    const kind = patch.kind ?? cur.kind;
    const due = kind === 'note' ? undefined : patch.due === null ? undefined : patch.due ?? cur.due;
    const text = patch.text ?? cur.text;
    const problem = validateTask({ kind, text, due });
    if (problem) throw new Error(problem);
    // Une note ne se termine pas : le passage en note efface l'état « fait ».
    await db.tasks.update(id, { kind, text: text.trim(), due, done: kind === 'note' ? false : cur.done, updatedAt: stamp() });
  },

  async toggle(id: string, done: boolean): Promise<void> {
    const cur = await db.tasks.get(id);
    if (!cur || cur.kind === 'note') return;
    await db.tasks.update(id, { done, updatedAt: stamp() });
  },

  remove: (id: string) => db.tasks.delete(id),

  /** Supprime d'un coup les tâches et rappels terminés. Renvoie combien. */
  async clearDone(dbId: string): Promise<number> {
    const ids = (await db.tasks.where('dbId').equals(dbId).toArray()).filter(t => t.done).map(t => t.id);
    await db.tasks.bulkDelete(ids);
    return ids.length;
  },

  /** Tâches et rappels à traiter aujourd'hui ou en retard. */
  async dueCount(dbId: string, asOf: Ymd = today()): Promise<number> {
    return (await db.tasks.where('dbId').equals(dbId).toArray())
      .filter(t => t.kind !== 'note' && !t.done && !!t.due && t.due <= asOf).length;
  },
};
