/* Gestione classi e studenti */
Q.Classes = (function () {
  'use strict';
  const h = Q.h;
  let selId = null;

  const parseNames = (text) => String(text || '').split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

  /* Mantiene gli id degli studenti già presenti (per lo storico) */
  function merge(old, names) {
    const pool = {};
    (old || []).forEach((s) => { (pool[s.name] = pool[s.name] || []).push(s.id); });
    return names.map((name) => ({ id: (pool[name] && pool[name].shift()) || Q.uid(), name }));
  }

  async function render(el) {
    const classes = (await Q.store.all('classes')).sort((a, b) => a.name.localeCompare(b.name));
    if (!selId || !classes.find((c) => c.id === selId)) selId = classes[0] ? classes[0].id : null;
    Q.clear(el);
    el.append(h('div', { class: 'page-head' },
      h('h1', null, 'Classi'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => create(el) }, '+ Nuova classe'))));
    if (!classes.length) {
      el.append(h('div', { class: 'empty card' },
        h('h2', null, 'Nessuna classe'),
        h('p', { class: 'muted' }, 'Crea una classe e incolla i nomi degli studenti, uno per riga (anche copiandoli da Excel o dal registro).'),
        h('button', { class: 'btn primary', onclick: () => create(el) }, '+ Nuova classe')));
      return;
    }
    const c = classes.find((x) => x.id === selId);
    const list = h('div', { class: 'card list' }, classes.map((x) => h('button', {
      class: 'list-item' + (x.id === selId ? ' active' : ''),
      onclick: () => { selId = x.id; render(el); },
    }, h('strong', null, x.name), h('span', { class: 'muted small' }, `${x.students.length} studenti`))));

    const status = h('span', { class: 'save-status' }, 'Salvato ✓');
    const count = h('span', { class: 'muted small' });
    const nameIn = h('input', { class: 'title-input', value: c.name, placeholder: 'Nome classe (es. 3B)' });
    const ta = h('textarea', { class: 'students-ta', rows: 18, placeholder: 'Un nome per riga\nRossi Mario\nBianchi Laura\n…' });
    ta.value = c.students.map((s) => s.name).join('\n');
    const upd = () => {
      const n = parseNames(ta.value);
      const dup = n.filter((x, i) => n.indexOf(x) !== i);
      count.textContent = `${n.length} studenti` + (dup.length ? ` · ⚠ nomi doppi: ${[...new Set(dup)].join(', ')}` : '');
    };
    const save = Q.debounce(async () => {
      c.name = nameIn.value.trim() || 'Classe senza nome';
      c.students = merge(c.students, parseNames(ta.value));
      await Q.store.put('classes', c);
      status.textContent = 'Salvato ✓';
      const item = list.querySelector('.list-item.active');
      if (item) { item.querySelector('strong').textContent = c.name; item.querySelector('span').textContent = `${c.students.length} studenti`; }
    }, 500);
    const changed = () => { status.textContent = 'Salvataggio…'; upd(); save(); };
    nameIn.addEventListener('input', changed);
    ta.addEventListener('input', changed);
    upd();

    const editor = h('div', { class: 'card' },
      h('div', { class: 'row between' }, nameIn, status),
      h('div', { class: 'row between' }, h('span', { class: 'flabel' }, 'Studenti (uno per riga)'), count),
      ta,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => { ta.value = parseNames(ta.value).sort((a, b) => a.localeCompare(b)).join('\n'); changed(); } }, 'Ordina A→Z'),
        h('button', { class: 'btn ghost', onclick: async () => {
          const f = await Q.pickFile('.txt,.csv,text/plain,text/csv');
          if (!f) return;
          const text = await Q.readText(f);
          const names = text.split(/\r?\n/).map((l) => l.replace(/["']/g, '').split(/[;\t]/).map((x) => x.trim()).filter(Boolean).join(' ')).filter(Boolean);
          ta.value = parseNames(ta.value).concat(names).join('\n');
          changed();
        } }, '⬆ Importa da file'),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await Q.confirm({ title: `Eliminare la classe «${c.name}»?`, message: 'Lo storico delle sessioni resta.', ok: 'Elimina', danger: true }))) return;
          await Q.store.del('classes', c.id);
          selId = null;
          render(el);
        } }, 'Elimina classe')));

    el.append(h('div', { class: 'two-col' }, list, editor));
  }

  async function create(el) {
    const c = { id: Q.uid(), name: 'Nuova classe', students: [] };
    await Q.store.put('classes', c);
    selId = c.id;
    await render(el);
    const inp = el.querySelector('.title-input');
    if (inp) { inp.focus(); inp.select(); }
  }

  return { render };
})();
