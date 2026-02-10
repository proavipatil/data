// DUDU Archive - Main JavaScript
// Badge base URL
const MEDIA_URL = window.location.origin;  // Uses same domain
const BADGE_URL = 'https://dudux.eu/badges/';  // External badges

// State
let filteredFiles = [];
let currentPage = 1;
const perPage = 30;
let currentFilter = 'all';
let searchQuery = '';
let currentYear = 'all';
let currentSort = 'date'; // 'date', 'name', 'size'
let currentMediaInfo = null;
let currentFileId = null;
let currentFileName = null;
let currentView = 'normal';
let listViewMode = localStorage.getItem('viewMode') || 'list'; // 'list' or 'grid'
let movieInfoCache = {};
let watchInfoCache = {};
let subtitlesCache = {};
let availableYears = [];
let searchSuggestions = [];

// File types
const fileTypes = {
    video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
    audio: ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aac', 'wma', 'opus'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'],
};

// ========== FILENAME PARSER ==========
// Parse scene-style filename into structured data
function parseFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

    // Replace dots/underscores with spaces for parsing
    let clean = nameWithoutExt.replace(/[\._]/g, ' ');

    // Extract season/episode (S01E01, S01 E01, 1x01, etc.)
    let season = null, episode = null, episodeTitle = null;
    const seMatch = clean.match(/\bS(\d{1,2})\s*[-]?\s*E(\d{1,2})\b/i) ||
                    clean.match(/\bSeason\s*(\d{1,2})\s*Episode\s*(\d{1,2})\b/i) ||
                    clean.match(/\b(\d{1,2})x(\d{1,2})\b/);
    if (seMatch) {
        season = parseInt(seMatch[1]);
        episode = parseInt(seMatch[2]);
        // Extract episode title (text between S01E01 and quality)
        const afterSE = clean.substring(clean.indexOf(seMatch[0]) + seMatch[0].length);
        const qualityMatch = afterSE.match(/\b(2160p|1080p|720p|480p|4K|UHD|HD|WEB|HDTV|BluRay|BRRip|DVDRip|AMZN|NF|DSNP|ATV|HMAX|ATVP)/i);
        if (qualityMatch) {
            episodeTitle = afterSE.substring(0, afterSE.indexOf(qualityMatch[0])).trim();
        } else {
            episodeTitle = afterSE.trim();
        }
        if (episodeTitle) episodeTitle = episodeTitle.replace(/^\s*[-]\s*/, '').trim();
    }

    // Extract year
    const yearMatch = clean.match(/\b(19\d{2}|20[0-9]{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Extract resolution
    const resMatch = clean.match(/\b(2160p|1080p|720p|480p|4K|UHD)\b/i);
    const resolution = resMatch ? resMatch[1].toUpperCase() : null;

    // Extract quality/source
    const sourceMatch = clean.match(/\b(WEB[-]?DL|WEBRip|BluRay|BRRip|HDRip|DVDRip|HDTV|CAM|TS|HC|Remux)\b/i);
    const source = sourceMatch ? sourceMatch[1] : null;

    // Extract release group (usually at end after dash)
    const groupMatch = nameWithoutExt.match(/[-]([A-Za-z0-9]+)$/);
    const group = groupMatch ? groupMatch[1] : null;

    // Extract codec
    const codecMatch = clean.match(/\b(H\.?265|H\.?264|HEVC|x265|x264|AV1|VP9|XviD)\b/i);
    const codec = codecMatch ? codecMatch[1].replace('.', '') : null;

    // Extract title (everything before year or season)
    let title = clean;
    if (yearMatch) {
        title = clean.substring(0, clean.indexOf(yearMatch[0])).trim();
    } else if (seMatch) {
        title = clean.substring(0, clean.indexOf(seMatch[0])).trim();
    } else if (resMatch) {
        title = clean.substring(0, clean.indexOf(resMatch[0])).trim();
    }
    // Clean up title
    title = title.replace(/\s+/g, ' ').trim();

    return {
        title,
        year,
        season,
        episode,
        episodeTitle: episodeTitle || null,
        resolution,
        source,
        codec,
        group,
        ext: ext.toUpperCase(),
        original: filename
    };
}

// Format parsed filename to clean display
function formatFilename(parsed) {
    let formatted = parsed.title;

    if (parsed.year) {
        formatted += ` ${parsed.year}`;
    }

    if (parsed.season !== null && parsed.episode !== null) {
        formatted += ` S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`;
        if (parsed.episodeTitle) {
            formatted += ` ${parsed.episodeTitle}`;
        }
    }

    if (parsed.resolution) {
        formatted += ` ${parsed.resolution}`;
    }

    formatted += `.${parsed.ext.toLowerCase()}`;

    return formatted;
}

// Get series ID for grouping (title + year for finding related episodes)
function getSeriesKey(parsed) {
    return `${parsed.title.toLowerCase().replace(/[^a-z0-9]/g, '')}${parsed.year || ''}`;
}

// Find related files (same series, other resolutions/episodes)
function findRelatedFiles(filename, allFiles) {
    const parsed = parseFilename(filename);
    const seriesKey = getSeriesKey(parsed);

    const related = {
        otherResolutions: [],
        otherEpisodes: [],
        current: parsed
    };

    for (const file of allFiles) {
        if (file.name === filename) continue;

        const fileParsed = parseFilename(file.name);
        const fileSeriesKey = getSeriesKey(fileParsed);

        // Check if same series
        if (fileSeriesKey === seriesKey) {
            // Same episode, different resolution
            if (parsed.season === fileParsed.season &&
                parsed.episode === fileParsed.episode &&
                parsed.resolution !== fileParsed.resolution) {
                related.otherResolutions.push({
                    ...file,
                    parsed: fileParsed
                });
            }
            // Different episode
            else if (parsed.season !== fileParsed.season ||
                     parsed.episode !== fileParsed.episode) {
                related.otherEpisodes.push({
                    ...file,
                    parsed: fileParsed
                });
            }
        }
        // For movies (no season/episode), check same title different resolution
        else if (!parsed.season && !fileParsed.season) {
            const titleMatch = parsed.title.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                              fileParsed.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (titleMatch && parsed.resolution !== fileParsed.resolution) {
                related.otherResolutions.push({
                    ...file,
                    parsed: fileParsed
                });
            }
        }
    }

    // Sort episodes by season then episode
    related.otherEpisodes.sort((a, b) => {
        if (a.parsed.season !== b.parsed.season) return (a.parsed.season || 0) - (b.parsed.season || 0);
        return (a.parsed.episode || 0) - (b.parsed.episode || 0);
    });

    // Sort resolutions by quality (4K > 1080p > 720p > 480p)
    const resOrder = {'2160P': 4, '4K': 4, 'UHD': 4, '1080P': 3, '720P': 2, '480P': 1};
    related.otherResolutions.sort((a, b) =>
        (resOrder[b.parsed.resolution] || 0) - (resOrder[a.parsed.resolution] || 0)
    );

    return related;
}

// Utility functions
const getFileType = fn => {
    const ext = fn.split('.').pop().toLowerCase();
    for (const [t, exts] of Object.entries(fileTypes)) if (exts.includes(ext)) return t;
    return 'other';
};

const getExt = fn => fn.split('.').pop().toUpperCase().slice(0, 4);

const formatBytes = b => {
    if (!b) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0) + ' ' + s[i];
};

const esc = str => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };

// Extract year from filename
function extractYear(filename) {
    const match = filename.match(/\b(19\d{2}|20[0-9]{2})\b/);
    return match ? match[1] : null;
}

// Initialize with files from PHP
function initFiles(files) {
    // Add year to each file
    window.allFiles = files.map(f => ({
        ...f,
        year: extractYear(f.name)
    }));

    // Extract unique years for filter
    const years = new Set();
    window.allFiles.forEach(f => { if (f.year) years.add(f.year); });
    availableYears = Array.from(years).sort((a, b) => b - a);

    // Populate year dropdown
    const yearSelect = document.getElementById('yearFilter');
    if (yearSelect) {
        yearSelect.innerHTML = '<option value="all">All Years</option>' +
            availableYears.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    // Generate search suggestions (2 random unique movie titles)
    generateSearchSuggestions();

    // Apply saved view mode
    applyViewMode();

    filteredFiles = window.allFiles;
    document.getElementById('totalCount').textContent = files.length;
    renderFiles();
    renderPagination();
}

// Generate 2 random movie/series titles for search suggestions
function generateSearchSuggestions() {
    const uniqueTitles = new Set();
    const videoFiles = window.allFiles.filter(f => fileTypes.video.includes(f.name.split('.').pop().toLowerCase()));

    // Get unique titles
    for (const file of videoFiles) {
        const parsed = parseFilename(file.name);
        if (parsed.title && parsed.title.length > 2) {
            uniqueTitles.add(parsed.title);
        }
    }

    // Convert to array and shuffle
    const titlesArray = Array.from(uniqueTitles);
    const shuffled = titlesArray.sort(() => Math.random() - 0.5);

    // Take 2 random titles
    searchSuggestions = shuffled.slice(0, 2);

    // Render suggestions
    renderSearchSuggestions();
}

// Render search suggestions below search box
function renderSearchSuggestions() {
    const container = document.getElementById('searchSuggestions');
    if (!container || searchSuggestions.length === 0) return;

    container.innerHTML = `
        <span class="suggest-label">Try:</span>
        ${searchSuggestions.map(s => `<button class="suggest-tag" onclick="applySuggestion('${esc(s).replace(/'/g, "\\'")}')">${esc(s)}</button>`).join('')}
        <button class="suggest-refresh" onclick="generateSearchSuggestions()" title="New suggestions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
    `;
}

// Apply a search suggestion
function applySuggestion(title) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = title;
        handleSearch();
    }
}

// Toggle between list and grid view
function toggleViewMode() {
    listViewMode = listViewMode === 'list' ? 'grid' : 'list';
    localStorage.setItem('viewMode', listViewMode);
    applyViewMode();
    renderFiles();
}

// Apply the current view mode to UI
function applyViewMode() {
    const fileList = document.getElementById('fileList');
    const listBtn = document.getElementById('viewListBtn');
    const gridBtn = document.getElementById('viewGridBtn');

    if (fileList) {
        fileList.classList.toggle('grid-view', listViewMode === 'grid');
        fileList.classList.toggle('list-view', listViewMode === 'list');
    }

    if (listBtn) listBtn.classList.toggle('active', listViewMode === 'list');
    if (gridBtn) gridBtn.classList.toggle('active', listViewMode === 'grid');
}

// Set specific view mode
function setViewMode(mode) {
    listViewMode = mode;
    localStorage.setItem('viewMode', listViewMode);
    applyViewMode();
    renderFiles();
}

// Filter and search
function handleSearch() {
    searchQuery = document.getElementById('searchInput').value.toLowerCase();
    updateClearButton();
    applyFilters();
}

// Clear search
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
        searchQuery = '';
        updateClearButton();
        applyFilters();
        searchInput.focus();
    }
}

// Show/hide clear button based on input
function updateClearButton() {
    const clearBtn = document.getElementById('searchClear');
    const searchInput = document.getElementById('searchInput');
    if (clearBtn && searchInput) {
        clearBtn.classList.toggle('visible', searchInput.value.length > 0);
    }
}

function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn, .chip[data-filter], .f-btn[data-filter], .filter-group button[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    applyFilters();
}

function setYear(y) {
    currentYear = y;
    applyFilters();
}

function setSort(s) {
    currentSort = s;
    document.querySelectorAll('.sort-btn, .pill[data-sort], .s-btn[data-sort], .sort-group button[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
    applyFilters();
}

// Smart search - handles queries like "school spirits s03e03", "avatar 2009 1080p", etc.
function smartSearch(filename, query) {
    if (!query) return true;

    const normalizedName = filename.toLowerCase().replace(/[\._-]/g, ' ').replace(/\s+/g, ' ');
    const normalizedQuery = query.toLowerCase().replace(/[\._-]/g, ' ').replace(/\s+/g, ' ').trim();

    // Parse the search query
    const queryParts = normalizedQuery.split(' ').filter(p => p.length > 0);

    // Check if ALL parts of the query are found in the filename
    let allPartsFound = true;
    for (const part of queryParts) {
        // Allow partial matching for parts longer than 2 chars
        if (part.length > 2) {
            if (!normalizedName.includes(part)) {
                allPartsFound = false;
                break;
            }
        } else {
            // For short parts (like "s3" or "e5"), require word boundary match
            const regex = new RegExp(`\\b${part}\\b|\\b${part}|${part}\\b`, 'i');
            if (!regex.test(normalizedName)) {
                allPartsFound = false;
                break;
            }
        }
    }

    if (allPartsFound) return true;

    // Also try matching against parsed filename
    const parsed = parseFilename(filename);
    const searchableText = [
        parsed.title,
        parsed.year,
        parsed.season ? `s${parsed.season}` : '',
        parsed.season ? `s${String(parsed.season).padStart(2, '0')}` : '',
        parsed.episode ? `e${parsed.episode}` : '',
        parsed.episode ? `e${String(parsed.episode).padStart(2, '0')}` : '',
        parsed.episodeTitle,
        parsed.resolution,
        parsed.source,
        parsed.codec,
        parsed.group
    ].filter(Boolean).join(' ').toLowerCase();

    for (const part of queryParts) {
        if (!searchableText.includes(part)) return false;
    }

    return true;
}

function applyFilters() {
    filteredFiles = window.allFiles.filter(f => {
        const t = getFileType(f.name);

        // File type filter
        if (currentFilter !== 'all' && t !== currentFilter) return false;

        // Year filter
        if (currentYear !== 'all' && f.year !== currentYear) return false;

        // Smart search
        if (searchQuery && !smartSearch(f.name, searchQuery)) return false;

        return true;
    });

    // Sort
    if (currentSort === 'name') {
        // Sort by parsed title for better grouping
        filteredFiles.sort((a, b) => {
            const pa = parseFilename(a.name);
            const pb = parseFilename(b.name);
            const titleCompare = pa.title.localeCompare(pb.title);
            if (titleCompare !== 0) return titleCompare;
            // Same title, sort by season then episode
            if (pa.season !== pb.season) return (pa.season || 0) - (pb.season || 0);
            if (pa.episode !== pb.episode) return (pa.episode || 0) - (pb.episode || 0);
            return 0;
        });
    } else if (currentSort === 'size') {
        filteredFiles.sort((a, b) => b.size - a.size);
    } else if (currentSort === 'year') {
        filteredFiles.sort((a, b) => (b.year || '0') - (a.year || '0'));
    } else {
        filteredFiles.sort((a, b) => b.time - a.time);
    }

    currentPage = 1;
    renderFiles();
    renderPagination();

    // Update count
    const countEl = document.getElementById('filteredCount');
    if (countEl) countEl.textContent = filteredFiles.length;
}

// Render file list (supports list and grid views)
function renderFiles() {
    const start = (currentPage - 1) * perPage;
    const pf = filteredFiles.slice(start, start + perPage);
    const fileList = document.getElementById('fileList');

    if (!pf.length) {
        fileList.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg><h3>No files found</h3></div>`;
        return;
    }

    // Ensure view mode class is applied
    fileList.classList.toggle('grid-view', listViewMode === 'grid');
    fileList.classList.toggle('list-view', listViewMode === 'list');

    fileList.innerHTML = pf.map(f => {
        const ftype = getFileType(f.name);
        const isVideo = ftype === 'video';
        const showInfo = isVideo || ftype === 'audio';
        const safeName = esc(f.name).replace(/'/g, "\\'");

        // Parse and format filename for display
        const parsed = parseFilename(f.name);
        const displayName = formatFilename(parsed);

        // Build tags from parsed data
        let tags = [];
        if (parsed.resolution) tags.push(`<span class="file-tag res">${parsed.resolution}</span>`);
        if (parsed.source) tags.push(`<span class="file-tag source">${parsed.source}</span>`);
        if (parsed.codec) tags.push(`<span class="file-tag codec">${parsed.codec}</span>`);
        if (parsed.group) tags.push(`<span class="file-tag group">${parsed.group}</span>`);

        // Grid view layout
        if (listViewMode === 'grid') {
            return `
            <article class="file-card" onclick="openInfo('${f.id}','${safeName}',${f.size})">
                <div class="card-header">
                    <div class="card-ext">${getExt(f.name)}</div>
                    ${parsed.resolution ? `<div class="card-res">${parsed.resolution}</div>` : ''}
                </div>
                <div class="card-body">
                    <div class="card-title" title="${esc(f.name)}">${esc(f.name)}</div>
                    ${parsed.season !== null ? `<div class="card-episode">S${String(parsed.season).padStart(2,'0')}E${String(parsed.episode).padStart(2,'0')}</div>` : ''}
                    ${parsed.year ? `<div class="card-year">${parsed.year}</div>` : ''}
                    <div class="card-tags">
                        ${parsed.source ? `<span class="card-tag">${parsed.source}</span>` : ''}
                        ${parsed.codec ? `<span class="card-tag">${parsed.codec}</span>` : ''}
                        ${parsed.group ? `<span class="card-tag group">${parsed.group}</span>` : ''}
                    </div>
                </div>
                <div class="card-footer">
                    <span class="card-size">${formatBytes(f.size)}</span>
                    <div class="card-actions">
                        ${isVideo ? `<button class="card-btn" onclick="event.stopPropagation();togglePlay(event, '${f.id}', '${safeName}')" title="Play">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>` : ''}
                        ${showInfo ? `<button class="card-btn" onclick="event.stopPropagation();openInfo('${f.id}','${safeName}',${f.size})" title="Info">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        </button>` : ''}
                        <a href="${MEDIA_URL}/d/${f.id}/${encodeURIComponent(f.name)}" class="card-btn" onclick="event.stopPropagation()" title="Download">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                    </div>
                </div>
                ${isVideo ? `<div class="play-dropdown card-dropdown" id="play-${f.id}">
                    <a href="#" onclick="event.stopPropagation();playInBrowser('${f.id}','${safeName}');return false;" class="play-browser-option">▶ Play in Browser</a>
                    <div class="divider"></div>
                    <div class="section-label">Desktop</div>
                    <a href="#" onclick="event.stopPropagation();playIn('vlc-desktop','${f.id}','${safeName}');return false;">VLC Desktop</a>
                    <a href="#" onclick="event.stopPropagation();playIn('potplayer','${f.id}','${safeName}');return false;">PotPlayer</a>
                    <a href="#" onclick="event.stopPropagation();playIn('iina','${f.id}','${safeName}');return false;">IINA (Mac)</a>
                    <div class="divider"></div>
                    <div class="section-label">Mobile</div>
                    <a href="#" onclick="event.stopPropagation();playIn('vlc-mobile','${f.id}','${safeName}');return false;">VLC Mobile</a>
                    <a href="#" onclick="event.stopPropagation();playIn('nplayer','${f.id}','${safeName}');return false;">nPlayer</a>
                    <a href="#" onclick="event.stopPropagation();playIn('mx-free','${f.id}','${safeName}');return false;">MX Player</a>
                    <div class="divider"></div>
                    <a href="#" onclick="event.stopPropagation();copyStreamLink('${f.id}');return false;" class="copy-link-option">Copy Stream Link</a>
                </div>` : ''}
            </article>`;
        }

        // List view layout (default) - Modern Design
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
                        ${parsed.codec ? `<span class="file-badge">${parsed.codec}</span>` : ''}
                        <span class="file-size">${formatBytes(f.size)}</span>
                    </div>
                </div>
                <div class="file-btns">
                    ${isVideo ? `<div class="play-wrapper">
                        <button class="file-btn play" onclick="event.stopPropagation();togglePlay(event, '${f.id}', '${safeName}')" title="Play">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <div class="play-dropdown" id="play-${f.id}">
                            <a href="#" onclick="playInBrowser('${f.id}','${safeName}');return false;" class="play-browser-option">▶ Play in Browser</a>
                            <div class="divider"></div>
                            <div class="section-label">Desktop</div>
                            <a href="#" onclick="playIn('vlc-desktop','${f.id}','${safeName}');return false;">VLC Desktop</a>
                            <a href="#" onclick="playIn('potplayer','${f.id}','${safeName}');return false;">PotPlayer</a>
                            <a href="#" onclick="playIn('iina','${f.id}','${safeName}');return false;">IINA (Mac)</a>
                            <a href="#" onclick="playIn('mpv','${f.id}','${safeName}');return false;">mpv</a>
                            <div class="divider"></div>
                            <div class="section-label">Mobile</div>
                            <a href="#" onclick="playIn('vlc-mobile','${f.id}','${safeName}');return false;">VLC Mobile</a>
                            <a href="#" onclick="playIn('nplayer','${f.id}','${safeName}');return false;">nPlayer</a>
                            <a href="#" onclick="playIn('mx-free','${f.id}','${safeName}');return false;">MX Player</a>
                            <div class="divider"></div>
                            <a href="#" onclick="copyStreamLink('${f.id}');return false;" class="copy-link-option">Copy Stream Link</a>
                        </div>
                    </div>` : ''}
                    ${showInfo ? `<button class="file-btn info" onclick="event.stopPropagation();openInfo('${f.id}','${safeName}',${f.size})" title="Info">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </button>` : ''}
                    <a href="${MEDIA_URL}/d/${f.id}/${encodeURIComponent(f.name)}" class="file-btn download" onclick="event.stopPropagation()" title="Download">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                </div>
            </div>
        </article>`;
    }).join('');
}

// Pagination
function renderPagination() {
    const total = Math.ceil(filteredFiles.length / perPage);
    if (total <= 1) { document.getElementById('pagination').innerHTML = ''; return; }

    let html = `<button class="page-btn" onclick="goToPage(${currentPage-1})" ${currentPage===1?'disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>`;
    let start = Math.max(1, currentPage - 2), end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="goToPage(${i})">${i}</button>`;
    html += `<button class="page-btn" onclick="goToPage(${currentPage+1})" ${currentPage===total?'disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    document.getElementById('pagination').innerHTML = html;
}

function goToPage(p) {
    const total = Math.ceil(filteredFiles.length / perPage);
    if (p < 1 || p > total) return;
    currentPage = p;
    renderFiles();
    renderPagination();
    window.scrollTo({ top: 150, behavior: 'smooth' });
}

// Modal functions
let infoRetryCount = 0;
const MAX_RETRIES = 5;

async function openInfo(id, name, size, isRetry = false) {
    currentFileId = id;
    currentFileName = name;
    currentView = 'normal';

    if (!isRetry) {
        infoRetryCount = 0;
        document.getElementById('modal').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    const retryText = infoRetryCount > 0 ? ` (Attempt ${infoRetryCount + 1}/${MAX_RETRIES})` : '';
    document.getElementById('modalContent').innerHTML = `<div class="loading"><div class="spinner"></div><p>Analyzing...${retryText}</p></div>`;

    try {
        const res = await fetch('/api/info?id=' + id);
        const data = await res.json();

        if (data.error) throw new Error(data.error);
        if (!data.mediaInfo) throw new Error('Failed to analyze');

        currentMediaInfo = convertMediaInfoResult(data.mediaInfo, data.filename, data.filesize);
        infoRetryCount = 0;
        renderModal();

    } catch (e) {
        infoRetryCount++;

        // Auto-retry if under max retries
        if (infoRetryCount < MAX_RETRIES) {
            const delay = Math.min(1000 * infoRetryCount, 3000); // Exponential backoff, max 3s
            document.getElementById('modalContent').innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Retrying in ${delay/1000}s... (Attempt ${infoRetryCount + 1}/${MAX_RETRIES})</p>
                </div>`;

            setTimeout(() => openInfo(id, name, size, true), delay);
        } else {
            // Max retries reached, show manual retry button
            document.getElementById('modalContent').innerHTML = `
                <div class="loading">
                    <p style="color:#f87171;margin-bottom:15px;">Failed after ${MAX_RETRIES} attempts</p>
                    <p style="font-size:13px;color:#888;margin-bottom:15px;">${e.message}</p>
                    <button onclick="infoRetryCount=0;openInfo('${id}', '${name.replace(/'/g, "\\'")}', ${size})" style="padding:10px 24px;background:#222;border:1px solid #333;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;">
                        Try Again
                    </button>
                </div>`;
        }
    }
}

function convertMediaInfoResult(result, filename, fileSize) {
    const data = { filename, filesize: fileSize, tracks: [] };

    let tracks = [];
    if (result && result.media && result.media.track) {
        tracks = Array.isArray(result.media.track) ? result.media.track : [result.media.track];
    }

    if (!tracks.length) return data;

    for (const track of tracks) {
        const type = track['@type'] || 'Unknown';
        const props = {};

        for (const [key, value] of Object.entries(track)) {
            if (key === '@type') continue;
            if (value === undefined || value === null || value === '') continue;

            if (key === 'extra' && typeof value === 'object') {
                for (const [ek, ev] of Object.entries(value)) {
                    if (ev === undefined || ev === null || ev === '') continue;
                    const formattedKey = ek.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
                    props[formattedKey.charAt(0).toUpperCase() + formattedKey.slice(1)] = String(ev);
                }
                continue;
            }

            let formattedKey = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
            formattedKey = formattedKey.charAt(0).toUpperCase() + formattedKey.slice(1);

            let formattedValue = value;
            if (Array.isArray(value)) {
                formattedValue = value.join(', ');
            } else if (typeof value === 'object') {
                formattedValue = JSON.stringify(value);
            } else {
                formattedValue = String(value);
            }

            props[formattedKey] = formattedValue;
        }

        data.tracks.push({ type, properties: props });
    }

    return data;
}

function closeModal() {
    document.getElementById('modal').classList.remove('open');
    document.body.style.overflow = '';
}

// View switching
function setView(v) {
    currentView = v;

    document.querySelectorAll('.view-pill').forEach(b => b.classList.toggle('active', b.dataset.view === v));

    document.querySelector('.normal-view')?.classList.toggle('hidden', v !== 'normal');
    document.querySelector('.text-view')?.classList.toggle('active', v === 'text');
    document.querySelector('.movie-view')?.classList.toggle('active', v === 'movie');
    document.querySelector('.movie-view')?.classList.toggle('hidden', v !== 'movie');
    document.querySelector('.related-view')?.classList.toggle('active', v === 'related');
    document.querySelector('.related-view')?.classList.toggle('hidden', v !== 'related');
    document.querySelector('.watch-view')?.classList.toggle('active', v === 'watch');
    document.querySelector('.watch-view')?.classList.toggle('hidden', v !== 'watch');
    document.querySelector('.subs-view')?.classList.toggle('active', v === 'subs');
    document.querySelector('.subs-view')?.classList.toggle('hidden', v !== 'subs');

    if (v === 'movie' && currentFileName) loadMovieInfo(currentFileName);
    if (v === 'watch' && currentFileName) loadWatchInfo(currentFileName);
    if (v === 'subs' && currentFileName) loadSubtitles(currentFileName);
}

// Movie info loading
async function loadMovieInfo(filename) {
    const movieView = document.querySelector('.movie-view');
    if (!movieView) return;

    if (movieInfoCache[filename]) {
        renderMovieInfo(movieInfoCache[filename]);
        return;
    }

    movieView.innerHTML = `<div class="movie-loading"><div class="spinner"></div><p style="margin-top: 16px; color: #666;">Loading...</p></div>`;

    try {
        // Single API call - TMDB provides all info
        const data = await fetch('movieinfo.php?filename=' + encodeURIComponent(filename)).then(r => r.json()).catch(() => ({ success: false }));
        movieInfoCache[filename] = data;
        renderMovieInfo(data);
    } catch (err) {
        movieView.innerHTML = `<div class="movie-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Error loading movie info</h3><p>${err.message}</p></div>`;
    }
}

function renderMovieInfo(data) {
    const movieView = document.querySelector('.movie-view');
    if (!movieView) return;

    if (!data.success || !data.movie) {
        movieView.innerHTML = `<div class="movie-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg><h3>Movie not found</h3><p>"${data.parsed?.title || 'Unknown'}"${data.parsed?.year ? ` (${data.parsed.year})` : ''}</p></div>`;
        return;
    }

    const m = data.movie;
    const posterUrl = m.Poster && m.Poster !== 'N/A' ? m.Poster : null;

    let ratingsHtml = '';
    // Always show as IMDb rating
    if (m.imdbRating && m.imdbRating !== 'N/A') {
        ratingsHtml = `<div class="movie-rating-item"><div class="rating-icon"><img src="badges/imdb.png" alt="IMDb" class="rating-logo"></div><div class="rating-source">IMDb</div><div class="rating-value">${m.imdbRating}/10</div></div>`;
    }

    let castHtml = '';
    if (m.Actors && m.Actors !== 'N/A') {
        castHtml = m.Actors.split(', ').map(actor => `<span class="movie-cast-item">${actor}</span>`).join('');
    }

    const typeLabel = m.Type === 'series' ? 'TV Series' : m.Type === 'movie' ? 'Movie' : m.Type;
    const votes = m.imdbVotes && m.imdbVotes !== 'N/A' ? m.imdbVotes : null;

    let awardsHtml = '';
    if (m.Awards && m.Awards !== 'N/A') {
        awardsHtml = `<div class="movie-awards"><div class="movie-section-title">Awards</div><div class="awards-text">${m.Awards}</div></div>`;
    }

    // Build tagline HTML
    let taglineHtml = '';
    if (m.Tagline) {
        taglineHtml = `<div class="movie-tagline">"${m.Tagline}"</div>`;
    }

    // TV Series extra info
    let tvInfoHtml = '';
    if (m.Type === 'series') {
        const parts = [];
        if (m.Seasons) parts.push(`${m.Seasons} Season${m.Seasons > 1 ? 's' : ''}`);
        if (m.Episodes) parts.push(`${m.Episodes} Episodes`);
        if (m.Networks) parts.push(m.Networks);
        if (parts.length > 0) {
            tvInfoHtml = `<div class="movie-tv-info">${parts.join(' • ')}</div>`;
        }
    }

    movieView.innerHTML = `
        <div class="movie-hero">
            <div class="movie-poster">
                ${posterUrl ? `<img src="${posterUrl}" alt="${m.Title}" loading="lazy">` : `<div class="movie-poster-placeholder">?</div>`}
            </div>
            <h2 class="movie-title">${m.Title}</h2>
            ${taglineHtml}
            <div class="movie-meta">
                ${m.imdbRating && m.imdbRating !== 'N/A' ? `<span class="movie-tag rating">★ ${m.imdbRating}${votes ? ` <span class="votes">(${votes})</span>` : ''}</span>` : ''}
                ${m.Year && m.Year !== 'N/A' ? `<span class="movie-tag">${m.Year}</span>` : ''}
                ${m.Runtime && m.Runtime !== 'N/A' ? `<span class="movie-tag">${m.Runtime}</span>` : ''}
                ${m.Rated && m.Rated !== 'N/A' ? `<span class="movie-tag">${m.Rated}</span>` : ''}
                ${typeLabel ? `<span class="movie-tag rated">${typeLabel}</span>` : ''}
            </div>
            ${tvInfoHtml}
            ${m.Genre && m.Genre !== 'N/A' ? `<div class="movie-genre">${m.Genre.replace(/,/g, ' • ')}</div>` : ''}
            ${m.Plot && m.Plot !== 'N/A' ? `<div class="movie-plot">${m.Plot}</div>` : ''}
            ${ratingsHtml ? `<div class="movie-ratings">${ratingsHtml}</div>` : ''}
        </div>
        ${awardsHtml}
        ${castHtml ? `<div class="movie-cast"><div class="movie-section-title">Cast</div><div class="movie-cast-list">${castHtml}</div></div>` : ''}
        <div class="movie-details">
            <div class="movie-detail-grid">
                ${m.Director && m.Director !== 'N/A' ? `<div class="movie-detail-item"><span class="movie-detail-label">${m.Type === 'series' ? 'Creator' : 'Director'}</span><span class="movie-detail-value">${m.Director}</span></div>` : ''}
                ${m.Writer && m.Writer !== 'N/A' ? `<div class="movie-detail-item"><span class="movie-detail-label">Writer</span><span class="movie-detail-value">${m.Writer}</span></div>` : ''}
                ${m.Language && m.Language !== 'N/A' ? `<div class="movie-detail-item"><span class="movie-detail-label">Language</span><span class="movie-detail-value">${m.Language}</span></div>` : ''}
                ${m.Country && m.Country !== 'N/A' ? `<div class="movie-detail-item"><span class="movie-detail-label">Country</span><span class="movie-detail-value">${m.Country}</span></div>` : ''}
                ${m.Released && m.Released !== 'N/A' ? `<div class="movie-detail-item"><span class="movie-detail-label">Released</span><span class="movie-detail-value">${m.Released}</span></div>` : ''}
                ${m.Status ? `<div class="movie-detail-item"><span class="movie-detail-label">Status</span><span class="movie-detail-value">${m.Status}</span></div>` : ''}
                ${m.Budget ? `<div class="movie-detail-item"><span class="movie-detail-label">Budget</span><span class="movie-detail-value">${m.Budget}</span></div>` : ''}
                ${m.BoxOffice ? `<div class="movie-detail-item"><span class="movie-detail-label">Box Office</span><span class="movie-detail-value">${m.BoxOffice}</span></div>` : ''}
                ${m.ProductionCompanies ? `<div class="movie-detail-item"><span class="movie-detail-label">Production</span><span class="movie-detail-value">${m.ProductionCompanies}</span></div>` : ''}
            </div>
        </div>
        <div id="movieExtendedContent"></div>
    `;

    if (data.tmdb) renderExtendedContent(data.tmdb);
}

function renderExtendedContent(tmdb) {
    const container = document.getElementById('movieExtendedContent');
    if (!container || !tmdb.success) return;

    let html = '';

    if (tmdb.images && tmdb.images.length > 0) {
        html += `<div class="movie-photos"><div class="movie-section-title">Photos</div><div class="photos-carousel">${tmdb.images.map(img => `<div class="photo-item ${img.type}" onclick="openPhotoLightbox('${img.url_full}')"><img src="${img.url}" alt="Photo" loading="lazy"></div>`).join('')}</div></div>`;
    }

    if (tmdb.videos && tmdb.videos.length > 0) {
        html += `<div class="movie-videos"><div class="movie-section-title">Videos</div><div class="videos-grid">${tmdb.videos.map(v => `<div class="video-item" onclick="openVideoModal('${v.embed}')"><div class="video-thumb"><img src="${v.thumbnail}" alt="${v.name}" loading="lazy"><div class="video-play-icon">▶</div></div><div class="video-title">${v.name}</div><div class="video-type">${v.type}</div></div>`).join('')}</div></div>`;
    }

    if (tmdb.cast && tmdb.cast.length > 0) {
        html += `<div class="movie-cast-photos"><div class="movie-section-title">Cast</div><div class="cast-grid">${tmdb.cast.map(c => `<div class="cast-item"><div class="cast-photo">${c.photo ? `<img src="${c.photo}" alt="${c.name}" loading="lazy">` : `<div class="cast-photo-placeholder">?</div>`}</div><div class="cast-name">${c.name}</div><div class="cast-character">${c.character || ''}</div></div>`).join('')}</div></div>`;
    }

    if (tmdb.reviews && tmdb.reviews.length > 0) {
        const r = tmdb.reviews[0];
        html += `<div class="movie-reviews">
            <div class="movie-section-title">Review</div>
            <div class="review-item">
                <div class="review-header">
                    <div class="review-avatar">${r.avatar ? `<img src="${r.avatar}" alt="${r.author}">` : `<div class="review-avatar-placeholder">${r.author.charAt(0).toUpperCase()}</div>`}</div>
                    <div class="review-author">
                        <div class="review-author-name">${r.author}</div>
                        ${r.rating ? `<div class="review-rating"><span class="star">★</span> ${r.rating}/10</div>` : ''}
                    </div>
                </div>
                <div class="review-content" id="review-0">${escapeHtml(r.content.substring(0, 500))}${r.content.length > 500 ? '...' : ''}</div>
                ${r.content.length > 300 ? `<div class="review-expand" onclick="toggleReview(0, this)">Read more</div>` : ''}
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openPhotoLightbox(url) {
    const lightbox = document.createElement('div');
    lightbox.className = 'photo-lightbox';
    lightbox.innerHTML = `<div class="photo-lightbox-close">×</div><img src="${url}" alt="Photo">`;
    lightbox.onclick = () => lightbox.remove();
    document.body.appendChild(lightbox);
}

function openVideoModal(embedUrl) {
    const modal = document.createElement('div');
    modal.className = 'video-modal';
    modal.innerHTML = `<div class="video-modal-close" onclick="this.parentElement.remove()">×</div><iframe src="${embedUrl}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
}

function toggleReview(idx, btn) {
    const content = document.getElementById('review-' + idx);
    if (content) {
        content.classList.toggle('expanded');
        btn.textContent = content.classList.contains('expanded') ? 'Show less' : 'Read more';
    }
}

function scrollReviews(direction) {
    const carousel = document.getElementById('reviewsCarousel');
    if (carousel) {
        const cardWidth = carousel.querySelector('.review-card')?.offsetWidth || 300;
        carousel.scrollBy({ left: direction * (cardWidth + 16), behavior: 'smooth' });
    }
}

function showFullReview(idx) {
    if (!window.currentReviews || !window.currentReviews[idx]) return;
    const r = window.currentReviews[idx];

    const modal = document.createElement('div');
    modal.className = 'review-modal-overlay';
    modal.innerHTML = `
        <div class="review-modal">
            <div class="review-modal-close" onclick="this.parentElement.parentElement.remove()">×</div>
            <div class="review-modal-header">
                <div class="review-avatar">${r.avatar ? `<img src="${r.avatar}" alt="${r.author}">` : `<div class="review-avatar-placeholder">${r.author.charAt(0).toUpperCase()}</div>`}</div>
                <div class="review-author">
                    <div class="review-author-name">${r.author}</div>
                    ${r.rating ? `<div class="review-rating"><span class="star">★</span> ${r.rating}/10</div>` : ''}
                </div>
            </div>
            <div class="review-modal-content">${escapeHtml(r.content)}</div>
        </div>
    `;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
}

// Watch info loading
async function loadWatchInfo(filename) {
    const watchView = document.querySelector('.watch-view');
    if (!watchView) return;

    if (watchInfoCache[filename]) {
        renderWatchInfo(watchInfoCache[filename]);
        return;
    }

    watchView.innerHTML = `<div class="watch-loading"><div class="spinner"></div><p style="margin-top: 16px; color: #666;">Finding streaming options...</p></div>`;

    try {
        const res = await fetch('wheretowatch.php?filename=' + encodeURIComponent(filename));
        const data = await res.json();
        watchInfoCache[filename] = data;
        renderWatchInfo(data);
    } catch (err) {
        watchView.innerHTML = `<div class="watch-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Error loading streaming info</h3><p>${err.message}</p></div>`;
    }
}

function renderWatchInfo(data) {
    const watchView = document.querySelector('.watch-view');
    if (!watchView) return;

    if (!data.success) {
        watchView.innerHTML = `<div class="watch-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg><h3>No streaming info found</h3><p>Searched for: "${data.parsed?.query || 'Unknown'}"</p></div>`;
        return;
    }

    const offers = data.offers || {};
    const hasAnyOffers = Object.values(offers).some(arr => arr.length > 0);

    let sectionsHtml = '';

    if (offers.stream?.length > 0) sectionsHtml += `<div class="watch-section"><div class="watch-section-title">Stream</div><div class="watch-providers">${offers.stream.map(p => renderProvider(p)).join('')}</div></div>`;
    if (offers.free?.length > 0) sectionsHtml += `<div class="watch-section"><div class="watch-section-title">Free with Ads</div><div class="watch-providers">${offers.free.map(p => renderProvider(p)).join('')}</div></div>`;
    if (offers.rent?.length > 0) sectionsHtml += `<div class="watch-section"><div class="watch-section-title">Rent</div><div class="watch-providers">${offers.rent.map(p => renderProvider(p, true)).join('')}</div></div>`;
    if (offers.buy?.length > 0) sectionsHtml += `<div class="watch-section"><div class="watch-section-title">Buy</div><div class="watch-providers">${offers.buy.map(p => renderProvider(p, true)).join('')}</div></div>`;

    if (!hasAnyOffers) {
        sectionsHtml = `<div class="watch-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg><h3>No streaming options available</h3><p>This title may not be available for streaming in your region</p></div>`;
    }

    const typeLabel = data.type === 'show' ? 'TV Series' : 'Movie';
    watchView.innerHTML = `<div class="watch-header"><div class="watch-title">${data.title || 'Unknown'}</div><div class="watch-subtitle">${data.year ? data.year + ' • ' : ''}${typeLabel}</div></div>${sectionsHtml}`;
}

function renderProvider(p, showPrice = false) {
    const icon = p.icon ? `<img class="watch-provider-icon" src="${p.icon}" alt="${p.provider_name}" title="${p.provider_name}" onerror="this.style.display='none'">` : `<div class="watch-provider-icon" title="${p.provider_name}" style="display:flex;align-items:center;justify-content:center;font-size:20px;background:#222;">📺</div>`;
    return `<div class="watch-provider" title="${p.provider_name}">${icon}</div>`;
}

// Subtitles loading
async function loadSubtitles(filename) {
    const subsView = document.querySelector('.subs-view');
    if (!subsView) return;

    if (subtitlesCache[filename]) {
        renderSubtitles(subtitlesCache[filename]);
        return;
    }

    subsView.innerHTML = `<div class="subs-loading"><div class="spinner"></div><p style="margin-top: 16px; color: #666;">Searching subtitles...</p></div>`;

    try {
        const res = await fetch('subtitles.php?action=search&filename=' + encodeURIComponent(filename));
        const data = await res.json();
        subtitlesCache[filename] = data;
        renderSubtitles(data);
    } catch (err) {
        subsView.innerHTML = `<div class="subs-not-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Error loading subtitles</h3><p>${err.message}</p></div>`;
    }
}

function renderSubtitles(data) {
    const subsView = document.querySelector('.subs-view');
    if (!subsView) return;

    if (!data.success || !data.subtitles || Object.keys(data.subtitles).length === 0) {
        const searchInfo = data.imdb_id
            ? `IMDb: ${data.imdb_id} / "${data.parsed?.title || 'Unknown'}"`
            : `"${data.searched || data.parsed?.title || 'Unknown'}"`;

        // Show debug info if available
        let debugHtml = '';
        if (data.debug && data.debug.length > 0) {
            debugHtml = `<details style="margin-top:12px;text-align:left;font-size:11px;max-width:400px;">
                <summary style="cursor:pointer;color:#888;">Debug Info (${data.debug.length} queries tried)</summary>
                <div style="margin-top:8px;background:#1a1a1a;padding:8px;border-radius:4px;max-height:200px;overflow:auto;">
                    ${data.debug.map((d, i) => `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #333;">
                        <b>#${i+1}</b> HTTP ${d.http_code} - Found: ${d.data_count}<br>
                        <span style="color:#666;word-break:break-all;">${Object.entries(d.params).map(([k,v]) => `${k}=${v}`).join('&')}</span>
                    </div>`).join('')}
                </div>
            </details>`;
        }

        // Show parsed info
        let parsedInfo = '';
        if (data.parsed) {
            const p = data.parsed;
            parsedInfo = `<p style="color:#888;font-size:12px;margin-top:8px;">Parsed: ${p.title}${p.year ? ` (${p.year})` : ''}${p.season ? ` S${String(p.season).padStart(2,'0')}E${String(p.episode).padStart(2,'0')}` : ''}</p>`;
        }

        subsView.innerHTML = `
            <div class="subs-not-found">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                    <path d="M6 10h4M14 10h4M6 14h12"/>
                </svg>
                <h3>No subtitles found</h3>
                <p>Searched: ${searchInfo}</p>
                ${parsedInfo}
                ${data.error ? `<p style="color:#f87171;margin-top:8px;">${data.error}</p>` : ''}
                ${debugHtml}
            </div>`;
        return;
    }

    const languages = Object.keys(data.subtitles).sort((a, b) => {
        // Priority: English, Bengali, Hindi first
        const priority = ['en', 'bn', 'hi'];
        const aIdx = priority.indexOf(a);
        const bIdx = priority.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
    });

    const searchedFor = data.imdb_id
        ? `${data.parsed?.title} (${data.imdb_id})`
        : (data.searched || data.parsed?.title);

    let html = `
        <div class="subs-header">
            <div class="subs-title">Subtitles Available</div>
            <div class="subs-subtitle">Found ${data.total} subtitles for "${searchedFor}"</div>
        </div>
        <div class="subs-languages">
    `;

    for (const lang of languages) {
        const subs = data.subtitles[lang];
        const langName = subs[0]?.language_name || lang.toUpperCase();
        const count = subs.length;

        html += `
            <div class="subs-language-group">
                <div class="subs-language-header" onclick="toggleSubsLang(this)">
                    <span class="subs-lang-name">${langName}</span>
                    <span class="subs-lang-count">${count}</span>
                    <svg class="subs-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <div class="subs-language-list">
        `;

        for (const sub of subs.slice(0, 10)) { // Show max 10 per language
            const badges = [];
            if (sub.hearing_impaired) badges.push('<span class="sub-badge hi">HI</span>');
            if (sub.ai_translated) badges.push('<span class="sub-badge ai">AI</span>');
            if (sub.machine_translated) badges.push('<span class="sub-badge mt">MT</span>');

            html += `
                <div class="subs-item" onclick="downloadSubtitle(${sub.file_id}, '${esc(sub.file_name || sub.release).replace(/'/g, "\\'")}')">
                    <div class="subs-item-main">
                        <div class="subs-item-name">${esc(sub.release || sub.file_name || 'Subtitle')}</div>
                        <div class="subs-item-meta">
                            ${sub.download_count ? `<span>${sub.download_count.toLocaleString()} downloads</span>` : ''}
                            ${sub.uploader ? `<span>by ${esc(sub.uploader)}</span>` : ''}
                        </div>
                    </div>
                    <div class="subs-item-actions">
                        ${badges.join('')}
                        <svg class="subs-download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </div>
                </div>
            `;
        }

        if (subs.length > 10) {
            html += `<div class="subs-more">+ ${subs.length - 10} more</div>`;
        }

        html += `
                </div>
            </div>
        `;
    }

    html += '</div>';
    subsView.innerHTML = html;

    // Auto-expand first language
    const firstGroup = subsView.querySelector('.subs-language-group');
    if (firstGroup) {
        firstGroup.classList.add('expanded');
    }
}

function toggleSubsLang(header) {
    const group = header.closest('.subs-language-group');
    group.classList.toggle('expanded');
}

async function downloadSubtitle(fileId, fileName) {
    showToast('Downloading subtitle...');

    try {
        // Use proxy to download through server (avoids CORS)
        const proxyUrl = 'subtitles.php?action=proxy&file_id=' + fileId;

        // Create invisible link and trigger download
        const a = document.createElement('a');
        a.href = proxyUrl;
        a.download = fileName || 'subtitle.srt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showToast('Download started!');
    } catch (err) {
        showToast('Download failed: ' + err.message);
    }
}

// Badge detection
function getBadges(d) {
    const badges = [];
    const videoTracks = (d.tracks || []).filter(t => t.type === 'Video');
    const audioTracks = (d.tracks || []).filter(t => t.type === 'Audio');
    const textTracks = (d.tracks || []).filter(t => t.type === 'Text');

    if (videoTracks.length > 0) {
        const videoProps = videoTracks[0].properties || {};
        const width = parseInt(String(getProp(videoProps, ['Width']) || '0').replace(/\D/g, '')) || 0;

        if (width >= 3840) badges.push('4k');
        else if (width >= 1920) badges.push('hd');
        else if (width > 0 && width <= 1280) badges.push('sd');

        const hdrFormat = String(getProp(videoProps, ['HDR format', 'HDR_Format']) || '');
        if (hdrFormat.includes('HDR10+')) badges.push('hdr10-plus');
        else if (hdrFormat.includes('HDR')) badges.push('hdr');
        if (hdrFormat.includes('Dolby Vision')) badges.push('dolby-vision');

        if (videoTracks.some(v => (getProp(v.properties || {}, ['Format']) || '') === 'AV1')) badges.push('av1');
    }

    let hasAtmos = false, hasDTS = false, hasDolby = false;
    for (const t of audioTracks) {
        const props = t.properties || {};
        const format = String(getProp(props, ['Format']) || '');
        const formatCommercial = String(getProp(props, ['Format commercial', 'Format_Commercial_IfAny']) || '');
        const combined = (format + formatCommercial).toLowerCase();

        if (combined.includes('atmos')) hasAtmos = true;
        if (combined.includes('dts')) hasDTS = true;
        if (combined.includes('dolby') || combined.includes('ac-3')) hasDolby = true;
    }

    if (hasAtmos) badges.push('dolby-atmos');
    else if (hasDolby) badges.push('dolby-audio');
    if (hasDTS) badges.push('dts');

    const hasSDH = textTracks.some(t => String(getProp(t.properties || {}, ['Title']) || '').includes('SDH'));
    if (hasSDH) badges.push('sdh');

    return badges;
}

function getDuration(d) {
    for (const t of d.tracks || []) {
        const durStr = getProp(t.properties || {}, ['Duration String', 'Duration_String']);
        if (durStr) return durStr;
        const dur = getProp(t.properties || {}, ['Duration']);
        if (dur) return dur;
    }
    return null;
}

function getSize(d) {
    for (const t of d.tracks || []) {
        const sizeStr = getProp(t.properties || {}, ['File size String', 'FileSize_String']);
        if (sizeStr) return sizeStr.split('(')[0].trim();
    }
    return formatBytes(d.filesize);
}

function getProp(props, keys) {
    if (!Array.isArray(keys)) keys = [keys];
    for (const k of keys) {
        if (props[k] !== undefined && props[k] !== null && props[k] !== '') return props[k];
        const lk = k.toLowerCase();
        for (const pk of Object.keys(props)) {
            if (pk.toLowerCase() === lk && props[pk] !== undefined && props[pk] !== null && props[pk] !== '') return props[pk];
        }
    }
    return null;
}

// Modal rendering
function renderModal() {
    const d = currentMediaInfo;
    const badges = getBadges(d);
    const dur = getDuration(d);
    const size = getSize(d);

    // Parse filename for clean display
    const parsed = parseFilename(currentFileName);
    const displayName = formatFilename(parsed);

    // Find related files
    const related = findRelatedFiles(currentFileName, window.allFiles || []);
    const relatedCount = related.otherResolutions.length + related.otherEpisodes.length;
    const isVideo = fileTypes.video.includes(currentFileName.split('.').pop().toLowerCase());

    let badgesHtml = '';
    if (badges.length) {
        badgesHtml = '<div class="modal-badges">' + badges.map(b => `<img class="modal-badge" src="${BADGE_URL}${b}.svg" alt="${b}" onerror="this.style.display='none'">`).join('') + '</div>';
    }

    let html = `
        <div class="modal-header">
            <div class="modal-filename-clean">${esc(displayName)}</div>
            <div class="modal-filename-original" title="${esc(currentFileName)}">${esc(currentFileName)}</div>
            <div class="modal-meta-row">
                ${dur ? `<div class="modal-meta-item"><strong>${dur}</strong></div>` : ''}
                <div class="modal-meta-item"><strong>${size}</strong></div>
            </div>
            ${badgesHtml}
        </div>
        <div class="modal-toolbar centered">
            <div class="view-toggle-pills">
                <button class="view-pill active" data-view="normal" onclick="setView('normal')">Media</button>
                <button class="view-pill" data-view="movie" onclick="setView('movie')">IMDb</button>
                ${isVideo ? `<button class="view-pill" data-view="related" onclick="setView('related')">Related${relatedCount > 0 ? ` <span class="related-count">${relatedCount}</span>` : ''}</button>` : ''}
                <button class="view-pill" data-view="watch" onclick="setView('watch')">Watch</button>
                <button class="view-pill" data-view="subs" onclick="setView('subs')">Subtitle</button>
                <button class="view-pill" data-view="text" onclick="setView('text')">Raw</button>
                <button class="view-pill copy-pill" onclick="copyMeta()" title="Copy metadata">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <a href="${MEDIA_URL}/d/${currentFileId}/${encodeURIComponent(currentFileName)}" class="view-pill download-pill" title="Download">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
            </div>
        </div>
        <div class="modal-body">
            <div class="normal-view">${renderSections(d)}</div>
            <div class="movie-view hidden"></div>
            ${isVideo ? `<div class="related-view hidden">${renderRelatedFiles(related)}</div>` : ''}
            <div class="watch-view hidden"></div>
            <div class="subs-view hidden"></div>
            <div class="text-view">${renderText(d)}</div>
        </div>
    `;
    document.getElementById('modalContent').innerHTML = html;
}

// Render related files section
function renderRelatedFiles(related) {
    let html = '<div class="related-content">';

    // Other resolutions
    if (related.otherResolutions.length > 0) {
        html += `
            <div class="related-section">
                <div class="related-section-title">Other Resolutions</div>
                <div class="related-list">
        `;
        for (const file of related.otherResolutions) {
            const safeName = esc(file.name).replace(/'/g, "\\'");
            html += `
                <div class="res-item" onclick="switchToFile('${file.id}', '${safeName}', ${file.size})">
                    <span class="res-badge">${file.parsed.resolution || 'N/A'}</span>
                    <span class="res-name" title="${esc(file.name)}">${esc(file.name)}</span>
                    <span class="res-divider">|</span>
                    <span class="res-size">${formatBytes(file.size)}</span>
                    <span class="res-divider">|</span>
                    <a href="${MEDIA_URL}/d/${file.id}/${encodeURIComponent(file.name)}" class="res-download" onclick="event.stopPropagation()" title="Download">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                </div>
            `;
        }
        html += '</div></div>';
    }

    // Other episodes (grouped by season, then by episode with multiple resolutions)
    if (related.otherEpisodes.length > 0) {
        // Group by season -> episode -> resolutions
        const episodesBySeason = {};
        for (const ep of related.otherEpisodes) {
            const s = ep.parsed.season || 0;
            const e = ep.parsed.episode || 0;
            const key = `${s}-${e}`;

            if (!episodesBySeason[s]) episodesBySeason[s] = {};
            if (!episodesBySeason[s][e]) {
                episodesBySeason[s][e] = {
                    episode: e,
                    episodeTitle: ep.parsed.episodeTitle,
                    resolutions: []
                };
            }
            // Add this resolution to the episode
            episodesBySeason[s][e].resolutions.push({
                resolution: ep.parsed.resolution,
                file: ep
            });
        }

        html += `
            <div class="related-section">
                <div class="related-section-title">Episodes</div>
        `;

        // Sort resolutions by quality
        const resOrder = {'2160P': 4, '4K': 4, 'UHD': 4, '1080P': 3, '720P': 2, '480P': 1};

        for (const [season, episodes] of Object.entries(episodesBySeason).sort((a, b) => a[0] - b[0])) {
            html += `
                <div class="related-season-group">
                    <div class="related-season-header">Season ${season}</div>
                    <div class="related-episodes-grid">
            `;

            // Sort episodes by episode number
            const sortedEpisodes = Object.values(episodes).sort((a, b) => a.episode - b.episode);

            for (const epData of sortedEpisodes) {
                const isCurrent = parseInt(season) === related.current.season &&
                                  epData.episode === related.current.episode;

                // Sort resolutions by quality (highest first)
                epData.resolutions.sort((a, b) =>
                    (resOrder[b.resolution] || 0) - (resOrder[a.resolution] || 0)
                );

                // Get best quality file for clicking
                const bestFile = epData.resolutions[0]?.file;
                const safeName = bestFile ? esc(bestFile.name).replace(/'/g, "\\'") : '';

                // Build resolution badges
                const resBadges = epData.resolutions
                    .map(r => r.resolution || 'N/A')
                    .filter((v, i, a) => a.indexOf(v) === i) // unique
                    .join(', ');

                html += `
                    <div class="related-episode ${isCurrent ? 'current' : ''}" 
                         onclick="${!isCurrent && bestFile ? `switchToFile('${bestFile.id}', '${safeName}', ${bestFile.size})` : ''}"
                         title="${epData.episodeTitle || `Episode ${epData.episode}`}">
                        <div class="ep-number">E${String(epData.episode).padStart(2, '0')}</div>
                        <div class="ep-title">${esc(epData.episodeTitle || `Episode ${epData.episode}`)}</div>
                        <div class="ep-quality">${resBadges}</div>
                    </div>
                `;
            }
            html += '</div></div>';
        }
        html += '</div>';
    }

    // "Like This" section - random similar titles
    const suggestions = getSimilarTitles(related.current, window.allFiles || [], 6);
    if (suggestions.length > 0) {
        html += `
            <div class="related-section">
                <div class="related-section-title">You May Also Like</div>
                <div class="like-this-grid">
        `;
        for (const file of suggestions) {
            const safeName = esc(file.name).replace(/'/g, "\\'");
            const parsed = file.parsed;
            html += `
                <div class="like-this-item" onclick="switchToFile('${file.id}', '${safeName}', ${file.size})">
                    <div class="like-this-title">${esc(parsed.title)}</div>
                    <div class="like-this-meta">
                        ${parsed.year ? `<span>${parsed.year}</span>` : ''}
                        ${parsed.season !== null ? `<span>S${String(parsed.season).padStart(2,'0')}</span>` : ''}
                        ${parsed.resolution ? `<span class="like-res">${parsed.resolution}</span>` : ''}
                    </div>
                </div>
            `;
        }
        html += '</div></div>';
    }

    html += '</div>';
    return html;
}

// Get similar/random titles for "Like This" section
function getSimilarTitles(currentParsed, allFiles, count = 6) {
    const currentKey = getSeriesKey(currentParsed);
    const seenTitles = new Set([currentKey]);
    const suggestions = [];

    // Get all unique titles (different from current)
    const uniqueTitles = [];
    for (const file of allFiles) {
        const parsed = parseFilename(file.name);
        const key = getSeriesKey(parsed);

        // Skip if same series or already seen
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);

        // Only video files
        if (!fileTypes.video.includes(file.name.split('.').pop().toLowerCase())) continue;

        uniqueTitles.push({ ...file, parsed });
    }

    // Shuffle and pick random titles
    const shuffled = uniqueTitles.sort(() => Math.random() - 0.5);

    // Try to get a mix: some from same year, some random
    const sameYear = shuffled.filter(f => f.parsed.year === currentParsed.year);
    const others = shuffled.filter(f => f.parsed.year !== currentParsed.year);

    // Take 2 from same year if available, rest random
    const fromSameYear = sameYear.slice(0, 2);
    const fromOthers = others.slice(0, count - fromSameYear.length);

    return [...fromSameYear, ...fromOthers].slice(0, count);
}

// Switch to a different file in the modal
function switchToFile(id, name, size) {
    closeModal();
    setTimeout(() => openInfo(id, name, size), 100);
}

const IMPORTANT_PROPS = {
    General: ['Format', 'File size String', 'Duration String', 'Overall bit rate', 'Frame rate', 'Encoded Date', 'Encoded Application'],
    Video: ['Format', 'Format profile', 'Width', 'Height', 'Display aspect ratio', 'Frame rate', 'Bit rate', 'Bit depth', 'HDR format'],
    Audio: ['Format', 'Format Commercial', 'Language', 'Channels', 'Sampling rate', 'Bit rate', 'Default'],
    Text: ['Format', 'Language', 'Title', 'Default', 'Forced'],
};

function formatPropKey(key) {
    return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/ String\d*$/i, '').replace(/^(.)/,  c => c.toUpperCase());
}

function renderTrackContent(props, importantKeys) {
    let html = '<div class="info-list">';
    const shown = new Set();

    for (const key of importantKeys) {
        const val = getProp(props, [key]);
        if (val === null) continue;
        if ((val === 'Yes' || val === 'No') && !['Default', 'Forced'].includes(key)) continue;

        const displayKey = formatPropKey(key);
        if (shown.has(displayKey.toLowerCase())) continue;
        shown.add(displayKey.toLowerCase());

        html += `<div class="info-row"><span class="info-label">${esc(displayKey)}</span><span class="info-value">${esc(String(val))}</span></div>`;
    }

    return html + '</div>';
}

function renderSections(d) {
    let html = '';
    const generalTracks = [], videoTracks = [], audioTracks = [], textTracks = [];

    for (const track of d.tracks || []) {
        const type = track.type || 'Unknown';
        if (type === 'General') generalTracks.push(track);
        else if (type === 'Video') videoTracks.push(track);
        else if (type === 'Audio') audioTracks.push(track);
        else if (type === 'Text') textTracks.push(track);
    }

    for (const track of generalTracks) {
        const props = track.properties || {};
        if (Object.keys(props).length === 0) continue;
        html += `<div class="info-section"><div class="section-header"><div class="section-title">General</div></div>${renderTrackContent(props, IMPORTANT_PROPS.General)}</div>`;
    }

    for (const track of videoTracks) {
        const props = track.properties || {};
        if (Object.keys(props).length === 0) continue;
        html += `<div class="info-section"><div class="section-header"><div class="section-title">Video</div></div>${renderTrackContent(props, IMPORTANT_PROPS.Video)}</div>`;
    }

    if (audioTracks.length > 0) {
        html += `<div class="track-tabs-container"><div class="track-tabs-header"><div class="section-title">Audio</div><div class="track-tabs">`;
        audioTracks.forEach((track, idx) => {
            const props = track.properties || {};
            const lang = getProp(props, ['Language String', 'Language']) || `Track ${idx + 1}`;
            const isDefault = getProp(props, ['Default']) === 'Yes';
            html += `<button class="track-tab ${idx === 0 ? 'active' : ''}" onclick="switchTab('audio', ${idx})">${esc(lang)}${isDefault ? '<span class="tab-default">✓</span>' : ''}</button>`;
        });
        html += `</div></div>`;
        audioTracks.forEach((track, idx) => {
            html += `<div class="track-content ${idx === 0 ? 'active' : ''}">${renderTrackContent(track.properties || {}, IMPORTANT_PROPS.Audio)}</div>`;
        });
        html += `</div>`;
    }

    if (textTracks.length > 0) {
        html += `<div class="track-tabs-container"><div class="track-tabs-header"><div class="section-title">Subtitles</div><div class="track-tabs">`;
        textTracks.forEach((track, idx) => {
            const props = track.properties || {};
            const lang = getProp(props, ['Language String', 'Language']) || `Track ${idx + 1}`;
            const isDefault = getProp(props, ['Default']) === 'Yes';
            html += `<button class="track-tab ${idx === 0 ? 'active' : ''}" onclick="switchTab('text', ${idx})">${esc(lang)}${isDefault ? '<span class="tab-default">✓</span>' : ''}</button>`;
        });
        html += `</div></div>`;
        textTracks.forEach((track, idx) => {
            html += `<div class="track-content ${idx === 0 ? 'active' : ''}">${renderTrackContent(track.properties || {}, IMPORTANT_PROPS.Text)}</div>`;
        });
        html += `</div>`;
    }

    return html || '<div class="no-info">No metadata available</div>';
}

function renderText(d) {
    let html = '';
    for (const t of d.tracks || []) {
        const props = t.properties || {};
        html += `<div class="text-section"><div class="text-title">${t.type}</div>`;
        for (const [k, v] of Object.entries(props)) {
            html += `<div class="text-row"><span class="text-label">${k.padEnd(28)}</span><span class="text-val">: ${v}</span></div>`;
        }
        html += '</div>';
    }
    return html;
}

function switchTab(group, idx) {
    const container = event.target.closest('.track-tabs-container');
    container.querySelectorAll('.track-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
    container.querySelectorAll('.track-content').forEach((c, i) => c.classList.toggle('active', i === idx));
}

function copyMeta() {
    let txt = '';
    for (const t of currentMediaInfo.tracks || []) {
        txt += t.type + '\n';
        for (const [k, v] of Object.entries(t.properties || {})) txt += `${k.padEnd(30)}: ${v}\n`;
        txt += '\n';
    }
    navigator.clipboard.writeText(txt.trim()).then(() => showToast('Copied!'));
}

// Play button functions
function togglePlay(e, fileId, fileName) {
    e.stopPropagation();
    // Close other dropdowns and remove active class from file items
    document.querySelectorAll('.play-dropdown').forEach(d => {
        if (d.id !== 'play-' + fileId) {
            d.classList.remove('show');
            d.closest('.file-item')?.classList.remove('dropdown-active');
        }
    });
    const dropdown = document.getElementById('play-' + fileId);
    const isShowing = dropdown.classList.toggle('show');
    dropdown.closest('.file-item')?.classList.toggle('dropdown-active', isShowing);
}

function copyStreamLink(fileId) {
    document.querySelectorAll('.play-dropdown').forEach(d => d.classList.remove('show'));
    const url = `${MEDIA_URL}/s/${fileId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Stream link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Stream link copied to clipboard!');
    });
}

// Play in Browser - Video Player Modal
let playerModal = null;
let videoPlayer = null;

function playInBrowser(fileId, fileName) {
    // Close dropdown
    document.querySelectorAll('.play-dropdown').forEach(d => {
        d.classList.remove('show');
        d.closest('.file-item')?.classList.remove('dropdown-active');
    });

    const url = `${MEDIA_URL}/s/${fileId}`;

    // Create modal if doesn't exist
    if (!playerModal) {
        playerModal = document.createElement('div');
        playerModal.className = 'player-modal';
        playerModal.innerHTML = `
            <div class="player-modal-backdrop" onclick="closePlayer()"></div>
            <div class="player-modal-content">
                <div class="player-header">
                    <div class="player-title"></div>
                    <button class="player-close" onclick="closePlayer()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="player-container">
                    <video class="player-video" controls playsinline></video>
                    <div class="player-error hidden">
                        <div class="error-icon">⚠️</div>
                        <div class="error-title">Playback not supported</div>
                        <div class="error-msg">This file uses a codec your browser can't play (likely H.265/HEVC)</div>
                        <div class="error-actions">
                            <a href="#" class="error-btn vlc-btn" onclick="openInVLC();return false;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                Open in VLC
                            </a>
                            <button class="error-btn copy-btn" onclick="copyCurrentStreamLink()">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                Copy Link
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(playerModal);

        videoPlayer = playerModal.querySelector('.player-video');

        // Handle errors
        videoPlayer.addEventListener('error', () => {
            playerModal.querySelector('.player-error').classList.remove('hidden');
            videoPlayer.classList.add('hidden');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handlePlayerKeyboard);
    }

    // Reset and show
    const errorDiv = playerModal.querySelector('.player-error');
    errorDiv.classList.add('hidden');
    videoPlayer.classList.remove('hidden');

    // Set title and source
    playerModal.querySelector('.player-title').textContent = fileName;
    playerModal.dataset.fileId = fileId;
    playerModal.dataset.fileName = fileName;

    videoPlayer.src = url;
    playerModal.classList.add('show');
    document.body.style.overflow = 'hidden';

    // Try to play
    videoPlayer.play().catch(() => {
        // Autoplay blocked, user needs to click play
    });
}

function closePlayer() {
    if (playerModal) {
        playerModal.classList.remove('show');
        document.body.style.overflow = '';
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.src = '';
        }
    }
}

function handlePlayerKeyboard(e) {
    if (!playerModal?.classList.contains('show')) return;

    switch(e.key) {
        case 'Escape':
            closePlayer();
            break;
        case ' ':
            e.preventDefault();
            videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
            break;
        case 'ArrowLeft':
            videoPlayer.currentTime -= 10;
            break;
        case 'ArrowRight':
            videoPlayer.currentTime += 10;
            break;
        case 'ArrowUp':
            videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1);
            break;
        case 'ArrowDown':
            videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1);
            break;
        case 'f':
        case 'F':
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                playerModal.querySelector('.player-container').requestFullscreen();
            }
            break;
    }
}

function openInVLC() {
    const fileId = playerModal.dataset.fileId;
    const fileName = playerModal.dataset.fileName;
    closePlayer();
    playIn('vlc-desktop', fileId, fileName);
}

function copyCurrentStreamLink() {
    const fileId = playerModal.dataset.fileId;
    copyStreamLink(fileId);
}

function playIn(player, fileId, fileName) {
    document.querySelectorAll('.play-dropdown').forEach(d => d.classList.remove('show'));

    // Use media proxy URL directly
    const url = `${MEDIA_URL}/s/${fileId}`;
    const encodedUrl = encodeURIComponent(url);
    const encodedName = encodeURIComponent(fileName);

    let playUrl = '';
    switch(player) {
        case 'vlc-desktop': case 'vlc-mobile': playUrl = 'vlc://' + url; break;
        case 'potplayer': playUrl = 'potplayer://' + url; break;
        case 'iina': playUrl = 'iina://weblink?url=' + encodedUrl; break;
        case 'mpv': playUrl = 'mpv://' + encodedUrl; break;
        case 'nplayer': playUrl = 'nplayer-' + url; break;
        case 'mx-free': playUrl = 'intent:' + url + '#Intent;package=com.mxtech.videoplayer.ad;S.title=' + encodedName + ';end'; break;
        default: playUrl = url;
    }

    window.location.href = playUrl;
}

// Close play dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.play-wrapper')) {
        document.querySelectorAll('.play-dropdown.show').forEach(d => {
            d.classList.remove('show');
            d.closest('.file-item')?.classList.remove('dropdown-active');
        });
    }
});

// Toast
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if (e.key === 'Escape') closeModal();
});


