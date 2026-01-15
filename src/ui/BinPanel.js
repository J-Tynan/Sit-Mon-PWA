function assetUrl(relativePath) {
  return new URL(relativePath, window.location.href).toString();
}

function parseIsoDateToLocalDay(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateDDMM(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(isoDate || '');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class BinPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.layer = options.layer || null;

    this._collapsed = false;
    this._subareas = [];
    this._scheduleById = {};

    this._built = false;
    this._dataPromise = null;

    this._els = {
      headerToggle: null,
      body: null,
      select: null,
      list: null,
      subtitle: null
    };
  }

  init() {
    if (!this.container) return;
    this.buildUi();
  }

  show() {
    if (!this.container) return;
    if (!this._built) this.buildUi();

    this.container.classList.add('visible');
    this.ensureDataLoaded().catch(() => {});
  }

  hide() {
    if (!this.container) return;
    this.container.classList.remove('visible');
  }

  buildUi() {
    if (!this.container || this._built) return;
    this._built = true;

    this.container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'bin-header';

    const titleWrap = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'bin-title';
    title.textContent = 'Bin collection';

    const subtitle = document.createElement('div');
    subtitle.className = 'bin-subtitle';
    subtitle.textContent = 'NELC demo (5 ahead)';

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'bin-toggle';

    const applyToggleState = () => {
      toggle.textContent = this._collapsed ? '▸' : '▾';
      toggle.title = this._collapsed ? 'Expand bin panel' : 'Collapse bin panel';
      body.style.display = this._collapsed ? 'none' : 'block';
    };

    toggle.addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      applyToggleState();
    });

    header.appendChild(titleWrap);
    header.appendChild(toggle);

    const body = document.createElement('div');

    const controls = document.createElement('div');
    controls.className = 'bin-controls';

    const select = document.createElement('select');
    select.title = 'Choose a NELC sub-area';
    select.addEventListener('change', () => {
      const id = select.value;
      this.renderScheduleFor(id);
      this.layer?.setSelectedSubarea?.(id);
    });

    controls.appendChild(select);

    const list = document.createElement('div');
    list.className = 'bin-list';

    body.appendChild(controls);
    body.appendChild(list);

    this.container.appendChild(header);
    this.container.appendChild(body);

    this._els = { headerToggle: toggle, body, select, list, subtitle };

    applyToggleState();
  }

  ensureDataLoaded() {
    if (this._dataPromise) return this._dataPromise;

    const subareasUrl = assetUrl('src/data/nelc-demo-subareas.json');
    const scheduleUrl = assetUrl('src/data/nelc-demo-collections-5ahead.json');

    this._dataPromise = Promise.all([
      fetch(subareasUrl).then((r) => (r.ok ? r.json() : null)),
      fetch(scheduleUrl).then((r) => (r.ok ? r.json() : null))
    ])
      .then(([subareasJson, scheduleJson]) => {
        const subareas = Array.isArray(subareasJson?.subareas) ? subareasJson.subareas : [];
        const scheduleById = scheduleJson?.scheduleBySubareaId && typeof scheduleJson.scheduleBySubareaId === 'object'
          ? scheduleJson.scheduleBySubareaId
          : {};

        this._subareas = subareas;
        this._scheduleById = scheduleById;

        this.layer?.setDemoData?.({ subareas, scheduleBySubareaId: scheduleById });

        this.populateSelect();

        // Set default to Waltham (village) if present, else fallback to first
        let defaultId = null;
        const waltham = subareas.find(sa => sa.name && sa.name.toLowerCase().includes('waltham'));
        if (waltham) {
          defaultId = waltham.id;
        } else {
          defaultId = subareas[0]?.id;
        }
        if (defaultId) {
          if (this._els.select) this._els.select.value = defaultId;
          this.layer?.setSelectedSubarea?.(defaultId);
          this.renderScheduleFor(defaultId);
        }
      })
      .catch((err) => {
        console.warn('BinPanel: failed to load demo data', err);
        this.renderError('Failed to load demo schedule');
      });

    return this._dataPromise;
  }

  populateSelect() {
    const select = this._els.select;
    if (!select) return;

    select.innerHTML = '';

    for (const sa of this._subareas) {
      const opt = document.createElement('option');
      opt.value = sa.id;
      const kind = typeof sa.kind === 'string' ? sa.kind.trim() : '';
      opt.textContent = kind ? `${sa.name} (${kind})` : sa.name;
      select.appendChild(opt);
    }
  }

  renderError(text) {
    const list = this._els.list;
    if (!list) return;
    list.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'bin-row';

    const dot = document.createElement('div');
    dot.className = 'bin-dot';
    dot.style.background = 'rgba(255,255,255,0.15)';

    const date = document.createElement('div');
    date.className = 'bin-date';
    date.textContent = '—';

    const stream = document.createElement('div');
    stream.className = 'bin-stream';
    stream.textContent = String(text || '');

    row.appendChild(dot);
    row.appendChild(date);
    row.appendChild(stream);

    list.appendChild(row);
  }

  renderScheduleFor(subareaId) {
    const list = this._els.list;
    if (!list) return;

    list.innerHTML = '';

    const items = Array.isArray(this._scheduleById?.[subareaId]) ? this._scheduleById[subareaId] : [];
    const rows = items.slice(0, 5);

    if (rows.length === 0) {
      this.renderError('No demo schedule');
      return;
    }

    for (const it of rows) {
      const row = document.createElement('div');
      row.className = 'bin-row';

      const dot = document.createElement('div');
      dot.className = 'bin-dot';
      const color = typeof it?.color === 'string' ? it.color.trim() : '';
      dot.style.background = color || 'rgba(255,255,255,0.15)';

      const date = document.createElement('div');
      date.className = 'bin-date';
      const iso = it?.date;
      date.textContent = iso ? formatDateDDMM(iso) : '—';

      const stream = document.createElement('div');
      stream.className = 'bin-stream';
      stream.textContent = String(it?.stream || '—');

      row.appendChild(dot);
      row.appendChild(date);
      row.appendChild(stream);

      list.appendChild(row);
    }
  }
}
