CREATE TABLE IF NOT EXISTS team_scores (
  sno SERIAL PRIMARY KEY,
  team_name VARCHAR NOT NULL,
  team_members_name TEXT NOT NULL,
  current_round_score INTEGER DEFAULT 0
);
