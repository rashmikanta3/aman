document.addEventListener("DOMContentLoaded", () => {
    // =====================================================================
    // CORE HELPERS
    // =====================================================================
    const DEFAULT_MANAGER = "Executive Engg, Enforcement Cell, TPSODL";
    const ALL_CIRCLE_VALUES = ["", "ALL", "All Circles"];
    const VIEW_ONLY_MSG = "You have view-only access.";

    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem("dyn_user") || "null");
    } catch (_) {
        currentUser = null;
    }

    const $ = (id) => document.getElementById(id);
    const isAdmin = () => !!currentUser && currentUser.role === "admin";
    const isTeam = () => !!currentUser && currentUser.role === "team";
    const isSubAdmin = () => !!currentUser && currentUser.role === "subadmin";

    // NOTE: these checks only control the UI. The backend must enforce the
    // same rules, because anything stored in localStorage can be edited.
    const hasEditRight = () => {
        if (isAdmin()) return true;
        if (isSubAdmin()) return currentUser?.permission_mode !== "VIEW_ONLY";
        return true;
    };

    // assigned_circles may arrive as an array or as a "JEYPORE,RAYAGADA" string.
    const getAssignedCircles = () => {
        const raw = currentUser?.assigned_circles;
        const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
        return list.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    };

    // Hide circle options a sub-admin isn't assigned to (including "ALL"),
    // and move the selection to the first permitted circle if needed.
    function filterDropdownForSubAdmin(selectId) {
        const el = $(selectId);
        if (!el || !isSubAdmin()) return;

        const allowed = getAssignedCircles();
        const isAllowed = (v) => allowed.includes(String(v).trim().toUpperCase());

        Array.from(el.options).forEach((opt) => {
            const ok = isAllowed(opt.value);
            opt.hidden = !ok;
            opt.disabled = !ok;
        });

        if (!isAllowed(el.value)) {
            const first = Array.from(el.options).find((o) => isAllowed(o.value));
            if (first) el.value = first.value;
        }
    }

    const normCircle = (c) => (ALL_CIRCLE_VALUES.includes(c || "") ? "" : c);

    function esc(v) {
        return String(v ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function localToday() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    }

    function setVal(id, value) {
        const el = $(id);
        if (el) el.value = value ?? "";
    }

    function show(el, visible) {
        if (!el) return;
        el.classList.toggle("hidden", !visible);
        el.style.display = visible ? "inline-block" : "none";
    }

    // Swap a button's label while a request is running, restore it afterwards
    function setBusy(btn, busy, busyText) {
        if (!btn) return;
        if (busy) {
            btn.dataset.origHtml = btn.innerHTML;
            btn.innerHTML = busyText;
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.origHtml || btn.innerHTML;
            btn.disabled = false;
        }
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
        } catch (_) { /* ignore */ }
        return fallback;
    }

    async function api(url, options) {
        const method = String(options?.method || "GET").toUpperCase();
        if (method !== "GET" && !url.startsWith("/api/login") && !hasEditRight()) {
            throw new Error(VIEW_ONLY_MSG);
        }
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

    async function fetchTeams(circle, allStatus) {
        const params = new URLSearchParams();
        const c = normCircle(circle);
        if (c) params.set("circle", c);
        if (allStatus) params.set("all_status", "true");
        return api(`/api/teams?${params.toString()}`);
    }

    // =====================================================================
    // LOGIN / LOGOUT
    // =====================================================================
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
                errBox?.classList.add("hidden");
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

    if ($("btn-logout")) {
        $("btn-logout").onclick = () => {
            localStorage.removeItem("dyn_user");
            location.reload();
        };
    }

    // =====================================================================
    // INIT + TABS
    // =====================================================================
    async function init() {
        if (isAdmin() || isSubAdmin()) {
            ["att-admin-circle-box", "att-admin-team-box", "vl-admin-circle-box", "vl-admin-team-box"]
                .forEach((id) => $(id)?.classList.remove("hidden"));
            $("btn-tab-admin")?.classList.remove("hidden");
        } else {
            $("btn-tab-admin")?.classList.add("hidden");
        }

        if (isSubAdmin()) {
            // 1. Restrict circles across all dropdowns
            [
                "att-filter-circle",
                "vl-filter-circle",
                "pdf-circle",
                "emailCircleSelect",
                "verify-filter-circle",
                "dir-team-circle",
                "dir-emp-circle",
                "adm-team-circle"
            ].forEach((id) => filterDropdownForSubAdmin(id));

            // 2. Hide sub-admin creation section from sub-admins
            const subAdminBox = $("subadmin-management-box");
            if (subAdminBox) subAdminBox.style.display = "none";

            // 3. View-only sub-admins: hide editing controls
            if (!hasEditRight()) {
                ["save-att-btn", "lock-att-btn", "save-vl-btn", "lock-vl-btn",
                    "adm-create-team-btn", "adm-create-emp-btn"]
                    .forEach((id) => $(id)?.style.setProperty("display", "none"));
            }
        }

        $("login-view")?.classList.add("hidden");
        $("app-view")?.classList.remove("hidden");

        if ($("display-team-name")) $("display-team-name").textContent = currentUser.display_name || currentUser.username || "";
        if ($("display-circle")) $("display-circle").textContent = currentUser.circle || "";
        if ($("display-role")) $("display-role").textContent = (currentUser.role || "user").toUpperCase();

        const today = localToday();
        setVal("att-date", today);
        setVal("vl-date", today);
        setVal("verify-date", today);
        setVal("emailDateSelect", today);

        setupTabs();

        // Team users are locked to their own circle in the report tab
        if (isTeam() && $("pdf-circle") && currentUser.circle) {
            $("pdf-circle").value = currentUser.circle;
            $("pdf-circle").disabled = true;
        }

        try {
            await syncReportTeams();
            if (isAdmin() || isSubAdmin()) {
                await Promise.all([syncAttTeams(), syncVlTeams()]);
                await syncAdminEmpTeams();
                await loadAdminDirectories();
            }
            await Promise.all([loadDailyAttendance(), loadDailyLog(), loadAssets()]);
        } catch (err) {
            console.error("Initialization error:", err);
        }
    }

    function setupTabs() {
        const tabs = ["att", "log", "report", "assets", "admin", "verify"];
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
                if (tab === "verify") initVerificationTab();
            };
        });
    }

    // =====================================================================
    // DAILY ATTENDANCE
    // =====================================================================
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
    if ($("att-date")) $("att-date").onchange = loadDailyAttendance;

    async function loadDailyAttendance() {
        if (!$("att-date") || !$("att-tbody") || !$("att-date").value) return;
        const params = new URLSearchParams({ date_str: $("att-date").value });

        if (isTeam()) {
            params.set("team_id", currentUser.id);
        } else {
            const c = normCircle($("att-filter-circle")?.value);
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

        const canEdit = hasEditRight() && (isAdmin() || !data.is_locked);
        setLockIndicator($("att-lock-status"), data.is_locked);
        if ($("save-att-btn")) $("save-att-btn").disabled = !canEdit;
        if ($("lock-att-btn")) $("lock-att-btn").disabled = !canEdit;

        const tbody = $("att-tbody");
        tbody.innerHTML = "";
        (data.rows || []).forEach((r, idx) => {
            const options = ["P", "A", "L", "WO", "-"]
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

    async function saveAttendance(isLock) {
        const records = Array.from(document.querySelectorAll("#att-tbody tr[data-emp]")).map((r) => ({
            employee_id: parseInt(r.getAttribute("data-emp"), 10),
            status: r.querySelector(".att-status").value
        }));
        if (records.length === 0) return alert("No employees to save.");

        try {
            // is_admin is kept because the backend model expects it, but the
            // server must verify admin status itself (see notes).
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
    if ($("lock-att-btn")) {
        $("lock-att-btn").onclick = () => {
            if (confirm("Are you sure? Once locked, team logins cannot modify this date.")) saveAttendance(true);
        };
    }

    // =====================================================================
    // VEHICLE LOG & TL OPERATION MODE LOGIC
    // =====================================================================
    // True when the currently loaded log is locked for a non-admin user.
    let vlLockedForUser = false;

    function calcKM() {
        const s = parseInt($("vl-start-km")?.value, 10) || 0;
        const e = parseInt($("vl-end-km")?.value, 10) || 0;
        if ($("vl-total-km")) $("vl-total-km").value = e >= s ? e - s : 0;
    }
    $("vl-start-km")?.addEventListener("input", calcKM);
    $("vl-end-km")?.addEventListener("input", calcKM);

    // Enable/disable the TL and operation-mode controls from one place so
    // they can never get stuck disabled after viewing a locked log.
    function applyVlControlState() {
        const editable = hasEditRight() && !vlLockedForUser;
        const tlPresent = $("vl-tl-present")?.value === "true";

        if ($("vl-tl-present")) $("vl-tl-present").disabled = !editable;
        // With the TL present the mode is fixed, so it always stays disabled.
        if ($("vl-op-mode")) $("vl-op-mode").disabled = tlPresent || !editable;
    }

    function updateOperationModeUI() {
        const tlPresent = $("vl-tl-present")?.value === "true";
        const opModeSelect = $("vl-op-mode");
        const mergeBox = $("vl-merge-box");
        if (!opModeSelect) return;

        if (tlPresent) {
            opModeSelect.innerHTML = `<option value="Operate with Team Leader" selected>Operate with Team Leader</option>`;
            mergeBox?.classList.add("hidden");
            setVal("vl-merged-team", "");
        } else {
            const currentVal = opModeSelect.value;
            opModeSelect.innerHTML = `
                <option value="Operated Independently">Operate Independently</option>
                <option value="Merged">Merge with Other Team</option>
                <option value="Did Not Operate">Did Not Operate</option>`;

            opModeSelect.value = (currentVal === "Merged" || currentVal === "Did Not Operate")
                ? currentVal
                : "Operated Independently";
            mergeBox?.classList.toggle("hidden", opModeSelect.value !== "Merged");
        }
        applyVlControlState();
    }

    $("vl-tl-present")?.addEventListener("change", updateOperationModeUI);

    $("vl-op-mode")?.addEventListener("change", (e) => {
        $("vl-merge-box")?.classList.toggle("hidden", e.target.value !== "Merged");
    });

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
    if ($("vl-date")) $("vl-date").onchange = loadDailyLog;

    function getVlTeamId() {
        const v = isTeam() ? currentUser.id : $("vl-filter-team")?.value;
        return v ? parseInt(v, 10) : null;
    }

    function clearVlForm() {
        ["vl-veh-no", "vl-supervisor", "vl-remarks", "vl-start-time", "vl-end-time", "vl-route", "vl-merged-team"]
            .forEach((id) => setVal(id, ""));
        ["vl-start-km", "vl-end-km", "vl-total-km", "vl-load-booked", "vl-amount-collected", "vl-dc-count"]
            .forEach((id) => setVal(id, 0));
        vlLockedForUser = false;
        setVal("vl-tl-present", "true");
        updateOperationModeUI();
    }

    async function loadDailyLog() {
        const teamId = getVlTeamId();
        if (!teamId || !$("vl-date") || !$("vl-date").value) {
            clearVlForm();
            return;
        }

        let data;
        try {
            data = (await api(`/api/vehicle-log/day?date_str=${encodeURIComponent($("vl-date").value)}&team_id=${teamId}`)) || {};
        } catch (err) {
            console.error("Could not load vehicle log:", err);
            return;
        }

        const locked = !!data.is_locked;
        vlLockedForUser = locked && !isAdmin();
        const canEdit = hasEditRight() && (isAdmin() || !locked);
        setLockIndicator($("log-lock-status"), locked);
        if ($("save-vl-btn")) $("save-vl-btn").disabled = !canEdit;
        if ($("lock-vl-btn")) $("lock-vl-btn").disabled = !canEdit;

        setVal("vl-veh-no", data.vehicle_no || "");
        setVal("vl-supervisor", data.supervisor || "");
        setVal("vl-remarks", data.remarks || "");
        setVal("vl-start-time", data.start_time || "");
        setVal("vl-end-time", data.end_time || "");
        setVal("vl-start-km", data.start_km || 0);
        setVal("vl-end-km", data.end_km || 0);
        setVal("vl-total-km", data.total_km || 0);
        setVal("vl-route", data.journey_route || "");

        setVal("vl-load-booked", data.load_booked || 0);
        setVal("vl-amount-collected", data.amount_collected || 0);
        setVal("vl-dc-count", data.number_of_dc || 0);
        setVal("vl-tl-present", data.team_leader_present !== false ? "true" : "false");

        // Rebuild the mode options according to TL presence
        updateOperationModeUI();

        // Apply the saved mode only if it is a valid option for the current TL state
        const modeSel = $("vl-op-mode");
        if (data.operation_mode && modeSel) {
            const valid = Array.from(modeSel.options).some((o) => o.value === data.operation_mode);
            if (valid) modeSel.value = data.operation_mode;
            $("vl-merge-box")?.classList.toggle("hidden", modeSel.value !== "Merged");
        }
        setVal("vl-merged-team", data.merged_with_team || "");

        // Final enable/disable pass (handles locked logs and view-only users)
        applyVlControlState();
    }

    async function saveVehicleLog(isLock) {
        const teamId = getVlTeamId();
        if (!teamId) return alert("Select a team!");

        calcKM();

        const isTlPresent = $("vl-tl-present")?.value === "true";
        const selectedMode = isTlPresent ? "Operate with Team Leader" : ($("vl-op-mode")?.value || "Operated Independently");

        const payload = {
            team_id: teamId,
            date: $("vl-date").value,
            vehicle_no: $("vl-veh-no")?.value.trim() || "",
            supervisor: $("vl-supervisor")?.value.trim() || "",
            remarks: $("vl-remarks")?.value.trim() || "",
            start_time: $("vl-start-time")?.value || "",
            end_time: $("vl-end-time")?.value || "",
            start_km: parseInt($("vl-start-km")?.value, 10) || 0,
            end_km: parseInt($("vl-end-km")?.value, 10) || 0,
            total_km: parseInt($("vl-total-km")?.value, 10) || 0,
            journey_route: $("vl-route")?.value.trim() || "",
            load_booked: parseFloat($("vl-load-booked")?.value) || 0.0,
            amount_collected: parseFloat($("vl-amount-collected")?.value) || 0.0,
            number_of_dc: parseInt($("vl-dc-count")?.value, 10) || 0,
            team_leader_present: isTlPresent,
            operation_mode: selectedMode,
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
    if ($("lock-vl-btn")) {
        $("lock-vl-btn").onclick = () => {
            if (confirm("Are you sure? Once locked, team logins cannot modify this log.")) saveVehicleLog(true);
        };
    }

    // =====================================================================
    // PDF & EXCEL REPORTS
    // =====================================================================
    async function syncReportTeams() {
        if (!$("pdf-circle") || !$("pdf-team")) return;
        let teams = await fetchTeams($("pdf-circle").value);
        if (isTeam()) teams = teams.filter((t) => t.id === currentUser.id);
        fillTeamSelect($("pdf-team"), teams, isTeam() ? null : "All Teams (Circle Summary)");
    }
    if ($("pdf-circle")) $("pdf-circle").onchange = () => syncReportTeams().catch(console.error);

    async function downloadReportFile(url, fallbackFilename, triggerBtn, busyText = "Generating...") {
        const originalHtml = triggerBtn ? triggerBtn.innerHTML : "";
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.innerHTML = busyText;
        }

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(await errorMessage(res, "Failed to generate report file"));

            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            let filename = fallbackFilename;
            const disposition = res.headers.get("Content-Disposition");
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
            console.error("Report Download Error:", err);
            alert("Error downloading report: " + err.message);
        } finally {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.innerHTML = originalHtml;
            }
        }
    }

    function reportParams() {
        // Fall back to a circle the user is actually allowed to see
        let fallbackCircle = "JEYPORE";
        if (isSubAdmin()) fallbackCircle = getAssignedCircles()[0] || fallbackCircle;
        else if (isTeam() && currentUser?.circle) fallbackCircle = currentUser.circle;

        return {
            circle: $("pdf-circle")?.value || fallbackCircle,
            teamId: $("pdf-team")?.value || "",
            year: $("pdf-year")?.value || new Date().getFullYear(),
            month: $("pdf-month")?.value || (new Date().getMonth() + 1)
        };
    }

    // Builds a report URL and wires it to a download button.
    // kind: "circle" -> circle/year/month (+ optional team_id)
    //       "team"   -> team_id/year/month (team required)
    function bindReport(btnId, kind, endpoint, ext, filePrefix, busyText) {
        const btn = $(btnId);
        if (!btn) return;

        btn.onclick = () => {
            const p = reportParams();
            const enc = encodeURIComponent;
            let url;
            let name;

            if (kind === "team") {
                let teamId = p.teamId;
                if (!teamId) {
                    if (isTeam()) teamId = currentUser.id;
                    else return alert("Please select a specific Team Area from the 'Team Scope' dropdown.");
                }
                url = `${endpoint}?team_id=${enc(teamId)}&year=${enc(p.year)}&month=${enc(p.month)}`;
                name = `${filePrefix}_${teamId}_${p.month}_${p.year}.${ext}`;
            } else {
                url = `${endpoint}?circle=${enc(p.circle)}&year=${enc(p.year)}&month=${enc(p.month)}`;
                if (kind === "circle+team" && p.teamId) url += `&team_id=${enc(p.teamId)}`;
                name = `${filePrefix}_${p.circle}_${p.month}_${p.year}.${ext}`;
            }

            downloadReportFile(url, name, btn, busyText);
        };
    }

    const GEN_PDF = "Generating PDF...";
    const GEN_XLS = "Generating Excel...";

    // 1. Form D Attendance
    bindReport("dl-att-pdf", "circle+team", "/api/reports/download-attendance-pdf", "pdf", "Form_D_Attendance", GEN_PDF);
    bindReport("dl-att-excel", "circle+team", "/api/reports/download-attendance-excel", "xlsx", "Form_D_Attendance", GEN_XLS);

    // 2. Circle Vehicle Log Summary
    bindReport("dl-circle-log-pdf", "circle", "/api/reports/download-circle-log-pdf", "pdf", "Circle_Summary", GEN_PDF);
    bindReport("dl-circle-log-excel", "circle", "/api/reports/download-circle-log-excel", "xlsx", "Circle_Summary", GEN_XLS);

    // 3. Team Daily Vehicle Log Book
    bindReport("btn-download-team-log", "team", "/api/reports/download-team-log-pdf", "pdf", "Daily_Log_Team", GEN_PDF);
    bindReport("btn-download-team-log-excel", "team", "/api/reports/download-team-log-excel", "xlsx", "Daily_Log_Team", GEN_XLS);

    // 4. Team Performance Report
    bindReport("dl-performance-pdf", "circle+team", "/api/reports/download-performance-pdf", "pdf", "Team_Performance", GEN_PDF);
    bindReport("dl-performance-excel", "circle+team", "/api/reports/download-performance-excel", "xlsx", "Team_Performance", GEN_XLS);

    // =====================================================================
    // DOCUMENT CENTER (Cloudflare R2)
    // =====================================================================
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
          <button class="btn danger btn-del-asset" data-id="${esc(a.id)}" style="margin-left:6px; padding:6px 10px;">
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
                        await api(`/api/admin/assets/${encodeURIComponent(btn.getAttribute("data-id"))}`, { method: "DELETE" });
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
            if (!hasEditRight()) return alert(VIEW_ONLY_MSG);

            const title = $("asset-title")?.value.trim() || "";
            const file = $("asset-file")?.files?.[0] || null;
            const submitBtn = uploadForm.querySelector("button[type='submit']");
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

    // =====================================================================
    // ADMIN: TEAMS + EMPLOYEES
    // =====================================================================
    async function syncAdminEmpTeams() {
        if (!$("adm-emp-team")) return;
        const teams = await fetchTeams("", true);
        fillTeamSelect($("adm-emp-team"), teams, null, true);
    }

    async function refreshAllTeamSelects() {
        await Promise.all([syncReportTeams(), syncAttTeams(), syncVlTeams(), syncAdminEmpTeams()]);
    }

    async function loadAdminDirectories() {
        // ---- Teams ----
        const teams = await fetchTeams($("dir-team-circle")?.value || "", true);

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
            <button class="btn ${t.is_active ? "danger" : "success"} btn-toggle-team" data-id="${esc(t.id)}" data-active="${t.is_active}">
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
                    await api(`/api/admin/teams/${encodeURIComponent(id)}/toggle-active`, jsonOpts("PUT", { is_active: !active }));
                    await refreshAllTeamSelects();
                    await loadAdminDirectories();
                } catch (err) {
                    alert("Update failed: " + err.message);
                }
            };
        });

        // ---- Employees ----
        const empCircle = normCircle($("dir-emp-circle")?.value) || "";
        const emps = await api(`/api/admin/employees/all?circle=${encodeURIComponent(empCircle)}`);

        let eHtml = `<table><thead><tr><th>Circle</th><th>Team</th><th>Emp Code</th><th>Employee Name</th><th>Designation</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
        (emps || []).forEach((e) => {
            const active = e.is_active !== false;
            eHtml += `
        <tr>
          <td>${esc(e.circle || "-")}</td>
          <td><strong>${esc(e.team_name || "-")}</strong></td>
          <td>${esc(e.emp_code)}</td>
          <td>${esc(e.name)}</td>
          <td>${esc(e.designation)}</td>
          <td><strong style="color:${active ? "#16a34a" : "#dc2626"}">${active ? "ACTIVE" : "INACTIVE"}</strong></td>
          <td>
            <button class="btn ${active ? "danger" : "success"} btn-toggle-emp" data-id="${esc(e.id)}" data-active="${active}">
              ${active ? "Deactivate" : "Activate"}
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
                    await api(`/api/admin/employees/${encodeURIComponent(id)}/toggle-active`, jsonOpts("PUT", { is_active: !active }));
                    await loadAdminDirectories();
                } catch (err) {
                    alert("Update failed: " + err.message);
                }
            };
        });
    }

    if ($("dir-team-circle")) $("dir-team-circle").onchange = () => loadAdminDirectories().catch(console.error);
    if ($("dir-emp-circle")) $("dir-emp-circle").onchange = () => loadAdminDirectories().catch(console.error);

    // ---- Team form: create / search / update / cancel ----
    const TEAM_FIELDS = ["adm-team-name", "adm-team-lead", "adm-team-supervisor", "adm-team-user", "adm-team-pass"];

    function setTeamEditMode(editing) {
        show($("adm-update-team-btn"), editing);
        show($("adm-cancel-team-btn"), editing);
        show($("adm-create-team-btn"), !editing);
    }

    function resetTeamForm() {
        setVal("adm-edit-team-id", "");
        TEAM_FIELDS.forEach((id) => setVal(id, ""));
        setVal("adm-team-mgr", DEFAULT_MANAGER);
        setVal("adm-search-team-query", "");
        if ($("adm-team-msg")) $("adm-team-msg").textContent = "";
        setTeamEditMode(false);
    }

    function teamFormValues() {
        return {
            name: ($("adm-team-name")?.value || "").trim(),
            lead: ($("adm-team-lead")?.value || "").trim(),
            supervisor: ($("adm-team-supervisor")?.value || "").trim(),
            circle: ($("adm-team-circle")?.value || "").trim(),
            username: ($("adm-team-user")?.value || "").trim(),
            password: ($("adm-team-pass")?.value || "").trim(),
            manager: ($("adm-team-mgr")?.value || "").trim()
        };
    }

    if ($("adm-create-team-btn")) {
        $("adm-create-team-btn").onclick = async () => {
            const v = teamFormValues();
            if (!v.name) return alert("Please enter Team Name!");
            if (!v.circle) return alert("Please select Circle!");
            if (!v.username) return alert("Please enter Username!");
            if (!v.password) return alert("Please enter Password!");

            try {
                await api("/api/admin/teams", jsonOpts("POST", {
                    team_name: v.name,
                    team_lead: v.lead,
                    supervisor: v.supervisor,
                    circle: v.circle,
                    username: v.username,
                    password: v.password,
                    reporting_manager: v.manager
                }));
                alert("Team registered successfully!");
                resetTeamForm();
                await refreshAllTeamSelects();
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not create team: " + err.message);
            }
        };
    }

    if ($("adm-search-team-btn")) {
        $("adm-search-team-btn").onclick = async () => {
            const query = $("adm-search-team-query")?.value.trim();
            if (!query) return alert("Enter Team Name or Username to search!");

            const btn = $("adm-search-team-btn");
            setBusy(btn, true, "Searching...");
            try {
                const data = await api(`/api/admin/team/search?query=${encodeURIComponent(query)}`);

                setVal("adm-edit-team-id", data.id);
                setVal("adm-team-name", data.name || data.team_name);
                setVal("adm-team-lead", data.team_lead);
                setVal("adm-team-supervisor", data.supervisor_name || data.supervisor);
                setVal("adm-team-circle", data.circle);
                setVal("adm-team-mgr", data.reporting_manager || DEFAULT_MANAGER);
                setVal("adm-team-user", data.login_username || data.username);
                setVal("adm-team-pass", data.password);

                setTeamEditMode(true);
                const msg = $("adm-team-msg");
                if (msg) {
                    msg.textContent = `Editing Team: ${data.name || data.team_name}`;
                    msg.style.color = "#2563eb";
                }
            } catch (err) {
                alert("Team not found: " + err.message);
            } finally {
                setBusy(btn, false);
            }
        };
    }

    if ($("adm-update-team-btn")) {
        $("adm-update-team-btn").onclick = async () => {
            const id = $("adm-edit-team-id")?.value;
            if (!id) return alert("Search for a team first.");
            const v = teamFormValues();
            if (!v.name) return alert("Please enter Team Name!");

            // Matches TeamDetailUpdate in main.py
            const payload = {
                name: v.name,
                team_lead: v.lead || null,
                supervisor_name: v.supervisor || null,
                circle: v.circle || null,
                login_username: v.username || null,
                reporting_manager: v.manager || null,
                password: v.password || null
            };

            const btn = $("adm-update-team-btn");
            setBusy(btn, true, "Updating...");
            try {
                await api(`/api/admin/team/${encodeURIComponent(id)}`, jsonOpts("PUT", payload));
                alert("Team updated successfully!");
                resetTeamForm();
                await refreshAllTeamSelects();
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not update team: " + err.message);
            } finally {
                setBusy(btn, false);
            }
        };
    }

    if ($("adm-cancel-team-btn")) {
        $("adm-cancel-team-btn").onclick = () => {
            const btn = $("adm-cancel-team-btn");
            setBusy(btn, true, "Cancelling...");
            setTimeout(() => {
                resetTeamForm();
                setBusy(btn, false);
            }, 300);
        };
    }

    // ---- Employee form: create / search / update / cancel ----
    function setEmpEditMode(editing) {
        show($("adm-update-emp-btn"), editing);
        show($("adm-cancel-emp-btn"), editing);
        show($("adm-create-emp-btn"), !editing);
    }

    function resetEmpForm() {
        setVal("adm-edit-emp-pk-id", "");
        ["adm-emp-code", "adm-emp-name", "adm-emp-desig", "adm-search-emp-query"].forEach((id) => setVal(id, ""));
        if ($("adm-emp-msg")) $("adm-emp-msg").textContent = "";
        setEmpEditMode(false);
    }

    function empFormValues() {
        return {
            emp_code: $("adm-emp-code")?.value.trim() || "",
            name: $("adm-emp-name")?.value.trim() || "",
            designation: $("adm-emp-desig")?.value.trim() || "",
            team_id: parseInt($("adm-emp-team")?.value, 10) || null
        };
    }

    if ($("adm-create-emp-btn")) {
        $("adm-create-emp-btn").onclick = async () => {
            const v = empFormValues();
            if (!v.emp_code || !v.name || !v.team_id) return alert("Fill employee details!");

            try {
                await api("/api/admin/employees", jsonOpts("POST", v));
                alert("Employee registered!");
                resetEmpForm();
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not create employee: " + err.message);
            }
        };
    }

    if ($("adm-search-emp-btn")) {
        $("adm-search-emp-btn").onclick = async () => {
            const code = $("adm-search-emp-query")?.value.trim();
            if (!code) return alert("Enter Employee Code to search!");

            const btn = $("adm-search-emp-btn");
            setBusy(btn, true, "Searching...");
            try {
                const data = await api(`/api/admin/employee/search?emp_code=${encodeURIComponent(code)}`);

                setVal("adm-edit-emp-pk-id", data.id);
                setVal("adm-emp-code", data.emp_code);
                setVal("adm-emp-name", data.full_name || data.name);
                setVal("adm-emp-desig", data.designation);
                setVal("adm-emp-team", data.team_id);

                setEmpEditMode(true);
                const msg = $("adm-emp-msg");
                if (msg) {
                    msg.textContent = `Editing Employee: ${data.full_name || data.name} (${data.emp_code})`;
                    msg.style.color = "#2563eb";
                }
            } catch (err) {
                alert("Employee not found: " + err.message);
            } finally {
                setBusy(btn, false);
            }
        };
    }

    if ($("adm-update-emp-btn")) {
        $("adm-update-emp-btn").onclick = async () => {
            const pk = $("adm-edit-emp-pk-id")?.value;
            if (!pk) return alert("Search for an employee first.");
            const v = empFormValues();
            if (!v.emp_code || !v.name) return alert("Employee code and name are required!");

            // Matches EmployeeDetailUpdate in main.py
            const payload = {
                emp_code: v.emp_code,
                full_name: v.name,
                designation: v.designation || null,
                team_id: v.team_id
            };

            const btn = $("adm-update-emp-btn");
            setBusy(btn, true, "Updating...");
            try {
                await api(`/api/admin/employee/${encodeURIComponent(pk)}`, jsonOpts("PUT", payload));
                alert("Employee updated successfully!");
                resetEmpForm();
                await loadAdminDirectories();
            } catch (err) {
                alert("Could not update employee: " + err.message);
            } finally {
                setBusy(btn, false);
            }
        };
    }

    if ($("adm-cancel-emp-btn")) {
        $("adm-cancel-emp-btn").onclick = () => {
            const btn = $("adm-cancel-emp-btn");
            setBusy(btn, true, "Cancelling...");
            setTimeout(() => {
                resetEmpForm();
                setBusy(btn, false);
            }, 300);
        };
    }

    // =====================================================================
    // VERIFICATION TAB
    // =====================================================================
    function initVerificationTab() {
        if ($("verify-date") && !$("verify-date").value) $("verify-date").value = localToday();

        // Team logins can only verify their own circle/team
        if (isTeam() && $("verify-filter-circle") && currentUser.circle) {
            $("verify-filter-circle").value = currentUser.circle;
            $("verify-filter-circle").disabled = true;
        }
        populateVerifyTeams();
    }

    async function populateVerifyTeams() {
        const teamSelect = $("verify-filter-team");
        if (!teamSelect) return;
        const previous = teamSelect.value;
        teamSelect.innerHTML = `<option value="ALL">All Teams</option>`;

        try {
            let teams = await fetchTeams($("verify-filter-circle")?.value || "");
            if (isTeam()) teams = teams.filter((t) => t.id === currentUser.id);

            (teams || []).forEach((t) => {
                const name = t.team_name || t.name;
                if (!name) return;
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                teamSelect.appendChild(opt);
            });

            if (isTeam() && teams.length === 1) {
                teamSelect.value = teams[0].team_name || teams[0].name;
                teamSelect.disabled = true;
            } else if (previous && Array.from(teamSelect.options).some((o) => o.value === previous)) {
                teamSelect.value = previous;
            }
        } catch (e) {
            console.error("Failed to load teams for verification filter", e);
        }
    }
    $("verify-filter-circle")?.addEventListener("change", populateVerifyTeams);

    // Sub-tabs: Attendance / Log Book
    function switchVerifyView(showAtt) {
        $("subtab-verify-att")?.classList.toggle("active", showAtt);
        $("subtab-verify-log")?.classList.toggle("active", !showAtt);
        $("verify-view-att")?.classList.toggle("hidden", !showAtt);
        $("verify-view-log")?.classList.toggle("hidden", showAtt);
    }
    $("subtab-verify-att")?.addEventListener("click", () => switchVerifyView(true));
    $("subtab-verify-log")?.addEventListener("click", () => switchVerifyView(false));

    function attendanceBadge(r) {
        return (r.status === "P" || r.status === "Present") ? "role" : "danger";
    }

    async function loadVerificationData() {
        const dateVal = $("verify-date")?.value;
        if (!dateVal) return alert("Please choose a date.");

        const circleVal = normCircle($("verify-filter-circle")?.value) || "ALL";
        const teamVal = $("verify-filter-team")?.value || "ALL";

        const btn = $("btn-run-verify");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Loading...";
        }

        try {
            const url = `/api/verification/summary?target_date=${encodeURIComponent(dateVal)}&circle=${encodeURIComponent(circleVal)}&team_name=${encodeURIComponent(teamVal)}`;
            const data = await api(url);
            const attendance = data.attendance || [];
            const logs = data.logs || [];

            // Attendance table
            if ($("count-verify-att")) $("count-verify-att").textContent = attendance.length;
            const attTbody = $("verify-att-tbody");
            if (attTbody) {
                attTbody.innerHTML = attendance.length === 0
                    ? `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:20px;">No attendance found for this date.</td></tr>`
                    : attendance.map((r, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${esc(r.emp_code)}</strong></td>
                    <td>${esc(r.emp_name)}</td>
                    <td>${esc(r.designation)}</td>
                    <td>${esc(r.team_name)}</td>
                    <td>${esc(r.circle || "-")}</td>
                    <td>
                        <span class="badge ${attendanceBadge(r)}" style="padding:2px 8px;">${esc(r.status)}</span>
                    </td>
                </tr>`).join("");
            }

            // Log book table
            if ($("count-verify-log")) $("count-verify-log").textContent = logs.length;
            const logTbody = $("verify-log-tbody");
            if (logTbody) {
                logTbody.innerHTML = logs.length === 0
                    ? `<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:20px;">No log book entries found for this date.</td></tr>`
                    : logs.map((l) => {
                        const label = !l.is_submitted ? "Not Submitted" : (l.is_locked ? "Locked" : "Draft");
                        const cls = !l.is_submitted || l.is_locked ? "danger" : "role";
                        const km = l.total_km === "-" ? "-" : `${esc(l.total_km)} KM`;
                        const load = l.load_booked === "-" ? "-" : `${esc(l.load_booked)} KW`;
                        const amt = l.amount_collected === "-" ? "-" : `₹${esc(l.amount_collected)}`;
                        return `
                <tr>
                    <td><strong>${esc(l.team_name)}</strong></td>
                    <td>${esc(l.vehicle_no || "-")}</td>
                    <td style="max-width:250px; font-size:12px;">${esc(l.route || "-")}</td>
                    <td><strong>${km}</strong></td>
                    <td>${load}</td>
                    <td>${amt}</td>
                    <td>${esc(l.dc_count)}</td>
                    <td>${esc(l.supervisor || "-")}</td>
                    <td><span class="badge ${cls}">${label}</span></td>
                </tr>`;
                    }).join("");
            }
        } catch (err) {
            alert("Failed to load records: " + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "🔍 View Records";
            }
        }
    }
    $("btn-run-verify")?.addEventListener("click", loadVerificationData);

    // Returns e.g. ["JEYPORE", "RAYAGADA"] from the #sub-circles multi-select.
    function getSelectedSubCircles() {
        const sel = $("sub-circles");
        return sel ? Array.from(sel.selectedOptions).map((o) => o.value) : [];
    }

    // ---- Sub-admin creation (admin only) ----
    if ($("btn-create-subadmin")) {
        $("btn-create-subadmin").onclick = async () => {
            const name = $("sub-name")?.value.trim();
            const user = $("sub-user")?.value.trim();
            const pass = $("sub-pass")?.value.trim();
            const permMode = $("sub-perm-mode")?.value || "EDIT_VIEW";
            const circles = getSelectedSubCircles();

            if (!name || !user || !pass) return alert("Fill in Name, Username, and Password!");
            if (circles.length === 0) return alert("Select at least one assigned circle!");

            try {
                await api("/api/admin/subadmins", jsonOpts("POST", {
                    full_name: name,
                    username: user,
                    password: pass,
                    assigned_circles: circles,
                    permission_mode: permMode
                }));
                alert(`Sub-Admin created with ${permMode === "VIEW_ONLY" ? "View-Only" : "View & Edit"} rights!`);
                ["sub-name", "sub-user", "sub-pass"].forEach((id) => setVal(id, ""));
                Array.from($("sub-circles")?.options || []).forEach((o) => { o.selected = false; });
            } catch (err) {
                alert("Error: " + err.message);
            }
        };
    }

    // =====================================================================
    // START
    // =====================================================================
    if (currentUser) init();
});