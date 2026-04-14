import { generateLayout } from './layoutEngine.js';

const t = {
  plotGaj: 300,
  plotShape: 'square',
  dwellingType: 'house',
  bedrooms: 3,
  bathrooms: 2,
  frontDirection: 'south',
  boundaries: { north: 'covered', east: 'open', south: 'front', west: 'covered' }
};

try {
  const res = generateLayout(t);
  console.log("Plot: ", res.plot.width, "x", res.plot.height);
  res.rooms.forEach(r => {
    console.log(`${r.id.padEnd(15)} (${r.type.padEnd(15)}): ${r.width}x${r.height} | pos: ${r.x},${r.y}`);
  });
} catch (e) {
  console.error(e);
}
