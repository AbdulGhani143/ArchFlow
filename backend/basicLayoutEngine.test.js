import test from "node:test";
import assert from "node:assert/strict";
import { generateLayout } from "./basicLayoutEngine.js";

function assertWithinBounds(layout) {
  for (const room of layout.rooms) {
    assert.ok(room.x >= -1e-6, `${room.type} starts outside the plot on x.`);
    assert.ok(room.y >= -1e-6, `${room.type} starts outside the plot on y.`);
    assert.ok(room.x + room.width <= layout.plot.width + 1e-6, `${room.type} exceeds plot width.`);
    assert.ok(room.y + room.height <= layout.plot.height + 1e-6, `${room.type} exceeds plot height.`);
  }
}

function assertNoOverlap(layout) {
  const solidRooms = layout.rooms.filter((room) => room.type !== "Hall");

  for (let index = 0; index < solidRooms.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < solidRooms.length; otherIndex += 1) {
      const first = solidRooms[index];
      const second = solidRooms[otherIndex];
      const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
      const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);

      assert.ok(
        overlapWidth <= 1e-6 || overlapHeight <= 1e-6,
        `${first.roomType} overlaps ${second.roomType}.`,
      );
    }
  }
}

function assertMinimumUsableDimensions(layout) {
  for (const room of layout.rooms) {
    if (room.type === "Hall") {
      continue;
    }

    assert.ok(room.width + 1e-6 >= 4, `${room.type} violates minimum usable width.`);
    assert.ok(room.height + 1e-6 >= 4, `${room.type} violates minimum usable height.`);
  }
}

test("rejects infeasible anchored layouts before placement", () => {
  assert.throws(
    () => generateLayout({
      plotWidth: 24,
      plotHeight: 24,
      bedrooms: 3,
      bathrooms: 2,
      bedroomSizes: ["large", "large", "large"],
      kitchenSize: "large",
    }),
    /Minimum required area|Plot is too small/,
  );
});

test("produces deterministic geometry for repeated anchored input", () => {
  const request = {
    plotWidth: 60,
    plotHeight: 45,
    bedrooms: 3,
    bathrooms: 2,
    bedroomSizes: ["large", "medium", "medium"],
    kitchenSize: "medium",
  };
  const first = generateLayout(request);
  const second = generateLayout(request);

  assert.deepEqual(first.rooms, second.rooms);
  assert.deepEqual(first.meta, second.meta);
});

test("keeps anchored rooms inside the plot without overlap", () => {
  const layout = generateLayout({
    plotWidth: 60,
    plotHeight: 45,
    bedrooms: 3,
    bathrooms: 2,
    bedroomSizes: ["large", "medium", "medium"],
    kitchenSize: "medium",
  });

  assertWithinBounds(layout);
  assertNoOverlap(layout);
  assertMinimumUsableDimensions(layout);
});

test("returns entrance, shaft, and hall metadata for connected layouts", () => {
  const layout = generateLayout({
    plotWidth: 48,
    plotHeight: 36,
    bedrooms: 2,
    bathrooms: 1,
    bedroomSizes: ["small", "medium"],
    kitchenSize: "small",
  });

  assert.ok(layout.rooms.some((room) => room.type.includes("Entrance")));
  assert.ok(layout.rooms.some((room) => room.type === "Shaft"));
  assert.ok(layout.rooms.some((room) => room.type === "Hall"));
  assert.equal(layout.meta.planningLogic, "boundary-aware");
  assert.equal(layout.meta.dwellingType, "house");
  assert.equal(layout.meta.frontDirection, "south");
});

test("tracks attached and shared bathrooms in the new anchored flow", () => {
  const layout = generateLayout({
    plotWidth: 60,
    plotHeight: 45,
    bedrooms: 3,
    bathrooms: 2,
    bedroomSizes: ["large", "medium", "medium"],
    kitchenSize: "medium",
  });

  const bathrooms = layout.rooms.filter((room) => room.type.includes("Bath") || room.type.includes("Bathroom"));
  assert.equal(bathrooms.length, 2);
  assert.ok(layout.rooms.some((room) => room.type.includes("Attached Bath")));
  assert.ok(layout.rooms.some((room) => room.type === "Common Bathroom"));
  assert.ok(layout.meta.features.attachedBathCount >= 1);
});
