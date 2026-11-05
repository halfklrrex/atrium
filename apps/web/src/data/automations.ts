/**
 * Automations (P5): the recipes of a board (`boards/{boardId}/automations/{id}`) and their run
 * history (`boards/{boardId}/automationRuns/{id}`). Board owners write recipes, every board reader
 * reads them; only board owners read the history, and only Cloud Functions write it.
 *
 * The write helpers build exactly the shapes `firestore.rules` accepts: a create sets `runAs`,
 * `createdBy` and `updatedBy` to the writer and both timestamps to the server time; an update only
 * touches the fields the rules allow. `consecutiveFailures` is written by the runner and is never
 * sent from here.
 */
import {
  AUTOMATION_LIMITS,
  validateAutomation,
  type Automation,
  type AutomationRun,
  type BoardRole,
  type ButtonAction,
  type AutomationCondition,
  type AutomationTrigger,
  type ButtonActionsBoard,
} from '@atrium/shared';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { db } from '../lib/firebase';
import type { WithId } from './model';
import { useQuerySnapshot, type SnapshotState } from './useSnapshot';

export type AutomationDoc = WithId<Automation>;
export type AutomationRunDoc = WithId<AutomationRun>;

/** The run history shows this many of the newest runs; filters work on these rows only. */
export const AUTOMATION_RUNS_LIMIT = 200;

function converter<T extends object>(): FirestoreDataConverter<WithId<T>, DocumentData> {
  return {
    toFirestore: ({ id: _id, ...data }) => data as DocumentData,
    fromFirestore: (snapshot, options) =>
      ({
        ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as T),
        id: snapshot.id,
      }) as WithId<T>,
  };
}

const automationConverter = converter<Automation>();
const runConverter = converter<AutomationRun>();

const automationsCollection = (boardId: string): CollectionReference<DocumentData> =>
  collection(db, 'boards', boardId, 'automations');

const automationDoc = (boardId: string, automationId: string) =>
  doc(db, 'boards', boardId, 'automations', automationId);

/** The part of a recipe an owner edits. */
export interface AutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: ButtonAction[];
}

/** The board facts the write helpers validate against. */
export type AutomationBoard = Pick<ButtonActionsBoard, 'columns' | 'groups' | 'columnLocks'>;

/** Sorted by `createdAt`, oldest first; a pending local write has no server time yet and sorts last. */
export function sortAutomations(list: readonly AutomationDoc[]): AutomationDoc[] {
  const at = (a: AutomationDoc) => a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
}

/** Live recipes of a board, oldest first (every board reader may subscribe). */
export function useBoardAutomations(boardId: string | undefined): SnapshotState<AutomationDoc[]> {
  const q = useMemo(
    () =>
      boardId
        ? query(
            automationsCollection(boardId).withConverter(automationConverter),
            orderBy('createdAt', 'asc'),
          )
        : null,
    [boardId],
  );
  const state = useQuerySnapshot(q);
  const data = useMemo(() => sortAutomations(state.data), [state.data]);
  return { data, loading: state.loading, error: state.error };
}

/**
 * The newest runs, newest first, from ONE listener (no composite index): filtering by recipe or
 * status happens on these rows in the UI. Board owners only: pass `enabled = false` for everyone
 * else and nothing subscribes (the rules would refuse it).
 */
export function useAutomationRuns(
  boardId: string | undefined,
  enabled: boolean,
): SnapshotState<AutomationRunDoc[]> {
  const q = useMemo(
    () =>
      boardId && enabled
        ? query(
            collection(db, 'boards', boardId, 'automationRuns').withConverter(runConverter),
            orderBy('startedAt', 'desc'),
            limit(AUTOMATION_RUNS_LIMIT),
          )
        : null,
    [boardId, enabled],
  );
  return useQuerySnapshot(q);
}

/** Firestore refuses `undefined`; a JSON round trip drops it (`value: undefined` on a condition). */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Checks a recipe the way the editor and the runner do. Returns the first problem as a message, or
 * `null` when it can be saved. `existingCount` is the number of recipes already on the board (the
 * rules cannot count, so the cap lives here); pass `null` for an edit.
 */
export function checkAutomation(
  input: Pick<AutomationInput, 'trigger' | 'conditions' | 'actions'>,
  board: AutomationBoard,
  role: BoardRole | null,
  existingCount: number | null,
): string | null {
  if (existingCount !== null && existingCount >= AUTOMATION_LIMITS.maxPerBoard) {
    return `A board can have at most ${AUTOMATION_LIMITS.maxPerBoard} automations.`;
  }
  const checked = validateAutomation(input, board, role);
  return checked.ok ? null : checked.message;
}

function assertName(name: string): void {
  if (name.length > AUTOMATION_LIMITS.name) {
    throw new Error(`The name can have at most ${AUTOMATION_LIMITS.name} characters.`);
  }
}

/**
 * The document a create writes. `uid` is the signed-in writer and is all three of `runAs`,
 * `createdBy` and `updatedBy`: a helper cannot produce a create the rules would refuse for a
 * wrong `runAs`.
 */
export function buildAutomationCreate(uid: string, input: AutomationInput, enabled = true) {
  return {
    name: input.name,
    enabled,
    trigger: plain(input.trigger),
    conditions: plain(input.conditions),
    actions: plain(input.actions),
    runAs: uid,
    disabledReason: null,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

/** What an edit writes: the recipe, the writer as `runAs` (saving takes the recipe over) and the stamp. */
export function buildAutomationUpdate(uid: string, input: AutomationInput) {
  return {
    name: input.name,
    trigger: plain(input.trigger),
    conditions: plain(input.conditions),
    actions: plain(input.actions),
    runAs: uid,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

/** Turning on clears the reason it was off; turning off leaves `disabledReason` as it is. */
export function buildAutomationEnabled(uid: string, enabled: boolean) {
  return {
    enabled,
    ...(enabled ? { disabledReason: null } : {}),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };
}

export interface AutomationWriteContext {
  boardId: string;
  uid: string;
  board: AutomationBoard;
  role: BoardRole | null;
}

export const automationWrites = {
  /** Add a recipe (a fresh id) and return its id. `existingCount` is the loaded list's length. */
  async create(
    ctx: AutomationWriteContext,
    input: AutomationInput,
    existingCount: number,
    options: { enabled?: boolean } = {},
  ): Promise<string> {
    assertName(input.name);
    const problem = checkAutomation(input, ctx.board, ctx.role, existingCount);
    if (problem) throw new Error(problem);
    const ref = doc(automationsCollection(ctx.boardId));
    await setDoc(ref, buildAutomationCreate(ctx.uid, input, options.enabled ?? true));
    return ref.id;
  },

  /** Save an edited recipe. The writer becomes the person it runs as. */
  async update(ctx: AutomationWriteContext, automationId: string, input: AutomationInput) {
    assertName(input.name);
    const problem = checkAutomation(input, ctx.board, ctx.role, null);
    if (problem) throw new Error(problem);
    await updateDoc(
      automationDoc(ctx.boardId, automationId),
      buildAutomationUpdate(ctx.uid, input),
    );
  },

  /**
   * Switch a recipe on or off. Turning one on is checked against the board first, so a recipe
   * whose column was deleted does not come back on only to fail.
   */
  async setEnabled(
    ctx: AutomationWriteContext,
    automation: Pick<AutomationDoc, 'id' | 'trigger' | 'conditions' | 'actions'>,
    enabled: boolean,
  ) {
    if (enabled) {
      const problem = checkAutomation(automation, ctx.board, ctx.role, null);
      if (problem) throw new Error(problem);
    }
    await updateDoc(
      automationDoc(ctx.boardId, automation.id),
      buildAutomationEnabled(ctx.uid, enabled),
    );
  },

  async remove(boardId: string, automationId: string) {
    await deleteDoc(automationDoc(boardId, automationId));
  },
};

/** "Copy of X" within the name limit; an unnamed recipe stays unnamed. */
export function duplicateAutomationName(name: string): string {
  if (name.trim() === '') return '';
  return `${name} (copy)`.slice(0, AUTOMATION_LIMITS.name);
}

/** The editable part of a stored recipe. */
export function automationInputOf(
  automation: Pick<Automation, 'name' | 'trigger' | 'conditions' | 'actions'>,
): AutomationInput {
  return {
    name: automation.name,
    trigger: automation.trigger,
    conditions: automation.conditions,
    actions: automation.actions,
  };
}
