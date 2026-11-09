// Moderation: commands, chat filters, level-gated links/media, anti-spam, anti-raid,
// ghost-ping alerts, auto slowmode, dehoisting, escalating warnings and audit logs.
const {
  SlashCommandBuilder, PermissionFlagsBits: P, Events, ChannelType, GuildVerificationLevel, AutoModerationActionType,
} = require('discord.js');
const { cfg, embed, E, ephemeral, modLog, isStaff, isSupporter, levelFor, flagged, cooldown } = require('../util');
const { db, getUser, kvGet, kvSet } = require('../db');
const { BRAND, LINK_LEVEL, MEDIA_LEVEL } = require('../constants');

const mod = (b) => b.setDefaultMemberPermissions(P.ModerateMembers);
const userOpt = (o) => o.setName('user').setDescription('Member').setRequired(true);

const commands = [
  mod(new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(userOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true))),
  mod(new SlashCommandBuilder().setName('warnings').setDescription('See a member\'s warnings').addUserOption(userOpt)),
  mod(new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear a member\'s warnings').addUserOption(userOpt)),
  mod(new SlashCommandBuilder().setName('userinfo').setDescription('Account age, join date, level and record').addUserOption(userOpt)),
  mod(new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(userOpt)
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long (max 40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('reason').setDescription('Why'))),
  mod(new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout').addUserOption(userOpt)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(P.KickMembers).addUserOption(userOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Why')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').setDefaultMemberPermissions(P.BanMembers).addUserOption(userOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Why'))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages').setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only this member\'s messages')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode in this channel').setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('seconds').setDescription('0 turns it off').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lockdown').setDescription('Stop members chatting everywhere (for raids)').setDefaultMemberPermissions(P.ManageMessages)
    .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
  new SlashCommandBuilder().setName('supporter').setDescription('Give or remove the Supporter role (paid supporters)').setDefaultMemberPermissions(P.ManageGuild)
    .addStringOption((o) => o.setName('action').setDescription('give or remove').setRequired(true).addChoices({ name: 'give', value: 'give' }, { name: 'remove', value: 'remove' }))
    .addUserOption(userOpt),
];

// ---------- warnings ----------
function addWarning(userId, modId, reason) {
  db.prepare('INSERT INTO warnings (user_id, mod_id, reason, ts) VALUES (?, ?, ?, ?)').run(userId, modId, reason, Date.now());
  return db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?').get(userId).n;
}

async function escalate(guild, userId, count) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.moderatable) return null;
  const minutes = count >= 5 ? 24 * 60 : count >= 3 ? 60 : 0;
  if (!minutes) return null;
  await member.timeout(minutes * 60000, `Auto: ${count} warnings`);
  return `timed out for ${minutes >= 60 ? minutes / 60 + 'h' : minutes + 'm'} (${count} warnings)`;
}

async function warn(guild, user, modId, reason) {
  const count = addWarning(user.id, modId, reason);
  const extra = await escalate(guild, user.id, count);
  await user.send({ embeds: [embed({ title: `Warning in ${guild.name}`, description: `**Reason:** ${reason}\n**Warnings:** ${count}${extra ? `\nYou were ${extra}.` : ''}\n\nRepeat warnings lead to timeouts and bans.`, color: BRAND.gold })] }).catch(() => {});
  await modLog(guild, { title: 'Warning', description: `${E('warn')} <@${user.id}> warned by <@${modId}>\n**Reason:** ${reason}\n**Total:** ${count}${extra ? `\n**Action:** ${extra}` : ''}`, color: BRAND.gold });
  return { count, extra };
}

// ---------- lockdown ----------
// Locks only channels where @everyone can normally talk, and remembers them so unlock
// doesn't open up read-only channels.
async function setLockdown(guild, on) {
  const everyone = guild.roles.everyone.id;
  let ids;
  if (on) {
    const memberCats = ['catCommunity', 'catDojo', 'catPlay', 'catContent'].map((k) => cfg.channels[k]);
    ids = guild.channels.cache
      .filter((c) => memberCats.includes(c.parentId) && c.type !== ChannelType.GuildVoice && !c.permissionOverwrites.cache.get(everyone)?.deny.has(P.SendMessages))
      .map((c) => c.id);
    kvSet('lockdownChannels', JSON.stringify(ids));
  } else {
    ids = JSON.parse(kvGet('lockdownChannels') ?? '[]');
  }
  for (const id of ids) {
    await guild.channels.cache.get(id)?.permissionOverwrites.edit(everyone, { SendMessages: on ? false : null, SendMessagesInThreads: on ? false : null, CreatePublicThreads: on ? false : null }).catch(() => {});
  }
  return ids.length;
}

async function interaction(i) {
  if (!i.isChatInputCommand() || !commands.some((c) => c.name === i.commandName)) return false;
  const user = i.options.getUser('user');
  const reason = i.options.getString('reason') ?? 'No reason given';
  const target = user ? await i.guild.members.fetch(user.id).catch(() => null) : null;
  const protectedTarget = () => {
    if (target && (isStaff(target) || target.id === i.client.user.id)) { ephemeral(i, 'You can\'t use that on staff.'); return true; }
    return false;
  };

  switch (i.commandName) {
    case 'warn': {
      if (protectedTarget()) return true;
      const { count, extra } = await warn(i.guild, user, i.user.id, reason);
      return ephemeral(i, `Warned ${user} (${count} total)${extra ? `, ${extra}` : ''}.`), true;
    }
    case 'warnings': {
      const rows = db.prepare('SELECT * FROM warnings WHERE user_id = ? ORDER BY ts DESC LIMIT 15').all(user.id);
      return ephemeral(i, { embeds: [embed({
        title: `Warnings for ${user.username} (${rows.length})`,
        description: rows.map((r) => `${E('dot')} <t:${Math.floor(r.ts / 1000)}:R> by <@${r.mod_id}>: ${r.reason}`).join('\n') || 'Clean record.',
      })] }), true;
    }
    case 'clearwarnings': {
      const { changes } = db.prepare('DELETE FROM warnings WHERE user_id = ?').run(user.id);
      await modLog(i.guild, { title: 'Warnings cleared', description: `${changes} warnings for <@${user.id}> cleared by <@${i.user.id}>` });
      return ephemeral(i, `Cleared ${changes} warnings for ${user}.`), true;
    }
    case 'userinfo': {
      const u = getUser(user.id);
      const warns = db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?').get(user.id).n;
      return ephemeral(i, { embeds: [embed({
        author: { name: user.username, icon_url: user.displayAvatarURL() },
        fields: [
          { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Joined', value: target?.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` : 'Not in server', inline: true },
          { name: 'Level', value: `${levelFor(u.xp).level} (${u.messages} messages)`, inline: true },
          { name: 'Warnings', value: String(warns), inline: true },
          { name: 'Timed out', value: target?.isCommunicationDisabled() ? `until <t:${Math.floor(target.communicationDisabledUntilTimestamp / 1000)}:t>` : 'No', inline: true },
          { name: 'Roles', value: target?.roles.cache.filter((r) => r.id !== i.guild.id).map((r) => `<@&${r.id}>`).slice(0, 15).join(' ') || '—' },
        ],
      })] }), true;
    }
    case 'timeout': {
      if (protectedTarget()) return true;
      if (!target?.moderatable) return ephemeral(i, 'I can\'t timeout that member.'), true;
      const minutes = i.options.getInteger('minutes');
      await target.timeout(minutes * 60000, `${i.user.username}: ${reason}`);
      return ephemeral(i, `${user} timed out for ${minutes} min.`), true;
    }
    case 'untimeout': {
      if (!target) return ephemeral(i, 'They\'re not in the server.'), true;
      await target.timeout(null, `By ${i.user.username}`);
      return ephemeral(i, `Timeout removed for ${user}.`), true;
    }
    case 'kick': {
      if (protectedTarget()) return true;
      if (!target?.kickable) return ephemeral(i, 'I can\'t kick that member.'), true;
      await user.send(`You were kicked from **${i.guild.name}**. Reason: ${reason}`).catch(() => {});
      await target.kick(`${i.user.username}: ${reason}`);
      return ephemeral(i, `Kicked ${user.username}.`), true;
    }
    case 'ban': {
      if (protectedTarget()) return true;
      if (target && !target.bannable) return ephemeral(i, 'I can\'t ban that member.'), true;
      await user.send(`You were banned from **${i.guild.name}**. Reason: ${reason}`).catch(() => {});
      await i.guild.members.ban(user.id, { reason: `${i.user.username}: ${reason}`, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86400 });
      return ephemeral(i, `Banned ${user.username}.`), true;
    }
    case 'purge': {
      const amount = i.options.getInteger('amount');
      let msgs = await i.channel.messages.fetch({ limit: 100 });
      if (user) msgs = msgs.filter((m) => m.author.id === user.id);
      const deleted = await i.channel.bulkDelete([...msgs.values()].slice(0, amount), true);
      await modLog(i.guild, { title: 'Purge', description: `<@${i.user.id}> deleted ${deleted.size} messages in <#${i.channelId}>${user ? ` from <@${user.id}>` : ''}` });
      return ephemeral(i, `Deleted ${deleted.size} messages.`), true;
    }
    case 'slowmode': {
      const s = i.options.getInteger('seconds');
      await i.channel.setRateLimitPerUser(s);
      return ephemeral(i, s ? `Slowmode set to ${s}s.` : 'Slowmode off.'), true;
    }
    case 'lockdown': {
      await i.deferReply();
      const on = i.options.getString('state') === 'on';
      const n = await setLockdown(i.guild, on);
      await modLog(i.guild, { title: on ? 'Lockdown on' : 'Lockdown off', description: `By <@${i.user.id}> (${n} channels)`, color: on ? BRAND.color : BRAND.green });
      await i.editReply({ embeds: [embed(on
        ? { title: 'Server locked', description: 'Chat is paused while staff deal with something. Hang tight.' }
        : { title: 'Server unlocked', description: 'Carry on.', color: BRAND.green })] });
      return true;
    }
    case 'supporter': {
      if (!target) return ephemeral(i, 'They\'re not in the server.'), true;
      const give = i.options.getString('action') === 'give';
      if (give) { await target.roles.add(cfg.roles.supporter); kvSet(`paidSupporter:${target.id}`, '1'); }
      else { await target.roles.remove(cfg.roles.supporter); db.prepare('DELETE FROM kv WHERE key = ?').run(`paidSupporter:${target.id}`); }
      await modLog(i.guild, { title: give ? 'Supporter added' : 'Supporter removed', description: `${target} by <@${i.user.id}>` });
      return ephemeral(i, give ? `${target} is now a Supporter.` : `Removed Supporter from ${target}.`), true;
    }
  }
  return false;
}

// ---------- chat filters ----------
const LINK_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|gg|net|org|io|ru|xyz|tk|ly|me|tv|co|link|app|site|online|shop|store|click|top|info|biz)\b(?:\/\S*)?/gi;
const ALWAYS_OK = /^(?:www\.)?(?:tekkendocs\.com|wavu\.wiki|tekken\.com|bandainamcoent\.com)$/i;
const GIF_HOSTS = /^(?:www\.|media\.)?(?:tenor\.com|giphy\.com|media\.discordapp\.net|cdn\.discordapp\.com)$/i;
const REAL = /^(?:www\.)?(?:discord\.com|discord\.gg|discordapp\.com|discordapp\.net|discord\.media|steamcommunity\.com|steampowered\.com|store\.steampowered\.com)$/i;
const PHISH = /d[il1|]+[s5][ckq][o0][rl][dcl]|d[il1]sc[o0]rd-|disocrd|dicsord|discrod|steam[ck]o?mm?un|stearn|nitro|free-?gift|gift-?card/i;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;

const hostOf = (link) => {
  try { return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).hostname.toLowerCase(); } catch { return ''; }
};

function checkMessage(msg, level, trusted) {
  const text = msg.content;
  const links = text.match(LINK_RE) ?? [];
  const hosts = links.map(hostOf).filter(Boolean);
  if (hosts.some((h) => PHISH.test(h) && !REAL.test(h))) return { rule: 'phishing', note: 'That link looks like a scam and was removed.', severe: true };
  if (!trusted) {
    const gated = hosts.filter((h) => !ALWAYS_OK.test(h) && !(GIF_HOSTS.test(h) && level >= MEDIA_LEVEL));
    if (gated.length && level < LINK_LEVEL) return { rule: 'link', note: `Links unlock at **level ${LINK_LEVEL}** (you're level ${level}). Keep chatting! Check \`/rank\`.` };
    if (msg.mentions.users.size > 3 && level < LINK_LEVEL) return { rule: 'mentions', note: 'Too many mentions in one message.' };
  }
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.75) return { rule: 'caps', note: 'Easy on the caps lock.' };
  if ((text.match(EMOJI_RE) ?? []).length > 12) return { rule: 'emoji', note: 'Too many emojis in one message.' };
  if (text.split('\n').length > 15) return { rule: 'lines', note: 'Wall of text. Please keep messages shorter.' };
  if (/(.)\1{19,}/s.test(text)) return { rule: 'repeat', note: 'Please don\'t spam characters.' };
  return null;
}

const strikes = new Map(); // userId -> timestamps of filter hits
async function punishFilter(msg, hit) {
  await msg.delete().catch(() => {});
  if (cooldown('filternote', msg.author.id, 8) === 0) {
    msg.channel.send({ content: `${msg.author}`, embeds: [embed({ description: `${E('cross')} ${hit.note}`, color: BRAND.gray })] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 7000)).catch(() => {});
  }
  if (hit.severe) {
    if (msg.member.moderatable) await msg.member.timeout(60 * 60000, 'Auto: scam link').catch(() => {});
    await warn(msg.guild, msg.author, msg.client.user.id, 'Auto: posted a scam/phishing link');
    await modLog(msg.guild, { title: 'Scam link removed', description: `${msg.author} in <#${msg.channelId}>\n\`${msg.content.slice(0, 500)}\``, color: BRAND.color });
    return;
  }
  const now = Date.now();
  const list = (strikes.get(msg.author.id) ?? []).filter((t) => now - t < 120000);
  list.push(now);
  strikes.set(msg.author.id, list);
  if (list.length >= 4) {
    strikes.delete(msg.author.id);
    if (msg.member.moderatable) await msg.member.timeout(5 * 60000, 'Auto: repeated filter hits').catch(() => {});
    await warn(msg.guild, msg.author, msg.client.user.id, `Auto: kept breaking chat filters (${hit.rule})`);
  }
}

// ---------- anti-spam ----------
const SPAM = { windowMs: 5000, maxMsgs: 6, dupWindowMs: 30000, maxDups: 4, timeoutMs: 5 * 60000 };
const history = new Map(); // userId -> [{ts, content, id, channelId}]

function spamCheck(msg) {
  const now = Date.now();
  const content = msg.content.toLowerCase().trim();
  const list = (history.get(msg.author.id) ?? []).filter((m) => now - m.ts < SPAM.dupWindowMs);
  list.push({ ts: now, content, id: msg.id, channelId: msg.channelId });
  history.set(msg.author.id, list);
  const burst = list.filter((m) => now - m.ts < SPAM.windowMs);
  const dups = content ? list.filter((m) => m.content === content) : [];
  if (burst.length <= SPAM.maxMsgs && dups.length < SPAM.maxDups) return null;
  history.delete(msg.author.id);
  return burst.length > SPAM.maxMsgs ? { bad: burst, why: `${burst.length} messages in 5s` } : { bad: dups, why: `same message ${dups.length}x` };
}

async function punishSpam(msg, { bad, why }) {
  for (const m of bad) await msg.guild.channels.cache.get(m.channelId)?.messages.delete(m.id).catch(() => {});
  if (msg.member.moderatable) await msg.member.timeout(SPAM.timeoutMs, 'Auto: spam').catch(() => {});
  msg.channel.send({ embeds: [embed({ description: `${E('cross')} ${msg.author} was timed out for 5 minutes for spamming.`, color: BRAND.gray })] })
    .then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
  await warn(msg.guild, msg.author, msg.client.user.id, `Auto: spam (${why})`);
}

// Auto slowmode when a channel suddenly floods.
const channelActivity = new Map(); // channelId -> timestamps
const autoSlowed = new Set();
async function smartSlowmode(msg) {
  const now = Date.now();
  const list = (channelActivity.get(msg.channelId) ?? []).filter((t) => now - t < 10000);
  list.push(now);
  channelActivity.set(msg.channelId, list);
  const ch = msg.channel;
  if (list.length < 20 || autoSlowed.has(ch.id) || !ch.setRateLimitPerUser || ch.rateLimitPerUser >= 10) return;
  autoSlowed.add(ch.id);
  const before = ch.rateLimitPerUser;
  await ch.setRateLimitPerUser(10, 'Auto slowmode: chat flood').catch(() => {});
  await ch.send({ embeds: [embed({ description: 'Chat is moving fast, so slowmode is on for 5 minutes.', color: BRAND.gray })] }).catch(() => {});
  await modLog(msg.guild, { title: 'Auto slowmode', description: `<#${ch.id}> got ${list.length} messages in 10s.` });
  setTimeout(async () => { await ch.setRateLimitPerUser(before).catch(() => {}); autoSlowed.delete(ch.id); }, 5 * 60000);
}

// ---------- anti-raid ----------
const RAID = { windowMs: 60000, joins: 8, durationMs: 15 * 60000 };
let joins = [];
let raidUntil = 0;
let prevVerification = null;

async function antiRaid(member) {
  const now = Date.now();
  if (raidUntil > now && now - member.user.createdTimestamp < 7 * 86400000 && member.kickable) {
    await member.send(`**${member.guild.name}** is temporarily not accepting new accounts. Please try again later.`).catch(() => {});
    await member.kick('Anti-raid: new account during raid');
    await modLog(member.guild, { title: 'Raid protection', description: `Kicked new account ${member.user.username} during raid mode.`, color: BRAND.color });
    return;
  }
  joins = joins.filter((t) => now - t < RAID.windowMs);
  joins.push(now);
  if (joins.length < RAID.joins || raidUntil > now) return;
  raidUntil = now + RAID.durationMs;
  const guild = member.guild;
  prevVerification = guild.verificationLevel;
  await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-raid: join spike').catch(() => {});
  const modChat = guild.channels.cache.get(cfg.channels.modChat);
  await modChat?.send({ content: `<@&${cfg.roles.mod}>`, embeds: [embed({ title: 'Possible raid', description: `${joins.length} joins in the last minute.\n${E('dot')} Verification raised to phone-verified only for 15 min\n${E('dot')} New accounts (under 7 days) are kicked on join until then\n${E('dot')} Use \`/lockdown on\` if chat is flooding` })] });
  setTimeout(async () => {
    await guild.setVerificationLevel(prevVerification ?? GuildVerificationLevel.Medium, 'Anti-raid: over').catch(() => {});
    await modChat?.send({ embeds: [embed({ description: `${E('check')} Raid protection ended, verification level restored.`, color: BRAND.green })] });
  }, RAID.durationMs);
}

// Names starting with symbols to sit at the top of the member list get cleaned.
async function dehoist(member) {
  const name = member.displayName;
  if (!/^[^\p{L}\p{N}]/u.test(name) || !member.manageable || isStaff(member)) return;
  const fixed = name.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 32) || 'Fighter';
  await member.setNickname(fixed, 'Dehoist').catch(() => {});
}

// ---------- logs ----------
const cut = (s, n = 1000) => (s && s.length > n ? s.slice(0, n) + '…' : s || '*(no text)*');

function init(client) {
  client.on(Events.MessageCreate, (msg) => {
    if (!msg.inGuild() || msg.author.bot || !msg.member || isStaff(msg.member)) return;
    smartSlowmode(msg).catch(console.error);
    if (flagged.has(msg.id)) return;
    // Decide synchronously so other listeners (XP) can see the flag.
    const spam = spamCheck(msg);
    if (spam) { flagged.add(msg.id); punishSpam(msg, spam).catch(console.error); return; }
    const level = levelFor(getUser(msg.author.id).xp).level;
    const hit = checkMessage(msg, level, isSupporter(msg.member));
    if (hit) { flagged.add(msg.id); punishFilter(msg, hit).catch(console.error); }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    antiRaid(member).catch(console.error);
    dehoist(member).catch(() => {});
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    await modLog(member.guild, {
      title: 'Member joined',
      description: `${member} (${member.user.username})\nAccount created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${ageDays < 7 ? `\n${E('warn')} **New account, keep an eye on them.**` : ''}`,
      color: ageDays < 7 ? BRAND.gold : BRAND.green,
      thumbnail: { url: member.displayAvatarURL() },
    });
  });

  client.on(Events.GuildMemberRemove, (member) => modLog(member.guild, {
    title: 'Member left', description: `${member.user.username} (<@${member.id}>)\nRoles: ${member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name).join(', ') || 'none'}`,
  }));

  client.on(Events.GuildMemberUpdate, (before, after) => {
    const was = before.communicationDisabledUntilTimestamp ?? 0, now = after.communicationDisabledUntilTimestamp ?? 0;
    if (now > Date.now() && now !== was) modLog(after.guild, { title: 'Timed out', description: `${after} until <t:${Math.floor(now / 1000)}:f>`, color: BRAND.gold });
    if (before.nickname !== after.nickname) {
      modLog(after.guild, { title: 'Nickname changed', description: `${after}: \`${before.nickname ?? before.user.username}\` → \`${after.nickname ?? after.user.username}\`` });
      dehoist(after).catch(() => {});
    }
  });

  client.on(Events.GuildBanAdd, (ban) => modLog(ban.guild, { title: 'Banned', description: `${ban.user.username} (<@${ban.user.id}>)\n${ban.reason ?? ''}`, color: BRAND.color }));

  client.on(Events.MessageDelete, async (msg) => {
    if (!msg.inGuild() || msg.author?.bot || msg.channelId === cfg.channels.modLogs) return;
    // Ghost ping: someone pinged people and deleted it within a minute (ignore our own filter deletes).
    const pinged = msg.mentions?.users.filter((u) => !u.bot && u.id !== msg.author?.id);
    if (!flagged.has(msg.id) && pinged?.size && Date.now() - msg.createdTimestamp < 60000 && !isStaff(msg.member)) {
      await msg.channel.send({ embeds: [embed({ description: `${E('warn')} **Ghost ping** by ${msg.author} → ${pinged.map((u) => `${u}`).join(' ')}\n> ${cut(msg.content, 300)}`, color: BRAND.gold })], allowedMentions: { parse: [] } }).catch(() => {});
    }
    modLog(msg.guild, {
      title: 'Message deleted',
      description: `**By** ${msg.author ?? 'unknown'} in <#${msg.channelId}>${flagged.has(msg.id) ? ' (auto filter)' : ''}\n${cut(msg.content)}${msg.attachments?.size ? `\nAttachments: ${msg.attachments.map((a) => a.name).join(', ')}` : ''}`,
      color: BRAND.color,
    });
  });

  client.on(Events.MessageUpdate, async (before, after) => {
    if (!after.inGuild() || after.author?.bot || before.partial || before.content === after.content) return;
    modLog(after.guild, {
      title: 'Message edited',
      description: `**By** ${after.author} in <#${after.channelId}> · [jump](${after.url})\n**Before:** ${cut(before.content, 500)}\n**After:** ${cut(after.content, 500)}`,
    });
    // Re-check edits so filters can't be dodged by editing a message afterwards.
    const member = after.member ?? await after.guild.members.fetch(after.author.id).catch(() => null);
    if (!member || isStaff(member)) return;
    const hit = checkMessage(after, levelFor(getUser(after.author.id).xp).level, isSupporter(member));
    if (hit) { flagged.add(after.id); punishFilter(Object.assign(after, { member }), hit).catch(console.error); }
  });

  // Slur AutoMod hits also count as a warning, so repeat offenders escalate automatically.
  client.on(Events.AutoModerationActionExecution, async (exec) => {
    if (exec.action.type !== AutoModerationActionType.BlockMessage) return;
    const rule = exec.autoModerationRule ?? await exec.guild.autoModerationRules.fetch(exec.ruleId).catch(() => null);
    if (!rule || !/slur/i.test(rule.name)) return;
    const user = await client.users.fetch(exec.userId).catch(() => null);
    if (user) await warn(exec.guild, user, client.user.id, `AutoMod: ${rule.name}`);
  });
}

module.exports = { commands, interaction, init };
