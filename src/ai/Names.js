// Random gamer-style nicknames (original, generated from parts).
const A = ['Pixel', 'Turbo', 'Shadow', 'Cosmic', 'Salty', 'Lucky', 'Frosty', 'Neon', 'Captain', 'Silent', 'Crispy', 'Wobbly', 'Rusty', 'Mega', 'Sneaky', 'Spicy', 'Toxic', 'Fluffy', 'Hyper', 'Lazy', 'Angry', 'Sir', 'Lil', 'Big', 'Glitchy', 'Noodle', 'Thunder', 'Velvet', 'Crimson', 'Atomic'];
const B = ['Llama', 'Taco', 'Ninja', 'Potato', 'Wizard', 'Pickle', 'Falcon', 'Panda', 'Goblin', 'Cactus', 'Badger', 'Waffle', 'Raptor', 'Muffin', 'Viking', 'Otter', 'Banana', 'Comet', 'Sniper', 'Builder', 'Dragon', 'Yeti', 'Bandit', 'Penguin', 'Ghost', 'Moose', 'Kraken', 'Nugget', 'Hamster', 'Squid'];
const SUFFIX = ['', '', '', '_TTV', 'YT', 'xX', '_pro', '99', '2k', '_', 'OG', '420', '007', '_jr', 'HD'];

export function botNames(rng, count) {
  const used = new Set(['You']);
  const out = [];
  while (out.length < count) {
    let name;
    const style = rng.int(0, 4);
    const a = rng.pick(A), b = rng.pick(B), s = rng.pick(SUFFIX);
    if (style === 0) name = a + b + s;
    else if (style === 1) name = (a + '_' + b).toLowerCase() + rng.int(1, 99);
    else if (style === 2) name = 'xX' + b + a + 'Xx';
    else if (style === 3) name = b + rng.int(10, 9999);
    else name = a.toUpperCase().slice(0, 4) + b + s;
    if (used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  return out;
}
