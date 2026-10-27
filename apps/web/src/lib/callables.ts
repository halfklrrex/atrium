import {
  ACCEPT_INVITE_CALLABLE,
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
  REQUEST_DESCRIPTION_IMAGE_UPLOAD_CALLABLE,
  REVOKE_INVITE_CALLABLE,
  acceptInviteResultSchema,
  bootstrapUserResultSchema,
  createInviteResultSchema,
  finalizeDescriptionImageResultSchema,
  getDescriptionImageUrlResultSchema,
  getInviteStatusResultSchema,
  listMyInvitesResultSchema,
  okResultSchema,
  requestDescriptionImageUploadResultSchema,
  type AcceptInviteRequest,
  type AcceptInviteResult,
  type BootstrapUserRequest,
  type BootstrapUserResult,
  type ChangeMemberRoleRequest,
  type CreateInviteRequest,
  type CreateInviteResult,
  type DeclineInviteRequest,
  type FinalizeDescriptionImageRequest,
  type FinalizeDescriptionImageResult,
  type GetDescriptionImageUrlRequest,
  type GetDescriptionImageUrlResult,
  type GetInviteStatusRequest,
  type GetInviteStatusResult,
  type LeaveWorkspaceRequest,
  type ListMyInvitesRequest,
  type ListMyInvitesResult,
  type OkResult,
  type RemoveMemberRequest,
  type RequestDescriptionImageUploadRequest,
  type RequestDescriptionImageUploadResult,
  type RevokeInviteRequest,
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

/** Message for a failed callable: the server explains refusals, anything else gets the fallback. */
export function describeCallableError(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message;
  const explained = [
    'functions/permission-denied',
    'functions/failed-precondition',
    'functions/already-exists',
    'functions/resource-exhausted',
    'functions/invalid-argument',
    'functions/not-found',
  ];
  if (explained.includes(code) && message) return message;
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'You appear to be offline. Try again in a moment.';
  }
  return fallback;
}
