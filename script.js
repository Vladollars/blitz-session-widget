/*
  Blitz Session Widget v3

  Separate pages:
    summary.html -> total session stats
    tanks.html   -> tank list

  The baseline is shared through localStorage on the same GitHub Pages origin.
*/

const DEFAULT_APPLICATION_ID = "153a89caee08c947220e21a5a91f13bb";
const DEFAULT_ACCOUNT_ID = "599644675";
const POLL_INTERVAL_MS = 15_000;

const params = new URLSearchParams(location.search);
const uiMode = document.documentElement.dataset.ui || "summary";
const viewMode = (params.get("view") || "hangar").toLowerCase();

document.body.dataset.view = viewMode;

const paramAccountId = params.get("account_id");
const paramRealm = params.get("realm");

if (paramAccountId) localStorage.setItem("blitz-last-account-id", paramAccountId);
if (paramRealm) localStorage.setItem("blitz-last-realm", paramRealm.toLowerCase());

const accountId =
  paramAccountId ||
  localStorage.getItem("blitz-last-account-id") ||
  DEFAULT_ACCOUNT_ID;

const realm =
  (paramRealm ||
   localStorage.getItem("blitz-last-realm") ||
   "eu").toLowerCase();

const applicationId =
  params.get("application_id") ||
  DEFAULT_APPLICATION_ID;

const API_HOSTS = {
  eu: "https://api.wotblitz.eu",
  ru: "https://api.wotblitz.ru",
  na: "https://api.wotblitz.com",
  asia: "https://api.wotblitz.asia"
};

const apiHost = API_HOSTS[realm] || API_HOSTS.eu;
const baselineKey = `blitz-session-baseline:${realm}:${accountId}`;
const tankNameCacheKey = "blitz-session-tank-names:v1";

const el = {
  sessionBattles: document.getElementById("sessionBattles"),
  sessionWinRate: document.getElementById("sessionWinRate"),
  sessionAvgDamage: document.getElementById("sessionAvgDamage"),
  resetButton: document.getElementById("resetButton"),
  tankList: document.getElementById("tankList"),
  errorLine: document.getElementById("errorLine")
};

function apiUrl(path, extra = {}) {
  const url = new URL(path, apiHost);
  url.searchParams.set("application_id", applicationId);

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  // Different request URL each time so embedded WebViews cannot hand us
  // a stale API response from their own cache.
  url.searchParams.set("_ts", Date.now());

  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.status !== "ok") {
    throw new Error(
      json.error?.message ||
      json.error?.code ||
      "WG API error"
    );
  }

  return json;
}

async function loadAccountStats() {
  const json = await fetchJson(
    apiUrl("/wotb/account/info/", {
      account_id: accountId,
      fields: "nickname,statistics.all.battles,statistics.all.wins,statistics.all.damage_dealt"
    })
  );

  const account = json.data?.[accountId];

  if (!account) {
    throw new Error("Аккаунт не найден");
  }

  const all = account.statistics?.all || {};

  return {
    nickname: account.nickname || String(accountId),
    battles: Number(all.battles || 0),
    wins: Number(all.wins || 0),
    damage: Number(all.damage_dealt || 0)
  };
}

async function loadTankStats() {
  const json = await fetchJson(
    apiUrl("/wotb/tanks/stats/", {
      account_id: accountId,
      fields: "tank_id,all.battles,all.wins,all.damage_dealt"
    })
  );

  const rows = json.data?.[accountId] || [];
  const result = {};

  for (const row of rows) {
    const all = row.all || {};

    result[String(row.tank_id)] = {
      battles: Number(all.battles || 0),
      wins: Number(all.wins || 0),
      damage: Number(all.damage_dealt || 0)
    };
  }

  return result;
}

function loadBaseline() {
  try {
    const raw = localStorage.getItem(baselineKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBaseline(snapshot) {
  localStorage.setItem(baselineKey, JSON.stringify(snapshot));
}

function loadTankNameCache() {
  try {
    return JSON.parse(localStorage.getItem(tankNameCacheKey) || "{}");
  } catch {
    return {};
  }
}

function saveTankNameCache(cache) {
  localStorage.setItem(tankNameCacheKey, JSON.stringify(cache));
}

async function resolveTankNames(tankIds) {
  const cache = loadTankNameCache();
  const missing = tankIds.filter(id => !cache[id]);
  const chunkSize = 50;

  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);

    const json = await fetchJson(
      apiUrl("/wotb/encyclopedia/vehicles/", {
        tank_id: chunk.join(","),
        fields: "tank_id,name,tier,type,nation"
      })
    );

    for (const [tankId, tank] of Object.entries(json.data || {})) {
      if (tank) {
        cache[tankId] = {
          name: tank.name || `Tank ${tankId}`,
          tier: tank.tier || null,
          type: tank.type || null,
          nation: tank.nation || null
        };
      }
    }
  }

  saveTankNameCache(cache);
  return cache;
}

function diffNumber(current, baseline) {
  return Math.max(
    0,
    Number(current || 0) - Number(baseline || 0)
  );
}

function calculateSession(current, baseline) {
  const summary = {
    battles: diffNumber(current.account.battles, baseline.account.battles),
    wins: diffNumber(current.account.wins, baseline.account.wins),
    damage: diffNumber(current.account.damage, baseline.account.damage)
  };

  const tanks = [];

  for (const [tankId, now] of Object.entries(current.tanks)) {
    const before = baseline.tanks[tankId] || {
      battles: 0,
      wins: 0,
      damage: 0
    };

    const battles = diffNumber(now.battles, before.battles);

    if (battles <= 0) continue;

    const wins = diffNumber(now.wins, before.wins);
    const damage = diffNumber(now.damage, before.damage);

    tanks.push({
      tankId,
      battles,
      wins,
      damage,
      winRate: (wins / battles) * 100,
      avgDamage: damage / battles
    });
  }

  tanks.sort((a, b) => b.battles - a.battles);

  return { summary, tanks };
}

function renderSummary(summary) {
  if (!el.sessionBattles) return;

  const wr = summary.battles
    ? (summary.wins / summary.battles) * 100
    : 0;

  const avg = summary.battles
    ? summary.damage / summary.battles
    : 0;

  el.sessionBattles.textContent = summary.battles;
  el.sessionWinRate.textContent = `${wr.toFixed(2)}%`;
  el.sessionAvgDamage.textContent = Math.round(avg);
}

function renderTankList(tanks, names) {
  if (!el.tankList) return;

  if (!tanks.length) {
    el.tankList.innerHTML =
      '<div class="empty">Пока нет боёв после точки отсчёта.</div>';
    return;
  }

  el.tankList.innerHTML = "";

  for (const tank of tanks) {
    const displayName =
      names[tank.tankId]?.name ||
      `tank_id ${tank.tankId}`;

    const row = document.createElement("div");
    row.className = "tank";

    const name = document.createElement("div");
    name.className = "tank-name";
    name.textContent = displayName;
    name.title = displayName;

    const cells = [
      [tank.battles, "BATTLES"],
      [`${tank.winRate.toFixed(2)}%`, "WIN RATE"],
      [Math.round(tank.avgDamage), "AVG DMG"]
    ];

    row.appendChild(name);

    for (const [value, label] of cells) {
      const cell = document.createElement("div");
      cell.className = "cell";

      const strong = document.createElement("strong");
      strong.textContent = value;

      const span = document.createElement("span");
      span.textContent = label;

      cell.append(strong, span);
      row.appendChild(cell);
    }

    el.tankList.appendChild(row);
  }
}

function showError(message) {
  if (!el.errorLine) return;
  el.errorLine.textContent = message;
  el.errorLine.classList.add("visible");
}

function clearError() {
  if (!el.errorLine) return;
  el.errorLine.textContent = "";
  el.errorLine.classList.remove("visible");
}

async function takeSnapshot() {
  const [account, tanks] = await Promise.all([
    loadAccountStats(),
    loadTankStats()
  ]);

  return {
    createdAt: Date.now(),
    account,
    tanks
  };
}

let refreshInProgress = false;

async function refresh() {
  if (refreshInProgress) return;

  refreshInProgress = true;

  try {
    clearError();

    const current = await takeSnapshot();

    let baseline = loadBaseline();

    if (!baseline) {
      saveBaseline(current);
      baseline = current;
    }

    const session = calculateSession(current, baseline);

    renderSummary(session.summary);

    let names = loadTankNameCache();

    if (uiMode === "tanks" && session.tanks.length) {
      try {
        names = await resolveTankNames(
          session.tanks.map(t => t.tankId)
        );
      } catch (error) {
        console.warn("Tank names:", error);
      }
    }

    renderTankList(session.tanks, names);

    console.log(
      `[BlitzSession] ${new Date().toLocaleTimeString()} ` +
      `battles=${session.summary.battles}`
    );
  } catch (error) {
    console.error(error);
    showError(`Ошибка: ${error.message}`);
  } finally {
    refreshInProgress = false;
  }
}

if (el.resetButton) {
  el.resetButton.addEventListener("click", async () => {
    if (!confirm("Сбросить текущую сессию?")) return;

    try {
      clearError();
      saveBaseline(await takeSnapshot());
      await refresh();
    } catch (error) {
      showError(`Ошибка сброса: ${error.message}`);
    }
  });
}

/* Embedded WebViews do not always behave nicely with background timers.
   Refresh both on a timer and whenever the view becomes active again. */
refresh();

setTimeout(refresh, 3_000);
setInterval(refresh, POLL_INTERVAL_MS);

window.addEventListener("focus", refresh);
window.addEventListener("pageshow", refresh);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
