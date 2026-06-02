<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AUDORA Dashboard - Order Management</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080808;
      --surface: #111111;
      --surface-light: #1a1a1a;
      --surface-lighter: #222222;
      --border: #2a2a2a;
      --gold: #c9a84c;
      --gold-light: #e2c27d;
      --gold-dark: #8a6f33;
      --text: #e8e8e8;
      --text-dim: #888;
      --text-muted: #666;
      --green: #22c55e;
      --green-bg: rgba(34, 197, 94, 0.1);
      --red: #ef4444;
      --red-bg: rgba(239, 68, 68, 0.1);
      --blue: #3b82f6;
      --blue-bg: rgba(59, 130, 246, 0.1);
      --purple: #8b5cf6;
      --purple-bg: rgba(139, 92, 246, 0.1);
      --orange: #f59e0b;
      --orange-bg: rgba(245, 158, 11, 0.1);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Montserrat', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* Login Screen */
    .login-screen {
      position: fixed;
      inset: 0;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .login-screen.hidden { display: none; }
    .login-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 48px 40px;
      width: 400px;
      text-align: center;
    }
    .login-logo {
      font-family: 'Cormorant Garamond', serif;
      font-size: 36px;
      letter-spacing: 8px;
      color: var(--gold);
      margin-bottom: 8px;
    }
    .login-subtitle {
      font-size: 10px;
      letter-spacing: 4px;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 36px;
    }
    .login-input {
      width: 100%;
      background: var(--surface-light);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      color: var(--text);
      font-size: 14px;
      margin-bottom: 20px;
      outline: none;
      transition: all 0.3s;
      font-family: 'Montserrat', sans-serif;
    }
    .login-input:focus {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.1);
    }
    .login-btn {
      width: 100%;
      background: linear-gradient(135deg, #b8912e, var(--gold), var(--gold-light));
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 16px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.3s;
      font-family: 'Montserrat', sans-serif;
    }
    .login-btn:hover {
      filter: brightness(1.1);
      transform: translateY(-2px);
    }
    .login-error {
      color: var(--red);
      font-size: 12px;
      margin-top: 16px;
      display: none;
    }

    /* Dashboard Layout */
    .dashboard {
      display: none;
      min-height: 100vh;
    }
    .dashboard.active { display: flex; }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 0;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      overflow-y: auto;
      z-index: 100;
    }
    .sidebar-header {
      padding: 28px 24px 20px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-logo {
      font-family: 'Cormorant Garamond', serif;
      font-size: 22px;
      letter-spacing: 5px;
      color: var(--gold);
    }
    .sidebar-subtitle {
      font-size: 9px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .sidebar-nav { padding: 16px 12px; }
    .sidebar-section {
      font-size: 9px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 16px 16px 8px;
    }
    .sidebar-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: var(--text-dim);
      text-decoration: none;
      border-radius: 8px;
      margin-bottom: 2px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      font-family: 'Montserrat', sans-serif;
    }
    .sidebar-link:hover {
      background: var(--surface-light);
      color: var(--text);
    }
    .sidebar-link.active {
      background: rgba(201, 168, 76, 0.1);
      color: var(--gold);
    }
    .sidebar-link .icon { font-size: 18px; }
    .sidebar-link .badge {
      margin-left: auto;
      background: var(--gold);
      color: #000;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 700;
    }

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: 280px;
      padding: 32px 40px;
      min-height: 100vh;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }
    .page-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 32px;
      font-weight: 300;
      color: var(--text);
    }
    .page-title span {
      color: var(--gold);
      font-style: italic;
    }
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.3s;
      font-family: 'Montserrat', sans-serif;
      border: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--gold-dark), var(--gold));
      color: #000;
    }
    .btn-primary:hover {
      filter: brightness(1.1);
    }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
    }
    .btn-outline:hover {
      border-color: var(--gold);
      color: var(--gold);
    }
    .btn-sm {
      padding: 6px 12px;
      font-size: 10px;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      transition: all 0.3s;
    }
    .stat-card:hover {
      border-color: rgba(201, 168, 76, 0.3);
    }
    .stat-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .stat-card-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .stat-card-icon.gold { background: rgba(201, 168, 76, 0.15); }
    .stat-card-icon.blue { background: var(--blue-bg); }
    .stat-card-icon.green { background: var(--green-bg); }
    .stat-card-icon.purple { background: var(--purple-bg); }
    .stat-card-icon.orange { background: var(--orange-bg); }
    .stat-card-value {
      font-family: 'Cormorant Garamond', serif;
      font-size: 42px;
      font-weight: 300;
      color: var(--text);
      line-height: 1;
      margin-bottom: 4px;
    }
    .stat-card-label {
      font-size: 11px;
      color: var(--text-dim);
      letter-spacing: 0.5px;
    }
    .stat-card-change {
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .stat-card-change.up { color: var(--green); }
    .stat-card-change.down { color: var(--red); }

    /* Charts Grid */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .chart-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .chart-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 20px;
      color: var(--text);
    }
    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      height: 220px;
      padding: 20px 0 0;
    }
    .bar-item {
      flex: 1;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .bar-value {
      font-size: 14px;
      font-weight: 700;
      color: var(--gold);
      margin-bottom: 8px;
    }
    .bar {
      width: 100%;
      max-width: 60px;
      border-radius: 6px 6px 0 0;
      min-height: 4px;
      transition: height 0.6s cubic-bezier(0.25, 0.8, 0.25, 1.2);
      position: relative;
    }
    .bar.gold { background: linear-gradient(180deg, var(--gold-light), var(--gold)); }
    .bar.blue { background: linear-gradient(180deg, #60a5fa, var(--blue)); }
    .bar.purple { background: linear-gradient(180deg, #a78bfa, var(--purple)); }
    .bar.green { background: linear-gradient(180deg, #4ade80, var(--green)); }
    .bar-label {
      font-size: 10px;
      color: var(--text-dim);
      margin-top: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      word-break: break-word;
      max-width: 60px;
    }

    /* Table */
    .table-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .table-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .table-title-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .table-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 22px;
      color: var(--text);
    }
    .table-count {
      background: var(--surface-light);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      color: var(--text-dim);
    }
    .table-filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-select, .filter-input, .filter-date {
      background: var(--surface-light);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 12px;
      font-family: 'Montserrat', sans-serif;
      outline: none;
      transition: border-color 0.3s;
    }
    .filter-select:focus, .filter-input:focus, .filter-date:focus {
      border-color: var(--gold);
    }
    .filter-select {
      cursor: pointer;
      min-width: 140px;
    }
    .filter-input {
      min-width: 200px;
    }
    .filter-date {
      min-width: 150px;
    }
    .search-icon {
      position: relative;
    }
    .search-icon input {
      padding-left: 36px;
    }
    .table-wrapper {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1200px;
    }
    thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }
    th {
      padding: 14px 16px;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      background: var(--surface-lighter);
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    th:hover {
      color: var(--gold);
    }
    th .sort-icon {
      margin-left: 4px;
      font-size: 10px;
    }
    td {
      padding: 14px 16px;
      font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      color: var(--text);
    }
    tbody tr {
      transition: background 0.2s;
    }
    tbody tr:hover {
      background: rgba(255,255,255,0.02);
    }
    .order-id {
      font-family: 'Courier New', monospace;
      color: var(--gold);
      font-size: 11px;
      font-weight: 600;
    }
    .customer-name {
      font-weight: 600;
      color: var(--text);
    }
    .customer-phone {
      font-size: 11px;
      color: var(--text-dim);
    }
    .product-name {
      color: var(--gold-light);
      font-weight: 500;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .price {
      font-weight: 600;
      color: var(--gold);
    }
    .status-badge {
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-weight: 700;
      display: inline-block;
    }
    .status-new { background: var(--blue-bg); color: var(--blue); }
    .status-confirmed { background: var(--orange-bg); color: var(--orange); }
    .status-processing { background: var(--purple-bg); color: var(--purple); }
    .status-delivered { background: var(--green-bg); color: var(--green); }
    .status-cancelled { background: var(--red-bg); color: var(--red); }
    
    .source-badge {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      display: inline-block;
    }
    .source-facebook { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .source-instagram { background: rgba(236, 72, 153, 0.2); color: #f472b6; }
    .source-tiktok { background: rgba(0, 0, 0, 0.4); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
    .source-youtube { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .source-google { background: rgba(52, 211, 153, 0.2); color: #34d399; }
    .source-direct, .source-other { background: rgba(201, 168, 76, 0.2); color: var(--gold-light); }

    .actions-cell {
      display: flex;
      gap: 8px;
    }
    .action-btn {
      padding: 6px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .action-btn:hover {
      background: var(--surface-light);
      color: var(--gold);
      border-color: var(--gold);
    }

    /* Pagination */
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
      padding: 20px;
      border-top: 1px solid var(--border);
    }
    .page-btn {
      min-width: 36px;
      height: 36px;
      padding: 0 12px;
      background: var(--surface-light);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Montserrat', sans-serif;
    }
    .page-btn:hover {
      background: var(--surface-lighter);
      color: var(--text);
    }
    .page-btn.active {
      background: var(--gold);
      color: #000;
      border-color: var(--gold);
    }
    .page-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .page-info {
      font-size: 11px;
      color: var(--text-dim);
      margin: 0 12px;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      width: 100%;
      max-height: 80vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .modal-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 24px;
      color: var(--text);
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 24px;
      cursor: pointer;
      padding: 4px;
    }
    .modal-close:hover { color: var(--text); }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .detail-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .detail-value {
      font-size: 13px;
      color: var(--text);
      font-weight: 500;
    }

    /* Loading Spinner */
    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-dim);
    }
    .loading::after {
      content: '';
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 2px solid var(--gold);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-left: 12px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-dim);
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .empty-state-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 20px;
      color: var(--text);
      margin-bottom: 8px;
    }

    /* Responsive */
    @media (max-width: 1024px) {
      .sidebar { width: 80px; }
      .sidebar .sidebar-link span:not(.icon),
      .sidebar .sidebar-logo,
      .sidebar .sidebar-subtitle,
      .sidebar .sidebar-section,
      .sidebar .badge { display: none; }
      .main-content { margin-left: 80px; }
      .charts-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .main-content { margin-left: 0; padding: 20px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .page-header { flex-direction: column; gap: 16px; align-items: flex-start; }
      .table-filters { flex-direction: column; width: 100%; }
      .filter-select, .filter-input, .filter-date { width: 100%; }
    }
  </style>
</head>
<body>
  <!-- Login Screen -->
  <div class="login-screen" id="loginScreen">
    <div class="login-card">
      <div class="login-logo">A U D O R A</div>
      <div class="login-subtitle">Administrator Dashboard</div>
      <input type="password" class="login-input" id="passwordInput" placeholder="Enter password" autofocus>
      <button class="login-btn" onclick="login()">Access Dashboard</button>
      <div class="login-error" id="loginError">Invalid password. Please try again.</div>
    </div>
  </div>

  <!-- Dashboard -->
  <div class="dashboard" id="dashboard">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">A U D O R A</div>
        <div class="sidebar-subtitle">Admin Panel</div>
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section">Main</div>
        <button class="sidebar-link active" onclick="showSection('overview')">
          <span class="icon">📊</span> Overview
        </button>
        <button class="sidebar-link" onclick="showSection('orders')">
          <span class="icon">📦</span> Orders
          <span class="badge" id="newOrdersBadge">0</span>
        </button>
        <div class="sidebar-section">Products</div>
        <button class="sidebar-link" onclick="filterByProduct('black-oud')">
          <span class="icon">🖤</span> BLACK OUD
        </button>
        <button class="sidebar-link" onclick="filterByProduct('rose-noir')">
          <span class="icon">🌹</span> ROSE NOIR
        </button>
        <button class="sidebar-link" onclick="filterByProduct('gift')">
          <span class="icon">🎁</span> Gift Bundles
        </button>
        <div class="sidebar-section">Account</div>
        <button class="sidebar-link" onclick="logout()">
          <span class="icon">🚪</span> Logout
        </button>
      </nav>
    </aside>

    <!-- Main Content -->
    <main class="main-content" id="mainContent">
      <!-- Content loaded dynamically -->
    </main>
  </div>

  <!-- Order Detail Modal -->
  <div class="modal-overlay" id="orderModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Order Details</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div id="modalContent"></div>
    </div>
  </div>

  <script>
    // ==================== SESSION MANAGEMENT ====================
    let sessionId = localStorage.getItem('audora_session');
    let currentSection = 'overview';
    let currentFilters = {};
    let currentPage = 1;
    let allStats = null;

    // Check session on load
    if (sessionId) {
      fetch(`/api/check-session?session=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          if (data.valid) {
            showDashboard();
            loadOverview();
          } else {
            localStorage.removeItem('audora_session');
            sessionId = null;
          }
        })
        .catch(() => {
          localStorage.removeItem('audora_session');
          sessionId = null;
        });
    }

    function login() {
      const password = document.getElementById('passwordInput').value;
      document.getElementById('loginError').style.display = 'none';
      
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          sessionId = data.sessionId;
          localStorage.setItem('audora_session', sessionId);
          showDashboard();
          loadOverview();
        } else {
          document.getElementById('loginError').style.display = 'block';
        }
      })
      .catch(() => {
        document.getElementById('loginError').style.display = 'block';
      });
    }

    function showDashboard() {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('dashboard').classList.add('active');
    }

    function logout() {
      localStorage.removeItem('audora_session');
      sessionId = null;
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('dashboard').classList.remove('active');
      document.getElementById('passwordInput').value = '';
      currentFilters = {};
      currentPage = 1;
    }

    // Enter key on password
    document.getElementById('passwordInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });

    // ==================== API CALLS ====================
    async function apiCall(endpoint) {
      const response = await fetch(`/api${endpoint}`, {
        headers: { 'x-session-id': sessionId }
      });
      if (response.status === 401) {
        logout();
        throw new Error('Unauthorized');
      }
      return response.json();
    }

    // ==================== NAVIGATION ====================
    function showSection(section) {
      currentSection = section;
      document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
      
      // Highlight correct sidebar link
      const links = document.querySelectorAll('.sidebar-link');
      links.forEach(link => {
        if (link.textContent.toLowerCase().includes(section.toLowerCase())) {
          link.classList.add('active');
        }
      });
      
      switch(section) {
        case 'overview':
          loadOverview();
          break;
        case 'orders':
          currentFilters = {};
          currentPage = 1;
          loadOrders();
          break;
      }
    }

    function filterByProduct(productType) {
      currentSection = 'orders';
      currentFilters = { productType };
      currentPage = 1;
      
      document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
      const links = document.querySelectorAll('.sidebar-link');
      links.forEach(link => {
        if (link.textContent.toLowerCase().includes(productType.replace('-', ' '))) {
          link.classList.add('active');
        }
      });
      
      loadOrders();
    }

    // ==================== OVERVIEW ====================
    async function loadOverview() {
      const mainContent = document.getElementById('mainContent');
      mainContent.innerHTML = '<div class="loading">Loading dashboard data</div>';
      
      try {
        const stats = await apiCall('/stats');
        allStats = stats;
        
        // Update new orders badge
        document.getElementById('newOrdersBadge').textContent = stats.byStatus['new'] || 0;
        
        mainContent.innerHTML = `
          <div class="page-header">
            <h1 class="page-title">Dashboard <span>Overview</span></h1>
            <div class="header-actions">
              <span style="font-size:12px;color:var(--text-dim);">Last updated: ${new Date().toLocaleTimeString()}</span>
              <button class="btn btn-outline btn-sm" onclick="loadOverview()">🔄 Refresh</button>
            </div>
          </div>

          <!-- Stats Cards -->
          <div class="stats-grid">
            <div class="stat-card" onclick="showSection('orders')" style="cursor:pointer;">
              <div class="stat-card-header">
                <div class="stat-card-icon gold">📦</div>
              </div>
              <div class="stat-card-value">${stats.today}</div>
              <div class="stat-card-label">Today's Orders</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon blue">📅</div>
              </div>
              <div class="stat-card-value">${stats.yesterday}</div>
              <div class="stat-card-label">Yesterday</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon green">📈</div>
              </div>
              <div class="stat-card-value">${stats.thisWeek}</div>
              <div class="stat-card-label">This Week</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon purple">📊</div>
              </div>
              <div class="stat-card-value">${stats.lastWeek}</div>
              <div class="stat-card-label">Last Week</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon orange">🗓️</div>
              </div>
              <div class="stat-card-value">${stats.last30Days}</div>
              <div class="stat-card-label">Last 30 Days</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon gold">💎</div>
              </div>
              <div class="stat-card-value">${stats.totalRevenue.toLocaleString()}</div>
              <div class="stat-card-label">Total Revenue (KES)</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon blue">📋</div>
              </div>
              <div class="stat-card-value">${stats.total}</div>
              <div class="stat-card-label">Total Orders</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-header">
                <div class="stat-card-icon green">💰</div>
              </div>
              <div class="stat-card-value">${stats.averageOrderValue.toLocaleString()}</div>
              <div class="stat-card-label">Avg Order Value</div>
            </div>
          </div>

          <!-- Charts -->
          <div class="charts-grid">
            <!-- Product Breakdown -->
            <div class="chart-card">
              <div class="chart-header">
                <h3 class="chart-title">Orders by Product</h3>
                <span style="font-size:11px;color:var(--text-dim);">Total: ${stats.total}</span>
              </div>
              <div class="bar-chart" id="productChart">
                ${renderBarChart(stats.byProductType, 'gold')}
              </div>
            </div>

            <!-- Source Breakdown -->
            <div class="chart-card">
              <div class="chart-header">
                <h3 class="chart-title">Traffic Sources</h3>
              </div>
              <div class="bar-chart" id="sourceChart">
                ${renderBarChart(stats.bySource, 'blue')}
              </div>
            </div>

            <!-- Status Breakdown -->
            <div class="chart-card">
              <div class="chart-header">
                <h3 class="chart-title">Order Status</h3>
              </div>
              <div class="bar-chart" id="statusChart">
                ${renderBarChart(stats.byStatus, 'purple')}
              </div>
            </div>

            <!-- Bundle Breakdown -->
            <div class="chart-card">
              <div class="chart-header">
                <h3 class="chart-title">Bundle Preferences</h3>
              </div>
              <div class="bar-chart" id="bundleChart">
                ${renderBarChart(stats.byBundle, 'green')}
              </div>
            </div>
          </div>

          <!-- Recent Orders -->
          <div class="table-container">
            <div class="table-header">
              <div class="table-title-section">
                <h3 class="table-title">Recent Orders</h3>
                <span class="table-count">${stats.recentOrders.length} orders</span>
              </div>
              <button class="btn btn-outline btn-sm" onclick="showSection('orders')">View All →</button>
            </div>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Product</th>
                    <th>Bundle</th>
                    <th>Price</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${stats.recentOrders.map(order => renderOrderRow(order)).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } catch (error) {
        mainContent.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 class="empty-state-title">Error loading data</h3><p>Please try refreshing</p></div>';
      }
    }

    // ==================== ORDERS ====================
    async function loadOrders() {
      const mainContent = document.getElementById('mainContent');
      mainContent.innerHTML = '<div class="loading">Loading orders</div>';
      
      // Build query params
      const params = new URLSearchParams({
        page: currentPage,
        limit: 25,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
      
      if (currentFilters.productType) params.append('productType', currentFilters.productType);
      if (currentFilters.source) params.append('source', currentFilters.source);
      if (currentFilters.status) params.append('status', currentFilters.status);
      if (currentFilters.startDate) params.append('startDate', currentFilters.startDate);
      if (currentFilters.endDate) params.append('endDate', currentFilters.endDate);
      if (currentFilters.search) params.append('search', currentFilters.search);
      
      try {
        const data = await apiCall(`/orders?${params.toString()}`);
        
        // Get product filter label
        let filterLabel = 'All Orders';
        if (currentFilters.productType === 'black-oud') filterLabel = 'BLACK OUD Orders';
        else if (currentFilters.productType === 'rose-noir') filterLabel = 'ROSE NOIR Orders';
        else if (currentFilters.productType === 'gift') filterLabel = 'Gift Bundle Orders';
        
        mainContent.innerHTML = `
          <div class="page-header">
            <h1 class="page-title">${filterLabel} <span>Management</span></h1>
            <div class="header-actions">
              <button class="btn btn-outline btn-sm" onclick="exportOrders()">📥 Export CSV</button>
              <button class="btn btn-outline btn-sm" onclick="loadOrders()">🔄 Refresh</button>
            </div>
          </div>

          <!-- Product Quick Filters -->
          <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
            <button class="btn ${!currentFilters.productType ? 'btn-primary' : 'btn-outline'} btn-sm" 
                    onclick="clearProductFilter()">All Products</button>
            <button class="btn ${currentFilters.productType === 'black-oud' ? 'btn-primary' : 'btn-outline'} btn-sm" 
                    onclick="filterByProduct('black-oud')">🖤 BLACK OUD</button>
            <button class="btn ${currentFilters.productType === 'rose-noir' ? 'btn-primary' : 'btn-outline'} btn-sm" 
                    onclick="filterByProduct('rose-noir')">🌹 ROSE NOIR</button>
            <button class="btn ${currentFilters.productType === 'gift' ? 'btn-primary' : 'btn-outline'} btn-sm" 
                    onclick="filterByProduct('gift')">🎁 Gift Bundles</button>
          </div>

          <div class="table-container">
            <div class="table-header">
              <div class="table-title-section">
                <h3 class="table-title">Orders</h3>
                <span class="table-count">${data.pagination.totalOrders} total</span>
              </div>
              <div class="table-filters">
                <div class="search-icon" style="position:relative;">
                  <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;">🔍</span>
                  <input type="text" class="filter-input" placeholder="Search orders..." 
                         value="${currentFilters.search || ''}"
                         onkeyup="searchOrders(this.value)" style="padding-left:36px;">
                </div>
                <select class="filter-select" onchange="filterBySource(this.value)" value="${currentFilters.source || ''}">
                  <option value="">All Sources</option>
                  <option value="Facebook" ${currentFilters.source === 'Facebook' ? 'selected' : ''}>Facebook</option>
                  <option value="Instagram" ${currentFilters.source === 'Instagram' ? 'selected' : ''}>Instagram</option>
                  <option value="TikTok" ${currentFilters.source === 'TikTok' ? 'selected' : ''}>TikTok</option>
                  <option value="YouTube" ${currentFilters.source === 'YouTube' ? 'selected' : ''}>YouTube</option>
                  <option value="Google" ${currentFilters.source === 'Google' ? 'selected' : ''}>Google</option>
                  <option value="Direct" ${currentFilters.source === 'Direct' ? 'selected' : ''}>Direct</option>
                  <option value="Other" ${currentFilters.source === 'Other' ? 'selected' : ''}>Other</option>
                </select>
                <select class="filter-select" onchange="filterByStatus(this.value)" value="${currentFilters.status || ''}">
                  <option value="">All Status</option>
                  <option value="new" ${currentFilters.status === 'new' ? 'selected' : ''}>New</option>
                  <option value="confirmed" ${currentFilters.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                  <option value="processing" ${currentFilters.status === 'processing' ? 'selected' : ''}>Processing</option>
                  <option value="delivered" ${currentFilters.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                  <option value="cancelled" ${currentFilters.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
                <input type="date" class="filter-date" onchange="filterByDate('start', this.value)" 
                       value="${currentFilters.startDate || ''}" placeholder="Start date">
                <input type="date" class="filter-date" onchange="filterByDate('end', this.value)" 
                       value="${currentFilters.endDate || ''}" placeholder="End date">
                <button class="btn btn-outline btn-sm" onclick="clearAllFilters()">✕ Clear</button>
              </div>
            </div>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th onclick="sortOrders('orderId')">Order ID <span class="sort-icon">↕</span></th>
                    <th onclick="sortOrders('timestamp')">Date <span class="sort-icon">↕</span></th>
                    <th onclick="sortOrders('name')">Customer <span class="sort-icon">↕</span></th>
                    <th>Phone</th>
                    <th>Location</th>
                    <th>Product</th>
                    <th>Bundle</th>
                    <th onclick="sortOrders('price')">Price <span class="sort-icon">↕</span></th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.orders.length > 0 ? data.orders.map(order => renderOrderRow(order)).join('') : 
                    '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-dim);">No orders found</td></tr>'}
                </tbody>
              </table>
            </div>
            
            <!-- Pagination -->
            <div class="pagination">
              <button class="page-btn" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>«</button>
              <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
              ${renderPagination(data.pagination)}
              <button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === data.pagination.totalPages ? 'disabled' : ''}>›</button>
              <button class="page-btn" onclick="goToPage(${data.pagination.totalPages})" ${currentPage === data.pagination.totalPages ? 'disabled' : ''}>»</button>
              <span class="page-info">Page ${currentPage} of ${data.pagination.totalPages}</span>
            </div>
          </div>
        `;
      } catch (error) {
        mainContent.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 class="empty-state-title">Error loading orders</h3><p>Please try again</p></div>';
      }
    }

    // ==================== RENDER FUNCTIONS ====================
    function renderOrderRow(order) {
      const date = new Date(order.timestamp);
      const dateStr = date.toLocaleDateString('en-KE', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const sourceClass = (order.source || 'Direct').toLowerCase();
      
      return `
        <tr>
          <td><span class="order-id">${order.orderId || order.id}</span></td>
          <td style="font-size:11px;color:var(--text-dim);">${dateStr}</td>
          <td>
            <div class="customer-name">${order.name}</div>
          </td>
          <td class="customer-phone">${order.phone}</td>
          <td style="font-size:12px;">${order.location}</td>
          <td><span class="product-name" title="${order.product}">${order.product}</span></td>
          <td style="font-size:12px;">${order.bundle}</td>
          <td class="price">${order.price}</td>
          <td><span class="source-badge source-${sourceClass}">${order.source}</span></td>
          <td>
            <select class="status-badge status-${order.status}" 
                    onchange="updateOrderStatus('${order.id || order.orderId}', this.value)"
                    style="border:none;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:20px;background:var(--surface-light);color:var(--text);">
              <option value="new" ${order.status === 'new' ? 'selected' : ''}>New</option>
              <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
              <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
              <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
              <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </td>
          <td>
            <div class="actions-cell">
              <button class="action-btn" onclick="viewOrderDetails('${order.id || order.orderId}')" title="View Details">👁️</button>
              <button class="action-btn" onclick="whatsappCustomer('${order.phone}', '${order.name}', '${order.orderId || order.id}')" title="WhatsApp Customer">💬</button>
            </div>
          </td>
        </tr>
      `;
    }

    function renderBarChart(data, colorClass) {
      const entries = Object.entries(data).filter(([_, v]) => v > 0);
      if (entries.length === 0) {
        return '<div style="text-align:center;padding:40px;color:var(--text-dim);">No data available</div>';
      }
      
      const maxValue = Math.max(...entries.map(([_, v]) => v));
      
      return entries.map(([label, value]) => {
        const height = maxValue > 0 ? (value / maxValue) * 180 : 0;
        const displayLabel = label.length > 15 ? label.substring(0, 15) + '...' : label;
        return `
          <div class="bar-item">
            <div class="bar-value">${value}</div>
            <div class="bar ${colorClass}" style="height:${Math.max(height, 4)}px;"></div>
            <div class="bar-label" title="${label}">${displayLabel}</div>
          </div>
        `;
      }).join('');
    }

    function renderPagination(pagination) {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
      let end = Math.min(pagination.totalPages, start + maxVisible - 1);
      
      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
      }
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      return pages.map(page => `
        <button class="page-btn ${page === currentPage ? 'active' : ''}" 
                onclick="goToPage(${page})">${page}</button>
      `).join('');
    }

    // ==================== ACTIONS ====================
    function goToPage(page) {
      currentPage = page;
      loadOrders();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function searchOrders(query) {
      clearTimeout(window.searchTimeout);
      window.searchTimeout = setTimeout(() => {
        currentFilters.search = query || undefined;
        currentPage = 1;
        loadOrders();
      }, 500);
    }

    function filterBySource(source) {
      currentFilters.source = source || undefined;
      currentPage = 1;
      loadOrders();
    }

    function filterByStatus(status) {
      currentFilters.status = status || undefined;
      currentPage = 1;
      loadOrders();
    }

    function filterByDate(type, value) {
      if (type === 'start') currentFilters.startDate = value || undefined;
      if (type === 'end') currentFilters.endDate = value || undefined;
      currentPage = 1;
      loadOrders();
    }

    function clearProductFilter() {
      currentFilters.productType = undefined;
      currentPage = 1;
      loadOrders();
    }

    function clearAllFilters() {
      currentFilters = {};
      currentPage = 1;
      loadOrders();
    }

    async function updateOrderStatus(orderId, newStatus) {
      try {
        await apiCall(`/orders/${orderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        // Reload to refresh data
        if (currentSection === 'overview') {
          loadOverview();
        } else {
          loadOrders();
        }
      } catch (error) {
        alert('Failed to update order status');
      }
    }

    async function viewOrderDetails(orderId) {
      try {
        const order = await apiCall(`/orders/${orderId}`);
        const modal = document.getElementById('orderModal');
        const modalContent = document.getElementById('modalContent');
        
        modalContent.innerHTML = `
          <div class="detail-row">
            <span class="detail-label">Order ID</span>
            <span class="detail-value" style="font-family:monospace;color:var(--gold);">${order.orderId || order.id}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Date</span>
            <span class="detail-value">${new Date(order.timestamp).toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Customer</span>
            <span class="detail-value">${order.name}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Phone</span>
            <span class="detail-value">${order.phone}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Location</span>
            <span class="detail-value">${order.location}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Product</span>
            <span class="detail-value" style="color:var(--gold-light);">${order.product}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Bundle</span>
            <span class="detail-value">${order.bundle}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Price</span>
            <span class="detail-value" style="color:var(--gold);">${order.price}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Source</span>
            <span class="detail-value">${order.source}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Country</span>
            <span class="detail-value">${order.country || 'Kenya'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value"><span class="status-badge status-${order.status}">${order.status}</span></span>
          </div>
        `;
        
        modal.classList.add('active');
      } catch (error) {
        alert('Failed to load order details');
      }
    }

    function closeModal() {
      document.getElementById('orderModal').classList.remove('active');
    }

    function whatsappCustomer(phone, name, orderId) {
      const cleanPhone = phone.replace(/[^0-9+]/g, '');
      const message = encodeURIComponent(
        `Hello ${name},\n\n` +
        `This is AUDORA Luxury Fragrances regarding your order ${orderId}.\n\n` +
        `Thank you for choosing AUDORA! We're preparing your order for delivery.\n\n` +
        `If you have any questions, feel free to reach out.`
      );
      window.open(`https://wa.me/${cleanPhone.replace(/\+/g, '')}?text=${message}`, '_blank');
    }

    function exportOrders() {
      alert('Export functionality will download all filtered orders as CSV');
      // Implementation would generate CSV and trigger download
    }

    // ==================== MODAL CLICK OUTSIDE ====================
    document.getElementById('orderModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    // ==================== KEYBOARD SHORTCUTS ====================
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });

    console.log('AUDORA Dashboard initialized');
    console.log('Session:', sessionId ? 'Active' : 'None');
  </script>
</body>
</html>
