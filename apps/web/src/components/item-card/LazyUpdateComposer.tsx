import classNames from 'classnames';
import { lazy, Suspense } from 'react';
import type { UpdateComposerProps } from './UpdateComposer';
import styles from './UpdateComposer.module.css';

// Code-split like the description editor: the TipTap bundle only loads once a feed is on screen.
const UpdateComposer = lazy(() => import('./UpdateComposer'));

/** The composer's box with just its placeholder, shown while the editor chunk loads. */
function ComposerFallback({
  placeholder,
  variant,
}: Pick<UpdateComposerProps, 'placeholder' | 'variant'>) {
  return (
    <div className={classNames(styles.composerBox, variant === 'reply' && styles.reply)}>
      <div className={styles.fallback}>{placeholder}</div>
    </div>
  );
}

export function LazyUpdateComposer(props: UpdateComposerProps) {
  return (
    <Suspense
      fallback={<ComposerFallback placeholder={props.placeholder} variant={props.variant} />}
    >
      <UpdateComposer {...props} />
    </Suspense>
  );
}
