require("dotenv").config();

const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const {
  START_MESSAGE,
  INFO_MESSAGE,
  COMMANDS_MESSAGE,
  COLOR_OPTIONS,
  formatPlansForDate,
  formatPlanLine,
} = require("./bot_cmd");

// Очікується, що в .env є змінна BOT_TOKEN=<токен_бота>
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("Помилка: не знайдено BOT_TOKEN в .env");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Зберігання планів у пам'яті:
// plansByChat[chatId] = [{ id, title, date (YYYY-MM-DD), time (HH:MM), color }]
const plansByChat = Object.create(null);

// Тимчасовий стан для створення плану
// pendingPlanByChat[chatId] = { step, draft: { title, date, time, color } }
const pendingPlanByChat = Object.create(null);

const MAX_PLANS_PER_DAY = 10;
const MAX_DAYS_AHEAD = 30;
const MAX_DATES_PER_USER = 400;

const DATES_FILE_PATH = path.join(__dirname, "user_dates.json");

// Збережені дати користувачів: { [chatId]: [ "YYYY-MM-DD", ... ] }
let userDatesByChat = Object.create(null);

function loadUserDatesFromFile() {
  try {
    if (fs.existsSync(DATES_FILE_PATH)) {
      const raw = fs.readFileSync(DATES_FILE_PATH, "utf8");
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          userDatesByChat = parsed;
        }
      }
    }
  } catch (e) {
    console.error("Не вдалося прочитати user_dates.json:", e);
    userDatesByChat = Object.create(null);
  }
}

function saveUserDatesToFile() {
  try {
    fs.writeFileSync(
      DATES_FILE_PATH,
      JSON.stringify(userDatesByChat, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("Не вдалося зберегти user_dates.json:", e);
  }
}

function addDateForUser(chatId, dateYMD) {
  const chatKey = String(chatId);
  let list = userDatesByChat[chatKey];
  if (!Array.isArray(list)) {
    list = [];
  }
  if (!list.includes(dateYMD)) {
    list.push(dateYMD);
    if (list.length > MAX_DATES_PER_USER) {
      // Обрізаємо найстаріші дати, залишаємо останні MAX_DATES_PER_USER
      list = list.slice(list.length - MAX_DATES_PER_USER);
    }
    userDatesByChat[chatKey] = list;
    saveUserDatesToFile();
  }
}

function removeDateForUserIfEmpty(chatId, dateYMD) {
  const chatKey = String(chatId);
  const list = userDatesByChat[chatKey];
  if (!Array.isArray(list)) return;
  const idx = list.indexOf(dateYMD);
  if (idx !== -1) {
    list.splice(idx, 1);
    userDatesByChat[chatKey] = list;
    saveUserDatesToFile();
  }
}

// початкове завантаження дат із файлу
loadUserDatesFromFile();

function getOrCreatePlans(chatId) {
  if (!plansByChat[chatId]) {
    plansByChat[chatId] = [];
  }
  return plansByChat[chatId];
}

function parseDateInput(input) {
  // Очікуємо формат DD.MM.YYYY
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return toYMD(date);
}

function parseTimeInput(input) {
  // Формат HH:MM, 24 години
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isWithinNextDays(dateYMD, days) {
  const today = new Date();
  const target = fromYMD(dateYMD);
  const diffMs = target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

function uniqueSortedDatesWithinRange(plans, maxDaysAhead) {
  const set = new Set();
  for (const p of plans) {
    if (isWithinNextDays(p.date, maxDaysAhead)) {
      set.add(p.date);
    }
  }
  return Array.from(set).sort();
}

function buildDateKeyboard(dates, prefix) {
  if (!dates.length) return undefined;
  return {
    reply_markup: {
      inline_keyboard: dates.map((date) => [
        {
          text: date,
          callback_data: `${prefix}:${date}`,
        },
      ]),
    },
  };
}

function buildColorKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: COLOR_OPTIONS.map((c) => [
        {
          text: c.label,
          callback_data: `COLOR:${c.id}`,
        },
      ]),
    },
  };
}

function buildConfirmKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Підтвердити", callback_data: "PLAN_CONFIRM" },
          { text: "❌ Скасувати", callback_data: "PLAN_CANCEL" },
        ],
      ],
    },
  };
}

function buildUnplanKeyboardForDate(date, plans) {
  if (!plans.length) return undefined;
  const rows = plans.map((p) => [
    {
      text: `🗑 ${p.time} – ${p.title}`,
      callback_data: `UNPLAN_ONE:${date}:${p.id}`,
    },
  ]);
  rows.push([
    {
      text: "🧹 Видалити всі",
      callback_data: `UNPLAN_ALL:${date}`,
    },
  ]);
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function countPlansForDate(plans, date) {
  return plans.filter((p) => p.date === date).length;
}

function buildPostSaveActionsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ Додати нову подію", callback_data: "ACTION_ADD_NEW" },
        ],
        [
          { text: "🗑 Видалити подію", callback_data: "ACTION_UNPLAN" },
        ],
        [
          { text: "📅 Подивитись події", callback_data: "ACTION_VIEW" },
        ],
      ],
    },
  };
}

// /start
bot.onText(/^\/start\b/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from && msg.from.first_name;
  bot.sendMessage(chatId, START_MESSAGE(firstName));
});

// /info
bot.onText(/^\/info\b/, (msg) => {
  bot.sendMessage(msg.chat.id, INFO_MESSAGE);
});

// /commands
bot.onText(/^\/commands\b/, (msg) => {
  bot.sendMessage(msg.chat.id, COMMANDS_MESSAGE);
});

// /plan – запуск сценарію створення події
bot.onText(/^\/plan\b/, (msg) => {
  const chatId = msg.chat.id;
  pendingPlanByChat[chatId] = {
    step: "wait_date",
    draft: {},
  };
  bot.sendMessage(
    chatId,
    "Давай створимо подію.\n\nСпочатку введи дату у форматі DD.MM.YYYY (наприклад, 25.03.2026)."
  );
});

// /planstats – показати дати з планами
bot.onText(/^\/planstats\b/, (msg) => {
  const chatId = msg.chat.id;
  const plans = getOrCreatePlans(chatId);
  const dates = uniqueSortedDatesWithinRange(plans, MAX_DAYS_AHEAD);
  if (!dates.length) {
    bot.sendMessage(chatId, "Поки що в тебе немає запланованих подій у найближчі 30 днів.");
    return;
  }
  bot.sendMessage(
    chatId,
    "Ось дати, на які вже є плани. Обери дату, щоб побачити події:",
    buildDateKeyboard(dates, "SHOW_PLANS")
  );
});

// /unplan – початок видалення подій
bot.onText(/^\/unplan\b/, (msg) => {
  const chatId = msg.chat.id;
  const plans = getOrCreatePlans(chatId);
  const dates = uniqueSortedDatesWithinRange(plans, MAX_DAYS_AHEAD);
  if (!dates.length) {
    bot.sendMessage(chatId, "Немає подій, які можна видалити у найближчі 30 днів.");
    return;
  }
  bot.sendMessage(
    chatId,
    "Обери дату, події якої хочеш видалити:",
    buildDateKeyboard(dates, "UNPLAN_DATE")
  );
});

// Обробка звичайних повідомлень у контексті створення плану
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) {
    // Команда або порожній текст – не чіпаємо тут
    return;
  }

  const state = pendingPlanByChat[chatId];
  if (!state) {
    return;
  }

  if (state.step === "wait_date") {
    const ymd = parseDateInput(text);
    if (!ymd) {
      bot.sendMessage(
        chatId,
        "Не вийшло розпізнати дату. Спробуй ще раз у форматі DD.MM.YYYY (наприклад, 25.03.2026)."
      );
      return;
    }
    if (!isWithinNextDays(ymd, MAX_DAYS_AHEAD)) {
      bot.sendMessage(
        chatId,
        `Дата повинна бути від сьогодні і не більше ніж на ${MAX_DAYS_AHEAD} днів вперед.`
      );
      return;
    }
    state.draft.date = ymd;
    state.step = "wait_time";
    bot.sendMessage(
      chatId,
      "Чудово! Тепер введи час у форматі HH:MM (24-годинний формат, наприклад, 14:30)."
    );
    return;
  }

  if (state.step === "wait_time") {
    const time = parseTimeInput(text);
    if (!time) {
      bot.sendMessage(
        chatId,
        "Не вийшло розпізнати час. Спробуй ще раз у форматі HH:MM (наприклад, 09:15)."
      );
      return;
    }
    state.draft.time = time;
    state.step = "wait_title";
    bot.sendMessage(
      chatId,
      "Є! Тепер напиши назву події (короткий опис того, що плануєш)."
    );
    return;
  }

  if (state.step === "wait_title") {
    const title = text.trim();
    if (!title) {
      bot.sendMessage(chatId, "Назва не може бути порожньою. Напиши щось змістовне.");
      return;
    }
    state.draft.title = title;
    state.step = "wait_color";
    bot.sendMessage(
      chatId,
      "Обери колір кружечка для цієї події:",
      buildColorKeyboard()
    );
    return;
  }
});

// Обробка callback-кнопок
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data || "";

  try {
    if (data.startsWith("SHOW_PLANS:")) {
      const date = data.split(":")[1];
      const plans = getOrCreatePlans(chatId).filter((p) => p.date === date);
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, formatPlansForDate(date, plans));
      return;
    }

    if (data.startsWith("UNPLAN_DATE:")) {
      const date = data.split(":")[1];
      const allPlans = getOrCreatePlans(chatId);
      const dayPlans = allPlans.filter((p) => p.date === date);
      await bot.answerCallbackQuery(query.id);
      if (!dayPlans.length) {
        await bot.sendMessage(chatId, "На цю дату вже немає подій для видалення.");
        return;
      }
      await bot.sendMessage(
        chatId,
        `Ось події на ${date}. Обери, яку видалити, або видали всі:`,
        buildUnplanKeyboardForDate(date, dayPlans)
      );
      return;
    }

    if (data.startsWith("UNPLAN_ONE:")) {
      const [, date, id] = data.split(":");
      const plans = getOrCreatePlans(chatId);
      const remaining = plans.filter((p) => !(p.date === date && String(p.id) === id));
      plansByChat[chatId] = remaining;
      await bot.answerCallbackQuery(query.id, { text: "Подію видалено." });
      const dayPlans = remaining.filter((p) => p.date === date);
      if (!dayPlans.length) {
        removeDateForUserIfEmpty(chatId, date);
      }
      await bot.editMessageText(
        dayPlans.length
          ? `Оновлений список подій на ${date}:`
          : `Усі події на ${date} видалені.`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          ...buildUnplanKeyboardForDate(date, dayPlans),
        }
      );
      return;
    }

    if (data.startsWith("UNPLAN_ALL:")) {
      const [, date] = data.split(":");
      const plans = getOrCreatePlans(chatId);
      const remaining = plans.filter((p) => p.date !== date);
      plansByChat[chatId] = remaining;
      removeDateForUserIfEmpty(chatId, date);
      await bot.answerCallbackQuery(query.id, { text: "Усі події на цю дату видалено." });
      await bot.editMessageText(`Усі події на ${date} видалені.`, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      return;
    }

    if (data === "ACTION_ADD_NEW") {
      pendingPlanByChat[chatId] = {
        step: "wait_date",
        draft: {},
      };
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(
        chatId,
        "Давай створимо нову подію.\n\nСпочатку введи дату у форматі DD.MM.YYYY (наприклад, 25.03.2026)."
      );
      return;
    }

    if (data === "ACTION_UNPLAN") {
      const plans = getOrCreatePlans(chatId);
      const dates = uniqueSortedDatesWithinRange(plans, MAX_DAYS_AHEAD);
      await bot.answerCallbackQuery(query.id);
      if (!dates.length) {
        await bot.sendMessage(
          chatId,
          "Немає подій, які можна видалити у найближчі 30 днів."
        );
        return;
      }
      await bot.sendMessage(
        chatId,
        "Обери дату, події якої хочеш видалити:",
        buildDateKeyboard(dates, "UNPLAN_DATE")
      );
      return;
    }

    if (data === "ACTION_VIEW") {
      const plans = getOrCreatePlans(chatId);
      const dates = uniqueSortedDatesWithinRange(plans, MAX_DAYS_AHEAD);
      await bot.answerCallbackQuery(query.id);
      if (!dates.length) {
        await bot.sendMessage(
          chatId,
          "Поки що в тебе немає запланованих подій у найближчі 30 днів."
        );
        return;
      }
      await bot.sendMessage(
        chatId,
        "Ось дати, на які вже є плани. Обери дату, щоб побачити події:",
        buildDateKeyboard(dates, "SHOW_PLANS")
      );
      return;
    }

    if (data.startsWith("COLOR:")) {
      const colorId = data.split(":")[1];
      const state = pendingPlanByChat[chatId];
      if (!state || state.step !== "wait_color") {
        await bot.answerCallbackQuery(query.id);
        return;
      }
      state.draft.color = colorId;
      state.step = "wait_confirm";

      const draft = state.draft;
      const preview = formatPlanLine({
        title: draft.title,
        time: draft.time,
        color: draft.color,
      });

      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(
        chatId,
        `Твоя подія:\n\nДата: ${draft.date}\n${preview}\n\nПідтверджуєш?`,
        buildConfirmKeyboard()
      );
      return;
    }

    if (data === "PLAN_CONFIRM") {
      const state = pendingPlanByChat[chatId];
      if (!state || state.step !== "wait_confirm") {
        await bot.answerCallbackQuery(query.id);
        return;
      }
      const draft = state.draft;
      const plans = getOrCreatePlans(chatId);
      const perDayCount = countPlansForDate(plans, draft.date);
      if (perDayCount >= MAX_PLANS_PER_DAY) {
        delete pendingPlanByChat[chatId];
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          `На ${draft.date} вже є ${MAX_PLANS_PER_DAY} подій. Обмеження – не більше ${MAX_PLANS_PER_DAY} планів на день.`
        );
        return;
      }

      const newPlan = {
        id: Date.now().toString() + Math.random().toString(16).slice(2),
        title: draft.title,
        date: draft.date,
        time: draft.time,
        color: draft.color,
      };
      plans.push(newPlan);
      addDateForUser(chatId, newPlan.date);
      delete pendingPlanByChat[chatId];

      await bot.answerCallbackQuery(query.id, { text: "Подію збережено!" });
      await bot.sendMessage(
        chatId,
        `Я запам'ятав цю подію:\n\nДата: ${newPlan.date}\n${formatPlanLine(
          newPlan
        )}`,
        buildPostSaveActionsKeyboard()
      );
      return;
    }

    if (data === "PLAN_CANCEL") {
      delete pendingPlanByChat[chatId];
      await bot.answerCallbackQuery(query.id, { text: "Створення події скасовано." });
      await bot.sendMessage(chatId, "Добре, цю подію не буду зберігати.");
      return;
    }

    // Невідомий callback
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("Помилка при обробці callback:", err);
    try {
      await bot.answerCallbackQuery(query.id, {
        text: "Сталася помилка. Спробуй ще раз.",
        show_alert: true,
      });
    } catch (_) {
      // ігноруємо
    }
  }
});

console.log("Бот Todo`shka запущений і чекає на повідомлення.");

