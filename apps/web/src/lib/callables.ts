import {
  ACCEPT_INVITE_CALLABLE,
  CHANGE_COLUMN_TYPE_CALLABLE,
  BOOTSTRAP_USER_CALLABLE,
  CHANGE_MEMBER_ROLE_CALLABLE,
  CREATE_INVITE_CALLABLE,
  DECLINE_INVITE_CALLABLE,
  FINALIZE_DESCRIPTION_IMAGE_CALLABLE,
  GET_DESCRIPTION_IMAGE_URL_CALLABLE,
  GET_INVITE_STATUS_CALLABLE,
  LEAVE_WORKSPACE_CALLABLE,
  LIST_MY_INVITES_CALLABLE,
  REMOVE_MEMBER_CALLABLE,
  REVERT_COLUMN_TYPE_CALLABLE,
  REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE,
  REVOKE_INVITE_CALLABLE,
  acceptInviteResultSchema,
  bootstrapUserResultSchema,
  changeColumnTypeRequestSchema,
  changeColumnTypeResultSchema,
  clickButtonRequestSchema,
  clickButtonResultSchema,
  createInviteResultSchema,
  deleteFileAttachmentRequestSchema,
  deleteFileAttachmentResultSchema,
  finalizeDescriptionImageResultSchema,
  finalizeFileUploadRequestSchema,
  finalizeFileUploadResultSchema,
  getDescriptionImageUrlResultSchema,
  getFileDownloadUrlRequestSchema,
  getFileDownloadUrlResultSchema,
  getInviteStatusResultSchema,
  listMyInvitesResultSchema,
  okResultSchema,
  requestDescriptionImageUploadResultSchema,
  requestFileUploadRequestSchema,
  requestFileUploadResultSchema,
  revertColumnTypeRequestSchema,
  revertColumnTypeResultSchema,
  startTimeTrackingRequestSchema,
  startTimeTrackingResultSchema,
  stopTimeTrackingRequestSchema,
  stopTimeTrackingResultSchema,
  type AcceptInviteRequest,
  type AcceptInviteResult,
  type BootstrapUserRequest,
  type BootstrapUserResult,
  type ChangeColumnTypeRequest,
  type ChangeColumnTypeResult,
  type ChangeMemberRoleRequest,
  type ClickButtonRequest,
  type ClickButtonResult,
  type CreateInviteRequest,
  type CreateInviteResult,
  type DeclineInviteRequest,
  type DeleteFileAttachmentRequest,
  type DeleteFileAttachmentResult,
  type FinalizeDescriptionImageRequest,
  type FinalizeDescriptionImageResult,
  type FinalizeFileUploadRequest,
  type FinalizeFileUploadResult,
  type GetDescriptionImageUrlRequest,
  type GetDescriptionImageUrlResult,
  type GetFileDownloadUrlRequest,
  type GetFileDownloadUrlResult,
  type GetInviteStatusRequest,
  type GetInviteStatusResult,
  type LeaveWorkspaceRequest,
  type ListMyInvitesRequest,
  type ListMyInvitesResult,
  type OkResult,
  type RemoveMemberRequest,
  type RequestDescriptionImageUploadRequest,
  type RequestDescriptionImageUploadResult,
  type RequestFileUploadRequest,
  type RequestFileUploadResult,
  type RevertColumnTypeRequest,
  type RevertColumnTypeResult,
  type RevokeInviteRequest,
  type StartTimeTrackingRequest,
  type StartTimeTrackingResult,
  type StopTimeTrackingRequest,
  type StopTimeTrackingResult,
} from '@atrium/shared';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/** Ensures `users/{uid}` and a workspace exist (idempotent); returns the workspace to open. */
export async function callBootstrapUser(): Promise<BootstrapUserResult> {
  const hints: BootstrapUserRequest = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    locale: navigator.language || undefined,
  };
  const call = httpsCallable<BootstrapUserRequest, unknown>(functions, BOOTSTRAP_USER_CALLABLE);
  const { data } = await call(hints);
  return bootstrapUserResultSchema.parse(data);
}

// ---------------------------------------------------------------------------------------------
// Membership (P4a)
// ---------------------------------------------------------------------------------------------

function callable<Req, Res>(name: string, parse: (data: unknown) => Res) {
  return async (request: Req): Promise<Res> => {
    const { data } = await httpsCallable<Req, unknown>(functions, name)(request);
    return parse(data);
  };
}

export const membershipCalls = {
  createInvite: callable<CreateInviteRequest, CreateInviteResult>(CREATE_INVITE_CALLABLE, (d) =>
    createInviteResultSchema.parse(d),
  ),
  revokeInvite: callable<RevokeInviteRequest, OkResult>(REVOKE_INVITE_CALLABLE, (d) =>
    okResultSchema.parse(d),
  ),
  listMyInvites: callable<ListMyInvitesRequest, ListMyInvitesResult>(
    LIST_MY_INVITES_CALLABLE,
    (d) => listMyInvitesResultSchema.parse(d),
  ),
  getInviteStatus: callable<GetInviteStatusRequest, GetInviteStatusResult>(
    GET_INVITE_STATUS_CALLABLE,
    (d) => getInviteStatusResultSchema.parse(d),
  ),
  acceptInvite: callable<AcceptInviteRequest, AcceptInviteResult>(ACCEPT_INVITE_CALLABLE, (d) =>
    acceptInviteResultSchema.parse(d),
  ),
  declineInvite: callable<DeclineInviteRequest, OkResult>(DECLINE_INVITE_CALLABLE, (d) =>
    okResultSchema.parse(d),
  ),
  changeMemberRole: callable<ChangeMemberRoleRequest, OkResult>(CHANGE_MEMBER_ROLE_CALLABLE, (d) =>
    okResultSchema.parse(d),
  ),
  removeMember: callable<RemoveMemberRequest, OkResult>(REMOVE_MEMBER_CALLABLE, (d) =>
    okResultSchema.parse(d),
  ),
  leaveWorkspace: callable<LeaveWorkspaceRequest, OkResult>(LEAVE_WORKSPACE_CALLABLE, (d) =>
    okResultSchema.parse(d),
  ),
};

/** Description images (P1 editor pass 2): signed upload and download URLs, all through callables. */
export const descriptionImageCalls = {
  requestUpload: callable<
    RequestDescriptionImageUploadRequest,
    RequestDescriptionImageUploadResult
  >(REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE, (d) =>
    requestDescriptionImageUploadResultSchema.parse(d),
  ),
  finalize: callable<FinalizeDescriptionImageRequest, FinalizeDescriptionImageResult>(
    FINALIZE_DESCRIPTION_IMAGE_CALLABLE,
    (d) => finalizeDescriptionImageResultSchema.parse(d),
  ),
  getUrl: callable<GetDescriptionImageUrlRequest, GetDescriptionImageUrlResult>(
    GET_DESCRIPTION_IMAGE_URL_CALLABLE,
    (d) => getDescriptionImageUrlResultSchema.parse(d),
  ),
};

// ---------------------------------------------------------------------------------------------
// Server-managed column callables (P2: button, time tracking, files)
// ---------------------------------------------------------------------------------------------

function validatedCallable<Req, Res>(
  name: string,
  parseReq: (req: Req) => Req,
  parseRes: (data: unknown) => Res,
) {
  return async (request: Req): Promise<Res> => {
    const validReq = parseReq(request);
    const { data } = await httpsCallable<Req, unknown>(functions, name)(validReq);
    return parseRes(data);
  };
}

export const callClickButton = validatedCallable<ClickButtonRequest, ClickButtonResult>(
  'clickButton',
  (r) => clickButtonRequestSchema.parse(r),
  (d) => clickButtonResultSchema.parse(d),
);

export const callStartTimeTracking = validatedCallable<
  StartTimeTrackingRequest,
  StartTimeTrackingResult
>(
  'startTimeTracking',
  (r) => startTimeTrackingRequestSchema.parse(r),
  (d) => startTimeTrackingResultSchema.parse(d),
);

export const callStopTimeTracking = validatedCallable<
  StopTimeTrackingRequest,
  StopTimeTrackingResult
>(
  'stopTimeTracking',
  (r) => stopTimeTrackingRequestSchema.parse(r),
  (d) => stopTimeTrackingResultSchema.parse(d),
);

export const callRequestFileUpload = validatedCallable<
  RequestFileUploadRequest,
  RequestFileUploadResult
>(
  'requestFileUpload',
  (r) => requestFileUploadRequestSchema.parse(r),
  (d) => requestFileUploadResultSchema.parse(d),
);

export const callFinalizeFileUpload = validatedCallable<
  FinalizeFileUploadRequest,
  FinalizeFileUploadResult
>(
  'finalizeFileUpload',
  (r) => finalizeFileUploadRequestSchema.parse(r),
  (d) => finalizeFileUploadResultSchema.parse(d),
);

export const callGetFileDownloadUrl = validatedCallable<
  GetFileDownloadUrlRequest,
  GetFileDownloadUrlResult
>(
  'getFileDownloadUrl',
  (r) => getFileDownloadUrlRequestSchema.parse(r),
  (d) => getFileDownloadUrlResultSchema.parse(d),
);

export const callDeleteFileAttachment = validatedCallable<
  DeleteFileAttachmentRequest,
  DeleteFileAttachmentResult
>(
  'deleteFileAttachment',
  (r) => deleteFileAttachmentRequestSchema.parse(r),
  (d) => deleteFileAttachmentResultSchema.parse(d),
);

export const columnActionCalls = {
  clickButton: callClickButton,
  startTimeTracking: callStartTimeTracking,
  stopTimeTracking: callStopTimeTracking,
};

export const fileCalls = {
  requestUpload: callRequestFileUpload,
  finalizeUpload: callFinalizeFileUpload,
  getDownloadUrl: callGetFileDownloadUrl,
  deleteAttachment: callDeleteFileAttachment,
};

/**
 * Column type changes (P2). A migration of a big board can run for minutes, so these calls wait up to
 * the Function's own timeout (9 minutes) instead of the SDK's 70 seconds.
 */
const MIGRATION_CALL_TIMEOUT_MS = 540_000;

export const columnTypeCalls = {
  change: async (request: ChangeColumnTypeRequest): Promise<ChangeColumnTypeResult> => {
    const { data } = await httpsCallable<ChangeColumnTypeRequest, unknown>(
      functions,
      CHANGE_COLUMN_TYPE_CALLABLE,
      { timeout: MIGRATION_CALL_TIMEOUT_MS },
    )(changeColumnTypeRequestSchema.parse(request));
    return changeColumnTypeResultSchema.parse(data);
  },
  revert: async (request: RevertColumnTypeRequest): Promise<RevertColumnTypeResult> => {
    const { data } = await httpsCallable<RevertColumnTypeRequest, unknown>(
      functions,
      REVERT_COLUMN_TYPE_CALLABLE,
      { timeout: MIGRATION_CALL_TIMEOUT_MS },
    )(revertColumnTypeRequestSchema.parse(request));
    return revertColumnTypeResultSchema.parse(data);
  },
};

const FRIENDLY_CALLABLE_CODE_MESSAGES: Record<string, string> = {
  'functions/permission-denied': 'You do not have permission to perform this action.',
  'permission-denied': 'You do not have permission to perform this action.',
  'functions/failed-precondition': 'This action cannot be completed in the current state.',
  'failed-precondition': 'This action cannot be completed in the current state.',
  'functions/resource-exhausted':
    'Rate limit or quota reached. Please wait a moment and try again.',
  'resource-exhausted': 'Rate limit or quota reached. Please wait a moment and try again.',
};

/** Message for a failed callable: the server explains refusals, anything else gets the fallback. */
export function describeCallableError(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message;
  const explained = [
    'functions/permission-denied',
    'permission-denied',
    'functions/failed-precondition',
    'failed-precondition',
    'functions/already-exists',
    'already-exists',
    'functions/resource-exhausted',
    'resource-exhausted',
    'functions/invalid-argument',
    'invalid-argument',
    'functions/not-found',
    'not-found',
  ];
  if (explained.includes(code)) {
    if (message && message !== code && message !== 'INTERNAL') return message;
    if (FRIENDLY_CALLABLE_CODE_MESSAGES[code]) return FRIENDLY_CALLABLE_CODE_MESSAGES[code]!;
  }
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'You appear to be offline. Try again in a moment.';
  }
  return fallback;
}
