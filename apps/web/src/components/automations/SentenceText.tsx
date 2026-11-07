import { Fragment, type ReactNode } from 'react';
import type { AutomationDoc } from '../../data/automations';
import type { DescribeBoard, DescribeOptions } from './describe-automation';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names a sentence is built from: column and group titles, and the people it notifies. */
export function sentenceNames(
  automation: Pick<AutomationDoc, 'actions'>,
  board: DescribeBoard,
  options: DescribeOptions = {},
): string[] {
  const names = [...board.columns.map((c) => c.title), ...board.groups.map((g) => g.title)];
  for (const action of automation.actions) {
    if (action.type !== 'notify') continue;
    for (const uid of action.uids) {
      const name = options.personName?.(uid);
      if (name) names.push(name);
    }
  }
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 1))];
}

/** Splits `text` so every whole-word occurrence of a name is wrapped in `<strong>`. */
export function boldNames(text: string, names: readonly string[]): ReactNode[] {
  if (names.length === 0) return [text];
  const pattern = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const parts = text.split(new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'u'));
  // `split` with one capture group puts the matches at the odd indexes.
  return parts.map((part, index) =>
    index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}
