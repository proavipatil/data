// FOLDER NAVIGATION ADDON - Add this to your script.js

// Add to state variables
let currentFolderId = null;
let folderPath = [];

// Override initFiles to handle folders
const originalInitFiles = window.initFiles;
window.initFiles = function(files) {
    // Add isFolder property
    window.allFiles = files.map(f => ({
        ...f,
        year: extractYear(f.name),
        isFolder: f.isFolder || false
    }));
    
    // Rest of original initFiles code...
    const years = new Set();
    window.allFiles.forEach(f => { if (f.year) years.add(f.year); });
    availableYears = Array.from(years).sort((a, b) => b - a);
    
    const yearSelect = document.getElementById('yearFilter');
    if (yearSelect) {
        yearSelect.innerHTML = '<option value="all">All Years</option>' +
            availableYears.map(y => `<option value="${y}">${y}</option>`).join('');
    }
    
    generateSearchSuggestions();
    applyViewMode();
    
    filteredFiles = window.allFiles;
    document.getElementById('totalCount').textContent = files.length;
    renderFiles();
    renderPagination();
};

// Add folder filter support
const originalSetFilter = window.setFilter;
window.setFilter = function(f) {
    currentFilter = f;
    document.querySelectorAll('.filter-group button[data-filter]').forEach(b => 
        b.classList.toggle('active', b.dataset.filter === f)
    );
    applyFilters();
};

// Override applyFilters to handle folders
const originalApplyFilters = window.applyFilters;
window.applyFilters = function() {
    filteredFiles = window.allFiles.filter(f => {
        // Folder filter
        if (currentFilter === 'folder' && !f.isFolder) return false;
        if (currentFilter !== 'all' && currentFilter !== 'folder') {
            if (f.isFolder) return false; // Hide folders when filtering by type
            const t = getFileType(f.name);
            if (t !== currentFilter) return false;
        }
        
        // Year filter
        if (currentYear !== 'all' && f.year !== currentYear) return false;
        
        // Search
        if (searchQuery && !smartSearch(f.name, searchQuery)) return false;
        
        return true;
    });
    
    // Sort
    if (currentSort === 'name') {
        filteredFiles.sort((a, b) => {
            // Folders first
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        });
    } else if (currentSort === 'size') {
        filteredFiles.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return b.size - a.size;
        });
    } else {
        filteredFiles.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return b.time - a.time;
        });
    }
    
    currentPage = 1;
    renderFiles();
    renderPagination();
    
    const countEl = document.getElementById('filteredCount');
    if (countEl) countEl.textContent = filteredFiles.length;
};

// Open folder function
window.openFolder = async function(folderId, folderName) {
    currentFolderId = folderId;
    folderPath.push({ id: folderId, name: folderName });
    
    // Update URL
    const pathStr = folderPath.map(f => encodeURIComponent(f.name)).join('/');
    history.pushState({ folderId, folderPath }, '', `/p/${pathStr}`);
    
    // Show loading
    document.getElementById('fileList').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading folder...</p></div>';
    
    try {
        const res = await fetch(`/api/files?folder=${folderId}`);
        const files = await res.json();
        initFiles(files);
    } catch (err) {
        document.getElementById('fileList').innerHTML = `<div class="empty"><h3>Error loading folder</h3><p>${err.message}</p></div>`;
    }
};

// Go back to parent
window.goBack = function() {
    if (folderPath.length <= 1) {
        // Back to root
        currentFolderId = null;
        folderPath = [];
        history.pushState({}, '', '/');
        fetch('/api/files').then(r => r.json()).then(files => initFiles(files));
    } else {
        // Back to parent folder
        folderPath.pop();
        const parent = folderPath[folderPath.length - 1];
        currentFolderId = parent.id;
        const pathStr = folderPath.map(f => encodeURIComponent(f.name)).join('/');
        history.pushState({ folderId: parent.id, folderPath }, '', `/p/${pathStr}`);
        fetch(`/api/files?folder=${parent.id}`).then(r => r.json()).then(files => initFiles(files));
    }
};

// Override renderFiles to add folder support
const originalRenderFiles = window.renderFiles;
window.renderFiles = function() {
    const start = (currentPage - 1) * perPage;
    const pf = filteredFiles.slice(start, start + perPage);
    const fileList = document.getElementById('fileList');
    
    if (!pf.length) {
        fileList.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg><h3>No files found</h3></div>`;
        return;
    }
    
    fileList.classList.toggle('grid-view', listViewMode === 'grid');
    fileList.classList.toggle('list-view', listViewMode === 'list');
    
    fileList.innerHTML = pf.map(f => {
        if (f.isFolder) {
            // Folder item
            const safeName = esc(f.name).replace(/'/g, "\\'");
            return `
            <article class="file-item" onclick="openFolder('${f.id}','${safeName}')">
                <div class="file-row">
                    <div class="file-icon folder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                    </div>
                    <div class="file-content">
                        <div class="file-name">${esc(f.name)}</div>
                        <div class="file-info">
                            <span class="file-badge">Folder</span>
                        </div>
                    </div>
                    <div class="file-btns">
                        <button class="file-btn" title="Open">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </article>`;
        }
        
        // Regular file rendering (use original code)
        const ftype = getFileType(f.name);
        const isVideo = ftype === 'video';
        const showInfo = isVideo || ftype === 'audio';
        const safeName = esc(f.name).replace(/'/g, "\\'");
        const parsed = parseFilename(f.name);
        
        return `
        <article class="file-item" onclick="openInfo('${f.id}','${safeName}',${f.size})">
            <div class="file-row">
                <div class="file-icon ${ftype}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        ${isVideo ? '<polygon points="5 3 19 12 5 21 5 3"/>' : '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'}
                    </svg>
                </div>
                <div class="file-content">
                    <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
                    <div class="file-info">
                        ${parsed.resolution ? `<span class="file-badge res">${parsed.resolution}</span>` : ''}
                        ${parsed.source ? `<span class="file-badge">${parsed.source}</span>` : ''}
                        <span class="file-size">${formatBytes(f.size)}</span>
                    </div>
                </div>
                <div class="file-btns">
                    ${isVideo ? `<button class="file-btn play" onclick="event.stopPropagation();togglePlay(event, '${f.id}', '${safeName}')" title="Play">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>` : ''}
                    <a href="${MEDIA_URL}/d/${f.id}/${encodeURIComponent(f.name)}" class="file-btn download" onclick="event.stopPropagation()" title="Download">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                </div>
            </div>
        </article>`;
    }).join('');
};
