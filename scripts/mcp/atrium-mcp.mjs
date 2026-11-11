// Atrium MCP connector: a local stdio MCP server that lets Claude create and edit boards, groups,
// columns, items and updates in the live Atrium, as one Atrium user. Nothing is deployed. The tool
// logic lives in @atrium/mcp-core (shared with the hosted connector). See docs/mcp-connector.md.
//
// Run it through tsx (it imports the TypeScript in @atrium/shared), normally via `claude mcp add`:
//   pnpm mcp          (needs ATRIUM_USER_UID in the environment; ATRIUM_WORKSPACE_ID narrows it)
//
// stdout is the protocol channel: nothing here writes to it except through the SDK.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpUserError, createService, defineTools } from '@atrium/mcp-core';
import { createClient } from './lib/client.mjs';
import { readConfig } from './lib/config.mjs';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  // Dry-run safe: without the user id we exit before opening any connection.
  console.error(`atrium-mcp: ${error.message}`);
  process.exit(1);
}

const service = createService({
  client: createClient(config),
  actor: { uid: config.uid, workspaceFilter: config.workspaceFilter },
});
const server = new McpServer({ name: 'atrium', version: '0.2.0' });

const asText = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

for (const tool of defineTools(service)) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (args) => {
      try {
        return asText(await tool.run(args ?? {}));
      } catch (error) {
        if (error instanceof McpUserError) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
        console.error('atrium-mcp: unexpected error', error);
        const detail = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Unexpected error: ${detail}` }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
const target = config.emulator ? `emulator ${config.emulator}` : `production ${config.project}`;
const scope = config.workspaceFilter ? `workspace ${config.workspaceFilter}` : 'all memberships';
console.error(`atrium-mcp: ready (${scope}; ${target})`);
// Check the user against the database in the background; failures show up on first use too.
service
  .verify()
  .then(({ workspaces }) => console.error(`atrium-mcp: ${workspaces.length} workspace(s)`))
  .catch((error) => console.error(`atrium-mcp: ${error.message}`));
