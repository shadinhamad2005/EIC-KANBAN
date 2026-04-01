import { db } from './firebase-init.js';
import { 
  collection, doc, getDoc, runTransaction, addDoc
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// DOM Elements
const form = document.getElementById('intake-form');
const dynamicContainer = document.getElementById('dynamic-form-container');
const submitBtn = document.getElementById('submit-btn');
const successMsg = document.getElementById('success-msg');
const successTicketId = document.getElementById('success-ticket-id');
const portalTitle = document.getElementById('portal-title');

let formFieldsConfig = []; 

// Load Settings for Dynamic Intake
async function initForm() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'config'));
        if (snap.exists() && snap.data().formFields) {
            formFieldsConfig = snap.data().formFields;
            if (snap.data().boardTitle) {
                portalTitle.innerText = snap.data().boardTitle + " Portal";
            }
        } else {
            formFieldsConfig = [
                { id: "f_title", label: "Task Title *", type: "text", required: true },
                { id: "f_email", label: "Contact Email", type: "email", required: true },
                { id: "f_attachment", label: "Attachment", type: "file", required: false }
            ];
        }
        renderDynamicForm();
    } catch (err) {
        console.error("Error loading config", err);
        dynamicContainer.innerHTML = "<p>Error loading configuration.</p>";
    }
}

function renderDynamicForm() {
    dynamicContainer.innerHTML = '';
    
    // Pass 1: Render All Fields
    formFieldsConfig.forEach(field => {
        let labelHTML = `<label class="form-label">${field.label}</label>`;
        let inputHTML = '';
        let requiredAttr = field.required ? 'required' : '';

        if (field.type === 'textarea') {
            inputHTML = `<textarea id="${field.id}" name="${field.id}" rows="4" class="form-input" ${requiredAttr}></textarea>`;
        } else if (field.type === 'email') {
            inputHTML = `<input type="email" id="${field.id}" name="${field.id}" class="form-input" ${requiredAttr}>`;
        } else if (field.type === 'file') {
            inputHTML = `<input type="file" id="${field.id}" name="${field.id}" class="form-input" accept="image/*" ${requiredAttr}>`;
        } else if (field.type === 'select') {
            inputHTML = `<select id="${field.id}" name="${field.id}" class="form-input" ${requiredAttr}>
                            <option value="">Select an option...</option>
                            ${(field.options || []).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                         </select>`;
        } else if (field.type === 'radio') {
            inputHTML = `<div id="${field.id}" class="radio-group" style="display:flex; flex-direction:column; gap:8px;">
                            ${(field.options || []).map(opt => `<label style="display:flex; align-items:center; gap:8px; color: #fff;"><input type="radio" name="${field.id}" value="${opt}" ${requiredAttr}> ${opt}</label>`).join('')}
                         </div>`;
        } else if (field.type === 'checkbox') {
            inputHTML = `<div id="${field.id}" class="checkbox-group" style="display:flex; flex-direction:column; gap:8px;">
                            ${(field.options || []).map(opt => `<label style="display:flex; align-items:center; gap:8px; color: #fff;"><input type="checkbox" name="${field.id}[]" value="${opt}"> ${opt}</label>`).join('')}
                         </div>`;
        } else {
            inputHTML = `<input type="text" id="${field.id}" name="${field.id}" class="form-input" ${requiredAttr}>`;
        }

        const wrap = document.createElement('div');
        wrap.id = `wrapper_${field.id}`;
        wrap.className = 'form-group-wrap';
        wrap.innerHTML = labelHTML + inputHTML;
        
        // Hide conditional fields initially
        if (field.condition && field.condition.dependsOn) {
            wrap.style.display = 'none';
        }
        
        dynamicContainer.appendChild(wrap);
    });

    // Pass 2: Attach Logic Listeners
    form.addEventListener('input', evaluateConditions);
    form.addEventListener('change', evaluateConditions);
}

function getFieldValue(fieldId) {
    const el = document.getElementById(fieldId);
    if (!el) return null;
    
    // Handle standard inputs and selects
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        if (el.type === 'file') return el.files.length > 0 ? 'FILE_ATTACHED' : '';
        return el.value;
    }
    
    // Handle radio/checkbox groups (which we wrapped in a div with the field.id)
    const radios = el.querySelectorAll(`input[type="radio"]:checked`);
    if (radios.length > 0) return radios[0].value;
    
    const checkboxes = el.querySelectorAll(`input[type="checkbox"]:checked`);
    if (checkboxes.length > 0) {
       return Array.from(checkboxes).map(cb => cb.value).join(',');
    }
    
    return '';
}

function evaluateConditions() {
    formFieldsConfig.forEach(field => {
        if (field.condition && field.condition.dependsOn) {
            const wrapper = document.getElementById(`wrapper_${field.id}`);
            const parentValue = getFieldValue(field.condition.dependsOn);
            
            // Check if parent contains the dependent condition value
            if (parentValue && parentValue.includes(field.condition.value)) {
                wrapper.style.display = 'block';
            } else {
                wrapper.style.display = 'none';
            }
        }
    });
}

// Invisible Canvas Image Compression (Base64 Output)
async function compressImageToBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) return resolve(null);
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                    if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// Ticketing Event
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.innerText = 'Processing Request...';

    const payload = {};
    let fileToUpload = null;
    let fileFieldId = null;

    // Pluck values intelligently considering structural visibility
    for (const field of formFieldsConfig) {
        // Only capture data if the wrapper is currently visible (passed conditions)
        const wrapper = document.getElementById(`wrapper_${field.id}`);
        if(wrapper && wrapper.style.display === 'none') continue;

        const el = document.getElementById(field.id);
        if (!el) continue;
        
        let hasValue = false;
        
        if (field.type === 'file') {
            if (el.files && el.files.length > 0) {
                fileToUpload = el.files[0]; fileFieldId = field.id;
                hasValue = true;
            }
        } else if (field.type === 'radio') {
            const checked = el.querySelector(`input[type="radio"]:checked`);
            if (checked) { payload[field.id] = checked.value; hasValue = true; }
        } else if (field.type === 'checkbox') {
            const checkedBoxes = Array.from(el.querySelectorAll(`input[type="checkbox"]:checked`));
            if (checkedBoxes.length > 0) { payload[field.id] = checkedBoxes.map(cb => cb.value); hasValue = true; }
        } else {
            const val = el.value.trim();
            if(val) { payload[field.id] = val; hasValue = true; }
        }
        
        if (field.required && !hasValue) {
            alert(`Please complete the required field: ${field.label.replace(' *', '')}`);
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit Request';
            return;
        }
    }

    const titleVal = payload['f_title'] || payload[formFieldsConfig[0]?.id] || "Untitled Request";
    const emailVal = payload['f_email'] || "Unknown";

    const counterRef = doc(db, 'counters', 'tickets');
    try {
        const newTicketNumber = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            let currentNum = counterDoc.exists() ? (counterDoc.data().count || 0) : 0;
            const nextNum = currentNum + 1;
            
            if (!counterDoc.exists()) transaction.set(counterRef, { count: nextNum });
            else transaction.update(counterRef, { count: nextNum });
            return nextNum;
        });

        const formattedId = `EIC-TKT-${newTicketNumber.toString().padStart(4, '0')}`;
        const now = new Date().toISOString();

        if (fileToUpload) {
            submitBtn.innerText = 'Crunching Media Payload...';
            const base64String = await compressImageToBase64(fileToUpload);
            if(base64String) payload[fileFieldId] = base64String;
        }

        const firestorePayload = {
            ticketId: formattedId, title: titleVal, requesterEmail: emailVal,
            status: 'Incoming', createdAt: now,
            formData: payload,
            activityLog: [{ action: 'Task intake submitted via portal', timestamp: now, user: 'Public' }]
        };

        submitBtn.innerText = 'Finalizing Ticket...';
        await addDoc(collection(db, 'cards'), firestorePayload);

        successTicketId.innerText = formattedId;
        successMsg.style.display = 'block';
        form.reset();
        evaluateConditions(); // Reset logic DOM visibility
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => { successMsg.style.display = 'none'; }, 10000);

    } catch (err) {
        console.error("Process failed: ", err);
        alert("Failed to submit ticket. " + err.message);
    } finally {
        submitBtn.disabled = false; submitBtn.innerText = 'Submit Request';
    }
});

// Launch
window.addEventListener('load', () => { initForm(); });
