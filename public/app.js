let authToken = localStorage.getItem('sdwan_token');
let currentUser = JSON.parse(localStorage.getItem('sdwan_user') || 'null');
let currentClientId = null;
let currentRouterId = null;
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
          <strong style="color:#dc2626;">${l.link_name}</strong> - ${l.router_name} (${l.client_name})
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
          <strong style="color:${color};">${e.status}</strong>: ${e.link_name} em <em>${e.router_name}</em>
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

  carregarSDWAN();
}

function onRouterChange() {
  currentRouterId = document.getElementById('router-select').value;
  carregarSDWAN();
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

    card.innerHTML = `
      <div class="card-header-inner">
        <h3 class="card-title">${t.name}</h3>
        <span class="status-badge">Melhor rota estabelecida</span>
        
        <div class="card-meta-list">
          <div>
            <strong>Link:</strong> 
            <span class="link-pill">
              <span class="link-indicator ${linkIndicatorClass}"></span> 
              ${t.active_link || 'Aguardando'}
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
    const statusText = isUp ? '● ONLINE' : '✖ OFFLINE';

    card.innerHTML = `
      <div>
        <div class="link-name-huge">${l.link_name}</div>
        <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
          Último teste: <strong style="color:var(--text-primary);">${formatarData(l.updated_at || l.last_changed)}</strong>
        </div>
        <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
          Última oscilação/queda: ${formatarData(l.last_changed)}
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

    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600;">${r.client_name}</td>
      <td style="padding: 10px;">${r.name}</td>
      <td style="padding: 10px; font-weight: 600; color: #4f46e5;">${board}</td>
      <td style="padding: 10px; font-size: 12px; color: #334155;">${osVer} <br><span style="color:#64748b;">${fwVer}</span></td>
      <td style="padding: 10px; font-size: 12px; color: #334155;">${cpuInfo} <br><span style="color:#64748b;">${memInfo}</span></td>
      <td style="padding: 10px;"><code style="background: #f1f5f9; padding: 4px 6px; border-radius: 4px; font-weight: bold; color: #0284c7;">${r.token}</code></td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="editarRouter(${r.id}, ${r.client_id}, '${r.name}', '${r.model || ''}')" style="border:none; background:none; color:#3b82f6; cursor:pointer; font-weight:600; margin-right:8px;">✏️ Editar</button>
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
  document.getElementById('modal-router').style.display = 'flex';
}

async function editarRouter(id, clientId, name, model) {
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
  document.getElementById('modal-router').style.display = 'flex';
}

async function salvarRouter(e) {
  e.preventDefault();
  const id = document.getElementById('router-id').value;
  const clientId = document.getElementById('router-form-client').value;
  const name = document.getElementById('router-form-nome').value;
  const model = document.getElementById('router-form-model').value;

  if (id) {
    await apiFetch(`/api/routers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name, model })
    });
  } else {
    await apiFetch('/api/routers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name, model })
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
  document.getElementById('modal-timeline').style.display = 'none';
  document.getElementById('modal-graficos').style.display = 'none';
  document.getElementById('modal-grupo').style.display = 'none';
  document.getElementById('modal-usuario').style.display = 'none';
  document.getElementById('modal-cliente').style.display = 'none';
  document.getElementById('modal-router').style.display = 'none';
  document.getElementById('modal-sdwan-destino').style.display = 'none';
}

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
