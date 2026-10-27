import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Alert } from '@vibe/icons';
import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { uploadProgress } from './description-image-upload';
import { useDescriptionImageUrl } from './description-image-url';
import styles from './DescriptionEditor.module.css';

const MIN_WIDTH = 25;
const MAX_WIDTH = 100;
const KEY_STEP = 5;

const clampWidth = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));

/**
 * A description image. The signed URL comes from the server (cached, refreshed before it expires);
 * while it loads there is a skeleton, and if it cannot load, an "Image unavailable" tile. When the
 * image is selected in an editable editor, handles resize it (a percentage of the content width).
 */
export function ImageNodeView({
  node,
  editor,
  selected,
  updateAttributes,
  extension,
}: NodeViewProps) {
  const { boardId, itemId } = extension.options as { boardId: string; itemId: string };
  const fileId = String(node.attrs.fileId ?? '');
  const image = useDescriptionImageUrl(boardId, itemId, fileId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const editable = editor.isEditable;

  const stored = typeof node.attrs.width === 'number' ? clampWidth(node.attrs.width) : MAX_WIDTH;
  const shown = liveWidth ?? stored;
  const alt = String(node.attrs.alt || 'Image in the description');

  const startResize = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const wrap = wrapRef.current;
    const container = wrap?.parentElement;
    if (!wrap || !container) return;
    const containerWidth = container.clientWidth || 1;
    const startX = event.clientX;
    const startPx = wrap.getBoundingClientRect().width;
    let latest = stored;
    const move = (e: globalThis.PointerEvent) => {
      latest = clampWidth(((startPx + e.clientX - startX) / containerWidth) * 100);
      setLiveWidth(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLiveWidth(null);
      if (latest !== stored) updateAttributes({ width: latest });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onHandleKey = (event: KeyboardEvent<HTMLElement>) => {
    const delta = event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    updateAttributes({ width: clampWidth(stored + delta) });
  };

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={styles.image}
      data-selected={(selected && editable) || undefined}
      style={{ width: `${shown}%` }}
      contentEditable={false}
    >
      {image.status === 'ready' ? (
        <img
          className={styles.imageImg}
          src={image.url}
          alt={alt}
          draggable={false}
          onError={image.onError}
        />
      ) : image.status === 'loading' ? (
        <div className={styles.imageSkeleton} role="status" aria-label="Loading image" />
      ) : (
        <div className={styles.imageUnavailable} role="img" aria-label="Image unavailable">
          <Alert aria-hidden />
          <span>Image unavailable</span>
        </div>
      )}
      {editable && selected ? (
        <button
          type="button"
          className={styles.imageHandle}
          role="slider"
          aria-label="Resize image"
          aria-orientation="horizontal"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={shown}
          aria-valuetext={`${shown}% of the width`}
          onPointerDown={startResize}
          onKeyDown={onHandleKey}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/** The placeholder for an image that is uploading: a bar that fills as the bytes go. */
export function ImageUploadNodeView({ node }: NodeViewProps) {
  const uploadId = String(node.attrs.uploadId ?? '');
  const percent = useSyncExternalStore(uploadProgress.subscribe, () =>
    uploadProgress.get(uploadId),
  );
  return (
    <NodeViewWrapper className={styles.imageUpload} contentEditable={false}>
      <span>Uploading image...</span>
      <div
        className={styles.imageUploadTrack}
        role="progressbar"
        aria-label="Uploading image"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.imageUploadFill} style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
    </NodeViewWrapper>
  );
}
