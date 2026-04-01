import { db, auth } from './firebase-init.js';
import { 
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  collection, onSnapshot, doc, updateDoc, setDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import Sortable from "https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/modular/sortable.esm.js";

// === Core DOM Elements ===
const authOverlay = document.getElementById('auth-overlay');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const settingsBtn = document.getElementById('settings-btn');
const analyticsBtn = document.getElementById('analytics-btn');
const historyBtn = document.getElementById('history-btn');
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
let currentBoardColumns = ['Incoming', 'In Progress', 'Done'];
let currentFormFields = [
    { id: "f_title", label: "Task Title *", type: "text", required: true },
    { id: "f_email", label: "Contact Email", type: "email", required: true },
    { id: "f_phone", label: "Phone Number", type: "text", required: false }
];
let allCardsData = {}; 
let activeModalCardId = null;
let chartInstance = null;
let editingFieldId = null;

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
        globalSearch.style.display = 'inline-block';
        initWorkspace();
    } else {
        authOverlay.style.display = 'flex';
        setTimeout(() => authOverlay.style.opacity = '1', 10);
        userEmailDisplay.innerText = '';
        [settingsBtn, analyticsBtn, historyBtn, globalSearch].forEach(el => el.style.display = 'none');
        if (unsubscribeCards) unsubscribeCards();
        if (unsubscribeSettings) unsubscribeSettings();
        boardContainer.innerHTML = '';
    }
});

// === Workspace Initialization ===
function initWorkspace() {
    unsubscribeSettings = onSnapshot(doc(db, 'settings', 'config'), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            if (data.boardTitle) boardTitleDisplay.innerText = data.boardTitle;
            if (data.boardColumns) currentBoardColumns = data.boardColumns;
            if (data.formFields) currentFormFields = data.formFields;
        }
        renderBoardLayout();
        if (!unsubscribeCards) initCardsListener();
    });
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
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            
            // Push Notification for brand new Incoming docs
            if(!oldDataKeys.length && notificationsEnabled && data.status === 'Incoming' && data.createdAt) {} // Skip initial load
            else if(oldDataKeys.length > 0 && !allCardsData[id] && notificationsEnabled && data.status === 'Incoming') {
                new Notification("New Ticket Received!", { body: `${data.ticketId}: ${data.title}` });
            }

            // Client-Side Archival Sweep (30 Days check on Done cards)
            if(data.status === 'Done' && data.completedAt) {
                const daysOld = (new Date() - new Date(data.completedAt)) / (1000 * 60 * 60 * 24);
                if(daysOld > 30) {
                    try {
                        updateDoc(doc(db, 'cards', id), { 
                            status: 'Archived', 
                            archivedAt: new Date().toISOString() 
                        });
                    } catch(e) { console.error("Archive sweep failed", e); }
                    return; // Let the next snapshot catch it
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

    Object.values(allCardsData).forEach(card => {
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
            
            let slaClass = '';
            if (status === 'In Progress' && card.startedAt) {
                const hours = (new Date() - new Date(card.startedAt)) / (1000 * 60 * 60);
                if (hours > 48) slaClass = 'sla-danger';
                else if (hours > 24) slaClass = 'sla-warning';
            }
            if (slaClass) cardEl.classList.add(slaClass);

            const displayTitle = card.title || card.formData?.f_title || "Untitled";
            
            cardEl.innerHTML = `
                ${card.ticketId ? `<div class="card-ticket">${card.ticketId}</div>` : ''}
                <div class="card-title">${displayTitle}</div>
                <div class="card-desc">${card.requesterEmail || 'No email provided'}</div>
            `;
            
            cardEl.addEventListener('click', () => openCardModal(card.id));
            if(listEl) listEl.appendChild(cardEl);
        });

        const countEl = document.getElementById(`count-${status}`);
        if(countEl) countEl.innerText = grouped[status].length;
    });
}

globalSearch.addEventListener('input', distributeCards);

// === Modals and Settings ===
let qrCodeInstance = null;
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

    if (!qrCodeInstance) {
        const portalUrl = window.location.href.replace(/index\.html$|\/$/, '') + (window.location.href.endsWith('/') ? '' : '/') + 'intake.html';
        qrCodeInstance = new QRCode(document.getElementById("settings-qrcode"), { text: portalUrl, width: 128, height: 128, colorDark : "#0d1117", colorLight : "#ffffff" });
    }
    settingsModal.style.display = 'flex';
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
        if (field.options && field.options.length > 0) metaHtml += ` <br><small>Options: ${field.options.join(', ')}</small>`;
        if (field.condition && field.condition.dependsOn) {
            const parentField = currentFormFields.find(f => f.id === field.condition.dependsOn);
            const parentName = parentField ? parentField.label : field.condition.dependsOn;
            metaHtml += `<br><small style="color:var(--warning-color);">Condition: If '${parentName}' equals '${field.condition.value}'</small>`;
        }
        
        list.innerHTML += `<div class="builder-item" data-id="${field.id}" style="cursor: grab;"><span><strong>☰ ${field.label}</strong> ${metaHtml}</span><div><button onclick="window.editField('${field.id}')" style="margin-right: 5px; background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; cursor: pointer;">Edit</button><button onclick="window.removeField('${field.id}')" style="background: transparent; border: 1px solid var(--danger-color); color: var(--danger-color); padding: 4px 8px; border-radius: 4px; cursor: pointer;">Remove</button></div></div>`;
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
                    label, type, options, condition
                };
            }
        } else {
            currentFormFields.push({ 
                id: "f_" + Math.random().toString(36).substr(2, 5), 
                label, type, required: false, options, condition
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
        await setDoc(doc(db, 'settings', 'config'), { boardTitle: title, boardColumns: cols, formFields: currentFormFields }, { merge: true });
        settingsModal.style.display = 'none';
        alert("Configuration saved successfully.");
    } catch(err) { alert("Failed to save: " + err.message); }
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
    activeModalCardId = cardId;
    const card = allCardsData[cardId];
    if(!card) return;

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
            fieldsDiv.innerHTML += `<div class="field-display"><label>${label}</label><div class="val" style="word-break: break-all;">${displayVal}</div></div>`;
        }
    } else fieldsDiv.innerHTML += `<p class="helper-text">No dynamic data</p>`;
    fieldsDiv.innerHTML += `<div class="field-display" style="margin-top:20px;"><label>Status</label><div class="val" style="color:var(--accent-color); font-weight:600;">${card.status}</div></div>`;

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
        timelineDiv.innerHTML += `<div class="timeline-event" style="${bgStyle}"><div class="meta">${new Date(log.timestamp).toLocaleString()} • ${log.user}</div><div class="${isNote ? 'markdown-body' : ''}">${content}</div></div>`;
    });

    document.getElementById('action-email-btn').onclick = () => {
        const recipient = card.requesterEmail || card.formData?.f_email;
        if(!recipient || recipient==="Unknown") return alert("No email available.");
        const subject = encodeURIComponent(`Re: Your Request [${card.ticketId || 'Updates'}]`);
        const body = encodeURIComponent(`Hello,\n\nWe have received ticket (${card.ticketId}) and are processing it.\n\nThank you.`);
        logAction(cardId, `Sent Email Acknowledgment to ${recipient}`);
        window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
    };

    document.getElementById('action-whatsapp-btn').onclick = () => {
        let phone = card.formData?.f_phone;
        if(!phone) for(let key in card.formData) if(key.toLowerCase().includes('phone')||key.toLowerCase().includes('whatsapp')) { phone=card.formData[key]; break; }
        if(!phone) return alert("No phone found.");
        logAction(cardId, `Initiated WhatsApp Update to ${phone}`);
        window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hello regarding ticket ' + card.ticketId)}`, '_blank');
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
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    const archived = Object.values(allCardsData).filter(c => c.status === 'Archived').sort((a,b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
    
    archived.forEach(card => {
        let daysToComplete = "-";
        if(card.startedAt && card.completedAt) daysToComplete = ((new Date(card.completedAt) - new Date(card.startedAt)) / 86400000).toFixed(1);
        tbody.innerHTML += `<tr><td>${card.ticketId}</td><td>${card.title}</td><td>${card.requesterEmail}</td><td>${daysToComplete}</td><td>${new Date(card.archivedAt).toLocaleDateString()}</td></tr>`;
    });
    historyModal.style.display = 'flex';
});
document.getElementById('close-history-btn').addEventListener('click', () => historyModal.style.display = 'none');
