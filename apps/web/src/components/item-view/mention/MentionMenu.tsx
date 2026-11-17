import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import classNames from 'classnames';
import { exitSuggestion } from '@tiptap/suggestion';
import type { Editor } from '@tiptap/react';
import { useWorkspace } from '../../../data';
import type { BoardAccessInput } from '@atrium/shared';
import { useWorkspaceMembers } from '../../../data/members-store';
import { UserAvatar } from '../../UserAvatar';
import { AnchoredPopup } from '../../board-table/AnchoredPopup';
import { mentionCandidates } from '../../item-card/mention-candidates';
import listStyles from '../../item-card/MentionTextarea.module.css';
import slashStyles from '../slash-menu/SlashMenu.module.css';
import type { MentionController, MentionSuggestState } from './mention-controller';
import { mentionPluginKey } from './mention-extension';

/**
 * Where the "@" list gets its people: a hook (stable identity) that says what the content is
 * (its access settings) and which workspace's members to list.
 */
export interface MentionSource {
  useScope: () => { access: BoardAccessInput | null | undefined; workspaceId: string | undefined };
}

/** The "@" list under the caret. Mounts the member listeners only while a "@query" is open. */
export function MentionMenu({
  controller,
  editor,
  source,
}: {
  controller: MentionController;
  editor: Editor;
  source: MentionSource;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state || !state.anchor) return null;
  return <MentionList controller={controller} editor={editor} source={source} state={state} />;
}

function MentionList({
  controller,
  editor,
  source,
  state,
}: {
  controller: MentionController;
  editor: Editor;
  source: MentionSource;
  state: MentionSuggestState;
}) {
  const { access: board, workspaceId } = source.useScope();
  const { data: workspace } = useWorkspace(workspaceId);
  const { members } = useWorkspaceMembers(workspaceId);
  const [active, setActive] = useState(0);
  const { query, command } = state;

  const candidates = useMemo(
    () => mentionCandidates({ board, workspace, members, query }),
    [board, workspace, members, query],
  );
  // A shorter list must not leave the highlight past its end.
  const current = Math.min(active, Math.max(candidates.length - 1, 0));

  // With spaces allowed in the query, a multi-word query that matches nobody ends the mention.
  const noMatchWithSpace = candidates.length === 0 && /\s/.test(query.trim());
  useEffect(() => {
    if (noMatchWithSpace) exitSuggestion(editor.view, mentionPluginKey);
  }, [noMatchWithSpace, editor]);

  useEffect(() => {
    controller.setKeys((event) => {
      if (candidates.length === 0) return false;
      if (event.key === 'ArrowDown') setActive((current + 1) % candidates.length);
      else if (event.key === 'ArrowUp')
        setActive((current - 1 + candidates.length) % candidates.length);
      else if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = candidates[current];
        if (!chosen) return false;
        command({ id: chosen.uid, label: chosen.name });
      } else return false;
      return true;
    });
    return () => controller.setKeys(null);
  }, [controller, candidates, current, command]);

  return (
    <AnchoredPopup
      anchor={state.anchor}
      label="Mention someone"
      className={slashStyles.layer}
      onClose={() => exitSuggestion(editor.view, mentionPluginKey)}
    >
      <div
        className={listStyles.list}
        role="listbox"
        aria-label="People"
        // Keep the focus in the editor while the list is clicked.
        onMouseDown={(event) => event.preventDefault()}
      >
        {candidates.length === 0 ? (
          <div className={listStyles.empty}>No members found</div>
        ) : (
          candidates.map((person, index) => (
            <div
              key={person.uid}
              role="option"
              aria-selected={index === current}
              tabIndex={-1}
              className={classNames(listStyles.option, index === current && listStyles.active)}
              onMouseEnter={() => setActive(index)}
              onClick={() => command({ id: person.uid, label: person.name })}
            >
              <UserAvatar
                uid={person.uid}
                name={person.name}
                photoURL={person.photoURL}
                size="xs"
              />
              <span className={listStyles.name}>{person.name}</span>
            </div>
          ))
        )}
      </div>
    </AnchoredPopup>
  );
}
