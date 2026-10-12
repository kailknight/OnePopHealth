/* Shared helpers: session, data loading, widget registry and page renderer. */
const PH = (() => {
  const KEYS = {
    session: 'ph_session',
    lastPublished: 'ph_last_published',
    layoutDraft: 'ph_layout_draft',
    usersDraft: 'ph_users_draft',
    github: 'ph_github'
  };

  // ---------- storage ----------
  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeLocal(key, value) {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }

  async function fetchJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  }

  // Drafts (unpublished edits made in this browser) take precedence over published files.
  async function getUsers() {
    return readLocal(KEYS.usersDraft) || fetchJSON('data/users.json');
  }
  async function getPublishedUsers() { return fetchJSON('data/users.json'); }
  async function getLayout() {
    return readLocal(KEYS.layoutDraft) || fetchJSON('data/layout.json');
  }
  async function getPublishedLayout() { return fetchJSON('data/layout.json'); }

  // Drop local drafts that are identical to what is now published (e.g. after a publish has gone live).
  async function reconcileDrafts() {
    const pairs = [[KEYS.layoutDraft, 'data/layout.json'], [KEYS.usersDraft, 'data/users.json']];
    await Promise.all(pairs.map(async ([key, path]) => {
      const draft = readLocal(key);
      if (!draft) return;
      try {
        if (JSON.stringify(draft) === JSON.stringify(await fetchJSON(path))) writeLocal(key, null);
      } catch { /* keep draft if published file is unreachable */ }
    }));
  }

  // 'none' | 'deploying' (published, waiting for GitHub Pages) | 'unpublished'
  function draftState() {
    const layout = readLocal(KEYS.layoutDraft), users = readLocal(KEYS.usersDraft);
    if (!layout && !users) return 'none';
    const last = readLocal(KEYS.lastPublished) || {};
    const same = (draft, published) => !draft || JSON.stringify(draft) === published;
    return same(layout, last.layout) && same(users, last.users) ? 'deploying' : 'unpublished';
  }

  // ---------- session ----------
  function getSession() { return readLocal(KEYS.session); }
  function setSession(user) { writeLocal(KEYS.session, { username: user.username, role: user.role }); }
  function clearSession() { writeLocal(KEYS.session, null); }
  function isAdmin(session) { return !!session && String(session.role).toLowerCase() === 'admin'; }

  function requireLogin() {
    const s = getSession();
    if (!s) { location.replace('index.html'); return null; }
    return s;
  }
  function requireAdmin() {
    const s = requireLogin();
    if (s && !isAdmin(s)) { location.replace('main.html'); return null; }
    return s;
  }

  // ---------- utils ----------
  function uid() { return 'b' + Math.random().toString(36).slice(2, 9); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Only allow http(s), mailto, tel, relative and anchor links.
  function safeUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u) || /^[#/.?]/.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    return '';
  }

  function toEmbedUrl(url) {
    const u = safeUrl(url);
    if (!/^https:/i.test(u)) return '';
    const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    return u;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'style') Object.assign(node.style, v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  // ---------- widget registry ----------
  const commonFields = [
    { key: 'width', label: 'Width', type: 'select', options: [
      { value: 12, label: 'Full' }, { value: 9, label: '3/4' }, { value: 8, label: '2/3' },
      { value: 6, label: '1/2' }, { value: 4, label: '1/3' }, { value: 3, label: '1/4' }
    ] },
    { key: 'padding', label: 'Padding (px)', type: 'number', min: 0, max: 200 }
  ];
  const alignField = { key: 'align', label: 'Align', type: 'select', options: ['left', 'center', 'right'] };

  const WIDGETS = {
    hero: {
      label: 'Hero banner', icon: '★',
      defaults: { title: 'Big headline', subtitle: 'Supporting text', background: '#2563eb', color: '#ffffff', image: '', buttonText: 'Get started', buttonUrl: '#', width: 12, padding: 0 },
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
        { key: 'background', label: 'Background', type: 'color' },
        { key: 'color', label: 'Text color', type: 'color' },
        { key: 'image', label: 'Background image URL', type: 'text' },
        { key: 'buttonText', label: 'Button text', type: 'text' },
        { key: 'buttonUrl', label: 'Button link', type: 'text' }
      ],
      render(p, theme) {
        const style = { background: p.background, color: p.color, textAlign: 'center', borderRadius: '12px' };
        if (safeUrl(p.image)) {
          style.backgroundImage = `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url("${encodeURI(safeUrl(p.image))}")`;
          style.backgroundSize = 'cover';
          style.backgroundPosition = 'center';
        }
        return el('div', { class: 'w-hero', style }, [
          el('h1', { text: p.title }),
          p.subtitle ? el('p', { text: p.subtitle }) : null,
          p.buttonText ? el('a', { class: 'w-button', href: safeUrl(p.buttonUrl) || '#', text: p.buttonText,
            style: { background: p.color, color: p.background } }) : null
        ]);
      }
    },
    heading: {
      label: 'Heading', icon: 'H',
      defaults: { text: 'New heading', level: 'h2', align: 'left', color: '', width: 12, padding: 8 },
      fields: [
        { key: 'text', label: 'Text', type: 'text' },
        { key: 'level', label: 'Size', type: 'select', options: ['h1', 'h2', 'h3', 'h4'] },
        alignField,
        { key: 'color', label: 'Color', type: 'color' }
      ],
      render(p) {
        const level = ['h1', 'h2', 'h3', 'h4'].includes(p.level) ? p.level : 'h2';
        return el(level, { class: 'w-heading', text: p.text, style: { textAlign: p.align, color: p.color || undefined } });
      }
    },
    text: {
      label: 'Paragraph', icon: '¶',
      defaults: { text: 'Write something here…', align: 'left', color: '', size: 16, width: 12, padding: 8 },
      fields: [
        { key: 'text', label: 'Text', type: 'textarea' },
        alignField,
        { key: 'size', label: 'Font size (px)', type: 'number', min: 10, max: 48 },
        { key: 'color', label: 'Color', type: 'color' }
      ],
      render(p) {
        return el('p', { class: 'w-text', text: p.text,
          style: { textAlign: p.align, color: p.color || undefined, fontSize: `${p.size}px` } });
      }
    },
    image: {
      label: 'Image', icon: '🖼',
      defaults: { src: 'https://picsum.photos/800/400', alt: 'Image', caption: '', radius: 8, align: 'center', width: 12, padding: 8 },
      fields: [
        { key: 'src', label: 'Image URL', type: 'text' },
        { key: 'alt', label: 'Alt text', type: 'text' },
        { key: 'caption', label: 'Caption', type: 'text' },
        { key: 'radius', label: 'Corner radius (px)', type: 'number', min: 0, max: 100 },
        alignField
      ],
      render(p) {
        return el('figure', { class: 'w-image', style: { textAlign: p.align } }, [
          safeUrl(p.src) ? el('img', { src: safeUrl(p.src), alt: p.alt, style: { borderRadius: `${p.radius}px` } }) : el('div', { class: 'w-empty', text: 'No image URL' }),
          p.caption ? el('figcaption', { text: p.caption }) : null
        ]);
      }
    },
    button: {
      label: 'Button', icon: '⬭',
      defaults: { text: 'Click me', url: '#', background: '', color: '#ffffff', align: 'left', newTab: false, width: 12, padding: 8 },
      fields: [
        { key: 'text', label: 'Text', type: 'text' },
        { key: 'url', label: 'Link', type: 'text' },
        { key: 'background', label: 'Background (blank = accent)', type: 'color' },
        { key: 'color', label: 'Text color', type: 'color' },
        alignField,
        { key: 'newTab', label: 'Open in new tab', type: 'checkbox' }
      ],
      render(p, theme) {
        const a = el('a', { class: 'w-button', href: safeUrl(p.url) || '#', text: p.text,
          style: { background: p.background || theme.accent, color: p.color } });
        if (p.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
        return el('div', { style: { textAlign: p.align } }, a);
      }
    },
    card: {
      label: 'Card', icon: '▭',
      defaults: { title: 'Card title', body: 'Card description', image: '', linkText: '', linkUrl: '', background: '#ffffff', width: 4, padding: 24 },
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'textarea' },
        { key: 'image', label: 'Image URL', type: 'text' },
        { key: 'linkText', label: 'Link text', type: 'text' },
        { key: 'linkUrl', label: 'Link URL', type: 'text' },
        { key: 'background', label: 'Background', type: 'color' }
      ],
      render(p, theme) {
        return el('div', { class: 'w-card', style: { background: p.background } }, [
          safeUrl(p.image) ? el('img', { src: safeUrl(p.image), alt: '' }) : null,
          el('h3', { text: p.title }),
          p.body ? el('p', { text: p.body }) : null,
          p.linkText ? el('a', { href: safeUrl(p.linkUrl) || '#', text: p.linkText + ' →', style: { color: theme.accent } }) : null
        ]);
      }
    },
    list: {
      label: 'List', icon: '☰',
      defaults: { items: 'First item\nSecond item\nThird item', ordered: false, width: 12, padding: 8 },
      fields: [
        { key: 'items', label: 'Items (one per line)', type: 'textarea' },
        { key: 'ordered', label: 'Numbered', type: 'checkbox' }
      ],
      render(p) {
        const items = String(p.items || '').split('\n').filter(s => s.trim());
        return el(p.ordered ? 'ol' : 'ul', { class: 'w-list' }, items.map(t => el('li', { text: t })));
      }
    },
    embed: {
      label: 'Video / Embed', icon: '▶',
      defaults: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', height: 360, width: 12, padding: 8 },
      fields: [
        { key: 'url', label: 'URL (YouTube or https page)', type: 'text' },
        { key: 'height', label: 'Height (px)', type: 'number', min: 100, max: 1200 }
      ],
      render(p) {
        const src = toEmbedUrl(p.url);
        if (!src) return el('div', { class: 'w-empty', text: 'Enter an https:// URL' });
        return el('iframe', { class: 'w-embed', src, height: p.height, allowfullscreen: '', loading: 'lazy',
          referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups' });
      }
    },
    divider: {
      label: 'Divider', icon: '—',
      defaults: { color: '#d1d5db', thickness: 1, width: 12, padding: 8 },
      fields: [
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'thickness', label: 'Thickness (px)', type: 'number', min: 1, max: 20 }
      ],
      render(p) {
        return el('hr', { class: 'w-divider', style: { borderTop: `${p.thickness}px solid ${p.color}` } });
      }
    },
    spacer: {
      label: 'Spacer', icon: '↕',
      defaults: { height: 40, width: 12, padding: 0 },
      fields: [{ key: 'height', label: 'Height (px)', type: 'number', min: 4, max: 400 }],
      render(p) { return el('div', { class: 'w-spacer', style: { height: `${p.height}px` } }); }
    }
  };
  for (const w of Object.values(WIDGETS)) w.fields = [...w.fields, ...commonFields];

  const THEME_FIELDS = [
    { key: 'siteTitle', label: 'Site title', type: 'text' },
    { key: 'background', label: 'Page background', type: 'color' },
    { key: 'text', label: 'Text color', type: 'color' },
    { key: 'accent', label: 'Accent color', type: 'color' },
    { key: 'headerBg', label: 'Header background', type: 'color' },
    { key: 'headerText', label: 'Header text', type: 'color' },
    { key: 'font', label: 'Font', type: 'select', options: [
      { value: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', label: 'System' },
      { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
      { value: '"Trebuchet MS", Verdana, sans-serif', label: 'Humanist' },
      { value: '"Courier New", monospace', label: 'Monospace' }
    ] },
    { key: 'maxWidth', label: 'Content max width (px)', type: 'number', min: 600, max: 2000 }
  ];

  // ---------- rendering ----------
  function applyTheme(theme, root = document.documentElement) {
    root.style.setProperty('--page-bg', theme.background);
    root.style.setProperty('--page-text', theme.text);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--header-bg', theme.headerBg);
    root.style.setProperty('--header-text', theme.headerText);
    root.style.setProperty('--page-font', theme.font);
    root.style.setProperty('--max-width', `${theme.maxWidth}px`);
  }

  function renderBlock(block, theme) {
    const def = WIDGETS[block.type];
    const props = { ...(def ? def.defaults : {}), ...block.props };
    const inner = def ? def.render(props, theme) : el('div', { class: 'w-empty', text: `Unknown block: ${block.type}` });
    const wrap = el('div', { class: 'ph-block', 'data-id': block.id }, inner);
    wrap.style.gridColumn = `span ${Math.min(12, Math.max(1, Number(props.width) || 12))}`;
    wrap.style.padding = `${Number(props.padding) || 0}px`;
    return wrap;
  }

  function renderPage(layout, container) {
    container.replaceChildren(...layout.blocks.map(b => renderBlock(b, layout.theme)));
  }

  return {
    KEYS, readLocal, writeLocal, fetchJSON,
    getUsers, getPublishedUsers, getLayout, getPublishedLayout, reconcileDrafts, draftState,
    getSession, setSession, clearSession, isAdmin, requireLogin, requireAdmin,
    uid, clone, el, WIDGETS, THEME_FIELDS, applyTheme, renderBlock, renderPage
  };
})();
