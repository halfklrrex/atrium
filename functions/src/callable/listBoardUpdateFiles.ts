import {
  listBoardUpdateFilesRequestSchema,
  listBoardUpdateFilesResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminUpdateFilesStore, db } from '../lib/admin';
import { listBoardUpdateFiles as listFiles } from '../lib/update-files';

export const listBoardUpdateFiles = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = listBoardUpdateFilesRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid listBoardUpdateFiles request.',
      parsed.error.issues,
    );
  }
  const result = await listFiles(adminUpdateFilesStore(db()), parsed.data, actor.uid);
  return listBoardUpdateFilesResultSchema.parse(result);
});
