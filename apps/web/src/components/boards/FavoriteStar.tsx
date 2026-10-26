import { IconButton } from '@vibe/core';
import { Favorite } from '@vibe/icons';
import classNames from 'classnames';
import { useAuth } from '../../auth/auth-context';
import { useFavorites, type BoardDoc } from '../../data';
import { FavoriteFilled } from '../icons/FavoriteFilled';
import { boardActions } from './board-actions';
import styles from './boards.module.css';

export { FavoriteFilled };

/** Star toggle that adds/removes a board from the user's favourites. */
export function FavoriteStar({
  board,
  size = 'small',
  className,
}: {
  board: BoardDoc;
  size?: 'xs' | 'small';
  className?: string;
}) {
  const { user } = useAuth();
  const { data: favorites } = useFavorites(user?.uid ?? null);
  const isFavorite = favorites.some((f) => f.boardId === board.id);

  return (
    <IconButton
      icon={isFavorite ? FavoriteFilled : Favorite}
      size={size}
      kind="tertiary"
      className={className}
      iconClassName={classNames(styles.star, isFavorite && styles.starOn)}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFavorite}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (user) void boardActions.toggleFavorite(user.uid, board, favorites);
      }}
    />
  );
}
