import express from "express";
import { generateLayout } from "./layoutEngine.js";
import { generateSmartLayout } from "./smartMatrixEngine.js";
import { generateAiLayout } from "./aiLayoutService.js";
import { generateSmartLayout as generateSmartZoningLayout } from "./smartZoningV3Engine.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/layout", (request, response) => {
  try {
    const engine = request.body?.engine ?? (request.body?.useV2 ? "v2" : "v1");
    let payload;
    if (engine === "v3") payload = generateSmartZoningLayout(request.body ?? {});
    else if (engine === "v2") payload = generateSmartLayout(request.body ?? {});
    else payload = generateLayout(request.body ?? {});
    response.json(payload);
  } catch (error) {
    const statusCode = error.code === "NOT_POSSIBLE" ? 422 : 400;

    response.status(statusCode).json({
      error: error.message,
    });
  }
});

app.post("/api/layout/ai", async (request, response) => {
  try {
    const payload = await generateAiLayout(request.body ?? {});
    response.json(payload);
  } catch (error) {
    const statusCode = error.code === "AI_LAYOUT_ERROR" ? 422 : 400;
    response.status(statusCode).json({ error: error.message, details: error.details });
  }
});

app.listen(port, () => {
  console.log(`Floor plan backend listening on port ${port}`);
});
