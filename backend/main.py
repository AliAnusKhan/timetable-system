import io
import os
import random
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

# The PDF report needs 'reportlab'. Importing it defensively means a missing package only
# disables that one endpoint instead of crashing every endpoint in this file on startup.
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.charts.piecharts import Pie
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)

app = FastAPI(title="Smart Timetable System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Request / response schemas ---

class TeacherSchema(BaseModel):
    name: str
    subject: str
    is_double_period: Optional[bool] = False  # True if the course requires two consecutive periods (e.g. a lab)

class ClassSchema(BaseModel):
    class_name: str
    section: str

class TimeSlotSchema(BaseModel):
    period_number: int
    start_time: str
    end_time: str
    applies_on_friday: Optional[bool] = True  # False for late periods that don't run on the shorter Friday schedule

class CourseSchema(BaseModel):
    year: str                 # e.g. "1st Year", "2nd Year", "3rd Year"
    technology: str           # e.g. "CIT", "Software", "Auto Diesel", "Mechanical", "Electrical", "Electronics"
    name: str                 # course/subject name
    course_type: str          # "Theory", "Lab", or "Theory + Lab"

class AssignSlotSchema(BaseModel):
    teacher_id: int
    class_id: int
    day: Optional[str] = None  # If omitted, the first available weekday is used

class CourseAssignmentSchema(BaseModel):
    teacher_id: int
    class_id: int
    sessions_per_week: Optional[int] = 5  # Default: this course meets every weekday, Monday-Friday


def slots_for_day(all_slots: list, day: str) -> list:
    """Friday is a shorter day (ends earlier for Jummah), so only slots flagged
    applies_on_friday=True are offered on Friday. Every other weekday gets the full list."""
    if day == "Friday":
        return [s for s in all_slots if s.get("applies_on_friday", True)]
    return all_slots


# --- ADMIN CRUD ENDPOINTS ---

@app.get("/get-all-data")
def get_all_data():
    try:
        teachers = supabase.table("teachers").select("*").execute().data
        classes = supabase.table("classes").select("*").execute().data
        time_slots = supabase.table("time_slots").select("*").order("period_number").execute().data
        courses = supabase.table("courses").select("*").order("year").execute().data
        assignments = supabase.table("course_assignments").select(
            "*, teachers(name, subject, is_double_period), classes(class_name, section)"
        ).execute().data
        return {
            "success": True,
            "teachers": teachers,
            "classes": classes,
            "time_slots": time_slots,
            "courses": courses,
            "assignments": assignments
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/add-teacher")
def add_teacher(data: TeacherSchema):
    try:
        payload = {"name": data.name, "subject": data.subject, "is_double_period": data.is_double_period}
        res = supabase.table("teachers").insert(payload).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-teacher/{teacher_id}")
def update_teacher(teacher_id: int, data: TeacherSchema):
    try:
        payload = {"name": data.name, "subject": data.subject, "is_double_period": data.is_double_period}
        res = supabase.table("teachers").update(payload).eq("id", teacher_id).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/delete-teacher/{teacher_id}")
def delete_teacher(teacher_id: int):
    try:
        supabase.table("teachers").delete().eq("id", teacher_id).execute()
        return {"success": True, "message": "Teacher deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/add-class")
def add_class(data: ClassSchema):
    try:
        res = supabase.table("classes").insert({"class_name": data.class_name, "section": data.section}).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-class/{class_id}")
def update_class(class_id: int, data: ClassSchema):
    try:
        res = supabase.table("classes").update(
            {"class_name": data.class_name, "section": data.section}
        ).eq("id", class_id).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/delete-class/{class_id}")
def delete_class(class_id: int):
    try:
        supabase.table("classes").delete().eq("id", class_id).execute()
        return {"success": True, "message": "Class deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/add-timeslot")
def add_timeslot(data: TimeSlotSchema):
    try:
        res = supabase.table("time_slots").insert({
            "period_number": data.period_number,
            "start_time": data.start_time,
            "end_time": data.end_time,
            "applies_on_friday": data.applies_on_friday
        }).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-timeslot/{slot_id}")
def update_timeslot(slot_id: int, data: TimeSlotSchema):
    try:
        res = supabase.table("time_slots").update({
            "period_number": data.period_number,
            "start_time": data.start_time,
            "end_time": data.end_time,
            "applies_on_friday": data.applies_on_friday
        }).eq("id", slot_id).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/delete-timeslot/{slot_id}")
def delete_timeslot(slot_id: int):
    try:
        supabase.table("time_slots").delete().eq("id", slot_id).execute()
        return {"success": True, "message": "Slot deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- COURSE CATALOG: the master list of subjects offered per year (Theory or Lab) ---
# This list is fully editable from the admin panel. Seed it with your institute's official
# Sindh Board of Technical Education (SBTE) syllabus for the relevant DAE technology.

@app.post("/add-course")
def add_course(data: CourseSchema):
    try:
        payload = {
            "year": data.year,
            "technology": data.technology,
            "name": data.name,
            "course_type": data.course_type,
        }
        res = supabase.table("courses").insert(payload).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-course/{course_id}")
def update_course(course_id: int, data: CourseSchema):
    try:
        payload = {
            "year": data.year,
            "technology": data.technology,
            "name": data.name,
            "course_type": data.course_type,
        }
        res = supabase.table("courses").update(payload).eq("id", course_id).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/delete-course/{course_id}")
def delete_course(course_id: int):
    try:
        supabase.table("courses").delete().eq("id", course_id).execute()
        return {"success": True, "message": "Course deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- COURSE ASSIGNMENTS: link a teacher's course to a class + how many times a week it meets ---
# This is the only setup step needed before auto-distributing: add the teacher (with subject),
# add the class, then link them here. The generator does the rest for Monday-Friday.

@app.post("/add-assignment")
def add_assignment(data: CourseAssignmentSchema):
    try:
        payload = {
            "teacher_id": data.teacher_id,
            "class_id": data.class_id,
            "sessions_per_week": data.sessions_per_week or 5,
        }
        res = supabase.table("course_assignments").insert(payload).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/delete-assignment/{assignment_id}")
def delete_assignment(assignment_id: int):
    try:
        supabase.table("course_assignments").delete().eq("id", assignment_id).execute()
        return {"success": True, "message": "Assignment deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- QUICK ASSIGN: pick a teacher + class, engine finds the slot (manual, one-off override) ---

@app.post("/assign-slot")
def assign_slot(data: AssignSlotSchema):
    try:
        teacher_res = supabase.table("teachers").select("*").eq("id", data.teacher_id).execute().data
        if not teacher_res:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        teacher = teacher_res[0]

        class_res = supabase.table("classes").select("*").eq("id", data.class_id).execute().data
        if not class_res:
            raise HTTPException(status_code=404, detail="Class not found.")
        cls = class_res[0]

        time_slots = supabase.table("time_slots").select("*").order("period_number").execute().data
        if not time_slots:
            raise HTTPException(status_code=400, detail="Please add Time Slots first.")

        existing = supabase.table("timetable").select("day, time_slot_id, class_id, teacher_id").execute().data
        busy_teachers = {(e["day"], e["time_slot_id"], e["teacher_id"]) for e in existing}
        busy_classes = {(e["day"], e["time_slot_id"], e["class_id"]) for e in existing}

        all_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        days_to_try = [data.day] if data.day else all_days
        is_double = teacher.get("is_double_period", False)

        for day in days_to_try:
            day_slots = slots_for_day(time_slots, day)
            slot_idx = 0
            while slot_idx < len(day_slots):
                slot = day_slots[slot_idx]
                teacher_free = (day, slot["id"], teacher["id"]) not in busy_teachers
                class_free = (day, slot["id"], data.class_id) not in busy_classes

                if teacher_free and class_free:
                    if is_double and slot_idx + 1 < len(day_slots):
                        next_slot = day_slots[slot_idx + 1]
                        next_free = (
                            (day, next_slot["id"], teacher["id"]) not in busy_teachers and
                            (day, next_slot["id"], data.class_id) not in busy_classes
                        )
                        if next_free:
                            entries = [
                                {"day": day, "class_id": data.class_id, "teacher_id": teacher["id"], "time_slot_id": slot["id"]},
                                {"day": day, "class_id": data.class_id, "teacher_id": teacher["id"], "time_slot_id": next_slot["id"]},
                            ]
                            supabase.table("timetable").insert(entries).execute()
                            return {
                                "success": True,
                                "message": f"{teacher['name']} ({teacher['subject']}) was assigned to {cls['class_name']}-{cls['section']} on {day}, Period {slot['period_number']} & {next_slot['period_number']} (double period).",
                                "day": day,
                                "periods": [slot["period_number"], next_slot["period_number"]],
                                "double_period": True,
                            }
                        # This slot can't host a double period; keep scanning for another one.
                        slot_idx += 1
                        continue
                    else:
                        entry = {"day": day, "class_id": data.class_id, "teacher_id": teacher["id"], "time_slot_id": slot["id"]}
                        supabase.table("timetable").insert(entry).execute()
                        return {
                            "success": True,
                            "message": f"{teacher['name']} ({teacher['subject']}) was assigned to {cls['class_name']}-{cls['section']} on {day}, Period {slot['period_number']}.",
                            "day": day,
                            "periods": [slot["period_number"]],
                            "double_period": False,
                        }
                slot_idx += 1

        raise HTTPException(
            status_code=409,
            detail="No free slot was found for this teacher/class combination. Try a different day, or add more Time Slots."
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# --- SMART CONSTRAINT-BASED TIMETABLE GENERATOR ---
# Reads every Course Assignment (teacher + class + sessions/week) and spreads each one across
# Monday-Friday on its own, clash-free, honoring the teacher's double-period flag. This single
# action replaces placing every period by hand.

@app.post("/generate-timetable")
def generate_timetable():
    try:
        assignments = supabase.table("course_assignments").select(
            "*, teachers(*), classes(*)"
        ).execute().data
        time_slots = supabase.table("time_slots").select("*").order("period_number").execute().data

        if not assignments:
            raise HTTPException(
                status_code=400,
                detail="Please add Teachers, Classes, and Time Slots first, then link each teacher to a class under 'Course Assignments'."
            )
        if not time_slots:
            raise HTTPException(status_code=400, detail="Please add Time Slots first.")

        # Clear the previous timetable before rebuilding it
        supabase.table("timetable").delete().gt("id", 0).execute()

        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        generated_entries = []
        shortfalls = []

        # Tracking sets to avoid clashes
        busy_teachers = set()  # Stores (day, time_slot_id, teacher_id)
        busy_classes = set()   # Stores (day, time_slot_id, class_id)

        # Heaviest weekly loads are placed first - they're the hardest to fit
        assignments_sorted = sorted(assignments, key=lambda a: -(a.get("sessions_per_week") or 5))

        for a in assignments_sorted:
            teacher = a.get("teachers")
            cls = a.get("classes")
            if not teacher or not cls:
                continue

            sessions_needed = a.get("sessions_per_week") or 5
            is_double = teacher.get("is_double_period", False)

            day_order = days.copy()
            random.shuffle(day_order)  # fairness: don't always start the week on Monday

            placed = 0
            attempts = 0
            max_attempts = sessions_needed * len(days)

            while placed < sessions_needed and attempts < max_attempts:
                day = day_order[attempts % len(days)]
                attempts += 1
                day_slots = slots_for_day(time_slots, day)

                slot_idx = 0
                while slot_idx < len(day_slots):
                    slot = day_slots[slot_idx]
                    teacher_free = (day, slot["id"], teacher["id"]) not in busy_teachers
                    class_free = (day, slot["id"], cls["id"]) not in busy_classes

                    if teacher_free and class_free:
                        if is_double and slot_idx + 1 < len(day_slots):
                            next_slot = day_slots[slot_idx + 1]
                            next_free = (
                                (day, next_slot["id"], teacher["id"]) not in busy_teachers and
                                (day, next_slot["id"], cls["id"]) not in busy_classes
                            )
                            if not next_free:
                                slot_idx += 1
                                continue

                            generated_entries.append({"day": day, "class_id": cls["id"], "teacher_id": teacher["id"], "time_slot_id": slot["id"]})
                            generated_entries.append({"day": day, "class_id": cls["id"], "teacher_id": teacher["id"], "time_slot_id": next_slot["id"]})
                            busy_teachers.add((day, slot["id"], teacher["id"]))
                            busy_classes.add((day, slot["id"], cls["id"]))
                            busy_teachers.add((day, next_slot["id"], teacher["id"]))
                            busy_classes.add((day, next_slot["id"], cls["id"]))
                        else:
                            generated_entries.append({"day": day, "class_id": cls["id"], "teacher_id": teacher["id"], "time_slot_id": slot["id"]})
                            busy_teachers.add((day, slot["id"], teacher["id"]))
                            busy_classes.add((day, slot["id"], cls["id"]))

                        placed += 1
                        break

                    slot_idx += 1

            if placed < sessions_needed:
                shortfalls.append(
                    f"{teacher['name']} ({teacher['subject']}) -> {cls['class_name']}-{cls['section']}: {placed}/{sessions_needed} periods placed"
                )

        if generated_entries:
            supabase.table("timetable").insert(generated_entries).execute()

        message = f"Schedule auto-distributed across Monday-Friday. {len(generated_entries)} period-slots filled."
        if shortfalls:
            message += " Some load could not be fully placed - add more Time Slots: " + "; ".join(shortfalls)

        return {
            "success": True,
            "message": message,
            "total_slots": len(generated_entries),
            "shortfalls": shortfalls,
        }

    except HTTPException as http_ex:
        raise http_ex
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/get-timetable")
def get_timetable():
    try:
        response = supabase.table("timetable").select(
            "id, day, classes(class_name, section), teachers(name, subject, is_double_period), time_slots(period_number, start_time, end_time)"
        ).execute()
        return {"success": True, "timetable": response.data}
    except Exception as e:
        return {"success": False, "error": str(e)}


# --- PDF REPORT: summary stats, a workload bar chart, a course-type pie chart, then the
# full weekly timetable as tables, one per day. Requires the 'reportlab' package
# (pip install reportlab --break-system-packages).

if REPORTLAB_AVAILABLE:
    BRASS = colors.HexColor("#C9A24B")
    INK = colors.HexColor("#12181C")
    SAGE = colors.HexColor("#6E9583")
    STEEL = colors.HexColor("#8AAEDB")
    MUTED = colors.HexColor("#9CA3A8")
    PIE_PALETTE = [BRASS, SAGE, STEEL, MUTED, colors.HexColor("#A6543D")]

@app.get("/export-report-pdf")
def export_report_pdf():
    if not REPORTLAB_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="The PDF report needs the 'reportlab' package on the server. Run: pip install reportlab --break-system-packages, then restart the API."
        )
    try:
        teachers = supabase.table("teachers").select("*").execute().data
        classes = supabase.table("classes").select("*").execute().data
        courses = supabase.table("courses").select("*").execute().data
        timetable = supabase.table("timetable").select(
            "id, day, classes(class_name, section), teachers(name, subject), time_slots(period_number, start_time, end_time)"
        ).execute().data

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            topMargin=1.5 * cm, bottomMargin=1.5 * cm, leftMargin=1.5 * cm, rightMargin=1.5 * cm
        )
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle("ReportTitle", parent=styles["Title"], textColor=INK, fontSize=20, spaceAfter=2)
        sub_style = ParagraphStyle("ReportSub", parent=styles["Normal"], textColor=colors.HexColor("#666666"), fontSize=9, spaceAfter=16)
        heading_style = ParagraphStyle("ReportHeading", parent=styles["Heading2"], textColor=INK, spaceBefore=16, spaceAfter=8)
        day_style = ParagraphStyle("ReportDay", parent=styles["Heading3"], textColor=BRASS, spaceBefore=12, spaceAfter=4, fontSize=12)

        elements = [
            Paragraph("Weekly Class Schedule Report", title_style),
            Paragraph(f"Generated on {datetime.now().strftime('%d %B %Y, %I:%M %p')}", sub_style),
        ]

        # --- Summary ---
        elements.append(Paragraph("Summary", heading_style))
        summary_rows = [
            ["Teachers", str(len(teachers))],
            ["Classes", str(len(classes))],
            ["Courses in catalog", str(len(courses))],
            ["Total periods scheduled / week", str(len(timetable))],
        ]
        summary_table = Table(summary_rows, colWidths=[8 * cm, 4 * cm])
        summary_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("TEXTCOLOR", (0, 0), (-1, -1), INK),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDDDDD")),
        ]))
        elements.append(summary_table)

        # --- Bar chart: periods per teacher (workload) ---
        workload = {}
        for entry in timetable:
            t = entry.get("teachers")
            if t:
                workload[t["name"]] = workload.get(t["name"], 0) + 1

        if workload:
            elements.append(Paragraph("Teacher workload (periods / week)", heading_style))
            names = list(workload.keys())
            values = list(workload.values())

            drawing = Drawing(450, 220)
            chart = VerticalBarChart()
            chart.x, chart.y = 40, 40
            chart.width, chart.height = 380, 150
            chart.data = [values]
            chart.categoryAxis.categoryNames = names
            chart.categoryAxis.labels.angle = 30
            chart.categoryAxis.labels.dy = -10
            chart.categoryAxis.labels.fontSize = 7
            chart.valueAxis.valueMin = 0
            chart.bars[0].fillColor = BRASS
            drawing.add(chart)
            elements.append(drawing)
        else:
            elements.append(Paragraph("No workload data yet — run Auto-distribute first.", styles["Normal"]))

        # --- Pie chart: course catalog by type (Theory / Lab / Theory + Lab) ---
        type_counts = {}
        for c in courses:
            ct = c.get("course_type") or "Theory"
            type_counts[ct] = type_counts.get(ct, 0) + 1

        if type_counts:
            elements.append(Paragraph("Course catalog by type", heading_style))
            labels = list(type_counts.keys())
            values = list(type_counts.values())

            drawing2 = Drawing(420, 170)
            pie = Pie()
            pie.x, pie.y = 60, 10
            pie.width, pie.height = 140, 140
            pie.data = values
            pie.labels = [f"{l} ({v})" for l, v in zip(labels, values)]
            pie.slices.strokeWidth = 0.5
            for i in range(len(values)):
                pie.slices[i].fillColor = PIE_PALETTE[i % len(PIE_PALETTE)]
            drawing2.add(pie)
            elements.append(drawing2)

        # --- Weekly timetable, grouped by day ---
        elements.append(Paragraph("Weekly timetable", heading_style))
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        any_day_rendered = False
        for day in days:
            day_entries = sorted(
                [e for e in timetable if e["day"] == day],
                key=lambda e: (e.get("time_slots") or {}).get("period_number", 0)
            )
            if not day_entries:
                continue
            any_day_rendered = True
            elements.append(Paragraph(day, day_style))
            table_data = [["Period", "Time", "Class", "Teacher", "Course"]]
            for e in day_entries:
                ts = e.get("time_slots") or {}
                cls = e.get("classes") or {}
                t = e.get("teachers") or {}
                table_data.append([
                    str(ts.get("period_number", "-")),
                    f"{ts.get('start_time', '')}-{ts.get('end_time', '')}",
                    f"{cls.get('class_name', '')} ({cls.get('section', '')})",
                    t.get("name", ""),
                    t.get("subject", ""),
                ])
            day_table = Table(table_data, colWidths=[1.8 * cm, 3 * cm, 4 * cm, 3.5 * cm, 5.2 * cm])
            day_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5F0")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            elements.append(day_table)
            elements.append(Spacer(1, 6))

        if not any_day_rendered:
            elements.append(Paragraph("No periods have been scheduled yet — run Auto-distribute first.", styles["Normal"]))

        doc.build(elements)
        pdf_bytes = buffer.getvalue()
        buffer.close()

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=weekly-schedule-report.pdf"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not generate the PDF report: {str(e)}")