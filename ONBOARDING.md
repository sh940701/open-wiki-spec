# Welcome to Open Wiki Spec

## How We Use Claude

Based on sh940701's usage over the last 30 days:

Work Type Breakdown:
  Plan Design    █████████████░░░░░░░  67%
  Build Feature  ███████░░░░░░░░░░░░░  33%

Top Skills & Commands:
  /rename                  ████████████████████  3x/month
  /fast                    █████████████░░░░░░░  2x/month
  /login                   ███████░░░░░░░░░░░░░  1x/month
  /ralph-loop:ralph-loop   ███████░░░░░░░░░░░░░  1x/month
  /security-review         ███████░░░░░░░░░░░░░  1x/month

Top MCP Servers:
  claude-in-chrome     ████████████████████  19 calls
  sequential-thinking  ████████░░░░░░░░░░░░  8 calls
  serena               ██░░░░░░░░░░░░░░░░░░  2 calls

## Your Setup Checklist

### Codebases
- [ ] open-wiki-spec — https://github.com/sh940701/open-wiki-spec

### MCP Servers to Activate
- [ ] claude-in-chrome — Drives a real Chrome instance for browser automation, screenshots, and console log debugging. Install the Claude-in-Chrome extension and connect it to your Claude Code session.
- [ ] sequential-thinking — Structured step-by-step reasoning for complex problems. Add the `sequential-thinking` MCP server to your Claude config (`~/.claude.json` under `mcpServers`).
- [ ] serena — Symbol-aware code navigation and editing (find_symbol, replace_symbol_body, etc.). Required for all code work on this team — see Team Tips below. Install via the Serena MCP setup instructions.

### Skills to Know About
- /rename — Rename symbols, files, or refactors across the codebase cleanly.
- /fast — Toggle fast mode for quicker Claude output (same Opus model, faster streaming).
- /login — Authenticate your Claude Code session.
- /ralph-loop:ralph-loop — Run an automated sprint loop that processes backlog stories one at a time in fresh contexts.
- /security-review — Run a focused security pass over recent changes.
- /compact — Compact conversation history when context gets tight.
- /mcp — Manage and inspect your MCP server connections.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
