let authToken = localStorage.getItem('sdwan_token');
let currentUser = JSON.parse(localStorage.getItem('sdwan_user') || 'null');
let currentClientId = null;
let currentRouterId = null;
let chartLink1Instance = null;
let chartLink2Instance = null;
let lastActivityTime = Date.now();
let inactivityTimerInterval = null;

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  if (!authToken || !currentUser) {
    mostrarTelaLogin();
  } else {
    iniciarSessao();
  }

  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, () => {
      lastActivityTime = Date.now();
    });
  });
});

function mostrarTelaLogin(mensagemErro = '') {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  if (mensagemErro) {
    const alertBox = document.getElementById('login-alert');
    alertBox.innerText = mensagemErro;
    alertBox.style.display = 'block';
  }
}

function iniciarSessao() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
  document.getElementById('user-display-name').innerText = currentUser.name || currentUser.username;
  document.getElementById('timeout-display').innerText = `Inatividade: ${currentUser.timeoutMinutes}m`;

  if (currentUser.role !== 'ADMIN') {
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = 'none';
  }

  if (inactivityTimerInterval) clearInterval(inactivityTimerInterval);
  const timeoutMs = (currentUser.timeoutMinutes || 15) * 60 * 1000;
  inactivityTimerInterval = setInterval(() => {
    if (Date.now() - lastActivityTime > timeoutMs) {
      fazerLogout('Sessão expirada por inatividade. Faça login novamente.');
    }
  }, 10000);

  carregarClientes();
}

async function realizarLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('login-alert').innerText = data.error || 'Erro ao efetuar login';
      document.getElementById('login-alert').style.display = 'block';
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('sdwan_token', authToken);
    localStorage.setItem('sdwan_user', JSON.stringify(currentUser));
    lastActivityTime = Date.now();
    iniciarSessao();
  } catch (err) {
    document.getElementById('login-alert').innerText = 'Falha de comunicação com o servidor';
    document.getElementById('login-alert').style.display = 'block';
  }
}

function fazerLogout(motivo = '') {
  localStorage.removeItem('sdwan_token');
  localStorage.removeItem('sdwan_user');
  authToken = null;
  currentUser = null;
  if (inactivityTimerInterval) clearInterval(inactivityTimerInterval);
  mostrarTelaLogin(motivo);
}

async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(url, options);
  if (res.status === 401) {
    fazerLogout('Sua sessão expirou.');
    throw new Error('Unauthorized');
  }
  return res;
}

function switchView(viewName) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('main.content-body').forEach(el => el.style.display = 'none');

  if (viewName === 'sdwan') {
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    document.getElementById('view-sdwan').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'SD-WAN';
    carregarSDWAN();
  } else if (viewName === 'links') {
    document.querySelectorAll('.nav-item')[1].classList.add('active');
    document.getElementById('view-links').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Status dos Links';
    carregarStatusLinks();
  } else if (viewName === 'reports') {
    document.querySelectorAll('.nav-item')[2].classList.add('active');
    document.getElementById('view-reports').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Relatórios & SLA';
    iniciarDatasFiltro();
    carregarRelatorioSelecionado();
  } else if (viewName === 'admin') {
    document.querySelectorAll('.nav-item')[3].classList.add('active');
    document.getElementById('view-admin').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Administração & WhatsApp';
    carregarAdminEvolution();
    carregarAdminGrupos();
    carregarAdminUsuarios();
  }
}

async function carregarClientes() {
  const res = await apiFetch('/api/clients');
  const clients = await res.json();
  const select = document.getElementById('client-select');
  select.innerHTML = '';

  clients.forEach((c, idx) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = c.name;
    select.appendChild(opt);
    if (idx === 0) currentClientId = c.id;
  });

  await carregarRoteadoresDoCliente();
}

async function onClientChange() {
  currentClientId = document.getElementById('client-select').value;
  await carregarRoteadoresDoCliente();
}

async function carregarRoteadoresDoCliente() {
  const res = await apiFetch(`/api/routers?clientId=${currentClientId}`);
  const routers = await res.json();
  const select = document.getElementById('router-select');
  select.innerHTML = '';

  if (routers.length === 0) {
    const opt = document.createElement('option');
    opt.innerText = 'Nenhum MikroTik permitido';
    select.appendChild(opt);
    currentRouterId = null;
    return;
  }

  routers.forEach((r, idx) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.innerText = `${r.name} (${r.model || 'MikroTik'})`;
    select.appendChild(opt);
    if (idx === 0) currentRouterId = r.id;
  });

  carregarSDWAN();
}

function onRouterChange() {
  currentRouterId = document.getElementById('router-select').value;
  carregarSDWAN();
}

// ----------------------------------------------------------------------
// RENDERIZAR CARDS SD-WAN (Print 1)
// ----------------------------------------------------------------------
async function carregarSDWAN() {
  if (!currentRouterId) return;
  const res = await apiFetch(`/api/routers/${currentRouterId}/sdwan`);
  const targets = await res.json();

  const container = document.getElementById('sdwan-cards-container');
  container.innerHTML = '';

  targets.forEach(t => {
    const card = document.createElement('div');
    card.className = 'sdwan-card';

    const sparklineSvg = gerarSparklineSvg(t.sparkline || [0.4, 0.42, 0.38, 0.45, 0.41]);
    const isIts = (t.active_link || '').toUpperCase().includes('ITS');
    const linkIndicatorClass = isIts ? 'its' : 'claro';

    card.innerHTML = `
      <div class="card-header-inner">
        <h3 class="card-title">${t.name}</h3>
        <span class="status-badge">Melhor rota estabelecida</span>
        
        <div class="card-meta-list">
          <div>
            <strong>Link:</strong> 
            <span class="link-pill">
              <span class="link-indicator ${linkIndicatorClass}"></span> 
              ${t.active_link || 'N/A'}
            </span>
          </div>
          <div><strong>Endereço:</strong> ${t.address}</div>
          <div><strong>Métrica:</strong> ${t.metric_rtt ? t.metric_rtt.toFixed(2) + 'ms' : '0.00ms'}</div>
          <div><strong>Último teste:</strong> ${formatarData(t.last_tested)}</div>
        </div>
      </div>

      <div class="card-sparkline-container">
        ${sparklineSvg}
      </div>

      <div class="card-actions-bar">
        <span class="card-action-btn" onclick="abrirTimeline(${t.id}, '${t.name}')">📑 Relatório</span>
        <span class="card-action-btn" onclick="abrirGraficos(${t.id}, '${t.name}')">📊 Rel. Detalhado</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function gerarSparklineSvg(points) {
  if (!points || points.length < 2) points = [1, 2, 1.5, 3, 2, 4, 1.8];
  const width = 300;
  const height = 60;
  const min = Math.min(...points);
  const max = Math.max(...points) || 1;
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const coords = points.map((val, i) => {
    const x = i * stepX;
    const y = height - 10 - ((val - min) / range) * (height - 25);
    return { x, y };
  });

  let pathD = `M 0,${height} L 0,${coords[0].y}`;
  coords.forEach(c => { pathD += ` L ${c.x},${c.y}`; });
  pathD += ` L ${width},${height} Z`;

  let lineD = `M 0,${coords[0].y}`;
  coords.forEach(c => { lineD += ` L ${c.x},${c.y}`; });

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="purpleGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#9389d4" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#9389d4" stop-opacity="0.1"/>
        </linearGradient>
      </defs>
      <path d="${pathD}" fill="url(#purpleGrad)" />
      <path d="${lineD}" fill="none" stroke="#6366f1" stroke-width="2" />
    </svg>
  `;
}

// ----------------------------------------------------------------------
// TIMELINE E GRÁFICOS
// ----------------------------------------------------------------------
async function abrirTimeline(targetId, targetName) {
  document.getElementById('timeline-target-title').innerText = targetName;
  document.getElementById('modal-timeline').style.display = 'flex';

  const res = await apiFetch(`/api/sdwan/${targetId}/timeline`);
  const data = await res.json();
  const list = document.getElementById('timeline-list-container');
  list.innerHTML = '';

  data.history.forEach(h => {
    const entry = document.createElement('div');
    entry.className = 'timeline-entry';
    const isCurrent = h.is_current === 1;
    const bubbleClass = isCurrent ? 'current' : 'switch';
    const bubbleIcon = isCurrent ? '✔' : '⇆';

    const linkColor = h.link_name.toUpperCase().includes('ITS') ? '#3b82f6' : '#ef4444';
    const linkSpan = `<span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${linkColor}; margin-right:4px;"></span><strong style="color:${linkColor}">${h.link_name}</strong>`;

    let texto = isCurrent
      ? `${linkSpan} definido como <strong>melhor rota atual</strong> em ${formatarData(h.started_at)} (${h.test_count} testes) com o jitter médio de ${h.jitter ? h.jitter.toFixed(2) : '0.00'}ms`
      : `${linkSpan} definido como <strong>melhor rota</strong> em ${formatarData(h.started_at)} e ficou até ${formatarData(h.ended_at)} com o jitter médio de ${h.jitter ? h.jitter.toFixed(2) : '0.00'}ms`;

    entry.innerHTML = `
      <div class="timeline-icon-bubble ${bubbleClass}">${bubbleIcon}</div>
      <div class="timeline-text">${texto}</div>
    `;
    list.appendChild(entry);
  });
}

async function abrirGraficos(targetId, targetName) {
  document.getElementById('grafico-target-title').innerText = `${targetName} - Latência por Link`;
  document.getElementById('modal-graficos').style.display = 'flex';

  const res = await apiFetch(`/api/sdwan/${targetId}/metrics`);
  const data = await res.json();

  const itsMetrics = data.metrics.filter(m => m.link_name.toUpperCase().includes('ITS'));
  const claroMetrics = data.metrics.filter(m => m.link_name.toUpperCase().includes('CLARO'));

  if (chartLink1Instance) chartLink1Instance.destroy();
  const ctx1 = document.getElementById('chart-link1').getContext('2d');
  chartLink1Instance = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: itsMetrics.map(m => formatarHora(m.tested_at)),
      datasets: [{ label: 'Latência ITS (ms)', data: itsMetrics.map(m => m.rtt), backgroundColor: '#10b981', borderRadius: 3 }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  if (chartLink2Instance) chartLink2Instance.destroy();
  const ctx2 = document.getElementById('chart-link2').getContext('2d');
  chartLink2Instance = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: claroMetrics.map(m => formatarHora(m.tested_at)),
      datasets: [{ label: 'Latência CLARO (ms)', data: claroMetrics.map(m => m.rtt), backgroundColor: '#cbd5e1', borderRadius: 3 }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ----------------------------------------------------------------------
// STATUS DOS LINKS
// ----------------------------------------------------------------------
async function carregarStatusLinks() {
  if (!currentRouterId) return;
  const res = await apiFetch(`/api/routers/${currentRouterId}/links`);
  const data = await res.json();

  const container = document.getElementById('links-cards-container');
  container.innerHTML = '';

  data.links.forEach(l => {
    const card = document.createElement('div');
    card.className = 'link-status-card';
    const isUp = l.status === 'UP';
    const badgeClass = isUp ? 'badge-on' : 'badge-off';
    const statusText = isUp ? '● ONLINE' : '✖ OFFLINE';

    card.innerHTML = `
      <div>
        <div class="link-name-huge">${l.link_name}</div>
        <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
          Última alteração: ${formatarData(l.last_changed)}
        </div>
      </div>
      <div><span class="${badgeClass}">${statusText}</span></div>
    `;
    container.appendChild(card);
  });

  const tbody = document.querySelector('#links-events-table tbody');
  tbody.innerHTML = '';
  data.events.forEach(e => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    const color = e.status === 'UP' ? '#16a34a' : '#dc2626';

    tr.innerHTML = `
      <td style="padding: 10px;">${formatarData(e.created_at)}</td>
      <td style="padding: 10px; font-weight: 600;">${e.link_name}</td>
      <td style="padding: 10px; color: ${color}; font-weight: 700;">${e.status}</td>
      <td style="padding: 10px;">${e.score}/8 pings</td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------------------------
// RELATÓRIOS & SLA
// ----------------------------------------------------------------------
function iniciarDatasFiltro() {
  const hoje = new Date().toISOString().split('T')[0];
  const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  if (!document.getElementById('report-start-date').value) {
    document.getElementById('report-start-date').value = seteDiasAtras;
    document.getElementById('report-end-date').value = hoje;
  }
}

async function carregarRelatorioSelecionado() {
  const tipo = document.getElementById('report-type').value;
  const sDate = document.getElementById('report-start-date').value;
  const eDate = document.getElementById('report-end-date').value;
  document.getElementById('report-doc-timestamp').innerText = new Date().toLocaleString('pt-BR');

  if (tipo === 'availability') {
    document.getElementById('report-doc-title').innerText = 'Relatório de Disponibilidade dos Links WAN (SLA)';
    const res = await apiFetch(`/api/reports/availability?routerId=${currentRouterId}&startDate=${sDate}&endDate=${eDate}`);
    const data = await res.json();

    let html = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">`;

    data.stats.forEach(s => {
      const minOffline = Math.round(s.segundosOffline / 60);
      const sla = Math.max(0, (100 - ((s.segundosOffline / (7 * 86400)) * 100))).toFixed(2);

      html += `
        <div style="background: #f8fafc; border: 1px solid var(--border-color); padding: 16px; border-radius: 8px;">
          <div style="font-size: 16px; font-weight: 700; color: #1e293b;">${s.link}</div>
          <div style="font-size: 13px; color: #64748b; margin-top: 6px;">Total de Quedas: <strong>${s.totalQuedas}</strong></div>
          <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Tempo Offline: <strong>${minOffline} minutos</strong></div>
          <div style="font-size: 14px; color: #16a34a; font-weight: 700; margin-top: 6px;">Disponibilidade: ${sla}%</div>
        </div>
      `;
    });

    html += `</div>
      <h3 style="font-size: 15px; margin-bottom: 12px;">Histórico Detalhado de Interrupções</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-color); color: #64748b; text-align: left;">
            <th style="padding: 8px;">Link</th>
            <th style="padding: 8px;">Data/Hora da Queda</th>
            <th style="padding: 8px;">Data/Hora do Retorno</th>
            <th style="padding: 8px;">Duração Offline</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.outages.forEach(o => {
      const dur = o.duration_seconds ? `${Math.round(o.duration_seconds / 60)} min` : 'Ainda Offline';
      html += `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 8px; font-weight: 600;">${o.link_name}</td>
          <td style="padding: 8px; color: #dc2626;">${formatarData(o.down_time)}</td>
          <td style="padding: 8px; color: #16a34a;">${o.up_time ? formatarData(o.up_time) : '● Em Aberto'}</td>
          <td style="padding: 8px; font-weight: 600;">${dur}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    document.getElementById('report-content-body').innerHTML = html;

  } else if (tipo === 'sdwan') {
    document.getElementById('report-doc-title').innerText = 'Relatório de Roteamento Dinâmico SD-WAN';
    const res = await apiFetch(`/api/reports/sdwan?routerId=${currentRouterId}&startDate=${sDate}&endDate=${eDate}`);
    const data = await res.json();

    let html = `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-color); color: #64748b; text-align: left;">
            <th style="padding: 8px;">Destino / Serviço</th>
            <th style="padding: 8px;">Endereço</th>
            <th style="padding: 8px;">Link Escolhido</th>
            <th style="padding: 8px;">Início</th>
            <th style="padding: 8px;">Fim</th>
            <th style="padding: 8px;">Jitter Médio</th>
            <th style="padding: 8px;">Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.forEach(h => {
      html += `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 8px; font-weight: 600;">${h.target_name}</td>
          <td style="padding: 8px; color: #64748b;">${h.target_address}</td>
          <td style="padding: 8px; font-weight: 700; color: #4f46e5;">${h.link_name}</td>
          <td style="padding: 8px;">${formatarData(h.started_at)}</td>
          <td style="padding: 8px;">${h.ended_at ? formatarData(h.ended_at) : 'Ativo'}</td>
          <td style="padding: 8px;">${h.jitter ? h.jitter.toFixed(2) + 'ms' : '0.00ms'}</td>
          <td style="padding: 8px;">${h.is_current ? '<span class="status-badge">Atual</span>' : 'Histórico'}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    document.getElementById('report-content-body').innerHTML = html;
  }
}

function exportarRelatorioPDF() {
  const element = document.getElementById('printable-report-area');
  const opt = {
    margin: [10, 10, 10, 10],
    filename: `Relatorio_TRACERT_PLUS_${new Date().toISOString().slice(0,10)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
}

// ----------------------------------------------------------------------
// ADMINISTRAÇÃO: EVOLUTION API, GRUPOS (CRUD) E USUÁRIOS (CRUD)
// ----------------------------------------------------------------------
async function carregarAdminEvolution() {
  const res = await apiFetch('/api/admin/evolution');
  const evo = await res.json();
  if (evo.base_url) document.getElementById('evo-base-url').value = evo.base_url;
  if (evo.instance_name) document.getElementById('evo-instance').value = evo.instance_name;
  document.getElementById('evo-enabled').checked = evo.enabled === 1;
}

async function salvarEvolution(e) {
  e.preventDefault();
  const baseUrl = document.getElementById('evo-base-url').value;
  const apiKey = document.getElementById('evo-api-key').value;
  const instanceName = document.getElementById('evo-instance').value;
  const enabled = document.getElementById('evo-enabled').checked;

  await apiFetch('/api/admin/evolution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, instanceName, enabled })
  });
  alert('Configuração da Evolution API salva com sucesso!');
}

// GRUPOS CRUD
async function carregarAdminGrupos() {
  const res = await apiFetch('/api/admin/groups');
  const groups = await res.json();

  const tbody = document.querySelector('#groups-table tbody');
  tbody.innerHTML = '';
  groups.forEach(g => {
    const notifs = [];
    if (g.notify_link_down) notifs.push('Queda de Link');
    if (g.notify_sdwan_switch) notifs.push('Troca SD-WAN');
    if (g.notify_router_offline) notifs.push('Roteador Offline');

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600;">${g.name}</td>
      <td style="padding: 10px; color: #16a34a; font-weight: 700;">+${g.whatsapp_number || 'N/A'}</td>
      <td style="padding: 10px; font-size: 12px;">${notifs.join(' • ') || 'Nenhuma'}</td>
      <td style="padding: 10px;">${g.routerIds ? g.routerIds.length : 0} MikroTik(s)</td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="editarGrupo(${g.id})" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:8px;">✏️ Editar</button>
        <button onclick="excluirGrupo(${g.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️ Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function abrirModalGrupo() {
  document.getElementById('modal-grupo-title').innerText = 'Cadastrar Grupo de Acesso';
  document.getElementById('grupo-id').value = '';
  document.getElementById('grupo-nome').value = '';
  document.getElementById('grupo-whatsapp').value = '';
  document.getElementById('notify-link-down').checked = true;
  document.getElementById('notify-sdwan').checked = true;
  document.getElementById('notify-router-offline').checked = true;

  const res = await apiFetch('/api/routers');
  const routers = await res.json();
  const container = document.getElementById('grupo-routers-checklist');
  container.innerHTML = '';

  routers.forEach(r => {
    const label = document.createElement('label');
    label.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 12.5px; margin-bottom: 4px;';
    label.innerHTML = `
      <input type="checkbox" name="grupo-router-item" value="${r.id}" checked>
      <strong>${r.client_name}:</strong> ${r.name}
    `;
    container.appendChild(label);
  });

  document.getElementById('modal-grupo').style.display = 'flex';
}

async function editarGrupo(id) {
  const res = await apiFetch(`/api/admin/groups/${id}`);
  const group = await res.json();

  document.getElementById('modal-grupo-title').innerText = 'Editar Grupo de Acesso';
  document.getElementById('grupo-id').value = group.id;
  document.getElementById('grupo-nome').value = group.name;
  document.getElementById('grupo-whatsapp').value = (group.whatsapp_number || '').replace(/^55/, '');
  document.getElementById('notify-link-down').checked = group.notify_link_down === 1;
  document.getElementById('notify-sdwan').checked = group.notify_sdwan_switch === 1;
  document.getElementById('notify-router-offline').checked = group.notify_router_offline === 1;

  const resRouters = await apiFetch('/api/routers');
  const routers = await resRouters.json();
  const container = document.getElementById('grupo-routers-checklist');
  container.innerHTML = '';

  routers.forEach(r => {
    const checked = group.routerIds.includes(r.id) ? 'checked' : '';
    const label = document.createElement('label');
    label.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 12.5px; margin-bottom: 4px;';
    label.innerHTML = `
      <input type="checkbox" name="grupo-router-item" value="${r.id}" ${checked}>
      <strong>${r.client_name}:</strong> ${r.name}
    `;
    container.appendChild(label);
  });

  document.getElementById('modal-grupo').style.display = 'flex';
}

async function salvarGrupo(e) {
  e.preventDefault();
  const id = document.getElementById('grupo-id').value;
  const name = document.getElementById('grupo-nome').value;
  const whatsappNumber = document.getElementById('grupo-whatsapp').value;
  const notifyLinkDown = document.getElementById('notify-link-down').checked;
  const notifySdwanSwitch = document.getElementById('notify-sdwan').checked;
  const notifyRouterOffline = document.getElementById('notify-router-offline').checked;

  const checkboxes = document.querySelectorAll('input[name="grupo-router-item"]:checked');
  const routerIds = Array.from(checkboxes).map(c => parseInt(c.value, 10));

  const payload = { name, whatsappNumber, notifyLinkDown, notifySdwanSwitch, notifyRouterOffline, routerIds };

  if (id) {
    await apiFetch(`/api/admin/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await apiFetch('/api/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  fecharModais();
  carregarAdminGrupos();
}

async function excluirGrupo(id) {
  if (confirm('Tem certeza que deseja excluir este grupo de acesso?')) {
    await apiFetch(`/api/admin/groups/${id}`, { method: 'DELETE' });
    carregarAdminGrupos();
  }
}

// USUÁRIOS CRUD
async function carregarAdminUsuarios() {
  const res = await apiFetch('/api/admin/users');
  const users = await res.json();

  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600;">${u.name}</td>
      <td style="padding: 10px;">${u.username}</td>
      <td style="padding: 10px;"><span class="status-badge">${u.role}</span></td>
      <td style="padding: 10px;">${u.group_name || 'Acesso Total (Admin)'}</td>
      <td style="padding: 10px;">${u.inactivity_timeout_min} minutos</td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="editarUsuario(${u.id})" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:8px;">✏️ Editar</button>
        <button onclick="excluirUsuario(${u.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️ Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function abrirModalUsuario() {
  document.getElementById('modal-user-title').innerText = 'Cadastrar Novo Usuário';
  document.getElementById('user-id').value = '';
  document.getElementById('user-nome').value = '';
  document.getElementById('user-login').value = '';
  document.getElementById('user-senha').value = '';
  document.getElementById('user-senha').required = true;
  document.getElementById('user-pw-hint').innerText = '';
  document.getElementById('user-timeout').value = '15';

  const res = await apiFetch('/api/admin/groups');
  const groups = await res.json();
  const select = document.getElementById('user-group');
  select.innerHTML = '<option value="">Sem restrição (Acesso Admin)</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.innerText = g.name;
    select.appendChild(opt);
  });

  document.getElementById('modal-usuario').style.display = 'flex';
}

async function editarUsuario(id) {
  const res = await apiFetch(`/api/admin/users/${id}`);
  const user = await res.json();

  document.getElementById('modal-user-title').innerText = 'Editar Usuário';
  document.getElementById('user-id').value = user.id;
  document.getElementById('user-nome').value = user.name;
  document.getElementById('user-login').value = user.username;
  document.getElementById('user-senha').value = '';
  document.getElementById('user-senha').required = false;
  document.getElementById('user-pw-hint').innerText = '(deixe em branco para manter a atual)';
  document.getElementById('user-timeout').value = user.inactivity_timeout_min;

  const resGroups = await apiFetch('/api/admin/groups');
  const groups = await resGroups.json();
  const select = document.getElementById('user-group');
  select.innerHTML = '<option value="">Sem restrição (Acesso Admin)</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.innerText = g.name;
    if (g.id === user.group_id) opt.selected = true;
    select.appendChild(opt);
  });

  document.getElementById('modal-usuario').style.display = 'flex';
}

async function salvarUsuario(e) {
  e.preventDefault();
  const id = document.getElementById('user-id').value;
  const name = document.getElementById('user-nome').value;
  const username = document.getElementById('user-login').value;
  const password = document.getElementById('user-senha').value;
  const groupId = document.getElementById('user-group').value || null;
  const timeoutMinutes = parseInt(document.getElementById('user-timeout').value || 15, 10);
  const role = groupId ? 'USER' : 'ADMIN';

  const payload = { name, username, password, role, groupId, timeoutMinutes };

  if (id) {
    await apiFetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await apiFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  fecharModais();
  carregarAdminUsuarios();
}

async function excluirUsuario(id) {
  if (confirm('Tem certeza que deseja excluir este usuário?')) {
    const res = await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Erro ao excluir usuário');
      return;
    }
    carregarAdminUsuarios();
  }
}

function fecharModais() {
  document.getElementById('modal-timeline').style.display = 'none';
  document.getElementById('modal-graficos').style.display = 'none';
  document.getElementById('modal-grupo').style.display = 'none';
  document.getElementById('modal-usuario').style.display = 'none';
}

function formatarData(dtString) {
  if (!dtString) return 'N/A';
  const d = new Date(dtString);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatarHora(dtString) {
  if (!dtString) return '';
  const d = new Date(dtString);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
