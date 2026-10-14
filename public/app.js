'use strict';

const STATUS_INTERVAL = 5_000; // live status, same cadence as the original page
const PAGE_INTERVAL = 10 * 60_000; // weather and forecast only change hourly
const DEMO = new URLSearchParams(location.search).has('demo');

const $ = (id) => document.getElementById(id);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child != null));
  return node;
}

const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
const fact = (term, value, tone) => el('div', {}, el('dt', { text: term }), el('dd', tone ? { text: value, 'data-tone': tone } : { text: value }));

const ICONS = {
  watering: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.500c-3.200 4.100-6 7.300-6 10.800a6 6 0 0 0 12 0c0-3.500-2.800-6.700-6-10.800z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15a4 4 0 0 1 .5-8 5.500 5.500 0 0 1 10.600 1.500A3.500 3.500 0 0 1 17.500 15z"/><path d="M8.500 18.500l-.8 2M12.500 18.500l-.8 2M16.500 18.500l-.8 2"/></svg>',
  idle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>',
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>',
};

// ---------- parsing: /FS/RAM0/status.xml ----------

function parseStatus(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('status.xml could not be parsed');
  const read = (parent, tag) => clean(parent.getElementsByTagName(tag)[0]?.textContent);
  const status = doc.getElementsByTagName('STATUS')[0] || doc.documentElement;

  return {
    date: read(status, 'DATE'),
    sun: read(status, 'SUNDATA'),
    cloud: read(status, 'CLOUDSTAT'),
    uptime: read(status, 'CPUTIME'),
    rainDelay: read(status, 'RAINDELAY'),
    stations: [...doc.getElementsByTagName('STATION')].map((s) => ({
      number: read(s, 'NUMBER'),
      description: read(s, 'DESCRIPTION'),
      remaining: read(s, 'TIMEREMAINING'),
      mode: read(s, 'MODE'),
      program: read(s, 'PROGRAMNUM'),
    })),
    insteon: [...doc.getElementsByTagName('INSTEON')].map((d) => ({
      device: read(d, 'DEVICE'),
      state: read(d, 'STATE'),
      setValue: read(d, 'SETVALUE'),
      mode: read(d, 'MODE'),
      program: read(d, 'PROGRAMNUM'),
    })),
  };
}

// ---------- parsing: the controller's own index.htm ----------
// Weather, forecast, and network details are only available as markup in the
// original status page, so they are read out of it.

function parsePage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  const headed = (pattern) =>
    tables.find((t) => !t.querySelector('table') && [...t.querySelectorAll('th')].some((th) => pattern.test(clean(th.textContent))));
  const bodyRows = (table) =>
    [...(table?.querySelectorAll('tr') || [])]
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => clean(td.textContent)))
      .filter((cells) => cells.length >= 3);

  // Current conditions: one cell, one "Label: value" per <br>-separated line.
  const wxCell = headed(/current weather/i)?.querySelector('td');
  let weather = null;
  if (wxCell) {
    const holder = wxCell.cloneNode(true);
    holder.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const lines = holder.textContent.split('\n').map(clean).filter(Boolean);
    const fields = {};
    for (const line of lines) {
      const match = line.match(/^([A-Za-z() ]+?):\s*(.+)$/);
      if (match) fields[match[1].toLowerCase()] = match[2].replace(/:0$/, '');
    }
    weather = { station: lines[0] || '', observed: lines[1] || '', fields };
  }

  const days = new Map();
  const day = (name) => days.get(name) || days.set(name, { name }).get(name);
  for (const [name, dayPop, nightPop] of bodyRows(headed(/night/i))) Object.assign(day(name), { dayPop, nightPop });
  for (const [name, high, low] of bodyRows(headed(/high temp/i))) Object.assign(day(name), { high, low });

  const text = clean(doc.body.textContent);
  const adjust = text.match(/A (\d+)% (\w+) will be applied to watering times today/i);

  // Network block: label cell, spacer, value cell; continuation rows have a blank label.
  const network = {};
  let label = '';
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD');
    if (cells.length !== 3 || cells.some((c) => c.querySelector('table'))) continue;
    const [first, , last] = cells.map((c) => clean(c.textContent));
    if (/:$/.test(first)) label = first.slice(0, -1);
    if (label && last && /^(MAC|IPv4|IPv6)/.test(label)) (network[label] ||= []).push(last);
  }

  const noaa = [...doc.querySelectorAll('a')].find((a) => /NOAA Local Weather Map/i.test(a.textContent))?.getAttribute('href');

  return {
    site: clean(doc.querySelector('td.PAGEHEADER font')?.textContent),
    weather,
    forecast: [...days.values()],
    adjust: adjust ? { percent: adjust[1], direction: adjust[2].toLowerCase() } : null,
    network,
    noaa: /^https?:/i.test(noaa || '') ? noaa : '',
  };
}

// ---------- rendering ----------

const state = { status: null, page: null, device: '' };

const hasData = (value) => value && !/^no data$/i.test(value);
const minutesOfDay = (text) => {
  const m = (text || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
};

function renderHero(status) {
  const rainActive = /rain delay/i.test(status.rainDelay) && !/\b(no|not|inactive|off)\b/i.test(status.rainDelay);
  let key, title, detail;

  if (status.stations.length) {
    key = 'watering';
    title = status.stations.length === 1 ? 'Watering 1 station' : `Watering ${status.stations.length} stations`;
    detail = status.stations.map((s) => s.description || `Station ${s.number}`).join(', ');
  } else if (rainActive) {
    const hours = status.rainDelay.match(/(\d+)\s*hours?\s*remaining/i);
    key = 'rain';
    title = 'Rain delay active';
    detail = hours ? `Watering resumes in about ${hours[1]} hour${hours[1] === '1' ? '' : 's'}` : status.rainDelay.replace(/\*/g, '').trim();
  } else {
    key = 'idle';
    title = 'Nothing is watering';
    detail = status.rainDelay.replace(/\*/g, '').trim() || 'No stations are running right now';
  }

  $('hero').dataset.state = key;
  $('heroIcon').innerHTML = ICONS[key];
  $('heroTitle').textContent = title;
  $('heroDetail').textContent = detail;
  $('clock').textContent = status.date || '—';
}

function renderRows(target, countEl, items, toRow, emptyText) {
  countEl.textContent = items.length ? String(items.length) : '';
  target.replaceChildren(...(items.length ? items.map(toRow) : [el('p', { class: 'empty', text: emptyText })]));
}

const metaLine = (item) => [item.mode, item.program && `Program ${item.program}`].filter(Boolean).join(' · ');

function renderStatus(status) {
  renderHero(status);

  renderRows(
    $('stations'),
    $('stationCount'),
    status.stations,
    (s) =>
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'row-badge', text: s.number || '–' }),
        el('div', { class: 'row-main' }, el('div', { class: 'row-title', text: s.description || `Station ${s.number}` }), el('div', { class: 'row-meta', text: metaLine(s) })),
        el('div', { class: 'row-value', text: s.remaining || '—' }, el('small', { text: 'remaining' })),
      ),
    'No watering stations are active.',
  );

  renderRows(
    $('insteon'),
    $('insteonCount'),
    status.insteon,
    (d) =>
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'row-main' }, el('div', { class: 'row-title', text: d.device || 'Insteon device' }), el('div', { class: 'row-meta', text: metaLine(d) })),
        el('div', { class: 'row-value', text: d.state || '—' }, d.setValue ? el('small', { text: `set ${d.setValue}` }) : null),
      ),
    'No Insteon devices are active.',
  );

  const [, rise = '', set = ''] = status.sun.match(/Sunrise\s*(.+?)\s*-\s*Sunset\s*(.+)/i) || [];
  $('sunrise').textContent = rise || '—';
  $('sunset').textContent = set || '—';
  const [riseMin, setMin, nowMin] = [rise, set, status.date].map(minutesOfDay);
  const track = $('sunTrack');
  track.hidden = riseMin == null || setMin == null || nowMin == null || setMin <= riseMin;
  if (!track.hidden) {
    const daylight = nowMin >= riseMin && nowMin <= setMin;
    track.classList.toggle('night', !daylight);
    $('sunDot').style.left = `${((nowMin - riseMin) / (setMin - riseMin)) * 100}%`;
  }

  renderSystem();
}

function renderSystem() {
  const { status, page } = state;
  const items = [];
  if (status) {
    const cloud = status.cloud.split(':').pop().trim();
    const uptime = status.uptime.replace(/\s*\d+\s*seconds?/i, '').trim() || status.uptime;
    if (uptime) items.push(fact('Uptime', uptime));
    if (cloud) items.push(fact('Cloud connection', cloud, /^connected/i.test(cloud) ? 'good' : 'bad'));
  }
  for (const [label, values] of Object.entries(page?.network || {})) items.push(fact(label.replace(/es$/, ''), values.join(', ')));
  $('system').replaceChildren(...items.flat());
}

function renderPage(page) {
  $('siteName').textContent = page.site || ' ';
  if (!$('statusView').hidden) document.title = page.site ? `${page.site} · HydroFLASH` : 'HydroFLASH';

  // Weather
  const wx = page.weather;
  if (wx) {
    const f = wx.fields;
    const temp = (f.temperature || '').match(/(-?\d+)\s*F/);
    const details = [
      ['Wind', f.wind],
      ['Humidity', f['relative humidity']],
      ['Dew point', f['dew point']],
      ['Visibility', f.visibility],
      ['Pressure', f['pressure (altimeter)']],
    ].filter(([, value]) => value);
    const metar = (f.ob || '').split(' ')[0];
    const station = /not available/i.test(wx.station) ? metar : wx.station;
    $('weather').replaceChildren(
      el(
        'div',
        { class: 'wx-now' },
        el('div', { class: 'wx-temp', text: temp ? `${temp[1]}°F` : f.temperature || '—' }),
        el('div', {}, el('div', { class: 'wx-sky', text: f['sky conditions'] || f.weather || '' }), temp ? el('div', { class: 'muted', text: f.temperature }) : null),
      ),
      el('dl', { class: 'facts' }, ...details.flatMap(([term, value]) => fact(term, value))),
      el('p', { class: 'wx-foot', text: [station && `Station ${station}`, wx.observed].filter(Boolean).join(' · ') }),
    );
  } else {
    $('weather').replaceChildren(el('p', { class: 'empty', text: 'The controller has no current weather report.' }));
  }

  // Forecast
  const days = page.forecast.filter((d) => [d.dayPop, d.nightPop, d.high, d.low].some(hasData));
  const show = (value) => (hasData(value) ? value : '—');
  const line = (label, value) => el('div', { class: 'fc-line' }, el('span', { text: label }), el('span', { text: show(value) }));
  $('forecast').replaceChildren(
    days.length
      ? el(
          'div',
          { class: 'fc' },
          ...days.map((d) =>
            el('div', { class: 'fc-day' }, el('div', { class: 'fc-name', text: d.name }), line('High', d.high), line('Low', d.low), line('Rain, day', d.dayPop), line('Rain, night', d.nightPop)),
          ),
        )
      : el('p', { class: 'empty', text: 'The controller currently has no NOAA forecast data for the coming week.' }),
  );
  $('noaaLink').hidden = !page.noaa;
  if (page.noaa) $('noaaLink').href = page.noaa;

  // Temperature-based adjustment
  if (page.adjust) {
    const sign = page.adjust.percent === '0' ? '' : /decrease|reduc/.test(page.adjust.direction) ? '−' : '+';
    $('adjustValue').textContent = `${sign}${page.adjust.percent}%`;
    $('adjustText').textContent = page.adjust.percent === '0' ? 'No change to watering times today' : `${page.adjust.direction} applied to watering times today, based on temperature`;
  }

  renderSystem();
}

function setLink(ok) {
  const pill = $('linkPill');
  pill.dataset.state = DEMO ? 'demo' : ok ? 'live' : 'offline';
  pill.textContent = DEMO ? 'Demo data' : ok ? 'Live' : 'Offline';
  if (ok) {
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } else if (!state.status) {
    $('hero').dataset.state = 'offline';
    $('heroIcon').innerHTML = ICONS.offline;
    $('heroTitle').textContent = 'Controller unreachable';
    $('heroDetail').textContent = 'Retrying every few seconds.';
  }
}

// ---------- data loading ----------

const DEMO_STATUS = `<ERC2K><STATUS><DATE>Tuesday October 06, 2026 01:12 PM </DATE><SUNDATA>Sunrise 07:33 AM - Sunset 07:06 PM</SUNDATA>
<CLOUDSTAT>HF to Cloud Connection State : Connected</CLOUDSTAT><CPUTIME> 21 days 3 hours 21 minutes 47 seconds</CPUTIME><RAINDELAY></RAINDELAY></STATUS>
<STATION><NUMBER>3</NUMBER><DESCRIPTION>Front lawn, east side</DESCRIPTION><TIMEREMAINING>12:40</TIMEREMAINING><MODE>Auto</MODE><PROGRAMNUM>2</PROGRAMNUM></STATION>
<STATION><NUMBER>7</NUMBER><DESCRIPTION>Vegetable beds</DESCRIPTION><TIMEREMAINING>04:05</TIMEREMAINING><MODE>Manual</MODE><PROGRAMNUM></PROGRAMNUM></STATION>
<INSTEON><DEVICE>Patio lights</DEVICE><STATE>On</STATE><SETVALUE>80%</SETVALUE><MODE>Auto</MODE><PROGRAMNUM>1</PROGRAMNUM></INSTEON></ERC2K>`;

async function getText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function loadStatus() {
  try {
    state.status = parseStatus(DEMO ? DEMO_STATUS : await getText('api/status.xml'));
    renderStatus(state.status);
    setLink(true);
  } catch (err) {
    console.warn(err);
    setLink(false);
  }
}

async function loadPage() {
  try {
    state.page = parsePage(await getText('api/page'));
    renderPage(state.page);
  } catch (err) {
    console.warn(err);
  }
}

// Poll only while the tab is visible; each timer is re-armed after its request
// settles so a slow controller never has requests stacking up.
const timers = {};
const loadedOnce = new Set();
function poll(name, task, interval) {
  clearTimeout(timers[name]);
  // A tab opened in the background still gets its first load.
  if (document.hidden && loadedOnce.has(name)) return;
  loadedOnce.add(name);
  task().finally(() => {
    timers[name] = setTimeout(() => poll(name, task, interval), interval);
  });
}
function start() {
  poll('status', loadStatus, STATUS_INTERVAL);
  poll('page', loadPage, PAGE_INTERVAL);
}
document.addEventListener('visibilitychange', start);

// ---------- navigation ----------

const menuBtn = $('menuBtn');
const sidebar = $('sidebar');
function setMenu(open) {
  document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
  sidebar.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}
menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
document.addEventListener('keydown', (event) => event.key === 'Escape' && setMenu(false));
matchMedia('(min-width: 901px)').addEventListener('change', () => setMenu(false));

sidebar.addEventListener('click', (event) => event.target.closest('a, button') && setMenu(false));
