// Small UI helpers shared by the game screens.

export function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

let current = null;

// Shows a sheet with buttons and resolves with the chosen value (null = cancel).
//   choose({ title, text, html, options: [{ label, value, primary, disabled, html }], cancel: 'Cancel' })
export function choose({ title, text = '', html = '', options = [], cancel = null }) {
  const dlg = document.getElementById('dlg-choice');
  current?.(null);
  return new Promise(resolve => {
    const done = (v) => {
      if (current !== done) return;
      current = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    current = done;
    dlg.querySelector('.choice-title').textContent = title || '';
    const body = dlg.querySelector('.choice-text');
    body.innerHTML = html || (text ? `<p class="hint">${esc(text)}</p>` : '');
    const box = dlg.querySelector('.choice-options');
    box.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'btn' + (o.primary ? ' primary' : '') + (o.className ? ' ' + o.className : '');
      if (o.html) b.innerHTML = o.html;
      else b.textContent = o.label;
      b.disabled = !!o.disabled;
      b.onclick = () => done(o.value);
      box.append(b);
    }
    const c = dlg.querySelector('.choice-cancel');
    c.hidden = !cancel;
    c.textContent = cancel || '';
    c.onclick = () => done(null);
    dlg.oncancel = (e) => { if (!cancel) e.preventDefault(); else done(null); };
    if (!dlg.open) dlg.showModal();
  });
}

export function closeChoice() {
  current?.(null);
}

// Multi-select sheet (payments, discarding). `check(selectedIds)` returns
// { ok, label } for the confirm button. Resolves with the selected ids.
export function pick({ title, text = '', items, check, confirm, cancel = null }) {
  const dlg = document.getElementById('dlg-choice');
  current?.(null);
  const selected = new Set();
  return new Promise(resolve => {
    const done = (v) => {
      if (current !== done) return;
      current = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    current = done;
    dlg.querySelector('.choice-title').textContent = title;
    dlg.querySelector('.choice-text').innerHTML = text ? `<p class="hint">${esc(text)}</p>` : '';
    const box = dlg.querySelector('.choice-options');
    box.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'pick-grid';
    const status = document.createElement('p');
    status.className = 'pick-status';
    const ok = document.createElement('button');
    ok.className = 'btn primary';
    const update = () => {
      const r = check([...selected]);
      status.textContent = r.label || '';
      ok.textContent = confirm;
      ok.disabled = !r.ok;
    };
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'pick-item';
      b.innerHTML = it.html;
      b.onclick = () => {
        if (selected.has(it.id)) selected.delete(it.id);
        else selected.add(it.id);
        b.classList.toggle('on', selected.has(it.id));
        update();
      };
      grid.append(b);
    }
    ok.onclick = () => done([...selected]);
    box.append(grid, status, ok);
    update();
    const c = dlg.querySelector('.choice-cancel');
    c.hidden = !cancel;
    c.textContent = cancel || '';
    c.onclick = () => done(null);
    dlg.oncancel = (e) => { if (!cancel) e.preventDefault(); else done(null); };
    if (!dlg.open) dlg.showModal();
  });
}
