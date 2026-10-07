import io
import calendar
from datetime import date
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
        'cell_bold': ParagraphStyle(
            'CellBold',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=7.5,
            leading=9.5,
            alignment=0
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

# =========================================================================
# REPORT 1: Circle Log Landscape (Executive Engineer Sign-off)
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
        bottomMargin=32
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
            Paragraph(f"<b>Circle Name:</b> {circle_name}", st['cell']),
            Paragraph(f"<b>Period:</b> {month_name} {year}", ParagraphStyle('R', parent=st['cell'], alignment=2))
        ]
    ], colWidths=[384, 385])
    meta.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    story.append(meta)
    story.append(Spacer(1, 6))

    headers = [
        Paragraph("<b>Sl<br/>No.</b>", st['cell_bold_center']),
        Paragraph("<b>Area</b>", st['cell_bold_center']),
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

    # Grand Total + Executive Signatures
    footer = []
    tot = Table([
        [
            Paragraph(f"<b>Total Kilometer's of {circle_name} Circle:</b>", st['cell']),
            Paragraph(f"<b>{total_km} KM</b>", st['cell_bold_center'])
        ]
    ], colWidths=[674, 95])
    tot.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#e5e7eb')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    footer.append(tot)
    footer.append(Spacer(1, 30))

    sig = Table([
        [
            Paragraph("Prepared By:<br/><br/><b>Executive</b><br/>Amman Associated Services", st['cell']),
            Paragraph("Checked By:<br/><br/><b>Operations Manager</b><br/>Amman Associated Services", st['cell']),
            Paragraph(f"Authorized Signature:<br/><br/><b>Executive Engineer (Elect.)</b><br/>Enforcement & Vigilance Cell<br/>TPSODL, {circle_name} Circle", st['cell'])
        ]
    ], colWidths=[250, 250, 269])
    footer.append(sig)

    story.append(KeepTogether(footer))
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()


# =========================================================================
# REPORT 2: Form D Attendance Landscape
# =========================================================================
def build_form_d_pdf(circle_name: str, year: int, month: int, employees: list, attendance_map: dict) -> bytes:
    buffer = io.BytesIO()
    month_name = calendar.month_name[month].upper()
    _, num_days = calendar.monthrange(year, month)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=20,
        rightMargin=20,
        topMargin=25,
        bottomMargin=25
    )

    st = get_report_styles()
    story = []

    story.append(Paragraph("AMMAN ASSOCIATED SERVICES PRIVATE LIMITED", st['company']))
    story.append(Paragraph(f"FORM D - ATTENDANCE REGISTER FOR THE MONTH OF {month_name} {year}", st['title']))
    story.append(Paragraph(f"Circle: {circle_name} | Days in Month: {num_days}", st['sub']))
    story.append(Spacer(1, 6))

    day_headers = [Paragraph(f"<b>{d}</b>", st['cell_bold_center']) for d in range(1, num_days + 1)]
    headers = [
        Paragraph("<b>Sl</b>", st['cell_bold_center']),
        Paragraph("<b>Code</b>", st['cell_bold_center']),
        Paragraph("<b>Name</b>", st['cell_bold_center']),
        *day_headers,
        Paragraph("<b>P</b>", st['cell_bold_center']),
        Paragraph("<b>A</b>", st['cell_bold_center']),
        Paragraph("<b>L</b>", st['cell_bold_center']),
        Paragraph("<b>WO</b>", st['cell_bold_center'])
    ]
    table_data = [headers]

    day_width = 13.5
    col_widths = [20, 42, 110] + [day_width] * num_days + [18, 18, 18, 18]

    for idx, emp in enumerate(employees, start=1):
        emp_id = emp.get('id')
        p_c = a_c = l_c = wo_c = 0
        day_cells = []
        for d in range(1, num_days + 1):
            date_key = f"{year}-{str(month).zfill(2)}-{str(d).zfill(2)}"
            status = attendance_map.get((emp_id, date_key), "-")
            if status == "P": p_c += 1
            elif status == "A": a_c += 1
            elif status == "L": l_c += 1
            elif status == "WO": wo_c += 1
            day_cells.append(Paragraph(status, st['cell_center']))

        table_data.append([
            Paragraph(str(idx), st['cell_center']),
            Paragraph(str(emp.get('emp_code', '')), st['cell_center']),
            Paragraph(str(emp.get('name', ''))[:18], st['cell']),
            *day_cells,
            Paragraph(str(p_c), st['cell_bold_center']),
            Paragraph(str(a_c), st['cell_bold_center']),
            Paragraph(str(l_c), st['cell_bold_center']),
            Paragraph(str(wo_c), st['cell_bold_center'])
        ])

    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e5e7eb')),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#9ca3af')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(table)
    story.append(Spacer(1, 20))

    # Form D Signature Block
    sig = Table([
        [
            Paragraph("Prepared By:<br/><br/><b>Executive HR</b>", st['cell']),
            Paragraph("Verified By:<br/><br/><b>Team Leader / Circle Coordinator</b>", st['cell']),
            Paragraph("Authorized By:<br/><br/><b>Authorized Signatory</b><br/>Amman Associated Services", st['cell'])
        ]
    ], colWidths=[260, 260, 260])
    story.append(KeepTogether([sig]))

    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()


# =========================================================================
# REPORT 3: Team Daily Movement Log Book (Signed by Team Lead)
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
        bottomMargin=28
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
            Paragraph(f"<b>Area / Team:</b> {team_name}", st['cell']),
            Paragraph(f"<b>Team Leader:</b> {team_lead or 'N/A'}", st['cell']),
            Paragraph(f"<b>Period:</b> {month_name} {year}", ParagraphStyle('RMeta', parent=st['cell'], alignment=2))
        ]
    ], colWidths=[260, 260, 265])
    meta.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))
    story.append(meta)
    story.append(Spacer(1, 6))

    headers = [
        Paragraph("<b>Date</b>", st['cell_bold_center']),
        Paragraph("<b>Vehicle No.</b>", st['cell_bold_center']),
        Paragraph("<b>Supervisor / Driver</b>", st['cell_bold_center']),
        Paragraph("<b>Time<br/>(In - Out)</b>", st['cell_bold_center']),
        Paragraph("<b>Journey Route (From - To)</b>", st['cell_bold_center']),
        Paragraph("<b>Start<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>End<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>Run<br/>KM</b>", st['cell_bold_center']),
        Paragraph("<b>Remarks</b>", st['cell_bold_center'])
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
                Paragraph(f"{r.get('time_in', '09:00')} - {r.get('time_out', '18:00')}", st['cell_center']),
                Paragraph(str(r.get('journey_route') or r.get('route_details') or '-'), st['cell']),
                Paragraph(str(r.get('start_km', 0)), st['cell_center']),
                Paragraph(str(r.get('end_km', 0)), st['cell_center']),
                Paragraph(str(run_km), st['cell_bold_center']),
                Paragraph(str(r.get('remarks', '')), st['cell'])
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

    footer = []
    tot = Table([
        [
            Paragraph("<b>Total Monthly Kilometer's Running:</b>", st['cell']),
            Paragraph(f"<b>{total_km} KM</b>", st['cell_bold_center'])
        ]
    ], colWidths=[685, 100])
    tot.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9ca3af')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#e5e7eb')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    footer.append(tot)
    footer.append(Spacer(1, 35))

    sig = Table([
        [
            Paragraph("<b>Vehicle Driver / Supervisor Signature</b><br/><br/><br/>________________________________", st['cell_center']),
            Paragraph(f"<b>Team Leader Signature</b><br/><br/><br/><b>{team_lead}</b><br/>Enforcement Cell ({team_name})<br/>TPSODL, {circle} Circle", st['cell_center'])
        ]
    ], colWidths=[390, 395])
    footer.append(sig)

    story.append(KeepTogether(footer))
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()