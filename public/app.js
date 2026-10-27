function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let allRouters = [];
let authToken = localStorage.getItem('sdwan_token');
let currentUser = JSON.parse(localStorage.getItem('sdwan_user') || 'null');
let currentClientId = null;
let currentRouterId = null;
let currentView = 'dashboard';
let chartLink1Instance = null;
let chartLink2Instance = null;
let lastActivityTime = Date.now();
let inactivityTimerInterval = null;

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
  carregarOverviewDashboard();
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
  currentView = viewName;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('main.content-body').forEach(el => el.style.display = 'none');
  const tenantFilter = document.getElementById('tenant-filter-bar');

  if (viewName === 'dashboard') {
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    document.getElementById('view-dashboard').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Painel Geral';
    if (tenantFilter) tenantFilter.style.display = 'none';
    carregarOverviewDashboard();
  } else if (viewName === 'sdwan') {
    document.querySelectorAll('.nav-item')[1].classList.add('active');
    document.getElementById('view-sdwan').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'SD-WAN';
    if (tenantFilter) tenantFilter.style.display = 'flex';
    carregarSDWAN();
  } else if (viewName === 'links') {
    document.querySelectorAll('.nav-item')[2].classList.add('active');
    document.getElementById('view-links').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Status dos Links';
    if (tenantFilter) tenantFilter.style.display = 'flex';
    carregarStatusLinks();
  } else if (viewName === 'reports') {
    document.querySelectorAll('.nav-item')[3].classList.add('active');
    document.getElementById('view-reports').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Relatórios & SLA';
    if (tenantFilter) tenantFilter.style.display = 'flex';
    iniciarDatasFiltro();
    carregarRelatorioSelecionado();
  } else if (viewName === 'admin') {
    document.querySelectorAll('.nav-item')[4].classList.add('active');
    document.getElementById('view-admin').style.display = 'block';
    document.getElementById('breadcrumb-current').innerText = 'Administração & Gestão';
    if (tenantFilter) tenantFilter.style.display = 'none';
    carregarAdminClientes();
    carregarAdminRouters();
    carregarAdminEvolution();
    carregarAdminGrupos();
    carregarAdminUsuarios();
  }
}

// ----------------------------------------------------------------------
// 0. PAINEL GERAL CENTRAL (OVERVIEW / NOC)
// ----------------------------------------------------------------------
async function carregarOverviewDashboard() {
  const res = await apiFetch('/api/dashboard/overview');
  const data = await res.json();

  document.getElementById('ov-total-routers').innerText = data.totalRouters;
  document.getElementById('ov-online-routers').innerText = data.onlineRouters;
  document.getElementById('ov-offline-routers').innerText = data.offlineRouters;
  document.getElementById('ov-links-down').innerText = data.totalLinksDown;

  const linksDownList = document.getElementById('ov-links-down-list');
  linksDownList.innerHTML = '';
  if (data.linksDown.length === 0) {
    linksDownList.innerHTML = '<div style="color: #16a34a; font-weight:600; padding:10px;">🟢 Todos os links WAN estão 100% operacionais no momento!</div>';
  } else {
    data.linksDown.forEach(l => {
      const item = document.createElement('div');
      item.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;';
      item.innerHTML = `
        <div>
          <strong style="color:#dc2626;">${escapeHtml(l.link_name)}</strong> - ${escapeHtml(l.router_name)} (${escapeHtml(l.client_name)})
        </div>
        <div style="font-size:12px; color:#64748b;">Queda em: ${formatarData(l.last_changed)}</div>
      `;
      linksDownList.appendChild(item);
    });
  }

  const eventsList = document.getElementById('ov-recent-events-list');
  eventsList.innerHTML = '';
  if (data.recentEvents.length === 0) {
    eventsList.innerHTML = '<div style="color:#64748b; padding:10px;">Nenhum evento registrado ainda.</div>';
  } else {
    data.recentEvents.forEach(e => {
      const item = document.createElement('div');
      item.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; font-size:13px;';
      const color = e.status === 'UP' ? '#16a34a' : '#dc2626';
      item.innerHTML = `
        <div>
          <strong style="color:${color};">${escapeHtml(e.status)}</strong>: ${escapeHtml(e.link_name)} em <em>${escapeHtml(e.router_name)}</em>
        </div>
        <div style="font-size:11.5px; color:#64748b;">${formatarData(e.created_at)}</div>
      `;
      eventsList.appendChild(item);
    });
  }
}

// ----------------------------------------------------------------------
// SELETORES CLIENTES / MIKROTIKS
// ----------------------------------------------------------------------
async function carregarClientes() {
  const res = await apiFetch('/api/clients');
  const clients = await res.json();
  const select = document.getElementById('client-select');
  select.innerHTML = '';

  if (clients.length === 0) {
    const opt = document.createElement('option');
    opt.innerText = 'Cadastre um Cliente';
    select.appendChild(opt);
    currentClientId = null;
    return;
  }

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
  if (!currentClientId) return;
  const res = await apiFetch(`/api/routers?clientId=${currentClientId}`);
  const routers = await res.json();
  const select = document.getElementById('router-select');
  select.innerHTML = '';

  if (routers.length === 0) {
    const opt = document.createElement('option');
    opt.innerText = 'Nenhum MikroTik cadastrado';
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

  atualizarViewAtiva();
}

function atualizarViewAtiva() {
  if (currentView === 'links') {
    carregarStatusLinks();
  } else if (currentView === 'sdwan') {
    carregarSDWAN();
  } else if (currentView === 'reports') {
    carregarRelatorioSelecionado();
  } else if (currentView === 'dashboard') {
    carregarOverviewDashboard();
  } else if (currentView === 'admin') {
    carregarAdminRouters();
  } else {
    carregarSDWAN();
  }
}

function onRouterChange() {
  currentRouterId = document.getElementById('router-select').value;
  atualizarViewAtiva();
}

// ----------------------------------------------------------------------
// 1. CARDS SD-WAN & BOTÃO ADICIONAR DESTINO
// ----------------------------------------------------------------------
async function carregarSDWAN() {
  if (!currentRouterId) {
    document.getElementById('sdwan-cards-container').innerHTML = '<div style="color:#64748b; padding:20px;">Nenhum MikroTik selecionado. Cadastre um cliente e roteador na administração.</div>';
    return;
  }
  const res = await apiFetch(`/api/routers/${currentRouterId}/sdwan`);
  const targets = await res.json();

  const container = document.getElementById('sdwan-cards-container');
  container.innerHTML = '';

  if (targets.length === 0) {
    container.innerHTML = '<div style="color:#64748b; padding:20px;">Nenhum destino monitorado ainda. Clique no botão <strong>+ Adicionar Destino</strong> acima para cadastrar o primeiro serviço (ex: Email, Sistema Nuvem, ERP)!</div>';
    return;
  }

  targets.forEach(t => {
    const card = document.createElement('div');
    card.className = 'sdwan-card';

    const sparklineSvg = gerarSparklineSvg(t.sparkline || [1, 1]);
    const isIts = (t.active_link || '').toUpperCase().includes('ITS');
    const linkIndicatorClass = isIts ? 'its' : 'claro';

    const cleanTName = escapeHtml(t.name);
    const cleanTAddress = escapeHtml(t.address);
    const cleanTLink = escapeHtml(t.active_link || 'Aguardando');
    const safeNameAttr = (t.name || '').replace(/'/g, "\\'");

    card.innerHTML = `
      <div class="card-header-inner">
        <h3 class="card-title">${cleanTName}</h3>
        <span class="status-badge">Melhor rota estabelecida</span>
        
        <div class="card-meta-list">
          <div>
            <strong>Link:</strong> 
            <span class="link-pill">
              <span class="link-indicator ${linkIndicatorClass}"></span> 
              ${cleanTLink}
            </span>
          </div>
          <div><strong>Endereço:</strong> ${cleanTAddress}</div>
          <div><strong>Métrica:</strong> ${t.metric_rtt ? t.metric_rtt.toFixed(2) + 'ms' : '0.00ms'}</div>
          <div><strong>Último teste:</strong> ${formatarData(t.last_tested)}</div>
        </div>
      </div>

      <div class="card-sparkline-container">
        ${sparklineSvg}
      </div>

      <div class="card-actions-bar">
        <span class="card-action-btn" onclick="abrirTimeline(${t.id}, '${safeNameAttr}')">📑 Relatório</span>
        <span class="card-action-btn" onclick="abrirGraficos(${t.id}, '${safeNameAttr}')">📊 Rel. Detalhado</span>
        <span class="card-action-btn" style="color:#ef4444;" onclick="excluirDestinoSDWAN(${t.id})">🗑️</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function abrirModalNovoDestino() {
  if (!currentRouterId) {
    alert('Selecione ou cadastre um MikroTik primeiro.');
    return;
  }
  document.getElementById('sdwan-novo-nome').value = '';
  document.getElementById('sdwan-novo-endereco').value = '';
  document.getElementById('modal-sdwan-destino').style.display = 'flex';
}

async function salvarNovoDestinoSDWAN(e) {
  e.preventDefault();
  const name = document.getElementById('sdwan-novo-nome').value;
  const address = document.getElementById('sdwan-novo-endereco').value;

  await apiFetch(`/api/routers/${currentRouterId}/sdwan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, address })
  });

  fecharModais();
  carregarSDWAN();
}

async function excluirDestinoSDWAN(targetId) {
  if (confirm('Deseja excluir o monitoramento deste destino SD-WAN?')) {
    await apiFetch(`/api/sdwan/${targetId}`, { method: 'DELETE' });
    carregarSDWAN();
  }
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

let activeChartInstances = [];

async function abrirGraficos(targetId, targetName) {
  document.getElementById('grafico-target-title').innerText = `${targetName} - Latência por Link`;
  document.getElementById('modal-graficos').style.display = 'flex';

  const container = document.getElementById('modal-graficos-body');
  container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary);">Carregando métricas...</div>';

  activeChartInstances.forEach(c => c.destroy());
  activeChartInstances = [];

  const res = await apiFetch(`/api/sdwan/${targetId}/metrics`);
  const data = await res.json();

  if (!data.metrics || data.metrics.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);">Nenhuma métrica registrada ainda para este destino.</div>';
    return;
  }

  // Agrupa métricas por link
  const linksMap = {};
  data.metrics.forEach(m => {
    if (!linksMap[m.link_name]) linksMap[m.link_name] = [];
    linksMap[m.link_name].push(m);
  });

  container.innerHTML = '';
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];
  let colorIdx = 0;

  for (const [linkName, metrics] of Object.entries(linksMap)) {
    const card = document.createElement('div');
    card.style.cssText = 'background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 20px;';

    const canvasId = `chart-link-${Math.random().toString(36).substr(2, 9)}`;
    const color = colors[colorIdx % colors.length];
    colorIdx++;

    const lastMetric = metrics[metrics.length - 1];
    const ultRtt = lastMetric ? `${lastMetric.rtt.toFixed(1)}ms` : '-';
    const ultLoss = lastMetric ? `${lastMetric.loss}%` : '-';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <h4 style="margin: 0; font-size: 15px; color: #1e293b; font-weight:700;">${linkName}</h4>
        <div style="font-size: 12px; color: var(--text-secondary);">
          Último: <strong style="color:${color}">${ultRtt}</strong> | Perda: <strong>${ultLoss}</strong>
        </div>
      </div>
      <div style="height: 180px;"><canvas id="${canvasId}"></canvas></div>
    `;
    container.appendChild(card);

    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: metrics.map(m => formatarHora(m.tested_at)),
        datasets: [{
          label: `Latência ${linkName} (ms)`,
          data: metrics.map(m => m.rtt),
          borderColor: color,
          backgroundColor: color + '22',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: false,
            title: { display: true, text: 'ms' }
          }
        }
      }
    });
    activeChartInstances.push(chart);
  }
}

// ----------------------------------------------------------------------
// 2. STATUS DOS LINKS
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
    const dotIcon = isUp ? '<span style="font-size:10px;">●</span>' : '<span style="font-size:10px;">✖</span>';
    const statusText = isUp ? 'ONLINE' : 'OFFLINE';

    card.innerHTML = `
      <div style="flex:1; padding-right:12px;">
        <div class="link-name-huge">${escapeHtml(l.link_name)}</div>
        <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
          Último teste: <strong style="color:var(--text-primary);">${formatarData(l.updated_at || l.last_changed)}</strong>
        </div>
        <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
          Última oscilação/queda: ${formatarData(l.last_changed)}
        </div>
      </div>
      <div style="flex-shrink:0;">
        <span class="${badgeClass}">${dotIcon} <span>${statusText}</span></span>
      </div>
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
      <td style="padding: 10px; font-weight: 600;">${escapeHtml(e.link_name)}</td>
      <td style="padding: 10px; color: ${color}; font-weight: 700;">${escapeHtml(e.status)}</td>
      <td style="padding: 10px;">${escapeHtml(e.score)}/8 pings</td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------------------------
// 3. RELATÓRIOS & SLA
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
// 4. ADMINISTRAÇÃO: CLIENTES, MIKROTIKS (COM HARDWARE), EVOLUTION, GRUPOS E USUÁRIOS
// ----------------------------------------------------------------------

// CLIENTES CRUD
async function carregarAdminClientes() {
  const res = await apiFetch('/api/clients');
  const clients = await res.json();
  const tbody = document.querySelector('#admin-clients-table tbody');
  tbody.innerHTML = '';

  clients.forEach(c => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600;">${c.name}</td>
      <td style="padding: 10px; color: #64748b;">${c.description || 'N/A'}</td>
      <td style="padding: 10px; font-size: 12px;">${formatarData(c.created_at)}</td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="editarCliente(${c.id}, '${c.name}', '${c.description || ''}')" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:8px;">✏️ Editar</button>
        <button onclick="excluirCliente(${c.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️ Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirModalCliente() {
  document.getElementById('modal-cliente-title').innerText = 'Cadastrar Cliente';
  document.getElementById('cliente-id').value = '';
  document.getElementById('cliente-nome').value = '';
  document.getElementById('cliente-desc').value = '';
  document.getElementById('modal-cliente').style.display = 'flex';
}

function editarCliente(id, name, desc) {
  document.getElementById('modal-cliente-title').innerText = 'Editar Cliente';
  document.getElementById('cliente-id').value = id;
  document.getElementById('cliente-nome').value = name;
  document.getElementById('cliente-desc').value = desc;
  document.getElementById('modal-cliente').style.display = 'flex';
}

async function salvarCliente(e) {
  e.preventDefault();
  const id = document.getElementById('cliente-id').value;
  const name = document.getElementById('cliente-nome').value;
  const description = document.getElementById('cliente-desc').value;

  if (id) {
    await apiFetch(`/api/clients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
  } else {
    await apiFetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
  }

  fecharModais();
  carregarAdminClientes();
  carregarClientes();
}

async function excluirCliente(id) {
  if (confirm('Tem certeza que deseja excluir este cliente? Todos os MikroTiks vinculados também serão removidos.')) {
    await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
    carregarAdminClientes();
    carregarClientes();
  }
}

// MIKROTIKS CRUD (COM DADOS DE HARDWARE E FIRMWARE)
async function carregarAdminRouters() {
  const res = await apiFetch('/api/routers');
  const routers = await res.json();
  allRouters = routers;
  const tbody = document.querySelector('#admin-routers-table tbody');
  tbody.innerHTML = '';

  routers.forEach(r => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';

    const board = r.model || r.board_name || 'MikroTik';
    const osVer = r.routeros_version ? `ROS ${r.routeros_version}` : 'Aguardando telemetria';
    const fwVer = r.firmware_version ? `FW: ${r.firmware_version}` : '';
    const cpuInfo = r.cpu_load !== null && r.cpu_load !== undefined ? `CPU: ${r.cpu_load}% (${r.cpu_count || 1}x)` : 'CPU: N/A';
    const memInfo = r.total_memory ? `Mem: ${r.free_memory || 0}MB livre / ${r.total_memory}MB` : '';
    const sdwanBadge = r.has_sdwan !== 0 
      ? '<span style="background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 6px;">SD-WAN</span>' 
      : '<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 6px;">1 Link (Monitor)</span>';

    const cleanRouterName = (r.name || '').replace(/'/g, "\\'");
    const cleanRouterModel = (r.model || '').replace(/'/g, "\\'");
    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600;">${escapeHtml(r.client_name)}</td>
      <td style="padding: 10px; font-weight: 600;">${escapeHtml(r.name)} ${sdwanBadge}</td>
      <td style="padding: 10px; font-weight: 600; color: #4f46e5;">${escapeHtml(board)}</td>
      <td style="padding: 10px; font-size: 12px; color: #334155;">${escapeHtml(osVer)} <br><span style="color:#64748b;">${escapeHtml(fwVer)}</span></td>
      <td style="padding: 10px; font-size: 12px; color: #334155;">${escapeHtml(cpuInfo)} <br><span style="color:#64748b;">${escapeHtml(memInfo)}</span></td>
      <td style="padding: 10px;"><code style="background: #f1f5f9; padding: 4px 6px; border-radius: 4px; font-weight: bold; color: #0284c7;">${escapeHtml(r.token)}</code></td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="copiarScriptBootstrap(${r.id}, this)" style="border:1px solid #bae6fd; background:#f0f9ff; color:#0284c7; padding:3px 8px; border-radius:4px; cursor:pointer; font-weight:600; font-size:12px; margin-right:8px; transition:all 0.2s;" title="Copiar Script de Ativação Universal para Área de Transferência">📋 Copiar Ativação</button>
        <button onclick="abrirModalOTA(${r.id})" style="border:none; background:none; color:#10b981; cursor:pointer; font-weight:600; margin-right:8px;" title="Gestão Remota e Comandos OTA">🔄 OTA</button>
        <button onclick="editarRouter(${r.id}, ${r.client_id}, '${cleanRouterName}', '${cleanRouterModel}', ${r.has_sdwan !== 0 ? 1 : 0})" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:8px;">✏️ Editar</button>
        <button onclick="excluirRouter(${r.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️ Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function abrirModalRouter() {
  const res = await apiFetch('/api/clients');
  const clients = await res.json();
  const select = document.getElementById('router-form-client');
  select.innerHTML = '';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = c.name;
    select.appendChild(opt);
  });

  document.getElementById('modal-router-title').innerText = 'Cadastrar MikroTik';
  document.getElementById('router-id').value = '';
  document.getElementById('router-form-nome').value = '';
  document.getElementById('router-form-model').value = '';
  const sdwanCheck = document.getElementById('router-form-sdwan');
  if (sdwanCheck) sdwanCheck.checked = true;
  document.getElementById('modal-router').style.display = 'flex';
}

async function editarRouter(id, clientId, name, model, hasSdwan) {
  const res = await apiFetch('/api/clients');
  const clients = await res.json();
  const select = document.getElementById('router-form-client');
  select.innerHTML = '';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = c.name;
    if (c.id === clientId) opt.selected = true;
    select.appendChild(opt);
  });

  document.getElementById('modal-router-title').innerText = 'Editar MikroTik';
  document.getElementById('router-id').value = id;
  document.getElementById('router-form-nome').value = name;
  document.getElementById('router-form-model').value = model;
  const sdwanCheck = document.getElementById('router-form-sdwan');
  if (sdwanCheck) sdwanCheck.checked = (hasSdwan !== 0 && hasSdwan !== false);
  document.getElementById('modal-router').style.display = 'flex';
}

async function salvarRouter(e) {
  e.preventDefault();
  const id = document.getElementById('router-id').value;
  const clientId = document.getElementById('router-form-client').value;
  const name = document.getElementById('router-form-nome').value;
  const model = document.getElementById('router-form-model').value;
  const sdwanCheck = document.getElementById('router-form-sdwan');
  const has_sdwan = sdwanCheck ? (sdwanCheck.checked ? 1 : 0) : 1;

  if (id) {
    await apiFetch(`/api/routers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name, model, has_sdwan })
    });
  } else {
    await apiFetch('/api/routers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name, model, has_sdwan })
    });
  }

  fecharModais();
  carregarAdminRouters();
  carregarRoteadoresDoCliente();
}

async function excluirRouter(id) {
  if (confirm('Tem certeza que deseja excluir este MikroTik?')) {
    await apiFetch(`/api/routers/${id}`, { method: 'DELETE' });
    carregarAdminRouters();
    carregarRoteadoresDoCliente();
  }
}

// EVOLUTION API
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

// GRUPOS
async function carregarAdminGrupos() {
  const res = await apiFetch('/api/admin/groups');
  const groups = await res.json();
  const tbody = document.querySelector('#groups-table tbody');
  tbody.innerHTML = '';
  groups.forEach(g => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 8px; font-weight: 600;">${g.name}</td>
      <td style="padding: 8px; color: #16a34a; font-weight: 700;">+${g.whatsapp_number || 'N/A'}</td>
      <td style="padding: 8px; text-align: right;">
        <button onclick="editarGrupo(${g.id})" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:6px;">✏️</button>
        <button onclick="excluirGrupo(${g.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️</button>
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
  if (confirm('Tem certeza que deseja excluir este grupo?')) {
    await apiFetch(`/api/admin/groups/${id}`, { method: 'DELETE' });
    carregarAdminGrupos();
  }
}

// USUÁRIOS
async function carregarAdminUsuarios() {
  const res = await apiFetch('/api/admin/users');
  const users = await res.json();
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding: 8px; font-weight: 600;">${u.name}</td>
      <td style="padding: 8px;">${u.username}</td>
      <td style="padding: 8px; text-align: right;">
        <button onclick="editarUsuario(${u.id})" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:6px;">✏️</button>
        <button onclick="excluirUsuario(${u.id})" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;">🗑️</button>
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
  select.innerHTML = '<option value="">Sem restrição (Acesso Total)</option>';
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
  select.innerHTML = '<option value="">Sem restrição (Acesso Total)</option>';
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
      alert(data.error || 'Erro ao excluir');
      return;
    }
    carregarAdminUsuarios();
  }
}

function fecharModais() {
  // Fecha universalmente qualquer modal pela classe
  document.querySelectorAll('.timeline-modal').forEach(m => {
    m.style.display = 'none';
  });

  // Garante o fechamento de todos os modais por ID
  const allModalIds = [
    'modal-timeline', 'modal-graficos', 'modal-grupo', 'modal-usuario',
    'modal-cliente', 'modal-router', 'modal-sdwan-destino', 'modal-ota',
    'modal-batch-details', 'modal-bootstrap'
  ];
  allModalIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// Fecha modais ao clicar no fundo escuro (backdrop)
window.addEventListener('click', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('timeline-modal')) {
    fecharModais();
  }
});

// Fecha modais ao pressionar tecla ESC
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    fecharModais();
  }
});

function parseUtcDate(dtString) {
  if (!dtString) return null;
  let s = dtString.trim();
  // Se a string vier no formato 'YYYY-MM-DD HH:MM:SS', converte para ISO
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  // Se não termina com Z e não possui sufixo de fuso (+00:00 ou -03:00 no final), adiciona 'Z' (UTC)
  if (!s.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(s)) {
    s += 'Z';
  }
  return new Date(s);
}

function formatarData(dtString) {
  const d = parseUtcDate(dtString);
  if (!d || isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatarHora(dtString) {
  const d = parseUtcDate(dtString);
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}


// ----------------------------------------------------------------------
// FUNÇÕES DE GESTÃO REMOTA & OTA (MODELO 2)
// ----------------------------------------------------------------------
let otaTargetRouterId = null;

async function abrirModalOTA(routerId) {
  try {
    otaTargetRouterId = routerId || currentRouterId;
    if (!otaTargetRouterId) {
      if (allRouters && allRouters.length > 0) otaTargetRouterId = allRouters[0].id;
    }
    if (!otaTargetRouterId) return alert('Nenhum roteador selecionado');

    if (!allRouters || allRouters.length === 0) {
      const res = await apiFetch('/api/routers');
      allRouters = await res.json();
    }

    const router = (allRouters || []).find(r => Number(r.id) === Number(otaTargetRouterId));
    const routerName = router ? router.name : 'Roteador #' + otaTargetRouterId;
    const token = router ? router.token : '';

    const subtitleEl = document.getElementById('ota-router-subtitle');
    if (subtitleEl) subtitleEl.innerText = `Roteador: ${routerName} (Token: ${token})`;

    const agentScript = `/system script remove [find name="tracert_sync"]
/system script add dont-require-permissions=no name="tracert_sync" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local syncUrl "https://tracert.tiplus.inf.br/api/routers/sync/${token}"
    :do {
        /tool fetch check-certificate=no url=$syncUrl dst-path="tracert_sync.rsc" keep-result=yes
        :local f [/file find name="tracert_sync.rsc"]
        :if ([:len $f] > 0) do={
            :local sz [/file get $f size]
            :if ($sz > 45) do={
                /import file-name="tracert_sync.rsc"
                /log info message="[TRACERT+] Comandos sincronizados da nuvem executados com sucesso!"
            }
            /file remove [find name="tracert_sync.rsc"]
        }
    } on-error={}
}
/system scheduler remove [find name="executa_tracert_sync"]
/system scheduler add interval=1m name="executa_tracert_sync" on-event="tracert_sync" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup`;

    const codeEl = document.getElementById('ota-agent-code');
    if (codeEl) codeEl.innerText = agentScript;

    const modalEl = document.getElementById('modal-ota');
    if (modalEl) modalEl.style.display = 'flex';
    carregarHistoricoOTA();
  } catch (err) {
    console.error('Erro ao abrir modal OTA:', err);
    alert('Erro ao abrir OTA: ' + err.message);
  }
}

function alternarInstrucoesAgente() {
  const el = document.getElementById('ota-agent-instructions');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function carregarHistoricoOTA() {
  if (!otaTargetRouterId) return;
  const tbody = document.getElementById('ota-commands-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">Carregando histórico...</td></tr>';

  try {
    const res = await apiFetch(`/api/routers/${otaTargetRouterId}/commands`);
    const commands = await res.json();
    if (!commands || commands.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 12px; text-align: center; color: #94a3b8;">Nenhum comando na fila para este roteador.</td></tr>';
      return;
    }

    tbody.innerHTML = commands.map(cmd => {
      let statusBadge = '<span style="background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 10px; font-weight: 600; font-size: 11px;">PENDENTE</span>';
      if (cmd.status === 'EXECUTED') {
        statusBadge = '<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 10px; font-weight: 600; font-size: 11px;">EXECUTADO</span>';
      } else if (cmd.status === 'ERROR') {
        statusBadge = '<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 10px; font-weight: 600; font-size: 11px;">ERRO</span>';
      }

      const created = cmd.created_at ? parseUtcDate(cmd.created_at).toLocaleString('pt-BR') : '-';
      const cleanPayload = (cmd.payload || '').replace(/"/g, '&quot;');
      const actionBtn = cmd.status === 'PENDING'
        ? `<button onclick="cancelarComandoOTA(${cmd.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:600;">Cancelar</button>`
        : '<span style="color:#94a3b8;">-</span>';

      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 8px 10px; font-weight:600;">#${cmd.id}</td>
          <td style="padding: 8px 10px; font-weight:500;" title="${cleanPayload}">${cmd.command_name || cmd.command_type}</td>
          <td style="padding: 8px 10px; color:#64748b; font-size:11px;">${cmd.command_type}</td>
          <td style="padding: 8px 10px;">${statusBadge}</td>
          <td style="padding: 8px 10px; color:#64748b; font-size:11.5px;">${created}</td>
          <td style="padding: 8px 10px; text-align:right;">${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 12px; text-align: center; color: #ef4444;">Erro ao carregar: ${e.message}</td></tr>`;
  }
}

async function enviarSyncTargetsOTA() {
  if (!otaTargetRouterId) return;
  try {
    const res = await apiFetch(`/api/routers/${otaTargetRouterId}/sync-targets`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Comando de sincronização enfileirado com sucesso!');
    carregarHistoricoOTA();
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function sincronizarDestinosRB() {
  if (!currentRouterId) return alert('Selecione um roteador primeiro');
  try {
    const res = await apiFetch(`/api/routers/${currentRouterId}/sync-targets`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Comando de sincronização dos destinos enfileirado para a RB!');
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function enviarFailoverOTA() {
  if (!otaTargetRouterId) return;
  if (!confirm('Deseja enviar o script oficial de Failover Multi-Link (v8 - Modelo Bendito) para esta RouterBoard?\n\nEle será executado no próximo ciclo de sincronização OTA (< 1 min).')) return;
  try {
    const res = await apiFetch(`/api/routers/${otaTargetRouterId}/failover`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Script de Failover enfileirado com sucesso para a RB!');
    carregarHistoricoOTA();
  } catch(e) {
    alert('Erro ao enfileirar failover: ' + e.message);
  }
}

async function enviarOtaUpdateScript() {
  if (!otaTargetRouterId) return;
  if (!confirm('Deseja enviar a atualização completa do script SD-WAN (v4.1) via OTA para esta RouterBoard?')) return;
  try {
    const res = await apiFetch(`/api/routers/${otaTargetRouterId}/ota-update`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Atualização OTA do script enfileirada com sucesso!');
    carregarHistoricoOTA();
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function enviarComandoManualOTA() {
  const input = document.getElementById('ota-custom-command');
  const command = input.value.trim();
  if (!command) return alert('Digite um comando do RouterOS');

  try {
    await apiFetch(`/api/routers/${otaTargetRouterId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, name: command.substring(0, 30) })
    });
    input.value = '';
    alert('Comando inserido na fila de execução da RB!');
    carregarHistoricoOTA();
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function cancelarComandoOTA(id) {
  if (!confirm('Cancelar este comando pendente?')) return;
  try {
    await apiFetch(`/api/commands/${id}`, { method: 'DELETE' });
    carregarHistoricoOTA();
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}


// ----------------------------------------------------------------------
// GESTÃO DE SUB-ABAS EM ADMINISTRAÇÃO E COMANDOS EM MASSA (OTA)
// ----------------------------------------------------------------------
function switchAdminSubtab(subtab) {
  const tabs = ['routers', 'commands', 'clients', 'evolution', 'access'];
  tabs.forEach(t => {
    const el = document.getElementById(`admin-subtab-${t}`);
    const btn = document.getElementById(`admin-subtab-${t}-btn`);
    if (el) el.style.display = (t === subtab) ? 'block' : 'none';
    if (btn) {
      if (t === subtab) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  if (subtab === 'commands') {
    carregarHistoricoLotesMassa();
    carregarOpcoesSelecaoManual();
  }
}

async function carregarOpcoesSelecaoManual() {
  const res = await apiFetch('/api/routers');
  const routers = await res.json();
  const container = document.getElementById('bcmd-routers-list');
  if (!container) return;
  container.innerHTML = '';

  routers.forEach(r => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.fontSize = '12px';
    label.style.cursor = 'pointer';
    label.style.background = '#ffffff';
    label.style.padding = '6px 8px';
    label.style.borderRadius = '4px';
    label.style.border = '1px solid var(--border-color)';

    const tag = r.has_sdwan !== 0 ? '🔀 SD-WAN' : '📶 1 Link';
    label.innerHTML = `
      <input type="checkbox" class="bcmd-router-chk" value="${r.id}" checked>
      <span style="font-weight: 600; color: #1e293b;">${r.name}</span>
      <span style="color: #64748b; font-size: 11px;">(${tag})</span>
    `;
    container.appendChild(label);
  });
}

function aoMudarFiltroDestinatarios() {
  const filter = document.getElementById('bcmd-target-filter').value;
  const manualBox = document.getElementById('bcmd-manual-box');
  if (manualBox) {
    manualBox.style.display = (filter === 'SELECTED') ? 'block' : 'none';
  }
}

function marcarTodosRoutersMassa(marcar) {
  document.querySelectorAll('.bcmd-router-chk').forEach(chk => chk.checked = marcar);
}

function aplicarTemplateMassa(template) {
  const textarea = document.getElementById('bcmd-script');
  const nameInput = document.getElementById('bcmd-name');
  if (!textarea) return;

  if (template === 'failover') {
    if (nameInput) nameInput.value = 'Configuração Failover Multi-Link (Bendito v8)';
    textarea.value = `# =======================================================================
# SCRIPT: FAILOVER_SETUP_AND_MONITOR (TRACERT+ OFICIAL v8 UNIVERSAL)
# =======================================================================

# 1. Limpeza segura de regras anteriores
:foreach r in=[/ip route find comment~"!=="] do={ :do { /ip route remove $r } on-error={} }
:do { :foreach r in=[/routing rule find comment~"!=="] do={ :do { /routing rule remove $r } on-error={} } } on-error={}
:do { :foreach r in=[/ip route rule find comment~"!=="] do={ :do { /ip route rule remove $r } on-error={} } } on-error={}
:do { /system script remove [find name="failover"] } on-error={}
:do { /system scheduler remove [find name="executa script failover"] } on-error={}

# 2. Setup dinâmico de tabelas e rotas de teste
:foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-mark<>""] do={
    :local gw [/ip route get $i gateway]
    :local cmt [/ip route get $i comment]

    :if ([:len $cmt] > 0) do={
        :local safeCmt ""
        :for idx from=0 to=([:len $cmt] - 1) do={
            :local char [:pick $cmt $idx ($idx + 1)]
            :if ($char = " ") do={ :set char "-" }
            :set safeCmt ($safeCmt . $char)
        }

        :local tabName ("rota-de-teste-para-" . $safeCmt)

        :do {
            /routing table add name=$tabName fib
        } on-error={}

        :do {
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-table=$tabName comment=("!== Rota de teste para " . $cmt)
        } on-error={
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-mark=$tabName comment=("!== Rota de teste para " . $cmt)
        }

        :do {
            /routing rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cmt)
        } on-error={
            :do { /ip route rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cmt) } on-error={}
        }
    }
}

# 3. Criação de Ação Padrão de Failover se não existir
:if ([:len [/system script find name="FAILOVER_ACTIONS"]] = 0) do={
    /system script add name="FAILOVER_ACTIONS" source={
        :global foLinkName
        :global foLinkStatus
        :global foPingScore
        :log warning message=("[TRACERT+ FAILOVER] Link " . $foLinkName . " mudou de estado para: " . $foLinkStatus . " (Score: " . $foPingScore . ")")
    }
}

# 4. Script de monitoramento de Failover
/system script add dont-require-permissions=no name="failover" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local IPsParaTeste [:toarray "8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8"]
    :local NumeroDePings 2
    :local Intervalo 00:00:00.5
    :local ScoreMinimoUP 3

    :global foRouterName [/system identity get name]
    :global foLinkName
    :global foLinkStatus
    :global foPingScore

    :local totalRotasAtivas [/ip route print count-only where dst-address=0.0.0.0/0 routing-mark<>"" disabled=no comment!~"!=="]

    :foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-mark<>""] do={
        :local cmt [/ip route get $i comment]
        :if ([:len $cmt] > 0 and !($cmt ~ "!==")) do={
            :delay 1
            :local safeCmt ""
            :for idx from=0 to=([:len $cmt] - 1) do={
                :local char [:pick $cmt $idx ($idx + 1)]
                :if ($char = " ") do={ :set char "-" }
                :set safeCmt ($safeCmt . $char)
            }
            :local TabRoteAtual ("rota-de-teste-para-" . $safeCmt)
            :local scoreAtual 0
            :foreach ip in=$IPsParaTeste do={
                :local res [/ping $ip count=$NumeroDePings interval=$Intervalo routing-table=$TabRoteAtual]
                :set scoreAtual ($scoreAtual + $res)
            }
            :local isDis [/ip route get $i disabled]
            :if ($scoreAtual < $ScoreMinimoUP and $isDis = false) do={
                :if ($totalRotasAtivas > 1) do={
                    /ip route disable [find comment=$cmt and !comment~"!=="]
                    :set totalRotasAtivas ($totalRotasAtivas - 1)
                    :set foLinkName $cmt
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                } else={
                    /log warning message=("[FAILOVER] Link " . $cmt . " falhou, mantido ativo por ser o unico!")
                }
            }
            :if ($scoreAtual >= $ScoreMinimoUP and $isDis = true) do={
                /ip route enable [find comment=$cmt and !comment~"!=="]
                :set totalRotasAtivas ($totalRotasAtivas + 1)
                :set foLinkName $cmt
                :set foLinkStatus "UP"
                :set foPingScore $scoreAtual
                :do { /system script run FAILOVER_ACTIONS } on-error={}
            }
        }
    }
}

# 5. Agendador (a cada 30 segundos)
/system scheduler add interval=30s name="executa script failover" on-event="failover" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
:log info message="[TRACERT+] Failover Multi-Link v8 provisionado com sucesso!";`;
  } else if (template === 'ntp') {
    if (nameInput) nameInput.value = 'Configuração NTP Brasil (pool.ntp.br)';
    textarea.value = `/system clock set time-zone-name=America/Fortaleza;\n/system ntp client set enabled=yes primary-ntp=200.160.7.186 secondary-ntp=200.189.40.8;\n:log info message="[TRACERT+] NTP e fuso horário configurados com sucesso!";`;
  } else if (template === 'dns') {
    if (nameInput) nameInput.value = 'Atualização DNS Primário (Cloudflare / Google)';
    textarea.value = `/ip dns set servers=1.1.1.1,8.8.8.8 allow-remote-requests=no;\n/ip dns cache flush;\n:log info message="[TRACERT+] Servidores DNS atualizados para 1.1.1.1 e 8.8.8.8";`;
  } else if (template === 'flush_dns') {
    if (nameInput) nameInput.value = 'Limpeza de Cache DNS';
    textarea.value = `/ip dns cache flush;\n:log info message="[TRACERT+] Cache DNS limpo com sucesso!";`;
  } else if (template === 'telemetry') {
    if (nameInput) nameInput.value = 'Forçar Envio Imediato de Telemetria';
    textarea.value = `/system script run tracert_system_telemetry;\n:log info message="[TRACERT+] Telemetria forçada pelo administrador.";`;
  } else if (template === 'reboot') {
    if (nameInput) nameInput.value = 'Reinicialização Remota do Equipamento';
    textarea.value = `:log warning message="[TRACERT+] Reinicializando equipamento sob demanda via nuvem...";\n/system reboot;`;
  } else if (template === 'clear') {
    if (nameInput) nameInput.value = '';
    textarea.value = '';
  }
}

async function dispararComandoMassa(e) {
  e.preventDefault();
  const targetFilter = document.getElementById('bcmd-target-filter').value;
  const commandName = document.getElementById('bcmd-name').value;
  const script = document.getElementById('bcmd-script').value;

  let selectedRouterIds = [];
  if (targetFilter === 'SELECTED') {
    document.querySelectorAll('.bcmd-router-chk:checked').forEach(chk => {
      selectedRouterIds.push(parseInt(chk.value));
    });
    if (selectedRouterIds.length === 0) {
      return alert('Selecione pelo menos um roteador na lista.');
    }
  }

  const confirmMsg = `Deseja realmente disparar o comando "${commandName}" para os roteadores selecionados?\n\nOs roteadores buscarão e executarão o comando no próximo ciclo de sincronização (até 1 minuto).`;
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-disparar-massa');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch('/api/admin/commands/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFilter, selectedRouterIds, commandName, script })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao disparar comandos em massa');
      return;
    }

    alert(`Sucesso! Comando disparado para ${data.totalQueued} roteadores.\nLote ID: ${data.batchId}`);
    document.getElementById('bcmd-script').value = '';
    document.getElementById('bcmd-name').value = '';
    carregarHistoricoLotesMassa();
  } catch (err) {
    alert('Erro de conexão ao enviar comandos: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function carregarHistoricoLotesMassa() {
  const res = await apiFetch('/api/admin/commands/batches');
  if (!res.ok) return;
  const batches = await res.json();
  const tbody = document.querySelector('#admin-batch-commands-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (batches.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum comando em massa disparado ainda.</td></tr>`;
    return;
  }

  batches.forEach(b => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';

    const total = b.total_routers || 0;
    const executed = b.executed_count || 0;
    const pending = b.pending_count || 0;
    const cancelled = b.cancelled_count || 0;
    const percent = total > 0 ? Math.round((executed / total) * 100) : 0;

    let statusHtml = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="flex: 1; background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden; max-width: 120px;">
          <div style="width: ${percent}%; background: ${percent === 100 ? '#10b981' : '#0284c7'}; height: 100%;"></div>
        </div>
        <span style="font-weight: 600; font-size: 12px; color: ${percent === 100 ? '#059669' : '#0284c7'};">${percent}%</span>
        <span style="font-size: 11px; color: #64748b;">(${executed}/${total})</span>
      </div>
    `;

    const d = new Date(b.created_at);
    const dataFormatada = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    const safeCmdName = (b.command_name || '').replace(/'/g, "\\'");
    tr.innerHTML = `
      <td style="padding: 10px; color: #64748b; font-size: 12.5px;">${dataFormatada}</td>
      <td style="padding: 10px; font-weight: 600; color: #1e293b;">${escapeHtml(b.command_name)}</td>
      <td style="padding: 10px;"><span style="background: #f1f5f9; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${total} MikroTiks</span></td>
      <td style="padding: 10px;">${statusHtml}</td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="verDetalhesLote('${b.batch_id}', '${safeCmdName}', '${b.created_at}')" style="border:none; background:none; color:#0284c7; cursor:pointer; font-weight:600; margin-right:8px;" title="Ver Status Detalhado">🔍 Detalhes</button>
        ${pending > 0 ? `<button onclick="cancelarLotePendente('${b.batch_id}')" style="border:none; background:none; color:#ef4444; cursor:pointer; font-weight:600;" title="Cancelar Pendentes">❌ Cancelar</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function verDetalhesLote(batchId, cmdName, createdAt) {
  const res = await apiFetch(`/api/admin/commands/batches/${batchId}`);
  if (!res.ok) return alert('Erro ao carregar detalhes do lote');
  const items = await res.json();

  document.getElementById('batch-modal-cmd-name').innerText = cmdName;
  document.getElementById('batch-modal-created').innerText = formatarData(createdAt);

  const total = items.length;
  const executed = items.filter(i => i.status === 'EXECUTED').length;
  document.getElementById('batch-modal-stats').innerText = `${executed} de ${total} executados com sucesso`;

  const tbody = document.querySelector('#batch-routers-detail-table tbody');
  tbody.innerHTML = '';

  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';

    let badgeStatus = `<span style="background:#fef3c7; color:#92400e; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">PENDENTE</span>`;
    if (item.status === 'EXECUTED') {
      badgeStatus = `<span style="background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">EXECUTADO</span>`;
    } else if (item.status === 'FETCHED') {
      badgeStatus = `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">BAIXADO</span>`;
    } else if (item.status === 'CANCELLED') {
      badgeStatus = `<span style="background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:11px;">CANCELADO</span>`;
    }

    const execTime = item.executed_at ? formatarData(item.executed_at) : '-';
    const tagSdwan = item.has_sdwan !== 0 ? 'SD-WAN' : '1 Link';

    tr.innerHTML = `
      <td style="padding: 8px 10px;"><b>${escapeHtml(item.client_name)}</b><br><span style="color:#64748b;">${escapeHtml(item.router_name)}</span></td>
      <td style="padding: 8px 10px; font-size: 11.5px; color:#475569;">${escapeHtml(item.model || 'MikroTik')}<br><span style="color:#64748b;">${escapeHtml(item.routeros_version || 'ROS')} (${tagSdwan})</span></td>
      <td style="padding: 8px 10px;">${badgeStatus}</td>
      <td style="padding: 8px 10px; color:#64748b; font-size: 12px;">${execTime}</td>
    `;
    tbody.appendChild(tr);
  });

  if (items.length > 0) {
    // Buscar script
    const sampleBatch = await apiFetch('/api/admin/commands/batches');
    const bList = await sampleBatch.json();
    const curr = bList.find(b => b.batch_id === batchId);
    document.getElementById('batch-modal-script').innerText = curr ? curr.payload : 'Script não disponível';
  }

  document.getElementById('modal-batch-details').style.display = 'flex';
}

async function cancelarLotePendente(batchId) {
  if (confirm('Deseja cancelar os comandos pendentes deste lote para todos os roteadores que ainda não o executaram?')) {
    const res = await apiFetch(`/api/admin/commands/batches/${batchId}/cancel`, { method: 'POST' });
    const data = await res.json();
    alert(`Cancelados ${data.cancelled} comandos pendentes.`);
    carregarHistoricoLotesMassa();
  }
}


// ----------------------------------------------------------------------
// SCRIPT DE ATIVAÇÃO 1-TOUCH (COPIAR DIRETO)
// ----------------------------------------------------------------------
async function copiarScriptBootstrap(routerId, btnElement) {
  try {
    const res = await apiFetch(`/api/routers/${routerId}/bootstrap`);
    if (!res.ok) {
      const err = await res.json();
      return alert('Erro ao carregar script de ativação: ' + (err.error || res.statusText));
    }
    const data = await res.json();
    const script = data.script;

    let copiado = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(script);
        copiado = true;
      } catch (e) {}
    }

    if (!copiado) {
      const ta = document.createElement('textarea');
      ta.value = script;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      copiado = document.execCommand('copy');
      document.body.removeChild(ta);
    }

    // Feedback visual no botão
    if (btnElement) {
      const originalText = btnElement.innerHTML;
      const originalBg = btnElement.style.background;
      const originalColor = btnElement.style.color;
      const originalBorder = btnElement.style.borderColor;

      btnElement.innerHTML = '✅ Copiado!';
      btnElement.style.background = '#dcfce7';
      btnElement.style.color = '#166534';
      btnElement.style.borderColor = '#86efac';

      setTimeout(() => {
        btnElement.innerHTML = originalText;
        btnElement.style.background = originalBg;
        btnElement.style.color = originalColor;
        btnElement.style.borderColor = originalBorder;
      }, 3500);
    }

    // Aviso em destaque para o usuário
    alert(`✅ SCRIPT DE ATIVAÇÃO COPIADO COM SUCESSO!\n\nRoteador: ${data.router.name}\nToken: ${data.router.token}\n\nO script universal (v6/v7) já está na sua área de transferência.\nBasta abrir o Terminal do MikroTik (Winbox ou SSH) e colar (Ctrl+V).`);

  } catch (err) {
    alert('Erro ao processar ativação: ' + err.message);
  }
}
