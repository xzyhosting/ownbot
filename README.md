# OwnBot

A Discord slash-command bot for moderation and server utilities.

## Commands

- `/kick member reason?` - kick a member.
- `/ban member duration? reason?` - ban a member; use `2h` for hours, `3d` for days, or leave duration blank for permanent.
- `/unban user_id reason?` - unban a user by ID.
- `/timeout member duration reason?` - timeout a member for up to 28 days; use `1h` for one hour or `2d` for two days.
- `/removetimeout member` - remove a member's timeout.
- `/servermute member duration?` - create or use a `Muted` role; use `1h` for one hour, `2d` for two days, or leave duration blank for permanent.
- `/unmute member` - remove the `Muted` role from a member.
- `/serverinfo` - show information about the current server.
- `/botinfo` - show bot latency, start date, and uptime.
- `/punishmentlist` - show currently banned, timed-out, and server-muted members.
- `/clearmasage` - delete all messages from the current text or voice channel; requires Manage Messages.
- `/afk message? minutes?` - set your AFK status and optional duration (1 minute to 7 days); posting clears it. When someone mentions an AFK user, the bot shows their username and AFK message in that channel.
- `/announce message channel?` - post a timestamped announcement embed.
- `/send user message` - send one direct message to a selected user; requires Manage Messages.
- `/dmall message confirm` - owner-only, confirmation-gated DM to non-bot members.

## Setup

1. Install Node.js 18.17 or newer.
2. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
3. Enable the **Server Members Intent** and **Message Content Intent** under Bot settings.
4. Invite the bot with the `bot` and `applications.commands` scopes. Grant it `Kick Members`, `Ban Members`, `Moderate Members`, `Manage Roles`, `Manage Channels`, `Send Messages`, `Embed Links`, and `View Channels` as needed.
5. Copy `.env.example` to `.env` and fill in your bot token. The application ID and owner are detected automatically.
6. Install dependencies and start the bot:

	```bash
	npm install
	npm start
	```

Commands are registered globally when the bot starts. Discord can take a few minutes to show newly registered global commands.

The bot must have its role above members it moderates and above the `Muted` role. The `/dmall` command deliberately waits between messages and skips bots; only `BOT_OWNER_ID` can run it, and the command requires `SEND` in its confirmation option.