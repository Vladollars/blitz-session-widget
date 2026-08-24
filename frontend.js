
(function () {
  var POLL_MS = 10000;

  function getParam(name) {
    var parts = window.location.search.substring(1).split("&");
    var i, pair;

    for (i = 0; i < parts.length; i++) {
      pair = parts[i].split("=");

      if (decodeURIComponent(pair[0] || "") === name) {
        return decodeURIComponent(
          (pair.slice(1).join("=") || "").replace(/\+/g, " ")
        );
      }
    }

    return null;
  }

  var accountId = getParam("account_id") || "573439188";
  var realm = (getParam("realm") || "eu").toLowerCase();
  var apiBase = String(window.BLITZ_SESSION_API || "").replace(/\/+$/, "");

  var errorLine = document.getElementById("errorLine");
  var busy = false;

  function showError(message) {
    if (!errorLine) return;

    errorLine.textContent = message;
    errorLine.className = "error-line visible";
  }

  function clearError() {
    if (!errorLine) return;

    errorLine.textContent = "";
    errorLine.className = "error-line";
  }

  function requireBackend() {
    if (
      !apiBase ||
      apiBase === "PASTE_WORKER_URL_HERE"
    ) {
      showError("BACKEND URL NOT SET");
      return false;
    }

    return true;
  }

  function request(method, path, done) {
    if (!requireBackend()) {
      done("BACKEND URL NOT SET", null);
      return;
    }

    var xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function () {
      var data;

      if (xhr.readyState !== 4) return;

      if (xhr.status < 200 || xhr.status >= 300) {
        done("Backend HTTP " + xhr.status, null);
        return;
      }

      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        done("Backend JSON parse error", null);
        return;
      }

      if (!data || data.status !== "ok") {
        done(data && data.error ? data.error : "Backend error", null);
        return;
      }

      done(null, data);
    };

    xhr.onerror = function () {
      done("Backend network error", null);
    };

    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var url = apiBase + path + sep + "_ts=" + new Date().getTime();

    xhr.open(method, url, true);
    xhr.send(null);
  }

  function sessionPath() {
    return "/session?account_id=" +
      encodeURIComponent(accountId) +
      "&realm=" +
      encodeURIComponent(realm);
  }

  function resetPath() {
    return "/reset?account_id=" +
      encodeURIComponent(accountId) +
      "&realm=" +
      encodeURIComponent(realm);
  }

  function renderSummary(session) {
    var battles = document.getElementById("sessionBattles");
    var wr = document.getElementById("sessionWinRate");
    var avg = document.getElementById("sessionAvgDamage");

    if (!battles) return;

    battles.textContent = String(session.battles || 0);
    wr.textContent = Number(session.win_rate || 0).toFixed(2) + "%";
    avg.textContent = String(Math.round(Number(session.avg_damage || 0)));
  }

  function renderTanks(tanks) {
    var list = document.getElementById("tankList");
    var i, tank, row, nameEl, values, j, cell, strong, span;

    if (!list) return;

    list.innerHTML = "";

    if (!tanks || !tanks.length) {
      row = document.createElement("div");
      row.className = "empty";
      row.textContent = "Пока нет боёв после точки отсчёта.";
      list.appendChild(row);
      return;
    }

    for (i = 0; i < tanks.length; i++) {
      tank = tanks[i];

      row = document.createElement("div");
      row.className = "tank";

      nameEl = document.createElement("div");
      nameEl.className = "tank-name";
      nameEl.textContent = tank.name || ("tank_id " + tank.tank_id);
      row.appendChild(nameEl);

      values = [
        [tank.battles, "BATTLES"],
        [Number(tank.win_rate || 0).toFixed(2) + "%", "WIN RATE"],
        [Math.round(Number(tank.avg_damage || 0)), "AVG DMG"]
      ];

      for (j = 0; j < values.length; j++) {
        cell = document.createElement("div");
        cell.className = "cell";

        strong = document.createElement("strong");
        strong.textContent = String(values[j][0]);

        span = document.createElement("span");
        span.textContent = values[j][1];

        cell.appendChild(strong);
        cell.appendChild(span);
        row.appendChild(cell);
      }

      list.appendChild(row);
    }
  }

  function refresh() {
    if (busy) return;
    if (!requireBackend()) return;

    busy = true;
    clearError();

    request("GET", sessionPath(), function (err, data) {
      busy = false;

      if (err) {
        showError(err);
        return;
      }

      renderSummary(data.session || {});
      renderTanks((data.session && data.session.tanks) || []);
    });
  }

  var resetButton = document.getElementById("resetButton");

  if (resetButton) {
    resetButton.onclick = function () {
      if (!requireBackend()) return;

      if (!window.confirm("Сбросить текущую сессию?")) {
        return;
      }

      clearError();

      request("POST", resetPath(), function (err) {
        if (err) {
          showError(err);
          return;
        }

        refresh();
      });
    };
  }

  refresh();
  window.setInterval(refresh, POLL_MS);

  if (window.addEventListener) {
    window.addEventListener("focus", refresh, false);
    window.addEventListener("pageshow", refresh, false);

    document.addEventListener(
      "visibilitychange",
      function () {
        if (!document.hidden) refresh();
      },
      false
    );
  }
}());
