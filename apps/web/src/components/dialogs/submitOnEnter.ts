import type { KeyboardEvent } from 'react';

/** Enter in a text field submits the dialog (the footer buttons live outside the <form>). */
export const submitOnEnter =
  (submit: () => void) =>
  (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
