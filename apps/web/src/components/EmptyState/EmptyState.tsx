import { Button } from '@vibe/core';
import classNames from 'classnames';
import { isValidElement, useId, type ComponentProps, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import styles from './EmptyState.module.css';

export type EmptyStateSize = 'page' | 'panel' | 'inline';

export interface EmptyStateAction {
  label: string;
  /** In-app route; renders a router link. */
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** `button` is a Vibe button, `link` is text in the link colour. Primary defaults to a button. */
  variant?: 'button' | 'link';
}

export interface EmptyStateProps {
  size: EmptyStateSize;
  illustration?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** An action description, or a ready-made element (for example a link that opens a popover). */
  primaryAction?: EmptyStateAction | ReactNode;
  secondaryAction?: EmptyStateAction | ReactNode;
  className?: string;
}

/** A Vibe button that navigates in-app (Vibe buttons are not anchors). */
function RouteButton({
  to,
  onClick,
  children,
  ...rest
}: { to: string; onClick?: () => void; children: ReactNode } & Pick<
  ComponentProps<typeof Button>,
  'size' | 'kind' | 'disabled'
>) {
  const navigate = useNavigate();
  return (
    <Button
      {...rest}
      onClick={() => {
        onClick?.();
        void navigate(to);
      }}
    >
      {children}
    </Button>
  );
}

const isAction = (value: unknown): value is EmptyStateAction =>
  typeof value === 'object' && value !== null && !isValidElement(value) && 'label' in value;

function renderAction(
  action: EmptyStateAction | ReactNode,
  role: 'primary' | 'secondary',
  size: EmptyStateSize,
): ReactNode {
  if (!action) return null;
  if (!isAction(action)) return action;
  const { label, to, onClick, disabled, variant = role === 'primary' ? 'button' : 'link' } = action;
  if (variant === 'link') {
    return to ? (
      <Link to={to} className={styles.link} onClick={onClick}>
        {label}
      </Link>
    ) : (
      <button type="button" className={styles.link} disabled={disabled} onClick={onClick}>
        {label}
      </button>
    );
  }
  const buttonSize = size === 'inline' ? 'xs' : 'small';
  const kind = role === 'primary' ? 'primary' : 'secondary';
  if (to) {
    return (
      <RouteButton to={to} size={buttonSize} kind={kind} disabled={disabled} onClick={onClick}>
        {label}
      </RouteButton>
    );
  }
  return (
    <Button size={buttonSize} kind={kind} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * monday-style empty screen: a soft illustration, a short headline, a line of help and one clear
 * action. `page` fills a page, `panel` sits in a side panel or card, `inline` is a compact hint.
 */
export function EmptyState({
  size,
  illustration,
  title,
  body,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const titleId = useId();
  const primary = renderAction(primaryAction, 'primary', size);
  const secondary = renderAction(secondaryAction, 'secondary', size);
  // Compact hints inside navigation stay out of the landmark and heading outline.
  const compact = size === 'inline';
  const Root = compact ? 'div' : 'section';
  const Title = compact ? 'p' : 'h2';
  return (
    <Root
      className={classNames(
        styles.root,
        styles[size],
        illustration ? styles.hasArt : undefined,
        className,
      )}
      aria-labelledby={compact ? undefined : titleId}
      data-size={size}
    >
      {illustration ? <div className={styles.art}>{illustration}</div> : null}
      <Title id={titleId} className={styles.title}>
        {title}
      </Title>
      {body ? <p className={styles.body}>{body}</p> : null}
      {primary || secondary ? (
        <div className={styles.actions}>
          {primary}
          {secondary}
        </div>
      ) : null}
    </Root>
  );
}
