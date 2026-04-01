import os

path = r'c:\Users\shanid\Desktop\EIC KANBAN\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the broken region and the replacement
# We look for the start of the modal-body and the end where it starts the next modal
start_marker = '<div class="modal-body" style="display: flex; gap: 2rem;">'
end_marker = '<!-- INSIGHTS / ANALYTICS MODAL -->'

if start_marker in content and end_marker in content:
    parts = content.split(start_marker)
    prefix = parts[0]
    remainder = parts[1].split(end_marker)
    suffix = remainder[1]
    
    new_modal_body = """<div class="modal-body" style="display: flex; gap: 2rem;">
        
        <!-- Intake Form Builder (First) -->
        <div style="flex: 1.5;">
          <h3>Intake Form Builder</h3>
          <p class="helper-text">Add dynamic fields and conditional logic to your public portal.</p>
          <div id="builder-fields-list" class="builder-list" style="max-height: 250px; overflow-y: auto;"></div>
          
          <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); margin-top: 15px;">
              <h4 style="margin-bottom: 15px; color: var(--accent-color);">Build New Field</h4>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                  <input type="text" id="new-field-label" class="form-input" placeholder="Label (e.g. Category)" style="flex: 1; min-width: 200px; margin-bottom: 5px;">
                  <select id="new-field-type" class="form-input" style="width: 160px; margin-bottom: 5px;">
                      <option value="text">Short Text</option>
                      <option value="textarea">Paragraph</option>
                      <option value="email">Email</option>
                      <option value="file">File/Image</option>
                      <option value="select">Dropdown</option>
                      <option value="radio">Single Choice</option>
                      <option value="checkbox">Multiple Choice</option>
                  </select>
              </div>
              
              <!-- Required Toggle -->
              <div style="margin-top: 5px; margin-bottom: 5px;">
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer;">
                      <input type="checkbox" id="new-field-required"> 
                      Make this field required
                  </label>
              </div>
              
              <!-- Conditional & Advanced Options -->
              <input type="text" id="new-field-options" class="form-input" placeholder="Options (comma separated, e.g. IT, HR, Maintenance)" style="display: none; margin-top: 10px; margin-bottom:0;">
              
              <div style="display: flex; gap: 10px; align-items: center; margin-top: 15px;">
                  <label style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap;">Show field ONLY IF:</label>
                  <select id="new-field-condition-parent" class="form-input" style="flex: 1; margin-bottom: 0; padding: 8px; font-size: 0.85rem;">
                      <option value="">Always Show (No Condition)</option>
                  </select>
                  <span id="condition-equals-text" style="color: var(--text-muted); font-size: 0.75rem; display: none;">equals</span>
                  <input type="text" id="new-field-condition-value" class="form-input" placeholder="Expected Value" style="flex: 1; margin-bottom: 0; padding: 8px; font-size: 0.85rem; display: none;">
              </div>
              <div style="display: flex; gap: 10px; margin-top: 15px;">
                  <button id="add-field-btn" class="btn-primary" style="flex: 1;">Add Field Structure</button>
                  <button id="cancel-edit-btn" class="btn-secondary" style="flex: 1; display: none; background-color: var(--bg-hover); border: 1px solid var(--border-color); color: var(--text-primary);">Cancel Edit</button>
              </div>
          </div>
        </div>

        <!-- Board Layout (Second) -->
        <div style="flex: 1;">
          <h3>Board Layout</h3>
          <p class="helper-text">Configure your Kanban columns</p>
          <label>Platform Name / Heading</label>
          <input type="text" id="settings-board-title" class="form-input">
          
          <label style="margin-top: 15px;">Columns List (Comma Separated)</label>
          <input type="text" id="settings-board-columns" class="form-input" placeholder="Incoming, In Progress, On Hold, Done">
          <p class="helper-text" style="font-size: 0.75rem;">Changes take effect immediately.</p>
        </div>

      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <button id="export-csv-btn" class="icon-btn" style="color: var(--accent-color); border-color: var(--accent-color);">📥 Export All Data (CSV/Excel)</button>
        <button id="save-settings-btn" class="btn-success" style="width: auto; padding: 12px 24px;">Save Configuration</button>
      </div>
    </div>
  </div>

  """
    
    final_content = prefix + new_modal_body + end_marker + suffix
    with open(path, 'w', encoding='utf-8') as f:
        f.write(final_content)
    print("Repair successful")
else:
    print("Markers not found")
