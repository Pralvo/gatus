// The page for managing incidents and reports through the token API.
//
// Every value from the server is stored text that anyone with a token wrote, so
// it reaches the page only as text nodes and form values, never as markup. The
// token lives in this tab's sessionStorage and in memory, and is sent only in the
// Authorization header to this origin. There are no cookies.
'use strict';

(() => {
  const TOKEN_KEY = 'incidents-admin-token';
  const API = '/api/v1/admin';
  const OPTIONS = {
    stages: ['investigating', 'identified', 'monitoring', 'resolved'],
    impacts: ['degraded', 'partial', 'major', 'maintenance'],
    severities: ['critical', 'major', 'minor'],
    states: ['open', 'mitigated', 'resolved', 'cancelled', 'closed'],
  };

  const $ = (id) => document.getElementById(id);
  let token = '';

  // Storage can be blocked. The token then lasts only until the page reloads.
  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function saveToken(value) {
    try { sessionStorage.setItem(TOKEN_KEY, value); } catch (e) { /* memory only */ }
  }
  function forgetToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing stored */ }
  }

  // el builds an element. Strings and numbers become text nodes, so stored text
  // can never become markup.
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'value' || key === 'checked') node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function options(names, selected) {
    return names.map((name) => el('option', { value: name, ...(name === selected ? { selected: '' } : {}) }, name));
  }

  function when(iso) {
    const date = new Date(iso);
    return el('time', { datetime: iso }, isNaN(date) ? iso : date.toLocaleString());
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  function describe(status, data) {
    if (status === 401) return 'That token was not accepted.';
    if (status === 429) return 'Too many failed attempts from this address. Wait a minute and try again.';
    if (status === 503) return 'Storage is unavailable. Try again shortly.';
    if (status === 404 && !data) return 'The incidents plugin is not running on this server.';
    if (status === 404) return 'That record does not exist.';
    if (data && typeof data.message === 'string') return data.message;
    return 'The request failed with status ' + status + '.';
  }

  async function call(method, path, body) {
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const init = { method, headers, cache: 'no-store', credentials: 'omit', redirect: 'error' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(API + path, init);
    } catch (e) {
      throw new ApiError(0, 'The server could not be reached.');
    }
    let data = null;
    if ((response.headers.get('Content-Type') || '').startsWith('application/json')) {
      try { data = await response.json(); } catch (e) { data = null; }
    }
    if (!response.ok) throw new ApiError(response.status, describe(response.status, data));
    return data;
  }

  function say(text, kind) {
    const status = $('status');
    status.className = kind || '';
    status.textContent = text || '';
  }

  // act runs one user action, shows its outcome, and signs out on a dead token.
  async function act(button, action, done) {
    if (button) button.disabled = true;
    say('Working…');
    try {
      await action();
      say(done || '', 'ok');
    } catch (e) {
      if (e.status === 401) signOut(e.message);
      else say(e.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function signOut(reason) {
    token = '';
    forgetToken();
    $('app').hidden = true;
    $('detail-view').replaceChildren();
    $('signin-view').hidden = false;
    $('signin-status').textContent = reason || '';
    $('token').focus();
  }

  function show(view) {
    for (const name of ['reports-view', 'incidents-view', 'detail-view']) $(name).hidden = name !== view;
  }

  // parseEndpoints reads "key impact" lines. A bad line stops the request.
  function parseEndpoints(text) {
    const endpoints = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const [key, impact, extra] = line.split(/\s+/);
      if (!impact || extra !== undefined || !OPTIONS.impacts.includes(impact)) {
        throw new ApiError(400, 'Each endpoint line must be a key and one of: ' + OPTIONS.impacts.join(', ') + '.');
      }
      endpoints.push({ key, impact });
    }
    return endpoints;
  }

  function endpointText(endpoints) {
    return (endpoints || []).map((e) => e.key + ' ' + e.impact).join('\n');
  }

  // form builds a form whose submit runs action with the form's values.
  function form(label, fields, action, done) {
    const button = el('button', { type: 'submit' }, label);
    const node = el('form', { autocomplete: 'off' }, fields, button);
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      act(button, () => action(node.elements), done);
    });
    return node;
  }

  // Reports.

  async function listReports() {
    const data = await call('GET', '/reports?limit=200');
    $('report-list').replaceChildren(...(data.reports || []).map((r) => el('li', null,
      el('button', { type: 'button', onclick: () => act(null, () => openReport(r.id)) }, r.title),
      el('p', { class: 'muted' }, r.stage, ' · ', r.published_at ? 'published' : 'draft', ' · changed ', when(r.updated_at)))));
    if (!(data.reports || []).length) $('report-list').replaceChildren(el('li', { class: 'muted' }, 'No reports yet.'));
  }

  async function showReports() {
    show('reports-view');
    await listReports();
  }

  async function openReport(id) {
    const report = await call('GET', '/reports/' + encodeURIComponent(id));
    const path = '/reports/' + encodeURIComponent(report.id);
    const after = () => openReport(report.id);
    $('detail-view').replaceChildren(
      el('button', { type: 'button', onclick: () => act(null, showReports) }, 'Back to reports'),
      el('h2', null, report.title),
      el('p', null, 'Stage: ', report.stage, ' · ',
        report.published_at ? ['Published ', when(report.published_at), ' · ', el('a', { href: path }, 'Public page')] : 'Draft'),
      el('h3', null, 'Affected endpoints'),
      (report.endpoints || []).length
        ? el('ul', null, report.endpoints.map((e) => el('li', null, e.key, ' · ', e.impact)))
        : el('p', { class: 'muted' }, 'None named.'),
      el('h3', null, 'Post an update'),
      form('Post update', [
        el('label', null, 'Stage ', el('select', { name: 'stage' }, options(OPTIONS.stages, report.stage))),
        el('label', null, 'Message ', el('textarea', { name: 'message', required: '', rows: '4', maxlength: '5000' })),
      ], async (f) => {
        await call('POST', path + '/updates', { stage: f.stage.value, message: f.message.value });
        await after();
      }, 'Update posted.'),
      el('h3', null, 'Publication'),
      form(report.published_at ? 'Return to draft' : 'Publish', [], async () => {
        await call('PUT', path + '/publication', { published: !report.published_at });
        await after();
      }, report.published_at ? 'Returned to draft.' : 'Published.'),
      el('h3', null, 'Edit'),
      form('Save changes', [
        el('label', null, 'Title ', el('input', { name: 'title', required: '', maxlength: '200', value: report.title })),
        el('label', null, 'Affected endpoints, one per line as key impact ',
          el('textarea', { name: 'endpoints', rows: '3', spellcheck: 'false', value: endpointText(report.endpoints) })),
      ], async (f) => {
        const change = {};
        if (f.title.value !== report.title) change.title = f.title.value;
        const endpoints = parseEndpoints(f.endpoints.value);
        if (endpointText(endpoints) !== endpointText(report.endpoints)) change.endpoints = endpoints;
        if (!Object.keys(change).length) throw new ApiError(400, 'Nothing changed.');
        await call('PATCH', path, change);
        await after();
      }, 'Saved.'),
      el('h3', null, 'Updates, newest first'),
      el('ol', { class: 'list' }, (report.updates || []).slice().reverse().map((u) => el('li', null,
        el('p', null, u.stage, ' · ', when(u.at), ' · ', u.actor),
        el('p', { class: 'text' }, u.message)))),
    );
    show('detail-view');
  }

  // Incidents.

  async function listIncidents() {
    const state = $('incident-filter').value;
    const query = '/incidents?limit=200' + (state ? '&state=' + encodeURIComponent(state) : '');
    const data = await call('GET', query);
    const items = (data.incidents || []).map((i) => el('li', null,
      el('button', { type: 'button', onclick: () => act(null, () => openIncident(i.id)) }, i.title),
      el('p', { class: 'muted' }, i.severity, ' · ', i.state, i.commander ? ' · commander ' + i.commander : '', ' · changed ', when(i.updated_at))));
    $('incident-list').replaceChildren(...(items.length ? items : [el('li', { class: 'muted' }, 'No incidents.')]));
  }

  async function showIncidents() {
    show('incidents-view');
    await listIncidents();
  }

  function entryText(entry) {
    if (entry.kind === 'note') return entry.note;
    if (entry.kind === 'postmortem') return 'postmortem edited';
    if (entry.kind === 'created') return 'opened';
    return entry.kind + ': ' + (entry.from || '(none)') + ' → ' + (entry.to || '(none)');
  }

  async function openIncident(id) {
    const incident = await call('GET', '/incidents/' + encodeURIComponent(id));
    const path = '/incidents/' + encodeURIComponent(incident.id);
    const after = () => openIncident(incident.id);
    $('detail-view').replaceChildren(
      el('button', { type: 'button', onclick: () => act(null, showIncidents) }, 'Back to incidents'),
      el('h2', null, incident.title),
      el('p', null, incident.severity, ' · ', incident.state, ' · opened by ', incident.created_by, ' ', when(incident.created_at)),
      incident.commander ? el('p', null, 'Commander: ', incident.commander) : null,
      incident.report_id ? el('p', null, 'Report: ',
        el('button', { type: 'button', onclick: () => act(null, () => openReport(incident.report_id)) }, incident.report_id)) : null,
      el('h3', null, 'Move'),
      form('Move', [
        el('label', null, 'State ', el('select', { name: 'state' }, options(OPTIONS.states, incident.state))),
      ], async (f) => {
        await call('POST', path + '/state', { state: f.state.value });
        await after();
      }, 'Moved.'),
      el('h3', null, 'Add a note'),
      form('Add note', [
        el('label', null, 'Note ', el('textarea', { name: 'note', required: '', rows: '3', maxlength: '5000' })),
      ], async (f) => {
        await call('POST', path + '/notes', { note: f.note.value });
        await after();
      }, 'Note added.'),
      el('h3', null, 'Edit'),
      form('Save changes', [
        el('label', null, 'Title ', el('input', { name: 'title', required: '', maxlength: '200', value: incident.title })),
        el('label', null, 'Severity ', el('select', { name: 'severity' }, options(OPTIONS.severities, incident.severity))),
        el('label', null, 'Commander ', el('input', { name: 'commander', maxlength: '100', value: incident.commander || '' })),
        el('label', null, 'Report ID ', el('input', { name: 'report_id', maxlength: '32', spellcheck: 'false', value: incident.report_id || '' })),
        el('label', null, 'Postmortem, in Markdown ', el('textarea', { name: 'postmortem', rows: '8', value: incident.postmortem || '' })),
      ], async (f) => {
        const change = {};
        for (const field of ['title', 'severity', 'commander', 'report_id', 'postmortem']) {
          if (f[field].value !== (incident[field] || '')) change[field] = f[field].value;
        }
        if (!Object.keys(change).length) throw new ApiError(400, 'Nothing changed.');
        await call('PATCH', path, change);
        await after();
      }, 'Saved.'),
      el('h3', null, 'Timeline'),
      el('ol', { class: 'list' }, (incident.timeline || []).map((entry) => el('li', null,
        el('p', null, when(entry.at), ' · ', entry.actor),
        el('p', { class: 'text' }, entryText(entry))))),
    );
    show('detail-view');
  }

  // Wiring.

  function fill() {
    for (const select of document.querySelectorAll('select[data-options]')) {
      select.replaceChildren(...options(OPTIONS[select.dataset.options]));
    }
    $('incident-filter').append(...options(OPTIONS.states));
  }

  function wire() {
    $('signin').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('token');
      token = input.value.trim();
      input.value = '';
      if (!token) return;
      try {
        await call('GET', '/reports?limit=1');
      } catch (e) {
        token = '';
        $('signin-status').textContent = e.message;
        return;
      }
      saveToken(token);
      start();
    });
    $('signout').addEventListener('click', () => signOut('Signed out.'));
    $('nav-reports').addEventListener('click', (event) => act(event.target, showReports));
    $('nav-incidents').addEventListener('click', (event) => act(event.target, showIncidents));
    $('incident-filter').addEventListener('change', () => act(null, listIncidents));

    const newReport = $('new-report');
    newReport.addEventListener('submit', (event) => {
      event.preventDefault();
      const f = newReport.elements;
      act(f[f.length - 1], async () => {
        const report = await call('POST', '/reports', {
          title: f.title.value, stage: f.stage.value, message: f.message.value,
          endpoints: parseEndpoints(f.endpoints.value), published: f.published.checked,
        });
        newReport.reset();
        await openReport(report.id);
      }, 'Report created.');
    });

    const newIncident = $('new-incident');
    newIncident.addEventListener('submit', (event) => {
      event.preventDefault();
      const f = newIncident.elements;
      act(f[f.length - 1], async () => {
        const incident = await call('POST', '/incidents', {
          title: f.title.value, severity: f.severity.value, commander: f.commander.value, report_id: f.report_id.value,
        });
        newIncident.reset();
        await openIncident(incident.id);
      }, 'Incident opened.');
    });
  }

  function start() {
    $('signin-view').hidden = true;
    $('signin-status').textContent = '';
    $('app').hidden = false;
    act(null, showReports);
  }

  fill();
  wire();
  token = readToken();
  if (token) start();
})();
