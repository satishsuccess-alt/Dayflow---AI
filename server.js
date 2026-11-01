import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import session from "express-session";
import pg from "pg";
import argon2 from "argon2";
import connectPgSimple from "connect-pg-simple";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "3mb" }));
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

// PostgreSQL provides shared, persistent storage for accounts and sync snapshots.
// Without DATABASE_URL, the existing website and AI Coach still run in local-only mode.
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const PgStore = connectPgSimple(session);
const syncConfigured = Boolean(pool && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);

if (pool && !syncConfigured) {
  console.warn("Account sync is disabled: set SESSION_SECRET to a unique random string of at least 32 characters.");
}
if (syncConfigured) {
  app.use(session({
    name: "dayflow.sid",
    store: new PgStore({ pool, tableName: "dayflow_web_sessions", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 30 }
  }));
}


const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages in a short time. Please wait a minute and try again." }
});

const systemInstructions = `You are DayFlow AI, a friendly, practical daily-planning and habit-building coach.
Be encouraging, respectful, clear, and realistic. Ask a brief follow-up question when important information is missing. Help the user organize tasks, create routines, study, rest, and build sustainable habits. Prefer manageable steps and reasonable breaks; never shame the user for missed tasks. Do not claim you have edited the website or changed tasks: you can suggest changes, but the user must make them in the planner. Do not give medical diagnoses or extreme diet, exercise, sleep-deprivation, or weight-loss advice. For health-related concerns, keep guidance general and encourage speaking with a trusted adult or qualified professional. Be honest that you can only see the tasks included in the current request. Keep replies useful and moderately concise.`;

function cleanTaskContext(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, 30).map(task => ({
    name: typeof task?.name === "string" ? task.name.slice(0, 100) : "Untitled task",
    time: typeof task?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(task.time) ? task.time : "unknown",
    duration: Number.isFinite(Number(task?.duration)) ? Math.min(240, Math.max(1, Number(task.duration))) : 0,
    done: Boolean(task?.done)
  }));
}

function basicCoachReply(userText, tasks) {
  const text = userText.toLowerCase();
  const openTasks = tasks.filter(task => !task.done).sort((a, b) => a.time.localeCompare(b.time));
  const completed = tasks.filter(task => task.done).length;
  const taskSummary = tasks.length
    ? ` Your planner currently has ${openTasks.length} unfinished task(s) and ${completed} completed task(s).`
    : " You haven't added any tasks to your planner yet.";

  if (/overwhelm|too much|stress|stressed|can't focus|cannot focus/.test(text)) {
    return `Let's make this feel manageable. Pick just one small task you can start in the next 5 minutes, work on it for 10–15 minutes, then take a short break. You don't need to solve the whole day at once.${taskSummary}`;
  }
  if (/routine|schedule|plan my day|organize|organise/.test(text)) {
    const next = openTasks[0];
    return next
      ? `Let's build around your existing plan. Start with “${next.name}” at ${next.time}, then leave a little buffer before the next activity. Group similar tasks together and add short breaks. Mark tasks complete as you go.${taskSummary}`
      : `Try a simple routine: (1) choose your top 3 priorities, (2) schedule the most important one first, (3) add meals and breaks, and (4) leave a little flexible time. Add each activity to your planner so you can track progress.${taskSummary}`;
  }
  if (/habit|consisten|motivat|procrastinat/.test(text)) {
    return "Make the habit small enough to repeat: choose a clear cue, do a 2–5 minute starter version, and track whether you showed up rather than aiming for perfection. If you miss a day, simply restart at the next opportunity. What's one habit you'd like to make easier?";
  }
  if (/study|homework|exam|school|revision|revise/.test(text)) {
    return "Try one focused study block: choose one topic, put distractions away, and work for 20–25 minutes. Then take a 5-minute break and test yourself from memory. Repeat if you still have energy, and schedule a proper rest too.";
  }
  if (/workout|exercise|fitness|gym/.test(text)) {
    return "A sustainable plan starts with your current experience and available time. Choose a comfortable activity, warm up, use good technique, and include rest days. Stop if you feel pain or unwell. For a personal exercise plan, tell me your goal, experience level, and how much time you have.";
  }
  if (/diet|food|meal|weight|bulk|cut/.test(text)) {
    return "I can help with general meal-planning ideas, but I won't recommend extreme restriction or rapid body changes. Aim for regular balanced meals, enough water, and a variety of foods. For allergies or personal health needs, check with a trusted adult or qualified health professional.";
  }
  if (/progress|done|completed|points/.test(text)) {
    return `You're building progress one step at a time. You have completed ${completed} task(s) so far, and ${openTasks.length} task(s) remain.${openTasks.length ? ` A useful next step is “${openTasks[0].name}”.` : " If you have more to do, add your next small task; if not, take time to rest."}`;
  }
  return `I'm in basic backup mode right now, so I can offer simple planning guidance but not full AI-generated answers. Try telling me whether you want help with your routine, habits, studying, or motivation, and we'll break it into manageable steps.${taskSummary}`;
}

function validateMessages(incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0 || incoming.length > 12) return null;
  const messages = [];
  for (const item of incoming) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;
    const content = item.content.trim();
    if (!content || content.length > 2000) return null;
    messages.push({ role: item.role, content });
  }
  return messages[messages.length - 1]?.role === "user" ? messages : null;
}

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (_req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/script.js", (_req, res) => res.sendFile(path.join(__dirname, "script.js")));
app.get("/api/health", (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), syncConfigured }));

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account attempts. Please wait 15 minutes and try again." }
});

function requireSync(req, res, next) {
  if (!syncConfigured) return res.status(503).json({ error: "Account sync is not configured yet. Add DATABASE_URL and a SESSION_SECRET (at least 32 characters) to your private .env file, then restart the server." });
  next();
}
function validUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,24}$/.test(value);
}
async function requireLogin(req, res, next) {
  try {
    if (!syncConfigured || !req.session?.userId) return res.status(401).json({ error: "Sign in required." });
    const result = await pool.query("SELECT id, username FROM dayflow_users WHERE id = $1", [req.session.userId]);
    if (!result.rowCount) return res.status(401).json({ error: "Sign in required." });
    req.dayflowUser = result.rows[0];
    next();
  } catch (error) { next(error); }
}
function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

app.post("/api/register", accountLimiter, requireSync, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!validUsername(username) || typeof password !== "string" || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: "Use a 3–24 character username (letters, numbers, underscores) and a 12–128 character password." });
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    let created;
    try {
      const result = await pool.query("INSERT INTO dayflow_users (username, username_normalized, password_hash) VALUES ($1, $2, $3) RETURNING id, username", [username, username.toLowerCase(), passwordHash]);
      created = result.rows[0];
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That username is already taken. Please choose another." });
      throw error;
    }
    await regenerateSession(req);
    req.session.userId = created.id;
    await saveSession(req);
    res.status(201).json({ user: { id: created.id, username: created.username } });
  } catch (error) { next(error); }
});

app.post("/api/login", accountLimiter, requireSync, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
    const result = await pool.query("SELECT id, username, password_hash FROM dayflow_users WHERE username_normalized = $1", [normalized]);
    if (!result.rowCount || typeof password !== "string" || !(await argon2.verify(result.rows[0].password_hash, password))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    await regenerateSession(req);
    req.session.userId = result.rows[0].id;
    await saveSession(req);
    res.json({ user: { id: result.rows[0].id, username: result.rows[0].username } });
  } catch (error) { next(error); }
});

app.get("/api/me", requireSync, requireLogin, (req, res) => res.json({ user: req.dayflowUser }));

app.post("/api/logout", requireSync, requireLogin, (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: "Could not sign out. Please try again." });
    res.clearCookie("dayflow.sid", { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.get("/api/dayflow-data", requireSync, requireLogin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT data, updated_at FROM dayflow_user_data WHERE user_id = $1", [req.dayflowUser.id]);
    if (!result.rowCount) return res.json({ hasData: false, data: {}, updatedAt: null });
    res.json({ hasData: true, data: result.rows[0].data || {}, updatedAt: result.rows[0].updated_at });
  } catch (error) { next(error); }
});

app.put("/api/dayflow-data", requireSync, requireLogin, async (req, res, next) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Invalid DayFlow data." });
    const keys = Object.keys(data);
    if (keys.length > 250 || keys.some(key => !key.startsWith("dayflow."))) return res.status(400).json({ error: "Only DayFlow app data can be synced." });
    for (const value of Object.values(data)) if (typeof value !== "string") return res.status(400).json({ error: "Sync values must be saved as text." });
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized, "utf8") > 2_500_000) return res.status(413).json({ error: "Your saved data is too large to sync. Try using a smaller profile image." });
    const result = await pool.query("INSERT INTO dayflow_user_data (user_id, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW() RETURNING updated_at", [req.dayflowUser.id, serialized]);
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (error) { next(error); }
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const messages = validateMessages(req.body?.messages);
  if (!messages) return res.status(400).json({ error: "Please send a valid chat message (1–2,000 characters)." });

  const tasks = cleanTaskContext(req.body?.tasks);
  const latestUserMessage = messages[messages.length - 1].content;
  const routineSummary = tasks.length
    ? `\n\nCurrent planner tasks (24-hour local times):\n${tasks.map(task => `- ${task.time}, ${task.duration} min: ${task.name} [${task.done ? "completed" : "not completed"}]`).join("\n")}`
    : "\n\nThe user has no tasks in the planner yet.";

  // Keep the chat usable if no API key/credits are configured. This is explicitly marked as basic mode.
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ reply: basicCoachReply(latestUserMessage, tasks), mode: "basic" });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: systemInstructions + routineSummary,
      input: messages,
      max_output_tokens: 700,
      store: false
    });
    const reply = response.output_text?.trim();
    if (!reply) return res.status(502).json({ error: "The AI Coach didn't return a message. Please try again." });
    return res.json({ reply, mode: "ai" });
  } catch (error) {
    // Do not log API keys, private prompts, or provider response bodies.
    console.error("AI Coach request failed:", error?.status || error?.name || "Unknown error");
    if (error?.status === 401) {
      return res.status(502).json({ error: "The API key was rejected. Check the key in your private .env file." });
    }
    if (error?.status === 429) {
      return res.json({
        reply: `${basicCoachReply(latestUserMessage, tasks)}\n\nNote: The AI API quota is currently unavailable, so this is a basic backup response. Check your API usage and billing to restore full AI replies.`,
        mode: "basic"
      });
    }
    return res.status(502).json({ error: "The AI Coach couldn't connect to the AI service. Check your internet connection and server setup, then try again." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "The request was not valid JSON." });
  console.error("Server error:", error?.name || "Unknown error");
  return res.status(500).json({ error: "Something went wrong on the server." });
});

async function startServer() {
  if (syncConfigured) {
    await pool.query("CREATE TABLE IF NOT EXISTS dayflow_users (id BIGSERIAL PRIMARY KEY, username VARCHAR(24) NOT NULL, username_normalized VARCHAR(24) NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await pool.query("CREATE TABLE IF NOT EXISTS dayflow_user_data (user_id BIGINT PRIMARY KEY REFERENCES dayflow_users(id) ON DELETE CASCADE, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    console.log("DayFlow account sync is configured with PostgreSQL.");
  } else {
    console.log("Account sync is currently disabled. Configure DATABASE_URL and SESSION_SECRET to enable it.");
  }
 app.listen(port, "0.0.0.0", () => {
    console.log(`DayFlow AI is running at http://localhost:${port}`);
    console.log(process.env.OPENAI_API_KEY
      ? `AI Coach API configured (model: ${process.env.OPENAI_MODEL || "gpt-4.1-mini"}).`
      : "AI Coach is in basic backup mode. Add an API key and available API credits for full AI replies.");
  });
}

startServer().catch(error => {
  console.error("DayFlow AI startup failed:", error?.message || "Unknown error");
  process.exit(1);
});
