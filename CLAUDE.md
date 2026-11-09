# Tekken Bot (thewhifflord's dojo)

discord.js bot for Asad's Tekken community. Bot app is owned by Ibrahim's Discord account (miawab).

- `npm start` runs the bot. `node setup.js` (re)builds roles, channels, permissions, AutoMod and panels; safe to re-run, IDs saved in `data/config.json`.
- Roles: Whifflord = server owner (admin), Tech = Ibrahim (admin, bot maintainer, `cfg.techUserId`), Moderator.
- Channel rules (since 2026-11-09): chat channels have slash commands switched off; commands live in #bot-commands, #frame-data, #challenges, #daily, #lfg, #tournaments (map in `src/index.js` PLACES). #level-ups and #daily are bot-only feeds with a thread per post. #memes and #clips-and-highlights are media-only (clips get a comment thread). #suggestions is a forum.
- Spam: 6 interactions / 20 s per user, 5 blocked attempts in 2 min = 5 min timeout; plus chat filters/AutoMod in `modules/moderation.js`.
- Backup from before the 2026-11-09 changes: `.backup-2026-11-09/`.
- Hosting: not yet (runs on this PC). Plan: Wispbyte free.
