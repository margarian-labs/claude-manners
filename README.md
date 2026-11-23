# claude-setup

A shared Claude Code setup for Windows. Every part is optional, every change arrives as a proposal you accept, skip or postpone, and you can go back to any earlier version.

## What you get
The catalog below lists every part, grouped. Recommended parts are ticked in the first-run menu; optional ones are offered but not ticked. Each part says what it needs (for example Node, or a second Claude account) and is hidden when your PC doesn't have it.

## Join
1. You need: Windows, Git for Windows (Git Bash), Node 18+, Claude Code, a GitHub account invited to this repo (read access).
2. Clone it anywhere: `git clone https://github.com/margarian-labs/claude-setup.git`
3. Open Claude Code in the clone and say: **Follow START.md**. Your agent installs the sync skill, checks your PC, backs up your current setup and shows the catalog menu.

## Stay up to date
Say **sync my setup**. Your agent pulls this repo and shows only the proposals you haven't answered, one by one: what changes, why, how many tokens it adds to every session, how well it was tested, what it runs, and the real code change. You answer accept, skip or later. Nothing updates in the background.

## Go back
Say **roll back my last sync** or **go back to version v2026.11.23.1**. Only files and settings that sync itself wrote are restored; your own files, settings and edits stay as they are. Changes you rolled back are offered again on the next sync.

## Safety
- Only the owner can change this repo; members have read access.
- Every script, hook and settings change is shown as a real diff before you accept it, and risky settings (environment, permissions, hooks, MCP servers) need a typed confirmation.
- No secrets live here: keys stay in your own environment variables or local files.

## Catalog
<!-- catalog:start -->
| Group | Part | Level | Summary |
| --- | --- | --- | --- |
| rules | C# and .NET conventions | optional | C# and .NET coding conventions (.NET 8+, file-scoped namespaces, nullable types, naming). Pairs with the dotnet plugins. |
| rules | Core rules | recommended | Short answers, honest pushback, no long dashes, readable pages and cleanup after work. Loaded every session. |
| rules | Prompt flags | recommended | Short flags in a message (-d, -w, -nc, -q, -rc, -a, -p, -m, -nb, -away) change how Claude handles it. |
| rules | Style and coding rules | recommended | Reply language and length, coding conventions, and git commit and pull request habits. Loaded every session. |
| rules | Sub-agents and model roles | recommended | Opus leads, Fable plans, Sonnet and Haiku do the work from detailed briefs, and Opus checks every result. |
| rules | Teammate messages | optional | Drafts messages to teammates very short and casual, in the language you choose. |
| rules | Workflow rules | recommended | How Claude works day to day: plan mode, asking questions, picking skills, usage-limit wake-up timer, setup-change notices. |
| settings | Auto-compact at 600k | recommended | Compacts the conversation automatically at 600k tokens. Needs a model with a 1M context window. |
| settings | Basics | recommended | UTF-8 for Python and no session cron jobs. |
| settings | Bypass mode | recommended | Claude runs every command and edit without asking. Prompt-free agents and away mode depend on it. |
| settings | Fullscreen display | recommended | Uses the fullscreen terminal interface. |
| settings | Housekeeping | recommended | Keeps sessions 365 days, starts worktrees from a fresh branch, turns workflows and autoDream off. |
| settings | Keybindings | optional | A custom keybindings file. Written once if you have none; compare with your own first. |
| settings | Messages between local sessions | recommended | Other Claude sessions on this PC can message this one, used by handoffs and setup-change notices. |
| settings | Models and effort | recommended | Opus as main model, Sonnet for workers, effort set per model. Check first that your plan includes Fable 5.2. |
| settings | Remote Control at startup | recommended | Every session can be reached from the Claude app on your phone or another computer. |
| settings | Skill overrides | recommended | Turns off 7 noisy skills and sets 5 built-in ones to run only when you ask for them. |
| settings | Status line | recommended | Shows account, model, effort, context, usage limits and folder, and writes the usage files that away mode reads. |
| workflow | Away mode | recommended | Say -away and the agent asks all its questions first, then finishes the whole task without you, with an optional usage stop point. |
| workflow | Compaction recovery | recommended | After a compaction, points Claude to the full transcript and to your exact words, so nothing important is lost. |
| workflow | Handoff | recommended | Writes a full handoff for a fresh session, and suggests one after 2 compactions or at 80% context. |
| hooks | Session id | recommended | Shows the session id when a session starts, so you can name it in handoffs and messages. |
| hooks | Session namer | recommended | Names each session with a short project key and title, such as "WEB fix login". |
| agents | Planner, second opinion and Haiku worker | recommended | Three helper agents: a planner for big tasks, a second opinion for hard calls, and a Haiku worker for simple jobs. |
| skills | Angular developer | optional | Generates Angular code and gives architecture and best practice guidance for projects, components, services and more. |
| skills | API and interface design | optional | Helps you design stable, well-documented APIs and interfaces that are hard to misuse. |
| skills | Architecture decisions | optional | Writes architecture decision records and reviews system designs with trade-offs and consequences. |
| skills | Conversion rate optimization | recommended | Finds what to change on a landing, pricing or form page to get more conversions, and why it is not converting. |
| skills | Copywriting | recommended | Writes and rewrites marketing copy for pages such as home, landing and pricing, with supportable claims. |
| skills | Deprecation and migration | recommended | Plans the safe removal or replacement of old systems and APIs, including database changes with no downtime. |
| skills | Design system file | recommended | Gives a new project a design system by writing a DESIGN.md based on one of 84 well known product brands. |
| skills | Diagram craft | recommended | Helps you draw diagrams by hand: picks the right type and keeps nodes, lines and labels readable and accurate. |
| skills | Domain modeling | recommended | Builds and sharpens a project's domain model via glossary terms and architecture decision records. |
| skills | Grill me | recommended | Interviews you relentlessly to sharpen a plan or design. |
| skills | Grill with docs | recommended | Interviews you relentlessly to sharpen a plan or design, writing ADRs and a glossary as you go. |
| skills | Grilling | recommended | Stress-tests your thinking with a relentless interview about a plan, decision or idea. |
| skills | Hallmark | recommended | Makes websites and landing pages look made, not generated; can also redesign or audit an existing page. |
| skills | Liteparse | recommended | Local OCR and text extraction for scanned, image-only or long PDFs, so you need not read pages as images. |
| skills | Plain writing | recommended | Cleans prose other people will read: removes AI writing tells and checks that no fact was lost. |
| skills | Prototype | recommended | Builds a throwaway prototype to sanity-check a state model or explore what a UI should look like. |
| skills | Research | recommended | Researches a question against primary sources with a background agent and saves the findings as a repo Markdown file. |
| skills | SEO audit | recommended | Audits a site's SEO when traffic dropped or a page will not rank: indexing, canonicals, redirects, Core Web Vitals and local SEO. |
| skills | Set up Matt Pocock's skills | recommended | Configures a repo for the engineering skills once: issue tracker, triage labels and where domain docs live. |
| skills | Social content | recommended | Creates organic social content for LinkedIn, X, Instagram, TikTok or Facebook: posts, threads, carousels and calendars. |
| skills | Sprint planning | optional | Plans a sprint: scopes work, estimates team capacity, sets goals and drafts the plan, including carryover. |
| skills | System design | optional | Helps you design systems and services: requirements, architecture, API contracts, data models and service boundaries. |
| skills | To spec | recommended | Turns the current conversation into a spec and publishes it to the project issue tracker, with no interview. |
| skills | To tickets | recommended | Breaks a plan, spec or conversation into small tickets, each listing what blocks it, and publishes them to your tracker. |
| skills | UI craft | recommended | Rules for making app screens, dashboards, forms and sites look designed rather than AI-generated, plus a redesign audit. |
| skills | UI/UX Pro Max | recommended | Searches a local design database when you pick UI styles, colour palettes, font pairings, chart types or UX rules. |
| skills | Video analysis | recommended | Looks at frames from a video or screen recording and transcribes speech so you learn what happens and what is said. |
| skills | Wayfinder | recommended | Plans work too big for one session as a shared map of decision tickets on your tracker, resolved one at a time. |
| plugins | .NET plugins | optional | Five .NET plugins: dotnet, ASP.NET Core, data, test and MSBuild. They pair with the C# and .NET rules. |
| plugins | AccessLint plugin | optional | Checks web pages and code for accessibility problems. |
| plugins | Event storming plugin | optional | Skills for event storming and domain-driven design workshops. |
| plugins | Figma plugin | optional | Reads Figma designs so Claude can build from them. |
| plugins | Playwright plugin | recommended | Lets Claude drive a real browser: open pages, click, fill forms and take screenshots. |
| plugins | Skill creator plugin | optional | Helps write, test and improve your own skills. |
| plugins | Superpowers plugin | recommended | Skills for planning, debugging, code review, worktrees and proving work before calling it done. |
| tools | Disk Watchdog | optional | A background check every 10 minutes that shrinks huge Claude temp logs and cleans old session temp and old backups. |
| tools | Sync engine | recommended | The tool and skill that install this setup, bring in updates one by one and roll back. Say "sync my setup" to use it. |
| tools | Tidy | recommended | At the end of a task, finds what the session left behind and removes only its own throwaway files. |
| tools | Usage tools | optional | Cost and usage reports built from your local Claude transcripts. |
| integrations | Figma MCP (Framelink) | optional | Lets Claude read Figma files and download their images through the Framelink MCP server. |
| integrations | memohopper memory | optional | Connects the memohopper memory service and adds rules to use it as primary memory, with tasks. |
| integrations | Telegram notifications | optional | Phone messages through your own Telegram bot when Claude finishes, needs input or asks a question. |
| integrations | Two Claude accounts | optional | "claude" opens one account and "claude -P" the other, both signed in at once and sharing settings, skills and sessions. |
| lessons | Lessons | optional | Seven short notes from real mistakes (settings, hooks, Telegram, disk cleanup, prompts, token savings) kept in file memory. |
<!-- catalog:end -->
