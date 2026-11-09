// Verify gate (with a quick captcha), role menus, name colors, welcome cards, tickets,
// suggestions, Hall of Fame, member counter, booster perks, /socials.
const {
  SlashCommandBuilder, ChannelType, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder,
} = require('discord.js');
const { cfg, embed, E, cooldown, ephemeral, modLog, isStaff, isSupporter, levelFor, pick, flagged } = require('../util');
const { MEDIA_LEVEL } = require('../constants');
const { db, getUser, kvGet, kvSet } = require('../db');
const { BRAND, SOCIALS, CHARACTERS, NAME_COLORS, COLOR_LEVEL } = require('../constants');
const art = require('../images');

const STAR = '⭐';
const STAR_MIN = 3;
const STAR_CHANNELS = () => ['general', 'clips', 'memes', 'tekkenTalk', 'combos'].map((k) => cfg.channels[k]);
const MIN_ACCOUNT_AGE_H = 24;

const half = Math.ceil(CHARACTERS.length / 2);
const ROLE_GROUPS = {
  mainA: { map: cfg.mainRoles, keys: CHARACTERS.slice(0, half).map((c) => c.slug), label: 'mains' },
  mainB: { map: cfg.mainRoles, keys: CHARACTERS.slice(half).map((c) => c.slug), label: 'mains' },
  rank: { map: cfg.rankRoles, label: 'rank' },
  platform: { map: cfg.platformRoles, label: 'platforms' },
  region: { map: cfg.regionRoles, label: 'region' },
  pings: { map: cfg.pingRoles, label: 'notifications' },
};

const commands = [
  new SlashCommandBuilder().setName('socials').setDescription(`Links to @${BRAND.handle}`),
  new SlashCommandBuilder().setName('color').setDescription(`Pick a name color (level ${COLOR_LEVEL}+ or Supporter)`)
    .addStringOption((o) => o.setName('color').setDescription('Color').setRequired(true)
      .addChoices({ name: 'No color', value: 'none' }, ...NAME_COLORS.map((c) => ({ name: c.name, value: c.key })))),
];

const canUseColors = (member) => isStaff(member) || isSupporter(member) || levelFor(getUser(member.id).xp).level >= COLOR_LEVEL;

async function setColor(i, key) {
  if (!canUseColors(i.member)) return ephemeral(i, `Name colors unlock at **level ${COLOR_LEVEL}** (you can check yours with \`/rank\`). Supporters get them right away.`);
  const all = Object.values(cfg.colorRoles).filter((id) => i.member.roles.cache.has(id));
  if (all.length) await i.member.roles.remove(all);
  if (key !== 'none') await i.member.roles.add(cfg.colorRoles[key]);
  return ephemeral(i, key === 'none' ? 'Name color removed.' : `Your name is now **${NAME_COLORS.find((c) => c.key === key).name}**.`);
}

// Captcha: simple sum the user types into a modal.
const captchas = new Map(); // userId -> answer

async function interaction(i) {
  if (i.isChatInputCommand() && i.commandName === 'socials') {
    await i.reply({
      embeds: [embed({ title: `@${BRAND.handle}`, description: 'Same handle on every platform.' })],
      components: [new ActionRowBuilder().addComponents(SOCIALS.map((s) => new ButtonBuilder().setLabel(s.name).setStyle(ButtonStyle.Link).setURL(s.url)))],
    });
    return true;
  }
  if (i.isChatInputCommand() && i.commandName === 'color') return setColor(i, i.options.getString('color')), true;
  if (i.isStringSelectMenu() && i.customId === 'roles:color') return setColor(i, i.values[0] ?? 'none'), true;

  if (i.isButton() && i.customId === 'verify:go') {
    if (i.member.roles.cache.has(cfg.roles.verified)) return ephemeral(i, 'You\'re already verified.'), true;
    const ageH = (Date.now() - i.user.createdTimestamp) / 3600000;
    if (ageH < MIN_ACCOUNT_AGE_H) {
      await modLog(i.guild, { title: 'Verification blocked', description: `${i.user} tried to verify with an account that is ${Math.floor(ageH)}h old.`, color: BRAND.gold });
      return ephemeral(i, `Your Discord account is too new. Accounts must be at least ${MIN_ACCOUNT_AGE_H} hours old to join; try again <t:${Math.floor((i.user.createdTimestamp + MIN_ACCOUNT_AGE_H * 3600000) / 1000)}:R>.`), true;
    }
    const a = 2 + Math.floor(Math.random() * 8), b = 2 + Math.floor(Math.random() * 8);
    captchas.set(i.user.id, a + b);
    await i.showModal(new ModalBuilder().setCustomId('verify:answer').setTitle('Quick check').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel(`What is ${a} + ${b}?`).setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(true)),
    ));
    return true;
  }

  if (i.isModalSubmit() && i.customId === 'verify:answer') {
    const expected = captchas.get(i.user.id);
    captchas.delete(i.user.id);
    if (Number(i.fields.getTextInputValue('answer').trim()) !== expected) return ephemeral(i, `${E('cross')} That's not right. Press the button again to get a new question.`), true;
    await i.member.roles.add(cfg.roles.verified, 'Verified (captcha)');
    await ephemeral(i, {
      embeds: [embed({
        title: 'You\'re in',
        description: [
          `${E('arrow')} Pick your **main**, rank and region in <#${cfg.channels.roles}>`,
          `${E('arrow')} Read how everything works in <#${cfg.channels.guide}>`,
          `${E('arrow')} Say hi in <#${cfg.channels.general}>`,
          `${E('arrow')} Type \`/help\` to see what the bot can do`,
        ].join('\n'),
        color: BRAND.green,
      })],
    });
    return true;
  }

  if (i.isStringSelectMenu() && i.customId.startsWith('roles:')) {
    const group = ROLE_GROUPS[i.customId.split(':')[1]];
    if (!group) return false;
    const keys = group.keys ?? Object.keys(group.map);
    const groupRoleIds = keys.map((k) => group.map[k]).filter(Boolean);
    const wanted = new Set(i.values.map((v) => group.map[v]).filter(Boolean));
    const add = [...wanted].filter((id) => !i.member.roles.cache.has(id));
    const remove = groupRoleIds.filter((id) => !wanted.has(id) && i.member.roles.cache.has(id));
    if (add.length) await i.member.roles.add(add);
    if (remove.length) await i.member.roles.remove(remove);
    const names = [...wanted].map((id) => `<@&${id}>`).join(', ') || 'none';
    await ephemeral(i, `${E('check')} Updated your ${group.label}: ${names}`);
    return true;
  }

  if (i.isButton() && i.customId === 'ticket:open') {
    const existing = kvGet(`ticket:${i.user.id}`);
    if (existing && i.guild.channels.cache.has(existing)) return ephemeral(i, `You already have a ticket open: <#${existing}>`), true;
    const wait = cooldown('ticket', i.user.id, 600);
    if (wait) return ephemeral(i, `You can open another ticket in ${Math.ceil(wait / 60)} min.`), true;
    const ch = await i.guild.channels.create({
      name: `ticket-${i.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: cfg.channels.catTickets,
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] },
        { id: cfg.roles.mod, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
      ],
    });
    kvSet(`ticket:${i.user.id}`, ch.id);
    kvSet(`ticketOwner:${ch.id}`, i.user.id);
    await ch.send({
      content: `<@${i.user.id}> <@&${cfg.roles.mod}>`,
      embeds: [embed({ title: 'Ticket opened', description: 'Explain what\'s going on and a mod will reply here. Screenshots help.\nOnly you and staff can see this channel.', color: BRAND.blue })],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger))],
    });
    await ephemeral(i, `Ticket created: <#${ch.id}>`);
    return true;
  }

  if (i.isButton() && i.customId === 'ticket:close') {
    const ownerId = kvGet(`ticketOwner:${i.channel.id}`);
    if (!isStaff(i.member) && i.user.id !== ownerId) return ephemeral(i, 'Only staff or the ticket owner can close this.'), true;
    await i.reply('Closing this ticket in 5 seconds…');
    const msgs = await i.channel.messages.fetch({ limit: 100 });
    const transcript = [...msgs.values()].reverse().filter((m) => !m.author.bot && m.content)
      .map((m) => `${m.author.username}: ${m.content}`).join('\n').slice(-3500);
    await modLog(i.guild, { title: `Ticket closed: #${i.channel.name}`, description: `Closed by <@${i.user.id}>\n\`\`\`\n${transcript || '(no messages)'}\n\`\`\``, color: BRAND.blue });
    if (ownerId) db.prepare('DELETE FROM kv WHERE key IN (?, ?)').run(`ticket:${ownerId}`, `ticketOwner:${i.channel.id}`);
    setTimeout(() => i.channel.delete('Ticket closed').catch(() => {}), 5000);
    return true;
  }

  return false;
}

async function updateMemberCount(guild) {
  const ch = guild.channels.cache.get(cfg.channels.memberCount);
  if (!ch) return;
  const name = `Members: ${guild.memberCount.toLocaleString()}`;
  if (ch.name !== name) await ch.setName(name).catch(() => {}); // Discord allows ~2 renames / 10 min
}

const WELCOME_LINES = [
  'Hope you brought your punishers.', 'Block first, ask questions later.', 'Another challenger enters the ring.',
  'Pick a main and pull up to the lab.', 'The dojo just got stronger.', 'Mind the low pokes.',
];

function init(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    const ch = member.guild.channels.cache.get(cfg.channels.welcome);
    if (!ch) return;
    const card = await art.welcomeCard({ avatarURL: member.displayAvatarURL({ extension: 'png', size: 256 }), name: member.displayName, count: member.guild.memberCount });
    await ch.send({
      content: `Welcome ${member}! ${pick(WELCOME_LINES)}`,
      embeds: [embed({
        description: `${E('arrow')} New here? Read <#${cfg.channels.guide}>\n${E('arrow')} Change your main and roles any time in <#${cfg.channels.roles}>`,
        image: { url: 'attachment://welcome.png' },
      })],
      files: [new AttachmentBuilder(card, { name: 'welcome.png' })],
    }).catch(() => {});
  });

  // Boosters automatically become Supporters (and lose it when the boost ends).
  client.on(Events.GuildMemberUpdate, async (before, after) => {
    if (!before.premiumSince && after.premiumSince) {
      await after.roles.add(cfg.roles.supporter, 'Server booster').catch(() => {});
      after.guild.channels.cache.get(cfg.channels.general)?.send({ embeds: [embed({ description: `${after} just boosted the server and became a **Supporter**. Thank you!`, color: 0xff73fa })] }).catch(() => {});
    } else if (before.premiumSince && !after.premiumSince && !kvGet(`paidSupporter:${after.id}`)) {
      await after.roles.remove(cfg.roles.supporter, 'Boost ended').catch(() => {});
    }
  });

  // Suggestions forum: every new post gets vote reactions.
  client.on(Events.ThreadCreate, async (thread, isNew) => {
    if (!isNew || thread.parentId !== cfg.channels.suggestions) return;
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (!starter) return;
    await starter.react(cfg.emojis.wd_check ?? '👍').catch(() => {});
    await starter.react(cfg.emojis.wd_cross ?? '👎').catch(() => {});
  });

  // Media-only channels: plain chat gets removed with a pointer; clips get a comment thread.
  const hasMedia = (msg) => msg.attachments.size > 0 || msg.stickers.size > 0 || /https?:\/\/\S+/i.test(msg.content);
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.inGuild() || msg.author.bot || !msg.member || flagged.has(msg.id)) return;
    const isClips = msg.channelId === cfg.channels.clips;
    if (!isClips && msg.channelId !== cfg.channels.memes) return;
    if (!hasMedia(msg)) {
      if (isStaff(msg.member)) return;
      flagged.add(msg.id);
      await msg.delete().catch(() => {});
      const lvl = levelFor(getUser(msg.author.id).xp).level;
      const note = isClips
        ? `Only clips go here. To comment on one, use the thread under it. Chat goes in <#${cfg.channels.general}>.`
        : `Only memes (images, GIFs, links) go here. Chat goes in <#${cfg.channels.general}>.`;
      const unlock = lvl < MEDIA_LEVEL ? `\nUploads unlock at **level ${MEDIA_LEVEL}** (you're ${lvl}). GIF links work now.` : '';
      if (cooldown('medianote', msg.author.id, 15) === 0) {
        msg.channel.send({ content: `${msg.author}`, embeds: [embed({ description: `${E('cross')} ${note}${unlock}`, color: BRAND.gray })] })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
      }
      return;
    }
    if (isClips) await msg.startThread({ name: `${msg.member.displayName}'s clip`.slice(0, 90), autoArchiveDuration: 4320 }).catch(() => {});
  });

  // Hall of Fame (starboard).
  client.on(Events.MessageReactionAdd, async (reaction) => {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.emoji.name !== STAR || !STAR_CHANNELS().includes(reaction.message.channelId)) return;
    const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (msg.author.bot) return;
    const count = (await reaction.users.fetch()).filter((u) => u.id !== msg.author.id && !u.bot).size;
    if (count < STAR_MIN) return;
    const board = msg.guild.channels.cache.get(cfg.channels.hallOfFame);
    const row = db.prepare('SELECT board_id FROM starboard WHERE msg_id = ?').get(msg.id);
    const content = `${STAR} **${count}** · <#${msg.channelId}>`;
    if (row) {
      const posted = await board.messages.fetch(row.board_id).catch(() => null);
      if (posted) await posted.edit({ content });
      return;
    }
    const image = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
    const video = msg.attachments.find((a) => a.contentType?.startsWith('video/'));
    const e = embed({
      author: { name: msg.member?.displayName ?? msg.author.username, icon_url: msg.author.displayAvatarURL() },
      description: `${(msg.content || '').slice(0, 3800)}\n\n[Jump to message](${msg.url})`,
      color: BRAND.gold,
      timestamp: msg.createdAt.toISOString(),
    });
    if (image) e.setImage(image.url);
    const posted = await board.send({ content, embeds: [e], files: video && video.size < 8e6 ? [video.url] : [] });
    db.prepare('INSERT OR REPLACE INTO starboard (msg_id, board_id) VALUES (?, ?)').run(msg.id, posted.id);
  });

  client.once(Events.ClientReady, async () => {
    const guild = client.guilds.cache.get(cfg.guildId);
    await updateMemberCount(guild);
    setInterval(() => updateMemberCount(guild), 10 * 60 * 1000);
  });
}

module.exports = { commands, interaction, init };
