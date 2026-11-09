// Content and announcements: /post shares a new video/post, /announce makes a styled announcement,
// and an optional YouTube feed auto-posts new uploads (set YOUTUBE_CHANNEL_ID in .env).
const { SlashCommandBuilder, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, Events } = require('discord.js');
const { cfg, embed, ephemeral } = require('../util');
const { kvGet, kvSet } = require('../db');
const { BRAND } = require('../constants');
const art = require('../images');

const commands = [
  new SlashCommandBuilder().setName('post').setDescription('Share new content in #whifflord-content').setDefaultMemberPermissions(P.ManageGuild)
    .addStringOption((o) => o.setName('link').setDescription('Link to the post or video').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Short title').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('platform').setDescription('Where it is').setRequired(true).addChoices(
      { name: 'Instagram', value: 'Instagram' }, { name: 'TikTok', value: 'TikTok' }, { name: 'YouTube', value: 'YouTube' },
    ))
    .addBooleanOption((o) => o.setName('ping').setDescription('Ping Content Pings (default yes)')),
  new SlashCommandBuilder().setName('announce').setDescription('Post a styled announcement').setDefaultMemberPermissions(P.ManageGuild)
    .addStringOption((o) => o.setName('title').setDescription('Headline').setRequired(true).setMaxLength(60))
    .addStringOption((o) => o.setName('message').setDescription('Body (use \\n for new lines)').setRequired(true).setMaxLength(2000))
    .addBooleanOption((o) => o.setName('ping').setDescription('Ping Announcement Pings (default yes)')),
];

async function interaction(i) {
  if (!i.isChatInputCommand() || !['post', 'announce'].includes(i.commandName)) return false;
  const ping = i.options.getBoolean('ping') ?? true;

  if (i.commandName === 'post') {
    const link = i.options.getString('link');
    if (!/^https?:\/\//i.test(link)) return ephemeral(i, 'That doesn\'t look like a link.'), true;
    const platform = i.options.getString('platform');
    const ch = i.guild.channels.cache.get(cfg.channels.whiffContent);
    await ch.send({
      content: [ping && `<@&${cfg.pingRoles.content}>`, link].filter(Boolean).join(' '),
      embeds: [embed({ title: i.options.getString('title'), url: link, description: `New on ${platform} from @${BRAND.handle}.` })],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(`Open on ${platform}`).setStyle(ButtonStyle.Link).setURL(link))],
      allowedMentions: { roles: ping ? [cfg.pingRoles.content] : [] },
    });
    return ephemeral(i, `Posted in <#${ch.id}>.`), true;
  }

  const title = i.options.getString('title');
  const ch = i.guild.channels.cache.get(cfg.channels.announcements);
  await i.deferReply({ flags: 64 });
  const msg = await ch.send({
    content: ping ? `<@&${cfg.pingRoles.announce}>` : undefined,
    embeds: [
      embed({ image: { url: 'attachment://announce.png' } }),
      embed({ description: i.options.getString('message').replace(/\\n/g, '\n'), footer: { text: `Posted by ${i.member.displayName}` }, timestamp: new Date().toISOString() }),
    ],
    files: [new AttachmentBuilder(art.banner(title, 'Announcement'), { name: 'announce.png' })],
    allowedMentions: { roles: ping ? [cfg.pingRoles.announce] : [] },
  });
  if (msg.crosspostable) await msg.crosspost().catch(() => {});
  await i.editReply(`Announced in <#${ch.id}>.`);
  return true;
}

// Optional YouTube feed (free, no API key): checks the channel's RSS every 15 minutes.
async function checkYouTube(client) {
  const id = process.env.YOUTUBE_CHANNEL_ID;
  if (!id) return;
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text().catch(() => '');
  const entry = /<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>/.exec(xml);
  if (!entry) return;
  const [, videoId, title] = entry;
  const last = kvGet('ytLast');
  kvSet('ytLast', videoId);
  if (!last || last === videoId) return; // first run just remembers the latest video
  const ch = client.guilds.cache.get(cfg.guildId)?.channels.cache.get(cfg.channels.whiffContent);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  await ch?.send({ content: `<@&${cfg.pingRoles.content}> ${url}`, embeds: [embed({ title, url, description: `New on YouTube from @${BRAND.handle}.` })], allowedMentions: { roles: [cfg.pingRoles.content] } });
}

function init(client) {
  client.once(Events.ClientReady, () => {
    checkYouTube(client).catch(() => {});
    setInterval(() => checkYouTube(client).catch(() => {}), 15 * 60 * 1000);
  });
}

module.exports = { commands, interaction, init };
