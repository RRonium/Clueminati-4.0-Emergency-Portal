const state = {
  team: null,
  difficulty: "easy",
  riddle: null,
  currentView: "game"
};

const entryScreen = document.querySelector("#entry-screen");
const gameView = document.querySelector("#game-view");
const leaderboardView = document.querySelector("#leaderboard-view");
const entryForm = document.querySelector("#entry-form");
const answerForm = document.querySelector("#answer-form");
const answerInput = document.querySelector("#answer-input");
const feedback = document.querySelector("#feedback");
const toast = document.querySelector("#toast");
const leaderboardBody = document.querySelector("#leaderboard-body");

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...options.headers }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The server could not complete that request.");
  return body;
}

function showToast(message, type = "") {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 3500);
}

function showView(viewName) {
  state.currentView = viewName;
  entryScreen.hidden = Boolean(state.team);
  gameView.hidden = viewName !== "game" || !state.team;
  leaderboardView.hidden = viewName !== "leaderboard";
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("is-active", link.dataset.view === viewName));
  if (viewName === "leaderboard") loadLeaderboard();
}

function updateTeamScore(team) {
  state.team = team;
  document.querySelector("#active-team-name").textContent = team.team_name;
  document.querySelector("#active-member-name").textContent = team.team_members_name;
  document.querySelector("#team-avatar").textContent = team.team_name.charAt(0).toUpperCase();
  document.querySelector("#current-round-score").textContent = team.current_round_score;
}

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
  feedback.hidden = false;
}

function setDifficulty(difficulty) {
  state.difficulty = difficulty;
  document.querySelectorAll(".difficulty-tab").forEach((tab) => {
    const active = tab.dataset.difficulty === difficulty;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

async function drawRiddle() {
  const drawButton = document.querySelector("#draw-button");
  drawButton.disabled = true;
  drawButton.classList.add("is-loading");
  feedback.hidden = true;
  try {
    const result = await request("/api/riddles/draw", { method: "POST", body: JSON.stringify({ difficulty: state.difficulty, teamId: state.team.sno }) });
    state.riddle = result.riddle;
    document.querySelector("#stage-label").textContent = `${state.difficulty} riddle`;
    document.querySelector("#stage-points").textContent = `Worth ${result.riddle.points} points`;
    document.querySelector("#question-number").textContent = String(result.riddle.id).padStart(2, "0");
    document.querySelector("#question-text").textContent = result.riddle.question;
    answerForm.hidden = false;
    answerInput.value = "";
    answerInput.focus();
  } catch (error) { showToast(error.message, "error"); }
  finally { drawButton.disabled = false; drawButton.classList.remove("is-loading"); }
}

async function submitAnswer(event) {
  event.preventDefault();
  if (!state.riddle || !state.team) return;
  const submitButton = answerForm.querySelector("button");
  submitButton.disabled = true;
  try {
    const result = await request("/api/answers", {
      method: "POST",
      body: JSON.stringify({ teamId: state.team.sno, riddleId: state.riddle.id, difficulty: state.difficulty, answer: answerInput.value })
    });
    if (result.correct) {
      updateTeamScore(result.team);
      setFeedback(`Correct. +${result.points} points added to the current round.`, "success");
      showToast("Nice work. The score is live.", "success");
      answerForm.hidden = true;
      state.riddle = null;
    } else {
      setFeedback(result.message, "wrong");
      answerInput.select();
    }
  } catch (error) { showToast(error.message, "error"); }
  finally { submitButton.disabled = false; }
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

async function loadLeaderboard() {
  try {
    const { teams } = await request("/api/leaderboard");
    leaderboardBody.replaceChildren();
    if (!teams.length) {
      const row = document.createElement("tr");
      const cell = createCell("No teams have entered yet.");
      cell.colSpan = 4;
      cell.className = "table-message";
      row.append(cell);
      leaderboardBody.append(row);
      return;
    }
    teams.forEach((team, index) => {
      const row = document.createElement("tr");
      row.append(createCell(index + 1, "rank-cell"), createCell(team.team_name, "team-cell"), createCell(team.team_members_name), createCell(team.current_round_score));
      leaderboardBody.append(row);
    });
  } catch (error) {
    const row = document.createElement("tr");
    const cell = createCell(error.message);
    cell.colSpan = 4;
    cell.className = "table-message error-text";
    row.append(cell);
    leaderboardBody.replaceChildren(row);
  }
}

async function runLeaderboardAction(action, message) {
  if (!window.confirm(message)) return;
  try {
    await request(`/api/leaderboard/${action}`, { method: "POST" });
    await loadLeaderboard();
    showToast(action === "truncate" ? "Leaderboard truncated." : "All scores reset to zero.", "success");
  } catch (error) { showToast(error.message, "error"); }
}

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = entryForm.querySelector("button");
  submitButton.disabled = true;
  const formData = new FormData(entryForm);
  try {
    const result = await request("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    updateTeamScore(result.team);
    document.querySelector("#connection-label").textContent = "Session live";
    showView("game");
    showToast(`Welcome, ${result.team.team_name}.`, "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { submitButton.disabled = false; }
});

document.querySelectorAll(".difficulty-tab").forEach((tab) => tab.addEventListener("click", () => setDifficulty(tab.dataset.difficulty)));
document.querySelector("#draw-button").addEventListener("click", drawRiddle);
answerForm.addEventListener("submit", submitAnswer);
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => showView(link.dataset.view)));
document.querySelector("#reset-button").addEventListener("click", () => runLeaderboardAction("reset", "Reset every team score to zero? Team rows will be kept."));
document.querySelector("#truncate-button").addEventListener("click", () => runLeaderboardAction("truncate", "Delete every leaderboard row? This cannot be undone."));
document.querySelector("#download-button").addEventListener("click", () => { window.location.href = "/api/leaderboard.csv"; });

showView("game");
