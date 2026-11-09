require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, ActivityType, MessageFlags } = require('discord.js');
const { cfg, embed, ephemeral, isStaff, modLog } = require('./util');
const { BRAND, LINK_LEVEL, MEDIA_LEVEL } = require('./constants');

const modules = ['community', 'moderation', 'xp', 'tekken', 'trivia', 'play', 'tournament', 'voice', 'content'].map((m) => require(`./modules/${m}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
});

const help = new SlashCommandBuilder().setName('help').setDescription('Everything the bot can do');
const HELP = [
  ['Where', `Commands work in <#${cfg.channels.botCommands}>. Frame data also in <#${cfg.channels.frameData}>, \`/challenge\` in <#${cfg.channels.challenges}>, \`/trivia\` also in <#${cfg.channels.daily ?? cfg.channels.botCommands}>.`],
  ['Tekken', '`/frame` move frame data\n`/punish` a character\'s unsafe moves\n`/character` quick overview\n`/random` random character to play'],
  ['Play', '`/lfg` post that you want games\n`/queue` get matched with someone\n`/challenge` 1v1 set for the ladder\n`/tournament list` events'],
  ['Progress', '`/rank` your rank card\n`/daily` daily XP + streak\n`/perks` what each level unlocks\n`/leaderboard` XP, ladder, trivia\n`/color` name color (level 10+)'],
  ['Fun', '`/trivia` Tekken quiz\nStar a message 3 times for the Hall of Fame\nCharacter of the Day in #tekken-talk'],
  ['Voice', 'Join **+ Create Room** for your own channel\n`/room lock` `/room limit` `/room rename`'],
  ['Other', `\`/socials\` links\nPrivate help: open a ticket in #support\nImages unlock at level ${MEDIA_LEVEL}, links at level ${LINK_LEVEL}`],
];
const STAFF_HELP = ['Staff', '`/warn` `/warnings` `/clearwarnings` `/userinfo` `/timeout` `/untimeout` `/kick` `/ban` `/purge` `/slowmode` `/lockdown` `/supporter` `/post` `/announce` `/tournament create|close|bracket|winner`'];

for (const m of modules) m.init?.(client);

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(cfg.guildId);
  await guild.members.fetch().catch(() => {});
  const all = [help, ...modules.flatMap((m) => m.commands ?? [])].map((c) => c.toJSON());
  await guild.commands.set(all);
  client.user.setActivity('Tekken 8 · /help', { type: ActivityType.Playing });
  console.log(`Logged in as ${client.user.tag}: ${all.length} commands registered in ${guild.name}`);
});

// Global rate limit on commands, buttons and menus so nobody can spam the bot.
// Over the limit = blocked; keep hammering it = a 5 minute timeout.
const recent = new Map();
const blocked = new Map();
function rateLimited(userId) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 20000);
  list.push(now);
  recent.set(userId, list);
  return list.length > 6;
}
async function noteAbuse(i) {
  const now = Date.now();
  const list = (blocked.get(i.user.id) ?? []).filter((t) => now - t < 120000);
  list.push(now);
  blocked.set(i.user.id, list);
  if (list.length < 5) return false;
  blocked.delete(i.user.id);
  if (i.member?.moderatable) await i.member.timeout(5 * 60000, 'Auto: spamming bot commands').catch(() => {});
  await modLog(i.guild, { title: 'Command spam', description: `${i.user} kept spamming bot commands/buttons and got a 5 minute timeout.` });
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of recent) if (!v.some((t) => now - t < 20000)) recent.delete(k); }, 5 * 60000).unref();

// Which channels each member command works in. Staff can use anything anywhere.
// Discord also hides commands in chat channels (set up by setup.js); this is the backup.
const ANYWHERE = new Set(['help']);
const STAFF_ONLY = new Set(['warn', 'warnings', 'clearwarnings', 'userinfo', 'timeout', 'untimeout', 'kick', 'ban', 'purge', 'slowmode', 'lockdown', 'supporter', 'post', 'announce']);
const PLACES = {
  frame: ['botCommands', 'frameData'], punish: ['botCommands', 'frameData'], character: ['botCommands', 'frameData'], random: ['botCommands', 'frameData'],
  challenge: ['challenges'],
  trivia: ['botCommands', 'daily'],
  tournament: ['botCommands', 'tournaments'],
  lfg: ['botCommands', 'lfg'], queue: ['botCommands', 'lfg'],
};
function wrongChannel(i) {
  if (ANYWHERE.has(i.commandName) || STAFF_ONLY.has(i.commandName)) return null;
  if (i.commandName === 'room' && i.channel?.isVoiceBased()) return null;
  const keys = PLACES[i.commandName] ?? ['botCommands'];
  const ids = keys.map((k) => cfg.channels[k]).filter(Boolean);
  const here = i.channel?.isThread() ? i.channel.parentId : i.channelId;
  return ids.includes(here) ? null : ids;
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.inGuild()) return;
    const staff = isStaff(i.member);
    if ((i.isChatInputCommand() || i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) && !staff && rateLimited(i.user.id)) {
      if (await noteAbuse(i)) return ephemeral(i, 'You were timed out for 5 minutes for spamming the bot.').catch(() => {});
      return ephemeral(i, 'You\'re doing that too fast. Wait a few seconds.');
    }
    if (i.isChatInputCommand() && !staff) {
      if (STAFF_ONLY.has(i.commandName)) return ephemeral(i, 'That command is for staff only.');
      const where = wrongChannel(i);
      if (where) return ephemeral(i, `\`/${i.commandName}\` works in ${where.map((id) => `<#${id}>`).join(' or ')}. Head there and try again.`);
    }
    if (i.isChatInputCommand() && i.commandName === 'help') {
      const fields = [...HELP, ...(isStaff(i.member) ? [STAFF_HELP] : [])].map(([name, value]) => ({ name, value, inline: name !== 'Staff' }));
      await i.reply({ embeds: [embed({ title: `${BRAND.name}: commands`, description: `New here? Read <#${cfg.channels.guide}>.`, fields })], flags: MessageFlags.Ephemeral });
      return;
    }
    for (const m of modules) if (await m.interaction?.(i)) return;
  } catch (e) {
    console.error(`Interaction ${i.commandName ?? i.customId} failed:`, e);
    if (i.isRepliable()) await ephemeral(i, 'Something went wrong. Try again in a moment.').catch(() => {});
  }
});

process.on('unhandledRejection', (e) => console.error('Unhandled:', e));
client.login(process.env.DISCORD_TOKEN);
