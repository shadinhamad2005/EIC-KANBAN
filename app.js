import { db, auth } from './firebase-init.js';
import { 
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  collection, onSnapshot, doc, updateDoc, setDoc, arrayUnion, addDoc, runTransaction, getDoc, getDocs, query, where, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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
let selectedBoardType = 'internal'; // for create-board modal

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
    loginBtn.innerText = isSignup ? 'Sign Up' : 'Log In';
    e.target.innerText = isSignup ? 'Log In instead' : 'Sign Up';
});

loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const errorMsg = document.getElementById('auth-error-msg');
    try {
        if (isSignup) await createUserWithEmailAndPassword(auth, email, password);
        else await signInWithEmailAndPassword(auth, email, password);
    } catch (error) { errorMsg.innerText = error.message; }
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        authOverlay.style.opacity = '0';
        setTimeout(() => authOverlay.style.display = 'none', 300);
        userEmailDisplay.innerText = user.email;
        settingsBtn.style.display = 'inline-block';
        analyticsBtn.style.display = 'inline-block';
        historyBtn.style.display = 'inline-block';
        newTicketBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'inline-block';
        globalSearch.style.display = 'inline-block';
        initWorkspace();
    } else {
        authOverlay.style.display = 'flex';
        setTimeout(() => authOverlay.style.opacity = '1', 10);
        userEmailDisplay.innerText = '';
        [settingsBtn, analyticsBtn, historyBtn, globalSearch, newTicketBtn, logoutBtn].forEach(el => el.style.display = 'none');
        if (unsubscribeCards) { unsubscribeCards(); unsubscribeCards = null; }
        if (unsubscribeSettings) { unsubscribeSettings(); unsubscribeSettings = null; }
        if (unsubscribeBoards) { unsubscribeBoards(); unsubscribeBoards = null; }
        boardContainer.innerHTML = '';
        document.getElementById('board-sidebar').innerHTML = '';
        allBoardsData = {}; allCardsData = {};
    }
});

// === Workspace Initialization ===
async function initWorkspace() {
    await seedDefaultBoards();
    
    // Auto-update Helpdesk if field is missing (Migrate existing board)
    const helpdeskRef = doc(db, 'boards', 'helpdesk');
    const snap = await getDoc(helpdeskRef);
    if (snap.exists()) {
        const data = snap.data();
        const hasUrgent = (data.formFields || []).some(f => f.id === 'f_urgent');
        if (!hasUrgent) {
            const updatedFields = [...(data.formFields || []), { id: "f_urgent", label: "Requires Urgent Attention (1-2 Hours)", type: "checkbox", options: ["Urgent"] }];
            await updateDoc(helpdeskRef, { formFields: updatedFields });
            // Also sync config for intake.js
            await updateDoc(doc(db, 'settings', 'config'), { formFields: updatedFields });
        }
    }

    initBoardsListener();
}

async function seedDefaultBoards() {
    const helpdeskRef = doc(db, 'boards', 'helpdesk');
    const maintenanceRef = doc(db, 'boards', 'maintenance');
    const [hdSnap, mSnap] = await Promise.all([getDoc(helpdeskRef), getDoc(maintenanceRef)]);
    
    // Seed Helpdesk board and migrate settings/config into it
    if (!hdSnap.exists()) {
        const cfgSnap = await getDoc(doc(db, 'settings', 'config'));
        const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
        await setDoc(helpdeskRef, {
            name: cfg.boardTitle || 'EIC Helpdesk',
            type: 'helpdesk',
            icon: '🎫',
            columns: cfg.boardColumns || ['Incoming', 'In Progress', 'On Hold', 'Done'],
            formFields: cfg.formFields || currentFormFields,
            createdAt: new Date().toISOString()
        });
    }
    // Seed Maintenance board
    if (!mSnap.exists()) {
        await setDoc(maintenanceRef, {
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
    unsubscribeBoards = onSnapshot(collection(db, 'boards'), (snap) => {
        allBoardsData = {};
        snap.forEach(d => { allBoardsData[d.id] = { id: d.id, ...d.data() }; });
        renderSidebar();
        // Always load the active board
        switchBoard(activeBoardId, true);
    });
}

function renderSidebar() {
    const sidebar = document.getElementById('board-sidebar');
    sidebar.innerHTML = '';
    Object.values(allBoardsData).forEach(board => {
        const btn = document.createElement('button');
        btn.className = 'sidebar-board-btn' + (board.id === activeBoardId ? ' active' : '');
        btn.innerHTML = DOMPurify.sanitize(`<span class="board-icon">${board.icon || '📋'}</span><span class="sidebar-label">${board.name}</span>`);
        btn.addEventListener('click', () => switchBoard(board.id));
        sidebar.appendChild(btn);
    });
    // Divider + Add Board button
    const divider = document.createElement('div');
    divider.className = 'sidebar-divider';
    const addBtn = document.createElement('button');
    addBtn.className = 'sidebar-board-btn';
    addBtn.innerHTML = `<span class="board-icon">➕</span><span class="sidebar-label">New Board</span>`;
    addBtn.addEventListener('click', () => { closeAllModals(); document.getElementById('create-board-modal').style.display = 'flex'; });
    sidebar.appendChild(divider);
    sidebar.appendChild(addBtn);
}

function switchBoard(boardId, force = false) {
    if (boardId === activeBoardId && !force) return;
    activeBoardId = boardId;
    const board = allBoardsData[boardId];
    if (!board) return;

    // Update state from board  
    currentBoardColumns = board.columns || ['Incoming', 'In Progress', 'Done'];
    currentBoardType = board.type || 'internal';
    currentFormFields = board.formFields || [];
    boardTitleDisplay.innerText = board.name;

    // Show/hide Form Builder button in settings based on type
    const formBuilderSection = document.querySelector('#settings-modal .modal-body > div:last-child');
    if (formBuilderSection) formBuilderSection.style.display = currentBoardType === 'helpdesk' ? '' : 'none';

    // Show/hide New Ticket vs Add Card button
    if (currentBoardType === 'helpdesk') {
        newTicketBtn.innerText = '📋 Log Ticket';
    } else {
        newTicketBtn.innerText = '➕ Add Card';
    }

    // Teardown old listener, rebuild layout, init new listener
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
                const updates = { status: toStatus, activityLog: arrayUnion({ type: 'status', action: `Moved from ${fromStatus} to ${toStatus}`, timestamp: now, user: auth.currentUser.email }) };
                if (toStatus === 'In Progress' && fromStatus !== 'In Progress') updates.startedAt = now;
                if (toStatus === 'Done') updates.completedAt = now;

                try { await updateDoc(doc(db, 'cards', cardId), updates); } 
                catch (err) { alert("Error moving card: " + err.message); }
            }
        });
    });
    distributeCards();
}

function initCardsListener() {
    unsubscribeCards = onSnapshot(collection(db, 'cards'), (snapshot) => {
        const oldDataKeys = Object.keys(allCardsData);

        snapshot.docChanges().forEach(change => {
            if (change.type === 'removed') delete allCardsData[change.doc.id];
        });

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;

            // Filter: only show cards for the active board
            const cardBoard = data.boardId || 'helpdesk';
            if (cardBoard !== activeBoardId) return;

            // Push Notification for new Incoming (helpdesk only)
            if (activeBoardId === 'helpdesk' && oldDataKeys.length > 0 && !allCardsData[id] && notificationsEnabled && data.status === 'Incoming') {
                new Notification("New Ticket Received!", { body: `${data.ticketId}: ${data.title}` });
            }

            // Client-Side Archival Sweep (30 Days)
            if (activeBoardId === 'helpdesk' && data.status === 'Done' && data.completedAt) {
                const daysOld = (new Date() - new Date(data.completedAt)) / (1000 * 60 * 60 * 24);
                if(daysOld > 30) {
                    (async () => {
                        try { await updateDoc(doc(db, 'cards', id), { status: 'Archived', archivedAt: new Date().toISOString() }); }
                        catch(e) { console.error("Archive sweep failed", e); }
                    })();
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

    // Priority Weights for sorting
    const prioWeight = { 'Urgent': 4, 'High': 3, 'Normal': 2, 'Low': 1 };
    const sortedCards = Object.values(allCardsData).sort((a, b) => {
        const weightA = prioWeight[a.priority || 'Normal'] || 2;
        const weightB = prioWeight[b.priority || 'Normal'] || 2;
        if (weightA !== weightB) return weightB - weightA;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    sortedCards.forEach(card => {
        if(card.status === 'Archived') return;

        // Search Filter
        const searchString = `${card.ticketId || ''} ${card.title || ''} ${card.requesterEmail || ''}`.toLowerCase();
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
            
            // --- NEW: PRIORITY STRIP ---
            const prioStrip = document.createElement('div');
            prioStrip.className = `card-prio-strip ${prioClass}`;
            cardEl.appendChild(prioStrip);

            // Show 🚨 if customer flagged as urgent
            const customerUrgent = card.isUrgentFlag || card.formData?.f_urgent?.includes('Urgent') || card.formData?.Urgent_Attention_Needed;
            if (customerUrgent) {
                const badge = document.createElement('div');
                badge.className = 'urgent-badge';
                badge.innerHTML = '🚨';
                badge.title = 'Customer Flagged as Urgent (1-2hr)';
                cardEl.appendChild(badge);
            }

            let slaClass = '';
            if (status === 'In Progress' && card.startedAt) {
                const hours = (new Date() - new Date(card.startedAt)) / (1000 * 60 * 60);
                if (hours > 48) slaClass = 'sla-danger';
                else if (hours > 24) slaClass = 'sla-warning';
            }
            if (slaClass) cardEl.classList.add(slaClass);

            const displayTitle = card.title || card.formData?.f_title || "Untitled";
            
            // Re-render rest of content safely
            const content = document.createElement('div');
            content.className = 'card-content';
            content.innerHTML = DOMPurify.sanitize(`
                ${card.ticketId ? `<div class="card-ticket">${card.ticketId}</div>` : ''}
                <div class="card-title">${displayTitle}</div>
                <div class="card-desc">${card.requesterEmail || 'No email provided'}</div>
            `);
            cardEl.appendChild(content);
            
            cardEl.addEventListener('click', () => openCardModal(card.id));
            if(listEl) listEl.appendChild(cardEl);
        });

        const countEl = document.getElementById(`count-${status}`);
        if(countEl) countEl.innerText = grouped[status].length;
    });
}

globalSearch.addEventListener('input', distributeCards);

// === Modals and Settings ===

const newFieldTypeSelect = document.getElementById('new-field-type');
const newFieldOptionsInput = document.getElementById('new-field-options');
const newFieldParentSelect = document.getElementById('new-field-condition-parent');
const conditionEqualsText = document.getElementById('condition-equals-text');
const conditionValueInput = document.getElementById('new-field-condition-value');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const addFieldBtn = document.getElementById('add-field-btn');

// Toggle advanced options when appropriate types are selected
newFieldTypeSelect.addEventListener('change', (e) => {
    const isChoice = ['select', 'radio', 'checkbox'].includes(e.target.value);
    newFieldOptionsInput.style.display = isChoice ? 'block' : 'none';
});

// Toggle condition value input when a parent is selected
newFieldParentSelect.addEventListener('change', (e) => {
    const hasParent = e.target.value !== '';
    conditionEqualsText.style.display = hasParent ? 'inline' : 'none';
    conditionValueInput.style.display = hasParent ? 'block' : 'none';
});

let builderSortableInstance = null;
settingsBtn.addEventListener('click', () => {
    document.getElementById('settings-board-title').value = boardTitleDisplay.innerText;
    document.getElementById('settings-board-columns').value = currentBoardColumns.join(', ');
    renderBuilderList();
    
    if(!builderSortableInstance) {
        builderSortableInstance = new Sortable(document.getElementById('builder-fields-list'), {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: function (evt) {
                const temp = currentFormFields.splice(evt.oldIndex, 1)[0];
                currentFormFields.splice(evt.newIndex, 0, temp);
                renderBuilderList();
            }
        });
    }


    closeAllModals();
    settingsModal.style.display = 'flex';
});

function closeAllModals() {
    const modals = [
        settingsModal, analyticsModal, historyModal, cardModal,
        document.getElementById('new-ticket-modal'),
        document.getElementById('add-card-modal'),
        document.getElementById('create-board-modal')
    ];
    modals.forEach(m => {
        if(m) m.style.display = 'none';
    });
}

// Click outside to close
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay') && e.target.id !== 'auth-overlay') {
        closeAllModals();
        if (activeModalCardId) activeModalCardId = null;
    }
});

document.getElementById('close-settings-btn').addEventListener('click', () => settingsModal.style.display = 'none');

function renderBuilderList() {
    const list = document.getElementById('builder-fields-list');
    list.innerHTML = '';
    
    // Update condition parent dropdown
    newFieldParentSelect.innerHTML = '<option value="">Always Show (No Condition)</option>';
    
    currentFormFields.forEach((field, index) => {
        // Add to condition dropdown
        newFieldParentSelect.innerHTML += `<option value="${field.id}">${field.label}</option>`;
        
        let metaHtml = `<small style="color:var(--accent-color);">(${field.type})</small>`;
        if (field.required) metaHtml += ` <small style="color:var(--danger-color); font-weight:bold;">[Required]</small>`;
        if (field.options && field.options.length > 0) metaHtml += ` <br><small>Options: ${field.options.join(', ')}</small>`;
        if (field.condition && field.condition.dependsOn) {
            const parentField = currentFormFields.find(f => f.id === field.condition.dependsOn);
            const parentName = parentField ? parentField.label : field.condition.dependsOn;
            metaHtml += `<br><small style="color:var(--warning-color);">Condition: If '${parentName}' equals '${field.condition.value}'</small>`;
        }
        
        list.innerHTML += DOMPurify.sanitize(`<div class="builder-item" data-id="${field.id}" style="cursor: grab;"><span><strong>☰ ${field.label}</strong> ${metaHtml}</span><div><button onclick="window.editField('${field.id}')" style="margin-right: 5px; background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; cursor: pointer;">Edit</button><button onclick="window.removeField('${field.id}')" style="background: transparent; border: 1px solid var(--danger-color); color: var(--danger-color); padding: 4px 8px; border-radius: 4px; cursor: pointer;">Remove</button></div></div>`);
    });
}
window.removeField = function(id) { 
    currentFormFields = currentFormFields.filter(f => f.id !== id); 
    if(editingFieldId === id) cancelEditBtn.click();
    renderBuilderList(); 
}
window.editField = function(id) {
    const field = currentFormFields.find(f => f.id === id);
    if(!field) return;
    editingFieldId = id;
    document.getElementById('new-field-label').value = field.label;
    document.getElementById('new-field-type').value = field.type;
    document.getElementById('new-field-options').value = (field.options || []).join(', ');
    const reqCheckbox = document.getElementById('new-field-required');
    if(reqCheckbox) reqCheckbox.checked = !!field.required;
    
    // Toggle options visibility manually
    newFieldOptionsInput.style.display = ['select', 'radio', 'checkbox'].includes(field.type) ? 'block' : 'none';
    
    if(field.condition && field.condition.dependsOn) {
        document.getElementById('new-field-condition-parent').value = field.condition.dependsOn;
        document.getElementById('new-field-condition-value').value = field.condition.value;
        conditionEqualsText.style.display = 'inline';
        conditionValueInput.style.display = 'block';
    } else {
        document.getElementById('new-field-condition-parent').value = '';
        document.getElementById('new-field-condition-value').value = '';
        conditionEqualsText.style.display = 'none';
        conditionValueInput.style.display = 'none';
    }
    
    addFieldBtn.innerText = 'Update Field Structure';
    cancelEditBtn.style.display = 'inline-block';
}
if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
        editingFieldId = null;
        document.getElementById('new-field-label').value = ''; 
        document.getElementById('new-field-options').value = '';
        document.getElementById('new-field-condition-parent').value = '';
        document.getElementById('new-field-condition-value').value = '';
        conditionEqualsText.style.display = 'none';
        conditionValueInput.style.display = 'none';
        const reqCheckbox = document.getElementById('new-field-required');
        if(reqCheckbox) reqCheckbox.checked = false;
        if (addFieldBtn) addFieldBtn.innerText = 'Add Field Structure';
        cancelEditBtn.style.display = 'none';
    });
}

if (addFieldBtn) {
    addFieldBtn.addEventListener('click', () => {
        const label = document.getElementById('new-field-label').value;
        const type = document.getElementById('new-field-type').value;
        const optionsRaw = document.getElementById('new-field-options').value;
        
        const conditionParent = document.getElementById('new-field-condition-parent').value;
        const conditionValue = document.getElementById('new-field-condition-value').value;
        const reqCheckbox = document.getElementById('new-field-required');
        const isRequired = reqCheckbox ? reqCheckbox.checked : false;
        
        if(!label) return;
        
        let options = [];
        if(['select', 'radio', 'checkbox'].includes(type) && optionsRaw) {
            options = optionsRaw.split(',').map(s => s.trim()).filter(s => s);
        }
        
        let condition = null;
        if(conditionParent && conditionValue) {
            condition = { dependsOn: conditionParent, value: conditionValue };
        }
        
        if(editingFieldId) {
            const fieldIndex = currentFormFields.findIndex(f => f.id === editingFieldId);
            if(fieldIndex > -1) {
                currentFormFields[fieldIndex] = {
                    ...currentFormFields[fieldIndex],
                    label, type, options, condition, required: isRequired
                };
            }
        } else {
            currentFormFields.push({ 
                id: "f_" + Math.random().toString(36).substr(2, 5), 
                label, type, required: isRequired, options, condition
            });
        }
        
        if (cancelEditBtn) cancelEditBtn.click(); // reuses the reset logic!
        renderBuilderList();
    });
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const title = document.getElementById('settings-board-title').value;
    const cols = document.getElementById('settings-board-columns').value.split(',').map(s=>s.trim()).filter(s=>s);
    try {
        // Save to the active board's document
        await setDoc(doc(db, 'boards', activeBoardId), { name: title, columns: cols, formFields: currentFormFields }, { merge: true });
        // Also keep settings/config in sync for the helpdesk board (intake portal reads from it)
        if (activeBoardId === 'helpdesk') {
            await setDoc(doc(db, 'settings', 'config'), { boardTitle: title, boardColumns: cols, formFields: currentFormFields }, { merge: true });
        }
        settingsModal.style.display = 'none';
        alert("Configuration saved successfully.");
    } catch(err) { alert("Failed to save: " + err.message); }
});

document.getElementById('delete-board-btn').addEventListener('click', async () => {
    // Safety check: Prevent deleting system boards
    if (activeBoardId === 'helpdesk') {
        return alert("The 'EIC Helpdesk' board is the system's primary workspace and cannot be deleted. You can rename it or change its columns, but the database requires it to remain active for the intake portal.");
    }
    if (activeBoardId === 'maintenance') {
        return alert("The 'Maintenance' board is a core system-default board. If you don't need it, you can rename it for another purpose, but it cannot be deleted at this time.");
    }

    const board = allBoardsData[activeBoardId];
    if (!board) return;

    const confirmDelete = confirm(`⚠️ DANGER: Are you sure you want to delete the board "${board.name}" and ALL its cards?\n\nThis action cannot be undone.`);
    
    if (confirmDelete) {
        try {
            // --- CLEANUP: Delete all cards associated with this board ---
            const cardsRef = collection(db, 'cards');
            const q = query(cardsRef, where("boardId", "==", activeBoardId));
            const cardsSnap = await getDocs(q);
            const deletePromises = [];
            cardsSnap.forEach(d => deletePromises.push(deleteDoc(doc(db, 'cards', d.id))));
            await Promise.all(deletePromises);

            await deleteDoc(doc(db, 'boards', activeBoardId));
            settingsModal.style.display = 'none';
            alert(`✅ Board "${board.name}" and its ${deletePromises.length} cards have been deleted.`);
            switchBoard('helpdesk');
        } catch (err) {
            alert("Failed to delete board: " + err.message);
        }
    }
});

document.getElementById('delete-card-icon-btn').addEventListener('click', async () => {
    if (!activeModalCardId) return;
    const card = allCardsData[activeModalCardId];
    if (!card) return;

    const confirmDelete = confirm(`🗑️ Permanently delete card "${card.title || card.ticketId || 'this task'}"?\n\nThis action cannot be undone.`);
    
    if (confirmDelete) {
        console.log(`[DELETION] Attempting to delete card: ${activeModalCardId} (${card.ticketId})`);
        try {
            await deleteDoc(doc(db, 'cards', activeModalCardId));
            console.log(`[DELETION] Successfully deleted card: ${activeModalCardId}`);
            cardModal.style.display = 'none';
            activeModalCardId = null;
            // No need to alert, the real-time listener will remove it from UI
        } catch (err) {
            console.error(`[DELETION] FAILED to delete card: ${activeModalCardId}`, err);
            alert("Failed to delete card: " + err.message);
        }
    }
});

document.getElementById('modal-priority-select').addEventListener('change', async (e) => {
    if (!activeModalCardId) return;
    const newPrio = e.target.value;
    try {
        await updateDoc(doc(db, 'cards', activeModalCardId), { priority: newPrio });
    } catch (err) {
        alert("Failed to update priority: " + err.message);
        // revert UI if failed
        e.target.value = allCardsData[activeModalCardId]?.priority || 'Normal';
    }
});

document.getElementById('export-csv-btn').addEventListener('click', () => {
    const cards = Object.values(allCardsData);
    if(cards.length === 0) return alert('No data to export.');
    
    const dynamicHeaders = new Set();
    cards.forEach(c => {
        if(c.formData) Object.keys(c.formData).forEach(k => dynamicHeaders.add(k));
    });
    
    const headers = ['Ticket ID', 'Title', 'Requester Email', 'Status', 'Created At', 'Started At', 'Completed At', 'Archived At'];
    const dynamicHeaderArr = Array.from(dynamicHeaders);
    
    dynamicHeaderArr.forEach(headerKey => {
        const configField = currentFormFields.find(f => f.id === headerKey);
        headers.push(configField ? configField.label : headerKey);
    });

    let csvContent = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n';
    
    cards.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(c => {
        const row = [
            c.ticketId || '',
            c.title || '',
            c.requesterEmail || '',
            c.status || '',
            c.createdAt ? new Date(c.createdAt).toLocaleString() : '',
            c.startedAt ? new Date(c.startedAt).toLocaleString() : '',
            c.completedAt ? new Date(c.completedAt).toLocaleString() : '',
            c.archivedAt ? new Date(c.archivedAt).toLocaleString() : ''
        ];
        
        dynamicHeaderArr.forEach(headerKey => {
            let val = (c.formData || {})[headerKey] || '';
            if(Array.isArray(val)) val = val.join(', ');
            row.push(val);
        });
        
        csvContent += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `EIC_Helpdesk_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// === Card Detail Modal ===
function openCardModal(cardId) {
    closeAllModals();
    activeModalCardId = cardId;
    const card = allCardsData[cardId];
    if(!card) return;

    // Set priority selector
    document.getElementById('modal-priority-select').value = card.priority || 'Normal';

    document.getElementById('modal-ticket-id').innerText = card.ticketId || "Helpdesk Ticket";
    const fieldsDiv = document.getElementById('modal-dynamic-fields');
    fieldsDiv.innerHTML = `<h3 style="margin-bottom: 15px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">Submission Details</h3>`;
    
    let attachmentURL = null;

    if(card.formData) {
        for(const [key, val] of Object.entries(card.formData)) {
            const configField = currentFormFields.find(f => f.id === key);
            
            // Check if field is configured as a file, OR if the raw value happens to be a Base64 image
            if((configField && configField.type === 'file') || (typeof val === 'string' && val.startsWith('data:image'))) {
                attachmentURL = val; continue; 
            }
            
            const label = configField ? configField.label : key;
            
            // Format Array (e.g. from Checkboxes) into a legible string instead of raw json
            let contentString = val;
            if (Array.isArray(val)) {
                contentString = val.join(', ');
            }
            
            // Failsafe: if a string is insanely long but doesn't start with data:image, truncate it so it never lags the UI
            const displayVal = (typeof contentString === 'string' && contentString.length > 1000) ? '[Massive Data Payload Omitted]' : (contentString || '<em>Empty</em>');
            fieldsDiv.innerHTML += DOMPurify.sanitize(`<div class="field-display"><label>${label}</label><div class="val" style="word-break: break-all;">${displayVal}</div></div>`);
        }
    } else fieldsDiv.innerHTML += `<p class="helper-text">No dynamic data</p>`;
    fieldsDiv.innerHTML += DOMPurify.sanitize(`<div class="field-display" style="margin-top:20px;"><label>Status</label><div class="val" style="color:var(--accent-color); font-weight:600;">${card.status}</div></div>`);

    // Render Attachment
    const attZone = document.getElementById('modal-attachment-zone');
    if(attachmentURL && (attachmentURL.startsWith('http') || attachmentURL.startsWith('data:image'))) {
        attZone.style.display = 'block';
        
        const linkEl = document.getElementById('modal-attachment-link');
        const imgEl = document.getElementById('modal-attachment-img');
        const textEl = document.getElementById('modal-attachment-text');
        
        imgEl.src = attachmentURL;
        imgEl.style.display = 'block';
        linkEl.href = attachmentURL;
        
        // Browsers block opening Base64 images in new tabs for security. 
        // We bypass this by forcing a local download to their computer.
        if (attachmentURL.startsWith('data:image')) {
            linkEl.setAttribute('download', `Helpdesk_Image_${card.ticketId}.jpg`);
            linkEl.removeAttribute('target');
            textEl.innerText = "Click to Download Image";
        } else {
            linkEl.removeAttribute('download');
            linkEl.setAttribute('target', '_blank');
            textEl.innerText = "Open External File";
        }
    } else {
        attZone.style.display = 'none';
        document.getElementById('modal-attachment-img').src = '';
    }

    // Markdown Timeline
    const timelineDiv = document.getElementById('modal-timeline');
    timelineDiv.innerHTML = '';
    const logs = card.activityLog || [];
    logs.forEach(log => {
        let isNote = log.type === 'note';
        let bgStyle = isNote ? 'background: rgba(88, 166, 255, 0.15); border-left: 3px solid var(--accent-color)' : '';
        let content = isNote ? marked.parse(log.action) : log.action;
        timelineDiv.innerHTML += DOMPurify.sanitize(`<div class="timeline-event" style="${bgStyle}"><div class="meta">${new Date(log.timestamp).toLocaleString()} • ${log.user}</div><div class="${isNote ? 'markdown-body' : ''}">${content}</div></div>`);
    });

    document.getElementById('action-email-btn').onclick = () => {
        let recipient = card.requesterEmail;

        // Fallback: scan form fields by ID or label for an email address
        if (!recipient || recipient === 'Unknown') {
            recipient = card.formData?.f_email;
        }
        if (!recipient || recipient === 'Unknown') {
            for (const key in (card.formData || {})) {
                const configField = currentFormFields.find(f => f.id === key);
                const labelLower = (configField?.label || '').toLowerCase();
                if (labelLower.includes('email') || labelLower.includes('e-mail') || key.toLowerCase().includes('email')) {
                    recipient = card.formData[key]; break;
                }
            }
        }

        if (!recipient || recipient === 'Unknown') return alert("No email address found on this ticket.");
        const subject = encodeURIComponent(`Re: Your Request [${card.ticketId || 'Ticket'}]`);
        const body = encodeURIComponent(
`Dear Requester,

Thank you for reaching out to us.

We have received your support ticket (${card.ticketId}) and our team is currently reviewing your request. We will keep you updated on the progress.

If you have any additional information to share, please do not hesitate to reply.

Best regards,
EIC Helpdesk Team`
        );
        logAction(cardId, `Sent Email Acknowledgment to ${recipient}`);
        window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
    };

    document.getElementById('action-whatsapp-btn').onclick = () => {
        let phone = card.formData?.f_phone;

        if (!phone && card.formData) {
            for (const key in card.formData) {
                const configField = currentFormFields.find(f => f.id === key);
                const labelLower = (configField?.label || '').toLowerCase();
                const keyLower = key.toLowerCase();
                if (keyLower.includes('phone') || keyLower.includes('whatsapp') ||
                    labelLower.includes('phone') || labelLower.includes('mobile') ||
                    labelLower.includes('whatsapp') || labelLower.includes('contact')) {
                    phone = card.formData[key]; break;
                }
            }
        }

        if (!phone) return alert("No phone number found on this ticket. Make sure your form has a field with 'Phone' or 'Mobile' in its label.");
        
        // === Smart UAE (+971) Phone Normalizer ===
        // Strip everything except digits and leading +
        let digitsOnly = phone.replace(/[^0-9]/g, '');

        // Already has full UAE country code: 971XXXXXXXXX
        if (digitsOnly.startsWith('971') && digitsOnly.length >= 11) {
            // Good as-is
        }
        // Local UAE format starting with 0: 05XXXXXXXX → strip leading 0, add 971
        else if (digitsOnly.startsWith('0') && digitsOnly.length === 10) {
            digitsOnly = '971' + digitsOnly.slice(1);
        }
        // Just the local number without 0: 5XXXXXXXX (9 digits, UAE mobile starts with 5)
        else if (digitsOnly.startsWith('5') && digitsOnly.length === 9) {
            digitsOnly = '971' + digitsOnly;
        }
        // Anything else (e.g. landlines or numbers from other countries)
        else if (!digitsOnly.startsWith('971')) {
            digitsOnly = '971' + digitsOnly;
        }
        
        const draftMsg = 
`Hello,

We have received your support request (${card.ticketId}) and our team is currently working on it.

We will get back to you shortly with an update.

Thank you,
EIC Helpdesk Team`;

        logAction(cardId, `Initiated WhatsApp Update to +${digitsOnly}`);
        window.open(`https://wa.me/${digitsOnly}?text=${encodeURIComponent(draftMsg)}`, '_blank');
    };

    cardModal.style.display = 'flex';
}

document.getElementById('close-card-btn').addEventListener('click', () => { cardModal.style.display = 'none'; activeModalCardId = null; });
document.getElementById('add-note-btn').addEventListener('click', async () => {
    if(!activeModalCardId) return;
    const text = document.getElementById('note-input').value.trim();
    if(!text) return;
    document.getElementById('note-input').disabled = true;
    try { await logAction(activeModalCardId, text, 'note'); document.getElementById('note-input').value = ''; } 
    catch(e) { alert("Failed to save note"); } 
    finally { document.getElementById('note-input').disabled = false; }
});
async function logAction(cardId, actionText, type = 'system') {
    return updateDoc(doc(db, 'cards', cardId), { activityLog: arrayUnion({ type: type, action: actionText, timestamp: new Date().toISOString(), user: auth.currentUser.email }) });
}

// === Analytics & History Modals ===
analyticsBtn.addEventListener('click', () => {
    closeAllModals();
    let t_active = 0, t_sla = 0, t_done = 0, sum_hours = 0;
    const statusCounts = {};

    Object.values(allCardsData).forEach(card => {
        if(card.status !== 'Archived') t_active++;
        if(card.status === 'In Progress' && card.startedAt && ((new Date() - new Date(card.startedAt)) / 3600000) > 48) t_sla++;
        
        statusCounts[card.status] = (statusCounts[card.status] || 0) + 1;

        if((card.status === 'Done' || card.status === 'Archived') && card.startedAt && card.completedAt) {
            t_done++;
            sum_hours += ((new Date(card.completedAt) - new Date(card.startedAt)) / 3600000);
        }
    });

    document.getElementById('stat-total').innerText = t_active;
    document.getElementById('stat-sla').innerText = t_sla;
    document.getElementById('stat-avg').innerText = t_done > 0 ? (sum_hours/t_done).toFixed(1) + 'h' : '0h';

    if(chartInstance) chartInstance.destroy();
    chartInstance = new Chart(document.getElementById('metricsChart'), {
        type: 'doughnut',
        data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#58a6ff', '#d29922', '#2ea043', '#8b949e'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins:{ legend:{ position: 'right', labels:{color:'#fff'} } } }
    });
    analyticsModal.style.display = 'flex';
});
document.getElementById('close-analytics-btn').addEventListener('click', () => analyticsModal.style.display = 'none');

historyBtn.addEventListener('click', () => {
    closeAllModals();
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    const archived = Object.values(allCardsData).filter(c => c.status === 'Archived').sort((a,b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
    
    archived.forEach(card => {
        let daysToComplete = "-";
        if(card.startedAt && card.completedAt) daysToComplete = ((new Date(card.completedAt) - new Date(card.startedAt)) / 86400000).toFixed(1);
        tbody.innerHTML += DOMPurify.sanitize(`<tr><td>${card.ticketId}</td><td>${card.title}</td><td>${card.requesterEmail}</td><td>${daysToComplete}</td><td>${new Date(card.archivedAt).toLocaleDateString()}</td></tr>`);
    });
    historyModal.style.display = 'flex';
});
document.getElementById('close-history-btn').addEventListener('click', () => historyModal.style.display = 'none');

// === Manual New Ticket / Add Card Manager ===
const newTicketModal = document.getElementById('new-ticket-modal');
const addCardModal = document.getElementById('add-card-modal');

newTicketBtn.addEventListener('click', () => {
    closeAllModals();
    
    // Route to different forms based on current board type
    if (activeBoardId === 'helpdesk') {
        const colSelect = document.getElementById('nt_column');
        colSelect.innerHTML = currentBoardColumns.map(c => `<option value="${c}">${c}</option>`).join('');
        ['nt_title','nt_name','nt_email','nt_phone','nt_unit','nt_notes'].forEach(id => {
            const el = document.getElementById(id); if(el) el.value = '';
        });
        const isUrgentEl = document.getElementById('nt_urgent_flag');
        if(isUrgentEl) isUrgentEl.checked = false;
        newTicketModal.style.display = 'flex';
    } else {
        // Internal/Simple form for maintenance and other boards
        const colSelect = document.getElementById('ac_column');
        colSelect.innerHTML = currentBoardColumns.map(c => `<option value="${c}">${c}</option>`).join('');
        document.getElementById('ac_title').value = '';
        document.getElementById('ac_notes').value = '';
        document.getElementById('ac_priority').value = 'Normal';
        addCardModal.style.display = 'flex';
    }
});

document.getElementById('close-new-ticket-btn').addEventListener('click', () => newTicketModal.style.display = 'none');
document.getElementById('close-add-card-btn').addEventListener('click', () => addCardModal.style.display = 'none');

// Logic for Internal Card Submission
document.getElementById('submit-add-card-btn').addEventListener('click', async () => {
    const title = document.getElementById('ac_title').value.trim();
    const notes = document.getElementById('ac_notes').value.trim();
    const column = document.getElementById('ac_column').value || currentBoardColumns[0];
    const submitBtn = document.getElementById('submit-add-card-btn');

    if (!title) return alert('Please enter a card title.');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Adding...';

    try {
        const now = new Date().toISOString();
        const priority = document.getElementById('ac_priority').value;
        await addDoc(collection(db, 'cards'), {
            boardId: activeBoardId,
            title,
            priority,
            status: column,
            createdAt: now,
            formData: { Notes: notes },
            activityLog: [{ action: `Note created in board: ${activeBoardId} with ${priority} priority`, timestamp: now, user: auth.currentUser?.email || 'Admin', type: 'system' }]
        });
        addCardModal.style.display = 'none';
    } catch(err) {
        alert('Failed to add card: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '✅ Add Card';
    }
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

    if (!title) return alert('Please enter a Task / Issue Title.');

    submitBtn.disabled = true; submitBtn.innerText = 'Creating...';
    try {
        const counterRef = doc(db, 'counters', 'tickets');
        const newNum = await runTransaction(db, async (tx) => {
            const counter = await tx.get(counterRef);
            const next = counter.exists() ? (counter.data().count || 0) + 1 : 1;
            if (!counter.exists()) tx.set(counterRef, { count: next });
            else tx.update(counterRef, { count: next });
            return next;
        });
        const ticketId = `EIC-TKT-${String(newNum).padStart(4, '0')}`;
        const now = new Date().toISOString();
        await addDoc(collection(db, 'cards'), {
            boardId: activeBoardId, // Tag with the board ID!
            ticketId, title,
            requesterEmail: email || 'Admin Entry',
            status: column, createdAt: now,
            priority: 'Normal', // Defaults to Normal; Admin can change in modal
            isUrgentFlag: isUrgent,
            formData: { Contact_Name: name, Contact_Email: email, Contact_Phone: phone, Unit_Location: unit, Category: category, Urgent_Attention_Needed: isUrgent, Notes: notes },
            activityLog: [{ action: `Ticket manually logged by ${auth.currentUser?.email}${isUrgent ? ' (URGENT FLAG CHECKED)' : ''}`, timestamp: now, user: auth.currentUser?.email || 'Admin', type: 'system' }]
        });
        newTicketModal.style.display = 'none';
        alert(`✅ Ticket ${ticketId} created and placed in '${column}'!`);
    } catch(err) { alert('Failed to create ticket: ' + err.message); }
    finally { submitBtn.disabled = false; submitBtn.innerText = '🚀 Create Ticket'; }
});

// === Create Board Logic ===
const createBoardModal = document.getElementById('create-board-modal');
const boardTypeCards = document.querySelectorAll('.board-type-card');

boardTypeCards.forEach(card => {
    card.addEventListener('click', () => {
        boardTypeCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedBoardType = card.dataset.type;
        
        // Auto-fill suggested columns based on type
        const colInput = document.getElementById('cb_columns');
        if (selectedBoardType === 'helpdesk') colInput.value = 'Incoming, In Progress, On Hold, Done';
        else if (selectedBoardType === 'project') colInput.value = 'Backlog, In Progress, Quality Check, Done';
        else colInput.value = 'To Do, In Progress, Done';
    });
});

document.getElementById('close-create-board-btn').addEventListener('click', () => createBoardModal.style.display = 'none');

document.getElementById('submit-create-board-btn').addEventListener('click', async () => {
    const name = document.getElementById('cb_name').value.trim();
    const cols = document.getElementById('cb_columns').value.split(',').map(s => s.trim()).filter(s => s);
    const submitBtn = document.getElementById('submit-create-board-btn');

    if (!name) return alert('Please enter a board name.');
    if (cols.length === 0) return alert('Please enter at least one column.');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating...';

    try {
        const boardId = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.random().toString(36).substring(2, 6);
        const icon = selectedBoardType === 'helpdesk' ? '🎫' : 
                     selectedBoardType === 'project' ? '📁' : 
                     selectedBoardType === 'internal' ? '🔧' : '⚙️';

        await setDoc(doc(db, 'boards', boardId), {
            name,
            type: selectedBoardType,
            icon,
            columns: cols,
            formFields: selectedBoardType === 'helpdesk' ? [{ id: "f_title", label: "Task Title *", type: "text", required: true }] : [],
            createdAt: new Date().toISOString()
        });

        createBoardModal.style.display = 'none';
        alert(`✅ Board "${name}" created!`);
        switchBoard(boardId);
    } catch(err) {
        alert('Failed to create board: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '🚀 Create Board';
    }
});


