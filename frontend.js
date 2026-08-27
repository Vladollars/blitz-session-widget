(function () {
  'use strict';

  function parameter(name) {
    var entries = location.search.substring(1).split('&');
    for (var i = 0; i < entries.length; i++) {
      var pair = entries[i].split('=');
      try {
        if (decodeURIComponent(pair[0] || '') === name) {
          return decodeURIComponent((pair.slice(1).join('=') || '').replace(/\+/g, ' '));
        }
      } catch (ignored) {}
    }
    return null;
  }

  function element(id) { return document.getElementById(id); }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (ignored) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (ignored) {}
  }

  function platform() {
    var agent = String(navigator.userAgent || '');
    var navPlatform = String(navigator.platform || '');
    if (/Android/i.test(agent)) return 'android';
    if (/iPhone|iPad|iPod/i.test(agent) || (navPlatform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1)) return 'ios';
    if (/Windows/i.test(agent) || /^Win/i.test(navPlatform)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(agent) || /^Mac/i.test(navPlatform)) return 'macos';
    if (/Linux/i.test(agent) || /Linux/i.test(navPlatform)) return 'linux';
    return 'unknown';
  }

  var view = parameter('view') || (location.pathname.indexOf('tanks.html') >= 0 ? 'sidebar' : 'browser');
  if (!/^(hangar|battle|sidebar|browser)$/.test(view)) view = 'browser';
  document.body.className = view;

  var accountId = parameter('account_id');
  var realm = parameter('game_realm') || parameter('realm');

  /* Keep both the new combined key and the old proven keys. Some Blitz WebViews
     are quirky about storage sharing, so the explicit URL always wins. */
  if (accountId) {
    realm = realm || 'eu';
    storageSet('blitz-session-identity-v2', JSON.stringify({ id: accountId, realm: realm }));
    storageSet('blitz-session-account-id', accountId);
    storageSet('blitz-session-game-realm', realm);
  } else {
    try {
      var saved = JSON.parse(storageGet('blitz-session-identity-v2') || 'null');
      if (saved) {
        accountId = saved.id || accountId;
        realm = saved.realm || realm;
      }
    } catch (ignored) {}
    if (!accountId) accountId = storageGet('blitz-session-account-id');
    if (!realm) realm = storageGet('blitz-session-game-realm');
  }

  var source = parameter('source') || (view === 'browser' ? 'browser' : 'blitz_mod');
  var modVersion = parameter('mod_version') || 'unknown';
  var distribution = parameter('distribution') || 'unknown';
  var api = String(window.BLITZ_SESSION_API || '').replace(/\/+$/, '');

  var busy = false;
  var timer = null;
  var failures = 0;
  var lastStarted = 0;
  var canReset = false;
  var interval = view === 'battle' ? 120000 : 30000;
  var allTanks = [];
  var demo = parameter('demo') === '1';

  function validIdentity() {
    // Let the Worker normalize Blitz/DAVA account_id formatting.
    // The proven v0.1.1 frontend only required a non-empty id.
    return Boolean(accountId && api);
  }

  function setResetEnabled(enabled) {
    var ids = ['resetButton', 'hangarResetButton'];
    for (var i = 0; i < ids.length; i++) {
      if (element(ids[i])) element(ids[i]).disabled = !enabled;
    }
  }

  function rateClass(rate, battles) {
    if (!battles) return 'rate-neutral';
    if (rate < 30) return 'rate-red';
    if (rate < 50) return 'rate-white';
    if (rate < 60) return 'rate-green';
    if (rate < 70) return 'rate-blue';
    return 'rate-purple';
  }

  function status(message, warning) {
    var line = element('errorLine');
    if (line) {
      line.textContent = message;
      line.className = warning ? 'status warning' : 'status';
    }
    document.body.title = message;
    var summary = element('summary');
    if (summary) summary.setAttribute('data-stale', warning ? 'true' : 'false');
  }

  function renderSummary(session) {
    if (!element('sessionBattles')) return;
    element('sessionBattles').textContent = String(Number(session.battles || 0));
    element('sessionWinRate').textContent = Number(session.battles || 0) ? Number(session.win_rate || 0).toFixed(1) + '%' : '—';
    element('sessionWinRate').className = rateClass(Number(session.win_rate || 0), Number(session.battles || 0));
    element('sessionAvgDamage').textContent = String(Math.round(Number(session.avg_damage || 0)));

    /* Optional cosmetic fitting. Never let it block the data path on older WebViews. */
    try {
      var values = [element('sessionBattles'), element('sessionWinRate'), element('sessionAvgDamage')];
      for (var i = 0; i < values.length; i++) {
        values[i].style.fontSize = '';
        var size = parseFloat(window.getComputedStyle(values[i]).fontSize);
        while (values[i].clientWidth > 0 && values[i].scrollWidth > values[i].clientWidth && size > 10) {
          size -= 1;
          values[i].style.fontSize = size + 'px';
        }
      }
    } catch (ignored) {}
  }

  function cell(text, className) {
    var node = document.createElement('span');
    node.className = className || '';
    node.textContent = text;
    return node;
  }

  function battleLabel(count) {
    var lastTwo = count % 100;
    var last = count % 10;
    return count + ' ' + (lastTwo >= 11 && lastTwo <= 14 ? 'боёв' : last === 1 ? 'бой' : last >= 2 && last <= 4 ? 'боя' : 'боёв');
  }

  function renderTanks() {
    var list = element('tankList');
    if (!list) return;
    list.innerHTML = '';
    if (!allTanks.length) list.appendChild(cell('После начала сессии ещё нет боёв.', 'empty'));
    for (var i = 0; i < allTanks.length; i++) {
      var tank = allTanks[i];
      var row = document.createElement('article');
      row.className = 'tank';
      row.appendChild(cell(tank.name || 'Танк ' + tank.tank_id, 'tank-name'));
      var stats = document.createElement('div');
      stats.className = 'tank-stats';
      stats.appendChild(cell(battleLabel(Number(tank.battles || 0))));
      stats.appendChild(cell(Number(tank.win_rate || 0).toFixed(1) + '%', rateClass(Number(tank.win_rate || 0), Number(tank.battles || 0))));
      stats.appendChild(cell(Math.round(Number(tank.avg_damage || 0)) + ' урон'));
      row.appendChild(stats);
      list.appendChild(row);
    }
  }

  function identityQuery() {
    return 'account_id=' + encodeURIComponent(accountId) +
      '&game_realm=' + encodeURIComponent(realm || 'eu') +
      '&source=' + encodeURIComponent(source) +
      '&platform=' + encodeURIComponent(platform()) +
      '&mod_version=' + encodeURIComponent(modVersion) +
      '&distribution=' + encodeURIComponent(distribution) +
      '&_ts=' + Date.now();
  }

  function request(method, path, callback) {
    var xhr = new XMLHttpRequest();
    var finished = false;

    function finish(error, data, retryAfter) {
      if (finished) return;
      finished = true;
      callback(error, data, retryAfter || 0);
    }

    xhr.open(method, api + path + identityQuery(), true);
    xhr.timeout = 25000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var retryAfter = Number(xhr.getResponseHeader('Retry-After') || 0) * 1000;
      if (xhr.status < 200 || xhr.status >= 300) {
        var serverCode = '';
        try { serverCode = JSON.parse(xhr.responseText).error || ''; } catch (ignored) {}
        finish('Нет обновления · HTTP ' + xhr.status + (serverCode ? ' · ' + serverCode : ''), null, retryAfter);
        return;
      }
      var data;
      try { data = JSON.parse(xhr.responseText); }
      catch (ignored) { finish('Некорректный ответ сервера'); return; }
      if (!data || data.status !== 'ok') {
        finish(data && data.error ? data.error : 'Статистика временно недоступна');
        return;
      }
      finish(null, data, retryAfter);
    };
    xhr.onerror = function () { finish('Нет соединения · повторим позже'); };
    xhr.ontimeout = function () { finish('Сервер не ответил · повторим позже'); };
    xhr.send(null);
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () { refresh(false); }, delay);
  }

  function loadSession(afterReset) {
    request('GET', '/session?', function (error, data, retryAfter) {
      busy = false;
      if (error || !data || !data.session) {
        canReset = false;
        setResetEnabled(false);
        failures += 1;
        status(error || 'Статистика временно недоступна', true);
        schedule(Math.max(retryAfter, Math.min(300000, interval * Math.pow(2, Math.min(failures, 4)))) + Math.floor(Math.random() * 1500));
        return;
      }

      failures = data.stale ? Math.min(failures + 1, 3) : 0;
      /* v0.1.1 backend has no reset_available field. Missing therefore means allowed. */
      canReset = view !== 'battle' && !data.stale && data.reset_available !== false;
      setResetEnabled(canReset);
      renderSummary(data.session);
      allTanks = data.session.tanks || [];
      renderTanks();
      if (element('nickname')) element('nickname').textContent = String(data.nickname || accountId) + ' · ' + String(data.realm || realm || 'eu').toUpperCase();
      status(data.stale ? 'Ожидаем согласованные данные · сохранена последняя сводка' : (afterReset ? 'Сессия сброшена · ' : 'Обновлено ') + new Date(Number(data.snapshot_at || data.server_time || Date.now())).toLocaleTimeString(), Boolean(data.stale));
      schedule(Math.min(300000, interval * Math.pow(2, failures)) + Math.floor(Math.random() * 1500));
    });
  }

  function refresh(reset) {
    if (demo || busy || (reset && !canReset)) return;
    if (!validIdentity()) {
      status('Укажите ID аккаунта и регион.', true);
      return;
    }

    /* Do NOT gate requests on document.hidden. DAVA/Blitz WebViews may report
       themselves hidden while still being visible inside the game UI. */
    clearTimeout(timer);
    busy = true;
    lastStarted = Date.now();
    setResetEnabled(false);

    if (reset) {
      if (!window.confirm('Сбросить общую сессию аккаунта на всех устройствах?')) {
        busy = false;
        setResetEnabled(canReset);
        schedule(interval);
        return;
      }
      request('POST', '/reset?', function (error) {
        if (error) {
          busy = false;
          canReset = false;
          setResetEnabled(false);
          failures += 1;
          status('Сброс не подтверждён · ' + error, true);
          schedule(Math.min(300000, interval * Math.pow(2, Math.min(failures, 4))));
          return;
        }
        /* v0.1.1 reset response intentionally has no session object. Fetch it now. */
        loadSession(true);
      });
      return;
    }

    loadSession(false);
  }

  if (element('resetButton')) element('resetButton').onclick = function () { refresh(true); };
  if (element('hangarResetButton')) element('hangarResetButton').onclick = function () { refresh(true); };

  if (element('accountForm')) {
    element('accountInput').value = accountId || '';
    element('realmInput').value = realm || 'eu';
    element('accountForm').onsubmit = function (event) {
      event.preventDefault();
      location.href = 'index.html?account_id=' + encodeURIComponent(element('accountInput').value.replace(/^\s+|\s+$/g, '')) + '&game_realm=' + encodeURIComponent(element('realmInput').value);
    };
  }

  if (demo) {
    var sample = { battles: 19, win_rate: 63.1579, avg_damage: 2486, tanks: [] };
    var names = ['Super Conqueror', 'Pz.Kpfw. VI Ausf. B (H) Tiger II', 'AMX 50 B', 'Танк с длинным названием для проверки', 'T110E5', 'Leopard 1', 'Object 268'];
    for (var n = 0; n < names.length; n++) sample.tanks.push({ tank_id: n + 1, name: names[n], battles: n + 1, win_rate: [25, 45, 55, 65, 75, 50, 100][n], avg_damage: 2486 });
    var scenario = parameter('scenario');
    if (scenario === 'empty') sample = { battles: 0, win_rate: 0, avg_damage: 0, tanks: [] };
    if (scenario === 'large') { sample.battles = 1234567; sample.win_rate = 100; sample.avg_damage = 12345678; }
    renderSummary(sample);
    allTanks = sample.tanks;
    renderTanks();
    if (element('nickname')) element('nickname').textContent = 'Демонстрация · EU';
    status(scenario === 'offline' ? 'Нет соединения · сохранена последняя сводка' : 'Демонстрационные данные · запросы отключены', scenario === 'offline');
  } else {
    refresh(false);
  }

  if (window.addEventListener) {
    window.addEventListener('resize', renderTanks, false);
    function resume() {
      if (!failures && Date.now() - lastStarted > (view === 'battle' ? interval : 20000)) {
        clearTimeout(timer);
        refresh(false);
      }
    }
    window.addEventListener('focus', resume, false);
    window.addEventListener('pageshow', resume, false);
    document.addEventListener('visibilitychange', function () {
      /* visibilitychange is only a hint; never use document.hidden as a hard block. */
      if (!document.hidden) resume();
    }, false);
  }
})();
