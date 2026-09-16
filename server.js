const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");


dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const riddles = JSON.parse(fs.readFileSync(path.join(__dirname, "riddles.json"), "utf8"));
const pointsByDifficulty = { easy: 30, medium: 45, hard: 60 };
const fallbackPath = path.join(__dirname, "data", "teams.json");
const drawHistory = new Map();
let usePostgres = Boolean(process.env.DATABASE_URL);
let pool;

app.use(cors());
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function ensureFallbackStore() {
  fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
  if (!fs.existsSync(fallbackPath)) fs.writeFileSync(fallbackPath, "[]\n");
}

function readFallbackTeams() {
  ensureFallbackStore();
  const teams = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
  let migrated = false;
  teams.forEach((team) => {
    if (team.current_round_score === undefined) {
      team.current_round_score = Number(team.round_1_score || 0) + Number(team.round_2_score || 0) + Number(team.round_3_score || 0);
      delete team.round_1_score;
      delete team.round_2_score;
      delete team.round_3_score;
      migrated = true;
    }
  });
  if (migrated) writeFallbackTeams(teams);
  return teams;
}

function writeFallbackTeams(teams) {
  ensureFallbackStore();
  fs.writeFileSync(fallbackPath, `${JSON.stringify(teams, null, 2)}\n`);
}

function normalizeAnswer(value) {
  return String(value || "").toLocaleLowerCase().replace(/\s+/g, "");
}

function publicRiddle(riddle, difficulty) {
  return {
    id: riddle.id,
    question: riddle.question,
    difficulty,
    points: pointsByDifficulty[difficulty]
  };
}

function validDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(riddles, value);
}

async function initializeDatabase() {
  if (!usePostgres) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_scores (
        sno SERIAL PRIMARY KEY,
        team_name VARCHAR NOT NULL,
        team_members_name TEXT NOT NULL,
        current_round_score INTEGER DEFAULT 0
      )
    `);
    await pool.query(`ALTER TABLE team_scores ADD COLUMN IF NOT EXISTS current_round_score INTEGER DEFAULT 0`);
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'team_scores' AND column_name = 'round_1_score') THEN
          EXECUTE 'UPDATE team_scores SET current_round_score = COALESCE(round_1_score, 0) + COALESCE(round_2_score, 0) + COALESCE(round_3_score, 0) WHERE current_round_score = 0';
        END IF;
      END $$
    `);
    await pool.query(`ALTER TABLE team_scores DROP COLUMN IF EXISTS round_1_score, DROP COLUMN IF EXISTS round_2_score, DROP COLUMN IF EXISTS round_3_score`);
    console.log("Persistence: PostgreSQL");
  } catch (error) {
    console.warn(`PostgreSQL unavailable, using JSON fallback: ${error.message}`);
    usePostgres = false;
    await pool.end().catch(() => {});
    pool = undefined;
  }
}

async function registerTeam(teamName, teamMembersName) {
  if (usePostgres) {
    const existing = await pool.query(
      `UPDATE team_scores SET team_members_name = $2 WHERE LOWER(team_name) = LOWER($1)
      RETURNING sno, team_name, team_members_name, current_round_score`,
      [teamName, teamMembersName]
    );
    if (existing.rows[0]) return existing.rows[0];
    const result = await pool.query(
      `INSERT INTO team_scores (team_name, team_members_name)
       VALUES ($1, $2)
      RETURNING sno, team_name, team_members_name, current_round_score`,
      [teamName, teamMembersName]
    );
    return result.rows[0];
  }

  const teams = readFallbackTeams();
  const existing = teams.find((team) => team.team_name.toLowerCase() === teamName.toLowerCase());
  if (existing) {
    existing.team_members_name = teamMembersName;
    writeFallbackTeams(teams);
    return existing;
  }
  const team = {
    sno: teams.length ? Math.max(...teams.map((item) => item.sno)) + 1 : 1,
    team_name: teamName,
    team_members_name: teamMembersName,
    current_round_score: 0
  };
  teams.push(team);
  writeFallbackTeams(teams);
  return team;
}

async function findTeam(teamId) {
  if (usePostgres) {
    const result = await pool.query("SELECT * FROM team_scores WHERE sno = $1", [teamId]);
    return result.rows[0];
  }
  return readFallbackTeams().find((team) => team.sno === Number(teamId));
}

async function getLeaderboard() {
  if (usePostgres) {
    const result = await pool.query(
      `SELECT sno, team_name, team_members_name, current_round_score
       FROM team_scores ORDER BY current_round_score DESC, sno ASC`
    );
    return result.rows;
  }
  return readFallbackTeams().sort((a, b) => {
    return b.current_round_score - a.current_round_score || a.sno - b.sno;
  });
}

async function addScore(teamId, points) {
  if (usePostgres) {
    const result = await pool.query(
      `UPDATE team_scores SET current_round_score = current_round_score + $1 WHERE sno = $2
       RETURNING sno, team_name, team_members_name, current_round_score`,
      [points, teamId]
    );
    return result.rows[0];
  }
  const teams = readFallbackTeams();
  const team = teams.find((item) => item.sno === Number(teamId));
  if (!team) return undefined;
  team.current_round_score = Number(team.current_round_score || 0) + points;
  writeFallbackTeams(teams);
  return team;
}

function toCsv(rows) {
  const header = ["Sno", "Team Name", "Team Members Name", "Current Round Score"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [header, ...rows.map((row) => [
    row.sno,
    row.team_name,
    row.team_members_name,
    row.current_round_score
  ])].map((line) => line.map(escape).join(",")).join("\n");
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, persistence: usePostgres ? "postgres" : "json" });
});

app.post("/api/register", async (req, res, next) => {
  try {
    const teamName = String(req.body.teamName || "").trim();
    const teamMembersName = String(req.body.teamMembersName || "").trim();
    if (!teamName || !teamMembersName) return res.status(400).json({ error: "Team name and one team member name are required." });
    if (teamName.length > 80 || teamMembersName.length > 120) return res.status(400).json({ error: "Team or member name is too long." });
    const team = await registerTeam(teamName, teamMembersName);
    res.status(201).json({ team });
  } catch (error) { next(error); }
});

app.get("/api/riddles", (req, res) => {
  const difficulty = String(req.query.difficulty || "easy").toLowerCase();
  if (!validDifficulty(difficulty)) return res.status(400).json({ error: "Difficulty must be easy, medium, or hard." });
  res.json({ difficulty, riddles: riddles[difficulty].map((riddle) => publicRiddle(riddle, difficulty)) });
});

app.post("/api/riddles/draw", async (req, res, next) => {
  try {
  const difficulty = String(req.body.difficulty || "").toLowerCase();
  const teamId = Number(req.body.teamId);
  if (!validDifficulty(difficulty)) return res.status(400).json({ error: "Choose a valid difficulty." });
  if (!Number.isInteger(teamId) || teamId < 1) return res.status(400).json({ error: "Register a team before drawing a riddle." });
  if (!await findTeam(teamId)) return res.status(404).json({ error: "Team session not found. Please register again." });
  const poolForTier = riddles[difficulty];
  const historyKey = `${teamId}:${difficulty}`;
  const visited = drawHistory.get(historyKey) || new Set();
  if (visited.size >= poolForTier.length) visited.clear();
  const available = poolForTier.filter((riddle) => !visited.has(riddle.question));
  const selected = available[Math.floor(Math.random() * available.length)];
  visited.add(selected.question);
  drawHistory.set(historyKey, visited);
  res.json({ riddle: publicRiddle(selected, difficulty) });
  } catch (error) { next(error); }
});

app.post("/api/answers", async (req, res, next) => {
  try {
    const { teamId, riddleId, answer } = req.body;
    const difficulty = String(req.body.difficulty || "").toLowerCase();
    if (!teamId || !validDifficulty(difficulty) || !riddles[difficulty].some((riddle) => riddle.id === Number(riddleId))) {
      return res.status(400).json({ error: "The answer submission is incomplete or invalid." });
    }
    const team = await findTeam(teamId);
    if (!team) return res.status(404).json({ error: "Team session not found. Please register again." });
    const riddle = riddles[difficulty].find((item) => item.id === Number(riddleId));
    const correct = normalizeAnswer(answer) === normalizeAnswer(riddle.answer);
    if (!correct) return res.json({ correct: false, message: "Not this time. Read the clue once more." });
    const updatedTeam = await addScore(teamId, pointsByDifficulty[difficulty]);
    res.json({ correct: true, points: pointsByDifficulty[difficulty], team: updatedTeam, message: "Correct. Points added to the current round." });
  } catch (error) { next(error); }
});

app.get("/api/leaderboard", async (req, res, next) => {
  try { res.json({ teams: await getLeaderboard(), persistence: usePostgres ? "postgres" : "json" }); }
  catch (error) { next(error); }
});

app.get("/api/leaderboard.csv", async (req, res, next) => {
  try {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="clueminati-team-scores.csv"');
    res.send(`\ufeff${toCsv(await getLeaderboard())}`);
  } catch (error) { next(error); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong on the server." });
});

initializeDatabase().then(() => {
  app.listen(port, () => console.log(`Clueminati listening at http://localhost:${port}`));
});
