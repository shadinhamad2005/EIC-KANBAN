const firebaseConfig = {
  apiKey: "AIzaSyAPRI3IvsvHaPS4BaFjTiasZLvhEgrc6Ts",
  authDomain: "eic-kanban.firebaseapp.com",
  projectId: "eic-kanban",
  storageBucket: "eic-kanban.firebasestorage.app",
  messagingSenderId: "759761467686",
  appId: "1:759761467686:web:1696346f0fa5fac44269e7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Initialize icons on load
document.addEventListener('DOMContentLoaded', () => lucide.createIcons());

// === Core DOM Elements ===
const authOverlay = document.getElementById('auth-overlay');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const settingsBtn = document.getElementById('settings-btn');
const analyticsBtn = document.getElementById('analytics-btn');
const historyBtn = document.getElementById('history-btn');
const newTicketBtn = document.getElementById('new-ticket-btn');
const userEmailDisplay = document.getElementById('user-email');
const boardContainer = document.getElementById('board-container');
const boardTitleDisplay = document.getElementById('board-title-display');
const globalSearch = document.getElementById('global-search');

// Modals
const settingsModal = document.getElementById('settings-modal');
const analyticsModal = document.getElementById('analytics-modal');
const historyModal = document.getElementById('history-modal');
const cardModal = document.getElementById('card-modal');

// State
let isSignup = false;
let unsubscribeCards = null;
let unsubscribeSettings = null;
let unsubscribeBoards = null;
let activeBoardId = 'helpdesk';
let allBoardsData = {};
let currentBoardColumns = ['Incoming', 'In Progress', 'Done'];
let currentBoardStaff = [];
let currentBoardCategories = [];
let currentBoardType = 'helpdesk';
let currentFormFields = [
    { id: "f_title", label: "Task Title *", type: "text", required: true },
    { id: "f_email", label: "Contact Email", type: "email", required: true },
    { id: "f_phone", label: "Phone Number", type: "text", required: false },
    { id: "f_urgent", label: "Requires Urgent Attention (1-2 Hours)", type: "checkbox", options: ["Urgent"] }
];
let allCardsData = {}; 
let activeModalCardId = null;
let chartInstance = null;
let editingFieldId = null;
let selectedBoardType = 'internal'; 

// HTML5 Notifications
let notificationsEnabled = false;
if ("Notification" in window) {
    Notification.requestPermission().then(permission => {
        notificationsEnabled = permission === "granted";
    });
}

// === Authentication ===
document.getElementById('signup-link').addEventListener('click', (e) => {
    e.preventDefault(); isSignup = !isSignup;
    loginBtn.innerText = isSignup ? 'Sign Up' : 'Log In to Workspace';
    e.target.innerText = isSignup ? 'Log In instead' : 'Sign Up';
});

loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const errorMsg = document.getElementById('auth-error-msg');
    try {
        if (isSignup) await auth.createUserWithEmailAndPassword(email, password);
        else await auth.signInWithEmailAndPassword(email, password);
    } catch (error) { 
        console.error("Auth error:", error);
        errorMsg.innerText = error.message; 
        alert("Login Error: " + error.message); 
    }
});

logoutBtn.addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged((user) => {
    if (user) {
        console.log("User logged in:", user.email);
        if (authOverlay) {
            authOverlay.style.opacity = '0';
            authOverlay.style.pointerEvents = 'none';
            setTimeout(() => { authOverlay.style.display = 'none'; }, 500);
        }
        userEmailDisplay.innerText = user.email;
        [settingsBtn, analyticsBtn, historyBtn, globalSearch, newTicketBtn, logoutBtn].forEach(el => {
            if (el) el.style.display = 'inline-block';
        });
        initWorkspace();
    } else {
        console.log("No user session.");
        if (authOverlay) {
            authOverlay.style.display = 'flex';
            authOverlay.style.pointerEvents = 'auto';
            setTimeout(() => authOverlay.style.opacity = '1', 10);
        }
        userEmailDisplay.innerText = '';
        [settingsBtn, analyticsBtn, historyBtn, globalSearch, newTicketBtn, logoutBtn].forEach(el => {
            if (el) el.style.display = 'none';
        });
        if (unsubscribeCards) { unsubscribeCards(); unsubscribeCards = null; }
        if (unsubscribeSettings) { unsubscribeSettings(); unsubscribeSettings = null; }
        if (unsubscribeBoards) { unsubscribeBoards(); unsubscribeBoards = null; }
        boardContainer.innerHTML = '';
        const sidebar = document.getElementById('board-sidebar');
        if (sidebar) sidebar.innerHTML = '';
        allBoardsData = {}; allCardsData = {};
    }
});

// === Workspace Initialization ===
async function initWorkspace() {
    try {
        await seedDefaultBoards();
        const helpdeskRef = db.collection('boards').doc('helpdesk');
        const snap = await helpdeskRef.get();
        if (snap.exists) {
            const data = snap.data();
            const hasUrgent = (data.formFields || []).some(f => f.id === 'f_urgent');
            if (!hasUrgent) {
                const updatedFields = [...(data.formFields || []), { id: "f_urgent", label: "Requires Urgent Attention (1-2 Hours)", type: "checkbox", options: ["Urgent"] }];
                await helpdeskRef.update({ formFields: updatedFields });
                await db.collection('settings').doc('config').update({ formFields: updatedFields });
            }
        }
        initBoardsListener();
    } catch (e) {
        console.error("Workspace init failed:", e);
        alert("System Initialization Error: " + e.message);
    }
}

async function seedDefaultBoards() {
    const helpdeskRef = db.collection('boards').doc('helpdesk');
    const maintenanceRef = db.collection('boards').doc('maintenance');
    const [hdSnap, mSnap] = await Promise.all([helpdeskRef.get(), maintenanceRef.get()]);
    
    if (!hdSnap.exists) {
        const cfgSnap = await db.collection('settings').doc('config').get();
        const cfg = cfgSnap.exists ? cfgSnap.data() : {};
        await helpdeskRef.set({
            name: cfg.boardTitle || 'EIC Helpdesk',
            type: 'helpdesk',
            icon: '🎫',
            columns: cfg.boardColumns || ['Incoming', 'In Progress', 'On Hold', 'Done'],
            formFields: cfg.formFields || currentFormFields,
            createdAt: new Date().toISOString()
        });
    }
    if (!mSnap.exists) {
        await maintenanceRef.set({
            name: 'Maintenance',
            type: 'internal',
            icon: '🔧',
            columns: ['To Do', 'In Progress', 'Done'],
            formFields: [],
            createdAt: new Date().toISOString()
        });
    }
}

function initBoardsListener() {
    unsubscribeBoards = db.collection('boards').onSnapshot((snap) => {
        allBoardsData = {};
        snap.forEach(d => { allBoardsData[d.id] = { id: d.id, ...d.data() }; });
        renderSidebar();
        switchBoard(activeBoardId, true);
        lucide.createIcons();
    });
}

function renderSidebar() {
    const sidebar = document.getElementById('board-sidebar');
    sidebar.innerHTML = '';
    Object.values(allBoardsData).forEach(board => {
        const btn = document.createElement('button');
        btn.className = 'sidebar-board-btn' + (board.id === activeBoardId ? ' active' : '');
        
        let iconName = 'layout';
        if (board.type === 'helpdesk') iconName = 'ticket';
        else if (board.type === 'internal') iconName = 'wrench';
        else if (board.type === 'project') iconName = 'folder';

        btn.innerHTML = `<i data-lucide="${iconName}"></i><span class="sidebar-label">${board.name}</span>`;
        btn.addEventListener('click', () => switchBoard(board.id));
        sidebar.appendChild(btn);
    });
    const divider = document.createElement('div');
    divider.className = 'sidebar-divider';
    const addBtn = document.createElement('button');
    addBtn.className = 'sidebar-board-btn';
    addBtn.innerHTML = `<i data-lucide="plus-circle"></i><span class="sidebar-label">New Board</span>`;
    addBtn.addEventListener('click', () => { closeAllModals(); document.getElementById('create-board-modal').style.display = 'flex'; });
    sidebar.appendChild(divider);
    sidebar.appendChild(addBtn);
    lucide.createIcons();
}

function switchBoard(boardId, force = false) {
    if (boardId === activeBoardId && !force) return;
    activeBoardId = boardId;
    const board = allBoardsData[boardId];
    if (!board) return;

    currentBoardColumns = board.columns || ['Incoming', 'In Progress', 'Done'];
    currentBoardStaff = board.staffList || [];
    currentBoardCategories = board.categoryList || ['Maintenance', 'Security', 'Cleaning', 'IT', 'Finance', 'Other'];
    currentBoardType = board.type || 'internal';
    currentFormFields = board.formFields || [];
    boardTitleDisplay.innerText = board.name;

    const formBuilderSection = document.querySelector('#settings-modal .modal-body > div:last-child');
    if (formBuilderSection) formBuilderSection.style.display = currentBoardType === 'helpdesk' ? '' : 'none';

    if (currentBoardType === 'helpdesk') {
        newTicketBtn.innerText = '📋 Log Ticket';
    } else {
        newTicketBtn.innerText = '➕ Add Card';
    }

    if (unsubscribeCards) { unsubscribeCards(); unsubscribeCards = null; }
    allCardsData = {};
    renderBoardLayout();
    initCardsListener();
    renderSidebar();
    closeAllModals();
}

function renderBoardLayout() {
    boardContainer.innerHTML = '';
    currentBoardColumns.forEach(status => {
        const col = document.createElement('div');
        col.className = 'column'; col.id = `col-${status}`; col.setAttribute('data-status', status);
        let wipText = status === 'In Progress' ? `<span class="wip-limit"><span id="count-${status}">0</span> / 5 WIP</span>` : `<span class="wip-limit" id="count-${status}">0</span>`;
        if(status === 'In Progress') col.setAttribute('data-wip', '5');
        
        col.innerHTML = `<div class="column-header">${status} ${wipText}</div><div class="card-list" id="list-${status}"></div>`;
        boardContainer.appendChild(col);
    });

    document.querySelectorAll('.card-list').forEach(listEl => {
        new Sortable(listEl, {
            group: 'shared', animation: 150, ghostClass: 'sortable-ghost',
            onMove: function (evt) {
                const columnContainer = evt.to.closest('.column');
                const maxWip = columnContainer.getAttribute('data-wip');
                if (maxWip && evt.from !== evt.to && evt.to.children.length >= parseInt(maxWip)) {
                    columnContainer.classList.add('reject-drop');
                    setTimeout(() => columnContainer.classList.remove('reject-drop'), 400);
                    return false; 
                }
            },
            onEnd: async function (evt) {
                const itemEl = evt.item;
                const fromStatus = evt.from.closest('.column').getAttribute('data-status');
                const toStatus = evt.to.closest('.column').getAttribute('data-status');
                if (fromStatus === toStatus) return;

                const cardId = itemEl.getAttribute('data-id');
                const now = new Date().toISOString();
                const updates = { 
                    status: toStatus, 
                    activityLog: firebase.firestore.FieldValue.arrayUnion({ type: 'status', action: `Moved from ${fromStatus} to ${toStatus}`, timestamp: now, user: auth.currentUser.email }) 
                };
                if (toStatus === 'In Progress' && fromStatus !== 'In Progress') updates.startedAt = now;
                if (toStatus === 'Done') updates.completedAt = now;

                try { await db.collection('cards').doc(cardId).update(updates); } 
                catch (err) { alert("Error moving card: " + err.message); }
            }
        });
    });
    distributeCards();
}

function initCardsListener() {
    unsubscribeCards = db.collection('cards').onSnapshot((snapshot) => {
        const oldDataKeys = Object.keys(allCardsData);
        snapshot.docChanges().forEach(change => {
            if (change.type === 'removed') delete allCardsData[change.doc.id];
        });
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const cardBoard = data.boardId || 'helpdesk';
            if (cardBoard !== activeBoardId) return;
            if (activeBoardId === 'helpdesk' && oldDataKeys.length > 0 && !allCardsData[id] && notificationsEnabled && data.status === 'Incoming') {
                new Notification("New Ticket Received!", { body: `${data.ticketId}: ${data.title}` });
            }
            if (activeBoardId === 'helpdesk' && data.status === 'Done' && data.completedAt) {
                const daysOld = (new Date() - new Date(data.completedAt)) / (1000 * 60 * 60 * 24);
                if(daysOld > 30) {
                    db.collection('cards').doc(id).update({ status: 'Archived', archivedAt: new Date().toISOString() }).catch(e => console.error(e));
                    return;
                }
            }
            allCardsData[id] = { id: id, ...data };
        });
        distributeCards();
        if (activeModalCardId && allCardsData[activeModalCardId]) openCardModal(activeModalCardId);
    });
}

function distributeCards() {
    currentBoardColumns.forEach(status => {
        const listEl = document.getElementById(`list-${status}`);
        if(listEl) listEl.innerHTML = '';
    });
    const searchQuery = globalSearch.value.toLowerCase();
    const grouped = {};
    const prioWeight = { 'Urgent': 4, 'High': 3, 'Normal': 2, 'Low': 1 };
    const sortedCards = Object.values(allCardsData).sort((a, b) => {
        const weightA = prioWeight[a.priority || 'Normal'] || 2;
        const weightB = prioWeight[b.priority || 'Normal'] || 2;
        if (weightA !== weightB) return weightB - weightA;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    sortedCards.forEach(card => {
        if(card.status === 'Archived') return;
        const searchString = `${card.ticketId || ''} ${card.title || ''} ${card.requesterEmail || ''} ${(card.tags || []).join(' ')}`.toLowerCase();
        if(searchQuery && !searchString.includes(searchQuery)) return;
        const status = card.status || 'Incoming';
        if (!grouped[status]) grouped[status] = [];
        grouped[status].push(card);
    });
    currentBoardColumns.forEach(status => {
        if(!grouped[status]) {
            const countEl = document.getElementById(`count-${status}`);
            if(countEl) countEl.innerText = '0';
            return;
        }
        const listEl = document.getElementById(`list-${status}`);
        grouped[status].forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            cardEl.setAttribute('data-id', card.id);
            const prio = card.priority || 'Normal';
            const prioClass = `prio-${prio.toLowerCase()}`;
            const prioStrip = document.createElement('div');
            prioStrip.className = `card-prio-strip ${prioClass}`;
            cardEl.appendChild(prioStrip);
            const customerUrgent = card.isUrgentFlag || card.formData?.f_urgent?.includes('Urgent') || card.formData?.Urgent_Attention_Needed;
            if (customerUrgent) {
                const badge = document.createElement('div');
                badge.className = 'urgent-badge';
                badge.innerHTML = '🚨';
                cardEl.appendChild(badge);
            }
            let slaClass = '';
            if (status === 'In Progress' && card.startedAt) {
                const hours = (new Date() - new Date(card.startedAt)) / 3600000;
                if (hours > 48) slaClass = 'sla-danger';
                else if (hours > 24) slaClass = 'sla-warning';
            }
            if (slaClass) cardEl.classList.add(slaClass);
            const displayTitle = card.title || card.formData?.f_title || "Untitled";
            const content = document.createElement('div');
            content.className = 'card-content';
            let tagsHtml = '';
            if (card.tags && card.tags.length > 0) {
                tagsHtml = `<div class="card-tags">${card.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`;
            }
            let footerHtml = '';
            if (card.assignee || card.dueDate) {
                const initials = card.assignee ? card.assignee.substring(0, 2).toUpperCase() : '?';
                footerHtml = `
                    <div class="card-footer">
                        <div style="font-size: 0.7rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
                            ${card.dueDate ? `<i data-lucide="calendar" style="width:12px;height:12px;"></i> ${new Date(card.dueDate).toLocaleDateString()}` : ''}
                        </div>
                        ${card.assignee ? `<div class="assignee-avatar">${initials}</div>` : ''}
                    </div>
                `;
            }
            content.innerHTML = DOMPurify.sanitize(`
                ${card.ticketId ? `<div class="card-ticket">${card.ticketId}</div>` : ''}
                <div class="card-title">${displayTitle}</div>
                <div class="card-desc">${card.requesterEmail || 'No email provided'}</div>
                ${tagsHtml}
                ${footerHtml}
            `);
            cardEl.appendChild(content);
            cardEl.addEventListener('click', () => openCardModal(card.id));
            if(listEl) listEl.appendChild(cardEl);
        });
        const countEl = document.getElementById(`count-${status}`);
        if(countEl) countEl.innerText = grouped[status] ? grouped[status].length : '0';
    });
    lucide.createIcons();
}

globalSearch.addEventListener('input', distributeCards);

const newFieldTypeSelect = document.getElementById('new-field-type');
const newFieldOptionsInput = document.getElementById('new-field-options');
const newFieldParentSelect = document.getElementById('new-field-condition-parent');
const conditionEqualsText = document.getElementById('condition-equals-text');
const conditionValueInput = document.getElementById('new-field-condition-value');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const addFieldBtn = document.getElementById('add-field-btn');

if (newFieldTypeSelect) {
    newFieldTypeSelect.addEventListener('change', (e) => {
        if (newFieldOptionsInput) newFieldOptionsInput.style.display = ['select', 'radio', 'checkbox'].includes(e.target.value) ? 'block' : 'none';
    });
}
if (newFieldParentSelect) {
    newFieldParentSelect.addEventListener('change', (e) => {
        const hasParent = e.target.value !== '';
        if (conditionEqualsText) conditionEqualsText.style.display = hasParent ? 'inline' : 'none';
        if (conditionValueInput) conditionValueInput.style.display = hasParent ? 'block' : 'none';
    });
}

let builderSortableInstance = null;
settingsBtn.addEventListener('click', () => {
    document.getElementById('settings-board-title').value = boardTitleDisplay.innerText;
    document.getElementById('settings-board-columns').value = currentBoardColumns.join(', ');
    renderBuilderList();
    renderStaffSettings();
    renderCategorySettings();
    if(!builderSortableInstance) {
        builderSortableInstance = new Sortable(document.getElementById('builder-fields-list'), {
            animation: 150,
            onEnd: function (evt) {
                const temp = currentFormFields.splice(evt.oldIndex, 1)[0];
                currentFormFields.splice(evt.newIndex, 0, temp);
                renderBuilderList();
            }
        });
    }
    closeAllModals();
    document.getElementById('close-card-btn').onclick = () => { cardModal.style.display = 'none'; activeModalCardId = null; };
    settingsModal.style.display = 'flex';
});

document.getElementById('builder-fields-list').addEventListener('click', (e) => {
    const item = e.target.closest('.builder-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    if (e.target.classList.contains('btn-edit-field')) window.editField(id);
    if (e.target.classList.contains('btn-remove-field')) window.removeField(id);
});

function closeAllModals() {
    [settingsModal, analyticsModal, historyModal, cardModal, document.getElementById('new-ticket-modal'), document.getElementById('add-card-modal'), document.getElementById('create-board-modal')].forEach(m => { if(m) m.style.display = 'none'; });
}
document.addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay') && e.target.id !== 'auth-overlay') { closeAllModals(); if (activeModalCardId) activeModalCardId = null; } });

function renderBuilderList() {
    const list = document.getElementById('builder-fields-list');
    list.innerHTML = '';
    newFieldParentSelect.innerHTML = '<option value="">Always Show (No Condition)</option>';
    
    currentFormFields.forEach((field) => {
        newFieldParentSelect.innerHTML += `<option value="${field.id}">${field.label}</option>`;
        list.innerHTML += DOMPurify.sanitize(`
            <div class="builder-item" data-id="${field.id}">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <i data-lucide="grip-vertical" style="width:14px; color:var(--text-muted); cursor:grab;"></i>
                    <span style="font-weight:600; font-size:0.9rem;">${field.label}</span>
                    <span class="type-badge">${field.type}</span>
                </div>
                <div class="builder-actions">
                    <button class="btn-icon-sm btn-edit-field" title="Edit"><i data-lucide="edit-3" style="width:14px;"></i></button>
                    <button class="btn-icon-sm btn-remove-field delete" title="Remove"><i data-lucide="trash-2" style="width:14px;"></i></button>
                </div>
            </div>
        `);
    });
    lucide.createIcons();
}
window.removeField = function(id) { currentFormFields = currentFormFields.filter(f => f.id !== id); renderBuilderList(); }
window.editField = function(id) {
    const field = currentFormFields.find(f => f.id === id);
    if(!field) return;
    editingFieldId = id;
    document.getElementById('new-field-label').value = field.label;
    document.getElementById('new-field-type').value = field.type;
    document.getElementById('new-field-options').value = (field.options || []).join(', ');
    document.getElementById('new-field-required').checked = !!field.required;
    newFieldOptionsInput.style.display = ['select', 'radio', 'checkbox'].includes(field.type) ? 'block' : 'none';
    addFieldBtn.innerText = 'Update Field Structure';
    cancelEditBtn.style.display = 'inline-block';
}
cancelEditBtn.addEventListener('click', () => {
    editingFieldId = null;
    document.getElementById('new-field-label').value = ''; 
    document.getElementById('new-field-options').value = '';
    document.getElementById('new-field-required').checked = false;
    addFieldBtn.innerText = 'Add Field Structure';
    cancelEditBtn.style.display = 'none';
});
addFieldBtn.addEventListener('click', () => {
    const label = document.getElementById('new-field-label').value;
    const type = document.getElementById('new-field-type').value;
    const optionsRaw = document.getElementById('new-field-options').value;
    const isRequired = document.getElementById('new-field-required').checked;
    if(!label) return;
    let options = ['select', 'radio', 'checkbox'].includes(type) ? optionsRaw.split(',').map(s => s.trim()).filter(s => s) : [];
    if(editingFieldId) {
        const idx = currentFormFields.findIndex(f => f.id === editingFieldId);
        if(idx > -1) currentFormFields[idx] = { ...currentFormFields[idx], label, type, options, required: isRequired };
    } else {
        currentFormFields.push({ id: "f_" + Math.random().toString(36).substr(2, 5), label, type, required: isRequired, options });
    }
    cancelEditBtn.click();
    renderBuilderList();
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const title = document.getElementById('settings-board-title').value;
    const cols = document.getElementById('settings-board-columns').value.split(',').map(s=>s.trim()).filter(s=>s);
    try {
        await db.collection('boards').doc(activeBoardId).set({ name: title, columns: cols, formFields: currentFormFields, staffList: currentBoardStaff, categoryList: currentBoardCategories }, { merge: true });
        if (activeBoardId === 'helpdesk') await db.collection('settings').doc('config').set({ boardTitle: title, boardColumns: cols, formFields: currentFormFields, staffList: currentBoardStaff, categoryList: currentBoardCategories }, { merge: true });
        settingsModal.style.display = 'none';
        alert("Saved.");
    } catch(err) { alert(err.message); }
});

function renderStaffSettings() {
    const list = document.getElementById('settings-staff-list');
    list.innerHTML = '';
    currentBoardStaff.forEach((name, idx) => {
        list.innerHTML += `
            <div class="builder-item" style="padding: 10px 15px;">
                <span style="font-size: 0.9rem; font-weight: 500;">${name}</span>
                <button class="btn-icon-sm delete" onclick="removeStaff(${idx})"><i data-lucide="trash-2" style="width:14px;"></i></button>
            </div>
        `;
    });
    lucide.createIcons();
}
document.getElementById('add-staff-btn').addEventListener('click', () => {
    const input = document.getElementById('new-staff-name');
    const name = input.value.trim();
    if (name && !currentBoardStaff.includes(name)) {
        currentBoardStaff.push(name);
        input.value = '';
        renderStaffSettings();
    }
});
window.removeStaff = (idx) => {
    currentBoardStaff.splice(idx, 1);
    renderStaffSettings();
};

function renderCategorySettings() {
    const list = document.getElementById('settings-category-list');
    list.innerHTML = '';
    currentBoardCategories.forEach((cat, idx) => {
        list.innerHTML += `
            <div class="builder-item" style="padding: 10px 15px;">
                <span style="font-size: 0.9rem; font-weight: 500;">${cat}</span>
                <button class="btn-icon-sm delete" onclick="removeCategory(${idx})"><i data-lucide="trash-2" style="width:14px;"></i></button>
            </div>
        `;
    });
    lucide.createIcons();
}
document.getElementById('add-category-btn').addEventListener('click', () => {
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (name && !currentBoardCategories.includes(name)) {
        currentBoardCategories.push(name);
        input.value = '';
        renderCategorySettings();
    }
});
window.removeCategory = (idx) => {
    currentBoardCategories.splice(idx, 1);
    renderCategorySettings();
};

document.getElementById('delete-board-btn').addEventListener('click', async () => {
    if (activeBoardId === 'helpdesk' || activeBoardId === 'maintenance') return alert("System boards cannot be deleted.");
    if (confirm(`Delete board "${allBoardsData[activeBoardId].name}" and ALL its cards?`)) {
        try {
            const cards = await db.collection('cards').where("boardId", "==", activeBoardId).get();
            const batch = db.batch();
            cards.forEach(d => batch.delete(d.ref));
            await batch.commit();
            await db.collection('boards').doc(activeBoardId).delete();
            settingsModal.style.display = 'none';
            switchBoard('helpdesk');
        } catch (err) { alert(err.message); }
    }
});

document.getElementById('delete-card-icon-btn').addEventListener('click', async () => {
    if (!activeModalCardId) return;
    if (confirm("Delete card?")) {
        try { await db.collection('cards').doc(activeModalCardId).delete(); cardModal.style.display = 'none'; }
        catch (err) { alert(err.message); }
    }
});

function openCardModal(cardId) {
    closeAllModals();
    activeModalCardId = cardId;
    const card = allCardsData[cardId];
    if(!card) return;
    document.getElementById('modal-priority-select').value = card.priority || 'Normal';
    document.getElementById('modal-ticket-id').innerText = card.ticketId || "Ticket Details";
    
    // Update Delete and Close Buttons with Lucide
    const headerActions = document.querySelector('#card-modal .modal-header div');
    headerActions.innerHTML = `
        <select id="modal-priority-select" class="modal-prio-select">
            <option value="Normal">🟡 Normal</option>
            <option value="Low">🟢 Low</option>
            <option value="High">🟠 High</option>
            <option value="Urgent">🔴 Urgent</option>
        </select>
        <button id="delete-card-icon-btn" class="icon-btn" style="width:32px; height:32px; border-radius:50%; color:#ef4444;" title="Delete Card"><i data-lucide="trash-2"></i></button>
        <button class="close-btn" id="close-card-btn"><i data-lucide="x"></i></button>
    `;
    // Re-attach listeners for dynamically replaced buttons
    document.getElementById('close-card-btn').onclick = () => cardModal.style.display = 'none';
    document.getElementById('delete-card-icon-btn').onclick = async () => {
        if (confirm("Delete this ticket permanently?")) {
            await db.collection('cards').doc(cardId).delete();
            cardModal.style.display = 'none';
        }
    };
    document.getElementById('modal-priority-select').onchange = (e) => db.collection('cards').doc(cardId).update({ priority: e.target.value });

    const fieldsDiv = document.getElementById('modal-dynamic-fields');
    fieldsDiv.innerHTML = `<h3 style="margin-bottom: 20px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-color);">Submission Metadata</h3>`;
    
    let attachmentURL = null;
    if(card.formData) {
        Object.entries(card.formData).forEach(([key, val]) => {
            if(typeof val === 'string' && val.startsWith('data:image')) { attachmentURL = val; return; }
            fieldsDiv.innerHTML += DOMPurify.sanitize(`<div class="field-display"><label>${key.replace(/_/g, ' ')}</label><div class="val">${val}</div></div>`);
        });
    }

    const attZone = document.getElementById('modal-attachment-zone');
    if(attachmentURL) {
        attZone.style.display = 'block';
        document.getElementById('modal-attachment-img').src = attachmentURL;
        document.getElementById('modal-attachment-img').style.display = 'block';
        document.getElementById('modal-attachment-link').href = attachmentURL;
    } else {
        attZone.style.display = 'none';
    }

    const assigneeSelect = document.getElementById('modal-assignee-select');
    assigneeSelect.innerHTML = '<option value="">Unassigned</option>' + currentBoardStaff.map(s => `<option value="${s}">${s}</option>`).join('');
    assigneeSelect.value = card.assignee || '';
    document.getElementById('modal-due-date').value = card.dueDate || '';
    document.getElementById('modal-tags-input').value = (card.tags || []).join(', ');
    
    document.getElementById('modal-assignee-select').onchange = () => db.collection('cards').doc(cardId).update({ assignee: document.getElementById('modal-assignee-select').value });
    document.getElementById('modal-due-date').onchange = () => db.collection('cards').doc(cardId).update({ dueDate: document.getElementById('modal-due-date').value });
    document.getElementById('modal-tags-input').onchange = () => db.collection('cards').doc(cardId).update({ tags: document.getElementById('modal-tags-input').value.split(',').map(t=>t.trim()).filter(t=>t) });

    document.getElementById('action-email-btn').innerHTML = `<i data-lucide="mail"></i> Email`;
    document.getElementById('action-email-btn').onclick = () => {
        let recipient = card.requesterEmail || card.formData?.Contact_Email || card.formData?.f_email;
        if (!recipient) return alert("No email address found.");
        window.location.href = `mailto:${recipient}?subject=Re: ${card.ticketId}&body=Hello, we are working on your request.`;
    };

    document.getElementById('action-whatsapp-btn').innerHTML = `<i data-lucide="message-square"></i> WhatsApp`;
    document.getElementById('action-whatsapp-btn').onclick = () => {
        let phone = card.formData?.Contact_Phone || card.formData?.f_phone;
        if (!phone) return alert("No phone number found.");
        window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}`, '_blank');
    };

    const timelineDiv = document.getElementById('modal-timeline');
    timelineDiv.innerHTML = '';
    (card.activityLog || []).forEach(log => {
        let icon = 'info';
        if(log.type === 'note') icon = 'message-circle';
        if(log.type === 'status') icon = 'refresh-cw';
        timelineDiv.innerHTML += `
            <div class="timeline-event">
                <div class="meta">${new Date(log.timestamp).toLocaleString()} • ${log.user}</div>
                <div class="content">${log.action}</div>
            </div>
        `;
    });
    lucide.createIcons();
    cardModal.style.display = 'flex';
}

document.getElementById('close-card-btn').addEventListener('click', () => cardModal.style.display = 'none');
document.getElementById('add-note-btn').addEventListener('click', async () => {
    const text = document.getElementById('note-input').value.trim();
    if(!text) return;
    await logAction(activeModalCardId, text, 'note');
    document.getElementById('note-input').value = '';
});
async function logAction(cardId, text, type = 'system') {
    return db.collection('cards').doc(cardId).update({ activityLog: firebase.firestore.FieldValue.arrayUnion({ type, action: text, timestamp: new Date().toISOString(), user: auth.currentUser.email }) });
}

// Modal Close Handlers
document.getElementById('close-settings-btn').addEventListener('click', () => settingsModal.style.display = 'none');
document.getElementById('close-analytics-btn').addEventListener('click', () => analyticsModal.style.display = 'none');
document.getElementById('close-history-btn').addEventListener('click', () => historyModal.style.display = 'none');
document.getElementById('close-new-ticket-btn').addEventListener('click', () => document.getElementById('new-ticket-modal').style.display = 'none');
document.getElementById('close-add-card-btn').addEventListener('click', () => document.getElementById('add-card-modal').style.display = 'none');
document.getElementById('close-card-btn').addEventListener('click', () => { cardModal.style.display = 'none'; activeModalCardId = null; });

// ESC Key to close any modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
});

analyticsBtn.addEventListener('click', () => {
    closeAllModals();
    analyticsModal.style.display = 'flex';
    lucide.createIcons();
});

newTicketBtn.addEventListener('click', () => {
    closeAllModals();
    if(currentBoardType === 'helpdesk') {
        const colSelect = document.getElementById('nt_column');
        if(colSelect) colSelect.innerHTML = currentBoardColumns.map(c => `<option>${c}</option>`).join('');
        
        const catSelect = document.getElementById('nt_category');
        if(catSelect) catSelect.innerHTML = '<option value="">— Select Category —</option>' + currentBoardCategories.map(c => `<option>${c}</option>`).join('');
        
        document.getElementById('new-ticket-modal').style.display = 'flex';
    } else {
        const acColSelect = document.getElementById('ac_column');
        if(acColSelect) acColSelect.innerHTML = currentBoardColumns.map(c => `<option>${c}</option>`).join('');
        document.getElementById('add-card-modal').style.display = 'flex';
    }
    lucide.createIcons();
});

document.getElementById('submit-add-card-btn').addEventListener('click', async () => {
    const title = document.getElementById('ac_title').value.trim();
    if(!title) return;
    await db.collection('cards').add({
        boardId: activeBoardId,
        title,
        status: 'Incoming',
        createdAt: new Date().toISOString(),
        priority: document.getElementById('ac_priority').value
    });
    closeAllModals();
});

// Property Type Conditional Logic
document.getElementById('nt_property_type').addEventListener('change', (e) => {
    const type = e.target.value;
    document.getElementById('nt_warehouse_group').style.display = (type === 'warehouse') ? 'block' : 'none';
    document.getElementById('nt_openyard_group').style.display = (type === 'openyard') ? 'block' : 'none';
});

document.getElementById('submit-new-ticket-btn').addEventListener('click', async () => {
    const submitBtn = document.getElementById('submit-new-ticket-btn');
    const title    = document.getElementById('nt_title').value.trim();
    const name     = document.getElementById('nt_name').value.trim();
    const email    = document.getElementById('nt_email').value.trim();
    const phone    = document.getElementById('nt_phone').value.trim();
    const unit     = document.getElementById('nt_unit').value.trim();
    const category = document.getElementById('nt_category').value;
    const isUrgent = document.getElementById('nt_urgent_flag').checked;
    const notes    = document.getElementById('nt_notes').value.trim();
    const column   = document.getElementById('nt_column').value || currentBoardColumns[0];
    
    // New Dynamic Fields
    const propType = document.getElementById('nt_property_type').value;
    const whNo     = document.getElementById('nt_warehouse_no').value.trim();
    const opyNo    = document.getElementById('nt_opy_no').value.trim();

    if (!title) return alert('Please enter a Task / Issue Title.');

    submitBtn.disabled = true; submitBtn.innerText = 'Creating...';
    try {
        const counterRef = db.collection('counters').doc('tickets');
        const newNum = await db.runTransaction(async (tx) => {
            const counter = await tx.get(counterRef);
            const next = counter.exists ? (counter.data().count || 0) + 1 : 1;
            if (!counter.exists) tx.set(counterRef, { count: next });
            else tx.update(counterRef, { count: next });
            return next;
        });
        const ticketId = `EIC-TKT-${String(newNum).padStart(4, '0')}`;
        const now = new Date().toISOString();
        
        const formData = { 
            Tenant_Company: name, 
            Contact_Email: email, 
            Contact_Phone: phone, 
            Property_Type: propType,
            Unit_Number: unit,
            Category: category, 
            Urgent_Attention_Needed: isUrgent, 
            Notes: notes 
        };
        if(propType === 'warehouse') formData.Warehouse_Number = whNo;
        if(propType === 'openyard') formData.OPY_Number = opyNo;

        await db.collection('cards').add({
            boardId: activeBoardId,
            ticketId, title,
            requesterEmail: email || 'Admin Entry',
            status: column, createdAt: now,
            priority: 'Normal',
            isUrgentFlag: isUrgent,
            formData: formData,
            activityLog: [{ action: `Ticket manually logged by ${auth.currentUser?.email}${isUrgent ? ' (URGENT FLAG CHECKED)' : ''}`, timestamp: now, user: auth.currentUser?.email || 'Admin', type: 'system' }]
        });
        document.getElementById('new-ticket-modal').style.display = 'none';
        alert(`✅ Ticket ${ticketId} created!`);
    } catch(err) { alert('Failed: ' + err.message); }
    finally { submitBtn.disabled = false; submitBtn.innerText = 'Create Ticket'; }
});
