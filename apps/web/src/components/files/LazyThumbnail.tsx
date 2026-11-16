import { Icon } from '@vibe/core';
import { useEffect, useRef, useState } from 'react';
import { attachmentIcon, isImageType } from '../item-card/update-attachments';
import { resolveUrl, getCachedUrl, type SignedUrl } from './file-url-cache';

export interface LazyThumbnailProps {
  /** Identifies the file for the URL cache (for example `boardId/itemId/columnId/fileId`). */
  cacheKey: string;
  mimeType: string;
  /** Fetches a signed URL; called at most once per cache lifetime, and only for images. */
  fetchUrl: () => Promise<SignedUrl>;
  /** Class of the wrapper (its size and shape). */
  className?: string;
  /** Class of the image. */
  imageClassName?: string;
  /** Pixel size of the type icon. */
  iconSize?: number;
}

/**
 * A thumbnail that fetches its URL only once it scrolls into view. Non-images and failures show
 * the file type's icon. Fetches share a cache and run at most four at a time.
 */
export function LazyThumbnail({
  cacheKey,
  mimeType,
  fetchUrl,
  className,
  imageClassName,
  iconSize = 16,
}: LazyThumbnailProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isImage = isImageType(mimeType);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState<string | null>(() => (isImage ? getCachedUrl(cacheKey) : null));

  useEffect(() => {
    const node = ref.current;
    if (visible || !node || !isImage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, isImage]);

  useEffect(() => {
    if (!visible || !isImage) return;
    let cancelled = false;
    resolveUrl(cacheKey, fetchUrl).then(
      (resolved) => {
        if (!cancelled) setUrl(resolved);
      },
      () => undefined, // the type icon stays
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fetch per file (the key names it)
  }, [visible, isImage, cacheKey]);

  return (
    <span ref={ref} className={className}>
      {url ? (
        <img className={imageClassName} src={url} alt="" onError={() => setUrl(null)} />
      ) : (
        <Icon icon={attachmentIcon(mimeType)} size={iconSize} aria-hidden />
      )}
    </span>
  );
}
