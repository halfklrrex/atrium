import {
  SET_MY_PROFILE_CALLABLE,
  setMyProfileResultSchema,
  type SetMyProfileRequest,
  type SetMyProfileResult,
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
  CREATE_API_TOKEN_CALLABLE,
  REVOKE_API_TOKEN_CALLABLE,
  CREATE_WEBHOOK_CALLABLE,
  DELETE_WEBHOOK_CALLABLE,
  ROTATE_WEBHOOK_SECRET_CALLABLE,
  TEST_WEBHOOK_CALLABLE,
  UPDATE_WEBHOOK_CALLABLE,
  CREATE_INCOMING_HOOK_CALLABLE,
  DELETE_INCOMING_HOOK_CALLABLE,
  LIST_WEBHOOK_DELIVERIES_CALLABLE,
  ROTATE_INCOMING_HOOK_SECRET_CALLABLE,
  UPDATE_INCOMING_HOOK_CALLABLE,
  createIncomingHookRequestSchema,
  createIncomingHookResultSchema,
  deleteIncomingHookRequestSchema,
  deleteIncomingHookResultSchema,
  listWebhookDeliveriesRequestSchema,
  listWebhookDeliveriesResultSchema,
  rotateIncomingHookSecretRequestSchema,
  rotateIncomingHookSecretResultSchema,
  updateIncomingHookRequestSchema,
  updateIncomingHookResultSchema,
  type CreateIncomingHookRequest,
  type CreateIncomingHookResult,
  type DeleteIncomingHookRequest,
  type DeleteIncomingHookResult,
  type ListWebhookDeliveriesRequest,
  type ListWebhookDeliveriesResult,
  type RotateIncomingHookSecretRequest,
  type RotateIncomingHookSecretResult,
  type UpdateIncomingHookRequest,
  type UpdateIncomingHookResult,
  createWebhookRequestSchema,
  createWebhookResultSchema,
  deleteWebhookRequestSchema,
  deleteWebhookResultSchema,
  rotateWebhookSecretRequestSchema,
  rotateWebhookSecretResultSchema,
  testWebhookRequestSchema,
  testWebhookResultSchema,
  updateWebhookRequestSchema,
  updateWebhookResultSchema,
  type CreateWebhookRequest,
  type CreateWebhookResult,
  type DeleteWebhookRequest,
  type DeleteWebhookResult,
  type RotateWebhookSecretRequest,
  type RotateWebhookSecretResult,
  type TestWebhookRequest,
  type TestWebhookResult,
  type UpdateWebhookRequest,
  type UpdateWebhookResult,
  createApiTokenRequestSchema,
  createApiTokenResultSchema,
  revokeApiTokenRequestSchema,
  revokeApiTokenResultSchema,
  type CreateApiTokenRequest,
  type CreateApiTokenResult,
  type RevokeApiTokenRequest,
  type RevokeApiTokenResult,
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
  LIST_BOARD_UPDATE_FILES_CALLABLE,
  listBoardUpdateFilesRequestSchema,
  listBoardUpdateFilesResultSchema,
  type ListBoardUpdateFilesRequest,
  type ListBoardUpdateFilesResult,
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
  FINALIZE_DOC_IMAGE_CALLABLE,
  GET_FORM_CALLABLE,
  SUBMIT_FORM_CALLABLE,
  GET_DESCRIPTION_IMAGE_URL_CALLABLE,
  GET_DOC_IMAGE_URL_CALLABLE,
  GET_INVITE_STATUS_CALLABLE,
  LEAVE_BOARD_CALLABLE,
  LEAVE_WORKSPACE_CALLABLE,
  LIST_MY_INVITES_CALLABLE,
  REMOVE_MEMBER_CALLABLE,
  REVERT_COLUMN_TYPE_CALLABLE,
  REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE,
  REQUEST_DOC_IMAGE_UPLOAD_CALLABLE,
  REVOKE_INVITE_CALLABLE,
  SET_BOARD_ACCESS_CALLABLE,
  SET_BOARD_KIND_CALLABLE,
  acceptInviteResultSchema,
  boardSharingResultSchema,
  SET_DASHBOARD_ACCESS_CALLABLE,
  SET_DOC_ACCESS_CALLABLE,
  setDashboardAccessRequestSchema,
  setDocAccessRequestSchema,
  bootstrapUserResultSchema,
  changeColumnTypeRequestSchema,
  changeColumnTypeResultSchema,
  clickButtonRequestSchema,
  clickButtonResultSchema,
  createInviteResultSchema,
  deleteFileAttachmentRequestSchema,
  deleteFileAttachmentResultSchema,
  finalizeDescriptionImageResultSchema,
  finalizeDocImageResultSchema,
  finalizeFileUploadRequestSchema,
  finalizeFileUploadResultSchema,
  getDescriptionImageUrlResultSchema,
  getDocImageUrlResultSchema,
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
  requestDocImageUploadResultSchema,
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
  type FinalizeDocImageRequest,
  type FinalizeDocImageResult,
  type FinalizeFileUploadRequest,
  type FinalizeFileUploadResult,
  type GetDescriptionImageUrlRequest,
  type GetDescriptionImageUrlResult,
  type GetDocImageUrlRequest,
  type GetDocImageUrlResult,
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
  type RequestDocImageUploadRequest,
  type RequestDocImageUploadResult,
  type RequestFileUploadRequest,
  type RequestFileUploadResult,
  type RevertColumnTypeRequest,
  type RevertColumnTypeResult,
  type RevokeInviteRequest,
  type SetBoardAccessRequest,
  type SetBoardKindRequest,
  type SetDashboardAccessRequest,
  type SetDocAccessRequest,
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

/** Profile fields (TEAMS PR 4): saved and copied to every workspace by the callable. */
export const profileCalls = {
  setMyProfile: callable<SetMyProfileRequest, SetMyProfileResult>(SET_MY_PROFILE_CALLABLE, (d) =>
    setMyProfileResultSchema.parse(d),
  ),
};

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

/** Doc sharing: the doc's kind and who can see and edit it. Clients cannot write these fields directly. */
export const docSharingCalls = {
  setAccess: validatedCallable<SetDocAccessRequest, BoardSharingResult>(
    SET_DOC_ACCESS_CALLABLE,
    (r) => setDocAccessRequestSchema.parse(r),
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

/** Doc images (P7 PR 5): the same three callables, scoped to a doc. */
export const docImageCalls = {
  requestUpload: callable<RequestDocImageUploadRequest, RequestDocImageUploadResult>(
    REQUEST_DOC_IMAGE_UPLOAD_CALLABLE,
    (d) => requestDocImageUploadResultSchema.parse(d),
  ),
  finalize: callable<FinalizeDocImageRequest, FinalizeDocImageResult>(
    FINALIZE_DOC_IMAGE_CALLABLE,
    (d) => finalizeDocImageResultSchema.parse(d),
  ),
  getUrl: callable<GetDocImageUrlRequest, GetDocImageUrlResult>(GET_DOC_IMAGE_URL_CALLABLE, (d) =>
    getDocImageUrlResultSchema.parse(d),
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
  /** File details of every update and reply on a board (Files view); no download links. */
  listForBoard: validatedCallable<ListBoardUpdateFilesRequest, ListBoardUpdateFilesResult>(
    LIST_BOARD_UPDATE_FILES_CALLABLE,
    (r) => listBoardUpdateFilesRequestSchema.parse(r),
    (d) => listBoardUpdateFilesResultSchema.parse(d),
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

/** Settings -> API tokens (P8): personal access tokens. The token is returned once, at creation. */
export const apiTokenCalls = {
  create: async (request: CreateApiTokenRequest): Promise<CreateApiTokenResult> => {
    const { data } = await httpsCallable<CreateApiTokenRequest, unknown>(
      functions,
      CREATE_API_TOKEN_CALLABLE,
    )(createApiTokenRequestSchema.parse(request));
    return createApiTokenResultSchema.parse(data);
  },
  revoke: async (request: RevokeApiTokenRequest): Promise<RevokeApiTokenResult> => {
    const { data } = await httpsCallable<RevokeApiTokenRequest, unknown>(
      functions,
      REVOKE_API_TOKEN_CALLABLE,
    )(revokeApiTokenRequestSchema.parse(request));
    return revokeApiTokenResultSchema.parse(data);
  },
};

/** Board -> Integrations (P8): outgoing webhooks, board owners only. The secret is returned once. */
export const webhookCalls = {
  create: async (request: CreateWebhookRequest): Promise<CreateWebhookResult> => {
    const { data } = await httpsCallable<CreateWebhookRequest, unknown>(
      functions,
      CREATE_WEBHOOK_CALLABLE,
    )(createWebhookRequestSchema.parse(request));
    return createWebhookResultSchema.parse(data);
  },
  update: async (request: UpdateWebhookRequest): Promise<UpdateWebhookResult> => {
    const { data } = await httpsCallable<UpdateWebhookRequest, unknown>(
      functions,
      UPDATE_WEBHOOK_CALLABLE,
    )(updateWebhookRequestSchema.parse(request));
    return updateWebhookResultSchema.parse(data);
  },
  remove: async (request: DeleteWebhookRequest): Promise<DeleteWebhookResult> => {
    const { data } = await httpsCallable<DeleteWebhookRequest, unknown>(
      functions,
      DELETE_WEBHOOK_CALLABLE,
    )(deleteWebhookRequestSchema.parse(request));
    return deleteWebhookResultSchema.parse(data);
  },
  rotateSecret: async (request: RotateWebhookSecretRequest): Promise<RotateWebhookSecretResult> => {
    const { data } = await httpsCallable<RotateWebhookSecretRequest, unknown>(
      functions,
      ROTATE_WEBHOOK_SECRET_CALLABLE,
    )(rotateWebhookSecretRequestSchema.parse(request));
    return rotateWebhookSecretResultSchema.parse(data);
  },
  test: async (request: TestWebhookRequest): Promise<TestWebhookResult> => {
    const { data } = await httpsCallable<TestWebhookRequest, unknown>(
      functions,
      TEST_WEBHOOK_CALLABLE,
    )(testWebhookRequestSchema.parse(request));
    return testWebhookResultSchema.parse(data);
  },
  /** The most recent deliveries of a webhook (never payloads or the secret). */
  listDeliveries: async (
    request: ListWebhookDeliveriesRequest,
  ): Promise<ListWebhookDeliveriesResult> => {
    const { data } = await httpsCallable<ListWebhookDeliveriesRequest, unknown>(
      functions,
      LIST_WEBHOOK_DELIVERIES_CALLABLE,
    )(listWebhookDeliveriesRequestSchema.parse(request));
    return listWebhookDeliveriesResultSchema.parse(data);
  },
};

/** Board -> Integrations (P8): incoming webhooks, board owners only. The URL (with the secret) is returned once. */
export const incomingHookCalls = {
  create: async (request: CreateIncomingHookRequest): Promise<CreateIncomingHookResult> => {
    const { data } = await httpsCallable<CreateIncomingHookRequest, unknown>(
      functions,
      CREATE_INCOMING_HOOK_CALLABLE,
    )(createIncomingHookRequestSchema.parse(request));
    return createIncomingHookResultSchema.parse(data);
  },
  update: async (request: UpdateIncomingHookRequest): Promise<UpdateIncomingHookResult> => {
    const { data } = await httpsCallable<UpdateIncomingHookRequest, unknown>(
      functions,
      UPDATE_INCOMING_HOOK_CALLABLE,
    )(updateIncomingHookRequestSchema.parse(request));
    return updateIncomingHookResultSchema.parse(data);
  },
  rotateSecret: async (
    request: RotateIncomingHookSecretRequest,
  ): Promise<RotateIncomingHookSecretResult> => {
    const { data } = await httpsCallable<RotateIncomingHookSecretRequest, unknown>(
      functions,
      ROTATE_INCOMING_HOOK_SECRET_CALLABLE,
    )(rotateIncomingHookSecretRequestSchema.parse(request));
    return rotateIncomingHookSecretResultSchema.parse(data);
  },
  remove: async (request: DeleteIncomingHookRequest): Promise<DeleteIncomingHookResult> => {
    const { data } = await httpsCallable<DeleteIncomingHookRequest, unknown>(
      functions,
      DELETE_INCOMING_HOOK_CALLABLE,
    )(deleteIncomingHookRequestSchema.parse(request));
    return deleteIncomingHookResultSchema.parse(data);
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
