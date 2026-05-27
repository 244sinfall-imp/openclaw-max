# openclaw-max

Modern OpenClaw channel plugin for Max Messenger via the Max Bot API.

## Features

- Max Messenger channel (`max`) for OpenClaw 2026.5.22+
- Long-poll inbound messages using `runtime.channel.turn.runAssembled`
- DM allowlist support
- Outbound text replies to Max users/chats
- Agent tools for core Max Bot API operations:
  - bot identity and commands
  - chats and chat lookup
  - chat editing and membership/admins
  - message send/edit/delete/pin/unpin
  - chat actions and callback answers
  - file/image/audio/video upload helpers

## Configuration

Keep the bot token in environment, not in config or git:

```bash
MAX_BOT_TOKEN=...
```

Example OpenClaw config:

```json5
{
  channels: {
    max: {
      enabled: true,
      accounts: {
        default: {
          token: "${MAX_BOT_TOKEN}",
          dmPolicy: "allowlist",
          allowFrom: ["11958420"]
        }
      }
    }
  }
}
```

## Development

```bash
npm install
npm run check
openclaw plugins install --link
```

## Status

Fresh rewrite, intentionally not based on the old deprecated `openclaw-max-messenger` plugin.
