# Awardopedia MCP Server

Search federal government contract opportunities directly from Claude Desktop.

> **Finally, a good use for an algorithm.**

![Awardopedia](https://awardopedia.com/logo-horizontal-clean.jpg)

## What is this?

This MCP server connects Claude to [Awardopedia](https://awardopedia.com), a searchable database of federal contract opportunities from SAM.gov. Ask Claude things like:

- "Find me cybersecurity contracts in Virginia"
- "What small business set-asides are due this week?"
- "Search for janitorial services opportunities in Colorado"
- "Find 8(a) contracts for IT services"

## Status: Beta

We're actively cleaning and adding data every day. Results improve continuously.

## Quick Start

### 1. Get your free API key

Sign up at [awardopedia.com/signup](https://awardopedia.com/signup) and generate an API key from your Dashboard.

### 2. Add to Claude Desktop

Edit your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "awardopedia": {
      "command": "npx",
      "args": ["-y", "awardopedia-mcp"],
      "env": {
        "AWARDOPEDIA_API_KEY": "ak_your_key_here"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

That's it! Try asking Claude about federal contracts.

## Tools Available

### search_opportunities

Search for federal contract opportunities.

**Parameters:**
- `q` — Search keywords (e.g., "cybersecurity", "janitorial")
- `naics` — NAICS code filter (e.g., "541512" for IT)
- `state` — State code (e.g., "VA", "CA")
- `set_aside` — Set-aside type ("SBA", "8(a)", "SDVOSB", "WOSB", "HUBZone")
- `limit` — Results per search (1-25, default 10)

### get_opportunity_details

Get full details for a specific opportunity by notice ID.

## Rate Limits

- **10 searches per day** (free tier)
- **25 results per search**

Need more? Contact api@awardopedia.com

## Examples

**"Find IT contracts in DC"**
```
Found 12 federal contract opportunities:

**Cloud Infrastructure Support Services**
Agency: Department of Defense
Deadline: 2026-04-15
Location: Washington, DC
Set-aside: Small Business
NAICS: 541512 (Computer Systems Design Services)
Details: https://awardopedia.com/opportunity/...
```

**"What SDVOSB opportunities are available for construction?"**
```
Found 8 federal contract opportunities:

**Building Renovation - Phase 2**
Agency: Department of Veterans Affairs
Set-aside: SDVOSB
NAICS: 236220 (Commercial Building Construction)
...
```

## Links

- [Awardopedia](https://awardopedia.com) — Full website with PDFs and reports
- [API Documentation](https://awardopedia.com/llms.txt)
- [Get API Key](https://awardopedia.com/signup)

## License

MIT

---

Built with care for small businesses navigating federal contracting.
