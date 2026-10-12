/* Shared engine for approval-email templates (Emergency Change, Pre-Approved Change, …).
   A page calls PHTemplate.mount(config); the engine builds the form, keeps a per-browser draft,
   generates Outlook-ready HTML and copies it to the clipboard. */
const PHTemplate = (() => {
  const { el } = PH;
  const $ = (id) => document.getElementById(id);

  // ---------- text helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = (html) => html.replace(/https?:\/\/[^\s<]+[^\s<.,;:)]/g, url => `<a href="${url}" style="color:#0563c1;">${url}</a>`);
  const lines = (s) => linkify(esc(s).replace(/\r?\n/g, '<br>'));
  // "1st" -> 1<sup>st</sup> (expects already-escaped HTML)
  const ordinals = (html) => html.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1<sup>$2</sup>');
  // One item per line; leading "-", "•", "1." etc. removed.
  const listItems = (s) => String(s || '').split('\n').map(x => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  // "A", "A and B", "A, B and C"
  const joinItems = (items) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

  // el() drops empty attributes, so set the placeholder option's empty value directly.
  function blankOption(text) { const o = el('option', { text }); o.value = ''; return o; }

  // ---------- date/time windows ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');

  // '2026-09-17', '21:00' -> '17-Sep-26 (Thu) 21:00'
  function formatPoint(date, time) {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    const day = DAYS[new Date(y, m - 1, d).getDay()];
    return `${pad(d)}-${MONTHS[m - 1]}-${String(y).slice(-2)} (${day})${time ? ' ' + time : ''}`;
  }
  function formatRange(w) {
    const start = formatPoint(w.startDate, w.startTime), end = formatPoint(w.endDate, w.endTime);
    return start && end ? `${start} to ${end}` : start || end;
  }
  function windowError(w, label) {
    if (!w.startDate || !w.endDate) return '';
    const start = `${w.startDate}T${w.startTime || '00:00'}`, end = `${w.endDate}T${w.endTime || '00:00'}`;
    return end <= start ? `${label}: end must be after start.` : '';
  }

  // 24-hour time picker: hour and minute selects (browser time inputs may show AM/PM).
  function timePicker(value, onChange) {
    const [h, m] = (value || '').split(':');
    const hour = el('select', { class: 'ecr-time', title: 'Hour (24h)' },
      [blankOption('HH'), ...Array.from({ length: 24 }, (_, i) => el('option', { text: pad(i) }))]);
    const min = el('select', { class: 'ecr-time', title: 'Minute' },
      [blankOption('MM'), ...Array.from({ length: 12 }, (_, i) => el('option', { text: pad(i * 5) }))]);
    hour.value = h || '';
    min.value = m || '';
    const update = () => {
      if (hour.value && !min.value) min.value = '00';
      onChange(hour.value ? `${hour.value}:${min.value}` : '');
    };
    hour.onchange = update;
    min.onchange = update;
    return el('span', { class: 'ecr-timepair' }, [hour, el('span', { text: ':' }), min]);
  }

  // ---------- email styling (inline only — Outlook ignores <style> blocks) ----------
  const FONT = 'font-family:Arial,sans-serif;font-size:10pt;color:#000;';
  const CELL = `${FONT}border:1px solid #000;padding:3px 5px;vertical-align:middle;`;
  const BLUE = '#5b9bd5';
  const STATUSES = ['Pending Approval', 'Approved', 'Rejected'];

  function mount(cfg) {
    const session = PH.requireLogin();
    if (!session) return;

    $('userChip').textContent = `${session.username} · ${session.role}`;
    if (PH.isAdmin(session)) $('adminBtn').hidden = false;
    $('logoutBtn').onclick = () => { PH.clearSession(); location.href = 'index.html'; };
    document.title = cfg.title;
    $('siteTitle').textContent = cfg.shortTitle || cfg.title;

    const colors = { light: '#e9eef7', dark: '#d0dcef', ...cfg.colors };
    const introFields = cfg.introFields || [];
    const allFields = [...introFields, ...cfg.fields];

    const data = Object.assign(
      { approvals: cfg.approvers.map(division => ({ division, name: '', status: STATUSES[0], attachment: '' })) },
      PH.readLocal(cfg.draftKey) || {}
    );
    // Window fields are objects; older drafts stored free text, which becomes the note.
    for (const f of allFields) {
      if (f.type === 'window' && typeof data[f.key] !== 'object') data[f.key] = { note: data[f.key] || '' };
    }
    const save = () => PH.writeLocal(cfg.draftKey, data);

    // The approver who still needs to approve: first one not yet Approved (the last one if all have).
    const addressee = () => data.approvals.find(a => a.status !== 'Approved') || data.approvals[data.approvals.length - 1];

    // ---------- inputs ----------
    function input(key, { multiline, placeholder, rows } = {}) {
      const node = multiline ? el('textarea', { rows: rows || 2, placeholder }) : el('input', { placeholder });
      node.value = data[key] || '';
      node.oninput = () => { data[key] = node.value; save(); };
      return node;
    }

    function windowInput(key) {
      const w = data[key];
      const preview = el('div', { class: 'ecr-window-preview' });
      const refresh = () => { save(); preview.textContent = formatRange(w) || 'Pick start and end date/time'; };
      const point = (prefix, label) => {
        const date = el('input', { type: 'date' });
        date.value = w[prefix + 'Date'] || '';
        date.oninput = () => { w[prefix + 'Date'] = date.value; refresh(); };
        return el('div', { class: 'ecr-window-point' }, [
          el('span', { class: 'ecr-window-label', text: label }), date,
          timePicker(w[prefix + 'Time'], (t) => { w[prefix + 'Time'] = t; refresh(); })
        ]);
      };
      const note = el('input', { placeholder: 'Note (optional), e.g. Broadcast Message has been sent to the users' });
      note.value = w.note || '';
      note.oninput = () => { w.note = note.value; save(); };
      refresh();
      return [point('start', 'Start'), point('end', 'End'), preview, note];
    }

    const ctx = { data, save, input, esc, lines, ordinals, listItems, joinItems, blankOption, addressee };

    function fieldInput(f) {
      if (f.type === 'custom') return f.render(ctx);
      if (f.type === 'window') return windowInput(f.key);
      if (f.type === 'list') return input(f.key, { multiline: true, rows: f.rows || 2, placeholder: f.placeholder });
      return input(f.key, f);
    }
    const cellBg = (f) => f.bg || (f.shade ? colors.dark : colors.light);

    function fieldHtml(f) {
      if (f.type === 'custom') return f.html(ctx);
      if (f.type === 'window') return [esc(formatRange(data[f.key])), lines(data[f.key].note)].filter(Boolean).join('<br>');
      if (f.type === 'list') return listItems(data[f.key]).map((s, i) => `${i + 1}.&nbsp;&nbsp;&nbsp;${esc(s)}`).join('<br>');
      return lines(data[f.key]);
    }
    function fieldText(f) {
      if (f.type === 'custom') return f.text(ctx);
      if (f.type === 'window') return [formatRange(data[f.key]), data[f.key].note].filter(Boolean).join(' – ');
      if (f.type === 'list') return listItems(data[f.key]).join(', ');
      return data[f.key] || '';
    }

    // ---------- page ----------
    const rows = (fields) => fields.map(f => {
      const cell = el('td', {}, fieldInput(f));
      cell.style.background = cellBg(f);
      return el('tr', {}, [el('th', {}, [el('span', { text: f.label }), f.hint ? el('div', { class: 'ecr-field-hint', text: f.hint }) : null]), cell]);
    });

    const approvalRows = el('tbody');
    const error = el('div', { class: 'error' });
    const preview = el('div', { class: 'ecr-preview' });
    const previewWrap = el('section', {}, [
      el('div', { class: 'ecr-preview-head' }, [
        el('h3', { class: 'ecr-sub', text: 'Email preview' }),
        button('Copy email again', 'btn btn-sm', copyEmail)
      ]),
      preview
    ]);
    previewWrap.hidden = true;

    function button(text, cls, onClick) {
      const b = el('button', { class: cls, type: 'button', text });
      b.onclick = onClick;
      return b;
    }

    const infoHead = el('thead', {}, el('tr', {}, [el('th', { text: 'Information' }), el('th', { text: 'Description' })]));
    if (cfg.headerAlign === 'left') infoHead.classList.add('align-left');

    $('app').replaceChildren(
      el('h1', { text: cfg.title }),
      el('p', { class: 'muted', text: 'Fill in the form, then click Create template. The email is copied with formatting, so you can paste it straight into Outlook (Ctrl+V).' }),
      introFields.length ? el('h3', { class: 'ecr-sub', text: 'Email intro' }) : null,
      introFields.length ? el('table', { class: 'ecr-table ecr-intro' }, el('tbody', {}, rows(introFields))) : null,
      introFields.length ? el('h3', { class: 'ecr-sub', text: 'Details' }) : null,
      el('table', { class: 'ecr-table' }, [infoHead, el('tbody', {}, rows(cfg.fields))]),
      el('h3', { class: 'ecr-sub', text: cfg.approvalsTitle }),
      el('table', { class: 'ecr-table ecr-approval' }, [
        el('thead', {}, el('tr', {}, ['Name', 'Division/Synapxe', 'Status of Approval', 'Email Attachment', '']
          .map((t, i) => el('th', { text: t, class: i === 4 ? 'ecr-x' : undefined })))),
        approvalRows
      ]),
      button('+ Add approver', 'btn btn-sm', () => {
        data.approvals.push({ division: '', name: '', status: STATUSES[0], attachment: '', custom: true });
        save();
        renderApprovals();
      }),
      el('p', { class: 'muted ecr-hint', text: 'The email is addressed to the first approver whose status is not Approved.' }),
      error,
      el('div', { class: 'props-actions' }, [
        button('Create template', 'btn btn-primary', create),
        button('Copy subject', 'btn', async () => { await navigator.clipboard.writeText(cfg.subject(ctx)); toast('Subject copied'); }),
        button('Clear form', 'btn btn-danger', () => {
          if (!confirm('Clear all fields?')) return;
          PH.writeLocal(cfg.draftKey, null);
          location.reload();
        })
      ]),
      previewWrap
    );

    function renderApprovals() {
      approvalRows.replaceChildren(...data.approvals.map((a, i) => {
        const name = el('input', { placeholder: 'Name' });
        name.value = a.name;
        name.oninput = () => { a.name = name.value; save(); };
        const status = el('select', {}, STATUSES.map(s => el('option', { text: s })));
        status.value = a.status;
        status.onchange = () => { a.status = status.value; save(); };
        const attach = el('input', { placeholder: 'optional' });
        attach.value = a.attachment;
        attach.oninput = () => { a.attachment = attach.value; save(); };

        let division = el('td', { text: a.division });
        if (a.custom) {
          const d = el('input', { placeholder: 'Division / role' });
          d.value = a.division;
          d.oninput = () => { a.division = d.value; save(); };
          division = el('td', {}, d);
        }
        const remove = button('✕', 'ecr-remove', () => { data.approvals.splice(i, 1); save(); renderApprovals(); });
        remove.title = 'Remove approver';

        return el('tr', {}, [el('td', {}, name), division, el('td', {}, status), el('td', {}, attach), el('td', { class: 'ecr-x' }, remove)]);
      }));
    }
    renderApprovals();

    // ---------- email ----------
    function buildEmailHtml() {
      const headAlign = cfg.headerAlign === 'left' ? 'left' : 'center';
      const infoRowsHtml = cfg.fields.map(f => `<tr>
        <td style="${CELL}background:${BLUE};font-weight:bold;width:260px;">${esc(f.label).replace(/\n/g, '<br>')}</td>
        <td style="${CELL}background:${cellBg(f)};">${fieldHtml(f) || '&nbsp;'}</td>
      </tr>`).join('');
      const approvalRowsHtml = data.approvals.map(a => `<tr>
        <td style="${CELL}">${esc(a.name) || '&nbsp;'}</td>
        <td style="${CELL}">${esc(a.division)}</td>
        <td style="${CELL}white-space:nowrap;">${esc(a.status)}</td>
        <td style="${CELL}">${esc(a.attachment) || '&nbsp;'}</td>
      </tr>`).join('');
      const title = cfg.approvalsUnderline ? `<b><u>${esc(cfg.approvalsTitle)}</u></b>` : `<b>${esc(cfg.approvalsTitle)}</b>`;

      return `<div style="${FONT}">
      <p style="${FONT}margin:0 0 12px;">Dear ${esc(addressee().name)},</p>
      <p style="${FONT}margin:0 0 12px;">${cfg.introHtml(ctx)}</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:760px;">
        <tr>
          <td style="${CELL}background:${BLUE};font-weight:bold;text-align:${headAlign};width:260px;">Information</td>
          <td style="${CELL}background:${BLUE};font-weight:bold;text-align:${headAlign};">Description</td>
        </tr>
        ${infoRowsHtml}
      </table>
      <p style="${FONT}margin:16px 0 4px;">${title}</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:700px;">
        <tr>
          <td style="${CELL}font-weight:bold;width:140px;">Name</td>
          <td style="${CELL}font-weight:bold;width:160px;">Division/Synapxe</td>
          <td style="${CELL}font-weight:bold;width:130px;white-space:nowrap;">Status of Approval</td>
          <td style="${CELL}font-weight:bold;">Email Attachment</td>
        </tr>
        ${approvalRowsHtml}
      </table>
    </div>`;
    }

    function buildEmailText() {
      const out = [`Dear ${addressee().name},`, '', cfg.introText(ctx), ''];
      for (const f of cfg.fields) out.push(`${f.label.replace(/\n/g, ' ')}: ${fieldText(f)}`);
      out.push('', cfg.approvalsTitle);
      for (const a of data.approvals) out.push(`${a.name} | ${a.division} | ${a.status} | ${a.attachment}`);
      return out.join('\n');
    }

    // ---------- actions ----------
    async function create() {
      const missing = cfg.validate(ctx);
      const to = addressee();
      if (!to) missing.push('at least one approver');
      else if (!to.name.trim()) missing.push(`${to.division || 'approver'} name`);
      const errors = [
        missing.length ? `Please fill in: ${missing.join(', ')}.` : '',
        ...allFields.filter(f => f.type === 'window').map(f => windowError(data[f.key], f.label.split(/[\n(]/)[0].trim()))
      ].filter(Boolean);
      error.textContent = errors.join(' ');
      if (errors.length) return;

      preview.innerHTML = buildEmailHtml();
      previewWrap.hidden = false;
      await copyEmail();
      previewWrap.scrollIntoView({ behavior: 'smooth' });
    }

    async function copyEmail() {
      const ok = await copyRich(buildEmailHtml(), buildEmailText(), preview);
      toast(ok ? 'Email copied — paste into Outlook with Ctrl+V' : 'Copy failed — select the preview and press Ctrl+C');
    }
  }

  async function copyRich(html, text, fallbackNode) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
      return true;
    } catch {
      // Fallback for browsers without ClipboardItem: copy the rendered preview selection.
      const range = document.createRange();
      range.selectNodeContents(fallbackNode);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      return ok;
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  return { mount };
})();
