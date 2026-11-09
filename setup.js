// Server builder. Creates/updates roles, channels, permissions, AutoMod, custom emojis,
// artwork and info panels, then saves every ID to data/config.json.
// Safe to re-run: it reuses and updates anything it already made.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits: P,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder,
  AutoModerationRuleTriggerType: Trig, AutoModerationActionType: Act, AutoModerationRuleEventType,
  GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications,
} = require('discord.js');
const {
  BRAND, SOCIALS, CHARACTERS, RANKS, PLATFORMS, REGIONS, PINGS, LEVEL_ROLES, NAME_COLORS, EMOJIS,
  LINK_LEVEL, MEDIA_LEVEL, COLOR_LEVEL,
} = require('./src/constants');
const art = require('./src/images');

const GUILD_ID = process.env.GUILD_ID || '1561361454303678575';
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
cfg.guildId = GUILD_ID;
for (const k of ['roles', 'channels', 'panels', 'mainRoles', 'rankRoles', 'platformRoles', 'regionRoles', 'pingRoles', 'levelRoles', 'colorRoles', 'emojis']) cfg[k] ??= {};
const save = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
const log = (...a) => console.log('•', ...a);

// Slur regexes (obfuscation tolerant). Used for messages and usernames.
const SLUR_REGEX = [
  'n+[i1!|l]+[gq9]{2,}(?:[e3]+r+|[a4@]+|[uo]+h+)?[sz]?',
  '\\bf+[a4@]+[gq9]+(?:[o0e3]+t+)?[sz]?\\b',
  '\\br+[e3]+t+[a4@]+r+d+(?:[sz]|ed)?\\b',
  '\\bk+[i1y]+k+[e3]+[sz]?\\b',
  '\\bsp+[i1]+c+[sz]?\\b',
  '\\btr+[a4@]+n+(?:y|ie)[sz]?\\b',
  '\\bc+[o0]{2,}n+[sz]?\\b',
  '\\bwet+backs?\\b',
  '\\bg+[o0]{2,}k+[sz]?\\b',
];
const INVITE_REGEX = [
  '(?:discord(?:app)?\\.(?:gg|com/invite)|dsc\\.gg|invite\\.gg)/\\S+',
  'free\\s*(?:discord\\s*)?nitro',
  'steam\\s*community\\.(?:ru|gift|link)',
];

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await client.application.fetch();
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.roles.fetch();
  await guild.channels.fetch();
  log(`Building ${guild.name}`);

  // ---------- CUSTOM EMOJIS ----------
  const appEmojis = await client.application.emojis.fetch();
  for (const e of EMOJIS.app) {
    let em = appEmojis.find((x) => x.name === e.name);
    if (!em) { em = await client.application.emojis.create({ attachment: art.badge(e), name: e.name }); log('app emoji +', e.name); }
    cfg.emojis[e.name] = `<:${em.name}:${em.id}>`;
  }
  const guildEmojis = await guild.emojis.fetch();
  for (const e of EMOJIS.guild) {
    let em = guildEmojis.find((x) => x.name === e.name);
    if (!em) {
      try { em = await guild.emojis.create({ attachment: art.badge(e), name: e.name }); log('server emoji +', e.name); } catch (err) { log('server emoji ✗', e.name, err.message); continue; }
    }
    cfg.emojis[e.name] = `<:${em.name}:${em.id}>`;
  }
  save();
  const E = (n) => cfg.emojis[`wd_${n}`] ?? '•';

  // ---------- ICON / BOT AVATAR (only once, so manual changes aren't overwritten) ----------
  if (!cfg.iconSet) {
    try { await guild.setIcon(art.icon('WD')); log('server icon set'); } catch (e) { log('server icon ✗', e.message); }
    try { await client.user.setAvatar(art.icon('WD')); log('bot avatar set'); } catch (e) { log('bot avatar ✗', e.message); }
    try { await client.user.setBanner(art.banner('Tekken Bot', `The official bot of ${BRAND.name}`)); log('bot banner set'); } catch (e) { log('bot banner ✗', e.message); }
    cfg.iconSet = true; save();
  }

  // ---------- ROLES ----------
  async function role(store, key, opts) {
    let r = store[key] && guild.roles.cache.get(store[key]);
    if (!r) r = guild.roles.cache.find((x) => x.name === opts.name && !x.managed);
    if (!r) { r = await guild.roles.create({ ...opts, reason: 'Server setup' }); log('role +', opts.name); }
    else {
      const want = { name: opts.name, color: opts.color ?? 0, hoist: !!opts.hoist, mentionable: !!opts.mentionable };
      if (opts.permissions) want.permissions = opts.permissions;
      const differs = r.name !== want.name || r.color !== want.color || r.hoist !== want.hoist
        || (want.permissions && !r.permissions.equals(want.permissions));
      if (differs) await r.edit(want).then(() => log('role ~', opts.name)).catch((e) => log('role ✗', opts.name, e.message));
    }
    store[key] = r.id;
    return r;
  }

  const MEDIA = [P.AttachFiles, P.UseExternalEmojis, P.UseExternalStickers];
  const ownerRole = await role(cfg.roles, 'owner', { name: 'Whifflord', color: BRAND.color, hoist: true, permissions: [P.Administrator] });
  // Tech: full access for whoever runs and changes the bot (stays even if server ownership moves).
  const techRole = await role(cfg.roles, 'tech', { name: 'Tech', color: 0x2a9d8f, hoist: true, permissions: [P.Administrator] });
  const modRole = await role(cfg.roles, 'mod', {
    name: 'Moderator', color: 0x5b8def, hoist: true,
    permissions: [P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.ManageNicknames,
      P.ViewAuditLog, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.MentionEveryone, ...MEDIA],
  });
  const supporterRole = await role(cfg.roles, 'supporter', { name: 'Supporter', color: 0xff73fa, hoist: true, permissions: MEDIA });
  const colorRoles = [];
  for (const c of NAME_COLORS) colorRoles.push(await role(cfg.colorRoles, c.key, { name: c.name, color: c.color, permissions: [] }));
  const lv = {};
  for (const l of LEVEL_ROLES) {
    lv[l.level] = await role(cfg.levelRoles, String(l.level), { name: l.name, color: l.color, hoist: !!l.hoist, permissions: l.level >= MEDIA_LEVEL ? MEDIA : [] });
  }
  for (const k of Object.keys(cfg.levelRoles)) if (!LEVEL_ROLES.some((l) => String(l.level) === k)) delete cfg.levelRoles[k];
  const rankRoles = [];
  for (const r of RANKS) rankRoles.push(await role(cfg.rankRoles, r.key, { name: r.name, color: r.color, permissions: [] }));
  const verifiedRole = await role(cfg.roles, 'verified', { name: 'Fighter', permissions: [] });
  const platformRoles = [];
  for (const p of PLATFORMS) platformRoles.push(await role(cfg.platformRoles, p.key, { name: p.name, permissions: [] }));
  const regionRoles = [];
  for (const r of REGIONS) regionRoles.push(await role(cfg.regionRoles, r.key, { name: r.name, permissions: [] }));
  const pingRoles = [];
  for (const p of PINGS) pingRoles.push(await role(cfg.pingRoles, p.key, { name: p.name, permissions: [] }));
  const mainRoles = [];
  for (const c of CHARACTERS) mainRoles.push(await role(cfg.mainRoles, c.slug, { name: c.name, permissions: [] }));
  save();

  // Order (top -> bottom). Name colors sit above ranks/levels so the chosen color shows.
  const levelsDesc = [...LEVEL_ROLES].reverse().map((l) => lv[l.level]);
  const order = [ownerRole, techRole, modRole, supporterRole, ...levelsDesc.filter((r, n) => LEVEL_ROLES.at(-1 - n).hoist),
    ...colorRoles, ...rankRoles, ...levelsDesc.filter((r, n) => !LEVEL_ROLES.at(-1 - n).hoist), verifiedRole,
    ...platformRoles, ...regionRoles, ...pingRoles, ...mainRoles];
  await guild.roles.fetch(undefined, { force: true });
  const botTop = guild.members.me.roles.highest.rawPosition;
  if (botTop > order.length) {
    await guild.roles.setPositions(order.map((r, i) => ({ role: r.id, position: botTop - 1 - i })));
    log('roles ordered');
  } else {
    // Not enough room to reorder everything: at least keep Tech right under the owner role.
    const tech = guild.roles.cache.get(techRole.id), modr = guild.roles.cache.get(modRole.id);
    if (tech.rawPosition < modr.rawPosition) {
      await guild.roles.setPositions([{ role: tech.id, position: modr.rawPosition }, { role: modr.id, position: modr.rawPosition - 1 }])
        .then(() => log('tech role moved under owner')).catch((e) => log('tech role move ✗', e.message));
    }
  }

  // Base @everyone permissions. Images/files/outside emojis come from level roles (Rookie+).
  await guild.roles.everyone.setPermissions([
    P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.SendMessagesInThreads, P.AddReactions,
    P.UseApplicationCommands, P.EmbedLinks, P.CreatePublicThreads, P.Connect, P.Speak, P.Stream, P.UseVAD,
    P.CreateInstantInvite, P.ChangeNickname, P.SendVoiceMessages, P.SendPolls, P.UseEmbeddedActivities, P.UseSoundboard,
  ]);

  try {
    const owner = await guild.members.fetch(guild.ownerId);
    await owner.roles.add([ownerRole, verifiedRole]);
    // Previous owners lose the owner role (they keep Tech if they have it).
    for (const m of ownerRole.members.values()) if (m.id !== guild.ownerId) await m.roles.remove(ownerRole).catch(() => {});
  } catch (e) { log('could not give owner role:', e.message); }
  cfg.techUserId ??= process.env.TECH_USER_ID || '723169032169193483';
  try {
    const tech = await guild.members.fetch(cfg.techUserId);
    await tech.roles.add([techRole, verifiedRole]);
    log('tech role ->', tech.user.username);
  } catch (e) { log('could not give tech role:', e.message); }

  // ---------- CHANNELS ----------
  const everyone = guild.roles.everyone.id;
  const allowRoles = (ids, extra = []) => ids.map((id) => ({ id, allow: [P.ViewChannel, ...extra] }));
  const OW = {
    start: [
      { id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.CreatePublicThreads, P.AddReactions] },
      { id: modRole.id, allow: [P.SendMessages] },
    ],
    // Member channels are open to everyone. Discord's own rules screening + AutoMod guard the door,
    // so people can always get in even when the bot is offline.
    // Chat channels: talk freely, but no bot commands (they live in #bot-commands etc.). Staff can still use them.
    members: [{ id: everyone, allow: [P.ViewChannel], deny: [P.UseApplicationCommands] }, { id: modRole.id, allow: [P.UseApplicationCommands] }],
    // Media channels: uploads/links only (the bot enforces it); comments go in threads the bot makes.
    media: [{ id: everyone, allow: [P.ViewChannel], deny: [P.UseApplicationCommands, P.CreatePublicThreads] }, { id: modRole.id, allow: [P.UseApplicationCommands] }],
    // Command channels: slash commands only, no normal messages.
    commands: [
      { id: everyone, allow: [P.ViewChannel, P.UseApplicationCommands, P.ReadMessageHistory], deny: [P.SendMessages, P.CreatePublicThreads, P.AddReactions] },
      { id: modRole.id, allow: [P.SendMessages] },
    ],
    // Bot feeds: only the bot posts; members talk in the thread under each post.
    feed: [
      { id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions, P.SendMessagesInThreads], deny: [P.SendMessages, P.CreatePublicThreads, P.UseApplicationCommands] },
      { id: modRole.id, allow: [P.SendMessages, P.UseApplicationCommands] },
    ],
    // Same, but /trivia can be started here.
    feedCommands: [
      { id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions, P.SendMessagesInThreads, P.UseApplicationCommands], deny: [P.SendMessages, P.CreatePublicThreads] },
      { id: modRole.id, allow: [P.SendMessages] },
    ],
    readonly: [
      { id: everyone, allow: [P.ViewChannel, P.AddReactions, P.UseApplicationCommands], deny: [P.SendMessages, P.CreatePublicThreads] },
      { id: modRole.id, allow: [P.SendMessages] },
    ],
    veterans: [{ id: everyone, deny: [P.ViewChannel, P.UseApplicationCommands] }, ...allowRoles([lv[20].id, lv[35].id, lv[50].id, supporterRole.id]), { id: modRole.id, allow: [P.ViewChannel, P.UseApplicationCommands] }],
    supporters: [{ id: everyone, deny: [P.ViewChannel, P.UseApplicationCommands] }, ...allowRoles([supporterRole.id]), { id: modRole.id, allow: [P.ViewChannel, P.UseApplicationCommands] }],
    staff: [{ id: everyone, deny: [P.ViewChannel] }, { id: modRole.id, allow: [P.ViewChannel] }],
    stats: [{ id: everyone, allow: [P.ViewChannel], deny: [P.Connect] }],
  };

  async function channel(key, spec) {
    let c = cfg.channels[key] && guild.channels.cache.get(cfg.channels[key]);
    if (c && c.type !== spec.type && spec.replaceType) { await c.delete('Changed channel type').catch(() => {}); log('channel - (type change)', c.name); c = null; }
    if (!c) c = guild.channels.cache.find((x) => x.name === spec.name && x.type === spec.type);
    const data = {
      name: spec.name, type: spec.type, topic: spec.topic,
      parent: spec.parent ?? null, rateLimitPerUser: spec.slow ?? 0,
      permissionOverwrites: spec.ow ? OW[spec.ow] : undefined,
    };
    if (spec.type === ChannelType.GuildCategory || spec.type === ChannelType.GuildVoice) { delete data.topic; delete data.rateLimitPerUser; }
    if (spec.type === ChannelType.GuildVoice && spec.limit) data.userLimit = spec.limit;
    if (spec.tags) data.availableTags = spec.tags.map((name) => ({ name }));
    if (!c) { c = await guild.channels.create({ ...data, reason: 'Server setup' }); log('channel +', spec.name); }
    else {
      const { type, ...edit } = data;
      if (spec.keepName) delete edit.name;
      if (spec.tags && c.availableTags?.length) delete edit.availableTags;
      await c.edit(edit);
    }
    if (spec.extra) await spec.extra(c);
    cfg.channels[key] = c.id;
    return c;
  }
  const T = ChannelType;
  let pos = 0;
  const at = (c) => c.setPosition(pos++).catch(() => {}); // keep channel order inside a category

  const catStart = await channel('catStart', { name: 'START HERE', type: T.GuildCategory, ow: 'start' });
  pos = 0;
  const guide = await channel('guide', { name: 'start-here', type: T.GuildText, parent: catStart.id, ow: 'start', topic: 'How this server works. Read this first.' }); await at(guide);
  const rules = await channel('rules', { name: 'rules', type: T.GuildText, parent: catStart.id, ow: 'start', topic: 'The rules. Breaking them gets you bodied.' }); await at(rules);
  if (cfg.channels.verify) { // old bot-run verify gate, replaced by Discord's rules screening
    await guild.channels.cache.get(cfg.channels.verify)?.delete('Replaced by Discord rules screening').catch(() => {});
    delete cfg.channels.verify;
    delete cfg.panels.verify;
  }
  const isCommunity = (await guild.fetch()).features.includes('COMMUNITY');
  const announce = await channel('announcements', { name: 'announcements', type: isCommunity ? T.GuildAnnouncement : T.GuildText, parent: catStart.id, ow: 'start', topic: 'Official news. Get Announcement Pings in #roles.' }); await at(announce);
  const rolesCh = await channel('roles', { name: 'roles', type: T.GuildText, parent: catStart.id, ow: 'readonly', topic: 'Pick your main, rank, platform, region and pings.' }); await at(rolesCh);
  const welcome = await channel('welcome', { name: 'welcome', type: T.GuildText, parent: catStart.id, ow: 'start', topic: 'New challengers approaching.' }); await at(welcome);
  const socials = await channel('socials', { name: 'socials', type: T.GuildText, parent: catStart.id, ow: 'start', topic: `Follow @${BRAND.handle} everywhere.` }); await at(socials);
  const memberCount = await channel('memberCount', { name: 'Members: …', type: T.GuildVoice, parent: catStart.id, ow: 'stats', keepName: true }); await at(memberCount);

  if (cfg.channels.catStats) { // old layout had a separate stats category
    await guild.channels.cache.get(cfg.channels.catStats)?.delete('Merged into START HERE').catch(() => {});
    delete cfg.channels.catStats;
  }

  const catCommunity = await channel('catCommunity', { name: 'COMMUNITY', type: T.GuildCategory, ow: 'members' });
  pos = 0;
  const general = await channel('general', { name: 'general', type: T.GuildText, parent: catCommunity.id, ow: 'members', slow: 2, topic: 'Main chat. Trash talk the gameplay, not the person.' }); await at(general);
  const tekkenTalk = await channel('tekkenTalk', { name: 'tekken-talk', type: T.GuildText, parent: catCommunity.id, ow: 'members', slow: 2, topic: 'Tekken 8 news, patches, balance and hot takes. Character of the Day posts here.' }); await at(tekkenTalk);
  const memes = await channel('memes', { name: 'memes', type: T.GuildText, parent: catCommunity.id, ow: 'media', slow: 10, topic: `Images, GIFs and links only (uploads unlock at level ${MEDIA_LEVEL}). Chat goes in #general. Star the good ones.` }); await at(memes);
  const suggestions = await channel('suggestions', { name: 'suggestions', type: T.GuildForum, replaceType: true, parent: catCommunity.id, ow: 'members', slow: 600, topic: 'One idea per post. Vote with the reactions, discuss inside the post.', tags: ['Idea', 'Planned', 'Done', 'Not doing'] }); await at(suggestions);
  const veterans = await channel('veterans', { name: 'veterans-lounge', type: T.GuildText, parent: catCommunity.id, ow: 'veterans', topic: 'For Veteran (level 20) and up, plus Supporters.' }); await at(veterans);

  const catBot = await channel('catBot', { name: 'LEVELS & GAMES', type: T.GuildCategory, ow: 'members' });
  pos = 0;
  const botCmds = await channel('botCommands', { name: 'bot-commands', type: T.GuildText, parent: catBot.id, ow: 'commands', topic: 'Slash commands only: /rank /daily /leaderboard /help. Chat in #general.' }); await at(botCmds);
  const levelUps = await channel('levelUps', { name: 'level-ups', type: T.GuildText, parent: catBot.id, ow: 'feed', topic: 'How levels work, level-up shoutouts and the live leaderboard.' }); await at(levelUps);
  const daily = await channel('daily', { name: 'daily', type: T.GuildText, parent: catBot.id, ow: 'feedCommands', topic: 'Character of the Day + trivia drops. Talk about each one in its thread.' }); await at(daily);

  const catDojo = await channel('catDojo', { name: 'THE DOJO', type: T.GuildCategory, ow: 'members' });
  pos = 0;
  const beginner = await channel('beginner', { name: 'beginner-questions', type: T.GuildText, parent: catDojo.id, ow: 'members', slow: 5, topic: 'No question is too basic. Be nice to new players.' }); await at(beginner);
  const frameData = await channel('frameData', { name: 'frame-data', type: T.GuildText, parent: catDojo.id, ow: 'commands', topic: 'Commands only: /frame /punish /character. Discuss in #combos-and-tech.' }); await at(frameData);
  const combos = await channel('combos', { name: 'combos-and-tech', type: T.GuildText, parent: catDojo.id, ow: 'members', slow: 5, topic: 'Combos, setups and tech. Notation: 1 LP, 2 RP, 3 LK, 4 RK.' }); await at(combos);
  const matchup = await channel('matchupHelp', { name: 'matchup-help', type: T.GuildForum, parent: catDojo.id, ow: 'members', topic: 'Make a post like "How do I beat King as Jin?"', tags: ['Matchup', 'Punishment', 'Movement', 'Mindset', 'Solved'] }); await at(matchup);
  const replay = await channel('replayReview', { name: 'replay-review', type: T.GuildForum, parent: catDojo.id, ow: 'members', topic: 'Post a replay or clip of your set for feedback. Include your main and rank.', tags: ['Beginner', 'Intermediate', 'Advanced', 'Reviewed'] }); await at(replay);

  const catPlay = await channel('catPlay', { name: 'PLAY', type: T.GuildCategory, ow: 'members' });
  pos = 0;
  const lfg = await channel('lfg', { name: 'looking-for-games', type: T.GuildText, parent: catPlay.id, ow: 'readonly', topic: 'Use /lfg or /queue. Posts expire after 1 hour.' }); await at(lfg);
  const challenges = await channel('challenges', { name: 'challenges', type: T.GuildText, parent: catPlay.id, ow: 'commands', topic: 'Commands only: /challenge @someone. Results count for the server ladder.' }); await at(challenges);
  const tournaments = await channel('tournaments', { name: 'tournaments', type: T.GuildText, parent: catPlay.id, ow: 'readonly', topic: 'Server tournaments. Sign up with the buttons.' }); await at(tournaments);
  const createRoom = await channel('createRoom', { name: '+ Create Room', type: T.GuildVoice, parent: catPlay.id, ow: 'members' }); await at(createRoom);
  for (const [key, name] of [['voiceLobby', 'Lobby'], ['voiceSets', 'Sets'], ['voiceLab', 'Training Lab'], ['voiceStream', 'Watch Party']]) {
    await at(await channel(key, { name, type: T.GuildVoice, parent: catPlay.id, ow: 'members' }));
  }

  const catContent = await channel('catContent', { name: 'CONTENT', type: T.GuildCategory, ow: 'members' });
  pos = 0;
  const whiffContent = await channel('whiffContent', { name: 'whifflord-content', type: T.GuildText, parent: catContent.id, ow: 'readonly', topic: `New posts and videos from @${BRAND.handle}.` }); await at(whiffContent);
  const clips = await channel('clips', { name: 'clips-and-highlights', type: T.GuildText, parent: catContent.id, ow: 'media', slow: 15, topic: `Clips and links only (uploads unlock at level ${MEDIA_LEVEL}). Comment in the thread under each clip. 3 stars = Hall of Fame.` }); await at(clips);
  const hallOfFame = await channel('hallOfFame', { name: 'hall-of-fame', type: T.GuildText, parent: catContent.id, ow: 'readonly', topic: 'Messages and clips that got 3+ stars.' }); await at(hallOfFame);

  const catSupporters = await channel('catSupporters', { name: 'SUPPORTERS', type: T.GuildCategory, ow: 'supporters' });
  const supportersLounge = await channel('supportersLounge', { name: 'supporters-lounge', type: T.GuildText, parent: catSupporters.id, ow: 'supporters', topic: 'Thank you for supporting the channel. Early content, polls and hangouts.' });

  const catSupport = await channel('catSupport', { name: 'SUPPORT', type: T.GuildCategory, ow: 'members' });
  const support = await channel('support', { name: 'support', type: T.GuildText, parent: catSupport.id, ow: 'readonly', topic: 'Need a mod? Open a private ticket.' });

  const catStaff = await channel('catStaff', { name: 'STAFF', type: T.GuildCategory, ow: 'staff' });
  const modChat = await channel('modChat', { name: 'mod-chat', type: T.GuildText, parent: catStaff.id, ow: 'staff' });
  const modLogs = await channel('modLogs', { name: 'mod-logs', type: T.GuildText, parent: catStaff.id, ow: 'staff', topic: 'Deleted/edited messages, joins, AutoMod hits, warnings.' });
  await channel('catTickets', { name: 'TICKETS', type: T.GuildCategory, ow: 'staff' });

  // Category order
  const cats = [catStart, catCommunity, catBot, catDojo, catPlay, catContent, catSupporters, catSupport, catStaff, guild.channels.cache.get(cfg.channels.catTickets)];
  for (const [n, c] of cats.entries()) await c.setPosition(n).catch(() => {});
  save();

  // ---------- COMMUNITY MODE + SAFETY SETTINGS ----------
  try {
    await guild.edit({
      features: [...new Set([...guild.features, 'COMMUNITY'])],
      rulesChannel: rules.id,
      publicUpdatesChannel: modChat.id,
      verificationLevel: GuildVerificationLevel.Medium,
      explicitContentFilter: GuildExplicitContentFilter.AllMembers,
      defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
      systemChannel: welcome.id,
      systemChannelFlags: 0b1111,
      description: `The official Tekken 8 community of @${BRAND.handle}. Find sets, learn the game, share clips.`,
    });
    log('community mode + safety settings ✓');
  } catch (e) { log('community mode ✗', e.message); }

  // ---------- AUTOMOD ----------
  const existing = await guild.autoModerationRules.fetch();
  const exempt = [ownerRole.id, modRole.id];
  async function automod(name, data, oldNames = []) {
    const old = existing.find((r) => r.name === name || oldNames.includes(r.name));
    const payload = { name, eventType: AutoModerationRuleEventType.MessageSend, enabled: true, ...data };
    try {
      if (old) await old.edit(payload); else await guild.autoModerationRules.create(payload);
      log('automod ✓', name);
    } catch (e) { log('automod ✗', name, e.message); }
  }
  const alert = { type: Act.SendAlertMessage, metadata: { channel: modLogs.id } };
  const block = (msg) => ({ type: Act.BlockMessage, metadata: { customMessage: msg } });

  await automod('Slurs and sexual content', {
    triggerType: Trig.KeywordPreset, triggerMetadata: { presets: [3, 2] },
    actions: [block('Slurs and sexual content are not allowed here.'), alert],
  }, ['Block slurs (Discord list)']);
  await automod('Slurs (custom and bypasses)', {
    triggerType: Trig.Keyword,
    triggerMetadata: { regexPatterns: SLUR_REGEX, allowList: ['snigger', 'sniggering', 'niggle', 'niggling', 'coonhound', 'raccoon', 'cocoon'] },
    actions: [block('That word is not allowed here. You have been timed out.'), alert, { type: Act.Timeout, metadata: { durationSeconds: 600 } }],
  }, ['Block slurs (custom + bypasses)']);
  await automod('Invites and scam links', {
    triggerType: Trig.Keyword, triggerMetadata: { regexPatterns: INVITE_REGEX },
    actions: [block('Server invites and scam links are not allowed. Ask a mod if you want to promote something.'), alert],
    exemptRoles: exempt,
  }, ['Block invites & scams']);
  await automod('Spam', { triggerType: Trig.Spam, actions: [block('Your message looked like spam.'), alert], exemptRoles: exempt }, ['Block spam']);
  await automod('Mass mentions', {
    triggerType: Trig.MentionSpam, triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
    actions: [block('Too many mentions.'), alert, { type: Act.Timeout, metadata: { durationSeconds: 1800 } }],
    exemptRoles: exempt,
  }, ['Block mass mentions']);
  await automod('Slur usernames', {
    triggerType: 6, eventType: 2, triggerMetadata: { regexPatterns: SLUR_REGEX, keywordFilter: [] }, actions: [{ type: 4 }],
  }, ['Block slur usernames']);

  // Links are blocked for anyone under level 5 by Discord itself, so it works even with the bot offline.
  const linkExempt = [ownerRole.id, modRole.id, supporterRole.id, ...LEVEL_ROLES.filter((l) => l.level >= LINK_LEVEL).map((l) => lv[l.level].id)];
  await automod('Links below level 5', {
    triggerType: Trig.Keyword,
    triggerMetadata: {
      regexPatterns: [
        'https?://\\S+',
        '\\bwww\\.\\S+',
        '\\b[a-z0-9-]{2,}\\.(?:com|gg|net|org|io|ru|xyz|tk|ly|me|tv|co|link|app|site|online|shop|store|click|top|info|biz)\\b',
      ],
      allowList: ['*tenor.com*', '*giphy.com*', '*tekkendocs.com*', '*wavu.wiki*', '*tekken.com*', '*cdn.discordapp.com*', '*media.discordapp.net*'],
    },
    actions: [block(`Links unlock at level ${LINK_LEVEL}. Keep chatting! (GIFs are fine.)`)],
    exemptRoles: linkExempt,
  });

  // ---------- DISCORD-NATIVE JOIN FLOW (works without the bot) ----------
  const RULE_LINES = [
    'No slurs, racism, sexism, homophobia or hate.',
    'Trash talk the gameplay, not the person.',
    'No spam, ads, invites or DM advertising.',
    'No NSFW, gore or shock content.',
    'No cheats, exploits, account selling or leaks.',
    'Keep channels on-topic.',
    'Follow the Discord Terms and Community Guidelines.',
    'Staff have the final call.',
  ];
  try {
    await client.rest.patch(`/guilds/${guild.id}/member-verification`, { body: {
      enabled: true,
      description: `Welcome to ${BRAND.name}! Accept the rules to join.`,
      form_fields: [{ field_type: 'TERMS', label: 'Read and agree to the server rules', values: RULE_LINES, required: true }],
    } });
    log('rules screening ✓');
  } catch (e) { log('rules screening ✗', e.message); }

  try {
    let idSeed = BigInt(Date.now()) << 22n;
    const sid = () => String(idSeed++);
    const optFrom = (map, items, desc) => items.map((x) => ({ id: sid(), title: x.name, description: desc?.(x) ?? null, role_ids: [map[x.key ?? x.slug]], channel_ids: [] }));
    const prompts = [
      { title: 'Who do you main?', type: 1, single_select: false, required: false, options: optFrom(cfg.mainRoles, CHARACTERS) },
      { title: 'What\'s your Tekken 8 rank?', type: 0, single_select: true, required: false, options: optFrom(cfg.rankRoles, RANKS) },
      { title: 'Where do you play?', type: 0, single_select: false, required: false, options: optFrom(cfg.platformRoles, PLATFORMS) },
      { title: 'Which region are you in?', type: 1, single_select: true, required: false, options: optFrom(cfg.regionRoles, REGIONS) },
      // Discord allows only a few join questions; pings live in "Channels & Roles" (and #roles) instead.
      { title: 'What do you want to be pinged for?', type: 0, single_select: false, required: false, in_onboarding: false, options: optFrom(cfg.pingRoles, PINGS, (p) => p.desc) },
    ].map((p) => ({ id: sid(), in_onboarding: true, ...p }));
    await client.rest.put(`/guilds/${guild.id}/onboarding`, { body: {
      prompts,
      default_channel_ids: [guide, rules, announce, general, tekkenTalk, memes, botCmds, levelUps, daily, beginner, frameData, combos, lfg, clips, whiffContent].map((c) => c.id),
      enabled: true,
      mode: 0,
    } });
    log('onboarding ✓');
  } catch (e) { log('onboarding ✗', e.rawError ? JSON.stringify(e.rawError).slice(0, 400) : e.message); }

  try {
    await guild.editWelcomeScreen({
      enabled: true,
      description: `The Tekken 8 community of @${BRAND.handle}. Find sets, learn the game, share clips.`,
      welcomeChannels: [
        { channel: guide.id, description: 'How the server works' },
        { channel: general.id, description: 'Say hi' },
        { channel: lfg.id, description: 'Find people to play' },
        { channel: frameData.id, description: 'Look up any move' },
        { channel: clips.id, description: 'Share your highlights' },
      ],
    });
    log('welcome screen ✓');
  } catch (e) { log('welcome screen ✗', e.message); }

  // ---------- PANELS ----------
  const embed = (o) => new EmbedBuilder({ color: BRAND.color, ...o });
  // Each panel = banner image embed on top + content embeds below, edited in place on re-runs.
  async function panel(key, ch, { title, subtitle, accent, embeds = [], components = [] }) {
    const file = new AttachmentBuilder(art.banner(title, subtitle, accent ? { accent } : {}), { name: `${key}.png` });
    const color = embeds[0]?.data.color ?? BRAND.color;
    const payload = { embeds: [embed({ image: { url: `attachment://${key}.png` }, color }), ...embeds], components, files: [file], attachments: [] };
    let msg = cfg.panels[key] ? await ch.messages.fetch(cfg.panels[key]).catch(() => null) : null;
    if (msg) await msg.edit(payload); else msg = await ch.send(payload);
    cfg.panels[key] = msg.id;
    save();
  }
  const lines = (arr) => arr.filter((x) => x !== null && x !== undefined).join('\n');
  const ch = (c) => `<#${c.id}>`;

  await panel('guide', guide, {
    title: 'Start here', subtitle: 'Everything you need to know in one minute',
    embeds: [
      embed({
        title: `Welcome to ${BRAND.name}`,
        description: `The official community of **@${BRAND.handle}**: a home for Tekken 8 players of every level.\nFind sets, learn matchups, share clips, enter tournaments and climb the server ladder.`,
      }),
      embed({
        title: 'Getting started',
        description: lines([
          `**1.** Read the ${ch(rules)} (you accepted them when you joined)`,
          `**2.** Pick or change your main, rank, platform and region in ${ch(rolesCh)}`,
          `**3.** Say hi in ${ch(general)}`,
          `**4.** Bot commands go in ${ch(botCmds)} (type \`/help\` there). They're switched off in chat channels on purpose.`,
        ]),
        color: BRAND.dark,
      }),
      embed({
        title: 'Where things are',
        description: lines([
          `${E('arrow')} ${ch(general)} ${ch(tekkenTalk)} ${ch(memes)}: hang out and talk Tekken`,
          `${E('arrow')} ${ch(botCmds)}: bot commands · ${ch(levelUps)}: levels + leaderboard · ${ch(daily)}: Character of the Day and trivia`,
          `${E('arrow')} ${ch(suggestions)}: one post per idea`,
          `${E('arrow')} ${ch(beginner)} ${ch(matchup)} ${ch(replay)}: get better, ask anything`,
          `${E('arrow')} ${ch(frameData)}: \`/frame\` \`/punish\` \`/character\` for any character`,
          `${E('arrow')} ${ch(lfg)} ${ch(challenges)} ${ch(tournaments)}: find games and compete`,
          `${E('arrow')} ${ch(clips)} ${ch(hallOfFame)}: share highlights; 3 stars gets you in the Hall of Fame`,
          `${E('arrow')} ${ch(whiffContent)}: new content from @${BRAND.handle}`,
          `${E('arrow')} ${ch(support)}: private help from the mods`,
        ]),
        color: BRAND.dark,
      }),
      embed({
        title: 'Levels and perks',
        description: lines([
          `Earn XP by chatting (once a minute), hanging out in voice with others, and claiming \`/daily\`. Check yours with \`/rank\` in ${ch(botCmds)}. Full details in ${ch(levelUps)}.\n`,
          ...LEVEL_ROLES.map((l) => `${E('lv')} **Level ${l.level} · <@&${cfg.levelRoles[l.level]}>**: ${l.perk}`),
          `\n${E('dot')} Supporters and server boosters get **1.5x XP** and every perk except custom roles.`,
        ]),
        color: BRAND.gold,
      }),
      embed({
        title: 'Staying safe',
        description: lines([
          `${E('check')} AutoMod blocks slurs, scams, invite links and mass pings.`,
          `${E('check')} Links unlock at level ${LINK_LEVEL} and images at level ${MEDIA_LEVEL}, which keeps spam bots out.`,
          `${E('check')} Never click "free nitro" links, and staff will never DM you first asking for anything.`,
          `${E('check')} Problem with someone? Open a ticket in ${ch(support)}.`,
        ]),
        color: BRAND.green,
      }),
    ],
  });

  await panel('rules', rules, {
    title: 'Rules', subtitle: 'Short version: be cool, no hate, no spam',
    embeds: [embed({
      description: lines([
        '**1. No slurs, racism, sexism, homophobia or hate.** Instant timeout; repeat offenses mean a ban.',
        '**2. Trash talk the gameplay, not the person.** Salt is fine. Harassment is not.',
        '**3. No spam, ads, invites or DM advertising.** Self-promo only with staff approval.',
        '**4. No NSFW, gore or shock content.**',
        '**5. No cheats, exploits, account selling or leaks.**',
        '**6. Keep channels on-topic.** Clips in clips, memes in memes.',
        '**7. Follow the** [Discord Terms](https://discord.com/terms) **and** [Community Guidelines](https://discord.com/guidelines).',
        '**8. Staff have the final call.** Disagree? Open a ticket in #support.',
        '',
        `${E('warn')} **Punishments:** warning → timeout → kick → ban. 3 warnings = automatic 1 hour timeout, 5 = 24 hours.`,
      ]),
      footer: { text: 'By staying in the server you agree to these rules.' },
    })],
  });

  const opt = (label, value, description, emoji) => ({ label, value, description, emoji });
  const half = Math.ceil(CHARACTERS.length / 2);
  const mainsA = CHARACTERS.slice(0, half), mainsB = CHARACTERS.slice(half);
  const select = (id, placeholder, options, max) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(0).setMaxValues(max).addOptions(options),
  );
  const rankEmoji = (r) => { const m = /<:(\w+):(\d+)>/.exec(cfg.emojis[`wd_rank_${r.key}`] ?? ''); return m ? { name: m[1], id: m[2] } : undefined; };

  await panel('rolesMains', rolesCh, {
    title: 'Pick your main', subtitle: 'Up to 3 characters from each list',
    embeds: [embed({ description: 'Select from the menus below. Pick again to change; clear a menu to remove.\nYour mains show up on your profile and in your `/lfg` posts.' })],
    components: [
      select('roles:mainA', `${mainsA[0].name} – ${mainsA.at(-1).name}`, mainsA.map((c) => opt(c.name, c.slug)), 3),
      select('roles:mainB', `${mainsB[0].name} – ${mainsB.at(-1).name}`, mainsB.map((c) => opt(c.name, c.slug)), 3),
    ],
  });
  await panel('rolesProfile', rolesCh, {
    title: 'Your setup', subtitle: 'Rank, platform and region for better matches', accent: '#f4a261',
    embeds: [embed({ description: 'This helps people find good sets with you in `/lfg` and `/queue`.', color: BRAND.gold })],
    components: [
      select('roles:rank', 'Your Tekken 8 rank', RANKS.map((r) => opt(r.name, r.key, undefined, rankEmoji(r))), 1),
      select('roles:platform', 'Platform(s)', PLATFORMS.map((p) => opt(p.name, p.key)), PLATFORMS.length),
      select('roles:region', 'Region (for connection)', REGIONS.map((r) => opt(r.name, r.key)), 1),
    ],
  });
  await panel('rolesPings', rolesCh, {
    title: 'Notifications', subtitle: 'Only get pinged for what you care about', accent: '#457b9d',
    embeds: [embed({ description: 'Nobody gets pinged by default. Opt in below.', color: BRAND.blue })],
    components: [select('roles:pings', 'Choose notification roles', PINGS.map((p) => opt(p.name, p.key, p.desc)), PINGS.length)],
  });
  await panel('rolesColors', rolesCh, {
    title: 'Name colors', subtitle: `Unlocks at level ${COLOR_LEVEL} or for Supporters`, accent: '#9d6bff',
    embeds: [embed({ description: `Pick a color for your name. Requires <@&${cfg.levelRoles[COLOR_LEVEL]}> or <@&${supporterRole.id}>. You can also use \`/color\`.`, color: 0x9d6bff })],
    components: [select('roles:color', 'Choose a name color', [{ label: 'No color', value: 'none' }, ...NAME_COLORS.map((c) => opt(c.name, c.key))], 1)],
  });

  await panel('socials', socials, {
    title: `@${BRAND.handle}`, subtitle: 'Same handle on every platform',
    embeds: [embed({ description: `Follow for Tekken content. New posts are shared in ${ch(whiffContent)}; get **Content Pings** in ${ch(rolesCh)} to hear about them first.` })],
    components: [new ActionRowBuilder().addComponents(SOCIALS.map((s) => new ButtonBuilder().setLabel(s.name).setStyle(ButtonStyle.Link).setURL(s.url)))],
  });

  await panel('support', support, {
    title: 'Support', subtitle: 'Private help from the mod team', accent: '#457b9d',
    embeds: [embed({ description: 'Reporting someone, appealing a punishment, claiming a Legend custom role or a business inquiry?\nPress the button to open a **private ticket** that only you and staff can see.', color: BRAND.blue })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open').setLabel('Open a ticket').setStyle(ButtonStyle.Primary))],
  });

  await panel('hallOfFame', hallOfFame, { title: 'Hall of fame', subtitle: 'The best of the server', accent: '#f4a261', embeds: [embed({ description: `Anything that gets **3 stars** (⭐) from other members in ${ch(clips)}, ${ch(memes)}, ${ch(general)}, ${ch(tekkenTalk)} or ${ch(combos)} is posted here.`, color: BRAND.gold })] });
  await panel('lfgInfo', lfg, {
    title: 'Find a match', subtitle: 'Post once, get pinged when someone joins', accent: '#2a9d8f',
    embeds: [embed({ description: lines([
      `${E('arrow')} \`/lfg\`: post what you want to play (casuals, ranked, long set, lab). Others press **Join**.`,
      `${E('arrow')} \`/queue\`: join the matchmaking queue and get paired with the next person on your platform.`,
      `${E('arrow')} \`/challenge @user\`: call someone out. Results count for the server ladder.`,
      '\nPosts expire after an hour.',
    ]), color: BRAND.green })],
  });
  await panel('tourneyInfo', tournaments, { title: 'Tournaments', subtitle: 'Server events and brackets', accent: '#f4a261', embeds: [embed({ description: `Staff create events here. Press **Join** on an event to sign up, and get **Tournament Pings** in ${ch(rolesCh)}.`, color: BRAND.gold })] });
  await panel('frameInfo', frameData, {
    title: 'Frame data', subtitle: 'Every character, every move', accent: '#457b9d',
    embeds: [embed({ description: lines([
      `${E('arrow')} \`/frame character move\`: startup, block, hit, counter hit, damage`,
      `${E('arrow')} \`/punish character\`: their unsafe moves and how unsafe`,
      `${E('arrow')} \`/character character\`: quick overview`,
      `\n${E('plus')} plus on block · ${E('safe')} safe · ${E('minus')} punishable · ${E('launch')} launch punishable`,
      'Data from [tekkendocs.com](https://tekkendocs.com).',
    ]), color: BRAND.dark })],
  });
  await panel('veterans', veterans, { title: 'Veterans lounge', subtitle: 'Level 20 and up', accent: '#ff7043', embeds: [embed({ description: 'You put in the hours. This is a calmer room for regulars to talk shop, organise sets and give feedback on the server.', color: 0xff7043 })] });
  await panel('supporters', supportersLounge, { title: 'Supporters', subtitle: 'Thank you for backing the channel', accent: '#ff73fa', embeds: [embed({ description: 'Supporters get 1.5x XP, every level perk, early looks at content and a say in polls. Boosting the server gives you the Supporter role automatically.', color: 0xff73fa })] });
  await panel('beginner', beginner, { title: 'New to tekken?', subtitle: 'Ask anything, no judgement', accent: '#2a9d8f', embeds: [embed({ description: lines([
    '**Where to start:**',
    `${E('dot')} Pick one character and stick with them for a while`,
    `${E('dot')} Learn your fastest punish (usually a 10-frame jab)`,
    `${E('dot')} Learn one simple combo you can land every time`,
    `${E('dot')} Block more. Seriously.`,
    `\nUse \`/punish\` to learn what to punish, and post replays in ${ch(replay)} for feedback.`,
  ]), color: BRAND.green })] });

  await panel('botCommands', botCmds, {
    title: 'Bot commands', subtitle: 'Type / here to see everything', accent: '#2a9d8f',
    embeds: [embed({ description: lines([
      `This channel is **commands only**. Type \`/\` and pick one. Chat goes in ${ch(general)}.`,
      '',
      `${E('arrow')} \`/rank\` your level card · \`/daily\` free XP every day · \`/perks\` what levels unlock`,
      `${E('arrow')} \`/leaderboard\` top 10 · \`/color\` name color (level ${COLOR_LEVEL}+)`,
      `${E('arrow')} \`/trivia\` quiz · \`/random\` random character · \`/socials\``,
      `${E('arrow')} \`/lfg\` \`/queue\` find games (posts go to ${ch(lfg)})`,
      `${E('arrow')} Frame data: \`/frame\` \`/punish\` \`/character\` (here or in ${ch(frameData)})`,
      `${E('arrow')} \`/challenge\` works in ${ch(challenges)}`,
      '',
      `${E('warn')} Spamming commands gets you a short timeout.`,
    ]), color: BRAND.green })],
  });
  await panel('levels', levelUps, {
    title: 'Levels and XP', subtitle: 'How to level up and what you get', accent: '#f4a261',
    embeds: [
      embed({ title: 'How you earn XP', description: lines([
        `${E('xp')} **Chatting:** 15-25 XP, at most once a minute (spamming doesn't help)`,
        `${E('xp')} **Voice:** 8 XP a minute when you're in voice with at least one other person`,
        `${E('xp')} **\`/daily\`:** 60 XP, +10 for every day in a row (up to +100 extra)`,
        `${E('xp')} **Supporters and boosters:** 1.5x XP`,
        '',
        `Check your level with \`/rank\` in ${ch(botCmds)}. Level-ups get a shoutout here.`,
      ]), color: BRAND.gold }),
      embed({ title: 'What levels unlock', description: lines(LEVEL_ROLES.map((l) => `${E('lv')} **Level ${l.level} · <@&${cfg.levelRoles[l.level]}>:** ${l.perk}`)), color: BRAND.dark }),
      embed({ title: 'Other points', description: lines([
        `${E('win')} **Ladder (Elo):** win \`/challenge\` sets in ${ch(challenges)}. Everyone starts at 1000.`,
        `${E('check')} **Trivia points:** first right answer in ${ch(daily)} gets 10.`,
        '',
        'The live leaderboard below updates every 10 minutes.',
      ]), color: BRAND.blue }),
    ],
  });
  await panel('daily', daily, {
    title: 'Daily', subtitle: 'Character of the Day and trivia', accent: '#e63946',
    embeds: [embed({ description: lines([
      `${E('arrow')} **Character of the Day** every day, with a thread for tips.`,
      `${E('arrow')} **Trivia drops** every 6 hours. First right answer gets 10 points. Want a ping? Grab **Trivia Pings** in ${ch(rolesCh)}.`,
      `${E('arrow')} Start a trivia question yourself with \`/trivia\`.`,
      '',
      'Only the bot posts here. **Talk about each post in its thread** so the channel stays clean.',
    ]), color: BRAND.dark })],
  });
  await panel('staffGuide', modChat, {
    title: 'Staff guide', subtitle: 'Everything a mod needs, in plain words', accent: '#457b9d',
    embeds: [embed({ description: lines([
      '**Someone breaking a rule?**',
      `${E('dot')} \`/warn @user reason\`: first step. 3 warnings = auto 1 hour timeout, 5 = 24 hours.`,
      `${E('dot')} \`/timeout @user minutes\`: mute them for a while. \`/untimeout\` undoes it.`,
      `${E('dot')} \`/kick\` removes them (they can rejoin). \`/ban\` removes them for good.`,
      `${E('dot')} \`/warnings @user\` and \`/userinfo @user\` show their history.`,
      '',
      '**Mess to clean up?**',
      `${E('dot')} \`/purge amount\`: delete the last messages in this channel (add a user for only theirs).`,
      `${E('dot')} \`/slowmode seconds\`: slow a busy channel. 0 turns it off.`,
      `${E('dot')} \`/lockdown on\`: stops everyone typing (raids). \`/lockdown off\` when it's over.`,
      '',
      '**Posting:** `/announce` for news, `/post` for new videos, `/tournament create` for events.',
      `**Tickets:** members open them in ${ch(support)}; they show up under TICKETS. Press Close when done.`,
      `**Logs:** anything deleted, edited, joined or auto-blocked shows in ${ch(modLogs)}.`,
      `**Bot down or something broken?** Message <@&${cfg.roles.tech}>.`,
    ]), color: BRAND.blue })],
  });

  log('Done. Config saved to data/config.json');
  await client.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
