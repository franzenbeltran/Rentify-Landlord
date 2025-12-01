// ================= FIREBASE INITIALIZATION =================

// ================= NAVIGATION =================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    if (sidebar) {
        sidebar.classList.toggle('open');
        // Hide menu toggle button when sidebar opens
        if (menuToggle) {
            if (sidebar.classList.contains('open')) {
                menuToggle.classList.add('hidden');
            } else {
                menuToggle.classList.remove('hidden');
            }
        }
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    if (sidebar) {
        sidebar.classList.remove('open');
        // Show menu toggle button when sidebar closes
        if (menuToggle) {
            menuToggle.classList.remove('hidden');
        }
    }
}

function showSection(sectionId) {
    document.querySelectorAll("main section").forEach(section => section.classList.remove("active"));
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add("active");
    }
    
    // Update sidebar menu active state
    document.querySelectorAll('.sidebar-menu-item button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.sidebar-menu-item button').forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick') || '';
        if (onclickAttr.includes(`'${sectionId}'`)) {
            btn.classList.add('active');
        }
    });

    // Close sidebar after selection (this will show the menu button again)
    closeSidebar();

    // Load section-specific data
    if (sectionId === 'profile') {
        loadProfile();
    } else if (sectionId === 'dashboard') {
        updateDashboard();
        loadFinancialData();
    } else if (sectionId === 'finance') {
        loadFinancialData();
    } else if (sectionId === 'notifications') {
        loadNotifications();
    } else if (sectionId === 'settings') {
        loadSettings();
    } else if (sectionId === 'properties') {
        loadProperties();
    }
}

// ================= AUTH =================
let currentLandlord = null;

/**
 * Replaces checkAuth() with the Firebase standard listener.
 * This function now runs automatically whenever the user signs in or out.
 */
function listenForAuthChanges() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
        // Fallback for when Firebase is not yet loaded or initialized
        console.error("Firebase Auth not available. Check script loading.");
        return; 
    }

    // Use the official Firebase onAuthStateChanged listener
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            // --- USER IS SIGNED IN ---
            currentLandlord = {
                id: user.uid,
                name: user.displayName || user.email.split('@')[0],
                email: user.email,
                photoURL: user.photoURL || null
            };
            
            // Hide Auth Overlay
            document.body.classList.add('logged-in');
            const overlay = document.getElementById('authOverlay');
            if (overlay) overlay.style.display = 'none';

            // Update UI with the user's name
            const usernameDisplay = document.querySelector('.username'); // Assuming you use the class from the aesthetic code
            if (usernameDisplay) usernameDisplay.textContent = currentLandlord.name;
            
            // Load this landlord's specific data
            loadTenants();
            if (typeof loadProperties === 'function') loadProperties();
            showSection('dashboard');
            loadFinancialData();
            loadNotifications();
            
        } else {
            // --- USER IS SIGNED OUT ---
            currentLandlord = null;
            document.body.classList.remove('logged-in');
            const overlay = document.getElementById('authOverlay');
            if (overlay) overlay.style.display = 'flex';
            
            // Clear local tenants and redirect to login
            tenants = [];
            updateTenantTable();
            updatePaymentTable();
            updateDashboard();
            if (window.location.pathname !== '/login.html') {
                 // Only redirect if not already on the login page
                 window.location.href = 'login.html';
            }
        }
    });
}



// ================= TENANTS =================
let tenants = [];
let pendingDeleteIndex = null;
// Chart instances for dashboard
let monthlyChartInstance = null;
let trendChartInstance = null;
let occupancyChartInstance = null;
// Properties state
let properties = [];




// Load tenants for current landlord
async function loadTenants() {
    if (!currentLandlord) return;

        try {
            const db = firebase.firestore();
            let snapshot;
            
            const query = db.collection('tenants').where('landlordId', '==', currentLandlord.id);        try {
            // Attempt to order by timestamp (best practice)
            snapshot = await query.orderBy('updatedAt', 'desc').get();
        } catch {
            // Fallback for when the index is missing
            snapshot = await query.get();
        }
        
        tenants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('Failed to load tenants', err);
        tenants = [];
    }
    // Enrich with property/unit names for display
    try { await enrichTenantLabels(); } catch (e) { /* non-fatal */ }

    updateTenantTable();
    updatePaymentTable();
    updateDashboard();
}

// Enrich tenants with human-friendly labels without heavy DB reads
async function enrichTenantLabels() {
    if (!Array.isArray(tenants) || tenants.length === 0) return;
    // property names from already loaded properties
    const propMap = new Map((properties || []).map(p => [p.id, p.name]));
    tenants.forEach(t => {
        if (!t.propertyName && t.propertyId) t.propertyName = propMap.get(t.propertyId) || '';
    });

    // collect unitIds missing unitName
    const missingUnitIds = Array.from(new Set(tenants
        .filter(t => t.unitId && !t.unitName)
        .map(t => t.unitId)));
    if (missingUnitIds.length === 0) return;

    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    const db = firebase.firestore();
    const idField = firebase.firestore.FieldPath.documentId();
    const chunkSize = 10; // Firestore 'in' supports up to 10
    const unitNameMap = new Map();
    for (let i = 0; i < missingUnitIds.length; i += chunkSize) {
        const chunk = missingUnitIds.slice(i, i + chunkSize);
        try {
            const snap = await db.collection('units').where(idField, 'in', chunk).get();
            snap.docs.forEach(d => unitNameMap.set(d.id, (d.data() || {}).unitName || ''));
        } catch (err) {
            for (const id of chunk) {
                try {
                    const d = await db.collection('units').doc(id).get();
                    if (d.exists) unitNameMap.set(id, (d.data() || {}).unitName || '');
                } catch (_) { /* ignore */ }
            }
        }
    }
    tenants.forEach(t => {
        if (t.unitId && !t.unitName) t.unitName = unitNameMap.get(t.unitId) || '';
    });
}

// ---------------- PROPERTIES ----------------
function openAddPropertyModal() {
    const modal = document.getElementById('addPropertyModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeAddPropertyModal() {
    const modal = document.getElementById('addPropertyModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    const form = document.getElementById('addPropertyForm');
    if (form) form.reset();
}

async function loadProperties() {
    if (!currentLandlord) return;
    try {
        const db = firebase.firestore();
        let snapshot;
        const query = db.collection('properties').where('landlordId', '==', currentLandlord.id);
        try {
            snapshot = await query.orderBy('updatedAt', 'desc').get();
        } catch {
            snapshot = await query.get();
        }
        properties = snapshot.docs.map(doc => {
            const data = doc.data();
            const raw = data.unitsCount;
            // Normalize unitsCount to a number (handles string/undefined/null)
            const unitsCount = (typeof raw === 'number') ? raw : (parseInt(raw, 10) || 0);
            return { id: doc.id, ...data, unitsCount };
        });
        console.log('loadProperties loaded properties (id -> unitsCount):', properties.map(p => ({ id: p.id, unitsCount: p.unitsCount, rawType: typeof p.unitsCount })));
    } catch (err) {
        console.error('Failed to load properties', err);
        properties = [];
    }

    const totalPropertiesEl = document.getElementById('totalProperties');
    if (totalPropertiesEl) totalPropertiesEl.textContent = properties.length;

    const tbody = document.querySelector('#propertyTable tbody');
    if (!tbody) return;
    if (properties.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">No properties yet.</td></tr>';
        return;
    }

    tbody.innerHTML = properties.map(p => `
        <tr>
            <td>${p.name || ''}</td>
            <td>${p.address || ''}</td>
            <td>${p.type || ''}</td>
            <td>${p.unitsCount || 0}</td>
            <td>
                <button class="actionBtn" onclick="openManageUnits('${p.id}')">Manage Units</button>
                <button class="actionBtn" style="background:#b80000; color:#fff; margin-left:8px;" onclick="deleteProperty('${p.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
    // Refresh global unit counts for dashboard
    if (typeof refreshUnitCounts === 'function') refreshUnitCounts();
    // Populate tenant/property dropdowns
    if (typeof populateTenantPropertyDropdowns === 'function') populateTenantPropertyDropdowns();
}

// Populate property dropdown used in the Add Tenant form
function populateTenantPropertyDropdowns() {
    const sel = document.getElementById('tenantProperty');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Property (optional)</option>' + (properties && properties.length ? properties.map(p => `<option value="${p.id}">${p.name}</option>`).join('') : '');
    sel.onchange = () => {
        const propId = sel.value;
        // reset unit and rent when property changes
        const unitSelect = document.getElementById('tenantUnit');
        if (unitSelect) {
            unitSelect.innerHTML = '<option value="">Select Unit (optional)</option>';
            unitSelect.disabled = true;
            delete unitSelect.dataset.available;
        }
        const tenantRentInput = document.getElementById('tenantRent');
        if (tenantRentInput) {
            tenantRentInput.value = '';
        }
        populateTenantUnitsForProperty(propId);
    };
}

// Load vacant units for a property into tenantUnit select
async function populateTenantUnitsForProperty(propertyId) {
    const unitSelect = document.getElementById('tenantUnit');
    if (!unitSelect) return;
    unitSelect.innerHTML = '<option value="">Select Unit (optional)</option>';
    unitSelect.disabled = true;
    if (!propertyId) {
        // no property selected -> keep unit select disabled
        return;
    }
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('units').where('propertyId', '==', propertyId).get();
        const allUnits = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const available = allUnits.filter(u => !u.tenantId || u.status === 'Vacant');
        // store available units in dataset for later lookup
        unitSelect.dataset.available = JSON.stringify(available.map(u => ({ id: u.id, unitName: u.unitName, rent: u.rent || 0 })));
        if (available.length === 0) {
            unitSelect.innerHTML = '<option value="">No vacant units available</option>';
            unitSelect.disabled = true;
        } else {
            unitSelect.innerHTML = '<option value="">Select Unit (optional)</option>' + available.map(u => `<option value="${u.id}">${u.unitName || u.id}</option>`).join('');
            unitSelect.disabled = false;
        }

        // when a unit is selected, auto-fill tenantRent with unit.rent
        unitSelect.onchange = () => {
            const sel = unitSelect.value;
            const tenantRentInput = document.getElementById('tenantRent');
            let defaultRent = 0;
            try {
                const raw = unitSelect.dataset.available ? JSON.parse(unitSelect.dataset.available) : [];
                const found = raw.find(x => x.id === sel);
                if (found) defaultRent = found.rent || 0;
            } catch (err) { /* ignore parse errors */ }
            if (tenantRentInput) {
                if (sel) tenantRentInput.value = defaultRent || '';
                else tenantRentInput.value = '';
            }
        };
    } catch (err) {
        console.error('Failed to populate units for property', err);
    }
}

// ---------------- UNITS MANAGEMENT ----------------
let currentPropertyId = null;
let units = [];

function openManageUnits(propertyId) {
    console.log('openManageUnits called with propertyId:', propertyId);
    currentPropertyId = propertyId;
    const prop = properties.find(p => p.id === propertyId) || {};
    const title = document.getElementById('unitsTitle');
    if (title) title.textContent = `Units — ${prop.name || ''}`;
    showSection('units');
    loadUnits(propertyId);
}

function openAddUnitModal() {
    const modal = document.getElementById('addUnitModal');
    if (!modal) return;
    // populate tenant select
    const tenantSelect = document.getElementById('unitTenant');
    if (tenantSelect) {
        tenantSelect.innerHTML = '<option value="">-- Assign Tenant (optional) --</option>' +
            tenants.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    const status = document.getElementById('unitStatus'); if (status) status.value = 'Vacant';
    const rent = document.getElementById('unitRent'); if (rent) rent.value = '';
    const name = document.getElementById('unitName'); if (name) name.value = '';
    const rooms = document.getElementById('unitRooms'); if (rooms) rooms.value = '';
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    modal.dataset.editing = '';
}

function openEditUnitModal(unit) {
    const modal = document.getElementById('addUnitModal');
    if (!modal) return;
    const tenantSelect = document.getElementById('unitTenant');
    if (tenantSelect) {
        tenantSelect.innerHTML = '<option value="">-- Assign Tenant (optional) --</option>' +
            tenants.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    document.getElementById('unitName').value = unit.unitName || '';
    document.getElementById('unitRent').value = unit.rent || '';
    document.getElementById('unitTenant').value = unit.tenantId || '';
    document.getElementById('unitStatus').value = unit.status || 'Vacant';
    const roomsField = document.getElementById('unitRooms'); if (roomsField) roomsField.value = unit.rooms || '';
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    modal.dataset.editing = unit.id;
}

function closeUnitModal() {
    const modal = document.getElementById('addUnitModal');
    if (!modal) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
    modal.dataset.editing = '';
    const form = document.getElementById('addUnitForm'); if (form) form.reset();
}

async function loadUnits(propertyId) {
    if (!currentLandlord || !propertyId) {
        console.log('loadUnits called but missing currentLandlord or propertyId:', { currentLandlord, propertyId });
        return;
    }
    console.log('loadUnits fetching units for propertyId:', propertyId);
    try {
        const db = firebase.firestore();
        let snapshot;
        // Try ordered query first; fall back to unordered if index is missing
        try {
            snapshot = await db.collection('units').where('propertyId', '==', propertyId).orderBy('unitName').get();
        } catch (orderErr) {
            console.warn('Ordered query failed, retrying without orderBy:', orderErr.message || orderErr);
            snapshot = await db.collection('units').where('propertyId', '==', propertyId).get();
        }
        console.log('loadUnits snapshot count:', snapshot.size);
        console.log('loadUnits docs:', snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        units = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('Failed to load units', err);
        units = [];
    }

    const tbody = document.querySelector('#unitTable tbody');
    if (!tbody) return;
    if (!units || units.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px;">No units yet.</td></tr>';
        return;
    }

    tbody.innerHTML = units.map(u => {
        const tenant = tenants.find(t => t.id === u.tenantId);
        return `
            <tr>
                <td>${u.unitName || ''}</td>
                <td>${u.rooms || ''}</td>
                <td>$${(parseFloat(u.rent)||0).toFixed(2)}</td>
                <td>${tenant ? tenant.name : ''}</td>
                <td>${u.status || 'Vacant'}</td>
                <td class="unit-actions">
                    <button class="actionBtn" onclick='openEditUnitModal(${JSON.stringify(u)})'>Edit</button>
                    ${u.status === 'Occupied' ? `<button class="actionBtn" onclick="endTenancy('${u.id}')">End</button>` : ''}
                    <button class="actionBtn" onclick="deleteUnit('${u.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
    // keep global counts up to date
    if (typeof refreshUnitCounts === 'function') refreshUnitCounts();
}

// Add/edit unit submit
document.addEventListener('DOMContentLoaded', () => {
    const unitForm = document.getElementById('addUnitForm');
    if (unitForm) unitForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentPropertyId) return alert('No property selected');
        const editingId = document.getElementById('addUnitModal').dataset.editing || '';
        const unitName = document.getElementById('unitName').value.trim();
        const rent = parseFloat(document.getElementById('unitRent').value) || 0;
        const tenantId = document.getElementById('unitTenant').value || '';
        const status = document.getElementById('unitStatus').value || 'Vacant';
        const rooms = document.getElementById('unitRooms') ? document.getElementById('unitRooms').value.trim() : '';
        if (!unitName) return alert('Please enter unit name/number');

        try {
            const db = firebase.firestore();
            if (editingId) {
                console.log('Updating unit', editingId, { unitName, rent, tenantId, status, rooms });
                const updatePayload = { unitName, rent, tenantId: tenantId || '', status, rooms: rooms || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                if (tenantId) updatePayload.tenantName = (tenants.find(t => t.id === tenantId) || {}).name || '';
                await db.collection('units').doc(editingId).update(updatePayload);
            } else {
                console.log('Adding unit for propertyId', currentPropertyId, { unitName, rent, tenantId, status, rooms });
                const newUnit = { propertyId: currentPropertyId, unitName, rent, tenantId: tenantId || '', status, rooms: rooms || '', landlordId: currentLandlord.id, createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                if (tenantId) newUnit.tenantName = (tenants.find(t => t.id === tenantId) || {}).name || '';
                await db.collection('units').add(newUnit);
                const propRef = db.collection('properties').doc(currentPropertyId);
                try {
                    const propDoc = await propRef.get();
                    if (propDoc.exists) {
                        const current = propDoc.data().unitsCount || 0;
                        await propRef.update({ unitsCount: current + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                    }
                } catch (err) { console.warn('Failed to update unitsCount', err); }
            }

            await loadUnits(currentPropertyId);
            await loadProperties();
            updateDashboard();
            // refresh global unit counts which updates dashboard unit metrics and occupancy chart
            if (typeof refreshUnitCounts === 'function') await refreshUnitCounts();
            closeUnitModal();
        } catch (err) {
            console.error('Failed to save unit', err);
            alert('Failed to save unit. See console for details.');
        }
    });
});

// ================= AVATAR UPLOAD =================
function openAvatarPicker() {
    const input = document.getElementById('avatarFileInput');
    if (!input) return;
    input.click();
}

let avatarCropper = null;
let avatarObjectUrl = null;
let avatarOriginalFile = null;

document.addEventListener('DOMContentLoaded', () => {
    const avatarInput = document.getElementById('avatarFileInput');
    if (!avatarInput) return;
    avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('Please select an image file'); avatarInput.value=''; return; }
        if (file.size > 10 * 1024 * 1024) { alert('Image must be less than 10MB'); avatarInput.value=''; return; }
        openAvatarCropModalWithFile(file);
    });
});

function openAvatarCropModalWithFile(file){
    const modal = document.getElementById('avatarCropModal');
    const img = document.getElementById('avatarCropImage');
    if (!modal || !img) return;
    try { if (avatarCropper) { avatarCropper.destroy(); avatarCropper = null; } } catch(_){}
    if (avatarObjectUrl) { URL.revokeObjectURL(avatarObjectUrl); avatarObjectUrl = null; }
    avatarOriginalFile = file;
    avatarObjectUrl = URL.createObjectURL(file);
    img.src = avatarObjectUrl;
    // Open modal
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    // Initialize cropper when image is loaded
    img.onload = () => {
        try {
            if (typeof Cropper === 'undefined') {
                console.warn('Cropper.js not loaded; uploading original image');
                closeAvatarCropModal();
                uploadAvatar(avatarOriginalFile);
                return;
            }
            avatarCropper = new Cropper(img, {
                aspectRatio: 1,
                viewMode: 1,
                background: false,
                autoCropArea: 1,
                movable: true,
                zoomable: true,
                rotatable: false,
                scalable: false,
            });
        } catch(err){ console.error('Failed to init cropper', err); }
    };
}

function closeAvatarCropModal(){
    const modal = document.getElementById('avatarCropModal');
    const input = document.getElementById('avatarFileInput');
    if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
    try { if (avatarCropper) { avatarCropper.destroy(); avatarCropper = null; } } catch(_){}
    if (avatarObjectUrl) { URL.revokeObjectURL(avatarObjectUrl); avatarObjectUrl = null; }
    avatarOriginalFile = null;
    if (input) input.value = '';
}

function saveAvatarCrop(){
    if (!avatarCropper && avatarOriginalFile) {
        // Fallback: upload original
        uploadAvatar(avatarOriginalFile);
        closeAvatarCropModal();
        return;
    }
    if (!avatarCropper) { closeAvatarCropModal(); return; }
    const canvas = avatarCropper.getCroppedCanvas({ width: 320, height: 320, imageSmoothingQuality: 'high' });
    if (!canvas) { alert('Could not crop image'); return; }
    canvas.toBlob(async (blob) => {
        if (!blob) { alert('Could not prepare image'); return; }
        const filename = `avatar_${Date.now()}.jpg`;
        await uploadAvatar(blob, filename);
        closeAvatarCropModal();
    }, 'image/jpeg', 0.92);
}

async function uploadAvatar(file, fileNameOverride) {
    if (!currentLandlord) return alert('Not logged in');
    try {
        const user = firebase.auth().currentUser;
        if (!user) return alert('Auth user missing');
        
        // Upload to Firebase Storage
        const storageRef = firebase.storage().ref();
        const safeName = (fileNameOverride || file.name || 'avatar.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const avatarRef = storageRef.child(`avatars/${currentLandlord.id}/${safeName}`);
        const snapshot = await avatarRef.put(file);
        const photoURL = await snapshot.ref.getDownloadURL();
        
        // Update Firebase Auth profile
        await user.updateProfile({ photoURL });
        
        // Update Firestore landlord doc
        const db = firebase.firestore();
        await db.collection('landlords').doc(currentLandlord.id).update({
            photoURL,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Update local state and UI
        currentLandlord.photoURL = photoURL;
        const profileImg = document.getElementById('profileImage');
        if (profileImg) profileImg.src = photoURL;
        
        alert('Avatar updated successfully');
    } catch (err) {
        console.error('Avatar upload failed', err);
        alert('Failed to upload avatar: ' + (err.message || 'See console'));
    }
}

// ================= OWNERSHIP TRANSFER =================
function openOwnershipModal() {
    const modal = document.getElementById('ownershipModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeOwnershipModal() {
    const modal = document.getElementById('ownershipModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    const form = document.getElementById('ownershipForm');
    if (form) form.reset();
}

// Ownership update logic: reauth then update email, password, displayName & landlord doc
document.addEventListener('DOMContentLoaded', () => {
    const ownershipForm = document.getElementById('ownershipForm');
    if (!ownershipForm) return;
    ownershipForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentLandlord) return alert('Not logged in');
        const newEmail = document.getElementById('ownershipNewEmail').value.trim();
        const newName = document.getElementById('ownershipNewName').value.trim();
        const currentPassword = document.getElementById('ownershipCurrentPassword').value;
        const newPassword = document.getElementById('ownershipNewPassword').value;
        if (!newEmail || !newName || !currentPassword || !newPassword) return alert('Please fill all fields');
        if (!confirm('Update ownership (account credentials) now?')) return;
        try {
            const user = firebase.auth().currentUser;
            if (!user) return alert('Auth user missing');
            // Re-authenticate
            const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
            await user.reauthenticateWithCredential(cred);
            // Update email
            if (newEmail !== user.email) {
                await user.updateEmail(newEmail);
            }
            // Update password
            await user.updatePassword(newPassword);
            // Update display name
            await user.updateProfile({ displayName: newName });
            // Firestore landlord doc update
            const db = firebase.firestore();
            await db.collection('landlords').doc(currentLandlord.id).update({
                name: newName,
                email: newEmail,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            // Update local state
            currentLandlord.name = newName;
            currentLandlord.email = newEmail;
            alert('Ownership/account credentials updated successfully');
            closeOwnershipModal();
            loadProfile();
        } catch (err) {
            console.error('Ownership update failed', err);
            let msg = err.message || 'Update failed';
            if (/recent login/i.test(msg)) msg = 'Please log out and log back in, then retry.';
            alert(msg);
        }
    });
});

async function deleteUnit(unitId) {
    if (!confirm('Delete this unit? This cannot be undone.')) return;
    try {
        console.log('deleteUnit called for unitId', unitId, 'currentPropertyId', currentPropertyId);
        const db = firebase.firestore();
        await db.collection('units').doc(unitId).delete();
        // decrement unitsCount
        try {
            const propRef = db.collection('properties').doc(currentPropertyId);
            const propDoc = await propRef.get();
            if (propDoc.exists) {
                const current = propDoc.data().unitsCount || 0;
                await propRef.update({ unitsCount: Math.max(0, current - 1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            }
        } catch (err) { console.warn('Failed to decrement unitsCount', err); }
        await loadUnits(currentPropertyId);
        await loadProperties();
        updateDashboard();
        if (typeof refreshUnitCounts === 'function') await refreshUnitCounts();
    } catch (err) {
        console.error('Failed to delete unit', err);
        alert('Failed to delete unit. See console for details.');
    }
}

async function endTenancy(unitId) {
    if (!confirm('End tenancy for this unit? This will free the unit but keep its record.')) return;
    try {
        const db = firebase.firestore();
        const unitRef = db.collection('units').doc(unitId);
        const unitDoc = await unitRef.get();
        if (!unitDoc.exists) return alert('Unit not found');
        const unitData = unitDoc.data();
        const prevTenantId = unitData.tenantId;

        // Clear tenant fields on the unit
        await unitRef.update({ tenantId: '', tenantName: '', status: 'Vacant', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });

        if (prevTenantId) {
            try {
                await db.collection('tenants').doc(prevTenantId).update({ unitId: null, propertyId: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            } catch (err) {
                console.warn('Failed to clear tenant linkage', err);
            }
        }

        // Refresh UI
        await loadUnits(currentPropertyId);
        await loadProperties();
        if (typeof refreshUnitCounts === 'function') await refreshUnitCounts();
        updateDashboard();
    } catch (err) {
        console.error('Failed to end tenancy', err);
        alert('Failed to end tenancy. See console for details.');
    }
}

// Refresh global unit counts (total / occupied / vacant) used by dashboard
async function refreshUnitCounts() {
    if (!currentLandlord) return;
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    try {
        const db = firebase.firestore();
        let snapshot;
        try {
            snapshot = await db.collection('units').where('landlordId', '==', currentLandlord.id).get();
        } catch (err) {
            snapshot = await db.collection('units').where('landlordId', '==', currentLandlord.id).get();
        }

        const allUnits = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const totalUnits = allUnits.length;
        const occupiedUnits = allUnits.filter(u => (u.status === 'Occupied' || (u.tenantId && u.tenantId !== ''))).length;
        const vacantUnits = Math.max(0, totalUnits - occupiedUnits);

        const totalUnitsEl = document.getElementById('totalUnits');
        const occupiedUnitsEl = document.getElementById('occupiedUnits');
        const vacantUnitsEl = document.getElementById('vacantUnits');

        if (totalUnitsEl) totalUnitsEl.textContent = totalUnits;
        if (occupiedUnitsEl) occupiedUnitsEl.textContent = occupiedUnits;
        if (vacantUnitsEl) vacantUnitsEl.textContent = vacantUnits;

        try { renderOccupancyChart(occupiedUnits, vacantUnits); } catch (err) { /* ignore */ }
    } catch (err) {
        console.error('Failed to refresh unit counts', err);
    }
}

// Add property form handler
async function addProperty(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!currentLandlord) return alert('Not logged in');

    const name = document.getElementById('propertyName').value.trim();
    const address = document.getElementById('propertyAddress').value.trim();
    const type = document.getElementById('propertyType').value;
    const unitsVal = document.getElementById('propertyUnits').value;
    const units = parseInt(unitsVal, 10) || 0;
    const defaultRentVal = document.getElementById('propertyDefaultRent') ? document.getElementById('propertyDefaultRent').value : '';
    const defaultRent = defaultRentVal ? parseFloat(defaultRentVal) : 0;
    const description = document.getElementById('propertyDescription').value.trim();

    if (!name || !address) return alert('Please enter property name and address');

    if (typeof firebase === 'undefined' || !firebase.firestore) {
        alert('Firestore not available. Property will not be saved.');
        return closeAddPropertyModal();
    }

    try {
        const db = firebase.firestore();
        const newProp = {
            name,
            address,
            type,
            description,
            unitsCount: units,
            defaultRent: defaultRent || 0,
            landlordId: currentLandlord.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('properties').add(newProp);

        // Optionally auto-generate unit documents
        if (units > 0) {
            const batchPromises = [];
            for (let i = 0; i < units; i++) {
                batchPromises.push(db.collection('units').add({
                    propertyId: docRef.id,
                    unitName: `Unit ${i + 1}`,
                    rent: defaultRent || 0,
                    landlordId: currentLandlord.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }));
            }
            await Promise.all(batchPromises);
            await db.collection('properties').doc(docRef.id).update({ unitsCount: units, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }

        // Refresh list and dashboard
        await loadProperties();
        updateDashboard();
        closeAddPropertyModal();
        const form = document.getElementById('addPropertyForm'); if (form) form.reset();
    } catch (err) {
        console.error('Failed to add property', err);
        alert('Failed to add property. See console for details.');
    }
}

async function deleteProperty(propertyId) {
    if (!confirm('Delete this property and all its units? This cannot be undone.')) return;
    if (!propertyId) return alert('Invalid property');
    try {
        const db = firebase.firestore();

        const unitsSnapshot = await db.collection('units').where('propertyId', '==', propertyId).get();
        const unitIds = unitsSnapshot.docs.map(d => d.id);

        const deleteUnitPromises = unitIds.map(id => db.collection('units').doc(id).delete().catch(err => { console.warn('Failed to delete unit', id, err); }));
        await Promise.all(deleteUnitPromises);

        try {
            const tenantsSnapshot = await db.collection('tenants').where('propertyId', '==', propertyId).get();
            const tenantUpdatePromises = tenantsSnapshot.docs.map(doc => db.collection('tenants').doc(doc.id).update({ unitId: null, propertyId: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => { console.warn('Failed to clear tenant link', doc.id, err); }));
            await Promise.all(tenantUpdatePromises);
        } catch (err) {
            console.warn('Failed to clear tenant links for property', propertyId, err);
        }

        try {
            await db.collection('properties').doc(propertyId).delete();
        } catch (err) {
            console.error('Failed to delete property', err);
            return alert('Failed to delete property. See console for details.');
        }

        await loadProperties();
        if (typeof refreshUnitCounts === 'function') await refreshUnitCounts();
        updateDashboard();
    } catch (err) {
        console.error('Failed to delete property', err);
        alert('Failed to delete property. See console for details.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const addForm = document.getElementById('addPropertyForm');
    if (addForm) addForm.addEventListener('submit', addProperty);
});

// Add tenant form
const tenantForm = document.getElementById("tenantForm");
tenantForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentLandlord) return alert("Landlord not logged in!");

    const name = document.getElementById("tenantName").value.trim();
    const propertyId = document.getElementById('tenantProperty')?.value || '';
    const unitId = document.getElementById('tenantUnit')?.value || '';
    const contact = document.getElementById('tenantContact')?.value.trim() || '';
    const rent = document.getElementById("tenantRent").value;
    const dueDate = document.getElementById("tenantDueDate").value;

    if (!name || !rent || !dueDate) return alert("Please fill Name, Rent and Due Date");

    const propertyName = (properties || []).find(p => p.id === propertyId)?.name || (document.querySelector('#tenantProperty option:checked')?.textContent || '');
    const unitNameFromSelect = document.querySelector('#tenantUnit option:checked')?.textContent || '';
    const newTenant = {
        name,
        contact,
        rent: parseFloat(rent),
        dueDate,
        status: "Unpaid",
        landlordId: currentLandlord.id,
        propertyId: propertyId || null,
        propertyName: propertyName || null,
        unitId: unitId || null,
        unitName: unitNameFromSelect || null
    };

    try {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
            const db = firebase.firestore();

            // Use a transaction to atomically create tenant and assign unit (if provided)
            if (unitId) {
                const tenantRef = db.collection('tenants').doc();
                const unitRef = db.collection('units').doc(unitId);
                await db.runTransaction(async (tx) => {
                    const unitSnap = await tx.get(unitRef);
                    if (!unitSnap.exists) throw new Error('Selected unit does not exist');
                    const unitData = unitSnap.data() || {};
                    const status = unitData.status || 'Vacant';
                    if (status === 'Occupied' && unitData.tenantId) {
                        throw new Error('Selected unit is already occupied');
                    }

                    // create tenant doc
                    const payload = {
                        ...newTenant,
                        unitName: unitData.unitName || null,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    tx.set(tenantRef, payload);

                    // assign tenant to unit
                    const updatePayload = {
                        tenantId: tenantRef.id,
                        tenantName: newTenant.name,
                        status: 'Occupied',
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    if (rent) updatePayload.rent = parseFloat(rent);
                    tx.update(unitRef, updatePayload);
                });
                    // After transaction completes, set tenant id locally from the tenantRef used in the transaction
                    newTenant.id = tenantRef.id;
            } else {
                // No unit selected — just create tenant doc normally
                const docRef = await db.collection('tenants').add({
                    ...newTenant,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                newTenant.id = docRef.id;
            }
        }

        tenants.unshift(newTenant); // add to local list
    } catch (err) {
        console.error('Failed to add tenant', err);
        const msg = err && err.message ? err.message : '';
        if (msg.includes('already occupied')) {
            alert('Selected unit is already occupied. Choose a different unit.');
        } else if (msg) {
            alert(msg);
        } else {
            alert('Failed to add tenant. See console for details.');
        }
    }

    // Refresh UI and related data
    updateTenantTable();
    updatePaymentTable();
    updateDashboard();
    loadNotifications();
    // Refresh properties/units lists if relevant
    if (propertyId) {
        await loadProperties();
        if (typeof loadUnits === 'function') await loadUnits(propertyId);
        if (typeof populateTenantUnitsForProperty === 'function') await populateTenantUnitsForProperty(propertyId);
    } else {
        // ensure global counts update
        if (typeof refreshUnitCounts === 'function') await refreshUnitCounts();
    }

    tenantForm.reset();
});

// ================= UPDATE TABLES =================
function updateTenantTable() {
    const tbody = document.querySelector("#tenantTable tbody");
    tbody.innerHTML = "";
    tenants.forEach((tenant, index) => {
        const statusClass = tenant.status === "Paid" ? "status-paid" : tenant.status === "Past Due" ? "status-past-due" : "status-unpaid";
        const today = new Date().toISOString().split('T')[0];
        const isPastDue = tenant.status !== 'Paid' && tenant.dueDate && tenant.dueDate < today;
        const dueClass = isPastDue ? 'due-past' : '';
        const propName = tenant.propertyName || (properties.find(p => p.id === tenant.propertyId) || {}).name || '';
        const unitName = tenant.unitName || '';
                tbody.innerHTML += `
                        <tr>
                                <td>${tenant.name}</td>
                <td>${propName}</td>
                <td>${unitName}</td>
                                <td>${tenant.rent}</td>
                                <td class="${dueClass}">${tenant.dueDate}</td>
                                <td class="${statusClass}">${tenant.status}</td>
                                <td>
                                    <button class="actionBtn notify" title="Notify" onclick="alert('Notified')">🔔</button>
                                    <button class="actionBtn pay" title="Go to Finance" onclick="showSection('finance')">💵</button>
                                    <button class="actionBtn" title="Delete" onclick="deleteTenant(${index})">🗑️</button>
                                </td>
                        </tr>
                `;
    });
}

function updatePaymentTable() {
    const tbody = document.querySelector("#paymentTable tbody");
    tbody.innerHTML = "";
    tenants.forEach((tenant, index) => {
        const statusClass = tenant.status === "Paid" ? "status-paid" : tenant.status === "Past Due" ? "status-past-due" : "status-unpaid";
        const btnHtml = tenant.status === "Paid"
            ? `<button class="actionBtn paid" disabled>PAID</button>`
            : `<button class="actionBtn" onclick="markPaid(${index})">Mark Paid</button>`;
        const today = new Date().toISOString().split('T')[0];
        const isPastDue = tenant.status !== 'Paid' && tenant.dueDate && tenant.dueDate < today;
        const dueClass = isPastDue ? 'due-past' : '';
        const propName = tenant.propertyName || (properties.find(p => p.id === tenant.propertyId) || {}).name || '';
        const unitName = tenant.unitName || '';
        tbody.innerHTML += `
            <tr>
                <td>${tenant.name}</td>
                <td>${propName}</td>
                <td>${unitName}</td>
                <td>${tenant.rent}</td>
                <td class="${dueClass}">${tenant.dueDate}</td>
                <td class="${statusClass}">${tenant.status}</td>
                <td>${btnHtml}</td>
            </tr>
        `;
    });
}

// ================= DASHBOARD =================
function updateDashboard() {
    const totalEl = document.getElementById("totalTenants");
    const paidEl = document.getElementById("paidTenants");
    const pastDueEl = document.getElementById("pastDueCount");

    const total = tenants.length;
    const paidCount = tenants.filter(t => t.status === "Paid").length;
    
    const today = new Date().toISOString().split('T')[0];
    const pastDueCount = tenants.filter(t => t.status !== "Paid" && t.dueDate < today).length;

    if (totalEl) { totalEl.innerText = total; totalEl.classList.toggle('metric-zero', total === 0); }
    if (paidEl) { paidEl.innerText = paidCount; paidEl.classList.toggle('metric-zero', paidCount === 0); }
    if (pastDueEl) { pastDueEl.innerText = pastDueCount; pastDueEl.classList.toggle('metric-critical', pastDueCount > 0); }
    
    // Update profile section tenant count
    const profileTotalTenants = document.getElementById('profileTotalTenants');
    if (profileTotalTenants) profileTotalTenants.textContent = total;
    
    // Update financial summary (unpaid amount)
    updateFinancialSummary();
    
    // Reload notifications when tenants change
    loadNotifications();

    // --- Additional dashboard metrics ---
    // Total units: prefer property/units data when available
    let totalUnits = 0;
    if (properties && properties.length > 0) {
        totalUnits = properties.reduce((s, p) => s + (parseInt(p.unitsCount, 10) || 0), 0);
    } else {
        totalUnits = new Set(tenants.map(t => t.room)).size || tenants.length;
    }
    const occupiedUnits = tenants.length;
    const vacantUnits = Math.max(0, totalUnits - occupiedUnits);

    const totalUnitsEl = document.getElementById('totalUnits');
    const occupiedUnitsEl = document.getElementById('occupiedUnits');
    const vacantUnitsEl = document.getElementById('vacantUnits');

    if (totalUnitsEl) totalUnitsEl.textContent = totalUnits;
    if (occupiedUnitsEl) occupiedUnitsEl.textContent = occupiedUnits;
    if (vacantUnitsEl) vacantUnitsEl.textContent = vacantUnits;

    // Paid/unpaid amounts are not shown as separate cards per user request.

    // Render occupancy chart (occupied vs vacant)
    try {
        renderOccupancyChart(occupiedUnits, vacantUnits);
    } catch (err) {
        console.error('Occupancy chart render failed', err);
    }

    // Upcoming due dates (next 7 days)
    updateUpcomingDueDates();

    // Render charts (monthly collection and payment trend)
    try {
        const months = getLastNMonths(6);
        const monthlySums = months.map(m => sumPaidForMonth(m.year, m.month));
        renderMonthlyChart(months.map(m => m.label), monthlySums);

        const paidCounts = months.map(m => countStatusForMonth(m.year, m.month, 'Paid'));
        const unpaidCounts = months.map(m => countStatusForMonth(m.year, m.month, 'Unpaid') + countStatusForMonth(m.year, m.month, 'Past Due'));
        renderTrendChart(months.map(m => m.label), paidCounts, unpaidCounts);
    } catch (err) {
        console.error('Chart rendering failed', err);
    }
}

// ================= MARK PAID =================
async function markPaid(index) {
    const tenant = tenants[index];
    tenant.status = 'Paid';

    if (tenant.id && typeof firebase !== 'undefined' && firebase.firestore) {
        try {
            await firebase.firestore().collection('tenants').doc(tenant.id).update({
                status: 'Paid',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error('Failed to update tenant', err);
            tenant.status = 'Unpaid'; 
        }
    }

    updateTenantTable();
    updatePaymentTable();
    updateDashboard();
    updateFinancialSummary();
}

// ================= DELETE TENANT =================
function deleteTenant(index) {
    pendingDeleteIndex = index;
    const tenant = tenants[index];
    const msgEl = document.getElementById('deleteModalMessage');
    const propName = tenant.propertyName || (properties.find(p => p.id === tenant.propertyId) || {}).name || '';
    const unitName = tenant.unitName || '';
    const where = [unitName ? `Unit: ${unitName}` : '', propName ? `Property: ${propName}` : ''].filter(Boolean).join(' — ');
    msgEl.innerText = `Delete tenant "${tenant.name}"${where ? ` (${where})` : ''}? This cannot be undone.`;
    const modal = document.getElementById('deleteModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

async function confirmDelete() {
    if (pendingDeleteIndex === null) return closeDeleteModal();
    const tenant = tenants[pendingDeleteIndex];

    // Delete from Firestore
    if (tenant.id && typeof firebase !== 'undefined' && firebase.firestore) {
        try { await firebase.firestore().collection('tenants').doc(tenant.id).delete(); }
        catch (err) { 
            console.error('Failed to delete from Firestore:', err); 
            return; // Stop if Firestore delete fails
        }
    }

    // Delete locally
    tenants.splice(pendingDeleteIndex, 1);
    pendingDeleteIndex = null;
    
    updateTenantTable();
    updatePaymentTable();
    updateDashboard();
    closeDeleteModal();
}

function cancelDelete() { pendingDeleteIndex = null; closeDeleteModal(); }
function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
}

// ================= PROFILE =================
async function loadProfile() {
    if (!currentLandlord) return;
    
    const userNameEl = document.getElementById('profileName');
    const userEmailEl = document.getElementById('profileEmail');
    const totalTenantsEl = document.getElementById('profileTotalTenants');
    const createdDateEl = document.getElementById('profileCreatedDate');
    const profileImg = document.getElementById('profileImage');
    
    if (userNameEl) userNameEl.textContent = currentLandlord.name;
    if (userEmailEl) userEmailEl.textContent = currentLandlord.email;
    if (totalTenantsEl) totalTenantsEl.textContent = tenants.length;
    if (profileImg) profileImg.src = currentLandlord.photoURL ? currentLandlord.photoURL : 'profile.png';
    
    // Get account creation date from Firestore
    try {
        const db = firebase.firestore();
        const userDoc = await db.collection('landlords').doc(currentLandlord.id).get();
        if (userDoc.exists) {
            const data = userDoc.data();
            if (data.createdAt && createdDateEl) {
                const date = data.createdAt.toDate();
                createdDateEl.textContent = date.toLocaleDateString();
            }
            if (data.name && userNameEl) userNameEl.textContent = data.name;
            if (data.photoURL && profileImg) profileImg.src = data.photoURL;
        }
    } catch (err) {
        console.error('Failed to load profile data', err);
    }
}

// Profile form handler
const profileForm = document.getElementById('profileForm');
profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLandlord) return alert("Not logged in!");
    
    const newName = document.getElementById('editName').value;
    if (!newName) return alert("Please enter a name!");
    
    try {
        const db = firebase.firestore();
        await db.collection('landlords').doc(currentLandlord.id).update({
            name: newName
        });
        
        currentLandlord.name = newName;
        localStorage.setItem('landlordName', newName);
        loadProfile();
        alert("Profile updated successfully!");
        profileForm.reset();
    } catch (err) {
        console.error('Failed to update profile', err);
        alert("Failed to update profile. Please try again.");
    }
});

// ================= FINANCIAL TRACKING =================
function loadFinancialData() {
    // No need to load from Firestore, we'll use tenant data
    updateFinancialSummary();
}

function updateFinancialSummary() {
    // Calculate total income from paid tenants
    const totalIncome = tenants
        .filter(t => t.status === 'Paid')
        .reduce((sum, tenant) => sum + (parseFloat(tenant.rent) || 0), 0);
    
    // Calculate unpaid amount from tenants
    const unpaidAmount = tenants
        .filter(t => t.status !== 'Paid')
        .reduce((sum, tenant) => sum + (parseFloat(tenant.rent) || 0), 0);
    
    const totalIncomeEl = document.getElementById('totalIncome');
    const unpaidEl = document.getElementById('unpaidAmount');
    const dashboardIncomeEl = document.getElementById('dashboardTotalIncome');
    
    if (totalIncomeEl) totalIncomeEl.textContent = `$${totalIncome.toFixed(2)}`;
    if (dashboardIncomeEl) dashboardIncomeEl.textContent = `$${totalIncome.toFixed(2)}`;
    if (unpaidEl) unpaidEl.textContent = `$${unpaidAmount.toFixed(2)}`;
}



// --- Dashboard helpers: chart data, upcoming dues, rendering ---
function getLastNMonths(n) {
    const res = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        res.push({
            label: d.toLocaleString(undefined, { month: 'short', year: 'numeric' }),
            year: d.getFullYear(),
            month: d.getMonth()
        });
    }
    return res;
}

function sumPaidForMonth(year, month) {
    return tenants
        .filter(t => t.status === 'Paid')
        .filter(t => {
            if (!t.dueDate) return false;
            const d = new Date(t.dueDate);
            return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((s, t) => s + (parseFloat(t.rent) || 0), 0);
}

function countStatusForMonth(year, month, status) {
    return tenants
        .filter(t => t.status === status)
        .filter(t => {
            if (!t.dueDate) return false;
            const d = new Date(t.dueDate);
            return d.getFullYear() === year && d.getMonth() === month;
        }).length;
}

function updateUpcomingDueDates() {
    const list = document.getElementById('upcomingDueList');
    if (!list) return;
    // use start/end of day to include dues on 'today'
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(start.getDate() + 7); end.setHours(23,59,59,999);
    const candidates = tenants
        .filter(t => t.status !== 'Paid' && t.dueDate)
        .map(t => ({ ...t, due: new Date(t.dueDate) }));

    const pastDue = candidates.filter(t => t.due < start).sort((a,b) => a.due - b.due);
    const nextWeek = candidates.filter(t => t.due >= start && t.due <= end).sort((a,b) => a.due - b.due);
    const combined = [...pastDue, ...nextWeek];

    if (combined.length === 0) {
        list.innerHTML = '<li style="padding:12px; color:var(--text-secondary);">No upcoming due dates.</li>';
        return;
    }

    list.innerHTML = combined.slice(0, 8).map(t => {
        const dateStr = t.due.toLocaleDateString();
        const isPast = t.due < start;
        const color = isPast ? '#b80000' : 'inherit';
        const propName = t.propertyName || (properties.find(p => p.id === t.propertyId) || {}).name || '';
        const unitName = t.unitName || '';
        const where = [unitName, propName].filter(Boolean).join(' @ ');
        return `<li style="padding:10px; border-bottom:1px solid var(--border-color); color:${color};"><strong>${t.name}</strong>${where ? ` — ${where}` : ''} — ${dateStr} — $${(parseFloat(t.rent)||0).toFixed(2)}</li>`;
    }).join('');
}

function renderMonthlyChart(labels, values) {
    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;
    if (monthlyChartInstance) {
        monthlyChartInstance.data.labels = labels;
        monthlyChartInstance.data.datasets[0].data = values;
        monthlyChartInstance.update();
        return;
    }

    monthlyChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Collected Rent',
                data: values,
                backgroundColor: 'rgba(95,111,230,0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { font: { size: 12 } } },
                tooltip: { bodyFont: { size: 12 }, titleFont: { size: 13 } }
            },
            elements: { bar: { borderRadius: 6 } , point: { radius: 3 } },
            scales: {
                x: { ticks: { font: { size: 11 } } },
                y: { beginAtZero: true, ticks: { font: { size: 11 } } }
            }
        }
    });
}

function renderOccupancyChart(occupied, vacant) {
    const ctx = document.getElementById('occupancyChart');
    if (!ctx) return;
    const data = [occupied, vacant];
    if (occupancyChartInstance) {
        occupancyChartInstance.data.datasets[0].data = data;
        occupancyChartInstance.update();
        return;
    }

    occupancyChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Occupied', 'Vacant'],
            datasets: [{ data: data, backgroundColor: ['#5f6fe6', '#e0e0e0'] }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 12 } } },
                tooltip: { bodyFont: { size: 12 }, titleFont: { size: 13 } }
            }
        }
    });
}

function renderTrendChart(labels, paidData, unpaidData) {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    if (trendChartInstance) {
        trendChartInstance.data.labels = labels;
        trendChartInstance.data.datasets[0].data = paidData;
        trendChartInstance.data.datasets[1].data = unpaidData;
        trendChartInstance.update();
        return;
    }

    trendChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Paid', data: paidData, borderColor: 'green', backgroundColor: 'rgba(0,128,0,0.1)', fill: true },
                { label: 'Unpaid', data: unpaidData, borderColor: 'orange', backgroundColor: 'rgba(255,165,0,0.08)', fill: true }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { font: { size: 12 } } },
                tooltip: { bodyFont: { size: 12 }, titleFont: { size: 13 } }
            },
            elements: { point: { radius: 3 }, line: { tension: 0.2 } },
            scales: {
                x: { ticks: { font: { size: 11 } } },
                y: { ticks: { font: { size: 11 } }, beginAtZero: true }
            }
        }
    });
}


// ================= NOTIFICATIONS =================
let notifications = [];

async function loadNotifications() {
    if (!currentLandlord) return;
    
    // Generate notifications based on tenant data
    notifications = [];
    const today = new Date().toISOString().split('T')[0];
    
    tenants.forEach(tenant => {
        if (tenant.status !== 'Paid' && tenant.dueDate < today) {
            const propName = tenant.propertyName || (properties.find(p => p.id === tenant.propertyId) || {}).name || '';
            const unitName = tenant.unitName || '';
            const where = [unitName, propName].filter(Boolean).join(' @ ');
            notifications.push({
                id: `past-due-${tenant.id}`,
                type: 'past-due',
                title: 'Past Due Payment',
                message: `${tenant.name}${where ? ` (${where})` : ''} has a past due payment of $${tenant.rent}`,
                date: tenant.dueDate,
                unread: true
            });
        } else if (tenant.status !== 'Paid') {
            const dueDate = new Date(tenant.dueDate);
            const daysUntilDue = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
            if (daysUntilDue <= 3 && daysUntilDue >= 0) {
                const propName2 = tenant.propertyName || (properties.find(p => p.id === tenant.propertyId) || {}).name || '';
                const unitName2 = tenant.unitName || '';
                const where2 = [unitName2, propName2].filter(Boolean).join(' @ ');
                notifications.push({
                    id: `reminder-${tenant.id}`,
                    type: 'reminder',
                    title: 'Payment Reminder',
                    message: `${tenant.name}${where2 ? ` (${where2})` : ''} payment of $${tenant.rent} is due in ${daysUntilDue} day(s)`,
                    date: tenant.dueDate,
                    unread: true
                });
            }
        }
    });
    
    // Load saved notifications from Firestore
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('notifications')
            .where('landlordId', '==', currentLandlord.id)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            notifications.push({
                id: doc.id,
                ...data,
                unread: data.unread !== false
            });
        });
    } catch (err) {
        console.error('Failed to load notifications', err);
    }
    
    updateNotificationsDisplay();
}

function updateNotificationsDisplay() {
    const notificationsList = document.getElementById('notificationsList');
    if (!notificationsList) return;
    
    if (notifications.length === 0) {
        notificationsList.innerHTML = '<p>No notifications at this time.</p>';
        return;
    }
    
    notificationsList.innerHTML = notifications.map(notif => `
        <div class="notification-item ${notif.unread ? 'unread' : ''}">
            <h4>${notif.title}</h4>
            <p>${notif.message}</p>
            <div class="time">${notif.date || (notif.createdAt?.toDate ? notif.createdAt.toDate().toLocaleString() : '')}</div>
        </div>
    `).join('');
}

// ================= SETTINGS =================
function loadSettings() {
    // Load dark mode setting
    const darkModeSetting = document.getElementById('darkModeSetting');
    if (darkModeSetting) {
        const isDarkMode = localStorage.getItem('darkMode') === 'true';
        darkModeSetting.checked = isDarkMode;
        darkModeSetting.addEventListener('change', (e) => {
            const isDark = e.target.checked;
            document.body.classList.toggle('dark-mode', isDark);
            const darkModeToggle = document.getElementById('darkModeToggle');
            if (darkModeToggle) {
                darkModeToggle.textContent = isDark ? '☀️' : '🌙';
            }
            localStorage.setItem('darkMode', isDark);
        });
    }
    
    // Load notification settings
    const emailNotif = document.getElementById('settingsEmailNotifications');
    const paymentReminders = document.getElementById('settingsPaymentReminders');
    const pastDueAlerts = document.getElementById('pastDueAlerts');
    
    if (emailNotif) {
        emailNotif.checked = localStorage.getItem('emailNotifications') !== 'false';
        emailNotif.addEventListener('change', (e) => {
            localStorage.setItem('emailNotifications', e.target.checked);
        });
    }
    
    if (paymentReminders) {
        paymentReminders.checked = localStorage.getItem('paymentReminders') !== 'false';
        paymentReminders.addEventListener('change', (e) => {
            localStorage.setItem('paymentReminders', e.target.checked);
        });
    }
    
    if (pastDueAlerts) {
        pastDueAlerts.checked = localStorage.getItem('pastDueAlerts') !== 'false';
        pastDueAlerts.addEventListener('change', (e) => {
            localStorage.setItem('pastDueAlerts', e.target.checked);
        });
    }
}

function exportData() {
    const data = {
        tenants: tenants,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rentify-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert("Data exported successfully!");
}

function confirmClearData() {
    if (!confirm("Are you sure you want to clear all data? This action cannot be undone!")) return;
    if (!confirm("This will delete ALL tenants. Type 'DELETE' to confirm:")) return;
    
    const confirmation = prompt("Type 'DELETE' to confirm:");
    if (confirmation !== 'DELETE') {
        alert("Data deletion cancelled.");
        return;
    }
    
    // Clear all data from Firestore
    if (currentLandlord && typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();
        Promise.all([
            // Delete all tenants
            ...tenants.map(t => t.id ? db.collection('tenants').doc(t.id).delete() : Promise.resolve())
        ]).then(() => {
            tenants = [];
            updateTenantTable();
            updatePaymentTable();
            updateDashboard();
            updateFinancialSummary();
            alert("All data cleared successfully!");
        }).catch(err => {
            console.error('Failed to clear data', err);
            alert("Failed to clear some data. Please try again.");
        });
    }
}

// ================= DARK MODE =================
document.addEventListener('DOMContentLoaded', () => {
    // START LISTENING FOR AUTH CHANGES INSTEAD OF checkAuth()
    listenForAuthChanges(); 

    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        const isDarkMode = localStorage.getItem('darkMode') === 'true';
        if (isDarkMode) { document.body.classList.add('dark-mode'); darkModeToggle.textContent = '☀️'; }

        darkModeToggle.addEventListener('click', () => {
            const isCurrentlyDark = document.body.classList.toggle('dark-mode');
            darkModeToggle.textContent = isCurrentlyDark ? '☀️' : '🌙';
            localStorage.setItem('darkMode', isCurrentlyDark);
            // Update settings checkbox if it exists
            const darkModeSetting = document.getElementById('darkModeSetting');
            if (darkModeSetting) darkModeSetting.checked = isCurrentlyDark;
        });
    }
    
    // Initialize settings when page loads
    loadSettings();
    
    // Close sidebar on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
        }
    });
});