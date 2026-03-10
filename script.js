const fs = require("node:fs/promises");
const path = require("node:path");

const PARIS_TIMEZONE = "Europe/Paris";
const STATE_FILE_PATH = path.join(
  process.cwd(),
  ".cache",
  "weather_state.json"
);
const NUM_OF_DAYS_TO_PROCESS = 1;

function getParisDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function getParisHour(now = new Date()) {
  const hourString = new Intl.DateTimeFormat("en-GB", {
    timeZone: PARIS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(hourString);
}

function isWithinParisWindow(now = new Date()) {
  const hour = getParisHour(now);
  return hour >= 8 && hour <= 22;
}

function getRegions() {
  return [
    { id: "PARIS", name: "PARIS", geocode: "49.017,2.594" },
    { id: "LONDON", name: "LONDON", geocode: "51.51,0.028" },
  ];
}

function extractTodayMaxInfo(payload) {
  const dayOfWeek = payload.dayOfWeek;
  const temperature = payload.temperature;

  if (!Array.isArray(dayOfWeek) || !Array.isArray(temperature)) {
    throw new Error(
      "Weather API payload missing dayOfWeek or temperature arrays."
    );
  }

  let differentDays = 0;
  let currentDay;
  const regionInfo = {};

  for (let i = 0; i < dayOfWeek.length; i++) {
    if (currentDay !== dayOfWeek[i]) {
      differentDays++;
      currentDay = dayOfWeek[i];
    }

    if (differentDays > NUM_OF_DAYS_TO_PROCESS) break;

    if (typeof temperature[i] !== "number" || Number.isNaN(temperature[i])) {
      continue;
    }

    if (!regionInfo[dayOfWeek[i]]) {
      regionInfo[dayOfWeek[i]] = { maxTemp: temperature[i], maxTempCount: 1 };
      continue;
    }

    if (regionInfo[dayOfWeek[i]].maxTemp > temperature[i]) continue;

    if (regionInfo[dayOfWeek[i]].maxTemp === temperature[i]) {
      regionInfo[dayOfWeek[i]].maxTempCount += 1;
      continue;
    }

    regionInfo[dayOfWeek[i]].maxTempCount = 1;
    regionInfo[dayOfWeek[i]].maxTemp = temperature[i];
  }

  if (Object.keys(regionInfo).length === 0) {
    throw new Error("No valid temperatures found for first 2 forecast days.");
  }

  return regionInfo;
}

function diffRegionState(previous, current) {
  const diff = [];

  const previousDays = previous || {};
  const currentDays = current || {};

  Object.entries(currentDays).forEach(([day, info]) => {
    if (!previousDays[day]) {
      diff.push({
        shouldNotify: true,
        reason: "first_run_of_day",
        day,
        max: info.maxTemp,
        freq: info.maxTempCount,
      });
      return;
    }

    const previousInfo = previousDays[day];

    if (previousInfo.maxTemp !== info.maxTemp) {
      diff.push({
        shouldNotify: true,
        reason: "new_max",
        day,
        max: info.maxTemp,
        oldMax: previousInfo.maxTemp,
        freq: info.maxTempCount,
      });
      return;
    }

    if (previousInfo.maxTempCount !== info.maxTempCount) {
      diff.push({
        shouldNotify: true,
        reason: "change_in_freq",
        day,
        max: info.maxTemp,
        oldFreq: previousInfo.maxTempCount,
        freq: info.maxTempCount,
      });
      return;
    }

    diff.push({ shouldNotify: false, reason: "no_change", day });
  });

  return diff;
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true });
  await fs.writeFile(
    STATE_FILE_PATH,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

const showDecimals = true;
const WEATHER_URL = showDecimals
  ? "https://api.weather.com/v3/wx/forecast/hourly/1day/enterprise"
  : "https://api.weather.com/v3/wx/forecast/hourly/2day";

async function fetchRegionForecast(geocode) {
  const params = new URLSearchParams({
    apiKey: "e1f10a1e78da46f5b10a1e78da96f525",
    geocode,
    units: "m",
    language: "en-US",
    format: "json",
  });

  const response = await fetch(`${WEATHER_URL}?${params.toString()}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Weather API request failed (${response.status}): ${body.slice(0, 200)}`
    );
  }

  return response.json();
}

function formatEmailBody({ updates, failures }) {
  const lines = [];

  if (updates.length > 0) {
    lines.push("Changed regions:");

    for (const update of updates) {
      if (update.reason === "first_run_of_day") {
        lines.push(
          `  First search MAX: ${update.max}º FREQ: ${update.freq} for ${update.region} on ${update.day}`
        );
      }
      if (update.reason === "new_max") {
        lines.push(
          `  NEW MAX: ${update.oldMax}->${update.max}º with freq: ${update.freq} for ${update.region} on ${update.day}`
        );
      }
      if (update.reason === "change_in_freq") {
        lines.push(
          `  CHANGE IN FREQ: ${update.oldFreq}->${update.freq} with max: ${update.max}º for ${update.region} on ${update.day}`
        );
      }
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("Region fetch/parse failures:");
    for (const failure of failures) {
      lines.push(`- ${failure.region}: ${failure.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendGmailMessage({
  clientId,
  clientSecret,
  refreshToken,
  sender,
  recipient,
  subject,
  body,
}) {
  const { google } = require("googleapis");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.getAccessToken();

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const message = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: toBase64Url(message),
    },
  });
}

function validateEnv(env) {
  const required = [
    "WEATHER_API_KEY",
    "REGIONS_JSON",
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "GMAIL_SENDER",
    "ALERT_RECIPIENT",
  ];

  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

async function main() {
  //validateEnv(process.env);

  if (!isWithinParisWindow()) {
    console.log("Outside run window (08:00-17:59 Europe/Paris). Exiting.");
    return;
  }

  const regions = getRegions();

  const previousState = await loadState();
  const nextState = { ...previousState };

  const updates = [];
  const failures = [];
  let successCount = 0;
  for (const region of regions) {
    try {
      const payload = await fetchRegionForecast(region.geocode);
      const current = extractTodayMaxInfo(payload);
      const previous = previousState[region.id]?.days;
      const diff = diffRegionState(previous, current);

      nextState[region.id] = {
        days: current,
        updatedAt: new Date().toISOString(),
      };

      diff.forEach((difference) => {
        if (difference.shouldNotify) {
          updates.push({
            region: region.id,
            day: difference.day,
            reason: difference.reason,
            freq: difference.freq,
            oldFreq: difference.oldFreq,
            oldMax: difference.oldMax,
            max: difference.max,
          });
        }
      });

      successCount += 1;
    } catch (error) {
      failures.push({
        region: region.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (successCount === 0) {
    throw new Error("All configured regions failed. Aborting run.");
  }

  if (updates.length > 0) {
    const subject = `[UPDATE] ${updates.length} region(s) updated`;
    const body = formatEmailBody({ updates, failures });

    await sendGmailMessage({
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      sender: process.env.GMAIL_SENDER,
      recipient: process.env.ALERT_RECIPIENT,
      subject,
      body,
    });

    console.log(`Email sent for ${updates.length} region update(s).`);
  } else {
    console.log("No changes detected. Email not sent.");
    if (failures.length > 0) {
      console.log(`There were ${failures.length} failed region(s):`);
      for (const failure of failures) {
        console.log(`- ${failure.region.id}: ${failure.error}`);
      }
    }
  }

  await saveState(nextState);
  console.log(`State saved to ${STATE_FILE_PATH}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  PARIS_TIMEZONE,
  STATE_FILE_PATH,
  getParisDate,
  isWithinParisWindow,
  getRegions,
  extractTodayMaxInfo,
  diffRegionState,
  formatEmailBody,
  toBase64Url,
};
