import io
import calendar
from datetime import date
from typing import Optional, List, Dict
from reportlab.lib.pagesizes import A4, landscape, portrait
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

SUPPORTED_CIRCLES = ["JEYPORE", "RAYAGADA", "BHANJANAGAR", "ASKA", "BERHAMPUR", "CITY"]

def get_report_styles():
    styles = getSampleStyleSheet()
    return {
        'company': ParagraphStyle(
            'CompanyTitle',
            parent=styles['Heading1'],
            fontName='Helvetica-Bold',
            fontSize=11,
            leading=14,
            alignment=1,
            textColor=colors.HexColor('#111827')
        ),
        'sub': ParagraphStyle(
            'SubHeader',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            leading=9.5,
            alignment=1,
            textColor=colors.HexColor('#4b5563')
        ),
        'title': ParagraphStyle(
            'DocTitle',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=9.5,
            leading=12,
            alignment=1,
            textColor=colors.HexColor('#1f2937')
        ),
        'cell': ParagraphStyle(
            'CellText',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            leading=9.5,
            alignment=0
        ),
        'cell_center': ParagraphStyle(
            'CellCenter',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=7.5,
            leading=9.5,
            alignment=1
        ),
        'cell_bold_center': ParagraphStyle(
            'CellBoldCenter',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=7.5,
            leading=9.5,
            alignment=1
        )
    }

def make_single_signature_footer(sig_lines: List[str], width: float = 1000.89):
    """
    Renders ONLY ONE signature block at the bottom right of every single page.
    """
    def draw_footer(canv, doc):
        canv.saveState()
        y_top = 58
        line_height = 10.0

        canv.setStrokeColor(colors.HexColor('#cbd5e1'))
        canv.setLineWidth(0.5)
        canv.line(30, 68, width - 30, 68)

        x = width - 320
        y = y_top
        for i, text in enumerate(sig_lines):
            canv.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 8.0)
            canv.drawString(x, y, text)
            y -= line_height

        canv.setFont("Helvetica", 7.0)
        canv.setFillColor(colors.HexColor("#080e15"))
        canv.drawRightString(width - 36, 12, f"Page {doc.page}")

        canv.restoreState()
    return draw_footer


# =========================================================================
# 1. CIRCLE LOG SUMMARY (Single Signature: Executive Engineer)
# =========================================================================
def build_circle_log_pdf(circle_name: str, year: int, month: int, rows: list, total_km: int) -> bytes:
    buffer = io.BytesIO()
    month_name = calendar.month_name[month].upper()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=36,
        rightMargin=36,
        topMargin=32,
        bottomMargin=100
    )

    st = get_report_styles()
    story = []

    story.append(Paragraph("AMMAN ASSOCIATED SERVICES PRIVATE LIMITED", st['company']))
    story.append(Paragraph("Corporate Office: DCB 126, DLF Cybercity, Technology Corridor, Patia, Bhubaneswar - 751024", st['sub']))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"VIGILANCE ENFORCEMENT CELL, {circle_name.upper()} CIRCLE", st['title']))
    story.append(Paragraph(f"MONTH OF {month_name} VEHICLE LOG BOOK TOTAL KILOMETER DETAILS - {year}", st['title']))
    story.append(Spacer(1, 8))

    meta = Table([
        [
            Paragraph(f"<b>Circle Name:</b> {circle_name.upper()}", st['cell']),
            Paragraph(f"<b>Period:</b> {month_name} {year}", ParagraphStyle('R', parent=st['cell'], alignment=2))
        ]
    ], colWidths=[384, 385])
    meta.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    story.append(meta)
    story.append(Spacer(1, 6))

    headers = [
        Paragraph("<b>Sl<br/>No.</b>", st['cell_bold_center']),
        Paragraph("<b>Area / Team</b>", st['cell_bold_center']),
        Paragraph("<b>Team Leader</b>", st['cell_bold_center']),
        Paragraph("<b>Supervisor</b>", st['cell_bold_center']),
        Paragraph("<b>Vehicle No.</b>", st['cell_bold_center']),
        Paragraph("<b>Total Monthly<br/>Km's Running</b>", st['cell_bold_center'])
    ]
    table_data = [headers]

    for idx, r in enumerate(rows, start=1):
        table_data.append([
            Paragraph(str(idx), st['cell_center']),
            Paragraph(str(r.get('team_name', '')), st['cell']),
            Paragraph(str(r.get('team_lead') or r.get('team_leader') or '-'), st['cell']),
            Paragraph(str(r.get('supervisor') or '-'), st['cell']),
            Paragraph(str(r.get('vehicle_no') or 'N/A'), st['cell_center']),
            Paragraph(str(r.get('total_km', 0)), st['cell_center'])
        ])

    main_table = Table(table_data, colWidths=[35, 174, 185, 185, 95, 95], repeatRows=1)
    main_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(main_table)
    story.append(Spacer(1, 8))

    tot = Table([
        [
            Paragraph(f"<b>Total Kilometer's of {circle_name.upper()} Circle:</b>", st['cell']),
            Paragraph(f"<b>{total_km} KM</b>", st['cell_bold_center'])
        ]
    ], colWidths=[674, 95])
    tot.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#e5e7eb')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(KeepTogether([tot]))

    footer_cb = make_single_signature_footer(
        sig_lines=[
            "Executive Engineer (Elect.)",
            "Enforcement & Vigilance Cell",
            f"TPSODL, {circle_name.upper()} Circle"
        ],
        width=841.89
    )

    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)
    buffer.seek(0)
    return buffer.getvalue()


# =========================================================================
# 2. FORM D ATTENDANCE (Single Signature: Team Leader OR Executive Engineer)
# =========================================================================
def build_form_d_pdf(
    circle_name: str,
    year: int,
    month: int,
    employees: list,
    attendance_map: dict,
    team_lead: Optional[str] = None,
    team_name: Optional[str] = None
) -> bytes:
    buffer = io.BytesIO()
    month_name = calendar.month_name[month].upper()
    _, num_days = calendar.monthrange(year, month)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=20,
        rightMargin=20,
        topMargin=25,
        bottomMargin=75
    )

    st = get_report_styles()
    story = []

    scope_title = f"Team: {team_name} | " if team_name else ""
    story.append(Paragraph("AMMAN ASSOCIATED SERVICES PRIVATE LIMITED", st['company']))
    story.append(Paragraph(f"FORM D - ATTENDANCE REGISTER FOR THE MONTH OF {month_name} {year}", st['title']))
    story.append(Paragraph(f"Circle: {circle_name.upper()} | {scope_title}Days in Month: {num_days}", st['sub']))
    story.append(Spacer(1, 6))

    day_headers = [Paragraph(f"<b>{d}</b>", st['cell_bold_center']) for d in range(1, num_days + 1)]
    headers = [
        Paragraph("<b>Sl</b>", st['cell_bold_center']),
        Paragraph("<b>Designation</b>", st['cell_bold_center']),
        Paragraph("<b>Employee Name</b>", st['cell_bold_center']),
        *day_headers,
        Paragraph("<b>Summary No. Of Days</b>", st['cell_bold_center']),
        Paragraph("<b>Absent No. Of Days</b>", st['cell_bold_center']),
        Paragraph("<b>Leave No. Of days</b>", st['cell_bold_center']),
        Paragraph("<b>Weekly Off</b>", st['cell_bold_center'])
    ]
    table_data = [headers]

    day_width = 13.5
    col_widths = [30, 70, 105] + [day_width] * num_days + [40, 40, 40, 30]

    daily_present = {d: 0 for d in range(1, num_days + 1)}
    grand_p = grand_a = grand_l = grand_wo = 0

    for idx, emp in enumerate(employees, start=1):
        emp_id = emp.get('id')
        p_c = a_c = l_c = wo_c = 0
        day_cells = []

        for d in range(1, num_days + 1):
            date_key = f"{year}-{str(month).zfill(2)}-{str(d).zfill(2)}"
            status = attendance_map.get((emp_id, date_key), "-")

            if status == "P":
                p_c += 1
                daily_present[d] += 1
            elif status == "A":
                a_c += 1
            elif status == "L":
                l_c += 1
            elif status == "WO":
                wo_c += 1

            day_cells.append(Paragraph(status, st['cell_center']))

        grand_p += p_c
        grand_a += a_c
        grand_l += l_c
        grand_wo += wo_c

        table_data.append([
            Paragraph(str(idx), st['cell_center']),
            Paragraph(str(emp.get('designation', '-'))[:16], st['cell']),
            Paragraph(str(emp.get('name', ''))[:18], st['cell']),
            *day_cells,
            Paragraph(str(p_c), st['cell_bold_center']),
            Paragraph(str(a_c), st['cell_bold_center']),
            Paragraph(str(l_c), st['cell_bold_center']),
            Paragraph(str(wo_c), st['cell_bold_center'])
        ])

    total_day_cells = [Paragraph(f"<b>{daily_present[d]}</b>", st['cell_bold_center']) for d in range(1, num_days + 1)]
    total_row = [
        Paragraph("", st['cell_bold_center']),
        Paragraph("<b>TOTAL</b>", st['cell_bold_center']),
        Paragraph("<b>Daily Present</b>", st['cell_bold_center']),
        *total_day_cells,
        Paragraph(f"<b>{grand_p}</b>", st['cell_bold_center']),
        Paragraph(f"<b>{grand_a}</b>", st['cell_bold_center']),
        Paragraph(f"<b>{grand_l}</b>", st['cell_bold_center']),
        Paragraph(f"<b>{grand_wo}</b>", st['cell_bold_center'])
    ]
    table_data.append(total_row)

    last_row_idx = len(table_data) - 1
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#9ca3af')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('BACKGROUND', (0, last_row_idx), (-1, last_row_idx), colors.HexColor('#f3f4f6')),
        ('LINEABOVE', (0, last_row_idx), (-1, last_row_idx), 1, colors.HexColor('#374151')),
        ('TOPPADDING', (0, last_row_idx), (-1, last_row_idx), 3),
        ('BOTTOMPADDING', (0, last_row_idx), (-1, last_row_idx), 3),
    ]))
    story.append(table)

    if team_lead:
        sig_lines = [
            f"({team_lead})",
            f"Enforcement Cell, TPSODL, {circle_name.upper()} Circle"
        ]
    else:
        sig_lines = [
            "Executive Engineer (Elect.)",
            "Enforcement & Vigilance Cell",
            f"TPSODL, {circle_name.upper()} Circle"
        ]

    footer_cb = make_single_signature_footer(sig_lines, width=841.89)
    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)
    buffer.seek(0)
    return buffer.getvalue()


# =========================================================================
# 3. TEAM VEHICLE LOG BOOK (Remark changed to Signature + 1 Sign Block)
# =========================================================================
def build_team_log_pdf(team_name: str, circle: str, team_lead: str, year: int, month: int, daily_logs: list) -> bytes:
    buffer = io.BytesIO()
    month_name = calendar.month_name[month].upper()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=28,
        rightMargin=28,
        topMargin=28,
        bottomMargin=100
    )

    st = get_report_styles()
    story = []

    story.append(Paragraph("AMMAN ASSOCIATED SERVICES PRIVATE LIMITED", st['company']))
    story.append(Paragraph("Corporate Office: DCB 126, DLF Cybercity, Technology Corridor, Patia, Bhubaneswar - 751024", st['sub']))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"VIGILANCE ENFORCEMENT CELL, {circle.upper()} CIRCLE", st['title']))
    story.append(Paragraph(f"DAILY VEHICLE LOG BOOK - {team_name.upper()}", st['title']))
    story.append(Spacer(1, 6))

    meta = Table([
        [
            Paragraph(f"<b>Team Name:</b> {team_name}", st['cell']),
            Paragraph(f"<b>Team Leader:</b> {team_lead or 'N/A'}", st['cell']),
            Paragraph(f"<b>Period:</b> {month_name} {year}", ParagraphStyle('RMeta', parent=st['cell'], alignment=2))
        ]
    ], colWidths=[260, 260, 265])
    meta.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    story.append(meta)
    story.append(Spacer(1, 6))

    # Column 9 is Signature instead of Remarks
    headers = [
        Paragraph("<b>Date</b>", st['cell_bold_center']),
        Paragraph("<b>Vehicle No.</b>", st['cell_bold_center']),
        Paragraph("<b>Supervisor</b>", st['cell_bold_center']),
        Paragraph("<b>Time<br/>(In - Out)</b>", st['cell_bold_center']),
        Paragraph("<b>Journey Route (From - To)</b>", st['cell_bold_center']),
        Paragraph("<b>Start<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>End<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>Run<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>Signature</b>", st['cell_bold_center'])
    ]
    table_data = [headers]

    total_km = 0
    if daily_logs:
        for r in daily_logs:
            run_km = int(r.get('total_km') or r.get('run_km') or 0)
            total_km += run_km
            table_data.append([
                Paragraph(str(r.get('date', '')), st['cell_center']),
                Paragraph(str(r.get('vehicle_no', 'N/A')), st['cell_center']),
                Paragraph(str(r.get('supervisor') or r.get('driver_name') or '-'), st['cell']),
                Paragraph(f"{r.get('start_time') or '09:00'} - {r.get('end_time') or '18:00'}", st['cell_center']),
                Paragraph(str(r.get('journey_route') or r.get('route_details') or '-'), st['cell']),
                Paragraph(str(r.get('start_km', 0)), st['cell_center']),
                Paragraph(str(r.get('end_km', 0)), st['cell_center']),
                Paragraph(str(run_km), st['cell_bold_center']),
                Paragraph("", st['cell_center'])  # Empty for physical signature
            ])
    else:
        table_data.append([Paragraph("No vehicle entries logged for this month.", st['cell_center'])] + [Paragraph("-", st['cell_center'])] * 8)

    col_widths = [55, 65, 105, 75, 235, 50, 50, 50, 100]
    log_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    log_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(log_table)
    story.append(Spacer(1, 8))

    tot = Table([
        [
            Paragraph("<b>Total Monthly Kilometer's Running:</b>", st['cell']),
            Paragraph(f"<b>{total_km} KM</b>", st['cell_bold_center'])
        ]
    ], colWidths=[685, 100])
    tot.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (1, 1), (-1, -1), 4),
    ]))
    story.append(KeepTogether([tot]))

    footer_cb = make_single_signature_footer(
        sig_lines=[
            f"({team_lead})",
            f"Enforcement Cell, TPSODL, {circle.upper()} Circle"
        ],
        width=1000
    )

    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)
    buffer.seek(0)
    return buffer.getvalue()


# =========================================================================
# 4. TEAM PERFORMANCE REPORT (Date, Team, Mode, Load, Amount, DC, KM, Present)
# =========================================================================
def build_team_performance_pdf(
    circle_name: str,
    year: int,
    month: int,
    performance_rows: List[dict]
) -> bytes:
    buffer = io.BytesIO()
    month_name = calendar.month_name[month].upper()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=30,
        rightMargin=30,
        topMargin=28,
        bottomMargin=100
    )

    st = get_report_styles()
    story = []

    story.append(Paragraph("AMMAN ASSOCIATED SERVICES PRIVATE LIMITED", st['company']))
    story.append(Paragraph(f"TEAM-WISE OPERATIONAL PERFORMANCE REPORT - {month_name} {year}", st['title']))
    story.append(Paragraph(f"Enforcement & Vigilance Cell | Circle: {circle_name.upper()}", st['sub']))
    story.append(Spacer(1, 8))

    headers = [
        Paragraph("<b>Date</b>", st['cell_bold_center']),
        Paragraph("<b>Team Name</b>", st['cell_bold_center']),
        Paragraph("<b>Mode of Team Operation</b>", st['cell_bold_center']),
        Paragraph("<b>Load Booked<br/>(KW)</b>", st['cell_bold_center']),
        Paragraph("<b>Amount Coll.<br/>(₹)</b>", st['cell_bold_center']),
        Paragraph("<b>No. of<br/>DC</b>", st['cell_bold_center']),
        Paragraph("<b>KM Run<br/>(Day)</b>", st['cell_bold_center']),
        Paragraph("<b>Emp<br/>Present</b>", st['cell_bold_center'])
    ]
    table_data = [headers]

    tot_load = 0.0
    tot_amount = 0.0
    tot_dc = 0
    tot_km = 0

    for r in performance_rows:
        load_val = float(r.get('load_booked', 0.0) or 0.0)
        amt_val = float(r.get('amount_collected', 0.0) or 0.0)
        dc_val = int(r.get('number_of_dc', 0) or 0)
        km_val = int(r.get('total_km', 0) or 0)

        tot_load += load_val
        tot_amount += amt_val
        tot_dc += dc_val
        tot_km += km_val

        mode = r.get('operation_mode', 'Operated Independently')
        if mode == "Merged" and r.get('merged_with_team'):
            mode = f"Merged with {r.get('merged_with_team')}"
        elif not r.get('team_leader_present', True):
            mode += " (TL Absent)"

        table_data.append([
            Paragraph(str(r.get('date', '')), st['cell_center']),
            Paragraph(str(r.get('team_name', '')), st['cell']),
            Paragraph(str(mode), st['cell']),
            Paragraph(f"{load_val:.2f}", st['cell_center']),
            Paragraph(f"₹{amt_val:,.2f}", st['cell_center']),
            Paragraph(str(dc_val), st['cell_center']),
            Paragraph(str(km_val), st['cell_center']),
            Paragraph(str(r.get('emp_present_count', 0)), st['cell_bold_center'])
        ])

    table_data.append([
        Paragraph("", st['cell_bold_center']),
        Paragraph("<b>TOTAL</b>", st['cell_bold_center']),
        Paragraph("", st['cell_bold_center']),
        Paragraph(f"<b>{tot_load:.2f}</b>", st['cell_bold_center']),
        Paragraph(f"<b>₹{tot_amount:,.2f}</b>", st['cell_bold_center']),
        Paragraph(f"<b>{tot_dc}</b>", st['cell_bold_center']),
        Paragraph(f"<b>{tot_km}</b>", st['cell_bold_center']),
        Paragraph("-", st['cell_bold_center'])
    ])

    col_widths = [60, 130, 200, 75, 95, 55, 65, 60]
    last_idx = len(table_data) - 1

    perf_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    perf_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e2e8f0')),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#94a3b8')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('BACKGROUND', (0, last_idx), (-1, last_idx), colors.HexColor('#f1f5f9')),
        ('LINEABOVE', (0, last_idx), (-1, last_idx), 1.2, colors.HexColor('#1e293b')),
    ]))
    story.append(perf_table)

    footer_cb = make_single_signature_footer(
        sig_lines=[
            "Executive Engineer (Elect.)",
            "Enforcement & Vigilance Cell",
            f"TPSODL, {circle_name.upper()} Circle"
        ],
        width=1000
    )

    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)
    buffer.seek(0)
    return buffer.getvalue()