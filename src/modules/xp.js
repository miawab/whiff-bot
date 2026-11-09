// Chat + voice XP, /daily streaks, levels with perk roles, rank card images, leaderboards.
const { SlashCommandBuilder, Events, AttachmentBuilder } = require('discord.js');
const { cfg, embed, E, levelFor, flagged, isSupporter, cooldown, ephemeral } = require('../util');
const { db, getUser, kvGet, kvSet } = require('../db');
const { LEVEL_ROLES, BRAND, RANKS } = require('../constants');
const art = require('../images');

const XP_COOLDOWN_MS = 60000; // one XP drop per minute of chatting
const VOICE_XP = 8; // per minute in voice with others
const SUPPORTER_MULT = 1.5;

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Your rank card: level, XP and ladder stats')
    .addUserOption((o) => o.setName('user').setDescription('Someone else')),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP (streaks give more)'),
  new SlashCommandBuilder().setName('perks').setDescription('What each level unlocks'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 in the server')
    .addStringOption((o) => o.setName('type').setDescription('Which board').addChoices(
      { name: 'XP / levels', value: 'xp' }, { name: 'Ladder (1v1 Elo)', value: 'elo' }, { name: 'Trivia', value: 'trivia' },
    )),
];

async function grant(guild, userId, base) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const amount = Math.round(base * (isSupporter(member) ? SUPPORTER_MULT : 1));
  const u = getUser(userId);
  const xp = u.xp + amount;
  const { level } = levelFor(xp);
  db.prepare('UPDATE users SET xp = ?, level = ? WHERE id = ?').run(xp, level, userId);
  if (level > u.level && member) await onLevelUp(guild, member, level, u.level);
  return amount;
}

async function syncLevelRole(member, level) {
  const earned = LEVEL_ROLES.filter((r) => level >= r.level).at(-1);
  const target = earned && cfg.levelRoles[earned.level];
  const others = Object.values(cfg.levelRoles).filter((id) => id !== target && member.roles.cache.has(id));
  if (target && !member.roles.cache.has(target)) await member.roles.add(target).catch(() => {});
  if (others.length) await member.roles.remove(others).catch(() => {});
}

async function onLevelUp(guild, member, level, from = level - 1) {
  await syncLevelRole(member, level);
  // Every perk passed on the way (a big /daily can skip a level).
  const unlocked = LEVEL_ROLES.filter((r) => r.level > from && r.level <= level);
  const next = LEVEL_ROLES.find((r) => r.level > level);
  const ch = guild.channels.cache.get(cfg.channels.levelUps ?? cfg.channels.botCommands);
  const lines = [
    unlocked.length
      ? `${E('lv')} **Level ${level}!** You're now <@&${cfg.levelRoles[unlocked.at(-1).level]}>.`
      : `${E('lv')} **Level ${level}!** Keep it up.`,
    ...unlocked.map((r) => `${E('check')} **Unlocked:** ${r.perk}`),
    next && `-# Next unlock at level ${next.level}: ${next.perk}`,
  ].filter(Boolean);
  await ch?.send({
    content: `${member}`,
    embeds: [embed({ description: lines.join('\n'), color: unlocked.length ? BRAND.gold : BRAND.dark })],
    allowedMentions: { users: [member.id] },
  }).catch(() => {});
}

// Live leaderboard pinned at the bottom of #level-ups, edited in place.
async function leaderboardEmbed(guild) {
  const top = (sql) => db.prepare(sql).all();
  const xp = top('SELECT id, xp FROM users WHERE xp > 0 ORDER BY xp DESC LIMIT 10');
  const elo = top('SELECT id, elo, wins, losses FROM users WHERE wins + losses > 0 ORDER BY elo DESC LIMIT 5');
  const trivia = top('SELECT id, trivia FROM users WHERE trivia > 0 ORDER BY trivia DESC LIMIT 5');
  const medal = (n) => ['🥇', '🥈', '🥉'][n] ?? `\`${String(n + 1).padStart(2)}\``;
  return embed({
    title: 'Leaderboard',
    fields: [
      { name: 'Levels', value: xp.map((r, n) => `${medal(n)} <@${r.id}> · Level ${levelFor(r.xp).level} · ${r.xp.toLocaleString()} XP`).join('\n') || 'Nobody yet. Start chatting!' },
      { name: 'Ladder (Elo)', value: elo.map((r, n) => `${medal(n)} <@${r.id}> · ${r.elo} · ${r.wins}W-${r.losses}L`).join('\n') || 'No sets yet. Use `/challenge`.', inline: true },
      { name: 'Trivia', value: trivia.map((r, n) => `${medal(n)} <@${r.id}> · ${r.trivia} pts`).join('\n') || 'No points yet.', inline: true },
    ],
    footer: { text: 'Updates every 10 minutes' },
    timestamp: new Date().toISOString(),
    color: BRAND.gold,
  });
}
async function refreshLeaderboard(guild) {
  const ch = guild.channels.cache.get(cfg.channels.levelUps);
  if (!ch) return;
  const e = await leaderboardEmbed(guild);
  const id = kvGet('liveBoard');
  const msg = id ? await ch.messages.fetch(id).catch(() => null) : null;
  // Re-post if it got buried under level-up messages, so it's always easy to find.
  const latest = (await ch.messages.fetch({ limit: 1 }).catch(() => null))?.first();
  if (msg && latest?.id === msg.id) return msg.edit({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  if (msg) await msg.delete().catch(() => {});
  const posted = await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => null);
  if (posted) kvSet('liveBoard', posted.id);
}

async function interaction(i) {
  if (!i.isChatInputCommand()) return false;

  if (i.commandName === 'rank') {
    const user = i.options.getUser('user') ?? i.user;
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    const u = getUser(user.id);
    const { level, into, next } = levelFor(u.xp);
    const wait = cooldown('rank', i.user.id, 10);
    if (wait) return ephemeral(i, `Give it ${wait}s before the next rank card.`), true;
    const position = db.prepare('SELECT COUNT(*) + 1 AS p FROM users WHERE xp > ?').get(u.xp).p;
    const levelRole = LEVEL_ROLES.filter((r) => level >= r.level).at(-1);
    const main = member && Object.entries(cfg.mainRoles).find(([, id]) => member.roles.cache.has(id));
    const rank = member && RANKS.find((r) => member.roles.cache.has(cfg.rankRoles[r.key]));
    const title = [levelRole?.name ?? 'Fighter', main && `${member.guild.roles.cache.get(main[1])?.name} main`].filter(Boolean).join(' · ');
    await i.deferReply();
    const card = await art.rankCard({
      avatarURL: user.displayAvatarURL({ extension: 'png', size: 256 }),
      name: member?.displayName ?? user.username,
      level, into, next, position, totalXp: u.xp, title,
      color: rank ? rank.hex.replace('#37474f', '#b0bec5') : undefined,
      ladder: u.wins + u.losses ? `${u.elo} ELO · ${u.wins}W-${u.losses}L` : undefined,
    });
    const nextPerk = LEVEL_ROLES.find((r) => r.level > level);
    await i.editReply({
      content: nextPerk ? `-# Next unlock at level ${nextPerk.level}: ${nextPerk.perk}` : undefined,
      files: [new AttachmentBuilder(card, { name: 'rank.png' })],
    });
    return true;
  }

  if (i.commandName === 'daily') {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const last = kvGet(`daily:${i.user.id}`);
    if (last === today) {
      const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
      return ephemeral(i, `You already claimed today. Come back <t:${Math.floor(reset / 1000)}:R>.`), true;
    }
    const streak = last === yesterday ? Number(kvGet(`streak:${i.user.id}`) ?? 0) + 1 : 1;
    kvSet(`daily:${i.user.id}`, today);
    kvSet(`streak:${i.user.id}`, streak);
    const gained = await grant(i.guild, i.user.id, 60 + Math.min(streak - 1, 10) * 10);
    await i.reply({ embeds: [embed({
      description: `${E('xp')} **+${gained} XP** claimed.\n${E('dot')} Streak: **${streak} day${streak > 1 ? 's' : ''}**${streak < 11 ? ' (bigger bonus every day up to 10)' : ' (max bonus)'}`,
      color: BRAND.gold,
    })] });
    return true;
  }

  if (i.commandName === 'perks') {
    const lvl = levelFor(getUser(i.user.id).xp).level;
    await ephemeral(i, { embeds: [embed({
      title: 'Level perks',
      description: [
        ...LEVEL_ROLES.map((r) => `${lvl >= r.level ? E('check') : E('dot')} **Level ${r.level} · ${r.name}**: ${r.perk}`),
        `\nYou're level **${lvl}**. XP comes from chatting (once a minute), voice with others and \`/daily\`.`,
        `Supporters and boosters get **${SUPPORTER_MULT}x XP** plus every perk.`,
      ].join('\n'),
      color: BRAND.gold,
    })] });
    return true;
  }

  if (i.commandName === 'leaderboard') {
    const wait = cooldown('leaderboard', i.channelId, 10);
    if (wait) return ephemeral(i, `Just posted. Try again in ${wait}s.`), true;
    const type = i.options.getString('type') ?? 'xp';
    const sql = {
      xp: 'SELECT id, xp AS v FROM users WHERE xp > 0 ORDER BY xp DESC LIMIT 10',
      elo: 'SELECT id, elo AS v, wins, losses FROM users WHERE wins + losses > 0 ORDER BY elo DESC LIMIT 10',
      trivia: 'SELECT id, trivia AS v FROM users WHERE trivia > 0 ORDER BY trivia DESC LIMIT 10',
    }[type];
    const rows = db.prepare(sql).all();
    const fmt = {
      xp: (r) => `Level ${levelFor(r.v).level} · ${r.v.toLocaleString()} XP`,
      elo: (r) => `${r.v} Elo · ${r.wins}W-${r.losses}L`,
      trivia: (r) => `${r.v} pts`,
    }[type];
    const title = { xp: 'XP leaderboard', elo: 'Ladder (Elo)', trivia: 'Trivia leaderboard' }[type];
    await i.reply({
      embeds: [embed({ title, description: rows.map((r, n) => `\`${String(n + 1).padStart(2)}\` <@${r.id}> · ${fmt(r)}`).join('\n') || 'Nobody yet. Be the first.' })],
      allowedMentions: { parse: [] },
    });
    return true;
  }
  return false;
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.inGuild() || msg.author.bot || flagged.has(msg.id)) return;
    getUser(msg.author.id);
    db.prepare('UPDATE users SET messages = messages + 1 WHERE id = ?').run(msg.author.id);
    if (msg.content.length < 3) return;
    const u = getUser(msg.author.id);
    if (Date.now() - u.last_xp < XP_COOLDOWN_MS) return;
    db.prepare('UPDATE users SET last_xp = ? WHERE id = ?').run(Date.now(), msg.author.id);
    await grant(msg.guild, msg.author.id, 15 + Math.floor(Math.random() * 11));
  });

  client.once(Events.ClientReady, async () => {
    const guild = client.guilds.cache.get(cfg.guildId);
    // Make sure everyone's level role matches their XP (e.g. after level roles changed).
    for (const row of db.prepare('SELECT id, xp FROM users WHERE xp > 0').all()) {
      const m = guild.members.cache.get(row.id);
      if (m) await syncLevelRole(m, levelFor(row.xp).level);
    }
    refreshLeaderboard(guild).catch(console.error);
    setInterval(() => refreshLeaderboard(guild).catch(console.error), 10 * 60 * 1000);
    // Voice XP: every minute, people in voice with at least one other human (not deafened).
    setInterval(async () => {
      for (const ch of guild.channels.cache.filter((c) => c.isVoiceBased() && c.id !== guild.afkChannelId).values()) {
        const humans = ch.members.filter((m) => !m.user.bot && !m.voice.selfDeaf && !m.voice.serverDeaf);
        if (humans.size < 2) continue;
        for (const m of humans.values()) await grant(guild, m.id, VOICE_XP).catch(() => {});
      }
    }, 60000);
  });
}

module.exports = { commands, interaction, init, grant };
