// Limits and role lists shared by the service modules and the tool catalogue.
export const MAX_ITEMS_PER_CALL = 50;
export const MAX_MOVED_SUBITEMS = 200;
export const EDIT_ROLES = ['owner', 'editor'];
/** Workspace roles that may create boards (rules: `canCreateInWs`). */
export const CREATE_BOARD_ROLES = ['owner', 'admin', 'member'];
