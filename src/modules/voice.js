// Join-to-create voice rooms: join "+ Create Room" and get your own channel, deleted when empty.
const { SlashCommandBuilder, Events, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { cfg, ephemeral } = require('../util');
const { kvGet, kvSet } = require('../db');

const rooms = () => JSON.parse(kvGet('voiceRooms') ?? '{}'); // channelId -> ownerId
const saveRooms = (r) => kvSet('voiceRooms', JSON.stringify(r));

const commands = [
  new SlashCommandBuilder().setName('room').setDescription('Manage your temporary voice room')
    .addSubcommand((s) => s.setName('lock').setDescription('Only people already inside can stay; nobody new can join'))
    .addSubcommand((s) => s.setName('unlock').setDescription('Let anyone join again'))
    .addSubcommand((s) => s.setName('limit').setDescription('Set a user limit')
      .addIntegerOption((o) => o.setName('people').setDescription('0 = no limit').setRequired(true).setMinValue(0).setMaxValue(25)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename your room')
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(40))),
];

async function interaction(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'room') return false;
  const ch = i.member.voice.channel;
  const r = rooms();
  if (!ch || r[ch.id] !== i.user.id) return ephemeral(i, `You need to be in a room you created. Join **+ Create Room** to make one.`), true;
  const everyone = i.guild.roles.everyone.id;
  switch (i.options.getSubcommand()) {
    case 'lock': await ch.permissionOverwrites.edit(everyone, { Connect: false }); return ephemeral(i, 'Room locked.'), true;
    case 'unlock': await ch.permissionOverwrites.edit(everyone, { Connect: null }); return ephemeral(i, 'Room unlocked.'), true;
    case 'limit': { const n = i.options.getInteger('people'); await ch.setUserLimit(n); return ephemeral(i, n ? `Limit set to ${n}.` : 'Limit removed.'), true; }
    case 'rename': {
      if (/https?:|discord\.gg/i.test(i.options.getString('name'))) return ephemeral(i, 'No links in room names.'), true;
      await ch.setName(i.options.getString('name')); return ephemeral(i, 'Room renamed.'), true;
    }
  }
  return false;
}

async function cleanup(guild) {
  const r = rooms();
  let changed = false;
  for (const id of Object.keys(r)) {
    const ch = guild.channels.cache.get(id);
    if (!ch) { delete r[id]; changed = true; continue; }
    if (ch.members.size === 0) { await ch.delete('Temp room empty').catch(() => {}); delete r[id]; changed = true; }
  }
  if (changed) saveRooms(r);
}

function init(client) {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    const guild = after.guild;
    if (after.channelId === cfg.channels.createRoom && after.member && !after.member.user.bot) {
      const r = rooms();
      const existing = Object.entries(r).find(([, owner]) => owner === after.member.id);
      if (existing && guild.channels.cache.has(existing[0])) {
        await after.setChannel(existing[0]).catch(() => {});
      } else {
        const ch = await guild.channels.create({
          name: `${after.member.displayName}'s room`.slice(0, 40),
          type: ChannelType.GuildVoice,
          parent: cfg.channels.catPlay,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, allow: [P.ViewChannel, P.Connect] },
            { id: after.member.id, allow: [P.ViewChannel, P.Connect, P.MoveMembers] },
          ],
        }).catch(() => null);
        if (ch) {
          r[ch.id] = after.member.id;
          saveRooms(r);
          await after.setChannel(ch).catch(() => {});
        }
      }
    }
    if (before.channelId && rooms()[before.channelId]) await cleanup(guild);
  });

  client.once(Events.ClientReady, () => {
    const guild = client.guilds.cache.get(cfg.guildId);
    cleanup(guild);
  });
}

module.exports = { commands, interaction, init };
