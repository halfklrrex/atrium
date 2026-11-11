import {
  MCP_AUTHORIZE_CALLABLE,
  MCP_AUTH_REQUEST_INFO_CALLABLE,
  REVOKE_MCP_GRANT_CALLABLE,
  mcpAuthRequestInfoRequestSchema,
  mcpAuthRequestInfoResultSchema,
  mcpAuthorizeRequestSchema,
  mcpAuthorizeResultSchema,
  revokeMcpGrantRequestSchema,
  revokeMcpGrantResultSchema,
  type McpAuthRequestInfoRequest,
  type McpAuthRequestInfoResult,
  type McpAuthorizeRequest,
  type McpAuthorizeResult,
  type RevokeMcpGrantRequest,
  type RevokeMcpGrantResult,
  LIST_ACCOUNTS_CALLABLE,
  MANAGE_INBOX_THREAD_CALLABLE,
  SEND_INBOX_MESSAGE_CALLABLE,
  SET_ACCOUNT_STATUS_CALLABLE,
  manageInboxThreadRequestSchema,
  manageInboxThreadResultSchema,
  sendInboxMessageRequestSchema,
  sendInboxMessageResultSchema,
  listAccountsRequestSchema,
  listAccountsResultSchema,
  setAccountStatusRequestSchema,
  setAccountStatusResultSchema,
  type InboxErrorReason,
  type ManageInboxThreadRequest,
  type ManageInboxThreadResult,
  type SendInboxMessageRequest,
  type SendInboxMessageResult,
  type ListAccountsRequest,
  type ListAccountsResult,
  type SetAccountStatusRequest,
  type SetAccountStatusResult,
  ACCEPT_INVITE_CALLABLE,
  DELETE_UPDATE_ATTACHMENT_CALLABLE,
  FINALIZE_UPDATE_ATTACHMENT_CALLABLE,
  GET_UPDATE_ATTACHMENT_URL_CALLABLE,
  REQUEST_UPDATE_ATTACHMENT_UPLOAD_CALLABLE,
  deleteUpdateAttachmentRequestSchema,
  deleteUpdateAttachmentResultSchema,
  finalizeUpdateAttachmentRequestSchema,
  finalizeUpdateAttachmentResultSchema,
  getUpdateAttachmentUrlRequestSchema,
  getUpdateAttachmentUrlResultSchema,
  requestUpdateAttachmentUploadRequestSchema,
  requestUpdateAttachmentUploadResultSchema,
  type DeleteUpdateAttachmentRequest,
  type DeleteUpdateAttachmentResult,
  type FinalizeUpdateAttachmentRequest,
  type FinalizeUpdateAttachmentResult,
  type GetUpdateAttachmentUrlRequest,
  type GetUpdateAttachmentUrlResult,
  type RequestUpdateAttachmentUploadRequest,
  type RequestUpdateAttachmentUploadResult,
  CHANGE_COLUMN_TYPE_CALLABLE,
  BOOTSTRAP_USER_CALLABLE,
  CHANGE_MEMBER_ROLE_CALLABLE,
  CREATE_INVITE_CALLABLE,
  DECLINE_INVITE_CALLABLE,
  FINALIZE_DESCRIPTION_IMAGE_CALLABLE,
  GET_FORM_CALLABLE,
  SUBMIT_FORM_CALLABLE,
  GET_DESCRIPTION_IMAGE_URL_CALLABLE,
  GET_INVITE_STATUS_CALLABLE,
  LEAVE_BOARD_CALLABLE,
  LEAVE_WORKSPACE_CALLABLE,
  LIST_MY_INVITES_CALLABLE,
  REMOVE_MEMBER_CALLABLE,
  REVERT_COLUMN_TYPE_CALLABLE,
  REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE,
  REVOKE_INVITE_CALLABLE,
  SET_BOARD_ACCESS_CALLABLE,
  SET_BOARD_KIND_CALLABLE,
  acceptInviteResultSchema,
  boardSharingResultSchema,
  SET_DASHBOARD_ACCESS_CALLABLE,
  setDashboardAccessRequestSchema,
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
  getFormRequestSchema,
  getFormResultSchema,
  submitFormRequestSchema,
  submitFormResultSchema,
  getFileDownloadUrlRequestSchema,
  getFileDownloadUrlResultSchema,
  getInviteStatusResultSchema,
  leaveBoardRequestSchema,
  listMyInvitesResultSchema,
  okResultSchema,
  requestDescriptionImageUploadResultSchema,
  requestFileUploadRequestSchema,
  requestFileUploadResultSchema,
  revertColumnTypeRequestSchema,
  setBoardAccessRequestSchema,
  setBoardKindRequestSchema,
  revertColumnTypeResultSchema,
  startTimeTrackingRequestSchema,
  startTimeTrackingResultSchema,
  stopTimeTrackingRequestSchema,
  stopTimeTrackingResultSchema,
  type AcceptInviteRequest,
  type AcceptInviteResult,
  type BoardSharingResult,
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
  type GetFormRequest,
  type GetFormResult,
  type SubmitFormRequest,
  type SubmitFormResult,
  type GetFileDownloadUrlRequest,
  type GetFileDownloadUrlResult,
  type GetInviteStatusRequest,
  type GetInviteStatusResult,
  type LeaveBoardRequest,
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
  type SetBoardAccessRequest,
  type SetBoardKindRequest,
  type SetDashboardAccessRequest,
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

/** Board sharing (P4b): who can see and edit a board. Clients cannot write these fields directly. */
export const boardSharingCalls = {
  setAccess: validatedCallable<SetBoardAccessRequest, BoardSharingResult>(
    SET_BOARD_ACCESS_CALLABLE,
    (r) => setBoardAccessRequestSchema.parse(r),
    (d) => boardSharingResultSchema.parse(d),
  ),
  setKind: validatedCallable<SetBoardKindRequest, BoardSharingResult>(
    SET_BOARD_KIND_CALLABLE,
    (r) => setBoardKindRequestSchema.parse(r),
    (d) => boardSharingResultSchema.parse(d),
  ),
  leave: validatedCallable<LeaveBoardRequest, BoardSharingResult>(
    LEAVE_BOARD_CALLABLE,
    (r) => leaveBoardRequestSchema.parse(r),
    (d) => boardSharingResultSchema.parse(d),
  ),
};

/** Dashboard sharing: the dashboard's kind and who can see and edit it. Clients cannot write these fields directly. */
export const dashboardSharingCalls = {
  setAccess: validatedCallable<SetDashboardAccessRequest, BoardSharingResult>(
    SET_DASHBOARD_ACCESS_CALLABLE,
    (r) => setDashboardAccessRequestSchema.parse(r),
    (d) => boardSharingResultSchema.parse(d),
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

/** Site admin screen (ADMIN-2 callables; admin only, checked on the server). */
export const accountAdminCalls = {
  list: validatedCallable<ListAccountsRequest, ListAccountsResult>(
    LIST_ACCOUNTS_CALLABLE,
    (r) => listAccountsRequestSchema.parse(r),
    (d) => listAccountsResultSchema.parse(d),
  ),
  setStatus: validatedCallable<SetAccountStatusRequest, SetAccountStatusResult>(
    SET_ACCOUNT_STATUS_CALLABLE,
    (r) => setAccountStatusRequestSchema.parse(r),
    (d) => setAccountStatusResultSchema.parse(d),
  ),
};

/** Appeals and feedback Inbox (ADMIN-4): `send` is the sender side, `manage` the admin side. */
export const inboxCalls = {
  send: validatedCallable<SendInboxMessageRequest, SendInboxMessageResult>(
    SEND_INBOX_MESSAGE_CALLABLE,
    (r) => sendInboxMessageRequestSchema.parse(r),
    (d) => sendInboxMessageResultSchema.parse(d),
  ),
  manage: validatedCallable<ManageInboxThreadRequest, ManageInboxThreadResult>(
    MANAGE_INBOX_THREAD_CALLABLE,
    (r) => manageInboxThreadRequestSchema.parse(r),
    (d) => manageInboxThreadResultSchema.parse(d),
  ),
};

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

/** Files on item updates and replies (P4): signed upload and download URLs, all through callables. */
export const updateAttachmentCalls = {
  requestUpload: validatedCallable<
    RequestUpdateAttachmentUploadRequest,
    RequestUpdateAttachmentUploadResult
  >(
    REQUEST_UPDATE_ATTACHMENT_UPLOAD_CALLABLE,
    (r) => requestUpdateAttachmentUploadRequestSchema.parse(r),
    (d) => requestUpdateAttachmentUploadResultSchema.parse(d),
  ),
  finalize: validatedCallable<FinalizeUpdateAttachmentRequest, FinalizeUpdateAttachmentResult>(
    FINALIZE_UPDATE_ATTACHMENT_CALLABLE,
    (r) => finalizeUpdateAttachmentRequestSchema.parse(r),
    (d) => finalizeUpdateAttachmentResultSchema.parse(d),
  ),
  getUrl: validatedCallable<GetUpdateAttachmentUrlRequest, GetUpdateAttachmentUrlResult>(
    GET_UPDATE_ATTACHMENT_URL_CALLABLE,
    (r) => getUpdateAttachmentUrlRequestSchema.parse(r),
    (d) => getUpdateAttachmentUrlResultSchema.parse(d),
  ),
  remove: validatedCallable<DeleteUpdateAttachmentRequest, DeleteUpdateAttachmentResult>(
    DELETE_UPDATE_ATTACHMENT_CALLABLE,
    (r) => deleteUpdateAttachmentRequestSchema.parse(r),
    (d) => deleteUpdateAttachmentResultSchema.parse(d),
  ),
};

/** Public forms (P7): any signed-in user reads an open form and submits to it. */
export const formCalls = {
  get: validatedCallable<GetFormRequest, GetFormResult>(
    GET_FORM_CALLABLE,
    (r) => getFormRequestSchema.parse(r),
    (d) => getFormResultSchema.parse(d),
  ),
  submit: validatedCallable<SubmitFormRequest, SubmitFormResult>(
    SUBMIT_FORM_CALLABLE,
    (r) => submitFormRequestSchema.parse(r),
    (d) => submitFormResultSchema.parse(d),
  ),
};

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

/** Hosted MCP connector (OPS4): the consent page and the Connected apps card. */
export const mcpCalls = {
  authRequestInfo: async (
    request: McpAuthRequestInfoRequest,
  ): Promise<McpAuthRequestInfoResult> => {
    const { data } = await httpsCallable<McpAuthRequestInfoRequest, unknown>(
      functions,
      MCP_AUTH_REQUEST_INFO_CALLABLE,
    )(mcpAuthRequestInfoRequestSchema.parse(request));
    return mcpAuthRequestInfoResultSchema.parse(data);
  },
  authorize: async (request: McpAuthorizeRequest): Promise<McpAuthorizeResult> => {
    const { data } = await httpsCallable<McpAuthorizeRequest, unknown>(
      functions,
      MCP_AUTHORIZE_CALLABLE,
    )(mcpAuthorizeRequestSchema.parse(request));
    return mcpAuthorizeResultSchema.parse(data);
  },
  revokeGrant: async (request: RevokeMcpGrantRequest): Promise<RevokeMcpGrantResult> => {
    const { data } = await httpsCallable<RevokeMcpGrantRequest, unknown>(
      functions,
      REVOKE_MCP_GRANT_CALLABLE,
    )(revokeMcpGrantRequestSchema.parse(request));
    return revokeMcpGrantResultSchema.parse(data);
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

const ACCOUNT_NOT_APPROVED_REASON: InboxErrorReason = 'account-not-approved';

/** Message for a failed callable: the server explains refusals, anything else gets the fallback. */
export function describeCallableError(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message;
  // Every callable refuses accounts that are not approved (ADMIN-4 PR3); the pages behind
  // `RequireAuth` should never get here, so this is only a safety net.
  const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
  if (reason === ACCOUNT_NOT_APPROVED_REASON) return "Your account isn't approved yet.";
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
