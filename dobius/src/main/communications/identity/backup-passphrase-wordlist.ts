// 312 unique, short, unambiguous English words for backup-passphrase
// generation (see backup-passphrase.ts). This is NOT the canonical EFF short
// wordlist — that list ships as a separate download and pulling it in would
// mean either a new dependency or vendoring a large external data file,
// both out of scope for this slice. 312 entries gives log2(312) ≈ 8.29 bits
// of entropy per word, versus the EFF list's ~10.3 bits/word. See RISKS in
// the build report for the exact entropy tradeoff and how to swap in the
// real EFF list later — backup-passphrase.ts samples uniformly from
// whatever length this array is, so growing it needs no other code change.
export const BACKUP_PASSPHRASE_WORDLIST: readonly string[] = [
  'abbey', 'acid', 'acorn', 'across', 'actor', 'agile', 'alarm', 'album',
  'alert', 'alley', 'almond', 'alpha', 'amber', 'anchor', 'angle', 'ankle',
  'answer', 'anvil', 'apple', 'apron', 'arch', 'arena', 'armor', 'arrow',
  'artist', 'ashore', 'aspect', 'aspen', 'atlas', 'attic', 'august', 'aunt',
  'autumn', 'avatar', 'avenue', 'awning', 'axiom', 'badge', 'bakery', 'balcony',
  'bamboo', 'banjo', 'barrel', 'basalt', 'basil', 'basket', 'beacon', 'beagle',
  'beaver', 'before', 'begin', 'belief', 'bell', 'belt', 'bench', 'beryl',
  'better', 'bicep', 'bike', 'birch', 'bishop', 'blade', 'blanket', 'bloom',
  'blossom', 'blue', 'bluff', 'boat', 'bobcat', 'bonfire', 'bonus', 'boot',
  'border', 'bottle', 'boulder', 'bracket', 'braid', 'brain', 'branch', 'brass',
  'bravo', 'bread', 'breeze', 'brick', 'bridge', 'bright', 'broker', 'bronze',
  'brook', 'brush', 'bubble', 'bucket', 'buckle', 'buffalo', 'bulb', 'bundle',
  'bunker', 'burrow', 'button', 'cabin', 'cactus', 'camera', 'campus', 'canal',
  'candle', 'candor', 'canoe', 'canvas', 'canyon', 'cape', 'captain', 'carbon',
  'cargo', 'carpet', 'carrot', 'castle', 'cedar', 'cellar', 'cement', 'chalk',
  'chamber', 'chant', 'chapel', 'charm', 'chart', 'chase', 'cherry', 'chess',
  'chill', 'chimney', 'circle', 'cliff', 'clover', 'coast', 'cobalt', 'coffee',
  'comet', 'compass', 'copper', 'coral', 'corner', 'cotton', 'cousin', 'coyote',
  'crane', 'crater', 'cream', 'creek', 'crest', 'cricket', 'crimson', 'crisp',
  'crown', 'cyclone', 'crystal', 'cuddle', 'curfew', 'curious', 'cursor', 'curve',
  'custom', 'cypress', 'dagger', 'dahlia', 'daisy', 'dance', 'dawn', 'decade',
  'deer', 'delta', 'depot', 'desert', 'design', 'desk', 'dexter', 'diesel',
  'dinner', 'diver', 'dolphin', 'domain', 'donkey', 'dorm', 'double', 'dove',
  'drift', 'drum', 'duck', 'dune', 'dusk', 'eagle', 'earth', 'easel',
  'east', 'echo', 'eddy', 'eggplant', 'elbow', 'elder', 'electric', 'elk',
  'elm', 'ember', 'emerald', 'engine', 'ensign', 'equal', 'estate', 'ether',
  'exit', 'expert', 'export', 'fable', 'fabric', 'falcon', 'family', 'fantasy',
  'farm', 'feather', 'fence', 'ferry', 'fiber', 'fiddle', 'field', 'finch',
  'finger', 'fiord', 'flame', 'flannel', 'flare', 'flavor', 'flint', 'flood',
  'floral', 'flute', 'foggy', 'forest', 'forge', 'fossil', 'fountain', 'fox',
  'frame', 'freckle', 'fresco', 'friday', 'fringe', 'frost', 'fruit', 'galaxy',
  'garden', 'gasket', 'gather', 'gecko', 'gentle', 'geyser', 'ginger', 'glacier',
  'glass', 'glide', 'globe', 'gold', 'gopher', 'gorge', 'grain', 'grand',
  'granite', 'grape', 'grass', 'gravel', 'green', 'grid', 'grove', 'guitar',
  'gulf', 'gully', 'habit', 'hallway', 'hammer', 'harbor', 'harvest', 'hazel',
  'heather', 'helix', 'hemlock', 'heron', 'hidden', 'hillside', 'hive', 'hollow',
  'honey', 'horizon', 'hornet', 'hostel', 'hunter', 'husky', 'hyacinth', 'igloo',
  'iguana', 'inbox', 'index', 'indigo', 'inlet', 'inner', 'invest', 'ivory',
  'jacket', 'jade', 'jaguar', 'jasmine', 'jasper', 'jetty', 'jigsaw', 'jockey'
] as const

if (new Set(BACKUP_PASSPHRASE_WORDLIST).size !== BACKUP_PASSPHRASE_WORDLIST.length) {
  throw new Error('BACKUP_PASSPHRASE_WORDLIST contains a duplicate entry')
}
