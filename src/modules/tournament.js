// Server tournaments: staff create, members join with a button, staff generate a seeded bracket.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits: P } = require('discord.js');
const { cfg, embed, E, ephemeral, isStaff, shuffle } = require('../util');
const { db } = require('../db');
const { BRAND } = require('../constants');

const idOpt = (o) => o.setName('id').setDescription('Tournament ID (see /tournament list)').setRequired(true);
const commands = [
  new SlashCommandBuilder().setName('tournament').setDescription('Server tournaments')
    .addSubcommand((s) => s.setName('list').setDescription('Open and upcoming tournaments'))
    .addSubcommand((s) => s.setName('create').setDescription('(Staff) Create a tournament')
      .addStringOption((o) => o.setName('name').setDescription('e.g. "Friday Night Fights #1"').setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName('max_players').setDescription('Cap (default 32)').setMinValue(2).setMaxValue(128))
      .addStringOption((o) => o.setName('when').setDescription('e.g. "Friday 8pm EST"').setMaxLength(80))
      .addStringOption((o) => o.setName('details').setDescription('Format, rules, prizes').setMaxLength(1000)))
    .addSubcommand((s) => s.setName('close').setDescription('(Staff) Close sign-ups').addIntegerOption(idOpt))
    .addSubcommand((s) => s.setName('bracket').setDescription('(Staff) Randomly seed round 1').addIntegerOption(idOpt))
    .addSubcommand((s) => s.setName('winner').setDescription('(Staff) Announce the champion').addIntegerOption(idOpt)
      .addUserOption((o) => o.setName('user').setDescription('Champion').setRequired(true))),
];

const entrants = (tid) => db.prepare('SELECT user_id FROM entries WHERE tid = ?').all(tid).map((r) => r.user_id);
const get = (tid) => db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tid);

function view(t) {
  const people = entrants(t.id);
  const open = t.status === 'open';
  return {
    embeds: [embed({
      title: t.name,
      description: [
        t.starts && `**When:** ${t.starts}`,
        `**Players:** ${people.length}/${t.max}`,
        `**Status:** ${open ? 'Sign-ups open' : t.status === 'closed' ? 'Sign-ups closed' : 'Finished'}`,
        t.details && `\n${t.details}`,
        people.length ? `\n**Entrants:**\n${people.map((u) => `<@${u}>`).join(' ').slice(0, 3000)}` : '',
      ].filter(Boolean).join('\n'),
      footer: { text: `Tournament #${t.id}` },
      color: BRAND.gold,
    })],
    components: open ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tourney:join:${t.id}`).setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tourney:leave:${t.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    )] : [],
    allowedMentions: { parse: [] },
  };
}

async function refresh(guild, t) {
  const ch = guild.channels.cache.get(t.channel_id);
  const msg = await ch?.messages.fetch(t.message_id).catch(() => null);
  if (msg) await msg.edit(view(t));
}

// Standard single-elim seeding with byes for the top seeds.
function round1(players) {
  let size = 1;
  while (size < players.length) size *= 2;
  const seeded = shuffle(players);
  const slots = [...seeded, ...Array(size - seeded.length).fill(null)];
  const pairs = [];
  for (let n = 0; n < size / 2; n++) pairs.push([slots[n], slots[size - 1 - n]]);
  return pairs;
}

async function interaction(i) {
  if (i.isButton() && i.customId.startsWith('tourney:')) {
    const [, action, tidStr] = i.customId.split(':');
    const t = get(Number(tidStr));
    if (!t || t.status !== 'open') return ephemeral(i, 'Sign-ups are closed.'), true;
    if (action === 'join') {
      if (entrants(t.id).length >= t.max) return ephemeral(i, 'It\'s full.'), true;
      const { changes } = db.prepare('INSERT OR IGNORE INTO entries (tid, user_id) VALUES (?, ?)').run(t.id, i.user.id);
      await ephemeral(i, changes ? `${E('check')} You're in **${t.name}**. Good luck!` : 'You\'re already signed up.');
    } else {
      db.prepare('DELETE FROM entries WHERE tid = ? AND user_id = ?').run(t.id, i.user.id);
      await ephemeral(i, `You left **${t.name}**.`);
    }
    await refresh(i.guild, t);
    return true;
  }

  if (!i.isChatInputCommand() || i.commandName !== 'tournament') return false;
  const sub = i.options.getSubcommand();

  if (sub === 'list') {
    const rows = db.prepare("SELECT * FROM tournaments WHERE status != 'done' ORDER BY id DESC LIMIT 10").all();
    await ephemeral(i, { embeds: [embed({
      title: 'Tournaments',
      description: rows.map((t) => `**#${t.id} ${t.name}** · ${entrants(t.id).length}/${t.max} · ${t.status}${t.starts ? ` · ${t.starts}` : ''}`).join('\n') || 'No tournaments right now.',
      color: BRAND.gold,
    })] });
    return true;
  }

  if (!isStaff(i.member) && !i.member.permissions.has(P.ManageGuild)) return ephemeral(i, 'Staff only.'), true;

  if (sub === 'create') {
    const ch = i.guild.channels.cache.get(cfg.channels.tournaments);
    const info = db.prepare('INSERT INTO tournaments (name, starts, details, max, created_by, ts) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.options.getString('name'), i.options.getString('when'), i.options.getString('details'), i.options.getInteger('max_players') ?? 32, i.user.id, Date.now());
    const t = get(Number(info.lastInsertRowid));
    const msg = await ch.send({ ...view(t), content: `<@&${cfg.pingRoles.tourney}>`, allowedMentions: { roles: [cfg.pingRoles.tourney] } });
    db.prepare('UPDATE tournaments SET channel_id = ?, message_id = ? WHERE id = ?').run(ch.id, msg.id, t.id);
    await ephemeral(i, `Created tournament #${t.id} in <#${ch.id}>.`);
    return true;
  }

  const t = get(i.options.getInteger('id'));
  if (!t) return ephemeral(i, 'No tournament with that ID.'), true;

  if (sub === 'close') {
    db.prepare("UPDATE tournaments SET status = 'closed' WHERE id = ?").run(t.id);
    await refresh(i.guild, { ...t, status: 'closed' });
    await ephemeral(i, `Sign-ups closed for **${t.name}** (${entrants(t.id).length} players).`);
    return true;
  }

  if (sub === 'bracket') {
    const people = entrants(t.id);
    if (people.length < 2) return ephemeral(i, 'Need at least 2 players.'), true;
    const pairs = round1(people);
    await i.reply({
      embeds: [embed({
        title: `${t.name}: round 1`,
        description: pairs.map(([a, b], n) => `\`${String(n + 1).padStart(2)}\` ${a ? `<@${a}>` : 'BYE'} vs ${b ? `<@${b}>` : '*BYE*'}`).join('\n').slice(0, 4000),
        footer: { text: 'Report results to staff. Byes advance automatically.' },
        color: BRAND.gold,
      })],
      allowedMentions: { users: people },
    });
    return true;
  }

  if (sub === 'winner') {
    const champ = i.options.getUser('user');
    db.prepare("UPDATE tournaments SET status = 'done' WHERE id = ?").run(t.id);
    await refresh(i.guild, { ...t, status: 'done' });
    const ch = i.guild.channels.cache.get(cfg.channels.tournaments);
    await ch.send({ content: `<@&${cfg.pingRoles.tourney}>`, embeds: [embed({ title: `${t.name}: champion`, description: `${E('win')} Congrats to ${champ} for taking it all!`, thumbnail: { url: champ.displayAvatarURL({ size: 256 }) }, color: BRAND.gold })], allowedMentions: { roles: [cfg.pingRoles.tourney], users: [champ.id] } });
    await ephemeral(i, 'Champion announced.');
    return true;
  }
  return false;
}

module.exports = { commands, interaction, init: () => {} };
