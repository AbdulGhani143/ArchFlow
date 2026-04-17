/**
 * aiLayoutService.js
 *
 * Google Gemini-backed spatial logic service for 2D floor-plan generation.
 *
 * Notes:
 * - Uses the official Gemini REST `generateContent` endpoint with an API key
 *   in the `x-goog-api-key` header.
 * - Requests structured JSON output with relative percentages instead of exact
 *   feet/pixels, because percentage-based layouts are more reliable for LLMs.
 * - Adds strong error handling and JSON recovery fallbacks.
 *
 * Expected environment variables:
 * - GEMINI_API_KEY=your_google_ai_studio_key
 * - GEMINI_MODEL=optional, defaults to gemini-2.5-flash
 */

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Exact system prompt sent to Gemini.
 *
 * Important constraints included here:
 * - Return only relative percentages, never exact feet/pixels
 * - Respect Vastu-oriented placement guidance
 * - Keep service spaces clustered
 * - Return strict JSON only
 */
export const GEMINI_LAYOUT_SYSTEM_PROMPT = `
You are a Spatial Logic Engine for Indian residential floor plan generation.

Your job is to produce a realistic conceptual 2D floor-plan layout as STRICT JSON.

CRITICAL RULES:
1. DO NOT use exact feet, meters, pixels, or calculated absolute dimensions for room placement.
2. Use ONLY relative layout values:
   - xPercentage
   - yPercentage
   - widthPercentage
   - heightPercentage
3. All percentages must be relative to the full plot and should normally sum and align to create a contiguous layout.
4. Keep all coordinates within 0 to 100.
5. Do not create overlapping rooms.
6. Prefer simple rectangles.
7. Return JSON only. No markdown. No explanation. No prose.

INDIAN RESIDENTIAL / VASTU GUIDANCE:
1. Prefer Kitchen in South-East. If not feasible, North-West is the fallback.
2. Prefer Master Bedroom in South-West.
3. Prefer entrance in East or North when possible, but adapt logically to the requested plot/use case.
4. Bathrooms should be logically clustered and share a plumbing/service wall or shaft where possible.
5. Public spaces should connect cleanly:
   Entrance -> Living/Hall -> Bedrooms/Kitchen
6. Avoid placing bathrooms in the center of the home.
7. Keep the hall/living space as the circulation hub when possible.

LAYOUT LOGIC:
1. Use macro-zoning first:
   - Front/Public zone
   - Middle/shared circulation zone
   - Rear/private zone
2. Then place rooms inside those zones with relative proportions.
3. If multiple bedrooms exist, group them logically in the private zone.
4. Kitchen and bathrooms must be adjacency-aware for plumbing efficiency.
5. If a porch/foyer is appropriate, place it near the entrance zone.

OUTPUT REQUIREMENTS:
Return a JSON object with this exact high-level shape:
{
  "plot": {
    "width": <number>,
    "height": <number>,
    "unit": "feet"
  },
  "strategy": {
    "zoning": "<short string>",
    "vastuNotes": ["<string>"]
  },
  "rooms": [
    {
      "id": "<string>",
      "type": "<string>",
      "zone": "<Front|Middle|Back|Service|Outdoor>",
      "xPercentage": <number>,
      "yPercentage": <number>,
      "widthPercentage": <number>,
      "heightPercentage": <number>,
      "adjacentTo": ["<roomId>"],
      "openTo": ["<roomId>"],
      "open": <boolean>,
      "notes": "<short string>"
    }
  ]
}

JSON RULES:
1. Every room object must include id, type, zone, xPercentage, yPercentage, widthPercentage, heightPercentage.
2. Use numbers for percentage fields.
3. Use arrays for adjacentTo and openTo, even if empty.
4. If the kitchen is open to the hall, set open=true and include the hall id in openTo.
5. If a service shaft is used, represent it explicitly as a room of type "Shaft".
6. Keep the response concise but architecturally logical.
`.trim();

/**
 * JSON schema sent to Gemini structured output mode.
 * Official docs indicate JSON output can be requested with:
 * - generationConfig.responseMimeType = "application/json"
 * - generationConfig.responseJsonSchema = <JSON Schema>
 */
export const GEMINI_LAYOUT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    plot: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        unit: { type: "string" },
      },
      required: ["width", "height", "unit"],
      additionalProperties: false,
    },
    strategy: {
      type: "object",
      properties: {
        zoning: { type: "string" },
        vastuNotes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["zoning", "vastuNotes"],
      additionalProperties: false,
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          zone: { type: "string" },
          xPercentage: { type: "number" },
          yPercentage: { type: "number" },
          widthPercentage: { type: "number" },
          heightPercentage: { type: "number" },
          adjacentTo: {
            type: "array",
            items: { type: "string" },
          },
          openTo: {
            type: "array",
            items: { type: "string" },
          },
          open: { type: "boolean" },
          notes: { type: "string" },
        },
        required: [
          "id",
          "type",
          "zone",
          "xPercentage",
          "yPercentage",
          "widthPercentage",
          "heightPercentage",
          "adjacentTo",
          "openTo",
          "open",
          "notes",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["plot", "strategy", "rooms"],
  additionalProperties: false,
};

function createServiceError(message, details) {
  const error = new Error(message);
  error.code = "AI_LAYOUT_ERROR";
  if (details) {
    error.details = details;
  }
  return error;
}

function normalizeInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw createServiceError("Inputs must be a JSON object.");
  }

  return {
    plotWidth: Number(inputs.plotWidth),
    plotHeight: Number(inputs.plotHeight),
    bedrooms: Number(inputs.bedrooms ?? inputs.familyBedrooms ?? 0),
    bathrooms: Number(inputs.bathrooms ?? 0),
    kitchens: Number(inputs.kitchens ?? 1),
    halls: Number(inputs.halls ?? 1),
    guestRooms: Number(inputs.guestRooms ?? (inputs.hasGuestRoom ? 1 : 0)),
    otherRooms: Array.isArray(inputs.otherRooms) ? inputs.otherRooms : [],
    preferences: typeof inputs.preferences === "object" && inputs.preferences !== null
      ? inputs.preferences
      : {},
  };
}

function validateInputs(inputs) {
  if (!Number.isFinite(inputs.plotWidth) || inputs.plotWidth <= 0) {
    throw createServiceError("plotWidth must be a positive number.");
  }

  if (!Number.isFinite(inputs.plotHeight) || inputs.plotHeight <= 0) {
    throw createServiceError("plotHeight must be a positive number.");
  }

  for (const field of ["bedrooms", "bathrooms", "kitchens", "halls", "guestRooms"]) {
    if (!Number.isInteger(inputs[field]) || inputs[field] < 0) {
      throw createServiceError(`${field} must be an integer greater than or equal to 0.`);
    }
  }

  if (inputs.bedrooms + inputs.guestRooms === 0) {
    throw createServiceError("At least one bedroom or guest room is required.");
  }
}

function buildUserPrompt(inputs) {
  return `
Generate a realistic Indian residential floor plan concept using relative percentages.

User requirements:
- Plot width: ${inputs.plotWidth} feet
- Plot height: ${inputs.plotHeight} feet
- Bedrooms: ${inputs.bedrooms}
- Bathrooms: ${inputs.bathrooms}
- Kitchens: ${inputs.kitchens}
- Halls/Living rooms: ${inputs.halls}
- Guest rooms: ${inputs.guestRooms}
- Other requested rooms: ${JSON.stringify(inputs.otherRooms)}
- Preferences: ${JSON.stringify(inputs.preferences)}

Important:
- Use relative percentages only.
- Keep bathrooms near each other or near a shared shaft.
- Prefer Vastu-aware placement for kitchen and master bedroom.
- Keep circulation practical and intuitive.
- Return strict JSON only.
`.trim();
}

function buildGeminiRequestBody(inputs) {
  return {
    systemInstruction: {
      parts: [
        {
          text: GEMINI_LAYOUT_SYSTEM_PROMPT,
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildUserPrompt(inputs),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: GEMINI_LAYOUT_RESPONSE_SCHEMA,
      temperature: 0.3,
      topP: 0.9,
    },
  };
}

function extractCandidateText(apiResponseJson) {
  const parts = apiResponseJson?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => part?.text ?? "")
    .join("")
    .trim();
}

function tryParseJson(text) {
  return JSON.parse(text);
}

function extractJsonSubstring(text) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function safeParseGeminiJson(rawText) {
  try {
    return tryParseJson(rawText);
  } catch {
    const extracted = extractJsonSubstring(rawText);
    return tryParseJson(extracted);
  }
}

function boxesOverlap(a, b) {
  const ax2 = a.xPercentage + a.widthPercentage;
  const ay2 = a.yPercentage + a.heightPercentage;
  const bx2 = b.xPercentage + b.widthPercentage;
  const by2 = b.yPercentage + b.heightPercentage;
  const ox = Math.min(ax2, bx2) - Math.max(a.xPercentage, b.xPercentage);
  const oy = Math.min(ay2, by2) - Math.max(a.yPercentage, b.yPercentage);
  return ox > 0 && oy > 0;
}

function validateGeminiLayoutShape(layout, inputs) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    throw createServiceError("Gemini returned a non-object layout payload.");
  }

  if (!layout.plot || typeof layout.plot !== "object" || Array.isArray(layout.plot)) {
    throw createServiceError("Gemini returned layout without a valid plot object.", layout);
  }

  if (!Number.isFinite(layout.plot.width) || layout.plot.width <= 0
      || !Number.isFinite(layout.plot.height) || layout.plot.height <= 0
      || typeof layout.plot.unit !== "string") {
    throw createServiceError("Gemini returned plot with invalid dimensions.", layout.plot);
  }

  if (!layout.strategy || typeof layout.strategy !== "object" || Array.isArray(layout.strategy)) {
    throw createServiceError("Gemini returned layout without a valid strategy object.", layout);
  }

  if (typeof layout.strategy.zoning !== "string" || !Array.isArray(layout.strategy.vastuNotes)) {
    throw createServiceError("Gemini returned strategy with invalid fields.", layout.strategy);
  }

  if (!Array.isArray(layout.rooms) || layout.rooms.length === 0) {
    throw createServiceError("Gemini returned JSON without a valid rooms array.", layout);
  }

  const seenIds = new Set();

  for (const room of layout.rooms) {
    if (
      typeof room.id !== "string"
      || typeof room.type !== "string"
      || typeof room.zone !== "string"
      || !Array.isArray(room.adjacentTo)
      || !Array.isArray(room.openTo)
      || typeof room.open !== "boolean"
      || typeof room.notes !== "string"
      || !Number.isFinite(room.xPercentage)
      || !Number.isFinite(room.yPercentage)
      || !Number.isFinite(room.widthPercentage)
      || !Number.isFinite(room.heightPercentage)
    ) {
      throw createServiceError("Gemini returned a room with missing required fields.", room);
    }

    if (seenIds.has(room.id)) {
      throw createServiceError("Gemini returned duplicate room ids.", room);
    }
    seenIds.add(room.id);

    if (room.adjacentTo.some((id) => typeof id !== "string")
        || room.openTo.some((id) => typeof id !== "string")) {
      throw createServiceError("Gemini returned room adjacency/open links with invalid ids.", room);
    }

    if (room.xPercentage < 0 || room.yPercentage < 0
        || room.widthPercentage <= 0 || room.heightPercentage <= 0
        || room.xPercentage > 100 || room.yPercentage > 100
        || room.widthPercentage > 100 || room.heightPercentage > 100) {
      throw createServiceError("Gemini returned room percentages outside valid range.", room);
    }

    if (room.xPercentage + room.widthPercentage > 100
        || room.yPercentage + room.heightPercentage > 100) {
      throw createServiceError("Gemini returned room extending outside plot bounds.", room);
    }
  }

  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      if (boxesOverlap(layout.rooms[i], layout.rooms[j])) {
        throw createServiceError("Gemini returned overlapping rooms.", {
          roomA: layout.rooms[i].id,
          roomB: layout.rooms[j].id,
        });
      }
    }
  }

  const totalRequestedBedrooms = inputs.bedrooms + inputs.guestRooms;
  const bedroomCount = layout.rooms.filter((room) => room.type.toLowerCase().includes("bedroom")).length;
  const bathroomCount = layout.rooms.filter((room) => {
    const t = room.type.toLowerCase();
    return t.includes("bath") || t.includes("toilet");
  }).length;
  const kitchenCount = layout.rooms.filter((room) => room.type.toLowerCase().includes("kitchen")).length;
  const hallCount = layout.rooms.filter((room) => {
    const t = room.type.toLowerCase();
    return t.includes("hall") || t.includes("living");
  }).length;

  if (bedroomCount < totalRequestedBedrooms) {
    throw createServiceError("Gemini returned fewer bedrooms than requested.", {
      requested: totalRequestedBedrooms,
      actual: bedroomCount,
    });
  }
  if (bathroomCount < inputs.bathrooms) {
    throw createServiceError("Gemini returned fewer bathrooms than requested.", {
      requested: inputs.bathrooms,
      actual: bathroomCount,
    });
  }
  if (kitchenCount < inputs.kitchens) {
    throw createServiceError("Gemini returned fewer kitchens than requested.", {
      requested: inputs.kitchens,
      actual: kitchenCount,
    });
  }
  if (hallCount < inputs.halls) {
    throw createServiceError("Gemini returned fewer halls/living spaces than requested.", {
      requested: inputs.halls,
      actual: hallCount,
    });
  }

  return layout;
}

/**
 * Main service entrypoint.
 *
 * Usage:
 * const layout = await generateAiLayout({
 *   plotWidth: 30,
 *   plotHeight: 50,
 *   bedrooms: 3,
 *   bathrooms: 2
 * });
 */
export async function generateAiLayout(rawInputs) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw createServiceError("Missing GEMINI_API_KEY environment variable.");
  }

  const inputs = normalizeInputs(rawInputs);
  validateInputs(inputs);

  const requestBody = buildGeminiRequestBody(inputs);
  const endpoint = `${GEMINI_API_BASE_URL}/models/${DEFAULT_GEMINI_MODEL}:generateContent`;

  let response;
  let responseText = "";

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    throw createServiceError("Failed to reach Gemini API.", {
      cause: networkError.message,
    });
  }

  try {
    responseText = await response.text();
  } catch (readError) {
    throw createServiceError("Failed to read Gemini API response body.", {
      cause: readError.message,
    });
  }

  let responseJson;

  try {
    responseJson = JSON.parse(responseText);
  } catch (parseError) {
    throw createServiceError("Gemini API returned a non-JSON HTTP response.", {
      status: response.status,
      body: responseText,
      cause: parseError.message,
    });
  }

  if (!response.ok) {
    throw createServiceError("Gemini API returned an error response.", {
      status: response.status,
      body: responseJson,
    });
  }

  const candidateText = extractCandidateText(responseJson);

  if (!candidateText) {
    throw createServiceError("Gemini returned no candidate text.", responseJson);
  }

  let parsedLayout;

  try {
    parsedLayout = safeParseGeminiJson(candidateText);
  } catch (jsonError) {
    throw createServiceError("Gemini returned malformed layout JSON.", {
      rawText: candidateText,
      cause: jsonError.message,
    });
  }

  return validateGeminiLayoutShape(parsedLayout, inputs);
}

export default {
  generateAiLayout,
  GEMINI_LAYOUT_SYSTEM_PROMPT,
  GEMINI_LAYOUT_RESPONSE_SCHEMA,
};
