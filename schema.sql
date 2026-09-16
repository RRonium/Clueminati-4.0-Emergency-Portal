CREATE TABLE IF NOT EXISTS team_scores (
  sno SERIAL PRIMARY KEY,
  team_name VARCHAR NOT NULL,
  team_members_name TEXT NOT NULL,
  round_1_score INTEGER DEFAULT 0,
  round_2_score INTEGER DEFAULT 0,
  round_3_score INTEGER DEFAULT 0
);
