// Shared data used by both setup.js and the bot.

const BRAND = {
  name: "thewhifflord's dojo",
  handle: 'thewhifflord',
  color: 0xe63946, // Tekken red
  gold: 0xf4a261,
  green: 0x2a9d8f,
  blue: 0x457b9d,
  dark: 0x16161c,
  gray: 0x4a4a55,
};

const SOCIALS = [
  { name: 'Instagram', url: 'https://www.instagram.com/thewhifflord/' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@thewhifflord' },
  { name: 'YouTube', url: 'https://www.youtube.com/@thewhifflord' },
];

// Tekken 8 roster as of Oct 2026. slug = tekkendocs.com id.
const CHARACTERS = [
  ['Alisa', 'alisa'], ['Anna', 'anna'], ['Armor King', 'armor-king'], ['Asuka', 'asuka'],
  ['Azucena', 'azucena'], ['Bob', 'bob'], ['Bryan', 'bryan'], ['Claudio', 'claudio'],
  ['Clive', 'clive'], ['Devil Jin', 'devil-jin'], ['Dragunov', 'dragunov'], ['Eddy', 'eddy'],
  ['Fahkumram', 'fahkumram'], ['Feng', 'feng'], ['Heihachi', 'heihachi'], ['Hwoarang', 'hwoarang'],
  ['Jack-8', 'jack-8'], ['Jin', 'jin'], ['Jun', 'jun'], ['Kazuya', 'kazuya'],
  ['King', 'king'], ['Kuma', 'kuma'], ['Kunimitsu', 'kunimitsu'], ['Lars', 'lars'],
  ['Law', 'law'], ['Lee', 'lee'], ['Leo', 'leo'], ['Leroy', 'leroy'],
  ['Lidia', 'lidia'], ['Lili', 'lili'], ['Miary Zo', 'miary-zo'], ['Nina', 'nina'],
  ['Panda', 'panda'], ['Paul', 'paul'], ['Raven', 'raven'], ['Reina', 'reina'],
  ['Shaheen', 'shaheen'], ['Steve', 'steve'], ['Victor', 'victor'], ['Xiaoyu', 'xiaoyu'],
  ['Yoshimitsu', 'yoshimitsu'], ['Zafina', 'zafina'],
].map(([name, slug]) => ({ name, slug }));

// Self-assign rank brackets (Tekken 8 ranks grouped so the role list stays compact).
const RANKS = [
  { key: 'beginner', name: 'Beginner – Cavalry', color: 0x8bc34a, hex: '#8bc34a' },
  { key: 'warrior', name: 'Warrior – Garyu', color: 0xffc107, hex: '#ffc107' },
  { key: 'ruler', name: 'Shinryu – Battle Ruler', color: 0xab47bc, hex: '#ab47bc' },
  { key: 'blue', name: 'Fujin – Bushin', color: 0x42a5f5, hex: '#42a5f5' },
  { key: 'king', name: 'Tekken King and up', color: 0xef5350, hex: '#ef5350' },
  { key: 'god', name: 'Max Rank', color: 0xb0bec5, hex: '#37474f' },
];

const PLATFORMS = [
  { key: 'pc', name: 'PC' },
  { key: 'ps', name: 'PlayStation' },
  { key: 'xbox', name: 'Xbox' },
];

const REGIONS = [
  { key: 'nae', name: 'NA East' }, { key: 'naw', name: 'NA West' }, { key: 'sa', name: 'South America' },
  { key: 'eu', name: 'Europe' }, { key: 'me', name: 'Middle East' }, { key: 'asia', name: 'Asia' },
  { key: 'oce', name: 'Oceania' }, { key: 'af', name: 'Africa' },
];

const PINGS = [
  { key: 'announce', name: 'Announcement Pings', desc: 'Big server news' },
  { key: 'content', name: 'Content Pings', desc: 'New posts and videos' },
  { key: 'tourney', name: 'Tournament Pings', desc: 'Tournaments and events' },
  { key: 'lfg', name: 'LFG Pings', desc: 'Someone is looking for games' },
  { key: 'trivia', name: 'Trivia Pings', desc: 'Trivia drops and mini-games' },
];

// Level ladder. Perks are enforced by the bot / role permissions.
const LEVEL_ROLES = [
  { level: 3, name: 'Rookie', color: 0x9e9e9e, perk: 'Post images, GIFs, clips and use outside emojis' },
  { level: 5, name: 'Challenger', color: 0x4fc3f7, perk: 'Post links' },
  { level: 10, name: 'Contender', color: 0x7e57c2, perk: 'Pick a name color with /color' },
  { level: 20, name: 'Veteran', color: 0xff7043, perk: 'Access to #veterans-lounge' },
  { level: 35, name: 'Elite', color: 0xffca28, perk: 'Shown separately in the member list', hoist: true },
  { level: 50, name: 'Legend', color: 0xfff176, perk: 'Request your own custom role in #support', hoist: true },
];
const LINK_LEVEL = 5;
const MEDIA_LEVEL = 3;
const COLOR_LEVEL = 10;

// Cosmetic name colors for /color (Contender+ and Supporters).
const NAME_COLORS = [
  { key: 'crimson', name: 'Crimson', color: 0xdc2f45 }, { key: 'ember', name: 'Ember', color: 0xff7b39 },
  { key: 'gold', name: 'Gold', color: 0xf6c344 }, { key: 'jade', name: 'Jade', color: 0x3ccf91 },
  { key: 'ocean', name: 'Ocean', color: 0x3fa7f5 }, { key: 'violet', name: 'Violet', color: 0x9d6bff },
  { key: 'rose', name: 'Rose', color: 0xff6fb5 }, { key: 'ice', name: 'Ice', color: 0xbfe8ff },
];

// Custom emojis. "app" = bot-only icons (application emojis), "guild" = server emojis members can use.
const EMOJIS = {
  app: [
    { name: 'wd_plus', glyph: 'plus', color: '#2a9d8f' },
    { name: 'wd_minus', glyph: 'minus', color: '#e63946' },
    { name: 'wd_launch', text: '!', color: '#9d0208', size: 110 },
    { name: 'wd_safe', glyph: 'check', color: '#457b9d' },
    { name: 'wd_check', glyph: 'check', color: '#2a9d8f' },
    { name: 'wd_cross', glyph: 'cross', color: '#e63946' },
    { name: 'wd_arrow', glyph: 'arrow', color: '#e63946' },
    { name: 'wd_dot', shape: 'diamond', color: '#e63946', text: '' },
    { name: 'wd_lv', text: 'LV', color: '#f4a261', shape: 'diamond', size: 60 },
    { name: 'wd_xp', text: 'XP', color: '#e63946', shape: 'rounded', size: 70 },
    { name: 'wd_win', text: 'W', color: '#f4a261', size: 90 },
    { name: 'wd_loss', text: 'L', color: '#4a4a55', size: 90 },
    { name: 'wd_warn', text: '!', color: '#f4a261', shape: 'rounded', size: 100 },
    { name: 'wd_mod', text: 'MOD', color: '#457b9d', shape: 'rounded', size: 60 },
    ...RANKS.map((r) => ({ name: `wd_rank_${r.key}`, shape: 'diamond', color: r.hex, text: '' })),
  ],
  guild: [
    { name: 'gg', text: 'GG', color: '#e63946', shape: 'rounded' },
    { name: 'ez', text: 'EZ', color: '#2a9d8f', shape: 'rounded' },
    { name: 'whiff', text: 'WHIFF', color: '#4a4a55', shape: 'rounded', size: 54 },
    { name: 'salty', text: 'SALT', color: '#f5f5f7', fg: '#16161c', shape: 'rounded', size: 60 },
    { name: 'lab', text: 'LAB', color: '#457b9d', shape: 'rounded', size: 66 },
    { name: 'heat', text: 'HEAT', color: '#ff7b39', shape: 'rounded', size: 56 },
    { name: 'punish', text: 'PUNISH', color: '#9d0208', shape: 'rounded', size: 44 },
    { name: 'ko', text: 'KO', color: '#f6c344', fg: '#16161c', shape: 'circle' },
    { name: 'plusframes', glyph: 'plus', color: '#2a9d8f' },
    { name: 'minusframes', glyph: 'minus', color: '#e63946' },
    { name: 'wd', text: 'WD', color: '#e63946', shape: 'rounded', size: 70 },
  ],
};

module.exports = {
  BRAND, SOCIALS, CHARACTERS, RANKS, PLATFORMS, REGIONS, PINGS, LEVEL_ROLES, NAME_COLORS, EMOJIS,
  LINK_LEVEL, MEDIA_LEVEL, COLOR_LEVEL,
};
