/* Emergency Change form: fill in, generate an Outlook-ready approval email, copy to clipboard. */
(() => {
  const session = PH.requireLogin();
  if (!session) return;

  const $ = (id) => document.getElementById(id);
  const { el } = PH;
  const DRAFT_KEY = 'ph_ecr_draft';

  $('userChip').textContent = `${session.username} · ${session.role}`;
  if (PH.isAdmin(session)) $('adminBtn').hidden = false;
  $('logoutBtn').onclick = () => { PH.clearSession(); location.href = 'index.html'; };

  // Rows of the Information/Description table. `shade` mirrors the darker rows in the original template.
  const FIELDS = [
    { key: 'ecrNumber', label: 'Emergency Change Number', placeholder: 'e.g. ECR-673' },
    { key: 'incident', label: 'Incident Number (if any)' },
    { key: 'changeType', label: 'Emergency Change Type' },
    { key: 'justification', label: 'Justification / Reason for change', special: 'justification' },
    { key: 'system', label: 'System Name' },
    { key: 'description', label: 'Change Description', multiline: true },
    { key: 'reasonNoCR', label: 'Reason for not raising Normal CR', multiline: true },
    { key: 'institutions', label: 'Institution(s) Affected', shade: true },
    { key: 'deployWindow', label: 'Deployment window (Start and End Date/Time, including rollback)', special: 'window' },
    { key: 'downtime', label: 'Downtime Window (Start and End Date/Time, including rollback)', special: 'window' },
    { key: 'impact', label: 'Business Impact', multiline: true, shade: true },
    { key: 'dependencies', label: 'Indicate System Dependencies', multiline: true },
    { key: 'rollback', label: 'Is there roll-back plan?', multiline: true, shade: true },
    { key: 'directorApproval', label: 'Program/Infra Director Approval', shade: true },
    { key: 'ownerApproval', label: 'System Owner/Custodian Approval' },
    { key: 'uat', label: 'UAT signoff', multiline: true },
    { key: 'implPlan', label: 'Implementation Plan', multiline: true }
  ];
  const APPROVERS = ['Reporting Officer', 'Product Specialist', 'Service Lead', 'Project Director'];
  const STATUSES = ['Pending Approval', 'Approved', 'Rejected'];

  const data = Object.assign(
    { approvals: APPROVERS.map(division => ({ division, name: '', status: STATUSES[0], attachment: '' })) },
    PH.readLocal(DRAFT_KEY) || {}
  );
  // Older drafts stored the window fields as free text; keep that text as the note.
  for (const f of FIELDS) {
    if (f.special === 'window' && typeof data[f.key] !== 'object') data[f.key] = { note: data[f.key] || '' };
  }
  const save = () => PH.writeLocal(DRAFT_KEY, data);

  // The approver who still needs to approve: first one not yet Approved (the last one if all have).
  const addressee = () => data.approvals.find(a => a.status !== 'Approved') || data.approvals[data.approvals.length - 1];

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

  // el() drops empty attributes, so set the placeholder option's empty value directly.
  function blankOption(text) { const o = el('option', { text }); o.value = ''; return o; }

  // 24-hour time picker: hour and minute selects (browser time inputs may show AM/PM).
  function timePicker(value, onChange) {
    const [h, m] = (value || '').split(':');
    const hour = el('select', { class: 'ecr-time', title: 'Hour (24h)' },
      [blankOption('HH'),...Array.from({ length: 24 }, (_, i) => el('option', { text: pad(i) }))]);
    const min = el('select', { class: 'ecr-time', title: 'Minute' },
      [blankOption('MM'),...Array.from({ length: 12 }, (_, i) => el('option', { text: pad(i * 5) }))]);
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
    const note = el('input', { placeholder: 'Note (optional), e.g. includes 1h rollback' });
    note.value = w.note || '';
    note.oninput = () => { w.note = note.value; save(); };

    refresh();
    return [point('start', 'Start'), point('end', 'End'), preview, note];
  }

  // ---------- form ----------
  function input(key, { multiline, placeholder, rows } = {}) {
    const node = multiline ? el('textarea', { rows: rows || 2, placeholder }) : el('input', { placeholder });
    node.value = data[key] || '';
    node.oninput = () => { data[key] = node.value; save(); };
    return node;
  }

  $('infoRows').replaceChildren(...FIELDS.map(f => {
    let cell;
    if (f.special === 'justification') {
      cell = el('td', {}, [
        el('label', { class: 'ecr-inline-label', text: 'Background:' }),
        input('background', { multiline: true, rows: 3 }),
        el('label', { class: 'ecr-inline-label', text: 'Changes: (one item per line)' }),
        input('changes', { multiline: true, rows: 3, placeholder: 'Microsoft Edge Chromium\nWindows Patch 2022 Server' })
      ]);
    } else if (f.special === 'window') {
      cell = el('td', {}, windowInput(f.key));
    } else {
      cell = el('td', {}, input(f.key, f));
    }
    if (f.shade) cell.classList.add('shade');
    return el('tr', {}, [el('th', { text: f.label }), cell]);
  }));

  function renderApprovals() {
    $('approvalRows').replaceChildren(...data.approvals.map((a, i) => {
      const name = el('input', { placeholder: 'Name' });
      name.value = a.name;
      name.oninput = () => { a.name = name.value; save(); };
      const status = el('select', {}, STATUSES.map(s => el('option', { text: s })));
      status.value = a.status;
      status.onchange = () => { a.status = status.value; save(); };
      const attach = el('input', { placeholder: 'optional' });
      attach.value = a.attachment;
      attach.oninput = () => { a.attachment = attach.value; save(); };

      let division = a.division;
      if (a.custom) {
        division = el('input', { placeholder: 'Division / role' });
        division.value = a.division;
        division.oninput = () => { a.division = division.value; save(); };
      }
      const remove = el('button', { class: 'ecr-remove', type: 'button', title: 'Remove approver', text: '✕' });
      remove.onclick = () => { data.approvals.splice(i, 1); save(); renderApprovals(); };

      return el('tr', {}, [
        el('td', {}, name),
        a.custom ? el('td', {}, division) : el('td', { text: division }),
        el('td', {}, status), el('td', {}, attach), el('td', { class: 'ecr-x' }, remove)
      ]);
    }));
  }
  renderApprovals();
  $('addApproverBtn').onclick = () => {
    data.approvals.push({ division: '', name: '', status: STATUSES[0], attachment: '', custom: true });
    save();
    renderApprovals();
  };

  // ---------- email generation ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = (s) => esc(s).replace(/\r?\n/g, '<br>');
  const changeItems = () => String(data.changes || '').split('\n').map(s => s.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

  // "A", "A and B", "A, B and C"
  function joinItems(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  function subject() {
    return `Email Approval for Emergency Change ${data.ecrNumber || ''} – VA scan issue fixes`.replace(/\s+/g, ' ').trim();
  }

  // Inline styles only — Outlook ignores <style> blocks and most CSS classes.
  const FONT = 'font-family:Arial,sans-serif;font-size:10pt;color:#000;';
  const CELL = `${FONT}border:1px solid #000;padding:3px 5px;vertical-align:middle;`;
  const BLUE = '#5b9bd5', LIGHT = '#e9eef7', DARK = '#d0dcef';

  function buildEmailHtml() {
    const ro = addressee();
    const infoRows = FIELDS.map(f => {
      const value = f.special === 'justification'
        ? `<b><u>Background:</u></b><br>${lines(data.background)}<br><br><b><u>Changes:</u></b><br>${changeItems().map(esc).join('<br>')}`
        : f.special === 'window' ? [esc(formatRange(data[f.key])), lines(data[f.key].note)].filter(Boolean).join('<br>')
        : lines(data[f.key]);
      return `<tr>
        <td style="${CELL}background:${BLUE};font-weight:bold;width:260px;">${esc(f.label)}</td>
        <td style="${CELL}background:${f.shade ? DARK : LIGHT};">${value || '&nbsp;'}</td>
      </tr>`;
    }).join('');

    const approvalRows = data.approvals.map(a => `<tr>
        <td style="${CELL}">${esc(a.name) || '&nbsp;'}</td>
        <td style="${CELL}">${esc(a.division)}</td>
        <td style="${CELL}white-space:nowrap;">${esc(a.status)}</td>
        <td style="${CELL}">${esc(a.attachment) || '&nbsp;'}</td>
      </tr>`).join('');

    return `<div style="${FONT}">
      <p style="${FONT}margin:0 0 12px;">Dear ${esc(ro.name)},</p>
      <p style="${FONT}margin:0 0 12px;">I would like to seek your email approval for <b>Emergency Change ${esc(data.ecrNumber)}</b> – To roll out VA scan issue fixes to resolve ${esc(joinItems(changeItems()))}.</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:760px;">
        <tr>
          <td style="${CELL}background:${BLUE};font-weight:bold;text-align:center;width:260px;">Information</td>
          <td style="${CELL}background:${BLUE};font-weight:bold;text-align:center;">Description</td>
        </tr>
        ${infoRows}
      </table>
      <p style="${FONT}margin:16px 0 4px;"><b><u>Deployment Approval:</u></b></p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:700px;">
        <tr>
          <td style="${CELL}font-weight:bold;width:140px;">Name</td>
          <td style="${CELL}font-weight:bold;width:160px;">Division/Synapxe</td>
          <td style="${CELL}font-weight:bold;width:130px;white-space:nowrap;">Status of Approval</td>
          <td style="${CELL}font-weight:bold;">Email Attachment</td>
        </tr>
        ${approvalRows}
      </table>
    </div>`;
  }

  function buildEmailText() {
    const ro = addressee();
    const out = [
      `Dear ${ro.name},`, '',
      `I would like to seek your email approval for Emergency Change ${data.ecrNumber} – To roll out VA scan issue fixes to resolve ${joinItems(changeItems())}.`, ''
    ];
    for (const f of FIELDS) {
      if (f.special === 'justification') {
        out.push(`${f.label}:`, `  Background: ${data.background || ''}`, `  Changes: ${changeItems().join('; ')}`);
      } else {
        const value = f.special === 'window' ? [formatRange(data[f.key]), data[f.key].note].filter(Boolean).join(' – ') : data[f.key] || '';
        out.push(`${f.label}: ${value}`);
      }
    }
    out.push('', 'Deployment Approval:');
    for (const a of data.approvals) out.push(`${a.name} | ${a.division} | ${a.status} | ${a.attachment}`);
    return out.join('\n');
  }

  // ---------- clipboard ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  async function copyRich(html, text) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
      return true;
    } catch {
      // Fallback for browsers without ClipboardItem: copy the rendered preview selection.
      const range = document.createRange();
      range.selectNodeContents($('preview'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      return ok;
    }
  }

  async function copyEmail() {
    const ok = await copyRich(buildEmailHtml(), buildEmailText());
    toast(ok ? 'Email copied — paste into Outlook with Ctrl+V' : 'Copy failed — select the preview and press Ctrl+C');
  }

  $('createBtn').onclick = async () => {
    const missing = [];
    if (!String(data.ecrNumber || '').trim()) missing.push('Emergency Change Number');
    if (!changeItems().length) missing.push('Changes');
    const to = addressee();
    if (!to) missing.push('at least one approver');
    else if (!to.name.trim()) missing.push(`${to.division || 'approver'} name`);
    const errors = [
      missing.length ? `Please fill in: ${missing.join(', ')}.` : '',
      windowError(data.deployWindow, 'Deployment window'),
      windowError(data.downtime, 'Downtime window')
    ].filter(Boolean);
    $('ecrError').textContent = errors.join(' ');
    if (errors.length) return;

    $('preview').innerHTML = buildEmailHtml();
    $('previewWrap').hidden = false;
    await copyEmail();
    $('previewWrap').scrollIntoView({ behavior: 'smooth' });
  };
  $('copyBtn').onclick = copyEmail;
  $('copySubjectBtn').onclick = async () => {
    await navigator.clipboard.writeText(subject());
    toast('Subject copied');
  };
  $('clearBtn').onclick = () => {
    if (!confirm('Clear all fields?')) return;
    PH.writeLocal(DRAFT_KEY, null);
    location.reload();
  };
})();
