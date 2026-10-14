'use strict';

// The controller's password-protected pages (programs, manual control,
// Insteon, settings, files, firmware, reboot) are rebuilt here from the
// controller's own markup. Every field keeps the exact name, value and order
// the controller expects, so a form sent from this app is byte-for-byte what
// the original page would have sent; only the presentation is replaced.
// Shares $, el, clean and start with app.js.

// ---------- sign-in ----------

const AUTH_KEY = 'hydroflash-auth';
let memoryAuth = '';

function readAuth() {
  try {
    return sessionStorage.getItem(AUTH_KEY) || memoryAuth;
  } catch {
    return memoryAuth;
  }
}
function writeAuth(value) {
  memoryAuth = value;
  try {
    if (value) sessionStorage.setItem(AUTH_KEY, value);
    else sessionStorage.removeItem(AUTH_KEY);
  } catch {
    // Storage unavailable (private window): the sign-in lasts until reload.
  }
  $('signOut').hidden = !value;
}

class SignInCancelled extends Error {}

let signInPending = null;
function askSignIn(rejected) {
  signInPending ||= new Promise((resolve) => {
    const dialog = $('signInDialog');
    $('signInNote').textContent = rejected
      ? 'The controller did not accept that user name and password.'
      : "Settings and controls use the controller's own user name and password.";
    $('signInNote').dataset.tone = rejected ? 'bad' : '';
    $('signInPass').value = '';
    const done = (ok) => {
      $('signInForm').onsubmit = $('signInCancel').onclick = dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    $('signInForm').onsubmit = (event) => {
      event.preventDefault();
      const bytes = new TextEncoder().encode(`${$('signInUser').value}:${$('signInPass').value}`);
      writeAuth(btoa(String.fromCharCode(...bytes)));
      done(true);
    };
    $('signInCancel').onclick = dialog.oncancel = () => done(false);
    dialog.showModal();
  }).finally(() => (signInPending = null));
  return signInPending;
}

// Fetches a controller path through the relay, asking for the controller's
// password whenever it answers 401.
async function deviceFetch(path, options = {}) {
  for (;;) {
    const auth = readAuth();
    const headers = { ...options.headers };
    if (auth) headers.Authorization = `Basic ${auth}`;
    if (options.method === 'POST') headers['X-HydroFLASH'] = '1';
    const res = await fetch(`device${path}`, { ...options, headers, cache: 'no-store' });
    if (res.status !== 401) return res;
    if (auth) writeAuth('');
    if (!(await askSignIn(Boolean(auth)))) throw new SignInCancelled('Sign-in cancelled');
  }
}

// ---------- feedback ----------

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3500);
}

function setBusy(info) {
  $('busy').hidden = !info;
  if (info) {
    $('busyTitle').textContent = info.title;
    $('busyText').textContent = info.text || '';
  }
}

function confirmAction({ title, text, ok, danger }) {
  return new Promise((resolve) => {
    const dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmOk').textContent = ok;
    $('confirmOk').className = danger ? 'btn danger' : 'btn primary';
    dialog.returnValue = 'cancel';
    dialog.onclose = () => resolve(dialog.returnValue === 'ok');
    dialog.showModal();
  });
}

function notice(text, tone) {
  $('pageNotices').append(el('p', { class: 'notice', 'data-tone': tone || 'info', text }));
}

// After a reboot or firmware update, hold the screen until the controller answers again.
async function waitForController(title) {
  setBusy({ title, text: 'Waiting for the controller to come back. This usually takes a minute or two.' });
  const deadline = Date.now() + 5 * 60_000;
  await new Promise((r) => setTimeout(r, 10_000));
  while (Date.now() < deadline) {
    const up = await fetch('api/status.xml', { cache: 'no-store' }).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 4_000));
  }
  setBusy(null);
  location.hash = '#/';
}

// ---------- turning the controller's markup into app markup ----------

const DROP_ATTRS = new Set([
  'bgcolor', 'bordercolor', 'border', 'cellpadding', 'cellspacing', 'width', 'height', 'align', 'valign',
  'nowrap', 'style', 'class', 'size', 'id', 'title', 'language', 'color', 'for',
]);
const TOGGLE = 'input[type="checkbox" i], input[type="radio" i]';
const CONTROL = 'input:not([type="hidden" i]), select, textarea, button';

// Controls of each form in the order the controller's page lists them.
const formControls = new WeakMap();

const isBlank = (node) => node.nodeType === Node.TEXT_NODE && !clean(node.textContent);
const sibling = (node, direction) => {
  let other = node[direction];
  while (other && isBlank(other)) other = other[direction];
  return other;
};
const unwrap = (node) => node.replaceWith(...node.childNodes);
// Text a person would read in a node, leaving out the option lists of selects.
const visibleText = (node) => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('select, script').forEach((n) => n.remove());
  return clean(copy.textContent);
};
const hasContent = (node) => Boolean(visibleText(node)) || Boolean(node.querySelector('input, select, textarea, button, table, a, img, pre'));

// Remove scripts, styling and event handlers, keeping the few presentational
// hints that carry meaning as data attributes.
function sanitize(root, doc) {
  const comments = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const doomed = [];
  while (comments.nextNode()) doomed.push(comments.currentNode);
  doomed.push(...root.querySelectorAll('script, style, link, meta, iframe, object, embed, hr, #waitspinner'));
  doomed.forEach((node) => node.remove());

  for (const node of root.querySelectorAll('*')) {
    if (node.classList.contains('STATIONS')) node.dataset.head = '1';
    if (node.classList.contains('time')) node.dataset.time = '1';
    if (node.hasAttribute('size')) node.dataset.size = node.getAttribute('size');
    const fontSize = node.tagName === 'B' && /font-size:\s*(\d+)pt/i.exec(node.getAttribute('style') || '');
    if (fontSize) node.dataset.heading = fontSize[1];
    const color = node.tagName === 'FONT' && (node.getAttribute('color') || '').toLowerCase();
    if (color && color !== '#000000' && color !== 'black') node.dataset.tone = 'on';
    for (const { name } of [...node.attributes]) {
      if (name.startsWith('on') || DROP_ATTRS.has(name)) node.removeAttribute(name);
    }
  }

  for (const node of root.querySelectorAll('b[data-heading]')) {
    node.replaceWith(el(Number(node.dataset.heading) >= 14 ? 'h2' : 'h3', { text: clean(node.textContent) }));
  }
  for (const font of [...root.querySelectorAll('font')].reverse()) {
    if (font.dataset.tone) font.replaceWith(el('span', { class: 'state-on', text: clean(font.textContent) }));
    else unwrap(font);
  }
  [...root.querySelectorAll('center')].reverse().forEach(unwrap);
}

// Give checkboxes and radio buttons a label that can be tapped.
function labelToggles(root) {
  for (const input of root.querySelectorAll(TOGGLE)) {
    if (input.closest('label')) continue;
    const before = sibling(input, 'previousSibling');
    const after = sibling(input, 'nextSibling');
    if (after?.tagName === 'LABEL') {
      after.prepend(input, ' ');
      after.className = 'check';
    } else if (before?.tagName === 'B' && clean(before.textContent).length <= 2) {
      const chip = el('label', { class: 'chip' });
      input.replaceWith(chip);
      chip.append(input, el('span', { text: clean(before.textContent) }));
      before.remove();
    } else if (before?.tagName === 'B' && /:$/.test(clean(before.textContent))) {
      const label = el('label', { class: 'check' });
      input.replaceWith(label);
      label.append(input, el('b', { text: clean(before.textContent).replace(/:$/, '') }));
      before.remove();
    } else if (after?.tagName === 'B') {
      const label = el('label', { class: 'check' });
      input.replaceWith(label);
      label.append(input, after);
    }
  }
}

function commonWords(labels) {
  const lists = labels.map((label) => label.split(' '));
  return lists[0].filter((word) => lists.every((list) => list.includes(word)));
}

// A table with a header row is real data: label every cell with its column so
// it can become a card on a phone, and fold runs of one-tick columns (the
// days of the week, AM/PM, even/odd days) into a single row of chips.
function dataTable(table, rows, headRow) {
  const bodyRows = rows.filter((row) => row !== headRow && row.cells.length);
  if (!bodyRows.length) {
    table.replaceWith(el('p', { class: 'empty', text: 'Nothing is set up here yet.' }));
    return;
  }
  // A heading spanning several columns keeps its text on the first of them.
  for (const th of [...headRow.cells]) {
    for (; th.colSpan > 1; th.colSpan--) th.after(el('th', {}));
  }
  const heads = [...headRow.cells];
  const simple = bodyRows.every((row) => [...row.cells].every((td) => td.colSpan === 1));
  const label = (i) => clean(heads[i]?.textContent);
  const lone = (row, i) => {
    const cell = row.cells[i];
    const toggles = cell ? cell.querySelectorAll(TOGGLE) : [];
    return toggles.length === 1 && cell.querySelectorAll(CONTROL).length === 1 && !visibleText(cell) ? toggles[0] : null;
  };
  const toggleColumn = (i) => bodyRows.every((row) => lone(row, i));
  const joins = (i) =>
    toggleColumn(i) &&
    toggleColumn(i + 1) &&
    ((label(i).length <= 2 && label(i + 1).length <= 2) ||
      (lone(bodyRows[0], i).type === 'radio' && lone(bodyRows[0], i).name === lone(bodyRows[0], i + 1).name));

  if (simple) {
    for (let start = heads.length - 2; start >= 0; start--) {
      if (!joins(start)) continue;
      let first = start;
      while (first > 0 && joins(first - 1)) first--;
      const labels = [];
      for (let i = first; i <= start + 1; i++) labels.push(label(i));
      const shared = commonWords(labels);
      const short = labels.map((text) => text.split(' ').filter((word) => !shared.includes(word)).join(' ') || text);
      const title = labels.join('') === 'SMTWTFS' ? 'Days' : shared.join(' ') || labels.join(' / ');

      for (const row of bodyRows) {
        const cells = [...row.cells].slice(first, start + 2);
        const chips = cells.map((cell, n) => el('label', { class: 'chip' }, lone(row, first + n), el('span', { text: short[n] })));
        cells[0].replaceChildren(el('span', { class: 'chips' }, ...chips));
        cells.slice(1).forEach((cell) => cell.remove());
      }
      heads[first].textContent = title;
      heads.splice(first + 1, start + 1 - first).forEach((th) => th.remove());
      start = first;
    }
  }

  const labels = [];
  for (const th of headRow.cells) for (let n = 0; n < th.colSpan; n++) labels.push(clean(th.textContent));
  headRow.className = 'head';
  for (const row of bodyRows) {
    [...row.cells].forEach((cell, i) => {
      if (labels[i]) cell.dataset.label = labels[i];
      if (cell.dataset.head) cell.classList.add('rowhead');
      if (!hasContent(cell)) cell.classList.add('blank');
      const value = el('span', { class: 'cell' });
      value.append(...cell.childNodes);
      cell.append(value);
    });
  }
  table.className = 'data';
  const wrap = el('div', { class: 'table-wrap' });
  table.replaceWith(wrap);
  wrap.append(table);
}

function transformTables(root) {
  // Innermost tables first, so an outer layout table sees finished contents.
  for (const table of [...root.querySelectorAll('table')].reverse()) {
    const rows = [...table.rows];
    const headRow = rows.find((row) => [...row.cells].some((cell) => cell.tagName === 'TH'));
    if (headRow) {
      dataTable(table, rows, headRow);
      continue;
    }

    const cells = rows.flatMap((row) => [...row.cells]).filter(hasContent);
    const box = el('div', {});
    const hidden = table.querySelectorAll(':scope > input, :scope > tbody > input, :scope > tbody > tr > input');
    if (cells.length && cells.every((cell) => cell.querySelector(CONTROL) && !visibleText(cell))) {
      // A row of buttons (page pickers, program start/cancel).
      box.className = 'toolbar';
      for (const cell of cells) box.append(...cell.childNodes);
    } else {
      // Anything else was a table used for layout: label/value rows.
      box.className = 'rows-plain';
      for (const row of rows) {
        const kept = [...row.cells].filter(hasContent).map((cell) => {
          const part = el('div', { class: 'part' });
          part.append(...cell.childNodes);
          return part;
        });
        if (!kept.length) continue;
        const line = el('div', { class: 'line' }, ...kept);
        if (kept.length === 2 && !kept[0].querySelector(CONTROL) && /:$/.test(visibleText(kept[0]))) line.classList.add('field');
        box.append(line);
      }
    }
    box.append(...hidden);
    table.replaceWith(box);
  }
}

function styleControls(root) {
  for (const control of root.querySelectorAll('input, select, textarea')) {
    const type = (control.getAttribute('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'reset' || type === 'button') {
      control.classList.add('btn');
      if (/^(save changes|apply|upload|turn on|start program)$/i.test(control.value)) control.classList.add('primary');
      if (/reboot|delete|update from/i.test(control.value)) control.classList.add('danger');
    } else if (control.tagName === 'SELECT' || !['checkbox', 'radio', 'hidden', 'file'].includes(type)) {
      const size = Number(control.dataset.size) || 20;
      control.classList.add('in');
      if (control.tagName !== 'SELECT') control.classList.add(size <= 3 ? 'w-xs' : size <= 9 ? 'w-s' : size <= 20 ? 'w-m' : 'w-l');
      if (control.dataset.time && !/address/i.test(control.name)) control.inputMode = 'numeric';
      // Keep the browser from filling saved passwords into controller settings.
      control.autocomplete = type === 'password' ? 'new-password' : 'off';
    }
  }
}

const TEXT_FILE = /\.(txt|log|cfg|xml|csv|ini|htm|html|json)$/i;

// Point the controller's links at this app's routes.
function rewriteLinks(root, pagePath) {
  for (const link of root.querySelectorAll('a')) {
    const href = (link.getAttribute('href') || '').replace(/\s+/g, '');
    link.removeAttribute('target');
    if (/^https?:\/\//i.test(href)) {
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      continue;
    }
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
      unwrap(link);
      continue;
    }
    const target = new URL(href, `http://controller/${pagePath}`);
    const path = target.pathname.slice(1) + target.search;
    link.setAttribute('href', /\.htm$/i.test(target.pathname) ? `#/${path}` : `#/file/${path}`);
  }
}

function tidy(root) {
  const BLOCK = /^(DIV|TABLE|H2|H3|FORM|P|UL|BR)$/;
  for (const br of root.querySelectorAll('br')) {
    const before = sibling(br, 'previousSibling');
    const after = sibling(br, 'nextSibling');
    const block = (node) => node.nodeType === Node.ELEMENT_NODE && BLOCK.test(node.tagName);
    if (!before || !after || block(before) || block(after)) br.remove();
  }
  for (const p of root.querySelectorAll('p, form, div.part, div.line, div.rows-plain')) if (!hasContent(p)) p.remove();
}

// Keep Save / Reset within reach at the bottom of the screen on long forms.
function saveBars(root) {
  for (const form of root.querySelectorAll('form')) {
    const controls = formControls.get(form) || [];
    const save = controls.find((c) => c.type === 'submit' && /^(save changes|apply)$/i.test(c.value) && form.contains(c));
    if (!save) continue;
    const reset = controls.find((c) => c.type === 'reset' && form.contains(c));
    form.append(el('div', { class: 'savebar' }, reset, save));
  }
}

// Some controller pages open a form in one table cell and close it several
// cells later. A browser loading such a page still submits the later fields
// with that form, so they are assigned to it here as well, and the card is
// drawn around everything the form owns.
function adoptStrayControls(doc) {
  let current = null;
  for (const node of doc.querySelectorAll('form, input, select, textarea, button')) {
    if (node.tagName === 'FORM') {
      current = node;
      formControls.set(node, []);
    } else if (node.form || current) {
      formControls.get(node.form || current).push(node);
    }
  }
}

function frameStrayControls(content) {
  for (const form of content.querySelectorAll('form')) {
    const strays = formControls.get(form).filter((control) => !form.contains(control));
    if (!strays.length) continue;
    let box = form.parentElement;
    while (box !== content && !strays.every((control) => box.contains(control))) box = box.parentElement;
    if (box === content) {
      box = el('div', {});
      box.append(...content.childNodes);
      content.append(box);
    }
    box.dataset.card = '1';
    form.dataset.bare = '1';
  }
}

function readMessages(doc) {
  const found = [];
  const comments = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  while (comments.nextNode()) {
    if (!/STATUS MESSAGES/i.test(comments.currentNode.data)) continue;
    let tone = 'good';
    for (const node of comments.currentNode.parentNode.childNodes) {
      if (node.nodeType === Node.COMMENT_NODE) {
        if (/ERROR MESSAGES/i.test(node.data)) tone = 'bad';
      } else if (clean(node.textContent)) {
        found.push({ text: clean(node.textContent), tone });
      }
    }
    break;
  }
  return found;
}

// ---------- page-specific behaviour the controller did in its own scripts ----------

const dotted = (text) => /^\d{1,3}(\.\d{1,3}){3}$/.test(text) && text.split('.').every((n) => Number(n) <= 255);
const field = (form, name) => (formControls.get(form) || []).filter((c) => c.name === name);

const HOOKS = {
  'reboot.htm': {
    confirm: () => ({ title: 'Reboot the controller?', text: 'Any watering in progress stops, and the controller is unreachable until it has restarted.', ok: 'Reboot', danger: true }),
    restarts: 'Rebooting',
  },

  'upload_firmware.htm': {
    validate(form) {
      const [file] = field(form, 'firmware');
      if (!file) return '';
      if (!file.files.length) return 'Choose the firmware file first.';
      if (!/^(image|backup)\.bin$/.test(file.files[0].name)) return 'The file must be named image.bin (or backup.bin for a recovery image).';
      return '';
    },
    confirm: (form, submitter) => ({
      title: `${submitter.value}?`,
      text: 'The controller writes the new firmware to its flash memory and reboots. This can take up to 2 minutes. Do not turn the controller off while it runs.',
      ok: 'Update firmware',
      danger: true,
    }),
    busy: () => ({ title: 'Updating firmware', text: 'Writing to flash. This can take up to 2 minutes. Do not turn the controller off.' }),
    restarts: 'Finishing firmware update',
  },

  'network_config.htm': {
    init(root) {
      const form = root.querySelector('form[name="network_form"]');
      if (!form) return;
      const sync = () => {
        const dhcp = field(form, 'rbDHCP')[0]?.checked;
        for (const name of ['ip_addr', 'submask', 'gw_addr', 'pdns_addr', 'sdns_addr']) field(form, name).forEach((c) => (c.disabled = Boolean(dhcp)));
        const fixed6 = field(form, 'ipv6Static')[0]?.checked;
        for (const name of ['ipv6_addr', 'prefix_len', 'ipv6_gateway']) field(form, name).forEach((c) => (c.disabled = !fixed6));
      };
      for (const control of [...field(form, 'rbDHCP'), ...field(form, 'ipv6Static')]) control.addEventListener('change', sync);
      sync();
    },
    validate(form) {
      const value = (name) => {
        const [control] = field(form, name);
        if (control) control.value = control.value.trim();
        return control ? control.value : '';
      };
      if (!field(form, 'rbDHCP')[0]?.checked) {
        const [gateway] = field(form, 'gw_addr');
        if (gateway && !gateway.value.trim()) gateway.value = '0.0.0.0';
        const usable = (text) => dotted(text) && text !== '255.255.255.255';
        if (!usable(value('ip_addr'))) return 'Invalid or missing IP address.';
        if (value('pdns_addr') !== '0.0.0.0' && !usable(value('pdns_addr'))) return 'Invalid or missing Primary DNS address.';
        if (value('sdns_addr') !== '0.0.0.0' && !usable(value('sdns_addr'))) return 'Invalid or missing Secondary DNS address.';
        if (!dotted(value('submask'))) return 'Invalid or missing subnet mask.';
        if (!usable(value('gw_addr'))) return 'Invalid or missing default gateway address.';
        if (/^0+\.0+\.0+\.0+$/.test(value('gw_addr'))) return 'The gateway address cannot be 0.0.0.0.';
      }
      if (field(form, 'ipv6Static')[0]?.checked) {
        const prefix = value('prefix_len');
        if (!/^\d+$/.test(prefix) || Number(prefix) > 128) return 'Invalid Prefix Length: enter a value between 0 and 128.';
      }
      return '';
    },
    confirm: () => ({
      title: 'Apply network settings?',
      text: "If the controller's address changes, this app loses contact with it until its server is pointed at the new address.",
      ok: 'Apply',
    }),
  },

  'settings.htm': {
    validate(form) {
      const [first] = field(form, 'WebPagePassword');
      const [second] = field(form, 'ConfirmWebPagePassword');
      if (!first || !second || (!first.value && !second.value)) return '';
      let problem = '';
      if (first.value.length < 4 || first.value.length > 15 || first.value === 'root') problem = 'Invalid password: choose a different one, 4 to 15 characters.';
      else if (first.value !== second.value) problem = 'The web page password and its confirmation do not match. Enter them again.';
      if (problem) first.value = second.value = '';
      return problem;
    },
  },

  'filelist.htm': {
    validate(form, submitter) {
      if (/upload/i.test(submitter.value) && !field(form, 'file')[0]?.files.length) return 'Choose a file to upload first.';
      if (/delete/i.test(submitter.value) && !field(form, 'filecheckbox').some((c) => c.checked)) return 'Tick the files to delete first.';
      return '';
    },
    confirm: (form, submitter) =>
      /delete/i.test(submitter.value) && { title: 'Delete the ticked files?', text: 'They are removed from the controller and cannot be restored.', ok: 'Delete', danger: true },
  },

  'insteon_devices.htm': {
    confirm: (form, submitter) =>
      /delete link/i.test(submitter.value) && { title: 'Delete this modem link?', text: 'The controller removes its link to this Insteon device.', ok: 'Delete link', danger: true },
    busy: (form, submitter) =>
      /link/i.test(submitter.value) && { title: 'Linking update', text: 'Please wait while linking updates are performed. The result appears at the top of the page.' },
  },
};

// ---------- sending a form ----------

function collect(form, submitter) {
  const entries = [];
  for (const control of formControls.get(form) || []) {
    if (!control.name || control.disabled) continue;
    const type = (control.type || '').toLowerCase();
    if (['submit', 'reset', 'button', 'image'].includes(type)) {
      if (control === submitter) entries.push([control.name, control.value]);
    } else if (type === 'checkbox' || type === 'radio') {
      if (control.checked) entries.push([control.name, control.value]);
    } else if (type === 'file') {
      entries.push([control.name, control.files[0] || new File([], '')]);
    } else if (control.tagName === 'SELECT') {
      for (const option of control.selectedOptions) entries.push([control.name, option.value]);
    } else {
      entries.push([control.name, control.value]);
    }
  }
  return entries;
}

async function submitForm(form, submitter, pagePath) {
  const hook = HOOKS[pagePath.split('?')[0]] || {};
  $('pageNotices').replaceChildren();

  const problem = hook.validate?.(form, submitter);
  if (problem) {
    notice(problem, 'bad');
    $('pageNotices').scrollIntoView({ block: 'center' });
    return;
  }
  const question = hook.confirm?.(form, submitter);
  if (question && !(await confirmAction(question))) return;

  const entries = collect(form, submitter);
  const options = { method: 'POST' };
  if (/multipart/i.test(form.getAttribute('enctype') || '')) {
    options.body = new FormData();
    for (const [name, value] of entries) value instanceof File ? options.body.append(name, value, value.name) : options.body.append(name, value);
  } else {
    options.body = new URLSearchParams(entries).toString();
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  // Quick actions finish before the overlay would be worth showing.
  const waiting = hook.busy?.(form, submitter);
  const overlay = setTimeout(() => setBusy(waiting || { title: submitter.value, text: 'Sending to the controller…' }), waiting ? 0 : 500);
  let res, failure;
  try {
    res = await deviceFetch(form.getAttribute('action'), options);
  } catch (err) {
    failure = err;
  } finally {
    clearTimeout(overlay);
    setBusy(null);
  }

  if (failure instanceof SignInCancelled) return notice('Not sent: sign in to the controller to make changes.', 'bad');
  // A controller that is restarting drops the connection instead of answering.
  if (hook.restarts && (failure || res.ok)) return waitForController(hook.restarts);
  if (failure || !res.ok) return notice(`The controller did not accept "${submitter.value}" (${failure ? failure.message : `status ${res.status}`}).`, 'bad');

  toast(/^save|^apply/i.test(submitter.value) ? 'Changes saved' : `${submitter.value}: sent`);
  const next = res.headers.get('X-Device-Location');
  if (!next) return showControllerPage(await res.text(), pagePath);
  const target = next.slice(1);
  if (target === currentRoute()) openPage(target);
  else location.hash = `#/${target}`;
}

// ---------- showing a page ----------

function setHead(title, sub) {
  $('pageTitle').textContent = title;
  $('pageSub').textContent = sub || '';
  $('pageSub').hidden = !sub;
  document.title = `${title} · HydroFLASH`;
}

function showControllerPage(html, pagePath) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const content = doc.querySelector('td.PAGECONTENT');
  $('pageNotices').replaceChildren();
  $('pageTabs').hidden = true;
  if (!content) {
    setHead(clean(doc.querySelector('h1')?.textContent) || 'Controller page');
    $('pageBody').replaceChildren();
    notice(clean(doc.body.textContent) || 'The controller returned a page this app does not recognise.', 'bad');
    return;
  }

  adoptStrayControls(doc);
  for (const message of readMessages(doc)) notice(message.text, message.tone);

  const heading = content.querySelector('h1');
  const [title, ...rest] = clean(heading?.textContent).split(/\s+-\s+/);
  const sub = rest.join(' - ').replace(/^Currently Viewing\s*/i, '');
  heading?.remove();
  setHead(title || 'Controller', sub);

  // The controller's tab strip becomes the page's section tabs.
  const selected = content.querySelector('td.PAGETAB-SELECTED');
  if (selected) {
    const strip = selected.closest('table');
    const tabs = [...strip.querySelectorAll('td.PAGETAB-SELECTED, td.PAGETAB a')].map((node) =>
      node.tagName === 'A'
        ? el('a', { href: `#/${(node.getAttribute('href') || '').replace(/\s+/g, '').replace(/^\//, '')}`, text: clean(node.textContent) })
        : el('span', { 'aria-current': 'page', text: clean(node.textContent) }),
    );
    strip.remove();
    $('pageTabs').hidden = tabs.length < 2;
    $('pageTabs').replaceChildren(...tabs);
  }

  sanitize(content, doc);
  labelToggles(content);
  transformTables(content);
  styleControls(content);
  rewriteLinks(content, pagePath);
  saveBars(content);
  tidy(content);
  frameStrayControls(content);

  // Mark which program or page the picker buttons are currently showing.
  const viewing = sub.match(/#\d+$/)?.[0];
  if (viewing) {
    for (const button of content.querySelectorAll('.toolbar input.btn')) {
      if (button.value.endsWith(viewing)) button.setAttribute('aria-pressed', 'true');
    }
  }

  const body = $('pageBody');
  body.replaceChildren(...document.adoptNode(content).childNodes);

  for (const form of body.querySelectorAll('form')) {
    // Pressing Enter in a field must never fire the first button on the page
    // (on Manual Watering that would switch a station on).
    form.addEventListener('submit', (event) => event.preventDefault());
    for (const control of formControls.get(form) || []) {
      if (control.type !== 'submit') continue;
      control.addEventListener('click', (event) => {
        event.preventDefault();
        submitForm(form, control, pagePath);
      });
    }
  }
  HOOKS[pagePath.split('?')[0]]?.init?.(body);
}

let fileUrl = '';
async function showFile(path, res) {
  const name = decodeURIComponent(path.split('/').pop());
  const blob = await res.blob();
  URL.revokeObjectURL(fileUrl);
  fileUrl = URL.createObjectURL(blob);
  setHead(name, `/${decodeURIComponent(path)}`);
  const parts = [el('p', {}, el('a', { class: 'btn', href: fileUrl, download: name, text: 'Download' }))];
  if ((TEXT_FILE.test(name) || blob.type.startsWith('text/')) && blob.size < 3_000_000) parts.push(el('pre', { class: 'file-text', text: await blob.text() }));
  else parts.push(el('p', { class: 'empty', text: 'This file cannot be shown here. Download it to open it.' }));
  $('pageBody').replaceChildren(...parts);
}

let pageToken = 0;
async function openPage(route) {
  const token = ++pageToken;
  const isFile = route.startsWith('file/');
  const path = isFile ? route.slice(5) : route;
  $('pageNotices').replaceChildren();
  $('pageTabs').hidden = true;
  if (!/^[\w.\-/%]+(\?[\w.\-/%=&,]*)?$/.test(path) || path.includes('..')) {
    setHead('Not found');
    $('pageBody').replaceChildren();
    return notice('That is not a controller page.', 'bad');
  }
  setHead('Loading…');
  $('pageBody').replaceChildren(el('p', { class: 'empty', text: 'Loading from the controller…' }));

  let res;
  try {
    res = await deviceFetch(`/${path}`);
  } catch (err) {
    if (token !== pageToken) return;
    const cancelled = err instanceof SignInCancelled;
    setHead(cancelled ? 'Sign-in needed' : 'Controller unreachable');
    $('pageBody').replaceChildren(el('p', {}, el('button', { class: 'btn primary', type: 'button', 'data-retry': '1', text: cancelled ? 'Sign in' : 'Try again' })));
    return notice(cancelled ? 'This page is protected by the controller password.' : 'The controller did not answer.', cancelled ? 'info' : 'bad');
  }
  if (token !== pageToken) return;
  if (isFile && res.ok) return showFile(path, res);
  showControllerPage(await res.text(), path);
  window.scrollTo(0, 0);
}

// ---------- routing ----------

const NAV_PARENT = {
  'insteon_therm_program.htm': 'insteon_program.htm',
  'insteon_scene_program.htm': 'insteon_program.htm',
  'insteon_event_program.htm': 'insteon_program.htm',
  'insteon_scene_edit.htm': 'insteon_program.htm',
  'insteon_scene_control.htm': 'insteon_control.htm',
};

function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '');
  return route === 'index.htm' ? '' : route;
}

function showRoute() {
  const route = currentRoute();
  const page = route.replace(/^file\/.*/, 'filelist.htm').split('?')[0];
  const active = `#/${NAV_PARENT[page] || page}`;
  for (const link of document.querySelectorAll('.sidebar a.nav-link')) {
    const current = link.getAttribute('href') === active;
    link.classList.toggle('current', current);
    current ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
  }
  $('statusView').hidden = Boolean(route);
  $('pageView').hidden = !route;
  if (route) return openPage(route);
  pageToken++;
  document.title = state.page?.site ? `${state.page.site} · HydroFLASH` : 'HydroFLASH';
}

window.addEventListener('hashchange', showRoute);
$('pageRefresh').addEventListener('click', () => openPage(currentRoute()));
$('pageBody').addEventListener('click', (event) => event.target.closest('[data-retry]') && openPage(currentRoute()));
$('signOut').addEventListener('click', () => {
  writeAuth('');
  location.hash = '#/';
  toast('Signed out');
});
$('signOut').hidden = !readAuth();

showRoute();
start();
