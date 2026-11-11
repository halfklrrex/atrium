// @atrium/mcp-core: the Atrium MCP connector's tool logic, free of any transport. The local stdio
// server (`scripts/mcp/atrium-mcp.mjs`) and the hosted Function both build a service from a Firestore
// client and an actor, then register `defineTools(service)`. See docs/mcp-connector.md.
export { McpUserError, ID_PATTERN, assertId } from './errors.mjs';
export { createService, MAX_ITEMS_PER_CALL } from './service.mjs';
export { defineTools } from './tools.mjs';
export { CREATABLE_COLUMN_TYPES, convertCellValue, readableCell, toValidCell } from './values.mjs';
export { findColumn, findGroup, sortedByPosition } from './refs.mjs';
export {
  LABEL_COLORS,
  addLabelsToSettings,
  buildBoardDoc,
  buildColumn,
  buildColumnSettings,
  buildGroup,
  buildItemDoc,
  buildItemPatch,
  buildReplyDoc,
  buildUpdateDoc,
  newDocId,
  newSlugId,
  positionAfter,
  positionRightAfter,
  resolveColor,
  ts,
  validSettings,
} from './builders.mjs';
export {
  MAX_MARKDOWN_CHARS,
  appendDoc,
  docToMarkdown,
  markdownToDoc,
  richNodeTypes,
  toStoredDescription,
} from './description.mjs';
export { buildRichBody, memberResolver } from './updates.mjs';
