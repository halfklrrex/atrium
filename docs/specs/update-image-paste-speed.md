# Image paste into updates and replies: speed

Owner feedback (2026-11-16): pasting an image into an update or reply "takes a little longer than I'd like; monday is a lot quicker".

## Path from paste to a visible image (before)

1. `handlePaste` runs `uploadDescriptionImages` (item-view/editor-images.ts). Cost: none.
2. A text-only placeholder ("Uploading image...", progress bar) is inserted. **The user sees no picture.** The picked file was never shown.
3. `requestUpload` callable (3 Firestore reads, then signs an upload URL). One round trip, plus a cold start when the function is idle.
4. PUT of the original file to Storage. No client-side processing exists (no canvas, no resize, no re-encode, no EXIF step), so there was nothing to skip: the file goes up as is, up to 10 MB. Time is bytes / uplink.
5. `finalize` callable (3 Firestore reads plus a Storage metadata read). Second round trip and cold-start exposure.
6. Placeholder is swapped for the image node. The node view then calls the `getUrl` callable (3 Firestore reads plus signing), a **third round trip**, and only then loads the bytes again from Storage as a download. A skeleton shows until it finishes.
7. After Post, the feed's `RichImage` resolves the same URL; the per-fileId cache already makes that free.

Several images were also processed one after another (`for ... await`), so N images cost N times the whole chain.

## Findings

| Step                                    | Cost                                                                         | Verdict                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Client processing                       | none                                                                         | Not a bottleneck.                                                         |
| No instant preview                      | perceived latency = steps 3 to 6 (three callables plus upload plus download) | **Main cause of "slow" feeling.** monday shows the local picture at once. |
| Re-download via `getUrl` after finalize | one extra callable plus a full download of a file the browser already has    | **Real avoidable cost.**                                                  |
| Sequential multi-image                  | N times the chain                                                            | **Avoidable.**                                                            |
| Three callables, `minInstances` 0       | each can hit a cold start (typically 1 to 3 s on Functions 2nd gen)          | **Server side, not changed here.** Recommendation below.                  |
| Rules                                   | not involved on this path                                                    | n/a                                                                       |

Measurements were not taken (no production access from the sandbox); the per-step costs above are from reading the code and the usual callable latency.

## Changes (client only, composer pipeline)

- **Instant local preview:** an object URL is made from the picked file at once and shown in the upload placeholder (dimmed, with the progress bar). It is revoked on failure.
- **No getUrl round trip after upload:** when finalize succeeds, the local object URL is seeded into the signed-URL cache for that fileId (`seedDescriptionImageUrl`). The image node, and the feed after Post, render it immediately. The existing refresh timer replaces it with the real signed URL before the seed expires, and the object URL is revoked later; an image error falls back to the normal refetch.
- **Parallel uploads:** all placeholders are inserted up front in pick order, then the uploads run concurrently (`Promise.all`).
- **Re-encoding:** nothing to skip; the original is uploaded untouched.
- Post is not blocked by anything new. An unfinished placeholder still keeps the post body empty or stripped as before (`stripTransientNodes`), unchanged.

The description editor shares this pipeline, so it gets the same speed-up.

## Recommendations (not done: server side or cost)

1. Set `minInstances: 1` on `requestDescriptionImageUpload`, `finalizeDescriptionImage` and `getDescriptionImageUrl` (small recurring cost on Blaze) to remove cold starts. **Owner decision (2026-11-16): not doing this; accept the cold start.**
2. Optionally merge request and finalize, or let finalize run in the background and send the post as soon as the PUT ends (needs a rules and server design: the post must not reference an unfinalized file).
3. Optional later: downscale very large screenshots client side before upload (a 10 MB PNG is slow on slow uplinks). Not done: it changes stored bytes and needs a quality decision.

## Tests

`apps/web/src/components/item-card/ComposerImages.test.tsx`: local preview shows during upload and `getUrl` is not called after finalize; two pasted images request their uploads in parallel and both land.
