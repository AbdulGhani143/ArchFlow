import { generateSmartLayout } from "./smartZoningV3Engine.js";

const cases = [
  { plotGaj: 200, plotShape: "rectangle", bedrooms: 3, bathrooms: 2, frontDirection: "south" },
  { plotGaj: 120, plotShape: "rectangle", bedrooms: 2, bathrooms: 2, frontDirection: "south" },
  { plotGaj: 300, plotShape: "rectangle", bedrooms: 4, bathrooms: 3, frontDirection: "south" },
];

for (const c of cases) {
  console.log(`\n=== ${c.plotGaj} gaj, ${c.bedrooms}BR/${c.bathrooms}BA ===`);
  try {
    const r = generateSmartLayout(c);
    console.log("Score:", r.meta.score, " DeadSpace:", r.meta.deadSpaceArea);
    for (const rm of r.rooms) {
      const dims = `${rm.width}x${rm.height}`;
      const pos = `(${rm.x}, ${rm.y})`;
      console.log(`  ${rm.type.padEnd(22)} ${dims.padEnd(12)} @ ${pos}`);
    }

    // Check FIX 1: Service core (Kitchen width >= 8)
    const kitchen = r.rooms.find(rm => rm.type === "Kitchen");
    if (kitchen && kitchen.width < 8) console.log("  *** FIX 1 FAIL: Kitchen width < 8ft:", kitchen.width);

    // Check FIX 2: Living Room depth >= 12
    const living = r.rooms.find(rm => rm.type === "Living Room");
    if (living && living.height < 12) console.log("  *** FIX 2 FAIL: Living Room depth < 12ft:", living.height);

    // Check FIX 3: Attached baths should be vertically stacked (same X as bedroom)
    const beds = r.rooms.filter(rm => rm.type.includes("Bedroom") || rm.type === "Master Bedroom");
    const baths = r.rooms.filter(rm => rm.type.includes("Attached Bath") || rm.type === "Master Attached Bath");
    for (const bath of baths) {
      const matchBed = beds.find(b => Math.abs(b.x - bath.x) < 0.5);
      if (!matchBed) console.log(`  *** FIX 3 FAIL: ${bath.type} not aligned with any bedroom X`);
      else if (bath.width !== matchBed.width) console.log(`  *** FIX 3 WARN: ${bath.type} width(${bath.width}) != bedroom width(${matchBed.width})`);
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
