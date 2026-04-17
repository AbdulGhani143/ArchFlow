import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { generateLayout } from "./basicLayoutEngine.js";
import { generateAiLayout } from "./aiLayoutEngine.js";
import { generateSmartLayout as generateZoningLayout } from "./zoningLayoutEngine.js";
import User from "./models/User.js";
import Design from "./models/Design.js";

const app = express();
const port = process.env.PORT || 3001;
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET || "change-this-jwt-secret";
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

if (jwtSecret === "change-this-jwt-secret") {
  console.warn("JWT_SECRET is using a placeholder value. Set a strong secret in .env for production.");
}

app.use(express.json());

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function sanitizeUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function createAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      email: user.email,
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn },
  );
}

function readBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return "";
  const [scheme, token] = headerValue.trim().split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token;
}

function normalizeDesignName(name) {
  return String(name ?? "").trim();
}

function isValidDesignData(designData) {
  if (!designData || typeof designData !== "object" || Array.isArray(designData)) {
    return false;
  }

  if (!designData.plot || typeof designData.plot !== "object") {
    return false;
  }

  if (!Array.isArray(designData.layout)) {
    return false;
  }

  return true;
}

function sanitizeDesign(design) {
  return {
    id: String(design._id),
    userId: String(design.userId),
    name: design.name,
    designData: design.designData,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
  };
}

async function requireAuth(request, response, next) {
  try {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      response.status(401).json({ error: "Authorization token is required." });
      return;
    }

    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.sub).select("name email createdAt");

    if (!user) {
      response.status(401).json({ error: "User not found for this token." });
      return;
    }

    request.authUser = user;
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired token." });
  }
}

async function connectDatabase() {
  if (!mongoUri) {
    console.warn("MONGODB_URI is missing. Auth endpoints will fail until MongoDB is configured.");
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected.");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}

app.post("/api/auth/signup", async (request, response) => {
  try {
    const name = String(request.body?.name ?? "").trim();
    const email = normalizeEmail(request.body?.email);
    const password = String(request.body?.password ?? "");

    if (!name || !email || !password) {
      response.status(400).json({ error: "Name, email, and password are required." });
      return;
    }

    if (password.length < 6) {
      response.status(400).json({ error: "Password must be at least 6 characters." });
      return;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      response.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = createAuthToken(user);

    response.status(201).json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    response.status(500).json({ error: "Could not create account.", details: error.message });
  }
});

app.post("/api/auth/login", async (request, response) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const password = String(request.body?.password ?? "");

    if (!email || !password) {
      response.status(400).json({ error: "Email and password are required." });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      response.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      response.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = createAuthToken(user);
    response.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    response.status(500).json({ error: "Could not log in.", details: error.message });
  }
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: sanitizeUser(request.authUser) });
});

app.get("/api/designs", requireAuth, async (request, response) => {
  try {
    const designs = await Design.find({ userId: request.authUser._id })
      .sort({ updatedAt: -1 })
      .lean();

    response.json({
      designs: designs.map((design) => sanitizeDesign(design)),
    });
  } catch (error) {
    response.status(500).json({ error: "Could not fetch saved designs.", details: error.message });
  }
});

app.get("/api/designs/:designId", requireAuth, async (request, response) => {
  try {
    const { designId } = request.params;
    if (!mongoose.isValidObjectId(designId)) {
      response.status(400).json({ error: "Invalid design id." });
      return;
    }

    const design = await Design.findOne({ _id: designId, userId: request.authUser._id }).lean();
    if (!design) {
      response.status(404).json({ error: "Design not found." });
      return;
    }

    response.json({ design: sanitizeDesign(design) });
  } catch (error) {
    response.status(500).json({ error: "Could not fetch design.", details: error.message });
  }
});

app.post("/api/designs", requireAuth, async (request, response) => {
  try {
    const name = normalizeDesignName(request.body?.name);
    const designData = request.body?.designData;

    if (!name) {
      response.status(400).json({ error: "Design name is required." });
      return;
    }

    if (!isValidDesignData(designData)) {
      response.status(400).json({ error: "Design data is invalid. Expected plot + layout structure." });
      return;
    }

    const design = await Design.create({
      userId: request.authUser._id,
      name,
      designData,
    });

    response.status(201).json({ design: sanitizeDesign(design) });
  } catch (error) {
    response.status(500).json({ error: "Could not save design.", details: error.message });
  }
});

app.put("/api/designs/:designId", requireAuth, async (request, response) => {
  try {
    const { designId } = request.params;
    if (!mongoose.isValidObjectId(designId)) {
      response.status(400).json({ error: "Invalid design id." });
      return;
    }

    const name = normalizeDesignName(request.body?.name);
    const designData = request.body?.designData;

    if (!name) {
      response.status(400).json({ error: "Design name is required." });
      return;
    }

    if (!isValidDesignData(designData)) {
      response.status(400).json({ error: "Design data is invalid. Expected plot + layout structure." });
      return;
    }

    const updatedDesign = await Design.findOneAndUpdate(
      { _id: designId, userId: request.authUser._id },
      {
        $set: {
          name,
          designData,
        },
      },
      { new: true },
    ).lean();

    if (!updatedDesign) {
      response.status(404).json({ error: "Design not found." });
      return;
    }

    response.json({ design: sanitizeDesign(updatedDesign) });
  } catch (error) {
    response.status(500).json({ error: "Could not update design.", details: error.message });
  }
});

app.delete("/api/designs/:designId", requireAuth, async (request, response) => {
  try {
    const { designId } = request.params;
    if (!mongoose.isValidObjectId(designId)) {
      response.status(400).json({ error: "Invalid design id." });
      return;
    }

    const deletedDesign = await Design.findOneAndDelete({
      _id: designId,
      userId: request.authUser._id,
    }).lean();

    if (!deletedDesign) {
      response.status(404).json({ error: "Design not found." });
      return;
    }

    response.json({
      ok: true,
      id: designId,
    });
  } catch (error) {
    response.status(500).json({ error: "Could not delete design.", details: error.message });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/layout", (request, response) => {
  try {
    const engine = request.body?.engine ?? "v1";
    let payload;
    if (engine === "v3") payload = generateZoningLayout(request.body ?? {});
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

connectDatabase().finally(() => {
  app.listen(port, () => {
    console.log(`Floor plan backend listening on port ${port}`);
  });
});
