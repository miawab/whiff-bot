// Tekken trivia: /trivia plus an automatic drop every 6 hours. First correct answer scores.
const { SlashCommandBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cfg, embed, E, cooldown, ephemeral, pick, shuffle } = require('../util');
const { db, getUser, kvGet, kvSet } = require('../db');
const { BRAND } = require('../constants');

// [question, correct answer, ...wrong answers]
const QUESTIONS = [
  ['What is the name of the tournament in Tekken\'s story?', 'The King of Iron Fist Tournament', 'The Iron Will Cup', 'The Mishima Invitational', 'The Zaibatsu Classic'],
  ['Who is the main protagonist of Tekken 8\'s story?', 'Jin Kazama', 'Kazuya Mishima', 'Lars Alexandersson', 'Reina'],
  ['Who is Jin Kazama\'s mother?', 'Jun Kazama', 'Asuka Kazama', 'Nina Williams', 'Zafina'],
  ['Who is Kazuya Mishima\'s father?', 'Heihachi Mishima', 'Jinpachi Mishima', 'Lee Chaolan', 'Lars Alexandersson'],
  ['Who is Heihachi Mishima\'s father?', 'Jinpachi Mishima', 'Kazuya Mishima', 'Wang Jinrei', 'Ganryu'],
  ['What company is run by the Mishima family?', 'Mishima Zaibatsu', 'G Corporation', 'Violet Systems', 'Tekken Force Inc.'],
  ['Who runs G Corporation?', 'Kazuya Mishima', 'Heihachi Mishima', 'Lee Chaolan', 'Bryan Fury'],
  ['Which fighting style do Kazuya and Heihachi use?', 'Mishima style karate', 'Capoeira', 'Taekwondo', 'Sambo'],
  ['What animal mask does King wear?', 'A jaguar', 'A lion', 'A bear', 'A wolf'],
  ['What kind of animal is Kuma?', 'A bear', 'A panda', 'A kangaroo', 'A dinosaur'],
  ['What fighting style does Eddy Gordo use?', 'Capoeira', 'Muay Thai', 'Sambo', 'Wing Chun'],
  ['What fighting style does Hwoarang use?', 'Taekwondo', 'Karate', 'Boxing', 'Judo'],
  ['What fighting style does Steve Fox use?', 'Boxing', 'Kickboxing', 'Wrestling', 'Kung fu'],
  ['What fighting style does Leroy Smith use?', 'Wing Chun', 'Jeet Kune Do', 'Baguazhang', 'Tai chi'],
  ['Paul Phoenix\'s most famous move is called…', 'Deathfist', 'Phoenix Smasher', 'Burning Fist', 'Iron Hammer'],
  ['Which of these characters is an android?', 'Alisa', 'Lili', 'Asuka', 'Reina'],
  ['Which country is Victor Chevalier from?', 'France', 'Italy', 'Belgium', 'Canada'],
  ['Which country is Azucena from?', 'Peru', 'Mexico', 'Spain', 'Colombia'],
  ['What is Azucena famous for loving?', 'Coffee', 'Tea', 'Chocolate', 'Ramen'],
  ['In Tekken 8\'s story, Reina is revealed to be the child of…', 'Heihachi Mishima', 'Kazuya Mishima', 'Lee Chaolan', 'Jun Kazama'],
  ['Lars Alexandersson is the son of…', 'Heihachi Mishima', 'Kazuya Mishima', 'Jinpachi Mishima', 'Lee Chaolan'],
  ['Clive Rosfield is a guest character from which game?', 'Final Fantasy XVI', 'Final Fantasy XV', 'Devil May Cry 5', 'Soulcalibur VI'],
  ['Which Street Fighter character was a guest in Tekken 7?', 'Akuma', 'Ryu', 'M. Bison', 'Ken'],
  ['Negan, a Tekken 7 guest, comes from…', 'The Walking Dead', 'Resident Evil', 'Breaking Bad', 'Fatal Fury'],
  ['Geese Howard, a Tekken 7 guest, comes from…', 'Fatal Fury', 'Street Fighter', 'Mortal Kombat', 'Guilty Gear'],
  ['Which company publishes Tekken?', 'Bandai Namco', 'Capcom', 'SNK', 'Sega'],
  ['In what year did the first Tekken hit arcades?', '1994', '1990', '1997', '2000'],
  ['How many main attack buttons does Tekken use?', '4', '3', '5', '6'],
  ['In Tekken notation, what does "1" mean?', 'Left punch', 'Right punch', 'Left kick', 'Right kick'],
  ['In Tekken notation, what does "4" mean?', 'Right kick', 'Left kick', 'Right punch', 'Left punch'],
  ['Which system was introduced in Tekken 8?', 'Heat', 'Rage Drive', 'Bound', 'Tag Assault'],
  ['In Tekken 8, what button press activates Heat Burst?', '2+3', '1+2', '3+4', '1+4'],
  ['What does "i10" mean in frame data?', 'The move hits on frame 10', 'It does 10 damage', 'It is +10 on block', 'It has 10 frames of recovery'],
  ['A move that is "-15" on block is usually…', 'Launch punishable', 'Plus on block', 'Completely safe', 'Unblockable'],
  ['What does a "+" number on block mean?', 'You get to act first', 'Your opponent acts first', 'The move is a throw', 'The move is a low'],
  ['What is the standard startup of a jab in Tekken?', 'i10', 'i8', 'i13', 'i15'],
  ['What does KBD stand for?', 'Korean Backdash', 'Kazama Block Dodge', 'Kick Block Duck', 'King\'s Back Drop'],
  ['What does "whiff" mean?', 'An attack that misses', 'A blocked attack', 'A counter hit', 'A throw break'],
  ['What is a "wavedash" input?', 'f, n, d, df', 'b, b', 'd, d', 'f, f, f'],
  ['You break a throw by…', 'Pressing the right punch button(s) as you get grabbed', 'Holding back', 'Crouching', 'Pressing 3+4'],
  ['What does "Rage" do in Tekken 8?', 'Boosts damage when your health is low', 'Restores health', 'Makes you invincible', 'Doubles your speed'],
  ['Which Pakistani player became famous for winning EVO Japan and EVO in the same year (2019)?', 'Arslan Ash', 'Atif Butt', 'Awais Honey', 'Farzeen'],
  ['What is the name of Yoshimitsu\'s clan?', 'Manji Clan', 'Mishima Clan', 'Kazama Clan', 'Tekken Force'],
];

const commands = [new SlashCommandBuilder().setName('trivia').setDescription('Start a Tekken trivia question (first right answer wins)')];

const live = new Map(); // messageId -> { answer, locked:Set, done }

async function ask(channel, pingRole) {
  const recent = JSON.parse(kvGet('triviaRecent') ?? '[]');
  const pool = QUESTIONS.map((q, idx) => idx).filter((idx) => !recent.includes(idx));
  const idx = pick(pool.length ? pool : QUESTIONS.map((_, n) => n));
  kvSet('triviaRecent', JSON.stringify([...recent, idx].slice(-25)));
  const [question, correct, ...wrong] = QUESTIONS[idx];
  const options = shuffle([correct, ...wrong]);
  const letters = ['A', 'B', 'C', 'D'];
  const row = new ActionRowBuilder().addComponents(options.map((o, n) =>
    new ButtonBuilder().setCustomId(`trivia:${n}`).setLabel(letters[n]).setStyle(ButtonStyle.Secondary)));
  const msg = await channel.send({
    content: pingRole ? `<@&${pingRole}>` : undefined,
    embeds: [embed({
      title: 'Tekken trivia',
      description: `**${question}**\n\n${options.map((o, n) => `\`${letters[n]}\` ${o}`).join('\n')}`,
      footer: { text: 'First correct answer gets 10 points · one guess each · 30 seconds' },
      color: BRAND.gold,
    })],
    components: [row],
  });
  const state = { answer: options.indexOf(correct), correct, locked: new Set(), done: false };
  live.set(msg.id, state);
  if (channel.id === cfg.channels.daily) await msg.startThread({ name: `Trivia: ${question.slice(0, 80)}`, autoArchiveDuration: 1440 }).catch(() => {});
  setTimeout(async () => {
    if (state.done) return;
    state.done = true;
    live.delete(msg.id);
    await msg.edit({ components: [], embeds: [embed({ title: 'Tekken trivia: time\'s up', description: `**${question}**\n\nAnswer: **${correct}**\nNobody got it this time.`, color: BRAND.gray })] }).catch(() => {});
  }, 30000);
}

async function interaction(i) {
  if (i.isChatInputCommand() && i.commandName === 'trivia') {
    const wait = cooldown('trivia-channel', i.channelId, 45);
    if (wait) return ephemeral(i, `A question was just asked here. Next one in ${wait}s.`), true;
    await ephemeral(i, 'Question incoming.');
    await ask(i.channel);
    return true;
  }
  if (i.isButton() && i.customId.startsWith('trivia:')) {
    const state = live.get(i.message.id);
    if (!state || state.done) return ephemeral(i, 'This question is over.'), true;
    if (state.locked.has(i.user.id)) return ephemeral(i, 'You already guessed. One shot only!'), true;
    state.locked.add(i.user.id);
    if (Number(i.customId.split(':')[1]) !== state.answer) return ephemeral(i, `${E('cross')} Wrong answer. Better luck next time.`), true;
    state.done = true;
    live.delete(i.message.id);
    getUser(i.user.id);
    db.prepare('UPDATE users SET trivia = trivia + 10 WHERE id = ?').run(i.user.id);
    const old = i.message.embeds[0];
    await i.update({ components: [], embeds: [embed({ title: 'Tekken trivia: solved', description: `${old.description}\n\n${E('check')} **${state.correct}**\n${E('win')} ${i.user} got it first (+10 points)`, color: BRAND.green })] });
    return true;
  }
  return false;
}

function init(client) {
  client.once(Events.ClientReady, () => {
    setInterval(async () => {
      const last = Number(kvGet('triviaAuto') ?? 0);
      if (Date.now() - last < 6 * 60 * 60 * 1000) return;
      kvSet('triviaAuto', Date.now());
      const ch = client.guilds.cache.get(cfg.guildId)?.channels.cache.get(cfg.channels.daily ?? cfg.channels.botCommands);
      if (ch) await ask(ch, cfg.pingRoles.trivia).catch(console.error);
    }, 10 * 60 * 1000);
  });
}

module.exports = { commands, interaction, init };
