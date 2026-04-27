/* ── Reusable UI Components ─── */
/* ── Thumbnail helpers ──────────────────────────────── */
function previewThumb(url) {
    const img = document.getElementById('thumb-preview-img');
    const ph = document.getElementById('thumb-preview-placeholder');
    const box = document.getElementById('thumb-preview');
    if (!url.trim()) {
        img.style.display = 'none'; img.src = '';
        ph.style.display = 'inline'; ph.textContent = '🎌';
        box.style.borderColor = ''; return;
    }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; box.style.borderColor = 'var(--failure)'; };
    ph.textContent = '🎌'; img.src = url;
}

function previewEditThumb(url) {
    const img = document.getElementById('edit-thumb-img');
    const ph = document.getElementById('edit-thumb-placeholder');
    const box = document.getElementById('edit-thumb-preview');
    if (!url || !url.trim()) { img.style.display = 'none'; img.src = ''; ph.style.display = 'inline'; ph.textContent = '🎌'; if (box) box.style.borderColor = ''; return; }
    img.onload = () => { ph.style.display = 'none'; img.style.display = 'block'; if (box) box.style.borderColor = 'var(--success)'; };
    img.onerror = () => { img.style.display = 'none'; ph.style.display = 'inline'; ph.textContent = '⚠️'; if (box) box.style.borderColor = 'var(--failure)'; };
    img.src = url;
}


function previewWizThumb(url) {
    const img = document.getElementById('wiz-thumb-img');
    const placeholder = document.getElementById('wiz-thumb-placeholder');
    if (!img || !placeholder) return;
    if (url && url.trim().length > 0) {
        img.src = url;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    }
}

function handleWizThumbFile(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('wiz-thumb-img');
            const placeholder = document.getElementById('wiz-thumb-placeholder');
            if (img && placeholder) {
                img.src = e.target.result;
                img.style.display = 'block';
                placeholder.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }
}

function _setupCodeDropZone(zoneId, inputId, textId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--accent)';
        zone.style.background = 'rgba(99,102,241,0.06)';
    });
    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = '';
        zone.style.background = '';
    });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = '';
        zone.style.background = '';
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!file.name.endsWith('.py')) { toast('Only .py files allowed.', 'error'); return; }
        // Assign the dropped file to the hidden input via DataTransfer
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById(inputId);
        input.files = dt.files;
        // Update the text label
        const textEl = document.getElementById(textId);
        if (textEl) textEl.textContent = `📄 ${file.name}`;
        zone.style.borderColor = 'var(--success)';
        zone.style.background = 'rgba(34,197,94,0.05)';
    });
}
