(function () {
  'use strict';
  function parameter(name) {
    var entries = location.search.substring(1).split('&');
    for (var i = 0; i < entries.length; i++) {
      var pair = entries[i].split('=');
      try {
        if (decodeURIComponent(pair[0]) === name) return decodeURIComponent(pair.slice(1).join('=').replace(/\+/g, ' '));
      } catch (ignored) { return null; }
    }
    return null;
  }
  function element(id) { return document.getElementById(id); }
  function stored(key, value) {
    try {
      if (value !== undefined) localStorage.setItem(key, value);
      return localStorage.getItem(key);
    } catch (ignored) { return null; }
  }
  function platform() {
    var agent = navigator.userAgent || '';
    if (/Android/i.test(agent)) return 'android';
    if (/iPhone|iPad|iPod/i.test(agent)) return 'ios';
    if (/Windows/i.test(agent)) return 'windows';
    if (/Macintosh/i.test(agent)) return 'macos';
    if (/Linux/i.test(agent)) return 'linux';
    return 'unknown';
  }
  var view = parameter('view') || (location.pathname.indexOf('tanks.html') >= 0 ? 'sidebar' : 'browser');
  if (!/^(hangar|battle|sidebar|browser)$/.test(view)) view = 'browser';
  document.body.className = view;
  var accountId = parameter('account_id');
  var realm = parameter('game_realm') || parameter('realm');
  // Explicit URL identity always wins. Storage is only a fallback, never proof of shared WebViews.
  if (accountId) {
    realm = realm || 'eu';
    stored('blitz-session-identity-v2', JSON.stringify({id: accountId, realm: realm}));
  } else {
    try {
      var saved = JSON.parse(stored('blitz-session-identity-v2') || 'null');
      if (saved) { accountId = saved.id; realm = saved.realm; }
    } catch (ignored) {}
  }
  var api = String(window.BLITZ_SESSION_API || '').replace(/\/+$/, '');
  var busy = false, timer = null, failures = 0, lastStarted = 0;
  var canReset = false;
  var interval = view === 'battle' ? 120000 : 30000;
  var allTanks = [];
  var demo = parameter('demo') === '1';

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
    if (line) { line.textContent = message; line.className = warning ? 'status warning' : 'status'; }
    // Compact widgets never grow or display error prose over game controls.
    document.body.title = message;
    var summary = element('summary');
    if (summary) summary.setAttribute('data-stale', warning ? 'true' : 'false');
  }
  function renderSummary(session) {
    if (!element('sessionBattles')) return;
    element('sessionBattles').textContent = String(session.battles);
    element('sessionWinRate').textContent = session.battles ? Number(session.win_rate).toFixed(1) + '%' : '—';
    element('sessionWinRate').className = rateClass(session.win_rate, session.battles);
    element('sessionAvgDamage').textContent = String(Math.round(session.avg_damage));
    // Large counters scale down instead of colliding with neighbouring cells.
    var values = [element('sessionBattles'), element('sessionWinRate'), element('sessionAvgDamage')];
    for (var i = 0; i < values.length; i++) {
      values[i].style.fontSize = '';
      var size = parseFloat(window.getComputedStyle(values[i]).fontSize);
      while (values[i].scrollWidth > values[i].clientWidth && size > 10) values[i].style.fontSize = (--size) + 'px';
    }
  }
  function cell(text, className) {
    var node = document.createElement('span'); node.className = className || ''; node.textContent = text; return node;
  }
  function battleLabel(count) {
    var lastTwo = count % 100, last = count % 10;
    return count + ' ' + (lastTwo >= 11 && lastTwo <= 14 ? 'боёв' : last === 1 ? 'бой' : last >= 2 && last <= 4 ? 'боя' : 'боёв');
  }
  function renderTanks() {
    var list = element('tankList');
    if (!list) return;
    list.innerHTML = '';
    if (!allTanks.length) list.appendChild(cell('После начала сессии ещё нет боёв.', 'empty'));
    for (var i = 0; i < allTanks.length; i++) {
      var tank = allTanks[i], row = document.createElement('article'); row.className = 'tank';
      row.appendChild(cell(tank.name || 'Танк ' + tank.tank_id, 'tank-name'));
      var stats = document.createElement('div'); stats.className = 'tank-stats';
      stats.appendChild(cell(battleLabel(tank.battles)));
      stats.appendChild(cell(Number(tank.win_rate).toFixed(1) + '%', rateClass(tank.win_rate, tank.battles)));
      stats.appendChild(cell(Math.round(tank.avg_damage) + ' урон'));
      row.appendChild(stats); list.appendChild(row);
    }
  }
  function identityQuery() {
    return 'account_id=' + encodeURIComponent(accountId) + '&game_realm=' + encodeURIComponent(realm || 'eu') +
      '&source=' + encodeURIComponent(parameter('source') || 'browser') + '&platform=' + platform() +
      '&mod_version=0.2&distribution=' + encodeURIComponent(parameter('distribution') || 'unknown');
  }
  function request(callback, reset) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, data, retryAfter) {
      if (finished) return;
      finished = true; callback(error, data, retryAfter || 0);
    }
    xhr.open(reset ? 'POST' : 'GET', api + (reset ? '/reset?' : '/session?') + identityQuery(), true);
    xhr.timeout = 25000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var retryAfter = Number(xhr.getResponseHeader('Retry-After') || 0) * 1000;
      if (xhr.status < 200 || xhr.status >= 300) {
        var serverCode = '';
        try { serverCode = JSON.parse(xhr.responseText).error || ''; } catch (ignored) {}
        finish('Нет обновления · HTTP ' + xhr.status + (serverCode ? ' · ' + serverCode : ''), null, retryAfter); return;
      }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (ignored) { finish('Некорректный ответ сервера'); return; }
      if (!data || data.status !== 'ok' || !data.session) { finish('Статистика временно недоступна'); return; }
      finish(null, data, retryAfter);
    };
    xhr.onerror = function () { finish('Нет соединения · повторим позже'); };
    xhr.ontimeout = function () { finish('Сервер не ответил · повторим позже'); };
    xhr.send(null);
  }
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  }
  function refresh(reset) {
    if (demo || busy || (reset && !canReset)) return;
    if (!accountId || !/^[1-9]\d{0,11}(?:\.0+)?$/.test(accountId) || !api) {
      status('Укажите ID аккаунта и регион. Для HUD доступна персональная сборка.', true); return;
    }
    if (document.hidden) { schedule(interval); return; }
    if (reset && !window.confirm('Сбросить общую сессию аккаунта на всех устройствах? История изменений сохранится.')) return;
    clearTimeout(timer);
    busy = true; lastStarted = Date.now();
    setResetEnabled(false);
    request(function (error, data, retryAfter) {
      busy = false;
      if (error) {
        canReset = false;
        failures++; status(reset ? 'Сброс не подтверждён · проверим сессию позже' : error, true);
        // A timed-out POST may have committed. Retry only GET, never reset automatically.
        schedule(Math.max(retryAfter, Math.min(300000, interval * Math.pow(2, Math.min(failures, 4)))) + Math.floor(Math.random() * 1500));
        return;
      }
      failures = data.stale ? Math.min(failures + 1, 3) : 0;
      canReset = view !== 'battle' && !data.stale && data.reset_available === true;
      setResetEnabled(canReset);
      renderSummary(data.session); allTanks = data.session.tanks || []; renderTanks();
      if (element('nickname')) element('nickname').textContent = data.nickname + ' · ' + String(data.realm).toUpperCase();
      status(data.stale ? 'Ожидаем согласованные данные · сохранена последняя сводка' : (reset ? 'Сессия сброшена · ' : 'Обновлено ') + new Date(data.snapshot_at || data.server_time).toLocaleTimeString(), Boolean(data.stale));
      schedule(Math.min(300000, interval * Math.pow(2, failures)) + Math.floor(Math.random() * 1500));
    }, reset);
  }
  if (element('resetButton')) element('resetButton').onclick = function () { refresh(true); };
  if (element('hangarResetButton')) element('hangarResetButton').onclick = function () { refresh(true); };
  if (element('accountForm')) {
    element('accountInput').value = accountId || '';
    element('realmInput').value = realm || 'eu';
    element('accountForm').onsubmit = function (event) {
      event.preventDefault();
      location.href = 'index.html?account_id=' + encodeURIComponent(element('accountInput').value.trim()) + '&game_realm=' + encodeURIComponent(element('realmInput').value);
    };
  }
  if (demo) {
    var sample = { battles: 19, win_rate: 63.1579, avg_damage: 2486, tanks: [] };
    var names = ['Super Conqueror', 'Pz.Kpfw. VI Ausf. B (H) Tiger II', 'AMX 50 B', 'Танк с длинным названием для проверки', 'T110E5', 'Leopard 1', 'Object 268'];
    for (var n = 0; n < names.length; n++) sample.tanks.push({ tank_id: n + 1, name: names[n], battles: n + 1, win_rate: [25, 45, 55, 65, 75, 50, 100][n], avg_damage: 2486 });
    var scenario = parameter('scenario');
    if (scenario === 'empty') sample = { battles: 0, win_rate: 0, avg_damage: 0, tanks: [] };
    if (scenario === 'large') { sample.battles = 1234567; sample.win_rate = 100; sample.avg_damage = 12345678; }
    renderSummary(sample); allTanks = sample.tanks; renderTanks();
    if (element('nickname')) element('nickname').textContent = 'Демонстрация · EU';
    status(scenario === 'offline' ? 'Нет соединения · сохранена последняя сводка' : 'Демонстрационные данные · запросы отключены', scenario === 'offline');
  } else refresh();
  if (window.addEventListener) {
    window.addEventListener('resize', renderTanks, false);
    function resume() {
      if (!document.hidden && !failures && Date.now() - lastStarted > (view === 'battle' ? interval : 20000)) { clearTimeout(timer); refresh(); }
    }
    window.addEventListener('focus', resume, false);
    window.addEventListener('pageshow', resume, false);
    document.addEventListener('visibilitychange', resume, false);
  }
})();
