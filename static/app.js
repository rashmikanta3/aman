document.addEventListener("DOMContentLoaded", () => {
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem("dyn_user") || "null");
    } catch (_) {
        currentUser = null;
    }

    const $ = (id) => document.getElementById(id);
    const isAdmin = () => currentUser && currentUser.role === "admin";

    // ---------- Helpers ----------
    function esc(v) {
        return String(v ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    // Local date as YYYY-MM-DD (toISOString gives the UTC date, which is wrong early morning in IST)
    function localToday() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    }

    async function errorMessage(res, fallback) {
        try {
            const j = await res.json();
            if (typeof j.detail === "string") return j.detail;
            if (Array.isArray(j.detail)) return j.detail.map((d) => d.msg).join(", ");
        } catch (_) { /* ignore */ }
        return fallback;
    }

    async function api(url, options) {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(await errorMessage(res, `Request failed (${res.status})`));
        return res.json();
    }

    function jsonOpts(method, body) {
        return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    }

    function setLockIndicator(el, locked) {
        if (locked) {
            el.textContent = isAdmin() ? "🔒 Locked (Admin Override Enabled)" : "🔒 LOCKED (Read-Only)";
            el.className = "lock-indicator locked";
        } else {
            el.textContent = "🔓 Open for Editing";
            el.className = "lock-indicator unlocked";
        }
    }

    function fillTeamSelect(sel, teams, firstOptionLabel, withCircle) {
        sel.innerHTML = "";
        if (firstOptionLabel) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = firstOptionLabel;
            sel.appendChild(o);
        }
        teams.forEach((t) => {
            const o = document.createElement("option");
            o.value = t.id;
            o.textContent = withCircle ? `${t.team_name} (${t.circle})` : t.team_name;
            sel.appendChild(o);
        });
    }

    // ---------- Vehicle KM auto-calc ----------
    function calcKM() {
        const s = parseInt($("vl-start-km").value) || 0;
        const e = parseInt($("vl-end-km").value) || 0;
        $("vl-total-km").value = e >= s ? e - s : 0;
    }
    $("vl-start-km").addEventListener("input", calcKM);
    $("vl-end-km").addEventListener("input", calcKM);

    // ---------- Login / Logout ----------
    if (currentUser) init();

    $("login-form").onsubmit = async (e) => {
        e.preventDefault();
        const errBox = $("login-err");
        try {
            currentUser = await api("/api/login", jsonOpts("POST", {
                username: $("login-user").value.trim(),
                password: $("login-pass").value.trim()
            }));
            localStorage.setItem("dyn_user", JSON.stringify(currentUser));
            errBox.classList.add("hidden");
            init();
        } catch (err) {
            errBox.textContent = err.message || "Login failed";
            errBox.classList.remove("hidden");
        }
    };

    $("btn-logout").onclick = () => {
        localStorage.removeItem("dyn_user");
        location.reload();
    };

    // ---------- Init ----------
    async function init() {
        $("login-view").classList.add("hidden");
        $("app-view").classList.remove("hidden");
        $("display-team-name").textContent = currentUser.display_name;
        $("display-circle").textContent = currentUser.circle;
        $("display-role").textContent = currentUser.role.toUpperCase();

        if (isAdmin()) {
            ["att-admin-circle-box", "att-admin-team-box", "vl-admin-circle-box", "vl-admin-team-box"]
                .forEach((id) => $(id).classList.remove("hidden"));
        } else {
            $("btn-tab-admin").classList.add("hidden");
        }

        const today = localToday();
        $("att-date").value = today;
        $("vl-date").value = today;

        setupTabs();

        try {
            await syncReportTeams();
            if (isAdmin()) {
                await Promise.all([syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
                await loadAdminDirectories();
            }
            await Promise.all([loadDailyAttendance(), loadDailyLog(), loadAssets()]);
        } catch (err) {
            console.error(err);
            alert("Failed to load data: " + err.message);
        }
    }

    function setupTabs() {
        const tabs = ["att", "log", "report", "assets", "admin"];
        tabs.forEach((tab) => {
            const btn = $(`btn-tab-${tab}`);
            if (!btn) return;
            btn.onclick = () => {
                tabs.forEach((x) => {
                    $(`tab-${x}`)?.classList.add("hidden");
                    $(`btn-tab-${x}`)?.classList.remove("active");
                });
                $(`tab-${tab}`).classList.remove("hidden");
                btn.classList.add("active");
            };
        });
    }

    // ---------- Cascading Circle -> Team ----------
    async function fetchTeams(circle, allStatus) {
        const params = new URLSearchParams();
        if (circle) params.set("circle", circle);
        if (allStatus) params.set("all_status", "true");
        return api(`/api/teams?${params.toString()}`);
    }

    async function syncReportTeams() {
        const teams = await fetchTeams($("pdf-circle").value);
        fillTeamSelect($("pdf-team"), teams, "All Teams (Circle Summary)");
    }
    $("pdf-circle").onchange = () => syncReportTeams().catch(console.error);

    async function syncAttTeams() {
        const teams = await fetchTeams($("att-filter-circle").value);
        fillTeamSelect($("att-filter-team"), teams, "All Teams in Circle");
    }
    $("att-filter-circle").onchange = async () => {
        await syncAttTeams();
        loadDailyAttendance();
    };
    $("att-filter-team").onchange = loadDailyAttendance;

    async function syncVlTeams() {
        const teams = await fetchTeams($("vl-filter-circle").value);
        fillTeamSelect($("vl-filter-team"), teams, null);
    }
    $("vl-filter-circle").onchange = async () => {
        await syncVlTeams();
        loadDailyLog();
    };
    $("vl-filter-team").onchange = loadDailyLog;

    async function syncAdminEmpTeams() {
        const teams = await fetchTeams("", true);
        fillTeamSelect($("adm-emp-team"), teams, null, true);
    }

    // ---------- Attendance ----------
    async function loadDailyAttendance() {
        const params = new URLSearchParams({ date_str: $("att-date").value });

        if (currentUser.role === "team") {
            params.set("team_id", currentUser.id);
        } else {
            const c = $("att-filter-circle").value;
            const t = $("att-filter-team").value;
            if (c) params.set("circle", c);   // backend must accept this (see notes)
            if (t) params.set("team_id", t);
        }

        let data;
        try {
            data = await api(`/api/attendance/day?${params.toString()}`);
        } catch (err) {
            alert("Could not load attendance: " + err.message);
            return;
        }

        const canEdit = isAdmin() || !data.is_locked;
        setLockIndicator($("att-lock-status"), data.is_locked);
        $("save-att-btn").disabled = !canEdit;
        $("lock-att-btn").disabled = !canEdit;

        const tbody = $("att-tbody");
        tbody.innerHTML = "";
        data.rows.forEach((r, idx) => {
            const options = ["P", "A", "L", "WO"]
                .map((s) => `<option value="${s}" ${r.status === s ? "selected" : ""}>${s}</option>`)
                .join("");
            const tr = document.createElement("tr");
            tr.setAttribute("data-emp", r.employee_id);
            tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${esc(r.emp_code)}</td>
          <td style="text-align:left; font-weight:bold;">${esc(r.name)}</td>
          <td style="text-align:left;">${esc(r.designation)}</td>
          <td>${esc(r.team_name)}</td>
          <td><select class="att-status" ${!canEdit ? "disabled" : ""}>${options}</select></td>`;
            tbody.appendChild(tr);
        });
    }
    $("att-date").onchange = loadDailyAttendance;

    async function saveAttendance(isLock) {
        const records = Array.from(document.querySelectorAll("#att-tbody tr[data-emp]")).map((r) => ({
            employee_id: parseInt(r.getAttribute("data-emp")),
            status: r.querySelector(".att-status").value
        }));
        if (records.length === 0) return alert("No employees to save.");

        try {
            await api("/api/attendance/submit", jsonOpts("POST", {
                date: $("att-date").value,
                records,
                lock: isLock,
                is_admin: isAdmin()
            }));
            alert(isLock ? "Attendance saved & locked!" : "Attendance saved!");
            loadDailyAttendance();
        } catch (err) {
            alert("Save failed: " + err.message);
        }
    }
    $("save-att-btn").onclick = () => saveAttendance(false);
    $("lock-att-btn").onclick = () => {
        if (confirm("Are you sure? Once locked, team logins cannot modify this date.")) saveAttendance(true);
    };

    // ---------- Vehicle Log ----------
    function getVlTeamId() {
        const v = currentUser.role === "team" ? currentUser.id : $("vl-filter-team").value;
        return v ? parseInt(v) : null;
    }

    function clearVlForm() {
        ["vl-veh-no", "vl-supervisor", "vl-remarks", "vl-start-time", "vl-end-time", "vl-route"]
            .forEach((id) => ($(id).value = ""));
        ["vl-start-km", "vl-end-km", "vl-total-km"].forEach((id) => ($(id).value = 0));
    }

    async function loadDailyLog() {
        const teamId = getVlTeamId();
        if (!teamId) {
            clearVlForm();
            return;
        }

        let data;
        try {
            // Backend returns null when no log exists for that date
            data = (await api(`/api/vehicle-log/day?date_str=${$("vl-date").value}&team_id=${teamId}`)) || {};
        } catch (err) {
            alert("Could not load vehicle log: " + err.message);
            return;
        }

        const locked = !!data.is_locked;
        const canEdit = isAdmin() || !locked;
        setLockIndicator($("log-lock-status"), locked);
        $("save-vl-btn").disabled = !canEdit;
        $("lock-vl-btn").disabled = !canEdit;

        $("vl-veh-no").value = data.vehicle_no || "";
        // The "supervisor" input maps to driver_name in the backend
        $("vl-supervisor").value = data.driver_name || "";
        $("vl-remarks").value = data.remarks || "";
        $("vl-start-time").value = data.start_time || "";
        $("vl-end-time").value = data.end_time || "";
        $("vl-start-km").value = data.start_km || 0;
        $("vl-end-km").value = data.end_km || 0;
        $("vl-total-km").value = data.total_km || 0;
        $("vl-route").value = data.journey_route || "";
    }
    $("vl-date").onchange = loadDailyLog;

    async function saveVehicleLog(isLock) {
        const teamId = getVlTeamId();
        if (!teamId) return alert("Select a team!");

        calcKM();
        const payload = {
            team_id: teamId,
            date: $("vl-date").value,
            vehicle_no: $("vl-veh-no").value.trim(),
            driver_name: $("vl-supervisor").value.trim(),
            remarks: $("vl-remarks").value.trim(),
            start_time: $("vl-start-time").value,
            end_time: $("vl-end-time").value,
            start_km: parseInt($("vl-start-km").value) || 0,
            end_km: parseInt($("vl-end-km").value) || 0,
            total_km: parseInt($("vl-total-km").value) || 0,
            journey_route: $("vl-route").value.trim(),
            lock: isLock,
            is_admin: isAdmin()
        };

        try {
            await api("/api/vehicle-log/submit", jsonOpts("POST", payload));
            alert(isLock ? "Vehicle log locked!" : "Vehicle log saved!");
            loadDailyLog();
        } catch (err) {
            alert("Save failed: " + err.message);
        }
    }
    $("save-vl-btn").onclick = () => saveVehicleLog(false);
    $("lock-vl-btn").onclick = () => {
        if (confirm("Are you sure? Once locked, team logins cannot modify this log.")) saveVehicleLog(true);
    };

    // ---------- PDF Reports ----------
    function reportParams(includeTeam) {
        const params = new URLSearchParams({
            year: $("pdf-year").value,
            month: $("pdf-month").value,
            circle: $("pdf-circle").value
        });
        const t = $("pdf-team").value;
        if (includeTeam && t) params.set("team_id", t);
        return params.toString();
    }

    $("dl-circle-log-pdf").onclick = () => {
        window.open(`/api/reports/download-circle-log-pdf?${reportParams(false)}`, "_blank");
    };
    $("dl-att-pdf").onclick = () => {
        window.open(`/api/reports/download-attendance-pdf?${reportParams(true)}`, "_blank");
    };

    // ---------- Admin Directories ----------
    async function loadAdminDirectories() {
        // Teams
        const teamCircle = $("dir-team-circle").value;
        const teams = await fetchTeams(teamCircle, true);

        let tHtml = `<table><thead><tr><th>Circle</th><th>Team Area</th><th>Team Leader</th><th>Reporting Manager</th><th>Username</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
        teams.forEach((t) => {
            tHtml += `
        <tr>
          <td>${esc(t.circle)}</td>
          <td><strong>${esc(t.team_name)}</strong></td>
          <td>${esc(t.team_leader) || "-"}</td>
          <td>${esc(t.reporting_manager) || "-"}</td>
          <td><code>${esc(t.username)}</code></td>
          <td><strong style="color:${t.is_active ? "#16a34a" : "#dc2626"}">${t.is_active ? "ACTIVE" : "INACTIVE"}</strong></td>
          <td>
            <button class="btn ${t.is_active ? "danger" : "success"} btn-toggle-team" data-id="${t.id}" data-active="${t.is_active}">
              ${t.is_active ? "Deactivate" : "Activate"}
            </button>
          </td>
        </tr>`;
        });
        tHtml += `</tbody></table>`;
        $("adm-team-list").innerHTML = tHtml;

        document.querySelectorAll(".btn-toggle-team").forEach((btn) => {
            btn.onclick = async () => {
                const id = btn.getAttribute("data-id");
                const active = btn.getAttribute("data-active") === "true";
                try {
                    await api(`/api/admin/teams/${id}/toggle-active`, jsonOpts("PUT", { is_active: !active }));
                    await Promise.all([syncReportTeams(), syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
                    await loadAdminDirectories();
                } catch (err) {
                    alert("Update failed: " + err.message);
                }
            };
        });

        // Employees
        const empCircle = $("dir-emp-circle").value;
        const emps = await api(`/api/admin/employees/all?circle=${encodeURIComponent(empCircle)}`);

        let eHtml = `<table><thead><tr><th>Circle</th><th>Team</th><th>Emp Code</th><th>Employee Name</th><th>Designation</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
        emps.forEach((e) => {
            eHtml += `
        <tr>
          <td>${e.team ? esc(e.team.circle) : "-"}</td>
          <td><strong>${e.team ? esc(e.team.team_name) : "-"}</strong></td>
          <td>${esc(e.emp_code)}</td>
          <td>${esc(e.name)}</td>
          <td>${esc(e.designation)}</td>
          <td><strong style="color:${e.is_active ? "#16a34a" : "#dc2626"}">${e.is_active ? "ACTIVE" : "INACTIVE"}</strong></td>
          <td>
            <button class="btn ${e.is_active ? "danger" : "success"} btn-toggle-emp" data-id="${e.id}" data-active="${e.is_active}">
              ${e.is_active ? "Deactivate" : "Activate"}
            </button>
          </td>
        </tr>`;
        });
        eHtml += `</tbody></table>`;
        $("adm-emp-list").innerHTML = eHtml;

        document.querySelectorAll(".btn-toggle-emp").forEach((btn) => {
            btn.onclick = async () => {
                const id = btn.getAttribute("data-id");
                const active = btn.getAttribute("data-active") === "true";
                try {
                    await api(`/api/admin/employees/${id}/toggle-active`, jsonOpts("PUT", { is_active: !active }));
                    await loadAdminDirectories();
                } catch (err) {
                    alert("Update failed: " + err.message);
                }
            };
        });
    }
    $("dir-team-circle").onchange = () => loadAdminDirectories().catch(console.error);
    $("dir-emp-circle").onchange = () => loadAdminDirectories().catch(console.error);

    $("adm-create-team-btn").onclick = async () => {
        const payload = {
            team_name: $("adm-team-name").value.trim(),
            team_leader: $("adm-team-lead").value.trim(),
            circle: $("adm-team-circle").value,
            username: $("adm-team-user").value.trim(),
            password: $("adm-team-pass").value.trim(),
            reporting_manager: $("adm-team-mgr").value.trim()
        };
        // NOTE: the backend TeamCreate has no "supervisor" field, so it is not sent.
        if (!payload.team_name || !payload.username || !payload.password) {
            return alert("Fill all team details!");
        }

        try {
            await api("/api/admin/teams", jsonOpts("POST", payload));
            alert("Team registered successfully!");
            ["adm-team-name", "adm-team-lead", "adm-team-supervisor", "adm-team-user", "adm-team-pass", "adm-team-mgr"]
                .forEach((id) => { if ($(id)) $(id).value = ""; });
            await Promise.all([syncReportTeams(), syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
            await loadAdminDirectories();
        } catch (err) {
            alert("Could not create team: " + err.message);
        }
    };

    $("adm-create-emp-btn").onclick = async () => {
        const payload = {
            emp_code: $("adm-emp-code").value.trim(),
            name: $("adm-emp-name").value.trim(),
            designation: $("adm-emp-desig").value.trim(),
            team_id: parseInt($("adm-emp-team").value)
        };
        if (!payload.emp_code || !payload.name || !payload.team_id) return alert("Fill employee details!");

        try {
            await api("/api/admin/employees", jsonOpts("POST", payload));
            alert("Employee registered!");
            ["adm-emp-code", "adm-emp-name", "adm-emp-desig"].forEach((id) => ($(id).value = ""));
            await loadAdminDirectories();
        } catch (err) {
            alert("Could not create employee: " + err.message);
        }
    };

    // ---------- Document Assets ----------
    async function loadAssets() {
        const tbody = $("assets-tbody");
        if (!tbody) return;

        try {
            const assets = await api("/api/assets");
            tbody.innerHTML = "";

            if (!assets || assets.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px;">No documents available.</td></tr>`;
                return;
            }

            assets.forEach((a, idx) => {
                // Backend stores files locally and returns only `filename`
                const href = a.file_url || `/api/assets/download/${encodeURIComponent(a.filename)}`;
                let actions = `
          <a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="btn success" download style="text-decoration:none; padding:6px 12px; display:inline-block;">
            📥 Download
          </a>`;

                if (isAdmin()) {
                    actions += `
          <button class="btn danger btn-del-asset" data-id="${a.id}" style="margin-left:6px; padding:6px 10px;">
            🗑️ Delete
          </button>`;
                }

                const row = document.createElement("tr");
                row.innerHTML = `
          <td>${idx + 1}</td>
          <td style="text-align:left;"><strong>${esc(a.title)}</strong></td>
          <td><code>${esc(a.filename)}</code></td>
          <td>${actions}</td>`;
                tbody.appendChild(row);
            });

            document.querySelectorAll(".btn-del-asset").forEach((btn) => {
                btn.onclick = async () => {
                    if (!confirm("Are you sure you want to delete this document?")) return;
                    try {
                        await api(`/api/admin/assets/${btn.getAttribute("data-id")}`, { method: "DELETE" });
                        loadAssets();
                    } catch (err) {
                        alert("Failed to delete document: " + err.message);
                    }
                };
            });
        } catch (err) {
            console.error("Error loading documents:", err);
        }
    }

    // ---------- Asset Upload (admin) ----------
    const uploadForm = $("upload-asset-form");
    if (uploadForm) {
        uploadForm.addEventListener("submit", async (e) => {
            e.preventDefault();   // stop the native form submit / page reload

            const titleEl = $("asset-title");
            const fileEl = $("asset-file");
            const submitBtn = uploadForm.querySelector("button[type='submit']");

            const title = titleEl.value.trim();
            const file = fileEl.files[0];
            if (!title || !file) return alert("Enter a title and choose a file!");

            const fd = new FormData();
            fd.append("title", title);   // must match backend param names: title, file
            fd.append("file", file);

            if (submitBtn) submitBtn.disabled = true;
            try {
                // No Content-Type header: the browser sets the multipart boundary itself
                const res = await fetch("/api/admin/assets/upload", { method: "POST", body: fd });
                if (!res.ok) throw new Error(await errorMessage(res, `Upload failed (${res.status})`));
                alert("Document uploaded successfully!");
                uploadForm.reset();
                loadAssets();
            } catch (err) {
                alert("Upload failed: " + err.message);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});