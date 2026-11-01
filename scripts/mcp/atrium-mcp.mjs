// Atrium MCP connector: a local stdio MCP server that lets Claude create and edit boards, groups,
// columns, items and updates in the live Atrium. Nothing is deployed. See docs/mcp-connector.md.
//
// Run it through tsx (it imports the TypeScript in @atrium/shared), normally via `claude mcp add`:
//   pnpm mcp          (needs ATRIUM_WORKSPACE_ID and ATRIUM_USER_UID in the environment)
//
// stdout is the protocol channel: nothing here writes to it except through the SDK.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from './lib/client.mjs';
import { readConfig } from './lib/config.mjs';
import { McpUserError } from './lib/errors.mjs';
import { createService } from './lib/service.mjs';
import { defineTools } from './lib/tools.mjs';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  // Dry-run safe: without the workspace id we exit before opening any connection.
  console.error(`atrium-mcp: ${error.message}`);
  process.exit(1);
}

const service = createService({ client: createClient(config), config });
const server = new McpServer({ name: 'atrium', version: '0.1.0' });

const asText = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

for (const tool of defineTools(service)) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
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
console.error(`atrium-mcp: ready (workspace-limited; ${target})`);
// Check the configuration against the database in the background; failures show up on first use too.
service.verify().catch((error) => console.error(`atrium-mcp: ${error.message}`));
