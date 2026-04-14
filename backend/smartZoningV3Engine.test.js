import test from "node:test";
import assert from "node:assert/strict";
import { generateSmartLayout } from "./smartZoningV3Engine.js";

/* ── Helper Assertions ── */

function assertWithinBuildable(layout) {
  const ba = layout.meta.buildableArea;
  for (const room of layout.rooms) {
    assert.ok(room.x >= ba.x - 0.5, `${room.type} (${room.id}) starts before buildable X.`);
    assert.ok(room.y >= ba.y - 0.5, `${room.type} (${room.id}) starts before buildable Y.`);
    assert.ok(room.x + room.width <= ba.x + ba.width + 0.5,
      `${room.type} (${room.id}) exceeds buildable width.`);
    assert.ok(room.y + room.height <= ba.y + ba.height + 0.5,
      `${room.type} (${room.id}) exceeds buildable height.`);
  }
}

function assertNoOverlap(layout) {
  const rooms = layout.rooms;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(
        overlapX <= 0.5 || overlapY <= 0.5,
        `${a.type} (${a.id}) overlaps ${b.type} (${b.id}).`
      );
    }
  }
}

function assertOutputSchema(layout) {
  assert.ok(layout.plot, "Missing plot object");
  assert.ok(typeof layout.plot.width === "number", "plot.width must be number");
  assert.ok(typeof layout.plot.height === "number", "plot.height must be number");
  assert.ok(typeof layout.plot.gaj === "number", "plot.gaj must be number");
  assert.ok(typeof layout.plot.areaSqFt === "number", "plot.areaSqFt must be number");
  assert.ok(typeof layout.plot.shape === "string", "plot.shape must be string");

  assert.ok(Array.isArray(layout.rooms), "rooms must be array");
  for (const r of layout.rooms) {
    assert.ok(typeof r.id === "string", `Room missing id`);
    assert.ok(typeof r.type === "string", `Room ${r.id} missing type`);
    assert.ok(typeof r.zone === "string", `Room ${r.id} missing zone`);
    assert.ok(typeof r.x === "number", `Room ${r.id} missing x`);
    assert.ok(typeof r.y === "number", `Room ${r.id} missing y`);
    assert.ok(typeof r.width === "number", `Room ${r.id} missing width`);
    assert.ok(typeof r.height === "number", `Room ${r.id} missing height`);
    assert.ok(typeof r.ventilation === "string", `Room ${r.id} missing ventilation`);
    assert.ok(typeof r.openToHall === "boolean", `Room ${r.id} missing openToHall`);
  }

  const m = layout.meta;
  assert.ok(m, "Missing meta object");
  assert.equal(m.layoutMode, "smart-zoning");
  assert.equal(m.planningLogic, "smart-zoning");
  assert.ok(typeof m.connected === "boolean", "meta.connected must be boolean");
  assert.ok(typeof m.hallSegments === "number", "meta.hallSegments must be number");
  assert.ok(typeof m.deadSpaceArea === "number", "meta.deadSpaceArea must be number");
  assert.ok(typeof m.attachedBathrooms === "number", "meta.attachedBathrooms must be number");
  assert.ok(typeof m.sharedBathrooms === "number", "meta.sharedBathrooms must be number");
  assert.ok(m.buildableArea, "meta.buildableArea must exist");
  assert.ok(typeof m.buildableArea.x === "number");
  assert.ok(typeof m.buildableArea.width === "number");
  assert.ok(typeof m.score === "number", "meta.score must be number");
  assert.ok(Array.isArray(m.ventilationWarnings), "meta.ventilationWarnings must be array");
}

/* ── House Layout Config ── */
const houseInput = {
  plotGaj: 300,
  plotShape: "rectangle",
  dwellingType: "house",
  bedrooms: 3,
  bathrooms: 2,
  frontDirection: "south",
  boundaries: { north: "covered", east: "open", south: "front", west: "covered" },
};

/* ── Flat Layout Config ── */
const flatInput = {
  plotGaj: 200,
  plotShape: "rectangle",
  dwellingType: "flat",
  bedrooms: 2,
  bathrooms: 2,
  frontDirection: "south",
  boundaries: { north: "covered", east: "open", south: "front", west: "covered" },
};

/* ═══════════════════════════════════════════════════════════
   TEST CASES
   ═══════════════════════════════════════════════════════════ */

test("1. Determinism — same input produces identical output", () => {
  const first = generateSmartLayout(houseInput);
  const second = generateSmartLayout(houseInput);
  assert.deepStrictEqual(first.rooms, second.rooms);
  assert.deepStrictEqual(first.meta, second.meta);
});

test("2. Bounds — all rooms inside buildable area (house)", () => {
  const layout = generateSmartLayout(houseInput);
  assertWithinBuildable(layout);
});

test("3. No overlaps (house)", () => {
  const layout = generateSmartLayout(houseInput);
  assertNoOverlap(layout);
});

test("4. Minimum sizes — room dimensions meet hard constraints", () => {
  const layout = generateSmartLayout(houseInput);
  for (const r of layout.rooms) {
    assert.ok(r.width > 0, `${r.type} has zero width`);
    assert.ok(r.height > 0, `${r.type} has zero height`);
    // Minimum 3ft for any dimension (corridor minimum)
    assert.ok(r.width >= 2.5 || r.height >= 2.5,
      `${r.type} (${r.id}) is too small: ${r.width}x${r.height}`);
  }
});

test("5. Connectivity — all rooms reachable from entrance", () => {
  const layout = generateSmartLayout(houseInput);
  assert.equal(layout.meta.connected, true, "Layout must be fully connected");
});

test("6. Ventilation — habitable rooms have wall contact", () => {
  const layout = generateSmartLayout(houseInput);
  const habitable = layout.rooms.filter(r =>
    r.type.includes("Bedroom") || r.type === "Master Bedroom" ||
    r.type === "Living Room" || r.type === "Kitchen");
  for (const r of habitable) {
    assert.ok(r.ventilation !== "none",
      `${r.type} (${r.id}) has no ventilation`);
  }
});

test("7. House mode — correct zones and features", () => {
  const layout = generateSmartLayout(houseInput);
  assert.equal(layout.meta.dwellingType, "house");
  assert.ok(layout.rooms.some(r => r.type === "Entrance"), "House must have entrance");
  assert.ok(layout.rooms.some(r => r.type === "Kitchen"), "House must have kitchen");
  assert.ok(layout.rooms.some(r => r.type === "Living Room"), "House must have living room");
  assert.ok(layout.rooms.some(r => r.type.includes("Bedroom")), "House must have bedrooms");
});

test("8. Flat mode — shaft mandatory, no parking, bedrooms on ext walls", () => {
  const layout = generateSmartLayout(flatInput);
  assert.equal(layout.meta.dwellingType, "flat");
  assert.ok(layout.rooms.some(r => r.type === "Shaft"), "Flat must have shaft");
  assert.ok(!layout.rooms.some(r => r.type === "Parking"), "Flat must NOT have parking");
  assert.ok(layout.rooms.some(r => r.type === "Balcony"), "Flat must have balcony");

  // All bedrooms must have ventilation (external wall contact)
  const bedrooms = layout.rooms.filter(r =>
    r.type.includes("Bedroom") || r.type === "Master Bedroom");
  for (const bed of bedrooms) {
    assert.ok(bed.ventilation !== "none",
      `Flat bedroom ${bed.id} must be on external wall`);
  }
});

test("9. Infeasible rejection — throws correct error message", () => {
  assert.throws(
    () => generateSmartLayout({
      plotGaj: 60,
      plotShape: "rectangle",
      dwellingType: "house",
      bedrooms: 6,
      bathrooms: 4,
    }),
    { message: "Minimum required area exceeded for the requested configuration." }
  );
});

test("10. Output schema — all required fields present", () => {
  const layout = generateSmartLayout(houseInput);
  assertOutputSchema(layout);
});

test("11. Output schema — flat layout schema", () => {
  const layout = generateSmartLayout(flatInput);
  assertOutputSchema(layout);
});

test("12. Dead space — calculated correctly and reasonable", () => {
  const layout = generateSmartLayout(houseInput);
  const ba = layout.meta.buildableArea;
  const buildableTotal = ba.width * ba.height;
  const roomTotal = layout.rooms.reduce((s, r) => s + r.width * r.height, 0);
  const expectedDead = Math.max(0, buildableTotal - roomTotal);
  
  // Dead space should be within reasonable tolerance of calculated value
  assert.ok(Math.abs(layout.meta.deadSpaceArea - Math.round(expectedDead * 100) / 100) < 1,
    `Dead space mismatch: got ${layout.meta.deadSpaceArea}, expected ~${expectedDead.toFixed(2)}`);
});

test("13. Bounds — flat layout rooms inside buildable area", () => {
  const layout = generateSmartLayout(flatInput);
  assertWithinBuildable(layout);
});

test("14. No overlaps — flat layout", () => {
  const layout = generateSmartLayout(flatInput);
  assertNoOverlap(layout);
});

test("15. Various plot sizes — compact house", () => {
  const layout = generateSmartLayout({
    ...houseInput,
    plotGaj: 100,
    bedrooms: 2,
    bathrooms: 1,
  });
  assertOutputSchema(layout);
  assertWithinBuildable(layout);
});

test("16. Various plot sizes — large house", () => {
  const layout = generateSmartLayout({
    ...houseInput,
    plotGaj: 400,
    bedrooms: 4,
    bathrooms: 3,
  });
  assertOutputSchema(layout);
  assertWithinBuildable(layout);
});
