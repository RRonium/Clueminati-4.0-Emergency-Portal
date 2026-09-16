## How to Run

### 1. Clone and install

```bash
git clone <repository-url>
cd Clueminati4_0
npm install
npm start
```

Open `http://localhost:3000`.

### 2. Optional PostgreSQL

The app uses `data/teams.json` by default. To use PostgreSQL, copy `.env.example` to `.env`, set `DATABASE_URL`, and initialize the schema:

```bash
cp .env.example .env
psql "$DATABASE_URL" -f schema.sql
npm start
```

## Current Round Scoring

- Easy: 30 points
- Medium: 45 points
- Hard: 60 points

Correct answers append points to `current_round_score`. The leaderboard has no Round 1, Round 2, or Round 3 columns.

Its schema is:

```text
Sno. | Team Name | Team Members Name | Current Round Score
```

CSV export is available at `/api/leaderboard.csv`.

Reset JSON persistence with:

```bash
printf '[]\n' > data/teams.json
```

Reset PostgreSQL persistence with:

```bash
psql "$DATABASE_URL" -c "TRUNCATE TABLE team_scores RESTART IDENTITY;"
```

Lucky Draw does not repeat a question for the same team within a difficulty until every question in that difficulty has been visited. Draw history resets when the server restarts.