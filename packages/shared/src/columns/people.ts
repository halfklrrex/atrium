import { z } from 'zod';
import { idSchema } from '../schemas/common';
import { defineColumnType } from './registry';

export const peopleSettingsSchema = z
  .object({
    /** When true the cell holds at most one person (monday: "Allow multiple people" off). */
    singlePerson: z.boolean().default(false),
  })
  .strict();
export type PeopleSettings = z.infer<typeof peopleSettingsSchema>;

/** Same shape as monday's `personsAndTeams`, with Firebase uids in place of numeric user ids. */
export const personOrTeamSchema = z.object({
  id: idSchema,
  kind: z.enum(['person', 'team']),
});
export type PersonOrTeam = z.infer<typeof personOrTeamSchema>;

export const peopleValueSchema = z.object({
  personsAndTeams: z.array(personOrTeamSchema).max(200),
});
export type PeopleValue = z.infer<typeof peopleValueSchema>;

export const peopleColumn = defineColumnType<PeopleSettings, PeopleValue>({
  type: 'people',
  label: 'People',
  settingsSchema: peopleSettingsSchema,
  valueSchema: peopleValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'distribution'],
  defaultSettings: () => ({ singlePerson: false }),
  // Display names live in user profiles, which only the app layer can resolve (P4). The text form
  // therefore lists the ids, which is stable and still useful for search and export fallbacks.
  toText: (value) => value.personsAndTeams.map((p) => p.id).join(', '),
  compare: (a, b) => {
    const byCount = a.personsAndTeams.length - b.personsAndTeams.length;
    if (byCount !== 0) return byCount;
    const key = (v: PeopleValue) => v.personsAndTeams.map((p) => p.id).join(',');
    return key(a).localeCompare(key(b));
  },
});
