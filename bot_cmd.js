
const START_MESSAGE = (firstName) =>
  `Привіт, ${firstName || "друже"}! Я Todo\`shka, твій планувальник.\n\nЩоб дізнатися мої можливості, напиши: /info.\nА щоб дізнатися, які команди в мене є – напиши /commands.`;

const INFO_MESSAGE =
  "Я Todo`shka – простий планувальник у Telegram.\n\n" +
  "Допомагаю тобі створювати події на конкретну дату та час, " +
  "бачити заплановане по днях і видаляти зайві плани.\n\n" +
  "У кожної події є кольоровий кружечок для зручного візуального розділення.";

const COMMANDS_MESSAGE =
  "Список моїх команд:\n\n" +
  "/start – привітання і коротка інструкція.\n" +
  "/info – коротко про бота.\n" +
  "/commands – список усіх команд.\n" +
  "/plan – створити нову подію (назва, дата, час, колір).\n" +
  "/planstats – показати, що вже заплановано по днях.\n" +
  "/unplan – видалити одну або кілька подій.";

// 4 фіксованих кольори-кружечки (можна змінити, але порядок завжди однаковий)
const COLOR_OPTIONS = [
  { id: "red", label: "🔴 Червоний" },
  { id: "green", label: "🟢 Зелений" },
  { id: "blue", label: "🔵 Синій" },
  { id: "yellow", label: "🟡 Жовтий" },
];

const COLOR_ICON_BY_ID = {
  red: "🔴",
  green: "🟢",
  blue: "🔵",
  yellow: "🟡",
};

function formatPlanLine(plan) {
  const colorIcon = COLOR_ICON_BY_ID[plan.color] || "⚪️";
  return `${colorIcon} ${plan.time} – ${plan.title}`;
}

function formatPlansForDate(dateString, plans) {
  if (!plans.length) {
    return "На цю дату ще нічого не заплановано.";
  }
  const header = `Плани на ${dateString}:\n`;
  const body = plans.map((p, idx) => `${idx + 1}. ${formatPlanLine(p)}`).join("\n");
  return `${header}\n${body}`;
}

module.exports = {
  START_MESSAGE,
  INFO_MESSAGE,
  COMMANDS_MESSAGE,
  COLOR_OPTIONS,
  COLOR_ICON_BY_ID,
  formatPlanLine,
  formatPlansForDate,
};

