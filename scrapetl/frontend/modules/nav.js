/* ── Tab Navigation & Auto-Refresh ─── */
function switchTab(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    document.getElementById('page-title').textContent = TAB_META[name].title;
    document.getElementById('page-subtitle').textContent = TAB_META[name].subtitle;

    const addBtn = document.getElementById('main-add-btn');
    if (addBtn) {
        if (name === 'scrapers') { addBtn.style.display = 'inline-block'; }
        else { addBtn.style.display = 'none'; }
    }
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
        loadTab(tab);
    });
});

function loadTab(tab) {
    if (tab === 'scrapers') loadScrapers();
    if (tab === 'schedules') loadSchedules();
    if (tab === 'logs') loadLogs();
    if (tab === 'queue') loadQueue();
    if (tab === 'integrations') loadIntegrations();
    if (tab === 'variables') loadVariables();
    if (tab === 'settings') loadSettings();
    if (tab === 'builder') {
        initBuilder();
        renderBuilderNodes();
        renderConnections();
    }
}

/* ════════════════════════════════════════════════
   REFRESH + INIT
════════════════════════════════════════════════ */
function refreshAll() {
    const activeTab = document.querySelector('.tab-panel.active')?.id.replace('tab-', '');
    if (activeTab === 'scrapers') loadScrapers();
    else if (activeTab === 'schedules') loadSchedules();
    else if (activeTab === 'logs') loadLogs();
    else if (activeTab === 'queue') loadQueue();
    else if (activeTab === 'integrations') loadIntegrations();
    else if (activeTab === 'variables') loadVariables();
    else if (activeTab === 'funcs') loadFunctions();
    else if (activeTab === 'settings') loadSettings();
    apiFetch(API.queue).then(tasks => {
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'running').length;
        const badge = document.getElementById('queue-badge');
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }).catch(() => { });
}

setInterval(refreshAll, 5000);
