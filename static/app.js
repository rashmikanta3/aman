document.addEventListener("DOMContentLoaded", () => {
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem("dyn_user") || "null");
    } catch (_) {
        currentUser = null;
    }

    const $ = (id) => document.getElementById(id);
    const isAdmin = () => currentUser && currentUser.role === "admin";

    function esc(v) {
        return String(v ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function localToday() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    }

    async function errorMessage(res, fallback) {
        try {
            const j = await res.json();
            if (typeof j.detail === "string") return j.detail;
            if (Array.isArray(j.detail)) {
                return j.detail.map((d) => {
                    const field = d.loc ? d.loc[d.loc.length - 1] : "Field";
                    return `${field}: ${d.msg}`;
                }).join(", ");
            }
        } catch (_) { }
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
        if (!el) return;
        if (locked) {
            el.textContent = isAdmin() ? "🔒 Locked (Admin Override Enabled)" : "🔒 LOCKED (Read-Only)";
            el.className = "lock-indicator locked";
        } else {
            el.textContent = "🔓 Open for Editing";
            el.className = "lock-indicator unlocked";
        }
    }

    function fillTeamSelect(sel, teams, firstOptionLabel, withCircle) {
        if (!sel) return;
        sel.innerHTML = "";
        if (firstOptionLabel) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = firstOptionLabel;
            sel.appendChild(o);
        }
        (teams || []).forEach((t) => {
            const o = document.createElement("option");
            o.value = t.id;
            const tName = t.team_name || t.name || `Team ${t.id}`;
            o.textContent = withCircle ? `${tName} (${t.circle})` : tName;
            sel.appendChild(o);
        });
    }

    function calcKM() {
        const s = parseInt($("vl-start-km")?.value) || 0;
        const e = parseInt($("vl-end-km")?.value) || 0;
        if ($("vl-total-km")) {
            $("vl-total-km").value = e >= s ? e - s : 0;
        }
    }
    $("vl-start-km")?.addEventListener("input", calcKM);
    $("vl-end-km")?.addEventListener("input", calcKM);

    // Toggle merge team input
    $("vl-op-mode")?.addEventListener("change", (e) => {
        if (e.target.value === "Merged") {
            $("vl-merge-box")?.classList.remove("hidden");
        } else {
            $("vl-merge-box")?.classList.add("hidden");
        }
    });

    if (currentUser) init();

    const loginForm = $("login-form");
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const errBox = $("login-err");
            try {
                currentUser = await api("/api/login", jsonOpts("POST", {
                    username: $("login-user").value.trim(),
                    password: $("login-pass").value.trim()
                }));
                localStorage.setItem("dyn_user", JSON.stringify(currentUser));
                if (errBox) errBox.classList.add("hidden");
                init();
            } catch (err) {
                if (errBox) {
                    errBox.textContent = err.message || "Login failed";
                    errBox.classList.remove("hidden");
                } else {
                    alert(err.message || "Login failed");
                }
            }
        };
    }

    const logoutBtn = $("btn-logout");
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem("dyn_user");
            location.reload();
        };
    }

    async function init() {
        $("login-view")?.classList.add("hidden");
        $("app-view")?.classList.remove("hidden");

        if ($("display-team-name")) $("display-team-name").textContent = currentUser.display_name || currentUser.username;
        if ($("display-circle")) $("display-circle").textContent = currentUser.circle || "";
        if ($("display-role")) $("display-role").textContent = (currentUser.role || "user").toUpperCase();

        if (isAdmin()) {
            ["att-admin-circle-box", "att-admin-team-box", "vl-admin-circle-box", "vl-admin-team-box"]
                .forEach((id) => $(id)?.classList.remove("hidden"));
        } else {
            $("btn-tab-admin")?.classList.add("hidden");
        }

        const today = localToday();
        if ($("att-date")) $("att-date").value = today;
        if ($("vl-date")) $("vl-date").value = today;

        setupTabs();

        try {
            await syncReportTeams();
            if (isAdmin()) {
                await Promise.all([syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
                await loadAdminDirectories();
            }
            await Promise.all([loadDailyAttendance(), loadDailyLog(), loadAssets()]);
        } catch (err) {
            console.error("Initialization error:", err);
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
                $(`tab-${tab}`)?.classList.remove("hidden");
                btn.classList.add("active");
            };
        });
    }

    async function fetchTeams(circle, allStatus) {
        const params = new URLSearchParams();
        if (circle) params.set("circle", circle);
        if (allStatus) params.set("all_status", "true");
        return api(`/api/teams?${params.toString()}`);
    }

    async function syncReportTeams() {
        if (!$("pdf-circle") || !$("pdf-team")) return;
        const teams = await fetchTeams($("pdf-circle").value);
        fillTeamSelect($("pdf-team"), teams, "All Teams (Circle Summary)");
    }
    if ($("pdf-circle")) $("pdf-circle").onchange = () => syncReportTeams().catch(console.error);

    async function syncAttTeams() {
        if (!$("att-filter-circle") || !$("att-filter-team")) return;
        const teams = await fetchTeams($("att-filter-circle").value);
        fillTeamSelect($("att-filter-team"), teams, "All Teams in Circle");
    }
    if ($("att-filter-circle")) {
        $("att-filter-circle").onchange = async () => {
            await syncAttTeams();
            loadDailyAttendance();
        };
    }
    if ($("att-filter-team")) $("att-filter-team").onchange = loadDailyAttendance;

    async function syncVlTeams() {
        if (!$("vl-filter-circle") || !$("vl-filter-team")) return;
        const teams = await fetchTeams($("vl-filter-circle").value);
        fillTeamSelect($("vl-filter-team"), teams, null);
    }
    if ($("vl-filter-circle")) {
        $("vl-filter-circle").onchange = async () => {
            await syncVlTeams();
            loadDailyLog();
        };
    }
    if ($("vl-filter-team")) $("vl-filter-team").onchange = loadDailyLog;

    async function syncAdminEmpTeams() {
        if (!$("adm-emp-team")) return;
        const teams = await fetchTeams("", true);
        fillTeamSelect($("adm-emp-team"), teams, null, true);
    }

    // Attendance
    async function loadDailyAttendance() {
        if (!$("att-date") || !$("att-tbody")) return;
        const params = new URLSearchParams({ date_str: $("att-date").value });

        if (currentUser.role === "team") {
            params.set("team_id", currentUser.id);
        } else {
            const c = $("att-filter-circle")?.value;
            const t = $("att-filter-team")?.value;
            if (c) params.set("circle", c);
            if (t) params.set("team_id", t);
        }

        let data;
        try {
            data = await api(`/api/attendance/day?${params.toString()}`);
        } catch (err) {
            console.error("Could not load attendance:", err);
            return;
        }

        const canEdit = isAdmin() || !data.is_locked;
        setLockIndicator($("att-lock-status"), data.is_locked);
        if ($("save-att-btn")) $("save-att-btn").disabled = !canEdit;
        if ($("lock-att-btn")) $("lock-att-btn").disabled = !canEdit;

        const tbody = $("att-tbody");
        tbody.innerHTML = "";
        (data.rows || []).forEach((r, idx) => {
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
    if ($("att-date")) $("att-date").onchange = loadDailyAttendance;

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
    if ($("save-att-btn")) $("save-att-btn").onclick = () => saveAttendance(false);
    if ($("lock-att-btn")) $("lock-att-btn").onclick = () => {
        if (confirm("Are you sure? Once locked, team logins cannot modify this date.")) saveAttendance(true);
    };

    // Vehicle Log
    function getVlTeamId() {
        const v = currentUser.role === "team" ? currentUser.id : $("vl-filter-team")?.value;
        return v ? parseInt(v) : null;
    }

    function clearVlForm() {
        ["vl-veh-no", "vl-supervisor", "vl-remarks", "vl-start-time", "vl-end-time", "vl-route", "vl-merged-team"]
            .forEach((id) => { if ($(id))$(id).value = ""; });
        ["vl-start-km", "vl-end-km", "vl-total-km", "vl-load-booked", "vl-amount-collected", "vl-dc-count"]
            .forEach((id) => { if ($(id))$(id).value = 0; });
        if ($("vl-tl-present")) $("vl-tl-present").value = "true";
        if ($("vl-op-mode")) $("vl-op-mode").value = "Operated Independently";
        $("vl-merge-box")?.classList.add("hidden");
    }

    async function loadDailyLog() {
        const teamId = getVlTeamId();
        if (!teamId || !$("vl-date")) {
            clearVlForm();
            return;
        }

        let data;
        try {
            data = (await api(`/api/vehicle-log/day?date_str=${$("vl-date").value}&team_id=${teamId}`)) || {};
        } catch (err) {
            console.error("Could not load vehicle log:", err);
            return;
        }

        const locked = !!data.is_locked;
        const canEdit = isAdmin() || !locked;
        setLockIndicator($("log-lock-status"), locked);
        if ($("save-vl-btn")) $("save-vl-btn").disabled = !canEdit;
        if ($("lock-vl-btn")) $("lock-vl-btn").disabled = !canEdit;

        if ($("vl-veh-no")) $("vl-veh-no").value = data.vehicle_no || "";
        if ($("vl-supervisor")) $("vl-supervisor").value = data.supervisor || "";
        if ($("vl-remarks")) $("vl-remarks").value = data.remarks || "";
        if ($("vl-start-time")) $("vl-start-time").value = data.start_time || "";
        if ($("vl-end-time")) $("vl-end-time").value = data.end_time || "";
        if ($("vl-start-km")) $("vl-start-km").value = data.start_km || 0;
        if ($("vl-end-km")) $("vl-end-km").value = data.end_km || 0;
        if ($("vl-total-km")) $("vl-total-km").value = data.total_km || 0;
        if ($("vl-route")) $("vl-route").value = data.journey_route || "";

        // Operational fields
        if ($("vl-load-booked")) $("vl-load-booked").value = data.load_booked || 0;
        if ($("vl-amount-collected")) $("vl-amount-collected").value = data.amount_collected || 0;
        if ($("vl-dc-count")) $("vl-dc-count").value = data.number_of_dc || 0;
        if ($("vl-tl-present")) $("vl-tl-present").value = data.team_leader_present !== false ? "true" : "false";
        if ($("vl-op-mode")) {
            $("vl-op-mode").value = data.operation_mode || "Operated Independently";
            if (data.operation_mode === "Merged") {
                $("vl-merge-box")?.classList.remove("hidden");
            } else {
                $("vl-merge-box")?.classList.add("hidden");
            }
        }
        if ($("vl-merged-team")) $("vl-merged-team").value = data.merged_with_team || "";
    }
    if ($("vl-date")) $("vl-date").onchange = loadDailyLog;

    async function saveVehicleLog(isLock) {
        const teamId = getVlTeamId();
        if (!teamId) return alert("Select a team!");

        calcKM();
        const payload = {
            team_id: teamId,
            date: $("vl-date").value,
            vehicle_no: $("vl-veh-no")?.value.trim() || "",
            supervisor: $("vl-supervisor")?.value.trim() || "",
            remarks: $("vl-remarks")?.value.trim() || "",
            start_time: $("vl-start-time")?.value || "",
            end_time: $("vl-end-time")?.value || "",
            start_km: parseInt($("vl-start-km")?.value) || 0,
            end_km: parseInt($("vl-end-km")?.value) || 0,
            total_km: parseInt($("vl-total-km")?.value) || 0,
            journey_route: $("vl-route")?.value.trim() || "",
            load_booked: parseFloat($("vl-load-booked")?.value) || 0.0,
            amount_collected: parseFloat($("vl-amount-collected")?.value) || 0.0,
            number_of_dc: parseInt($("vl-dc-count")?.value) || 0,
            team_leader_present: $("vl-tl-present")?.value === "true",
            operation_mode: $("vl-op-mode")?.value || "Operated Independently",
            merged_with_team: $("vl-merged-team")?.value.trim() || "",
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
    if ($("save-vl-btn")) $("save-vl-btn").onclick = () => saveVehicleLog(false);
    if ($("lock-vl-btn")) $("lock-vl-btn").onclick = () => {
        if (confirm("Are you sure? Once locked, team logins cannot modify this log.")) saveVehicleLog(true);
    };

    // --- PDF Reports Engine ---
    async function downloadPdfFile(url, fallbackFilename, triggerBtn) {
        const originalText = triggerBtn ? triggerBtn.innerHTML : "";
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.innerHTML = "Generating PDF...";
        }

        try {
            const res = await fetch(url);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ detail: "Server error generating PDF" }));
                throw new Error(errData.detail || "Failed to generate PDF");
            }

            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            const disposition = res.headers.get("Content-Disposition");
            let filename = fallbackFilename;
            if (disposition && disposition.includes("filename=")) {
                filename = disposition.split("filename=")[1].replace(/["']/g, "").trim();
            }

            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(blobUrl);
        } catch (err) {
            console.error("PDF Download Error:", err);
            alert("Error downloading PDF: " + err.message);
        } finally {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.innerHTML = originalText;
            }
        }
    }

    const btnTeamLog = $("btn-download-team-log");
    if (btnTeamLog) {
        btnTeamLog.onclick = () => {
            let teamId = $("pdf-team")?.value;
            const year = $("pdf-year")?.value || 2026;
            const month = $("pdf-month")?.value || 10;

            if (!teamId || teamId === "all" || teamId === "") {
                if (currentUser && currentUser.role === "team") {
                    teamId = currentUser.id;
                } else {
                    alert("Please select a specific Team Area from the 'Team Scope' dropdown.");
                    return;
                }
            }

            const url = `/api/reports/download-team-log-pdf?team_id=${encodeURIComponent(teamId)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
            downloadPdfFile(url, `Daily_Log_Team_${teamId}_${month}_${year}.pdf`, btnTeamLog);
        };
    }

    const btnAttPdf = $("dl-att-pdf");
    if (btnAttPdf) {
        btnAttPdf.onclick = () => {
            const circle = $("pdf-circle")?.value || "JEYPORE";
            const teamId = $("pdf-team")?.value || "";
            const year = $("pdf-year")?.value || 2026;
            const month = $("pdf-month")?.value || 10;

            let url = `/api/reports/download-attendance-pdf?circle=${encodeURIComponent(circle)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
            if (teamId && teamId !== "all" && teamId !== "") {
                url += `&team_id=${encodeURIComponent(teamId)}`;
            }

            downloadPdfFile(url, `Form_D_Attendance_${circle}_${month}_${year}.pdf`, btnAttPdf);
        };
    }

    const btnCircleLogPdf = $("dl-circle-log-pdf");
    if (btnCircleLogPdf) {
        btnCircleLogPdf.onclick = () => {
            const circle = $("pdf-circle")?.value || "JEYPORE";
            const year = $("pdf-year")?.value || 2026;
            const month = $("pdf-month")?.value || 10;

            const url = `/api/reports/download-circle-log-pdf?circle=${encodeURIComponent(circle)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
            downloadPdfFile(url, `Circle_Summary_${circle}_${month}_${year}.pdf`, btnCircleLogPdf);
        };
    }

    const btnPerfPdf = $("dl-performance-pdf");
    if (btnPerfPdf) {
        btnPerfPdf.onclick = () => {
            const circle = $("pdf-circle")?.value || "JEYPORE";
            const teamId = $("pdf-team")?.value || "";
            const year = $("pdf-year")?.value || 2026;
            const month = $("pdf-month")?.value || 10;

            let url = `/api/reports/download-performance-pdf?circle=${encodeURIComponent(circle)}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
            if (teamId && teamId !== "all" && teamId !== "") {
                url += `&team_id=${encodeURIComponent(teamId)}`;
            }
            downloadPdfFile(url, `Team_Performance_${circle}_${month}_${year}.pdf`, btnPerfPdf);
        };
    }

    // Admin Directories
    async function loadAdminDirectories() {
        const teamCircle = $("dir-team-circle")?.value || "";
        const teams = await fetchTeams(teamCircle, true);

        let tHtml = `<table><thead><tr><th>Circle</th><th>Team Area</th><th>Team Leader</th><th>Supervisor</th><th>Reporting Manager</th><th>Username</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
        (teams || []).forEach((t) => {
            const tName = t.team_name || t.name || "-";
            tHtml += `
        <tr>
          <td>${esc(t.circle)}</td>
          <td><strong>${esc(tName)}</strong></td>
          <td>${esc(t.team_lead) || "-"}</td>
          <td>${esc(t.supervisor) || "-"}</td>
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
        if ($("adm-team-list")) $("adm-team-list").innerHTML = tHtml;

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

        const empCircle = $("dir-emp-circle")?.value || "";
        const emps = await api(`/api/admin/employees/all?circle=${encodeURIComponent(empCircle)}`);

        let eHtml = `<table><thead><tr><th>Circle</th><th>Team</th><th>Emp Code</th><th>Employee Name</th><th>Designation</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
        (emps || []).forEach((e) => {
            const tName = e.team ? (e.team.team_name || e.team.name) : "-";
            eHtml += `
        <tr>
          <td>${e.team ? esc(e.team.circle) : "-"}</td>
          <td><strong>${esc(tName)}</strong></td>
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
        if ($("adm-emp-list")) $("adm-emp-list").innerHTML = eHtml;

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

    if ($("dir-team-circle")) $("dir-team-circle").onchange = () => loadAdminDirectories().catch(console.error);
    if ($("dir-emp-circle")) $("dir-emp-circle").onchange = () => loadAdminDirectories().catch(console.error);

    const createTeamBtn = $("adm-create-team-btn");
    if (createTeamBtn) {
        createTeamBtn.onclick = async () => {
            const rawName = ($("adm-team-name")?.value || "").trim();
            const rawCircle = ($("adm-team-circle")?.value || "").trim();
            const rawUser = ($("adm-team-user")?.value || "").trim();
            const rawPass = ($("adm-team-pass")?.value || "").trim();
            const rawLead = ($("adm-team-lead")?.value || "").trim();
            const rawSup = ($("adm-team-supervisor")?.value || "").trim();
            const rawMgr = ($("adm-team-mgr")?.value || "").trim();

            if (!rawName) return alert("Please enter Team Name!");
            if (!rawCircle) return alert("Please select Circle!");
            if (!rawUser) return alert("Please enter Username!");
            if (!rawPass) return alert("Please enter Password!");

            const payload = {
                team_name: rawName,
                team_lead: rawLead,
                supervisor: rawSup,
                circle: rawCircle,
                username: rawUser,
                password: rawPass,
                reporting_manager: rawMgr
            };

            try {
                await api("/api/admin/teams", jsonOpts("POST", payload));
                alert("Team registered successfully!");
                ["adm-team-name", "adm-team-lead", "adm-team-supervisor", "adm-team-user", "adm-team-pass"]
                    .forEach((id) => { if ($(id))$(id).value = ""; });
                await Promise.all([syncReportTeams(), syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not create team: " + err.message);
            }
        };
    }

    const createEmpBtn = $("adm-create-emp-btn");
    if (createEmpBtn) {
        createEmpBtn.onclick = async () => {
            const payload = {
                emp_code: $("adm-emp-code")?.value.trim() || "",
                name: $("adm-emp-name")?.value.trim() || "",
                designation: $("adm-emp-desig")?.value.trim() || "",
                team_id: parseInt($("adm-emp-team")?.value) || null
            };
            if (!payload.emp_code || !payload.name || !payload.team_id) return alert("Fill employee details!");

            try {
                await api("/api/admin/employees", jsonOpts("POST", payload));
                alert("Employee registered!");
                ["adm-emp-code", "adm-emp-name", "adm-emp-desig"].forEach((id) => { if ($(id))$(id).value = ""; });
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not create employee: " + err.message);
            }
        };
    }

    // Cloudflare R2 Document Assets
    async function loadAssets() {
        const tbody = $("assets-tbody");
        if (!tbody) return;

        try {
            const assets = await api("/api/assets");
            tbody.innerHTML = "";

            if (!assets || assets.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color:#6b7280;">No documents available.</td></tr>`;
                return;
            }

            assets.forEach((a, idx) => {
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

    const uploadForm = $("upload-asset-form");
    if (uploadForm) {
        uploadForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const titleEl = $("asset-title");
            const fileEl = $("asset-file");
            const submitBtn = uploadForm.querySelector("button[type='submit']");

            const title = titleEl ? titleEl.value.trim() : "";
            const file = fileEl && fileEl.files ? fileEl.files[0] : null;
            if (!title || !file) return alert("Enter a title and choose a file!");

            const fd = new FormData();
            fd.append("title", title);
            fd.append("file", file);

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Uploading to Cloudflare R2...";
            }

            try {
                const res = await fetch("/api/admin/assets/upload", { method: "POST", body: fd });
                if (!res.ok) throw new Error(await errorMessage(res, `Upload failed (${res.status})`));
                alert("Document uploaded successfully!");
                uploadForm.reset();
                loadAssets();
            } catch (err) {
                alert("Upload failed: " + err.message);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Upload Document";
                }
            }
        });
    }
});