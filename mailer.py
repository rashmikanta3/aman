import os
import smtplib
from datetime import date, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from typing import List, Dict
from dotenv import load_dotenv
from sqlalchemy.orm import Session
import models
import queries
import reports_pdf
load_dotenv()

SUPPORTED_CIRCLES = ["JEYPORE", "RAYAGADA", "BHANJANAGAR", "ASKA", "BERHAMPUR", "CITY"]

# Add actual management emails here:
MANAGEMENT_EMAILS: Dict[str, List[str]] = {
    # Receives consolidated report for ALL circles
    "ALL": ["ansuman.sahu@tpsouthernodisha.com","sai.mohanty@tpsouthernodisha.com"
    ],
    # Receives ONLY Jeypore report & PDF
    "JEYPORE": [
        "rashmikanta.behera@tpsouthernodisha.com"
    ],
    # Receives ONLY Rayagada report & PDF
    "RAYAGADA": [
        "prakash.s@tpsouthernodisha.com"
    ],
    "BHANJANAGAR": [
        "bishnucharan.mahanta@tpsouthernodisha.com"
    ],
    "ASKA": [
        "swarupranjan.singh@tpsouthernodisha.com"
    ],
    "BERHAMPUR": [
        "ankit.panda01@tpsouthernodisha.com"
    ],
    "CITY": [
        "sai.mohanty@tpsouthernodisha.com"
    ]
}

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.zoho.in")
SMTP_PORT = int(os.getenv("SMTP_PORT", 465))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)


def fetch_circle_day_stats(db: Session, circle_name: str, target_date: date):
    """Pulls attendance and performance logs for one circle on target_date."""
    absents = (
        db.query(models.Employee.name, models.Employee.emp_code, models.Team.team_name)
        .join(models.Team, models.Employee.team_id == models.Team.id)
        .join(models.Attendance, models.Attendance.employee_id == models.Employee.id)
        .filter(
            models.Team.circle.ilike(circle_name.strip()),
            models.Attendance.date == target_date,
            models.Attendance.status == "A"
        )
        .all()
    )

    logs = (
        db.query(models.VehicleLog, models.Team.team_name)
        .join(models.Team, models.VehicleLog.team_id == models.Team.id)
        .filter(
            models.Team.circle.ilike(circle_name.strip()),
            models.VehicleLog.date == target_date
        )
        .all()
    )

    teams_without_tl = []
    tot_load = 0.0
    tot_amount = 0.0
    tot_dc = 0
    tot_km = 0

    for log, team_name in logs:
        if not getattr(log, 'team_leader_present', True):
            teams_without_tl.append(team_name)
        tot_load += float(getattr(log, 'load_booked', 0.0) or 0.0)
        tot_amount += float(getattr(log, 'amount_collected', 0.0) or 0.0)
        tot_dc += int(getattr(log, 'number_of_dc', 0) or 0)
        tot_km += int(getattr(log, 'total_km', 0) or 0)

    return {
        "circle": circle_name.upper(),
        "teams_active": len(logs),
        "load_booked": tot_load,
        "amount_collected": tot_amount,
        "number_of_dc": tot_dc,
        "total_km": tot_km,
        "absent_employees": [{"name": r[0], "code": r[1], "team": r[2]} for r in absents],
        "teams_without_tl": teams_without_tl
    }


def send_report_email(db: Session, target_date: date, scope: str = "ALL") -> bool:
    scope_upper = scope.strip().upper()
    recipients = MANAGEMENT_EMAILS.get(scope_upper, [])
    if not recipients:
        print(f"No recipients configured for: {scope_upper}")
        return False

    circles = SUPPORTED_CIRCLES if scope_upper == "ALL" else [scope_upper]
    stats_list = [fetch_circle_day_stats(db, c, target_date) for c in circles]

    # Build summary rows
    table_rows = ""
    for s in stats_list:
        table_rows += f"""
        <tr style="text-align: center;">
            <td style="padding: 8px; text-align: left; font-weight: bold;">{s['circle']}</td>
            <td style="padding: 8px;">{s['teams_active']}</td>
            <td style="padding: 8px;">{s['load_booked']:.2f} KW</td>
            <td style="padding: 8px;">₹{s['amount_collected']:,.2f}</td>
            <td style="padding: 8px;">{s['number_of_dc']}</td>
            <td style="padding: 8px;">{s['total_km']} KM</td>
            <td style="padding: 8px; color: {'#dc2626' if s['teams_without_tl'] else '#16a34a'}; font-weight: bold;">{len(s['teams_without_tl'])}</td>
            <td style="padding: 8px; color: {'#dc2626' if s['absent_employees'] else '#16a34a'}; font-weight: bold;">{len(s['absent_employees'])}</td>
        </tr>
        """

    # Build detailed section
    breakdown_sections = ""
    for s in stats_list:
        no_tl = "".join([f"<li>{t}</li>" for t in s['teams_without_tl']]) or "<li><i>None (All TLs Present)</i></li>"
        abs_emp = "".join([f"<li>{e['name']} ({e['code']}) - Team: {e['team']}</li>" for e in s['absent_employees']]) or "<li><i>None</i></li>"

        breakdown_sections += f"""
        <div style="margin-top: 14px; border-left: 4px solid #0284c7; padding-left: 12px;">
            <h4 style="margin: 0; color: #0f172a;">{s['circle']} CIRCLE</h4>
            <p style="margin: 4px 0 2px 0;"><b>Teams Operated Without TL:</b></p>
            <ul style="margin: 0; padding-left: 20px; color: #b91c1c;">{no_tl}</ul>
            <p style="margin: 6px 0 2px 0;"><b>Absent Staff:</b></p>
            <ul style="margin: 0; padding-left: 20px; color: #475569;">{abs_emp}</ul>
        </div>
        """

    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #1e293b; background: #f8fafc; padding: 15px;">
        <div style="max-width: 850px; margin: auto; background: #ffffff; padding: 20px; border-radius: 6px; border: 1px solid #cbd5e1;">
          <h2 style="color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 8px; margin-top: 0;">
            Daily Performance Report ({scope_upper})
          </h2>
          <p><b>Date:</b> {target_date.strftime('%d-%b-%Y')}</p>

          <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; border-color: #cbd5e1; width: 100%; font-size: 13px;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th>Circle</th><th>Teams</th><th>Load Booked</th><th>Collection</th><th>DC</th><th>KM</th><th>No TL</th><th>Absent</th>
              </tr>
            </thead>
            <tbody>{table_rows}</tbody>
          </table>

          <h3 style="margin-top: 20px;">Exceptions & Absentees</h3>
          {breakdown_sections}
        </div>
      </body>
    </html>
    """

    msg = MIMEMultipart()
    msg["Subject"] = f"[{scope_upper}] Daily Performance Report - {target_date.strftime('%d-%b-%Y')}"
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html_content, "html"))

    # Attach circle PDF(s)
    for c in circles:
        try:
            perf_rows = queries.fetch_team_performance_data(db, c, target_date.year, target_date.month)
            pdf_bytes = reports_pdf.build_team_performance_pdf(c, target_date.year, target_date.month, perf_rows)
            part = MIMEApplication(pdf_bytes, Name=f"{c}_Performance_{target_date.strftime('%Y%m')}.pdf")
            part["Content-Disposition"] = f'attachment; filename="{c}_Performance_{target_date.strftime("%Y%m")}.pdf"'
            msg.attach(part)
        except Exception as e:
            print(f"Error attaching PDF for circle {c}: {e}")

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_FROM, recipients, msg.as_string())

    return True