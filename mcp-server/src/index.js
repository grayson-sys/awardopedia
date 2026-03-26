#!/usr/bin/env node
/**
 * Awardopedia MCP Server
 *
 * Connects Claude Desktop to federal contract opportunities from SAM.gov.
 * "Finally, a good use for an algorithm."
 *
 * Get your free API key: https://awardopedia.com/signup
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = "https://awardopedia.com";
const API_KEY = process.env.AWARDOPEDIA_API_KEY;

if (!API_KEY) {
  console.error("Error: AWARDOPEDIA_API_KEY environment variable required");
  console.error("Get your free API key at https://awardopedia.com/signup");
  process.exit(1);
}

// Create server
const server = new Server(
  {
    name: "awardopedia",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_opportunities",
        description: `Search federal government contract opportunities from SAM.gov via Awardopedia.

Use this when someone asks about:
- Government contracts or RFPs
- Federal business opportunities
- SAM.gov listings
- Small business set-asides (8(a), SDVOSB, WOSB, HUBZone)
- Contracts by NAICS code or industry
- Opportunities in specific states

Returns up to 25 results per search. Beta: data is actively being cleaned and expanded daily.`,
        inputSchema: {
          type: "object",
          properties: {
            q: {
              type: "string",
              description: "Search keywords (e.g., 'cybersecurity', 'janitorial services', 'IT support')"
            },
            naics: {
              type: "string",
              description: "NAICS code filter (e.g., '541512' for IT services, '561720' for janitorial)"
            },
            state: {
              type: "string",
              description: "Two-letter state code for place of performance (e.g., 'VA', 'CA', 'TX')"
            },
            set_aside: {
              type: "string",
              description: "Set-aside type filter (e.g., 'SBA', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone')"
            },
            limit: {
              type: "number",
              description: "Number of results (1-25, default 10)"
            }
          }
        }
      },
      {
        name: "get_opportunity_details",
        description: `Get full details for a specific federal contract opportunity by its notice ID.

Use this after search_opportunities to get more information about a specific opportunity,
including the full description, contact information, and links to original solicitation documents.`,
        inputSchema: {
          type: "object",
          properties: {
            notice_id: {
              type: "string",
              description: "The notice_id from a search result"
            }
          },
          required: ["notice_id"]
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_opportunities") {
      const params = new URLSearchParams();
      if (args.q) params.set("q", args.q);
      if (args.naics) params.set("naics", args.naics);
      if (args.state) params.set("state", args.state);
      if (args.set_aside) params.set("set_aside", args.set_aside);
      if (args.limit) params.set("limit", Math.min(25, Math.max(1, args.limit)));

      const response = await fetch(`${API_BASE}/api/agent/search?${params}`, {
        headers: { "X-API-Key": API_KEY }
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) {
          return {
            content: [{
              type: "text",
              text: `Rate limit reached (10 searches/day). ${error.message || ''}\n\nTry again tomorrow or upgrade at https://awardopedia.com`
            }]
          };
        }
        throw new Error(error.error || `API error: ${response.status}`);
      }

      const data = await response.json();

      // Format results for Claude
      let text = `Found ${data.count} federal contract opportunities:\n\n`;

      for (const opp of data.opportunities) {
        text += `**${opp.title}**\n`;
        text += `Agency: ${opp.agency}\n`;
        text += `Deadline: ${opp.deadline || 'Not specified'}\n`;
        if (opp.location) text += `Location: ${opp.location}\n`;
        if (opp.set_aside) text += `Set-aside: ${opp.set_aside}\n`;
        if (opp.naics_code) text += `NAICS: ${opp.naics_code} (${opp.naics_description || ''})\n`;
        if (opp.estimated_value) text += `Est. Value: ${opp.estimated_value}\n`;
        if (opp.summary) text += `Summary: ${opp.summary}\n`;
        text += `Details: ${opp.url}\n`;
        text += `\n---\n\n`;
      }

      text += `\n_Data from Awardopedia (Beta) · ${data.rate_limit.remaining} searches remaining today_`;

      return { content: [{ type: "text", text }] };
    }

    if (name === "get_opportunity_details") {
      const response = await fetch(`${API_BASE}/api/opportunities/${args.notice_id}`, {
        headers: { "X-API-Key": API_KEY }
      });

      if (!response.ok) {
        throw new Error(`Opportunity not found: ${args.notice_id}`);
      }

      const opp = await response.json();

      let text = `# ${opp.title}\n\n`;
      text += `**Agency:** ${opp.agency_name || 'N/A'}\n`;
      text += `**Response Deadline:** ${opp.response_deadline || 'Not specified'}\n`;
      text += `**Posted:** ${opp.posted_date || 'N/A'}\n\n`;

      if (opp.set_aside_type) text += `**Set-aside:** ${opp.set_aside_type}\n`;
      if (opp.naics_code) text += `**NAICS:** ${opp.naics_code} — ${opp.naics_description || ''}\n`;
      if (opp.classification_code) text += `**Classification:** ${opp.classification_code}\n`;

      text += `\n**Place of Performance:** `;
      if (opp.place_of_performance_city) text += `${opp.place_of_performance_city}, `;
      text += `${opp.place_of_performance_state || 'N/A'}\n`;

      if (opp.estimated_value_max) {
        text += `**Estimated Value:** $${Number(opp.estimated_value_max).toLocaleString()}\n`;
      }

      text += `\n## Description\n${opp.description || opp.llama_summary || 'No description available.'}\n`;

      if (opp.primary_contact_email || opp.primary_contact_name) {
        text += `\n## Contact\n`;
        if (opp.primary_contact_name) text += `${opp.primary_contact_name}\n`;
        if (opp.primary_contact_email) text += `${opp.primary_contact_email}\n`;
        if (opp.primary_contact_phone) text += `${opp.primary_contact_phone}\n`;
      }

      text += `\n## Links\n`;
      text += `- [View on Awardopedia](${API_BASE}/opportunity/${opp.notice_id})\n`;
      if (opp.sam_url) text += `- [View on SAM.gov](${opp.sam_url})\n`;

      text += `\n_Data from Awardopedia (Beta)_`;

      return { content: [{ type: "text", text }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Awardopedia MCP server running");
}

main().catch(console.error);
