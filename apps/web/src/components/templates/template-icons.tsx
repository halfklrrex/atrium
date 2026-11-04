import { Board, Bug, Calendar, Doc, Home } from '@vibe/icons';

/** Vibe icon for a built-in template's icon key; unknown keys (and saved templates) use the board icon. */
export function TemplateIcon({ name }: { name: string | undefined }) {
  switch (name) {
    case 'calendar':
      return <Calendar />;
    case 'bug':
      return <Bug />;
    case 'home':
      return <Home />;
    case 'book':
      return <Doc />;
    default:
      return <Board />;
  }
}
