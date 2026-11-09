// Frame data (tekkendocs.com), punishers, character info, random character, Character of the Day.
const { SlashCommandBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cfg, embed, E, cooldown, ephemeral, pick } = require('../util');
const { kvGet, kvSet } = require('../db');
const { CHARACTERS, BRAND } = require('../constants');

const API = (slug) => `https://tekkendocs.com/api/t8/${slug}/framedata`;
const PAGE = (slug) => `https://tekkendocs.com/t8/${slug}`;
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map(); // slug -> { ts, moves }

async function moves(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.ts < TTL) return hit.moves;
  const res = await fetch(API(slug), { headers: { 'User-Agent': 'whifflord-dojo-bot' } });
  if (!res.ok) throw new Error(`tekkendocs ${res.status}`);
  const list = (await res.json()).framesNormal ?? [];
  cache.set(slug, { ts: Date.now(), moves: list });
  return list;
}

const firstNum = (s) => { const m = /[+-]?\d+/.exec(s ?? ''); return m ? Number(m[0]) : null; };
const startup = (mv) => firstNum((mv.startup ?? '').replace(/^i/, ''));
const isThrow = (mv) => /^t/i.test(mv.hitLevel ?? '');
const char = (slug) => CHARACTERS.find((c) => c.slug === slug);
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
const loose = (s) => norm(s).replace(/[,+/]/g, '');
const clean = (s) => (s && String(s).trim()) || '—';

function findMove(list, query) {
  const q = norm(query), ql = loose(query);
  return list.find((m) => norm(m.command) === q)
    ?? list.find((m) => loose(m.command) === ql)
    ?? list.find((m) => m.name && norm(m.name) === q)
    ?? list.find((m) => m.name && norm(m.name).includes(q))
    ?? list.find((m) => loose(m.command).startsWith(ql));
}

function verdict(block) {
  const b = firstNum(block);
  if (b === null) return '';
  if (b <= -15) return `${E('launch')} Launch punishable`;
  if (b <= -10) return `${E('minus')} Punishable`;
  if (b >= 1) return `${E('plus')} Plus on block`;
  return `${E('safe')} Safe on block`;
}

function moveEmbed(c, mv) {
  const notes = (mv.notes ?? '').split('\n').map((l) => l.replace(/^\*\s?/, '- ')).filter(Boolean).join('\n').slice(0, 900);
  return embed({
    title: `${c.name} · ${mv.command}`,
    url: PAGE(c.slug),
    description: [mv.name && `**${mv.name}**`, verdict(mv.block)].filter(Boolean).join('\n'),
    fields: [
      { name: 'Startup', value: clean(mv.startup), inline: true },
      { name: 'On block', value: clean(mv.block), inline: true },
      { name: 'On hit', value: clean(mv.hit), inline: true },
      { name: 'Counter hit', value: clean(mv.counterHit), inline: true },
      { name: 'Hit level', value: clean(mv.hitLevel), inline: true },
      { name: 'Damage', value: clean(mv.damage), inline: true },
      ...(notes ? [{ name: 'Notes', value: notes }] : []),
    ],
    footer: { text: 'tekkendocs.com · i = startup frames · + means you act first' },
    color: BRAND.dark,
  });
}

const charOption = (o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true);
const commands = [
  new SlashCommandBuilder().setName('frame').setDescription('Frame data for a move')
    .addStringOption(charOption)
    .addStringOption((o) => o.setName('move').setDescription('Input (df+1) or move name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('punish').setDescription('A character\'s most punishable moves on block').addStringOption(charOption),
  new SlashCommandBuilder().setName('character').setDescription('Quick overview of a character').addStringOption(charOption),
  new SlashCommandBuilder().setName('random').setDescription('Can\'t decide? Get a random character to play'),
];

const LINES = [
  'Time to lab. No excuses.', 'Your ranked points are in danger.', 'Main them for a week, then report back.',
  'Learn one combo and you\'re already ahead of most.', 'Lab their punishers first.', 'Download complete. Probably.',
  'The streets will remember this.', 'Hope you like the training stage.',
];

async function interaction(i) {
  if (i.isAutocomplete() && ['frame', 'punish', 'character'].includes(i.commandName)) {
    const focused = i.options.getFocused(true);
    if (focused.name === 'character') {
      const q = focused.value.toLowerCase();
      await i.respond(CHARACTERS.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25).map((c) => ({ name: c.name, value: c.slug })));
    } else {
      const slug = i.options.getString('character');
      if (!char(slug)) return i.respond([]), true;
      const list = await moves(slug).catch(() => []);
      const q = focused.value;
      const matches = q ? list.filter((m) => loose(m.command).includes(loose(q)) || (m.name ?? '').toLowerCase().includes(q.toLowerCase())) : list;
      await i.respond(matches.slice(0, 25).map((m) => ({ name: `${m.command}${m.name ? ` · ${m.name}` : ''}`.slice(0, 100), value: m.command.slice(0, 100) })));
    }
    return true;
  }

  if (!i.isChatInputCommand() || !['frame', 'punish', 'character', 'random'].includes(i.commandName)) return false;
  const wait = cooldown('tekken', i.user.id, 3);
  if (wait) return ephemeral(i, `Slow down, try again in ${wait}s.`), true;

  if (i.commandName === 'random') {
    const c = pick(CHARACTERS);
    await i.reply({ embeds: [embed({ title: `Your new main: ${c.name}`, description: pick(LINES), url: PAGE(c.slug) })] });
    return true;
  }

  const c = char(i.options.getString('character'));
  if (!c) return ephemeral(i, 'Pick a character from the list.'), true;
  await i.deferReply();
  let list;
  try { list = await moves(c.slug); } catch { return i.editReply('Couldn\'t reach tekkendocs right now. Try again in a bit.'), true; }

  if (i.commandName === 'frame') {
    const mv = findMove(list, i.options.getString('move'));
    if (!mv) return i.editReply(`No move matching \`${i.options.getString('move')}\` for ${c.name}. Try picking from the autocomplete list.`), true;
    await i.editReply({ embeds: [moveEmbed(c, mv)] });
    return true;
  }

  if (i.commandName === 'punish') {
    const bad = list.filter((m) => m.hitLevel && !isThrow(m))
      .map((m) => ({ m, b: firstNum(m.block) }))
      .filter((x) => x.b !== null && x.b <= -10)
      .sort((a, b) => a.b - b.b)
      .slice(0, 20);
    const line = ({ m, b }) => `${b <= -15 ? E('launch') : E('minus')} \`${m.command}\` **${m.block}**${m.name ? ` · ${m.name}` : ''}`;
    await i.editReply({ embeds: [embed({
      title: `${c.name}: punish these on block`,
      url: PAGE(c.slug),
      description: bad.map(line).join('\n').slice(0, 4000) || 'Nothing -10 or worse found.',
      footer: { text: 'Dark red = launch punishable (-15 or worse) · red = punishable (-10 to -14)' },
      color: BRAND.dark,
    })] });
    return true;
  }

  await i.editReply({ embeds: [characterEmbed(c, list)] });
  return true;
}

function characterEmbed(c, list) {
  const attacks = list.filter((m) => startup(m) !== null && m.hitLevel && !isThrow(m));
  const fastest = [...attacks].sort((a, b) => startup(a) - startup(b))[0];
  const fastestLow = attacks.filter((m) => /^l/i.test(m.hitLevel)).sort((a, b) => startup(a) - startup(b))[0];
  const plus = list.filter((m) => (firstNum(m.block) ?? -99) > 0).length;
  const launch = list.filter((m) => (firstNum(m.block) ?? 0) <= -15).length;
  const homing = list.filter((m) => /homing/i.test(m.notes ?? '')).length;
  const pcs = list.filter((m) => /power crush/i.test(m.notes ?? '')).length;
  return embed({
    title: c.name,
    url: PAGE(c.slug),
    fields: [
      { name: 'Moves listed', value: String(list.length), inline: true },
      { name: 'Fastest move', value: fastest ? `\`${fastest.command}\` ${fastest.startup}` : '—', inline: true },
      { name: 'Fastest low', value: fastestLow ? `\`${fastestLow.command}\` ${fastestLow.startup}` : '—', inline: true },
      { name: 'Plus on block', value: String(plus), inline: true },
      { name: 'Launch punishable', value: String(launch), inline: true },
      { name: 'Homing / power crush', value: `${homing} / ${pcs}`, inline: true },
    ],
    footer: { text: 'Full list on tekkendocs.com · /punish and /frame for details' },
    color: BRAND.dark,
  });
}

// Character of the Day: posted once a day in #daily (thread for discussion).
async function postCotd(client) {
  const today = new Date().toISOString().slice(0, 10);
  if (kvGet('cotd') === today || new Date().getUTCHours() < 15) return;
  kvSet('cotd', today);
  const ch = client.guilds.cache.get(cfg.guildId)?.channels.cache.get(cfg.channels.daily ?? cfg.channels.tekkenTalk);
  if (!ch) return;
  const recent = JSON.parse(kvGet('cotdRecent') ?? '[]');
  const c = pick(CHARACTERS.filter((x) => !recent.includes(x.slug)));
  kvSet('cotdRecent', JSON.stringify([...recent, c.slug].slice(-14)));
  let list = [];
  try { list = await moves(c.slug); } catch { /* post without data */ }
  const e = characterEmbed(c, list);
  e.setTitle(`Character of the Day: ${c.name}`);
  const plusMove = pick(list.filter((m) => (firstNum(m.block) ?? -99) > 0)) ?? null;
  const punishMove = pick(list.filter((m) => (firstNum(m.block) ?? 0) <= -12 && !isThrow(m))) ?? null;
  e.setDescription([
    `Anyone here main **${c.name}**? Drop your best tip in the thread.`,
    plusMove && `\n${E('plus')} **Plus move to know:** \`${plusMove.command}\` (${plusMove.block} on block)`,
    punishMove && `${E('launch')} **Punish this:** \`${punishMove.command}\` (${punishMove.block} on block)`,
  ].filter(Boolean).join('\n'));
  const msg = await ch.send({
    embeds: [e],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Full frame data').setStyle(ButtonStyle.Link).setURL(PAGE(c.slug)))],
  });
  await msg.startThread({ name: `${c.name} tips and tech`, autoArchiveDuration: 1440 }).catch(() => {});
}

function init(client) {
  client.once(Events.ClientReady, () => {
    postCotd(client).catch(console.error);
    setInterval(() => postCotd(client).catch(console.error), 30 * 60 * 1000);
  });
}

module.exports = { commands, interaction, init };
