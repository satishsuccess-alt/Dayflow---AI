
 // DayFlow AI — task planner + AI Coach chat
// Demo mode works without a paid API key.

const taskForm = document.querySelector("#task-form");
const taskName = document.querySelector("#task-name");
const taskTime = document.querySelector("#task-time");
const taskDuration = document.querySelector("#task-duration");
const taskList = document.querySelector("#task-list");

const completedCount = document.querySelector("#completed-count");
const pointsCount = document.querySelector("#points-count");
const progressCount = document.querySelector("#progress-count");
const progressBar = document.querySelector("#progress-bar");
const taskTotal = document.querySelector("#task-total");

const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
const chatMessages = document.querySelector("#chat-messages");

const suggestionButtons = document.querySelectorAll(
  ".suggestion-button[data-prompt]"
);

const TASK_STORAGE_KEY = "dayflow.tasks.v1";
const TASK_DAY_KEY = "dayflow.tasks.last-active-day.v1";
const SMART_SCROLL_KEY = "dayflow.social.smart-scroll-enabled.v1";
let tasks = [];
let insertBeforeTaskId = null;

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function isSmartScrollActive() {
  try { return JSON.parse(localStorage.getItem(SMART_SCROLL_KEY) || "false") === true; }
  catch { return false; }
}

try {
  const saved = JSON.parse(localStorage.getItem(TASK_STORAGE_KEY) || "[]");
  const todayKey = localDayKey();
  const previousDay = localStorage.getItem(TASK_DAY_KEY);
  if (Array.isArray(saved)) {
    tasks = saved
      .filter(t => t && typeof t.name === "string" && typeof t.time === "string")
      .map((t, i) => ({
        id: Number.isInteger(t.id) ? t.id : i + 1,
        name: t.name.slice(0, 100),
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : "09:00",
        duration: [10, 20, 30, 45, 60, 90, 120].includes(Number(t.duration)) ? Number(t.duration) : 10,
        done: previousDay === todayKey ? Boolean(t.done) : false,
        pointsEligible: previousDay === todayKey && Boolean(t.pointsEligible)
      }));
  }
  localStorage.setItem(TASK_DAY_KEY, todayKey);
  if (previousDay !== todayKey && Array.isArray(saved)) localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
} catch {
  tasks = [];
}
let nextId = tasks.reduce(
  (max, task) => Math.max(max, task.id), 0
) + 1;

const chatHistory = [];
const MAX_CHAT_MESSAGES = 12;
// Holds a specific body-part workout request while the coach asks for fitness level.
let pendingSpecificWorkout = null;

function pointsForDuration(minutes) {
  if (minutes <= 15) return 10;
  if (minutes <= 30) return 15;
  if (minutes <= 60) return 20;
  return 25;
}

function formatTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

const DAILY_PROGRESS_KEY = "dayflow.progress.daily.v1";
const WEEKLY_CELEBRATION_KEY = "dayflow.progress.celebrated-week.v1";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function mondayFor(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
}
function shiftDate(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}
function readDailyProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(DAILY_PROGRESS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function saveTodayProgress(progress, completed, total) {
  try {
    const history = readDailyProgress();
    const key = localDayKey();
    // Only replace today's snapshot when a routine exists; an empty new day shouldn't erase it.
    if (total > 0) history[key] = { progress, completed, total, savedAt: Date.now() };
    localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify(history));
  } catch { /* The dashboard still works for this session if storage is unavailable. */ }
}
function weeklyValues(weekStart, history) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(weekStart, index);
    const key = dateKey(date);
    const isFuture = date > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const saved = history[key];
    return { date, key, label: date.toLocaleDateString(undefined, { weekday: "short" }), progress: saved && Number.isFinite(saved.progress) ? Math.max(0, Math.min(100, saved.progress)) : 0, tracked: Boolean(saved), future: isFuture };
  });
}
function averageFor(values) {
  return Math.round(values.reduce((sum, day) => sum + day.progress, 0) / Math.max(1, values.length));
}
function launchWeeklyCelebration(average, weekKey) {
  try {
    if (localStorage.getItem(WEEKLY_CELEBRATION_KEY) === weekKey) return;
    localStorage.setItem(WEEKLY_CELEBRATION_KEY, weekKey);
  } catch { /* Continue with the celebration for this page view. */ }
  const message = document.querySelector("#weekly-celebration-message");
  if (message) {
    message.hidden = false;
    message.textContent = `🎉 Amazing work! Your weekly average was ${average}%. Celebrate your consistency and keep it going!`;
  }
  const layer = document.createElement("div");
  layer.className = "weekly-confetti-layer";
  layer.setAttribute("aria-hidden", "true");
  const colors = ["#a397ff", "#6fdbd5", "#ffd166", "#ff7aa2", "#ffffff"];
  for (let i = 0; i < 72; i++) {
    const piece = document.createElement("span");
    piece.className = "weekly-confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.animationDuration = `${2.1 + Math.random() * 1.4}s`;
    piece.style.setProperty("--confetti-rotate", `${Math.random() * 720 - 360}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), 4200);
}
function renderWeeklyProgress() {
  const chart = document.querySelector("#weekly-chart");
  const averageNode = document.querySelector("#weekly-average");
  const labelNode = document.querySelector("#weekly-average-label");
  const noteNode = document.querySelector("#weekly-average-note");
  const daysNode = document.querySelector("#weekly-days-tracked");
  const lastAverageNode = document.querySelector("#weekly-last-average");
  const lastAverageNote = document.querySelector("#weekly-last-average-note");
  const rangeNode = document.querySelector("#weekly-date-range");
  const celebration = document.querySelector("#weekly-celebration-message");
  if (!chart || !averageNode) return;

  const today = new Date();
  const weekStart = mondayFor(today);
  const weekEnd = shiftDate(weekStart, 6);
  const weekKey = dateKey(weekStart);
  const history = readDailyProgress();
  const values = weeklyValues(weekStart, history);
  const todayIndex = (today.getDay() + 6) % 7;
  const currentValues = values.slice(0, todayIndex + 1);
  const currentAverage = averageFor(currentValues);
  const weekComplete = todayIndex === 6;
  const weekAverage = weekComplete ? averageFor(values) : currentAverage;
  const trackedCount = values.filter((day, index) => !day.future && day.tracked).length;
  const formatShort = date => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  rangeNode.textContent = `${formatShort(weekStart)} – ${formatShort(weekEnd)}`;
  averageNode.textContent = `${weekAverage}%`;
  labelNode.textContent = weekComplete ? "Weekly average" : "Week-to-date average";
  noteNode.textContent = weekComplete ? (weekAverage >= 80 ? "A strong week of consistency!" : "Every week is a chance to grow.") : "Average of days elapsed this week";
  daysNode.textContent = `${trackedCount}/7`;
  chart.replaceChildren();
  values.forEach((day, index) => {
    const item = document.createElement("div");
    item.className = `weekly-chart-day${day.future ? " is-future" : ""}${index === todayIndex ? " is-today" : ""}`;
    const value = document.createElement("span");
    value.className = "weekly-chart-value";
    value.textContent = day.future ? "—" : `${day.progress}%`;
    const track = document.createElement("div");
    track.className = "weekly-chart-track";
    const bar = document.createElement("div");
    bar.className = "weekly-chart-bar";
    bar.style.height = `${day.future ? 0 : Math.max(day.progress > 0 ? 4 : 0, day.progress)}%`;
    track.append(bar);
    const label = document.createElement("span");
    label.className = "weekly-chart-label";
    label.textContent = day.label;
    item.title = day.future ? `${day.label}: not yet` : `${day.label}: ${day.progress}% progress${day.tracked ? "" : " (no routine saved)"}`;
    item.append(value, track, label);
    chart.append(item);
  });
  if (celebration) celebration.hidden = true;

  // If the user opens the app after Sunday, still show the previous completed week once.
  const previousWeekStart = shiftDate(weekStart, -7);
  const previousWeekKey = dateKey(previousWeekStart);
  const previousValues = weeklyValues(previousWeekStart, history);
  const previousAverage = averageFor(previousValues);
  const previousWeekHasData = previousValues.some(day => day.tracked);
  if (lastAverageNode) lastAverageNode.textContent = previousWeekHasData ? `${previousAverage}%` : "—";
  if (lastAverageNote) lastAverageNote.textContent = previousWeekHasData ? `${formatShort(previousWeekStart)} – ${formatShort(shiftDate(previousWeekStart, 6))}` : "Available after your first week";
  let celebrationWeek = null;
  let celebrationAverage = 0;
  if (weekComplete && weekAverage >= 80) {
    celebrationWeek = weekKey;
    celebrationAverage = weekAverage;
  } else if (todayIndex === 0 && previousWeekHasData && previousAverage >= 80) {
    celebrationWeek = previousWeekKey;
    celebrationAverage = previousAverage;
    if (noteNode) noteNode.textContent = `Last week's average was ${previousAverage}%. This week is a fresh start!`;
  }
  if (celebrationWeek) {
    const alreadyCelebrated = (() => { try { return localStorage.getItem(WEEKLY_CELEBRATION_KEY) === celebrationWeek; } catch { return false; } })();
    if (!alreadyCelebrated) launchWeeklyCelebration(celebrationAverage, celebrationWeek);
  }
}

function renderTasks() {
  const todayKey = localDayKey();
  try {
    if (localStorage.getItem(TASK_DAY_KEY) !== todayKey) {
      tasks.forEach(task => { task.done = false; });
      localStorage.setItem(TASK_DAY_KEY, todayKey);
      localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
    }
  } catch { /* Continue with in-memory routine if storage is unavailable. */ }
  const completed = tasks.filter(t => t.done).length;

  const points = isSmartScrollActive() ? tasks
    .filter(t => t.done && t.pointsEligible)
    .reduce((sum, t) => sum + pointsForDuration(t.duration), 0) : 0;

  const progress = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;

  completedCount.textContent = completed;
  pointsCount.innerHTML = `${points} <small>pts</small>`;
  progressCount.textContent = `${progress}%`;
  progressBar.style.width = `${progress}%`;
  saveTodayProgress(progress, completed, tasks.length);
  renderWeeklyProgress();
  taskTotal.textContent =
    `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  try {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Browser storage might be unavailable.
  }

  taskList.replaceChildren();

  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const icon = document.createElement("span");
    icon.className = "empty-icon";
    icon.textContent = "✦";

    const heading = document.createElement("h3");
    heading.textContent = "Your day starts here";

    const message = document.createElement("p");
    message.textContent =
      "Add your first task to begin building your routine.";

    empty.append(icon, heading, message);
    taskList.append(empty);
    return;
  }

  const sortedTasks = [...tasks].sort(
    (a, b) => a.time.localeCompare(b.time)
  );

  for (const task of sortedTasks) {
    const item = document.createElement("article");
    item.className = `task-item${task.done ? " completed" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Complete ${task.name}`);

    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      task.pointsEligible = checkbox.checked && isSmartScrollActive();
      renderTasks();
    });

    const info = document.createElement("div");
    info.className = "task-info";

    const name = document.createElement("div");
    name.className = "task-name";
    name.textContent = task.name;

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent =
      `${formatTime(task.time)} · ${task.duration} minutes`;

    info.append(name, meta);

    const reward = document.createElement("span");
    reward.className = "task-reward";
    reward.textContent = !isSmartScrollActive()
      ? "Activate Smart Scroll to earn points"
      : (task.done
        ? (task.pointsEligible ? `+${pointsForDuration(task.duration)} pts` : "No points earned")
        : `${pointsForDuration(task.duration)} pts`);

    const changeButton = document.createElement("button");
    changeButton.className = "secondary-button task-action-button";
    changeButton.type = "button";
    changeButton.textContent = "Change Task";
    changeButton.addEventListener("click", () => {
      const updatedName = prompt("Task name:", task.name);
      if (updatedName === null) return;
      const cleanName = updatedName.trim();
      if (!cleanName) { alert("Please enter a task name."); return; }
      const updatedTime = prompt("Start time (24-hour format, e.g. 09:00 or 14:30):", task.time);
      if (updatedTime === null) return;
      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(updatedTime)) { alert("Enter a valid time like 09:00 or 14:30."); return; }
      const updatedDuration = prompt("Duration in minutes (10, 20, 30, 45, 60, 90, or 120):", String(task.duration));
      if (updatedDuration === null) return;
      const duration = Number(updatedDuration);
      if (![10, 20, 30, 45, 60, 90, 120].includes(duration)) { alert("Choose 10, 20, 30, 45, 60, 90, or 120 minutes."); return; }
      task.name = cleanName.slice(0, 100);
      task.time = updatedTime;
      task.duration = duration;
      renderTasks();
    });

    const insertButton = document.createElement("button");
    insertButton.className = "secondary-button task-action-button";
    insertButton.type = "button";
    insertButton.textContent = "Insert before";
    insertButton.addEventListener("click", () => {
      insertBeforeTaskId = task.id;
      const earlierTasks = tasks.filter(t => t.id !== task.id && t.time < task.time).sort((a, b) => b.time.localeCompare(a.time));
      if (earlierTasks.length) {
        const previous = earlierTasks[0];
        const [h, m] = previous.time.split(":").map(Number);
        const end = h * 60 + m + previous.duration;
        const target = Math.min(end, task.time.split(":").map(Number).reduce((hh, mm) => hh * 60 + mm, 0));
        taskTime.value = `${String(Math.floor(target / 60)).padStart(2, "0")}:${String(target % 60).padStart(2, "0")}`;
      } else {
        const target = task.time.split(":").map(Number).reduce((hh, mm) => hh * 60 + mm, 0) - Number(taskDuration.value || 10);
        const safeTarget = Math.max(0, target);
        taskTime.value = `${String(Math.floor(safeTarget / 60)).padStart(2, "0")}:${String(safeTarget % 60).padStart(2, "0")}`;
      }
      taskName.focus();
      taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
      const submitButton = taskForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = "＋ Insert task";
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${task.name}`);

    deleteButton.addEventListener("click", () => {
      tasks = tasks.filter(t => t.id !== task.id);
      renderTasks();
    });

    const taskActions = document.createElement("div");
    taskActions.className = "task-actions";
    taskActions.append(changeButton, insertButton, deleteButton);
    item.append(checkbox, info, reward, taskActions);
    taskList.append(item);
  }
}

taskForm.addEventListener("submit", event => {
  event.preventDefault();

  const name = taskName.value.trim();
  if (!name || !taskTime.value) return;

  const newTime = taskTime.value;
  const newDuration = Number(taskDuration.value);
  const newStart = newTime.split(":").map(Number).reduce((h, m) => h * 60 + m, 0);
  const newEnd = newStart + newDuration;
  const targetTask = insertBeforeTaskId ? tasks.find(t => t.id === insertBeforeTaskId) : null;
  const affectedTasks = targetTask
    ? tasks.filter(t => t.id === targetTask.id || t.time >= targetTask.time)
    : tasks.filter(t => t.time >= newTime);
  affectedTasks.forEach(t => {
    const start = t.time.split(":").map(Number).reduce((h, m) => h * 60 + m, 0);
    if (start < newEnd) {
      const shifted = start + newDuration;
      if (shifted < 24 * 60) t.time = `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
    }
  });
  tasks.push({ id: nextId++, name, time: newTime, duration: newDuration, done: false, pointsEligible: false });
  insertBeforeTaskId = null;

  taskForm.reset();
  taskTime.value = "";
  taskDuration.value = "10";
  const submitButton = taskForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = "+ Add task";
  renderTasks();
});

function addChatMessage(role, message, options = {}) {
  const row = document.createElement("div");
  row.className =
    `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;

  if (options.typing) row.classList.add("typing-message");

  if (role !== "user") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "✦";
    row.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";

  const sender = document.createElement("span");
  sender.className = "message-sender";
  sender.textContent = role === "user"
    ? "You"
    : options.mode === "basic"
      ? "DayFlow AI · Demo mode"
      : "DayFlow AI";

  content.append(sender);

  const paragraph = document.createElement("p");

  if (options.typing) {
    paragraph.className = "typing-dots";

    for (let i = 0; i < 3; i++) {
      paragraph.append(document.createElement("span"));
    }

    paragraph.setAttribute("aria-label", "AI Coach is thinking");
  } else {
    paragraph.textContent = message;
  }

  content.append(paragraph);
  row.append(content);
  chatMessages.append(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return row;
}

function getDemoCoachReply(rawMessage) {
  const message = rawMessage.toLowerCase().trim();
  const simpleGesture = message.replace(/[.!?,;:]+/g, "").replace(/\s+/g, " ").trim();
  const total = tasks.length;
  const completed = tasks.filter(t => t.done).length;
  const remaining = total - completed;

  const nextTask = [...tasks]
    .filter(t => !t.done)
    .sort((a, b) => a.time.localeCompare(b.time))[0];

  // Short social messages get a brief, friendly response instead of a generic coaching explanation.
  if (/^(hi|hello|hey|hey there|hi there)$/.test(simpleGesture)) {
    return "Hey! 👋 Great to hear from you. What can I help you with today?";
  }
  if (/^(good morning|morning)$/.test(simpleGesture)) {
    return "Good morning! ☀️ Hope your day gets off to a great start. What would you like to focus on today?";
  }
  if (/^(good afternoon|afternoon)$/.test(simpleGesture)) {
    return "Good afternoon! 😊 How's your day going so far?";
  }
  if (/^(good evening|evening)$/.test(simpleGesture)) {
    return "Good evening! 🌆 How has your day been?";
  }
  if (/^(good night|night)$/.test(simpleGesture)) {
    return "Good night! 🌙 Rest well and give yourself a fresh start tomorrow.";
  }
  if (/^(ok|okay|k|alright|all right|got it|sounds good)$/.test(simpleGesture)) {
    return "Alright! 👍 Let me know whenever you'd like help with something.";
  }
  if (/^(thanks|thank you|thx|thank u|thanks a lot)$/.test(simpleGesture)) {
    return "You're welcome! 😊 Happy to help.";
  }

  // If the coach has already asked for a level, answer with the requested workout.
  const levelMatch = message.match(/\b(beginner|intermediate|advanced)\b/);
  if (pendingSpecificWorkout && levelMatch) {
    const { bodyPart, noEquipment } = pendingSpecificWorkout;
    pendingSpecificWorkout = null;
    const level = levelMatch[1];
    const plans = {
      legs: {
        beginner: ["Chair squats — 2 sets of 8–10", "Glute bridges — 2 sets of 10", "Calf raises — 2 sets of 10", "Reverse step-backs while holding a sturdy chair — 2 sets of 6 per side"],
        intermediate: ["Bodyweight squats — 3 sets of 10–12", "Reverse lunges — 3 sets of 8 per side", "Glute bridges — 3 sets of 12", "Calf raises — 3 sets of 12–15"],
        advanced: ["Tempo squats (lower slowly) — 3 sets of 10–12", "Reverse lunges — 3 sets of 10 per side", "Single-leg glute bridges — 3 sets of 8 per side", "Calf raises — 3 sets of 15" ]
      },
      arms: {
        beginner: ["Wall push-ups — 2 sets of 8–10", "Arm circles — 2 rounds of 20 seconds each direction", "Wall plank hold — 2 holds of 15–20 seconds"],
        intermediate: ["Incline push-ups on a sturdy surface — 3 sets of 8–12", "Knee push-ups — 2 sets of 6–10", "Plank shoulder taps from knees — 2 sets of 8 per side"],
        advanced: ["Push-ups — 3 sets of 8–12", "Close-grip knee or standard push-ups — 3 sets of 6–10", "Plank shoulder taps — 3 sets of 10 per side"]
      },
      chest: {
        beginner: ["Wall push-ups — 2 sets of 8–10", "Incline push-ups against a sturdy counter — 2 sets of 6–8", "Standing chest squeezes — 2 sets of 10"],
        intermediate: ["Incline push-ups — 3 sets of 8–12", "Knee push-ups — 3 sets of 6–10", "Slow wall push-ups — 2 sets of 10"],
        advanced: ["Push-ups — 3 sets of 8–12", "Slow-tempo push-ups — 2 sets of 6–10", "Wide-hand push-ups — 2 sets of 6–10"]
      },
      back: {
        beginner: ["Bird-dogs — 2 sets of 6 per side", "Prone W raises — 2 sets of 8", "Cat-cow mobility — 2 sets of 6 slow reps"],
        intermediate: ["Bird-dogs with a 2-second pause — 3 sets of 8 per side", "Prone Y-T raises — 2 sets of 6 each shape", "Reverse snow angels — 3 sets of 8"],
        advanced: ["Bird-dogs with controlled pauses — 3 sets of 10 per side", "Prone Y-T-W raises — 3 rounds of 6 each", "Reverse snow angels — 3 sets of 10"]
      },
      shoulders: {
        beginner: ["Arm circles — 2 rounds of 20 seconds each direction", "Wall slides — 2 sets of 8", "Incline shoulder taps — 2 sets of 6 per side"],
        intermediate: ["Wall slides — 3 sets of 10", "Pike hold with hands on a sturdy raised surface — 3 holds of 15 seconds", "Plank shoulder taps from knees — 3 sets of 8 per side"],
        advanced: ["Pike push-ups only if comfortable — 3 sets of 5–8", "Plank shoulder taps — 3 sets of 10 per side", "Wall slides — 3 sets of 12"]
      },
      core: {
        beginner: ["Dead bugs — 2 sets of 6 per side", "Bird-dogs — 2 sets of 6 per side", "Knee plank — 2 holds of 15–20 seconds"],
        intermediate: ["Dead bugs — 3 sets of 8 per side", "Forearm plank — 3 holds of 20–30 seconds", "Side plank from knees — 2 holds of 15–20 seconds per side"],
        advanced: ["Dead bugs with slow control — 3 sets of 10 per side", "Forearm plank — 3 holds of 30–40 seconds", "Side plank — 3 holds of 20–30 seconds per side"]
      }
    };
    const exerciseList = plans[bodyPart]?.[level] || plans.legs[level];
    return `Here is your ${level}-level ${bodyPart} workout${noEquipment ? ' with no equipment' : ''} (about 12–20 minutes):\n\nWARM-UP — 3 minutes\nMarch in place and move gently through a comfortable range.\n\nMAIN WORKOUT\n${exerciseList.map((exercise, i) => `${i + 1}. ${exercise}`).join('\n')}\n\nRest 45–90 seconds between sets, or longer when needed. Start with fewer reps if needed; keep movements controlled and stop if you feel pain, dizziness, or unwell.\n\nCOOL-DOWN — 2–3 minutes\nWalk slowly and stretch gently if comfortable. You can ask me to make it shorter or easier.`;
  }

  const bodyPartPatterns = [
    { part: "legs", pattern: /\b(legs?|thighs?|quads?|hamstrings?|calves?)\b/ },
    { part: "arms", pattern: /\b(arms?|biceps?|triceps?)\b/ },
    { part: "chest", pattern: /\b(chest|pecs?)\b/ },
    { part: "back", pattern: /\b(back|lats?)\b/ },
    { part: "shoulders", pattern: /\b(shoulders?)\b/ },
    { part: "core", pattern: /\b(core|abs?|abdominals?)\b/ }
  ];
  const isWorkoutRequest = /\b(workout|exercise|train|training|strength|build|work on|focus on|target|routine)\b/.test(message);
  const matchedPart = bodyPartPatterns.find(item => item.pattern.test(message));
  if (matchedPart && isWorkoutRequest) {
    pendingSpecificWorkout = {
      bodyPart: matchedPart.part,
      noEquipment: /\b(no equipment|without equipment|bodyweight|at home|home workout)\b/.test(message)
    };
    return `Sure! I can make a ${matchedPart.part} workout${pendingSpecificWorkout.noEquipment ? ' without equipment' : ''}. What is your fitness level?\n\n1. Beginner\n2. Intermediate\n3. Advanced\n\nReply with one level and I’ll tailor the exercises to it.`;
  }

  if (/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(message)) {
    return "Hey! 👋 I'm here to help you plan your day, build habits, stay organized, or work on your goals. What would you like to focus on?";
  }

  if (/\b(my tasks|my routine|today|progress|how am i doing|status)\b/.test(message)) {
    if (!total) {
      return "Your planner is ready, but you haven't added any tasks yet. Add a small task with a time and duration, then check it off when you're done. Build your routine one step at a time.";
    }

    const nextText = nextTask
      ? ` Your next unfinished task is "${nextTask.name}" at ${formatTime(nextTask.time)}.`
      : " You've completed every task currently in your planner—great job!";

    return `Your planner has ${total} task${total === 1 ? "" : "s"}: ${completed} completed and ${remaining} remaining. Your progress is ${Math.round((completed / total) * 100)}%.${nextText}`;
  }

  
  if (/\b(workout|exercise|fitness|training|gym|bulking|cutting|muscle|strength|cardio|beginner workout|weekly workout)\b/.test(message)) {
    if (/\b(week|weekly|schedule|7.day|seven.day)\b/.test(message)) {
      return `Here is a balanced example of a beginner-friendly weekly activity plan:

MONDAY — Full-body strength (20–25 minutes)
• Warm up: march in place for 3 minutes.
• Chair squats: 2 sets of 8–10 repetitions.
• Wall push-ups: 2 sets of 8–10 repetitions.
• Glute bridges: 2 sets of 10 repetitions.
• Bird-dogs: 2 sets of 6 per side.
• Cool down gently for 3 minutes.

TUESDAY — Cardio (20 minutes)
• Brisk walking, cycling, dancing, or another activity you enjoy.
• Keep a comfortable pace and take breaks when needed.

WEDNESDAY — Recovery
• Gentle stretching or an easy walk.

THURSDAY — Full-body strength
• Repeat Monday's routine if you feel recovered.
• Focus on smooth, controlled movements rather than speed.

FRIDAY — Fun cardio (20–30 minutes)
• Choose a sport, dancing, cycling, swimming, or walking.

SATURDAY — Enjoyable movement
• Try an outdoor activity, a game, or a relaxed walk.

SUNDAY — Rest or gentle movement
• Take a break if you need one.

Begin at a comfortable level and adjust the plan to your age, experience, and energy. Stop if you feel pain, dizziness, or unwell. This is a general example, not a personalised medical plan.`;
    }

    if (/\b(no equipment|without equipment|at home|home workout|bodyweight)\b/.test(message)) {
      return `Here is a no-equipment workout you can try at home (about 15–20 minutes):

1. Warm-up — 3 minutes
   March in place, move your arms gently, and do easy step-touches.

2. Chair squats — 2 sets of 8–10
   Sit back towards a sturdy chair, then stand up smoothly.

3. Wall push-ups — 2 sets of 8–10
   Place your hands on a wall, bend your elbows, and push back gently.

4. Glute bridges — 2 sets of 10
   Lie on your back with knees bent, lift your hips comfortably, then lower.

5. Bird-dogs — 2 sets of 6 per side
   On hands and knees, extend the opposite arm and leg while staying balanced.

6. Cool-down — 3 minutes
   Walk slowly and stretch gently if comfortable.

Rest for 45–90 seconds between sets, or longer if needed. Use an easier variation when necessary. Good technique and comfort matter more than doing lots of repetitions.`;
    }

    if (/\b(cardio|stamina|endurance|running|cycling)\b/.test(message)) {
      return `Here is a simple cardio session (about 20 minutes):

• 3 minutes: easy walking or marching to warm up.
• 10 minutes: alternate 1 minute at a comfortable brisk pace with 1 minute easy.
• 4 minutes: continue walking or another activity you enjoy.
• 3 minutes: slow down gradually to cool down.

You can use walking, cycling, swimming, dancing, or a sport instead. Start at a pace where you can still speak comfortably. You don't need to run fast or push to exhaustion.`;
    }

    if (/\b(strength|muscle|gym|weights|bulking|cutting)\b/.test(message)) {
      return `Here is a general beginner strength session:

• Warm-up: 5 minutes of easy movement.
• Squat to a chair: 2 sets of 8–10.
• Wall or incline push-ups: 2 sets of 8–10.
• Resistance-band row, if available: 2 sets of 8–12.
• Glute bridges: 2 sets of 10.
• Bird-dogs: 2 sets of 6 per side.
• Cool-down: 3–5 minutes of gentle movement.

Rest about 60–90 seconds between sets, or longer until comfortable. Learn the movements with good technique and ask a qualified coach to help with unfamiliar equipment. Increase difficulty gradually rather than rushing.

For bulking or cutting questions, I'll focus on healthy strength, energy, recovery, and consistent habits rather than rapid body changes or restrictive eating.`;
    }

    return `Absolutely! Here's an example of a beginner-friendly full-body workout (about 20 minutes):

WARM-UP — 3 minutes
• March in place.
• Do gentle arm circles.
• Step side to side.

MAIN WORKOUT
• Chair squats: 2 sets of 8–10 repetitions.
• Wall push-ups: 2 sets of 8–10 repetitions.
• Glute bridges: 2 sets of 10 repetitions.
• Bird-dogs: 2 sets of 6 repetitions per side.

Take 45–90 seconds of rest between sets, or longer if needed.

COOL-DOWN — 3 minutes
• Walk slowly.
• Stretch gently if comfortable.

You can do this at home without gym equipment. Start with the easier version of each movement, and stop if anything hurts or makes you feel unwell.

Want a more specific example? Ask me for a "weekly workout plan", "home workout without equipment", "cardio workout", or "beginner strength workout".`;
  }

  if (/\b(habit|habits|consistent|consistency|motivation|procrastinat|lazy|focus)\b/.test(message)) {
    return "Try making your habit small enough to start in five minutes. Attach it to something you already do, choose a clear time, and tick it off in your planner. If you miss a day, simply restart at the next opportunity.";
  }

  if (/\b(schedule|plan my day|routine|organize|organise|time management|busy)\b/.test(message)) {
    const suggestions = [
      "Pick your 1–3 most important tasks",
      "Give each task a realistic time and duration",
      "Leave a little buffer between activities",
      "Include breaks, meals, and enough sleep",
      "Review your checklist at the end of the day"
    ];

    return `Here's a simple way to plan your day:\n\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${remaining ? `You currently have ${remaining} unfinished task${remaining === 1 ? "" : "s"} in your planner.` : "Add your first task to turn this plan into a checklist."}`;
  }

  if (/\b(diet|food|meal|nutrition|eat|eating)\b/.test(message)) {
    return "For general wellbeing, aim for regular balanced meals, a variety of foods, and water throughout the day. Consider your preferences and allergies. I can help organize meal times or brainstorm simple meal ideas, but I can't assess your individual nutrition needs.";
  }

  if (/\b(sleep|tired|rest|break)\b/.test(message)) {
    return "Rest is part of a good routine. Try keeping a consistent bedtime, winding down without rushing, and leaving space between demanding tasks. If you're tired, consider a break and adjust your plan instead of pushing through everything.";
  }

  if (/\b(improve|better|start|help|advice|suggest)\b/.test(message)) {
    return `Let's make your routine manageable. Start with one priority, split it into a small next step, and schedule it at a realistic time. Track completion in your planner and review what worked. ${remaining ? `You have ${remaining} unfinished task${remaining === 1 ? "" : "s"} to focus on.` : "You can add a task whenever you're ready."}`;
  }

  return "I'm running in Demo Coach mode, so I use built-in coaching tips rather than a live AI model. I can help with routines, habits, focus, rest, general workouts, and organizing your day. Try asking: 'Help me plan my day' or 'How can I build better habits?'";
}

function getCoachProfileName() {
  try {
    const profile = JSON.parse(localStorage.getItem("dayflow.profile.v1") || "{}");
    return typeof profile.name === "string" ? profile.name.trim().slice(0, 50) : "";
  } catch {
    return "";
  }
}

function updateCoachWelcomeName() {
  const welcome = document.querySelector("#chat-messages .assistant-message .message-content p");
  if (!welcome) return;
  const name = getCoachProfileName();
  welcome.textContent = name
    ? `Hey ${name}! Welcome to your AI Coach. What would you like help with today? We can work on your routine, build better habits or plan your goals!`
    : "Hey! Welcome to your AI Coach. What would you like help with today? We can work on your routine, build better habits or plan your goals!";
}

async function sendCoachMessage(rawMessage) {
  const message = rawMessage.trim();

  if (!message || chatSend.disabled) return;

  addChatMessage("user", message);
  chatHistory.push({ role: "user", content: message });

  chatInput.value = "";
  chatSend.disabled = true;
  chatInput.disabled = true;
  chatSend.textContent = "...";

  const typingRow = addChatMessage("assistant", "", { typing: true });

  try {
    // Entirely local demo: no API request or billing required.
    await new Promise(resolve => setTimeout(resolve, 350));

    let reply = getDemoCoachReply(message);
    const profileName = getCoachProfileName();
    if (profileName) {
      reply = `${profileName}, ${reply.charAt(0).toLowerCase()}${reply.slice(1)}`;
    }

    typingRow.remove();
    addChatMessage("assistant", reply, { mode: "basic" });

    chatHistory.push({ role: "assistant", content: reply });

    while (chatHistory.length > MAX_CHAT_MESSAGES) {
      chatHistory.shift();
    }
  } catch {
    typingRow.remove();

    addChatMessage(
      "assistant",
      "I couldn't create a demo reply just now. Please try again.",
      { mode: "basic" }
    );
  } finally {
    chatSend.disabled = false;
    chatInput.disabled = false;
    chatSend.textContent = "Send ➤";
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", event => {
  event.preventDefault();
  sendCoachMessage(chatInput.value);
});

chatInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

suggestionButtons.forEach(button => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;

    if (!prompt || chatSend.disabled) return;

    chatInput.value = prompt;
    chatForm.requestSubmit();
  });
});

renderTasks();



/* Profile Maker + Diet Planner: local-first demo features */
(() => {
  "use strict";

  const PROFILE_KEY = "dayflow.profile.v1";
  const DIET_KEY = "dayflow.diet.preferences.v1";
  const SAVED_MEALS_KEY = "dayflow.diet.saved.v1";
  const COMPLETED_MEALS_KEY = "dayflow.diet.completed.v1";

  const safeRead = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const safeWrite = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  // Navigation swaps pages without reloading the existing planner.
  const navButtons = document.querySelectorAll(".nav-button[data-page]");
  const pageViews = document.querySelectorAll(".page-view");
  function showPage(pageId) {
    const target = pageId === "ai-coach" ? "home-page" : pageId;
    pageViews.forEach(page => {
      const isActive = page.id === target;
      page.hidden = !isActive;
      page.classList.toggle("active", isActive);
    });
    navButtons.forEach(button => {
      const active = button.dataset.page === pageId ||
        (pageId === "ai-coach" && button.dataset.page === "ai-coach");
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    if (pageId === "ai-coach") {
      document.querySelector("#ai-coach")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
  navButtons.forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));

  // Profile form and picture.
  const profileForm = document.querySelector("#profile-form");
  const profileAvatar = document.querySelector("#profile-avatar");
  const pictureInput = document.querySelector("#profile-picture");
  const removePictureButton = document.querySelector("#remove-picture");
  const profileName = document.querySelector("#profile-name");
  const profileBio = document.querySelector("#profile-bio");
  const profileGoal = document.querySelector("#profile-goal");
  const profileTheme = document.querySelector("#profile-theme");
  const profileDietStyle = document.querySelector("#profile-diet-style");
  const profileAllergies = document.querySelector("#profile-allergies");
  const profileExclusions = document.querySelector("#profile-exclusions");
  let profile = safeRead(PROFILE_KEY, {
    name: "", bio: "", goal: "Build consistent habits", theme: "violet", picture: "",
    dietStyle: "balanced", allergies: "", exclusions: ""
  });

  function applyTheme(theme) {
    document.body.classList.remove("theme-ocean", "theme-forest", "theme-sunset");
    if (["ocean", "forest", "sunset"].includes(theme)) {
      document.body.classList.add(`theme-${theme}`);
    }
  }
  function renderProfile() {
    profileName.value = profile.name || "";
    profileBio.value = profile.bio || "";
    profileGoal.value = profile.goal || "Build consistent habits";
    profileTheme.value = profile.theme || "violet";
    profileDietStyle.value = profile.dietStyle || "balanced";
    profileAllergies.value = profile.allergies || "";
    profileExclusions.value = profile.exclusions || "";
    applyTheme(profile.theme || "violet");
    profileAvatar.replaceChildren();
    if (profile.picture) {
      const image = document.createElement("img");
      image.src = profile.picture;
      image.alt = "Your profile picture";
      profileAvatar.append(image);
    } else {
      profileAvatar.textContent = (profile.name || "D").trim().charAt(0).toUpperCase() || "D";
    }
  }
  profileForm.addEventListener("submit", event => {
    event.preventDefault();
    profile = {
      ...profile,
      name: profileName.value.trim().slice(0, 50),
      bio: profileBio.value.trim().slice(0, 180),
      goal: profileGoal.value,
      theme: profileTheme.value,
      dietStyle: profileDietStyle.value,
      allergies: profileAllergies.value.trim().slice(0, 250),
      exclusions: profileExclusions.value.trim().slice(0, 250)
    };
    dietPrefs = {
      style: profile.dietStyle,
      goal: dietGoal ? dietGoal.value : (dietPrefs.goal || "balanced"),
      allergies: profile.allergies,
      exclusions: profile.exclusions,
      mealCount: dietMealCount.value,
      supplements: document.querySelector("#diet-supplements").value
    };
    if (safeWrite(PROFILE_KEY, profile) && safeWrite(DIET_KEY, dietPrefs)) {
      dietStyle.value = dietPrefs.style;
      dietAllergies.value = dietPrefs.allergies;
      dietExclusions.value = dietPrefs.exclusions;
      renderProfile();
      updateCoachWelcomeName();
      renderMealPlan();
      renderBadges();
      announce("#profile-page .section-heading", "Profile saved on this device.");
    } else {
      announce("#profile-page .section-heading", "Could not save. Browser storage may be full.");
    }
  });
  profileTheme.addEventListener("change", () => applyTheme(profileTheme.value));
  pictureInput.addEventListener("change", () => {
    const file = pictureInput.files && pictureInput.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      alert("Please choose a PNG, JPG, WEBP or GIF image.");
      pictureInput.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Please choose an image smaller than 5 MB.");
      pictureInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          alert("This browser could not process that picture. Try another image.");
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        profile.name = profileName.value.trim().slice(0, 50);
        profile.bio = profileBio.value.trim().slice(0, 180);
        profile.goal = profileGoal.value;
        profile.theme = profileTheme.value;
        profile.dietStyle = profileDietStyle.value;
        profile.allergies = profileAllergies.value.trim().slice(0, 250);
        profile.exclusions = profileExclusions.value.trim().slice(0, 250);
        profile.picture = canvas.toDataURL("image/jpeg", 0.82);
        if (!safeWrite(PROFILE_KEY, profile)) {
          profile.picture = "";
          alert("There isn't enough browser storage for that picture. Try a smaller image.");
          return;
        }
        renderProfile();
        pictureInput.value = "";
      };
      img.onerror = () => alert("That image could not be opened. Please try another.");
      img.src = String(reader.result);
    };
    reader.onerror = () => alert("The picture could not be read. Please try again.");
    reader.readAsDataURL(file);
  });
  removePictureButton.addEventListener("click", () => {
    profile.name = profileName.value.trim().slice(0, 50);
    profile.bio = profileBio.value.trim().slice(0, 180);
    profile.goal = profileGoal.value;
    profile.theme = profileTheme.value;
    profile.dietStyle = profileDietStyle.value;
    profile.allergies = profileAllergies.value.trim().slice(0, 250);
    profile.exclusions = profileExclusions.value.trim().slice(0, 250);
    profile.picture = "";
    safeWrite(PROFILE_KEY, profile);
    renderProfile();
    pictureInput.value = "";
  });

  // Reusable small status message, created as text to avoid interpreting user input as HTML.
  function announce(selector, message) {
    const target = document.querySelector(selector);
    if (!target) return;
    let note = target.parentElement.querySelector(".inline-status");
    if (!note) {
      note = document.createElement("p");
      note.className = "form-note inline-status";
      target.insertAdjacentElement("afterend", note);
    }
    note.textContent = message;
  }

  const dietForm = document.querySelector("#diet-preferences-form");
  const dietStyle = document.querySelector("#diet-style");
  const dietGoal = document.querySelector("#diet-goal");
  const dietAllergies = document.querySelector("#diet-allergies");
  const dietExclusions = document.querySelector("#diet-exclusions");
  const dietMealCount = document.querySelector("#diet-meal-count");
  const dietSupplements = document.querySelector("#diet-supplements");
  const supplementInfoNote = document.querySelector("#supplement-info-note");
  // Add an age field without requiring a separate HTML edit, so this update fits the current project files.
  const supplementAgeLabel = document.createElement("label");
  supplementAgeLabel.className = "supplement-age-field";
  supplementAgeLabel.textContent = "Your age (required for supplement information)";
  const supplementAgeInput = document.createElement("input");
  supplementAgeInput.id = "diet-supplement-age";
  supplementAgeInput.type = "number";
  supplementAgeInput.min = "1";
  supplementAgeInput.max = "120";
  supplementAgeInput.step = "1";
  supplementAgeInput.inputMode = "numeric";
  supplementAgeInput.placeholder = "Enter your age";
  supplementAgeInput.setAttribute("aria-describedby", "supplement-info-note");
  supplementAgeLabel.append(supplementAgeInput);
  if (dietSupplements?.parentElement) dietSupplements.parentElement.insertAdjacentElement("afterend", supplementAgeLabel);

  function updateSupplementNote() {
    if (!supplementInfoNote || !dietSupplements) return;
    const includeSupplements = dietSupplements.value === "yes";
    supplementAgeLabel.hidden = !includeSupplements;
    supplementAgeInput.required = includeSupplements;
    supplementInfoNote.classList.toggle("supplement-note-emphasis", includeSupplements);
    supplementInfoNote.replaceChildren();

    if (!includeSupplements) {
      supplementInfoNote.textContent = "Your plan will focus on food and meals, without supplement information.";
      if (supplementPlanPanel) supplementPlanPanel.hidden = true;
      return;
    }

    const ageValue = supplementAgeInput.value.trim();
    const age = Number(ageValue);
    const hasValidAge = ageValue !== "" && Number.isInteger(age) && age >= 1 && age <= 120;
    const under18 = hasValidAge && age < 18;
    const goal = dietGoal?.value || dietPrefs?.goal || "balanced";
    const heading = document.createElement("strong");
    heading.textContent = "SUPPLEMENT INFORMATION — general education only, not a personal recommendation.";
    const intro = document.createElement("p");
    intro.textContent = "Supplements are not automatically needed; food is usually the first place to meet nutrition needs.";
    const proteinHeading = document.createElement("strong");
    proteinHeading.textContent = "Protein powder options";
    const protein = document.createElement("p");
    protein.textContent = goal === "bulking"
      ? "Bulking selected: mass gainer information. Mass gainers are calorie-dense and are not necessary for everyone or a replacement for balanced meals."
      : "Any goal other than bulking: whey protein isolate information. It is milk-derived, may contain less lactose than some whey powders, and is not automatically needed for cutting. Avoid it with a milk allergy.";
    const extraHeading = document.createElement("strong");
    extraHeading.textContent = "Additional supplements";
    const list = document.createElement("ul");
    [
      "Creatine monohydrate: researched for strength and high-intensity performance in appropriate users; not essential for everyone.",
      "Vitamin D and vitamin B12: may be useful when there is a specific nutritional need.",
      "Iron and other vitamins/minerals: mainly when correcting a deficiency or meeting a specific need; do not take iron just in case.",
      "Electrolytes: may help during prolonged exercise or heavy sweating.",
      "Pre-workout: optional, not essential; many products contain stimulants and are not suitable for everyone, especially young people."
    ].forEach(text => { const li = document.createElement("li"); li.textContent = text; list.append(li); });
    supplementInfoNote.append(heading, intro, proteinHeading, protein, extraHeading, list);

    if (hasValidAge && under18) {
      const warning = document.createElement("p");
      warning.className = "supplement-age-warning";
      const strong = document.createElement("strong");
      strong.textContent = "Since you are under 18, it’s better to consult a dietitian before using these.";
      warning.append(strong);
      supplementInfoNote.append(warning);
    } else if (!hasValidAge) {
      const ageHint = document.createElement("p");
      ageHint.textContent = "Enter your age above to see the age-specific safety note.";
      supplementInfoNote.append(ageHint);
    }

    // Keep the full supplement panel in sync as the goal or age changes, not only after submitting.
    if (typeof dietPrefs !== "undefined") {
      dietPrefs.supplements = "yes";
      dietPrefs.goal = goal;
      dietPrefs.age = hasValidAge ? String(age) : "";
      if (typeof renderSupplementPlan === "function") renderSupplementPlan();
    }
  }
  dietSupplements.addEventListener("change", updateSupplementNote);
  supplementAgeInput.addEventListener("input", updateSupplementNote);
  dietGoal?.addEventListener("change", updateSupplementNote);
  const mealPlanContainer = document.querySelector("#meal-plan");
  const mealPlanNote = document.querySelector("#meal-plan-note");
  const supplementPlanPanel = document.querySelector("#supplement-plan-panel");
  const supplementPlanContainer = document.querySelector("#supplement-plan");
  const savedMealsContainer = document.querySelector("#saved-meals");
  const savedMealCount = document.querySelector("#saved-meal-count");
  let dietPrefs = safeRead(DIET_KEY, {
    style: "balanced", goal: "balanced", allergies: "", exclusions: "", mealCount: "3", supplements: "no", age: ""
  });
  if (!["balanced", "bulking", "cutting"].includes(dietPrefs.goal)) dietPrefs.goal = "balanced";
  let savedMeals = safeRead(SAVED_MEALS_KEY, []);
  let completedMeals = safeRead(COMPLETED_MEALS_KEY, []);
  if (!Array.isArray(savedMeals)) savedMeals = [];
  if (!Array.isArray(completedMeals)) completedMeals = [];

  const mealLibrary = [
    { id:"oats", type:"Breakfast", title:"Banana & oat bowl", desc:"Oats with banana and cinnamon; use milk or a suitable alternative.", ingredients:["oats","banana","milk"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Stir oats into milk or a suitable alternative, warm until soft, then add banana and cinnamon.", snack:false },
    { id:"eggs", type:"Breakfast", title:"Egg and whole-grain toast", desc:"Eggs with toast and a side of fruit.", ingredients:["egg","bread","fruit"], tags:["balanced","halal"], recipe:"Cook the egg thoroughly and serve with whole-grain toast and fruit.", snack:false },
    { id:"yogurt", type:"Breakfast", title:"Yogurt, fruit & seed bowl", desc:"Yogurt or a suitable plant-based alternative with fruit and seeds.", ingredients:["yogurt","fruit","seeds"], tags:["balanced","halal","vegetarian"], recipe:"Add washed fruit and seeds to yogurt. Check seed packaging for allergy warnings.", snack:false },
    { id:"tofu-breakfast", type:"Breakfast", title:"Tofu breakfast wrap", desc:"Tofu with spinach in a soft wrap.", ingredients:["tofu","spinach","wrap"], tags:["vegan","vegetarian","balanced"], recipe:"Warm crumbled tofu with spinach and wrap it in a tortilla.", snack:false },
    { id:"beans-toast", type:"Breakfast", title:"Beans on toast", desc:"Beans on toast with tomato or cucumber.", ingredients:["beans","bread","tomato"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Heat beans and serve over toast with sliced tomato.", snack:false },
    { id:"chicken-rice", type:"Lunch", title:"Chicken, rice & vegetables", desc:"Rice, cooked chicken and a colourful vegetable mix.", ingredients:["chicken","rice","vegetables"], tags:["balanced","halal"], recipe:"Cook chicken thoroughly, serve with rice and vegetables. For halal meals, verify the chicken and all ingredients are halal-certified.", snack:false },
    { id:"lentil-bowl", type:"Lunch", title:"Lentil and vegetable bowl", desc:"Lentils with rice or another grain and vegetables.", ingredients:["lentils","rice","vegetables"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Warm cooked lentils with vegetables and serve over rice.", snack:false },
    { id:"tuna-wrap", type:"Lunch", title:"Tuna and salad wrap", desc:"Tuna with crunchy vegetables in a wrap.", ingredients:["tuna","wrap","lettuce"], tags:["balanced","halal"], recipe:"Mix tuna with a little yogurt or suitable dressing, then add washed salad to a wrap.", snack:false },
    { id:"chickpea-wrap", type:"Lunch", title:"Chickpea salad wrap", desc:"Chickpeas, cucumber and tomato in a wrap.", ingredients:["chickpeas","cucumber","tomato","wrap"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Mash chickpeas lightly, mix with chopped vegetables and fill a wrap.", snack:false },
    { id:"tofu-rice", type:"Lunch", title:"Tofu and vegetable rice bowl", desc:"Tofu with rice and sautéed vegetables.", ingredients:["tofu","rice","vegetables","soy"], tags:["balanced","vegetarian","vegan"], recipe:"Cook tofu and vegetables in a pan, then serve over rice. Check sauces for allergens.", snack:false },
    { id:"pasta", type:"Dinner", title:"Tomato and vegetable pasta", desc:"Pasta with tomato sauce and vegetables.", ingredients:["pasta","wheat","tomato"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Cook pasta and simmer tomato sauce with vegetables. Check pasta labels for allergens.", snack:false },
    { id:"fish-potato", type:"Dinner", title:"Fish, potatoes & greens", desc:"Fish with potatoes and a green vegetable.", ingredients:["fish","potato","greens"], tags:["balanced","halal"], recipe:"Cook fish thoroughly and serve with potatoes and steamed greens.", snack:false },
    { id:"bean-chili", type:"Dinner", title:"Bean and vegetable stew", desc:"Beans simmered with tomatoes and vegetables.", ingredients:["beans","tomato","vegetables"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Simmer beans, tomatoes and vegetables until hot and tender.", snack:false },
    { id:"chicken-pita", type:"Dinner", title:"Chicken pita with salad", desc:"Cooked chicken, salad and pita bread.", ingredients:["chicken","pita","wheat","lettuce"], tags:["balanced","halal"], recipe:"Serve thoroughly cooked chicken with washed salad in pita. Verify halal status when needed.", snack:false },
    { id:"tofu-noodles", type:"Dinner", title:"Tofu vegetable noodles", desc:"Noodles with tofu and mixed vegetables.", ingredients:["tofu","noodles","wheat","soy","vegetables"], tags:["balanced","vegetarian","vegan"], recipe:"Cook noodles, stir-fry tofu and vegetables, and combine. Check sauce and noodle labels.", snack:false },
    { id:"fruit", type:"Snack", title:"Fresh fruit", desc:"Choose a fruit you enjoy and wash it before eating.", ingredients:["fruit"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Wash and slice fruit using clean utensils.", snack:true },
    { id:"yogurt-snack", type:"Snack", title:"Yogurt or plant-based yogurt", desc:"A simple snack; check the label for ingredients and allergens.", ingredients:["yogurt"], tags:["balanced","halal","vegetarian"], recipe:"Serve chilled and check the label for allergens.", snack:true },
    { id:"hummus-veg", type:"Snack", title:"Hummus and vegetable sticks", desc:"Hummus with cucumber or carrot sticks.", ingredients:["chickpeas","sesame","cucumber","carrot"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Serve hummus with washed vegetable sticks. Hummus often contains sesame; avoid it if sesame is an allergen.", snack:true },
    { id:"roasted-chickpeas", type:"Snack", title:"Roasted chickpeas", desc:"A crunchy chickpea snack with mild seasoning.", ingredients:["chickpeas"], tags:["balanced","halal","vegetarian","vegan"], recipe:"Drain and dry chickpeas, season lightly and roast until crisp.", snack:true }
  ];
  const dayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const mealTypes = ["Breakfast","Lunch","Dinner","Snack","Snack"];

  function splitTerms(value) {
    return value.split(/[,;\n]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
  }
  function mealAllowed(meal) {
    const style = dietPrefs.style || "balanced";
    if (!meal.tags.includes(style)) return false;
    const blocked = [...splitTerms(dietPrefs.allergies || ""), ...splitTerms(dietPrefs.exclusions || "")];
    const haystack = `${meal.title} ${meal.desc} ${meal.ingredients.join(" ")} ${meal.recipe}`.toLowerCase();
    return !blocked.some(term => term && haystack.includes(term));
  }
  function suitableMeals(type) {
    return mealLibrary.filter(meal => meal.type === type && mealAllowed(meal));
  }
  function portionGuidance(meal) {
    const goal = dietPrefs.goal || "balanced";
    const portions = {
      "oats": { base: "1 bowl of oats, 1 banana, and milk or a suitable alternative; add seeds only if safe for your allergies.", bulk: "Start with the base bowl; if still hungry or training, add another piece of fruit or an extra serving of oats.", cut: "Use a comfortable bowl of oats with banana and milk or an alternative. Do not skip meals or make portions unusually small." },
      "eggs": { base: "2 eggs, 1–2 slices of whole-grain toast, and a serving of fruit.", bulk: "Use the base meal and add toast or fruit if you need more energy.", cut: "Keep the eggs, toast and fruit; choose portions that satisfy your hunger rather than restricting them." },
      "yogurt": { base: "1 bowl of yogurt, a handful of fruit, and a small sprinkle of seeds if safe.", bulk: "Use a generous bowl; add oats or extra fruit if you need more energy.", cut: "Use a normal bowl with fruit; avoid skipping toppings or meals just to reduce intake." },
      "tofu-breakfast": { base: "A wrap with a palm-sized serving of tofu and a generous handful of spinach.", bulk: "Add a second wrap or a side of fruit if you need more energy.", cut: "Keep the tofu and vegetables in the wrap; eat enough to feel comfortably satisfied." },
      "beans-toast": { base: "A bowl of beans with 1–2 slices of toast and tomato.", bulk: "Add another slice of toast or a side of yogurt/fruit if suitable.", cut: "Keep the beans and toast as a balanced meal; no need to remove the carbohydrates." },
      "chicken-rice": { base: "About 1 palm of cooked chicken, 1 fist of rice, and 1–2 fists of vegetables.", bulk: "Try 1–2 palms of chicken, 1–2 fists of rice, and vegetables, adjusting to hunger and activity.", cut: "Keep chicken, rice and vegetables together; use a comfortable plate and avoid aggressive portion reduction." },
      "lentil-bowl": { base: "1 bowl of lentils, about 1 fist of rice/grain, and 1–2 fists of vegetables.", bulk: "Add more rice/grain or a side of bread if you need extra energy.", cut: "Keep lentils, grain and vegetables in the meal; don't remove a whole food group." },
      "tuna-wrap": { base: "1 wrap with a palm-sized serving of tuna and a generous handful of salad.", bulk: "Add a side of fruit, yogurt or another wrap if you need more energy.", cut: "Keep the tuna and wrap; add plenty of salad and eat until comfortably satisfied." },
      "chickpea-wrap": { base: "1 wrap filled with about 1 bowl-sized handful of chickpeas and vegetables.", bulk: "Add extra chickpeas or a side of fruit if you need more energy.", cut: "Keep the chickpeas and wrap; focus on a satisfying balanced meal, not restriction." },
      "tofu-rice": { base: "A palm-sized serving of tofu, 1 fist of rice, and 1–2 fists of vegetables.", bulk: "Add more rice or tofu if you need extra energy.", cut: "Keep tofu, rice and vegetables together; choose portions based on hunger and activity." },
      "pasta": { base: "1 bowl of cooked pasta with tomato sauce and a generous serving of vegetables; add beans/tofu if available.", bulk: "Have a larger bowl or add a protein source if you need more energy.", cut: "Keep a satisfying bowl of pasta with vegetables; don't replace meals with tiny portions." },
      "fish-potato": { base: "1 palm-sized piece of cooked fish, 1 fist of potatoes, and 1–2 fists of greens.", bulk: "Add more potatoes or a side of bread if you need more energy.", cut: "Keep fish, potatoes and greens together and eat enough to feel satisfied." },
      "bean-chili": { base: "1 bowl of bean stew with rice, bread or potatoes as desired.", bulk: "Add a serving of rice or bread if you need extra energy.", cut: "Keep the beans and a carbohydrate side; aim for balance rather than strict restriction." },
      "chicken-pita": { base: "1 pita with a palm-sized serving of cooked chicken and a generous handful of salad.", bulk: "Add extra pita or a side of fruit/yogurt if you need more energy.", cut: "Keep the pita, chicken and salad together; don't skip the bread to force a deficit." },
      "tofu-noodles": { base: "1 bowl of noodles with a palm-sized serving of tofu and plenty of vegetables.", bulk: "Add more noodles or tofu if you need extra energy.", cut: "Keep noodles, tofu and vegetables together in a satisfying bowl." },
      "fruit": { base: "1 piece of fruit or a small bowl of cut fruit.", bulk: "Pair fruit with yogurt, oats or another snack if you need more energy.", cut: "Enjoy a piece or bowl of fruit as a snack; fruit doesn't need to be avoided." },
      "yogurt-snack": { base: "1 small-to-medium bowl of yogurt or a suitable alternative.", bulk: "Add fruit or oats if you need a more filling snack.", cut: "Choose a satisfying bowl; avoid using snacks to replace a needed meal." },
      "hummus-veg": { base: "A few spoonfuls of hummus with a handful of vegetable sticks; hummus contains sesame in many recipes.", bulk: "Add pita or whole-grain crackers if you need more energy.", cut: "Keep the hummus and vegetables; add bread/crackers if hungry." },
      "roasted-chickpeas": { base: "A small bowl of roasted chickpeas.", bulk: "Have a larger snack bowl or pair with fruit if you need more energy.", cut: "A small bowl is an example serving, but have more if you're still hungry." }
    };
    const suggestion = portions[meal.id] || { base: "Use a comfortable serving and include a variety of foods.", bulk: "Add a little more of the meal or a snack if you need more energy.", cut: "Choose a satisfying balanced portion; avoid skipping meals or restricting food groups." };
    const goalText = goal === "bulking" ? suggestion.bulk : goal === "cutting" ? suggestion.cut : suggestion.base;
    return `Suggested portion: ${goalText}`;
  }

  function renderSupplementPlan() {
    if (!supplementPlanPanel || !supplementPlanContainer) return;
    supplementPlanContainer.replaceChildren();
    const includeSupplements = dietPrefs.supplements === "yes";
    supplementPlanPanel.hidden = !includeSupplements;
    if (!includeSupplements) return;

    const age = Number(dietPrefs.age);
    const isUnder18 = Number.isFinite(age) && age > 0 && age < 18;
    const intro = document.createElement("p");
    intro.className = "form-note supplement-plan-emphasis";
    intro.textContent = "GENERAL SUPPLEMENT INFORMATION — not a personalized recommendation. Supplements are not automatically needed, and food is usually the first place to meet nutrition needs.";
    supplementPlanContainer.append(intro);

    let ageWarning = null;
    if (isUnder18) {
      ageWarning = document.createElement("p");
      ageWarning.className = "supplement-age-warning";
      const warningText = document.createElement("strong");
      warningText.textContent = "Since you are under 18, it’s better to consult a dietitian before using these.";
      ageWarning.append(warningText);
    }

    const proteinOption = dietPrefs.goal === "bulking"
      ? { title: "Protein powder option: Mass gainer (bulking selected)", text: "Mass gainers are calorie-dense products marketed to increase energy intake. They are not necessary for everyone and should not replace balanced meals. Check ingredients and allergies; ask a qualified healthcare professional whether it is suitable for you." }
      : { title: "Protein powder option: Whey protein isolate", text: "A milk-derived protein powder that usually contains less lactose than some other whey powders. It is not a fat-loss product and is not automatically needed for cutting. Avoid it with a milk allergy; check the label and discuss suitability with a qualified healthcare professional." };

    const items = [
      { title: proteinOption.title, text: proteinOption.text },
      { title: "Creatine monohydrate", text: "This is the most researched form of creatine and has evidence for improving strength and high-intensity performance in appropriate users. It is not essential for everyone. Anyone under 18 should not start it based on this page; discuss it with a parent/guardian and a qualified healthcare professional first." },
      { title: "Vitamin D capsules", text: "Vitamin D supports bone health. A supplement may be useful when there is a deficiency or a specific nutritional need; a clinician or pharmacist can help decide whether it is appropriate." },
      { title: "Vitamin B12", text: "B12 supports nerve function and red blood cell formation. Supplementation may be needed for some people, including some people who eat vegan, but needs vary; seek professional advice." },
      { title: "Iron and other vitamins/minerals", text: "These are mainly useful to correct a confirmed deficiency or meet a specific nutritional need. Do not take iron just in case—too much can be harmful. Ask a healthcare professional before using supplements." },
      { title: "Electrolytes", text: "May help during prolonged exercise or heavy sweating. For everyday activity, regular meals and water are often enough; follow product labels and professional advice." },
      { title: "Pre-workout", text: "Optional, not essential. Many products contain caffeine or other stimulants, which may cause unwanted effects and are not suitable for everyone, especially young people. Do not use them without qualified professional guidance." }
    ];
    const grid = document.createElement("div");
    grid.className = "supplement-info-grid";
    items.forEach(item => {
      const card = document.createElement("article");
      card.className = "supplement-info-card";
      const heading = document.createElement("h3");
      heading.textContent = item.title;
      const body = document.createElement("p");
      body.textContent = item.text;
      card.append(heading, body);
      grid.append(card);
    });
    supplementPlanContainer.append(grid);
    if (ageWarning) supplementPlanContainer.append(ageWarning);
    const reminder = document.createElement("p");
    reminder.className = "form-note supplement-plan-emphasis";
    reminder.textContent = "DayFlow AI does not prescribe supplement brands or doses. Do not start a supplement based only on this overview. If you are under 18, involve a parent/guardian and consult a qualified dietitian or healthcare professional first.";
    supplementPlanContainer.append(reminder);
  }

  function renderMealPlan() {
    mealPlanContainer.replaceChildren();
    const count = Math.max(3, Math.min(5, Number(dietPrefs.mealCount) || 3));
    const types = count === 3 ? mealTypes.slice(0,3) : count === 4 ? mealTypes.slice(0,4) : mealTypes;
    const usedByType = {};
    let shown = 0;
    dayNames.forEach((day, dayIndex) => {
      const dayCard = document.createElement("article");
      dayCard.className = "meal-day";
      const heading = document.createElement("h3");
      heading.textContent = day;
      dayCard.append(heading);
      types.forEach(type => {
        const choices = suitableMeals(type);
        if (!choices.length) return;
        const index = (dayIndex + (usedByType[type] || 0)) % choices.length;
        const meal = choices[index];
        usedByType[type] = (usedByType[type] || 0) + 1;
        const mealKey = `${dayIndex}-${type}`;
        const isDone = completedMeals.includes(mealKey);
        const item = document.createElement("div");
        item.className = `meal-item${isDone ? " is-complete" : ""}`;
        const typeLabel = document.createElement("span");
        typeLabel.className = "meal-type";
        typeLabel.textContent = type;
        const name = document.createElement("div");
        name.className = "meal-name";
        name.textContent = meal.title;
        const desc = document.createElement("p");
        desc.className = "meal-description";
        desc.textContent = `${meal.desc} ${portionGuidance(meal)}`;
        const actions = document.createElement("div");
        actions.className = "meal-actions";
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "secondary-button";
        saveButton.textContent = savedMeals.some(saved => saved.id === meal.id) ? "Saved ✓" : "Save meal";
        saveButton.addEventListener("click", () => saveMeal(meal));
        const doneButton = document.createElement("button");
        doneButton.type = "button";
        doneButton.className = "secondary-button";
        doneButton.textContent = isDone ? "Completed ✓" : "Mark completed";
        doneButton.addEventListener("click", () => {
          if (completedMeals.includes(mealKey)) completedMeals = completedMeals.filter(key => key !== mealKey);
          else completedMeals.push(mealKey);
          safeWrite(COMPLETED_MEALS_KEY, completedMeals);
          renderMealPlan();
          renderBadges();
        });
        const recipeButton = document.createElement("button");
        recipeButton.type = "button";
        recipeButton.className = "secondary-button";
        recipeButton.textContent = "Simple recipe";
        recipeButton.addEventListener("click", () => {
          desc.textContent = `${meal.recipe} Ingredients to review: ${meal.ingredients.join(", ")}. ${portionGuidance(meal)}`;
        });
        actions.append(saveButton, doneButton, recipeButton);
        item.append(typeLabel, name, desc, actions);
        dayCard.append(item);
        shown++;
      });
      if (!dayCard.querySelector(".meal-item")) {
        const note = document.createElement("p");
        note.className = "meal-description";
        note.textContent = "No example meal matched these filters. Try removing an exclusion or allergy term, then regenerate.";
        dayCard.append(note);
      }
      mealPlanContainer.append(dayCard);
    });
    const goalReminder = dietPrefs.goal === "bulking"
      ? " Bulking portions are flexible examples; adjust to hunger, activity and professional advice."
      : dietPrefs.goal === "cutting"
        ? " Cutting guidance here does not recommend restrictive portions. If you're under 18, don't intentionally restrict food for weight loss without a qualified healthcare professional."
        : "";
    mealPlanNote.textContent = shown
      ? `Portions are practical estimates, not exact prescriptions. These are example meal ideas, not a medical nutrition plan. Check ingredients and labels every time. Allergy filtering is a basic text match and may miss hidden ingredients or cross-contact.${goalReminder}`
      : "No meals matched the current filters. Adjust your preferences to see other ideas.";
    renderSupplementPlan();
    renderSavedMeals();
    renderBadges();
  }

  function saveMeal(meal) {
    if (!savedMeals.some(saved => saved.id === meal.id)) {
      savedMeals.push({ id: meal.id, title: meal.title, type: meal.type, desc: meal.desc, recipe: meal.recipe });
      if (!safeWrite(SAVED_MEALS_KEY, savedMeals)) {
        savedMeals.pop();
        alert("Could not save this meal. Browser storage may be full.");
        return;
      }
    }
    renderMealPlan();
    renderSavedMeals();
  }
  function renderSavedMeals() {
    savedMealsContainer.replaceChildren();
    savedMealCount.textContent = `${savedMeals.length} saved`;
    if (!savedMeals.length) {
      const empty = document.createElement("p");
      empty.className = "form-note";
      empty.textContent = "Save a meal from your weekly plan and it will appear here.";
      savedMealsContainer.append(empty);
      return;
    }
    savedMeals.forEach(meal => {
      const row = document.createElement("article");
      row.className = "saved-meal-row";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${meal.type}: ${meal.title}`;
      const description = document.createElement("p");
      description.textContent = meal.desc;
      const recipe = document.createElement("p");
      recipe.textContent = `Recipe: ${meal.recipe}`;
      info.append(title, description, recipe);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        savedMeals = savedMeals.filter(saved => saved.id !== meal.id);
        safeWrite(SAVED_MEALS_KEY, savedMeals);
        renderMealPlan();
        renderSavedMeals();
      });
      row.append(info, remove);
      savedMealsContainer.append(row);
    });
  }
  dietForm.addEventListener("submit", event => {
    event.preventDefault();
    const supplementChoice = document.querySelector("#diet-supplements").value;
    const enteredAge = supplementAgeInput.value.trim();
    if (supplementChoice === "yes" && (!enteredAge || !Number.isInteger(Number(enteredAge)) || Number(enteredAge) < 1 || Number(enteredAge) > 120)) {
      supplementAgeInput.setCustomValidity("Enter your age to view supplement information.");
      supplementAgeInput.reportValidity();
      return;
    }
    supplementAgeInput.setCustomValidity("");
    dietPrefs = {
      style: dietStyle.value,
      goal: dietGoal ? dietGoal.value : "balanced",
      allergies: dietAllergies.value.trim().slice(0, 250),
      exclusions: dietExclusions.value.trim().slice(0, 250),
      mealCount: dietMealCount.value,
      supplements: supplementChoice,
      age: supplementChoice === "yes" ? enteredAge : ""
    };
    if (!safeWrite(DIET_KEY, dietPrefs)) {
      announce("#diet-preferences-form", "Could not save preferences. Browser storage may be unavailable.");
      return;
    }
    updateSupplementNote();
    profile.dietStyle = dietPrefs.style;
    profile.allergies = dietPrefs.allergies;
    profile.exclusions = dietPrefs.exclusions;
    safeWrite(PROFILE_KEY, profile);
    profileDietStyle.value = dietPrefs.style;
    profileAllergies.value = dietPrefs.allergies;
    profileExclusions.value = dietPrefs.exclusions;
    renderProfile();
    renderMealPlan();
    announce("#diet-preferences-form", "Preferences saved on this device and your meal ideas have been refreshed.");
  });
  document.querySelector("#regenerate-meals").addEventListener("click", renderMealPlan);

  // Profile badges reflect real local progress rather than being awarded arbitrarily.
  function renderBadges() {
    const badgeContainer = document.querySelector("#profile-badges");
    if (!badgeContainer) return;
    const currentTasks = Array.isArray(window.dayflowTasksForProfile) ? window.dayflowTasksForProfile : [];
    // The existing task script owns its private task array; read its visible, rendered counters.
    const tasksDone = Number(document.querySelector("#completed-count")?.textContent || 0);
    const pointsText = document.querySelector("#points-count")?.textContent || "0";
    const points = Number(pointsText.match(/\d+/)?.[0] || 0);
    const mealsDone = completedMeals.length;
    document.querySelector("#profile-completed").textContent = String(tasksDone);
    document.querySelector("#profile-points").textContent = String(points);
    document.querySelector("#profile-meals-completed").textContent = String(mealsDone);
    const badges = [
      { icon:"🌱", name:"First Step", detail:"Complete your first routine task", earned:tasksDone >= 1 },
      { icon:"⭐", name:"Point Collector", detail:"Earn 50 or more points", earned:points >= 50 },
      { icon:"📅", name:"Planner", detail:"Complete 5 routine tasks", earned:tasksDone >= 5 },
      { icon:"🍽️", name:"Meal Explorer", detail:"Save your first meal", earned:savedMeals.length >= 1 },
      { icon:"🥗", name:"Meal Tracker", detail:"Mark 3 meals completed", earned:mealsDone >= 3 },
      { icon:"🎯", name:"Goal Setter", detail:"Save your profile details", earned:Boolean((profile.name || "").trim()) }
    ];
    badgeContainer.replaceChildren();
    badges.forEach(badge => {
      const card = document.createElement("article");
      card.className = `achievement-badge${badge.earned ? " earned" : ""}`;
      const icon = document.createElement("span");
      icon.className = "badge-icon";
      icon.textContent = badge.icon;
      const name = document.createElement("strong");
      name.textContent = badge.name;
      const detail = document.createElement("small");
      detail.textContent = badge.earned ? "Unlocked!" : badge.detail;
      card.append(icon, name, detail);
      badgeContainer.append(card);
    });
  }

  // Load saved preferences and start the new features.
  dietStyle.value = dietPrefs.style || "balanced";
  if (dietGoal) dietGoal.value = ["balanced", "bulking", "cutting"].includes(dietPrefs.goal) ? dietPrefs.goal : "balanced";
  dietAllergies.value = dietPrefs.allergies || "";
  dietExclusions.value = dietPrefs.exclusions || "";
  dietMealCount.value = dietPrefs.mealCount || "3";
  document.querySelector("#diet-supplements").value = dietPrefs.supplements === "yes" ? "yes" : "no";
  supplementAgeInput.value = dietPrefs.age || "";
  updateSupplementNote();
  renderSupplementPlan();
  renderProfile();
  updateCoachWelcomeName();
  renderMealPlan();

  // Keep profile progress cards current when the user checks or deletes routine tasks.
  const taskListForProgress = document.querySelector("#task-list");
  if (taskListForProgress) {
    new MutationObserver(() => renderBadges()).observe(taskListForProgress, { childList: true, subtree: true, attributes: true });
  }
})();


/* Challenges + Social features. Local-only demo; no paid services or online sharing. */
(() => {
  "use strict";
  const KEYS = {
    challenges: "dayflow.social.challenges.v1",
    checkins: "dayflow.social.checkins.v1",
    posts: "dayflow.social.posts.v1",
    skips: "dayflow.social.skips.v1",
    spent: "dayflow.social.points-spent.v1",
    smartScroll: "dayflow.social.smart-scroll-enabled.v1",
    screenAllowance: "dayflow.social.screen-allowance-seconds.v1",
    platformOpenedAt: "dayflow.social.platform-opened-at.v1"
  };
  const read = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value == null ? fallback : value; }
    catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  };
  const challengeDefaults = [
    { id: "water", title: "Hydration Habit", icon: "💧", category: "Weekly", description: "Log a water break on 12 separate occasions this week. Keep it comfortable and spread them across your day.", goal: 12, unit: "check-ins" },
    { id: "move", title: "Movement Mix", icon: "🚶", category: "Weekly", description: "Complete five enjoyable movement sessions on separate occasions. Walking, dancing, cycling or sport all count; take breaks when needed.", goal: 5, unit: "sessions" },
    { id: "read", title: "Learning Streak", icon: "📚", category: "Weekly", description: "Spend time reading or learning on five separate days this week.", goal: 5, unit: "sessions" },
    { id: "reset", title: "Mindful Reset", icon: "🌿", category: "Weekly", description: "Take five screen-free pauses, breathing breaks, or quiet resets during the week.", goal: 5, unit: "resets" },
    { id: "tidy", title: "Tidy-Up Sprint", icon: "🧹", category: "Weekly", description: "Spend 10 minutes tidying one small area on four separate occasions. A desk, shelf or backpack counts.", goal: 4, unit: "sessions" },
    { id: "outside", title: "Fresh-Air Breaks", icon: "🌤️", category: "Weekly", description: "Enjoy three safe outdoor breaks this week, even if it is just a short walk or sitting outside.", goal: 3, unit: "breaks" },
    { id: "plan", title: "Plan Ahead", icon: "🗓️", category: "Weekly", description: "Take five minutes to review or plan your next day on four evenings this week.", goal: 4, unit: "check-ins" },
    { id: "creative", title: "Creative Minutes", icon: "🎨", category: "Weekly", description: "Make time for a hobby such as drawing, music, writing or building something on three occasions.", goal: 3, unit: "sessions" }
  ];
  let challengeState = read(KEYS.challenges, {});
  let checkins = read(KEYS.checkins, []);
  let posts = read(KEYS.posts, []);
  let skipState = read(KEYS.skips, null);
  let pointsSpent = Number(read(KEYS.spent, 0)) || 0;
  let feedEnabled = true;
  let smartScrollEnabled = read(KEYS.smartScroll, false) === true;
  let allowanceSeconds = Math.max(0, Number(read(KEYS.screenAllowance, 1800)) || 0);
  let pendingPlatformUrl = "";
  if (!challengeState || typeof challengeState !== "object" || Array.isArray(challengeState)) challengeState = {};
  if (!Array.isArray(checkins)) checkins = [];
  if (!Array.isArray(posts)) posts = [];

  const $ = id => document.getElementById(id);
  const challengeGrid = $("challenge-grid");
  const checkinSelect = $("checkin-challenge");
  const checkinForm = $("challenge-checkin-form");
  const checkinPhoto = $("checkin-photo");
  const feed = $("social-feed");
  const postForm = $("social-post-form");
  const postText = $("social-post-text");
  const activationDialog = $("smart-scroll-activation-dialog");
  const activateSmartScrollButton = $("activate-smart-scroll");
  const smartScrollDialog = $("smart-scroll-dialog");
  if (!challengeGrid || !checkinForm || !postForm || !smartScrollDialog || !activationDialog || !activateSmartScrollButton) return;

  // Keep the existing movement choices and add slightly more challenging options.
  // A different challenge is preselected each time the user tries to open a platform.
  const smartScrollExerciseSelect = $("smart-scroll-exercise");
  const smartScrollExerciseChallenges = [
    { value: "10 comfortable squats", label: "10 comfortable squats" },
    { value: "8 wall push-ups", label: "8 wall push-ups" },
    { value: "20 step jacks", label: "20 low-impact step jacks" },
    { value: "March in place for 30 seconds", label: "March in place · 30 seconds" },
    { value: "10 alternating reverse lunges (5 each side)", label: "10 alternating reverse lunges · 5 per side" },
    { value: "Hold a wall sit for 20 seconds", label: "Wall sit · 20 seconds" },
    { value: "Hold a plank for 15 seconds", label: "Plank · 15 seconds (or skip if uncomfortable)" },
    { value: "10 standing knee raises per side", label: "10 standing knee raises per side" }
  ];
  if (smartScrollExerciseSelect) {
    const existingValues = new Set(Array.from(smartScrollExerciseSelect.options, option => option.value));
    smartScrollExerciseChallenges.forEach(exercise => {
      if (!existingValues.has(exercise.value)) {
        const option = document.createElement("option");
        option.value = exercise.value;
        option.textContent = exercise.label;
        smartScrollExerciseSelect.append(option);
      }
    });
  }

  function isoWeekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  function ensureWeek() {
    const week = isoWeekKey();
    if (!skipState || skipState.week !== week) skipState = { week, used: 0, extra: 0 };
    skipState.used = Math.max(0, Number(skipState.used) || 0);
    skipState.extra = Math.max(0, Number(skipState.extra) || 0);
    write(KEYS.skips, skipState);
  }
  function taskPoints() {
    const node = $("points-count");
    const match = (node?.textContent || "0").match(/\d+/);
    return Number(match?.[0] || 0);
  }
  function availablePoints() { return Math.max(0, taskPoints() - pointsSpent); }
  function progressFor(id) { const week = isoWeekKey(); return checkins.filter(item => item.challengeId === id && (item.week ? item.week === week : isoWeekKey(new Date(item.createdAt)) === week)).length; }
  function safeText(value, max = 280) { return String(value || "").trim().slice(0, max); }
  function formatAllowance(seconds) {
    const minutes = Math.ceil(Math.max(0, seconds) / 60);
    return `${minutes} min`;
  }
  function renderAllowance() {
    const node = $("smart-scroll-time");
    if (node) node.textContent = formatAllowance(allowanceSeconds);
    write(KEYS.screenAllowance, allowanceSeconds);
  }
  function accountForPlatformTime() {
    const openedAt = Number(read(KEYS.platformOpenedAt, 0)) || 0;
    if (!openedAt) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
    allowanceSeconds = Math.max(0, allowanceSeconds - elapsed);
    write(KEYS.screenAllowance, allowanceSeconds);
    write(KEYS.platformOpenedAt, 0);
    renderAllowance();
    renderSkips(allowanceSeconds > 0
      ? `Welcome back. About ${formatAllowance(allowanceSeconds)} remains in your Smart Scroll allowance.`
      : "Your Smart Scroll allowance is used up. Your remaining time is saved, but this demo cannot control other apps.");
  }
  function renderSkips(message = "") {
    ensureWeek();
    renderAllowance();
    const freeRemaining = Math.max(0, 3 - skipState.used);
    const remaining = freeRemaining + skipState.extra;
    $("skips-remaining").textContent = String(remaining);
    $("extra-skips-count").textContent = String(skipState.extra);
    const points = smartScrollEnabled ? availablePoints() : 0;
    $("social-points-balance").textContent = String(points);
    $("skip-week-label").textContent = skipState.week;
    $("use-skip").disabled = !smartScrollEnabled || remaining <= 0;
    $("buy-extra-skip").disabled = !smartScrollEnabled || availablePoints() < 250;
    $("buy-extra-skip").textContent = "Get 1 extra skip · 250 pts";
    $("skip-status").textContent = message || (smartScrollEnabled
      ? "Skips help you take a planned break; they do not erase your progress. Extra skips cost 250 earned points each."
      : "Activate Smart Scroll to use skips and earn points.");
    const stateLabel = $("smart-scroll-state");
    if (stateLabel) {
      stateLabel.textContent = smartScrollEnabled ? "Smart Scroll is active" : "Smart Scroll is off";
      stateLabel.classList.toggle("is-active", smartScrollEnabled);
    }
    const rewardNote = $("smart-scroll-reward-note");
    if (rewardNote) rewardNote.textContent = smartScrollEnabled
      ? "You're opted in. Complete routine tasks to earn points and use your weekly skips. Screen time is an estimate while you are away from this page."
      : "Activate Smart Scroll to start earning routine points and unlock the challenge tools.";
    const pointCard = $("smart-scroll-points");
    if (pointCard) pointCard.textContent = String(points);
    const skipCard = $("smart-scroll-skips");
    if (skipCard) skipCard.textContent = String(remaining);
    activateSmartScrollButton.textContent = smartScrollEnabled ? "Turn Smart Scroll off" : "✦ Enable Smart Scroll";
    activateSmartScrollButton.classList.toggle("secondary-button", smartScrollEnabled);
    activateSmartScrollButton.classList.toggle("primary-button", !smartScrollEnabled);
  }
  function renderChallenges() {
    challengeGrid.replaceChildren();
    checkinSelect.replaceChildren();
    challengeDefaults.forEach(challenge => {
      const progress = progressFor(challenge.id);
      const complete = progress >= challenge.goal;
      const card = document.createElement("article");
      card.className = `challenge-card${complete ? " is-complete" : ""}`;
      const top = document.createElement("div"); top.className = "challenge-card-top";
      const icon = document.createElement("span"); icon.className = "challenge-icon"; icon.textContent = challenge.icon;
      const tag = document.createElement("span"); tag.className = "challenge-tag"; tag.textContent = challenge.category;
      top.append(icon, tag);
      const title = document.createElement("h3"); title.textContent = challenge.title;
      const desc = document.createElement("p"); desc.textContent = challenge.description;
      const track = document.createElement("div"); track.className = "challenge-progress-track";
      const bar = document.createElement("div"); bar.className = "challenge-progress-bar"; bar.style.width = `${Math.min(100, progress / challenge.goal * 100)}%`; track.append(bar);
      const progressText = document.createElement("div"); progressText.className = "challenge-progress-text"; progressText.textContent = `${Math.min(progress, challenge.goal)} / ${challenge.goal} ${challenge.unit}${complete ? " · Goal reached!" : ""}`;
      const check = document.createElement("button"); check.type = "button"; check.className = "secondary-button"; check.textContent = "Log progress";
      check.addEventListener("click", () => { checkinSelect.value = challenge.id; $("checkin-note").focus(); checkinForm.scrollIntoView({ behavior: "smooth", block: "center" }); });
      card.append(top, title, desc, track, progressText, check);
      challengeGrid.append(card);
      const option = document.createElement("option"); option.value = challenge.id; option.textContent = challenge.title; checkinSelect.append(option);
    });
    $("challenge-count").textContent = `${challengeDefaults.filter(challenge => progressFor(challenge.id) < challenge.goal).length} active`;
  }
  function resizeImage(file, maxSide = 640) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("Choose a PNG, JPG or WebP image."));
      if (file.size > 4 * 1024 * 1024) return reject(new Error("Choose an image smaller than 4 MB."));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("The image could not be opened."));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function displayDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function renderFeed() {
    feed.classList.remove("is-hidden");
    feed.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement("div"); empty.className = "social-empty";
      empty.textContent = "Your feed is ready. Share a small win above, or complete a challenge check-in to add an update.";
      feed.append(empty); return;
    }
    [...posts].sort((a,b) => b.createdAt - a.createdAt).forEach(post => {
      const article = document.createElement("article"); article.className = "social-post";
      const header = document.createElement("div"); header.className = "social-post-header";
      const author = document.createElement("span"); author.className = "social-post-author"; author.textContent = post.author || "You";
      const date = document.createElement("span"); date.className = "social-post-time"; date.textContent = displayDate(post.createdAt);
      header.append(author, date); article.append(header);
      const body = document.createElement("p"); body.textContent = post.text || "Logged a challenge check-in."; article.append(body);
      if (post.photo) { const img = document.createElement("img"); img.className = "social-post-photo"; img.src = post.photo; img.alt = "Optional activity proof uploaded by you"; article.append(img); }
      const actions = document.createElement("div"); actions.className = "social-post-actions";
      const cheer = document.createElement("button"); cheer.type = "button"; cheer.className = "secondary-button"; cheer.textContent = `Encourage ${post.cheers || 0} ♡`;
      cheer.addEventListener("click", () => { post.cheers = (Number(post.cheers) || 0) + 1; write(KEYS.posts, posts); renderFeed(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "Delete my post";
      remove.addEventListener("click", () => { posts = posts.filter(item => item.id !== post.id); write(KEYS.posts, posts); renderFeed(); });
      actions.append(cheer, remove); article.append(actions); feed.append(article);
    });
  }
  $("buy-extra-skip").addEventListener("click", () => {
    renderSkips();
    if (!smartScrollEnabled) { renderSkips("Activate Smart Scroll before buying skips."); return; }
    if (availablePoints() < 250) { renderSkips("You need 250 available points to get an extra skip. Complete routine tasks while Smart Scroll is active."); return; }
    pointsSpent += 250;
    if (!write(KEYS.spent, pointsSpent)) { pointsSpent -= 100; renderSkips("Could not save this purchase. Check browser storage."); return; }
    skipState.extra += 1;
    write(KEYS.skips, skipState);
    renderSkips("Extra skip added! 250 points were spent from your available balance.");
  });
  function consumeSkipForExercise() {
    if (!smartScrollEnabled) { renderSkips("Activate Smart Scroll before using skips."); return false; }
    ensureWeek();
    if (skipState.extra > 0) {
      skipState.extra -= 1;
      write(KEYS.skips, skipState);
      renderSkips("Purchased skip used. You can continue to your platform.");
      return true;
    }
    if (skipState.used < 3) {
      skipState.used += 1;
      write(KEYS.skips, skipState);
      renderSkips("One of your 3 free weekly skips was used.");
      return true;
    }
    if (availablePoints() >= 250) {
      pointsSpent += 250;
      if (!write(KEYS.spent, pointsSpent)) {
        pointsSpent -= 100;
        renderSkips("Could not save the 250-point skip. Please try again.");
        return false;
      }
      write(KEYS.skips, skipState);
      renderSkips("Skip used. 250 points were deducted.");
      return true;
    }
    renderSkips("You have used your free weekly skips. An extra skip costs 250 points, or you can do the exercise.");
    return false;
  }
  $("use-skip").addEventListener("click", () => {
    const used = consumeSkipForExercise();
    if (used) return;
  });
  function continueToPlatform() {
    const url = pendingPlatformUrl;
    pendingPlatformUrl = "";
    if (smartScrollDialog.open) smartScrollDialog.close();
    if (url && allowanceSeconds > 0) {
      write(KEYS.platformOpenedAt, Date.now());
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
  document.querySelectorAll(".social-launch[data-url]").forEach(button => {
    button.addEventListener("click", () => {
      const url = button.dataset.url;
      const platform = button.dataset.platform || "social media";
      if (!url) return;
      if (!smartScrollEnabled) {
        pendingPlatformUrl = url;
        activationDialog.showModal();
        $("smart-scroll-activation-title").textContent = `Enable Smart Scroll before opening ${platform}?`;
        return;
      }
      if (allowanceSeconds <= 0) {
        renderSkips("Your Smart Scroll allowance is used up. This demo cannot unlock or control other apps.");
        return;
      }
      pendingPlatformUrl = url;
      const promptNode = $("smart-scroll-platform-note");
      if (promptNode) promptNode.textContent = `Quick challenge before opening ${platform}: try the movement selected below, or choose another comfortable option. You can use a skip instead.`;
      if (smartScrollExerciseSelect && smartScrollExerciseChallenges.length) {
        const challenge = smartScrollExerciseChallenges[Math.floor(Math.random() * smartScrollExerciseChallenges.length)];
        smartScrollExerciseSelect.value = challenge.value;
      }
      $("smart-scroll-dialog-status").textContent = "";
      smartScrollDialog.showModal();
    });
  });
  $("smart-scroll-complete").addEventListener("click", () => {
    const exercise = $("smart-scroll-exercise").value;
    $("smart-scroll-dialog-status").textContent = `Nice! You selected: ${exercise}. Continue when you're ready.`;
    continueToPlatform();
  });
  $("smart-scroll-skip").addEventListener("click", () => {
    if (consumeSkipForExercise()) continueToPlatform();
    else $("smart-scroll-dialog-status").textContent = "No skip available. Choose an exercise, earn more points, or cancel.";
  });
  $("smart-scroll-cancel").addEventListener("click", () => {
    pendingPlatformUrl = "";
    smartScrollDialog.close();
  });
  activateSmartScrollButton.addEventListener("click", () => {
    if (smartScrollEnabled) {
      smartScrollEnabled = false;
      write(KEYS.smartScroll, false);
      renderTasks();
      renderSkips("Smart Scroll is off. Routine tasks won't earn points until you activate it again.");
    } else {
      $("smart-scroll-activation-title").textContent = "Activate Smart Scroll?";
      activationDialog.showModal();
    }
  });
  $("confirm-smart-scroll").addEventListener("click", () => {
    smartScrollEnabled = true;
    write(KEYS.smartScroll, true);
    activationDialog.close();
    pendingPlatformUrl = "";
    renderTasks();
    renderSkips("Smart Scroll activated! Complete routine tasks to earn points.");
  });
  $("cancel-smart-scroll-activation").addEventListener("click", () => activationDialog.close());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) accountForPlatformTime();
  });
  window.addEventListener("focus", accountForPlatformTime);

  checkinForm.addEventListener("submit", async event => {
    event.preventDefault();
    const challenge = challengeDefaults.find(item => item.id === checkinSelect.value);
    if (!challenge) return;
    const note = safeText($("checkin-note").value, 180);
    const file = checkinPhoto.files?.[0];
    let photo = "";
    const submit = checkinForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (file) photo = await resizeImage(file);
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, challengeId: challenge.id, createdAt: Date.now(), week: isoWeekKey(), note };
      checkins.unshift(entry);
      if (!write(KEYS.checkins, checkins)) { checkins.shift(); throw new Error("Could not save the check-in. Browser storage may be full; try a smaller photo or remove old posts."); }
      const profileName = safeText($("profile-name")?.value, 50) || "You";
      posts.unshift({ id: entry.id, author: profileName, createdAt: entry.createdAt, text: `${challenge.title}: ${note || "I checked in for this challenge."}`, photo, cheers: 0 });
      if (!write(KEYS.posts, posts)) { posts.shift(); write(KEYS.checkins, checkins); throw new Error("Check-in saved, but the feed could not be updated. Try removing older posts."); }
      $("checkin-note").value = ""; checkinPhoto.value = "";
      renderChallenges(); renderFeed();
      alert("Check-in saved on this device. Nice work!");
    } catch (error) { alert(error.message || "Could not save this check-in."); }
    finally { submit.disabled = false; }
  });
  postForm.addEventListener("submit", event => {
    event.preventDefault();
    const message = safeText(postText.value, 280);
    if (!message) { postText.focus(); return; }
    const author = safeText($("profile-name")?.value, 50) || "You";
    const post = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, author, createdAt: Date.now(), text: message, photo: "", cheers: 0 };
    posts.unshift(post);
    if (!write(KEYS.posts, posts)) { posts.shift(); alert("Could not save your post. Browser storage may be full."); return; }
    postText.value = ""; renderFeed();
  });
  // Re-render available points when the existing task planner updates its counters.
  const pointsNode = $("points-count");
  if (pointsNode && "MutationObserver" in window) new MutationObserver(() => renderSkips()).observe(pointsNode, { childList: true, subtree: true, characterData: true });
  ensureWeek();
  renderChallenges();
  renderSkips();
  renderFeed();
})();


/* Workout Planner: deterministic local plan generation and local progress tracking. */
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const SETTINGS_KEY = "dayflow.workout.settings.v1";
  const PROGRESS_KEY = "dayflow.workout.progress.v1";
  const safeRead = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value == null ? fallback : value; }
    catch { return fallback; }
  };
  const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const settingsForm = $("#workout-settings-form");
  const planNode = $("#workout-plan");
  if (!settingsForm || !planNode) return;
  const controls = {
    goal: $("#workout-goal"), level: $("#workout-level"), days: $("#workout-days"),
    duration: $("#workout-duration"), equipment: $("#workout-equipment")
  };
  const defaults = { goal: "strength", level: "beginner", days: "3", duration: "30", equipment: "none" };
  let settings = { ...defaults, ...safeRead(SETTINGS_KEY, {}) };
  let progress = safeRead(PROGRESS_KEY, { completed: [], history: [] });
  if (!Array.isArray(progress.completed)) progress.completed = [];
  if (!Array.isArray(progress.history)) progress.history = [];
  const weekKey = () => {
    const d = new Date();
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  };
  const currentWeek = weekKey();
  const dayTemplates = [
    { title: "Day 1 · Full body A", focus: "Steady, controlled movements", warm: [
      ["Easy march in place", "60 sec", "Move comfortably and breathe normally."], ["Shoulder rolls", "30 sec", "Roll gently forward and back."], ["Hip hinges", "8 reps", "Push hips back with a comfortable, neutral back."], ["Easy step-touch", "60 sec", "Keep the pace easy."]],
      main: [["Chair sit-to-stand", "2 × 8", "Use a sturdy chair; hands can assist as needed."], ["Wall push-ups", "2 × 8", "Keep your body in a straight, comfortable line."], ["Glute bridges", "2 × 10", "Lift hips gently; do not force your back."], ["Bird-dog", "2 × 6 each side", "Move slowly and keep balance." ]], cool: [["Gentle chest stretch", "30 sec", "Stay in a pain-free range."], ["Gentle leg stretch", "30 sec each", "No bouncing; ease off if uncomfortable."], ["Slow breathing", "60 sec", "Let your breathing settle."]] },
    { title: "Day 2 · Full body B", focus: "Balance and core control", warm: [["Easy march in place", "60 sec", "Choose a comfortable pace."], ["Arm circles", "30 sec", "Small circles, then reverse."], ["Ankle rocks", "8 each side", "Hold a wall for balance if needed."], ["Step-touch", "60 sec", "Keep it light and easy."]],
      main: [["Supported reverse step", "2 × 6 each side", "Hold a sturdy chair or wall; keep the step small."], ["Incline push-up on wall", "2 × 8", "Use the wall rather than the floor at first."], ["Dead bug heel taps", "2 × 6 each side", "Keep the movement small and controlled."], ["Calf raises", "2 × 10", "Hold a chair for balance if useful."]], cool: [["Gentle shoulder stretch", "30 sec each", "Avoid pulling hard."], ["Gentle calf stretch", "30 sec each", "Keep heels comfortable."], ["Slow breathing", "60 sec", "Relax your shoulders."]] },
    { title: "Day 3 · Full body C", focus: "Practice and consistency", warm: [["Easy march in place", "60 sec", "Start slowly."], ["Shoulder rolls", "30 sec", "Keep the neck relaxed."], ["Sit-to-stand practice", "6 reps", "Use a chair for support."], ["Step-touch", "60 sec", "Move at a conversational pace."]],
      main: [["Chair sit-to-stand", "2 × 8", "Use a chair that will not slide."], ["Wall push-ups", "2 × 8", "Move slowly; stop if uncomfortable."], ["Standing hip abduction", "2 × 8 each side", "Hold a chair and avoid leaning."], ["Bird-dog or seated reach", "2 × 6 each side", "Choose the version that feels steady."]], cool: [["Gentle upper-back stretch", "30 sec", "Keep the movement easy."], ["Gentle hamstring stretch", "30 sec each", "Do not force the stretch."], ["Slow breathing", "60 sec", "Let your breathing return to normal."]] }
  ];
  function selectedDays() { return Math.max(2, Math.min(5, Number(settings.days) || 3)); }
  function sessionDuration() { return Math.max(15, Math.min(45, Number(settings.duration) || 30)); }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch)); }
  function planExercises(list, scale) {
    return list.map(([name, amount, note]) => {
      let adjusted = amount;
      if (scale === "short") adjusted = amount.includes("×") ? amount.replace(/2 ×/g, "1 ×") : amount;
      if (settings.level === "intermediate" && amount.includes("2 ×")) adjusted = amount.replace("2 ×", "3 ×");
      return `<div class="workout-exercise"><strong>${escapeHTML(name)}</strong><span>${escapeHTML(adjusted)}</span><small>${escapeHTML(note)}</small></div>`;
    }).join("");
  }
  function renderProgress() {
    const doneThisWeek = progress.completed.filter(item => item.week === currentWeek).length;
    $("#workout-completed-count").textContent = String(progress.history.length);
    $("#workout-week-count").textContent = `${doneThisWeek} / ${selectedDays()}`;
    const goals = { strength: "Strength", general: "General fitness", endurance: "Endurance", mobility: "Mobility" };
    $("#workout-current-goal").textContent = goals[settings.goal] || "Strength";
  }
  function renderPlan() {
    const days = selectedDays();
    const duration = sessionDuration();
    $("#workout-plan-label").textContent = `${days} × ${duration} min`;
    const goals = { strength: "Strength practice", general: "General fitness", endurance: "Easy movement", mobility: "Mobility practice" };
    planNode.innerHTML = Array.from({ length: days }, (_, index) => {
      const template = dayTemplates[index % dayTemplates.length];
      const id = `${currentWeek}-day-${index + 1}`;
      const done = progress.completed.some(item => item.id === id);
      const warmList = duration <= 20 ? template.warm.slice(0, 2) : template.warm;
      const mainList = duration <= 20 ? template.main.slice(0, 3) : template.main;
      const coolList = duration <= 20 ? template.cool.slice(-2) : template.cool;
      return `<article class="workout-day-card ${done ? "is-complete" : ""}">
        <div class="workout-day-top"><div><h3>${escapeHTML(template.title)}</h3><p>${escapeHTML(goals[settings.goal] || template.focus)} · ${duration} minutes</p></div>${done ? '<span class="workout-badge">Completed</span>' : '<span class="workout-badge">Planned</span>'}</div>
        <div class="workout-phase"><h4>Warm-up · about 5 min</h4>${planExercises(warmList, duration <= 20 ? "short" : "full")}</div>
        <div class="workout-phase"><h4>Main session · about ${Math.max(5, duration - 10)} min</h4>${planExercises(mainList, duration <= 20 ? "short" : "full")}</div>
        <div class="workout-phase"><h4>Cool-down · about 5 min</h4>${planExercises(coolList, "full")}</div>
        <button class="${done ? "secondary-button" : "primary-button"} workout-complete-button" type="button" data-workout-id="${id}" ${done ? "disabled" : ""}>${done ? "Completed this week ✓" : "Mark session complete"}</button>
      </article>`;
    }).join("");
    renderProgress();
  }
  Object.entries(controls).forEach(([key, control]) => { control.value = settings[key] ?? defaults[key]; });
  settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    settings = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
    if (!safeWrite(SETTINGS_KEY, settings)) { $("#workout-plan-status").textContent = "Your browser could not save settings. The plan can still be viewed for this session."; }
    else $("#workout-plan-status").textContent = "Your plan settings are saved on this device. Take rest days as needed; the plan can be adjusted any time.";
    renderPlan();
  });
  planNode.addEventListener("click", event => {
    const button = event.target.closest("button[data-workout-id]");
    if (!button || button.disabled) return;
    const id = button.dataset.workoutId;
    if (progress.completed.some(item => item.id === id)) return;
    const entry = { id, week: currentWeek, completedAt: new Date().toISOString() };
    progress.completed.push(entry); progress.history.push(entry);
    if (!safeWrite(PROGRESS_KEY, progress)) {
      progress.completed = progress.completed.filter(item => item.id !== id);
      progress.history = progress.history.filter(item => item.id !== id);
      $("#workout-plan-status").textContent = "Could not save progress in this browser. Try freeing browser storage and then mark the session complete again.";
      return;
    }
    $("#workout-plan-status").textContent = "Session marked complete. Nice job showing up—rest and recovery count too.";
    renderPlan();
  });
  $("#workout-reset-week").addEventListener("click", () => {
    if (!window.confirm("Reset this week's workout checkmarks? Your all-time session count will remain.")) return;
    progress.completed = progress.completed.filter(item => item.week !== currentWeek);
    safeWrite(PROGRESS_KEY, progress);
    $("#workout-plan-status").textContent = "This week's workout tracking has been reset.";
    renderPlan();
  });
  // Ensure old or future-dated weekly records do not change this week's card checkmarks.
  progress.completed = progress.completed.filter(item => item && typeof item.id === "string" && typeof item.week === "string");
  renderPlan();
})();


// Focus Timer: 30-minute focus sessions followed by 5-minute breaks. No long breaks.
(() => {
  const panel = document.querySelector("#focus-timer");
  if (!panel) return;
  const clock = panel.querySelector("#focus-timer-clock");
  const phaseLabel = panel.querySelector("#focus-timer-phase");
  const status = panel.querySelector("#focus-timer-status");
  const startButton = panel.querySelector("#focus-timer-start");
  const resetButton = panel.querySelector("#focus-timer-reset");
  const FOCUS_SECONDS = 30 * 60;
  const BREAK_SECONDS = 5 * 60;
  let phase = "focus";
  let remaining = FOCUS_SECONDS;
  let intervalId = null;
  let endAt = 0;

  function render() {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    clock.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    phaseLabel.textContent = phase === "focus" ? "Focus session" : "Break time";
    panel.classList.toggle("is-break", phase === "break");
    startButton.textContent = intervalId === null ? (remaining === (phase === "focus" ? FOCUS_SECONDS : BREAK_SECONDS) ? (phase === "focus" ? "Start focus" : "Start break") : "Resume timer") : "Pause timer";
  }

  function stopInterval() {
    if (intervalId !== null) window.clearInterval(intervalId);
    intervalId = null;
  }

  function tick() {
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (remaining <= 0) {
      stopInterval();
      if (phase === "focus") {
        phase = "break";
        remaining = BREAK_SECONDS;
        status.textContent = "Focus session complete! Your 5-minute break starts now.";
      } else {
        phase = "focus";
        remaining = FOCUS_SECONDS;
        status.textContent = "Break complete. Ready for another 30-minute focus session?";
      }
      render();
      return;
    }
    render();
  }

  startButton.addEventListener("click", () => {
    if (intervalId !== null) {
      remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      stopInterval();
      status.textContent = "Timer paused. Resume whenever you're ready.";
      render();
      return;
    }
    endAt = Date.now() + remaining * 1000;
    status.textContent = phase === "focus" ? "Focus on one task until the timer ends." : "Take a relaxed 5-minute break.";
    intervalId = window.setInterval(tick, 250);
    render();
  });

  resetButton.addEventListener("click", () => {
    stopInterval();
    phase = "focus";
    remaining = FOCUS_SECONDS;
    status.textContent = "Timer reset. Ready when you are.";
    render();
  });
  render();
})();


// DayFlow AI account and multi-device sync. Data is private to the signed-in account.
(() => {
  'use strict';
  const form = document.querySelector('#account-form');
  if (!form) return;
  const usernameInput = document.querySelector('#account-username');
  const passwordInput = document.querySelector('#account-password');
  const status = document.querySelector('#account-status');
  const pill = document.querySelector('#sync-status-pill');
  const loginButton = document.querySelector('#account-login');
  const registerButton = document.querySelector('#account-register');
  const logoutButton = document.querySelector('#account-logout');
  let signedIn = false;
  let syncing = false;
  let restoring = false;
  let syncTimer = null;
  let lastSavedSnapshot = '';

  function setStatus(message, state = '') {
    status.textContent = message;
    pill.textContent = state === 'synced' ? 'Sync connected' : state === 'error' ? 'Sync issue' : signedIn ? 'Signed in' : 'Not signed in';
    pill.classList.toggle('is-synced', state === 'synced');
    pill.classList.toggle('is-error', state === 'error');
  }
  function localSnapshot() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('dayflow.')) data[key] = localStorage.getItem(key);
    }
    return data;
  }
  function replaceLocalSnapshot(data) {
    restoring = true;
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('dayflow.')) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(data || {})) {
        if (key.startsWith('dayflow.') && typeof value === 'string') localStorage.setItem(key, value);
      }
    } finally { restoring = false; }
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }
  async function saveCloud({quiet = false} = {}) {
    if (!signedIn || syncing || restoring) return;
    const snapshot = localSnapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSavedSnapshot) return;
    syncing = true;
    try {
      await api('/api/dayflow-data', { method: 'PUT', body: JSON.stringify({ data: snapshot }) });
      lastSavedSnapshot = serialized;
      if (!quiet) setStatus('Your latest routines, progress, profile settings, workout records, and other DayFlow data are synced to your account.', 'synced');
    } catch (error) {
      setStatus(`${error.message} Your local data is still saved on this device.`, 'error');
    } finally { syncing = false; }
  }
  function scheduleSave() {
    if (!signedIn || restoring) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => saveCloud({quiet: true}), 700);
  }
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && String(key).startsWith('dayflow.')) scheduleSave();
  };
  window.addEventListener('storage', event => { if (event.key && event.key.startsWith('dayflow.')) scheduleSave(); });
  window.addEventListener('pagehide', () => { if (signedIn) saveCloud({quiet: true}); });

  async function establishSession(mode) {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) { setStatus('Enter your username and password first.', 'error'); return; }
    loginButton.disabled = registerButton.disabled = true;
    try {
      const result = await api(mode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      signedIn = true;
      usernameInput.value = result.user.username;
      passwordInput.value = '';
      usernameInput.readOnly = true;
      logoutButton.hidden = false;
      loginButton.hidden = true;
      registerButton.hidden = true;
      const cloud = await api('/api/dayflow-data');
      if (cloud.hasData && cloud.data && Object.keys(cloud.data).length) {
        const before = JSON.stringify(localSnapshot());
        const after = JSON.stringify(cloud.data);
        if (before !== after) {
          replaceLocalSnapshot(cloud.data);
          lastSavedSnapshot = after;
          setStatus(`Welcome, ${result.user.username}. Your saved account data was loaded. Refreshing DayFlow to apply it…`, 'synced');
          window.location.reload();
          return;
        }
        lastSavedSnapshot = after;
        setStatus(`Welcome back, ${result.user.username}. Your account data is synced on this device.`, 'synced');
      } else {
        lastSavedSnapshot = '';
        await saveCloud();
        setStatus(`Account ready, ${result.user.username}. Your existing progress on this device has been backed up.`, 'synced');
      }
    } catch (error) {
      signedIn = false;
      setStatus(error.message, 'error');
    } finally { loginButton.disabled = registerButton.disabled = false; }
  }
  loginButton.addEventListener('click', () => establishSession('login'));
  registerButton.addEventListener('click', () => establishSession('register'));
  form.addEventListener('submit', event => { event.preventDefault(); establishSession('login'); });
  logoutButton.addEventListener('click', async () => {
    try {
      await saveCloud({quiet: true});
      await api('/api/logout', { method: 'POST', body: '{}' });
      signedIn = false;
      usernameInput.readOnly = false;
      loginButton.hidden = false;
      registerButton.hidden = false;
      logoutButton.hidden = true;
      setStatus('You are signed out. Your account data remains saved online, and this device keeps its local copy.');
    } catch (error) { setStatus(error.message, 'error'); }
  });

  (async () => {
    try {
      const me = await api('/api/me');
      signedIn = true;
      usernameInput.value = me.user.username;
      usernameInput.readOnly = true;
      loginButton.hidden = true;
      registerButton.hidden = true;
      logoutButton.hidden = false;
      const cloud = await api('/api/dayflow-data');
      if (cloud.hasData && cloud.data) {
        const before = JSON.stringify(localSnapshot());
        const after = JSON.stringify(cloud.data);
        if (before !== after) {
          replaceLocalSnapshot(cloud.data);
          lastSavedSnapshot = after;
          window.location.reload();
          return;
        }
        lastSavedSnapshot = after;
      } else {
        lastSavedSnapshot = '';
        await saveCloud({quiet: true});
      }
      setStatus(`Signed in as ${me.user.username}. Changes sync automatically when you are online.`, 'synced');
    } catch {
      signedIn = false;
      setStatus('Not signed in. Your progress is currently saved on this device. Sign in or create an account to sync it.');
    }
  })();
})();
