// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { dbService } from './dbService';
import { backupService } from './backupService';
import { isOverdue, sortTasks, taskService, validateTask, TASK_MAX } from './taskService';
import type { Database, Task } from '../types';

let base: Database;

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  base = await dbService.create('Base tâches', 'perso');
});

const tache = (over: Partial<Task> = {}): Task => ({
  id: Math.random().toString(36).slice(2), dbId: 'd', kind: 'tache', text: 't', done: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '', ...over,
});

describe('validation', () => {
  it('accepte une tâche, un rappel daté et une note', () => {
    expect(validateTask({ kind: 'tache', text: 'Appeler la banque' })).toBeNull();
    expect(validateTask({ kind: 'tache', text: 'x', due: '2026-10-25' })).toBeNull();
    expect(validateTask({ kind: 'rappel', text: 'x', due: '2026-10-25' })).toBeNull();
    expect(validateTask({ kind: 'note', text: 'x' })).toBeNull();
  });
  it('refuse texte vide, trop long, date invalide et rappel sans date', () => {
    expect(validateTask({ kind: 'tache', text: '   ' })).toMatch(/obligatoire/);
    expect(validateTask({ kind: 'tache', text: 'x'.repeat(TASK_MAX + 1) })).toMatch(/200 caractères/);
    expect(validateTask({ kind: 'tache', text: 'x'.repeat(TASK_MAX) })).toBeNull();
    expect(validateTask({ kind: 'tache', text: 'x', due: '25/10/2026' })).toMatch(/date est invalide/);
    expect(validateTask({ kind: 'rappel', text: 'x' })).toMatch(/besoin d’une date/);
  });
});

describe('retard et tri', () => {
  const asOf = '2026-10-23';
  it('une tâche ou un rappel passé et non fait est en retard ; jamais une note, une tâche faite ou du jour', () => {
    expect(isOverdue(tache({ due: '2026-10-22' }), asOf)).toBe(true);
    expect(isOverdue(tache({ kind: 'rappel', due: '2026-10-01' }), asOf)).toBe(true);
    expect(isOverdue(tache({ due: '2026-10-23' }), asOf)).toBe(false);
    expect(isOverdue(tache({ due: '2026-10-22', done: true }), asOf)).toBe(false);
    expect(isOverdue(tache({ kind: 'note', due: '2026-10-01' }), asOf)).toBe(false);
    expect(isOverdue(tache({}), asOf)).toBe(false);
  });

  it('classe : en retard, à venir par date, sans date, notes, terminées', () => {
    const l = sortTasks([
      tache({ id: 'fait', done: true, due: '2026-10-01' }),
      tache({ id: 'note', kind: 'note' }),
      tache({ id: 'sans', createdAt: '2026-01-02T00:00:00.000Z' }),
      tache({ id: 'plus-tard', due: '2026-12-01' }),
      tache({ id: 'demain', due: '2026-10-24' }),
      tache({ id: 'retard', due: '2026-10-10' }),
    ], asOf);
    expect(l.map(t => t.id)).toEqual(['retard', 'demain', 'plus-tard', 'sans', 'note', 'fait']);
  });
});

describe('service', () => {
  it('crée, nettoie le texte et classe', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: '  Payer la taxe  ', due: '2099-01-01' });
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'En retard', due: '2000-01-01' });
    const l = await taskService.list(base.id);
    expect(l.map(t => t.text)).toEqual(['En retard', 'Payer la taxe']);
  });

  it('refuse un enregistrement invalide sans rien écrire', async () => {
    await expect(taskService.create({ dbId: base.id, kind: 'rappel', text: 'x' })).rejects.toThrow(/date/);
    await expect(taskService.create({ dbId: base.id, kind: 'tache', text: '' })).rejects.toThrow(/obligatoire/);
    expect(await db.tasks.count()).toBe(0);
  });

  it('une note ignore toute échéance', async () => {
    const n = await taskService.create({ dbId: base.id, kind: 'note', text: 'Code du portail', due: '2026-10-25' });
    expect(n.due).toBeUndefined();
  });

  it('coche et décoche tâches et rappels, jamais une note', async () => {
    const t = await taskService.create({ dbId: base.id, kind: 'tache', text: 'a' });
    const n = await taskService.create({ dbId: base.id, kind: 'note', text: 'b' });
    await taskService.toggle(t.id, true);
    await taskService.toggle(n.id, true);
    expect((await db.tasks.get(t.id))?.done).toBe(true);
    expect((await db.tasks.get(n.id))?.done).toBe(false);
    await taskService.toggle(t.id, false);
    expect((await db.tasks.get(t.id))?.done).toBe(false);
  });

  it('modifie le texte et la date, et efface la date avec null', async () => {
    const t = await taskService.create({ dbId: base.id, kind: 'tache', text: 'a', due: '2026-11-01' });
    await taskService.update(t.id, { text: 'b', due: '2026-11-05' });
    expect(await db.tasks.get(t.id)).toMatchObject({ text: 'b', due: '2026-11-05' });
    await taskService.update(t.id, { due: null });
    expect((await db.tasks.get(t.id))?.due).toBeUndefined();
    await expect(taskService.update(t.id, { text: '' })).rejects.toThrow(/obligatoire/);
    expect((await db.tasks.get(t.id))?.text).toBe('b');
  });

  it('refuse de transformer en rappel sans date et efface l’état « fait » en passant en note', async () => {
    const t = await taskService.create({ dbId: base.id, kind: 'tache', text: 'a' });
    await expect(taskService.update(t.id, { kind: 'rappel' })).rejects.toThrow(/date/);
    await taskService.toggle(t.id, true);
    await taskService.update(t.id, { kind: 'note' });
    expect(await db.tasks.get(t.id)).toMatchObject({ kind: 'note', done: false, due: undefined });
  });

  it('supprime une tâche, ou toutes les terminées d’un coup', async () => {
    const a = await taskService.create({ dbId: base.id, kind: 'tache', text: 'a' });
    const b = await taskService.create({ dbId: base.id, kind: 'tache', text: 'b' });
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'c' });
    await taskService.create({ dbId: base.id, kind: 'note', text: 'n' });
    await taskService.toggle(a.id, true); await taskService.toggle(b.id, true);
    expect(await taskService.clearDone(base.id)).toBe(2);
    expect((await taskService.list(base.id)).map(t => t.text).sort()).toEqual(['c', 'n']);
    await taskService.remove((await taskService.list(base.id))[0].id);
    expect(await db.tasks.count()).toBe(1);
  });

  it('compte ce qui est à traiter aujourd’hui ou en retard', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'hier', due: '2026-10-22' });
    await taskService.create({ dbId: base.id, kind: 'rappel', text: 'aujourd’hui', due: '2026-10-23' });
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'demain', due: '2026-10-24' });
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'sans date' });
    await taskService.create({ dbId: base.id, kind: 'note', text: 'note' });
    expect(await taskService.dueCount(base.id, '2026-10-23')).toBe(2);
  });

  it('suit la sauvegarde, sans être vidé par un fichier d’avant les tâches', async () => {
    await taskService.create({ dbId: base.id, kind: 'tache', text: 'a garder' });
    const copie = await backupService.export();
    expect(copie.tasks?.map(t => t.text)).toEqual(['a garder']);
    await db.tasks.clear();
    await backupService.restore(copie, 'replace', false);
    expect(await db.tasks.count()).toBe(1);
    delete copie.tasks;
    await backupService.restore(copie, 'replace', false);
    expect(await db.tasks.count()).toBe(1);
  });
});
