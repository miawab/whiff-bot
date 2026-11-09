// /lfg posts (auto-expire), /queue matchmaking, /challenge 1v1 sets that feed an Elo ladder.
const { SlashCommandBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cfg, embed, E, cooldown, ephemeral, modLog } = require('../util');
const { db, getUser } = require('../db');
const { PLATFORMS, REGIONS, BRAND } = require('../constants');

const LFG_TTL = 60 * 60 * 1000;
const QUEUE_TTL = 30 * 60 * 1000;
const platformChoices = PLATFORMS.map((p) => ({ name: p.name, value: p.key }));

const commands = [
  new SlashCommandBuilder().setName('lfg').setDescription('Post that you\'re looking for games')
    .addStringOption((o) => o.setName('platform').setDescription('Where you play').setRequired(true).addChoices(...platformChoices))
    .addStringOption((o) => o.setName('type').setDescription('What kind of games').setRequired(true).addChoices(
      { name: 'Casuals / player match', value: 'Casuals' }, { name: 'Ranked together', value: 'Ranked' },
      { name: 'Long set (FT5+)', value: 'Long set' }, { name: 'Lab / training', value: 'Lab session' },
      { name: 'Coaching / learning', value: 'Coaching' },
    ))
    .addStringOption((o) => o.setName('region').setDescription('Your region').addChoices(...REGIONS.map((r) => ({ name: r.name, value: r.key }))))
    .addStringOption((o) => o.setName('note').setDescription('e.g. "Jin main, Fujin, want to practise vs King"').setMaxLength(200)),
  new SlashCommandBuilder().setName('queue').setDescription('Matchmaking: get paired with the next player on your platform')
    .addStringOption((o) => o.setName('platform').setDescription('Where you play').setRequired(true).addChoices(...platformChoices)),
  new SlashCommandBuilder().setName('challenge').setDescription('Challenge someone to a set (counts for the ladder)')
    .addUserOption((o) => o.setName('opponent').setDescription('Who you\'re calling out').setRequired(true))
    .addIntegerOption((o) => o.setName('first_to').setDescription('First to how many wins (default 3)').setMinValue(1).setMaxValue(10)),
];

// ---------- Elo ----------
function recordSet(winner, loser, ft) {
  const w = getUser(winner), l = getUser(loser);
  const expected = 1 / (1 + 10 ** ((l.elo - w.elo) / 400));
  const delta = Math.max(1, Math.round(32 * (1 - expected)));
  db.prepare('UPDATE users SET elo = elo + ?, wins = wins + 1 WHERE id = ?').run(delta, winner);
  db.prepare('UPDATE users SET elo = MAX(100, elo - ?), losses = losses + 1 WHERE id = ?').run(delta, loser);
  db.prepare('INSERT INTO matches (winner, loser, ft, ts) VALUES (?, ?, ?, ?)').run(winner, loser, ft, Date.now());
  return { delta, wElo: w.elo + delta, lElo: Math.max(100, l.elo - delta) };
}

const challenges = new Map(); // id -> { a, b, ft, state, claim }
let nextId = 1;
const queue = new Map(); // platform -> { userId, ts }

const resultRow = (id, c, aName, bName) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`ch:won:${id}:${c.a}`).setLabel(`${aName} won`.slice(0, 80)).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`ch:won:${id}:${c.b}`).setLabel(`${bName} won`.slice(0, 80)).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`ch:cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
);

const rolesOf = (member, map) => Object.values(map).filter((id) => member.roles.cache.has(id));

async function interaction(i) {
  if (i.isChatInputCommand() && i.commandName === 'lfg') {
    const wait = cooldown('lfg', i.user.id, 600);
    if (wait) return ephemeral(i, `You can post another LFG in ${Math.ceil(wait / 60)} min.`), true;
    const platform = PLATFORMS.find((p) => p.key === i.options.getString('platform'));
    const region = REGIONS.find((r) => r.key === i.options.getString('region'));
    const ch = i.guild.channels.cache.get(cfg.channels.lfg);
    const mains = rolesOf(i.member, cfg.mainRoles).map((id) => `<@&${id}>`);
    const rank = rolesOf(i.member, cfg.rankRoles)[0];
    await ch.send({
      content: `<@&${cfg.pingRoles.lfg}>`,
      embeds: [embed({
        author: { name: `${i.member.displayName} is looking for games`, icon_url: i.user.displayAvatarURL() },
        description: i.options.getString('note') ?? undefined,
        fields: [
          { name: 'Type', value: i.options.getString('type'), inline: true },
          { name: 'Platform', value: platform.name, inline: true },
          { name: 'Region', value: region?.name ?? 'Any', inline: true },
          { name: 'Mains', value: mains.join(' ') || '—', inline: true },
          { name: 'Rank', value: rank ? `<@&${rank}>` : '—', inline: true },
          { name: 'Expires', value: `<t:${Math.floor((Date.now() + LFG_TTL) / 1000)}:R>`, inline: true },
        ],
        color: BRAND.green,
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg:join:${i.user.id}`).setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lfg:close:${i.user.id}`).setLabel('Found someone').setStyle(ButtonStyle.Secondary),
      )],
      allowedMentions: { roles: [cfg.pingRoles.lfg] },
    });
    return ephemeral(i, `Posted in <#${ch.id}>. You'll be pinged when someone joins.`), true;
  }

  if (i.isButton() && i.customId.startsWith('lfg:')) {
    const [, action, owner] = i.customId.split(':');
    if (action === 'close') {
      if (i.user.id !== owner) return ephemeral(i, 'Only the person who posted can close this.'), true;
      await i.message.delete().catch(() => {});
      return true;
    }
    if (i.user.id === owner) return ephemeral(i, 'You can\'t join your own post.'), true;
    if (cooldown(`lfgjoin:${i.message.id}`, i.user.id, 3600)) return ephemeral(i, 'You already joined this one.'), true;
    await i.reply({ content: `${E('arrow')} <@${owner}>, **${i.member.displayName}** wants to play. Sort it out in DMs or hop in <#${cfg.channels.voiceLobby}>.`, allowedMentions: { users: [owner] } });
    return true;
  }

  if (i.isChatInputCommand() && i.commandName === 'queue') {
    const key = i.options.getString('platform');
    const platform = PLATFORMS.find((p) => p.key === key);
    const waiting = queue.get(key);
    if (waiting && Date.now() - waiting.ts > QUEUE_TTL) queue.delete(key);
    const other = queue.get(key);
    if (other?.userId === i.user.id) {
      queue.delete(key);
      return ephemeral(i, 'You left the queue.'), true;
    }
    if (!other) {
      queue.set(key, { userId: i.user.id, ts: Date.now() });
      return ephemeral(i, `You're in the **${platform.name}** queue. You'll be pinged in <#${cfg.channels.lfg}> when someone joins (30 min). Run \`/queue\` again to leave.`), true;
    }
    queue.delete(key);
    const ch = i.guild.channels.cache.get(cfg.channels.lfg);
    await ch.send({
      content: `<@${other.userId}> <@${i.user.id}>`,
      embeds: [embed({ title: 'Match found', description: `${E('arrow')} <@${other.userId}> vs <@${i.user.id}> on **${platform.name}**\nAdd each other and play. Want it to count? Use \`/challenge\`.`, color: BRAND.green })],
    });
    return ephemeral(i, `Matched! Check <#${ch.id}>.`), true;
  }

  if (i.isChatInputCommand() && i.commandName === 'challenge') {
    const opp = i.options.getUser('opponent');
    if (opp.bot || opp.id === i.user.id) return ephemeral(i, 'Pick a real opponent.'), true;
    const wait = cooldown('challenge', i.user.id, 120);
    if (wait) return ephemeral(i, `Wait ${wait}s before sending another challenge.`), true;
    const ft = i.options.getInteger('first_to') ?? 3;
    const id = nextId++;
    challenges.set(id, { a: i.user.id, b: opp.id, ft, state: 'pending' });
    setTimeout(() => challenges.delete(id), 3 * 60 * 60 * 1000);
    await i.reply({
      content: `${opp}`,
      embeds: [embed({ title: 'A new challenger approaches', description: `${i.user} challenges ${opp} to a **first to ${ft}**.\nDo you accept?` })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ch:accept:${id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ch:decline:${id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
      )],
    });
    return true;
  }

  if (i.isButton() && i.customId.startsWith('ch:')) {
    const [, action, idStr, who] = i.customId.split(':');
    const id = Number(idStr);
    const c = challenges.get(id);
    if (!c) return ephemeral(i, 'This challenge expired.'), true;
    if (![c.a, c.b].includes(i.user.id)) return ephemeral(i, 'This isn\'t your set.'), true;
    const nameA = (await i.guild.members.fetch(c.a)).displayName, nameB = (await i.guild.members.fetch(c.b)).displayName;
    const title = `${nameA} vs ${nameB} · first to ${c.ft}`;

    if (action === 'decline' || action === 'accept') {
      if (i.user.id !== c.b) return ephemeral(i, 'Only the challenged player can answer.'), true;
      if (action === 'decline') {
        challenges.delete(id);
        await i.update({ content: '', components: [], embeds: [embed({ title: 'Challenge declined', description: `<@${c.b}> passed on <@${c.a}>'s challenge.`, color: BRAND.gray })] });
        return true;
      }
      c.state = 'playing';
      await i.update({
        content: '',
        embeds: [embed({ title, description: 'Go play. When you\'re done, **either player** reports the winner.\nIf you report yourself as the winner, your opponent has to confirm.' })],
        components: [resultRow(id, c, nameA, nameB)],
      });
      return true;
    }

    if (action === 'cancel') {
      challenges.delete(id);
      await i.update({ components: [], embeds: [embed({ title: 'Set cancelled', description: `Cancelled by ${i.user}.`, color: BRAND.gray })] });
      return true;
    }

    if (action === 'won' && c.state === 'playing') {
      const winner = who, loser = winner === c.a ? c.b : c.a;
      // Conceding counts immediately; claiming your own win needs the other player to confirm.
      const confirmed = i.user.id === loser || (c.claim && c.claim.winner === winner && c.claim.by !== i.user.id);
      if (!confirmed) {
        if (c.claim && c.claim.winner !== winner) {
          challenges.delete(id);
          await i.update({ components: [], embeds: [embed({ title: 'Disputed result', description: 'Both players claimed the win, so it wasn\'t counted. Staff have been notified.', color: BRAND.gold })] });
          await modLog(i.guild, { title: 'Disputed set', description: `<@${c.a}> vs <@${c.b}> (FT${c.ft}): both claimed the win. ${i.message.url}`, color: BRAND.gold });
          return true;
        }
        c.claim = { winner, by: i.user.id };
        await i.update({ embeds: [embed({ title, description: `<@${winner}> says they won.\n<@${loser}>, press **${winner === c.a ? nameA : nameB} won** to confirm.`, color: BRAND.gold })], components: [resultRow(id, c, nameA, nameB)] });
        return true;
      }
      challenges.delete(id);
      const { delta, wElo, lElo } = recordSet(winner, loser, c.ft);
      await i.update({
        components: [],
        embeds: [embed({
          title: 'Set complete',
          description: `<@${winner}> beat <@${loser}> (first to ${c.ft})\n\n${E('win')} <@${winner}> **${wElo}** (+${delta})\n${E('loss')} <@${loser}> **${lElo}** (-${delta})\n\nSee the ladder with \`/leaderboard type:Ladder\``,
          color: BRAND.green,
        })],
      });
      return true;
    }
    return ephemeral(i, 'That button isn\'t active right now.'), true;
  }
  return false;
}

// Delete expired LFG posts and join pings.
async function sweepLfg(client) {
  const ch = client.guilds.cache.get(cfg.guildId)?.channels.cache.get(cfg.channels.lfg);
  const msgs = await ch?.messages.fetch({ limit: 100 }).catch(() => null);
  if (!msgs) return;
  for (const m of msgs.values()) {
    if (m.author.id === client.user.id && m.id !== cfg.panels.lfgInfo && Date.now() - m.createdTimestamp > LFG_TTL) await m.delete().catch(() => {});
  }
}

function init(client) {
  client.once(Events.ClientReady, () => {
    sweepLfg(client);
    setInterval(() => sweepLfg(client), 10 * 60 * 1000);
  });
}

module.exports = { commands, interaction, init };
