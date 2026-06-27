export const adminUI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OneBase admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #0f1117;
      --surface:  #1a1d27;
      --border:   #2a2d3a;
      --text:     #e2e4f0;
      --muted:    #6b7280;
      --accent:   #6366f1;
      --accent2:  #818cf8;
      --success:  #10b981;
      --danger:   #ef4444;
      --radius:   8px;
      --font:     'Inter', system-ui, sans-serif;
    }
    body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; min-height: 100vh; display: flex; }
    aside { width: 220px; background: var(--surface); border-right: 1px solid var(--border); padding: 24px 0; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
    .logo { padding: 0 20px 20px; font-weight: 700; font-size: 18px; color: var(--accent2); border-bottom: 1px solid var(--border); margin-bottom: 8px; }
    .logo span { color: var(--muted); font-weight: 400; font-size: 12px; display: block; margin-top: 2px; }
    nav a { display: flex; align-items: center; gap: 8px; padding: 8px 20px; color: var(--muted); text-decoration: none; border-radius: 0; transition: all .15s; cursor: pointer; }
    nav a:hover, nav a.active { color: var(--text); background: rgba(99,102,241,.12); }
    nav a.active { border-right: 2px solid var(--accent); }
    main { flex: 1; padding: 32px; overflow: auto; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .card .label { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .card .value { font-size: 28px; font-weight: 700; color: var(--accent2); }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: var(--radius); overflow: hidden; }
    th { background: rgba(99,102,241,.08); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .07em; padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
    td { padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--text); font-size: 13px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(99,102,241,.04); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 500; }
    .badge.collection { background: rgba(99,102,241,.15); color: var(--accent2); }
    input[type=text], input[type=password], input[type=email] {
      background: var(--surface); border: 1px solid var(--border); color: var(--text);
      padding: 8px 12px; border-radius: var(--radius); width: 100%; font-size: 14px; outline: none;
    }
    input:focus { border-color: var(--accent); }
    button { padding: 8px 16px; border-radius: var(--radius); border: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: opacity .15s; }
    button.primary { background: var(--accent); color: #fff; }
    button:hover { opacity: .85; }
    .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; width: 100%; }
    .login-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px; width: 360px; }
    .login-box h1 { margin-bottom: 8px; }
    .login-box p { color: var(--muted); margin-bottom: 28px; font-size: 13px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 12px; }
    .error { color: var(--danger); font-size: 13px; margin-top: 12px; }
    .pagination { display: flex; align-items: center; gap: 12px; margin-top: 16px; color: var(--muted); font-size: 13px; }
    .pagination button { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; }
    #loading { color: var(--muted); padding: 40px; text-align: center; }
  </style>
</head>
<body>
<div id="root"></div>
<script>
const $ = sel => document.querySelector(sel)
const h = (tag, attrs={}, ...children) => {
  const el = document.createElement(tag)
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'onClick') el.addEventListener('click', v)
    else if (k === 'className') el.className = v
    else el.setAttribute(k, v)
  }
  children.flat().forEach(c => el.append(typeof c === 'string' ? document.createTextNode(c) : c))
  return el
}

let token = localStorage.getItem('just_ts_token')
let currentView = 'dashboard'
let selectedCollection = null

async function api(path, opts={}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer '+token } : {}), ...opts.headers }
  })
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error||res.statusText) }
  return res.json()
}

function render() {
  const root = $('#root')
  root.innerHTML = ''
  if (!token) { root.append(renderLogin()); return }
  root.append(renderApp())
}

function renderLogin() {
  const wrap = h('div', {className:'login-wrap'})
  const box  = h('div', {className:'login-box'})
  const err  = h('p', {className:'error', style:'display:none'})
  const email = h('input', {type:'email', placeholder:'admin@example.com'})
  const pwd   = h('input', {type:'password', placeholder:'••••••••'})
  const btn   = h('button', {className:'primary', onClick: async () => {
    err.style.display = 'none'
    try {
      const res = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email: email.value, password: pwd.value }) })
      token = res.token
      localStorage.setItem('just_ts_token', token)
      render()
    } catch(e) { err.textContent = e.message; err.style.display = 'block' }
  }}, 'Sign in')
  box.append(
    h('h1', {}, 'OneBase'),
    h('p', {}, 'Admin panel'),
    h('div', {className:'form-group'}, h('label',{},'Email'), email),
    h('div', {className:'form-group'}, h('label',{},'Password'), pwd),
    btn, err
  )
  wrap.append(box)
  return wrap
}

function renderApp() {
  const layout = h('div', {style:'display:flex;width:100%'})
  layout.append(renderSidebar(), renderMain())
  return layout
}

function renderSidebar() {
  const aside = h('aside')
  aside.append(h('div', {className:'logo'}, 'OneBase', h('span',{},'admin panel')))
  const nav = h('nav')
  const links = [
    { id: 'dashboard', label: '⬡  Dashboard' },
    { id: 'collections', label: '⊞  Collections' },
  ]
  links.forEach(l => {
    const a = h('a', { className: currentView===l.id?'active':'', onClick:()=>{ currentView=l.id; render() } }, l.label)
    nav.append(a)
  })
  const logout = h('a', { style:'margin-top:auto;padding:20px 20px 0', onClick:()=>{ token=null; localStorage.removeItem('just_ts_token'); render() } }, '⎋  Sign out')
  aside.append(nav, logout)
  return aside
}

function renderMain() {
  const main = h('main')
  if (currentView === 'dashboard') renderDashboard(main)
  else if (currentView === 'collections') renderCollections(main)
  return main
}

async function renderDashboard(main) {
  main.append(h('h1',{},'Dashboard'), h('div',{id:'loading'},'Loading…'))
  try {
    const stats = await api('/admin/api/stats')
    main.querySelector('#loading').remove()
    const grid = h('div',{className:'grid'})
    grid.append(
      statCard('Collections', stats.collections.length),
      statCard('Live connections', stats.realtimeConnections),
      statCard('Total records', stats.collections.reduce((s,c)=>s+c.count,0)),
    )
    main.append(grid)
    main.append(h('h2',{},'Collections'))
    const table = h('table')
    table.append(h('tr',{}, h('th',{},'Name'), h('th',{},'Records')))
    stats.collections.forEach(c => {
      table.append(h('tr',{}, h('td',{}, h('span',{className:'badge collection'},c.name)), h('td',{},String(c.count))))
    })
    main.append(table)
  } catch(e) { main.querySelector('#loading').textContent = 'Error: '+e.message }
}

async function renderCollections(main) {
  main.append(h('h1',{},'Collections'), h('div',{id:'loading'},'Loading…'))
  try {
    const cols = await api('/admin/api/collections')
    main.querySelector('#loading').remove()

    if (!selectedCollection) selectedCollection = cols[0]?.name

    const tabs = h('div',{style:'display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap'})
    cols.forEach(c => {
      const btn = h('button', {
        className: selectedCollection===c.name ? 'primary' : '',
        style: 'border:1px solid var(--border)',
        onClick: ()=>{ selectedCollection=c.name; render() }
      }, c.name + ' (' + c.count + ')')
      tabs.append(btn)
    })
    main.append(tabs)

    if (selectedCollection) {
      await renderRecordsTable(main, selectedCollection)
    }
  } catch(e) { main.querySelector('#loading').textContent = 'Error: '+e.message }
}

async function renderRecordsTable(main, collection) {
  const res = await api(\`/admin/api/collections/\${collection}/records?limit=20\`)
  if (!res.items.length) { main.append(h('p',{style:'color:var(--muted)'},'No records yet.')); return }
  const cols = Object.keys(res.items[0])
  const table = h('table')
  table.append(h('tr',{}, ...cols.map(c=>h('th',{},c))))
  res.items.forEach(row => {
    table.append(h('tr',{}, ...cols.map(c => h('td',{title:String(row[c]??'')},String(row[c]??'—')))))
  })
  main.append(table)
  main.append(h('div',{className:'pagination'},
    h('span',{},\`Showing \${res.items.length} of \${res.total}\`)
  ))
}

function statCard(label, value) {
  return h('div',{className:'card'}, h('div',{className:'label'},label), h('div',{className:'value'},String(value)))
}

render()
</script>
</body>
</html>`;
