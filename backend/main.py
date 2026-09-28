import io
import os
import re
import random
from datetime import datetime
from typing import Optional, List
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
    shift: Optional[str] = "Morning"          # Morning / Afternoon (2nd shift) / Evening (3rd shift) - teachers
                                               # belong to one shift and only teach classes in that same shift

class ClassSchema(BaseModel):
    class_name: str
    section: str
    shift: Optional[str] = "Morning"  # "Morning", "Afternoon" (2nd shift) or "Evening" (3rd shift)

class TimeSlotSchema(BaseModel):
    period_number: int
    start_time: str
    end_time: str
    applies_on_friday: Optional[bool] = True  # False for late periods that don't run on the shorter Friday schedule
    shift: Optional[str] = "Morning"          # which shift this period belongs to

class CourseSchema(BaseModel):
    year: str                 # e.g. "1st Year", "2nd Year", "3rd Year"
    technology: str           # e.g. "CIT", "Software", "Auto Diesel", "Mechanical", "Electrical", "Electronics"
    name: str                 # course/subject name
    course_type: str          # "Theory", "Lab", or "Theory + Lab"

class AssignSlotSchema(BaseModel):
    teacher_id: int
    class_id: int
    day: Optional[str] = None  # If omitted, the first available weekday is used

class AbsenceSchema(BaseModel):
    teacher_id: int
    days: List[str]  # e.g. ["Monday"] or all five weekdays for a whole-week absence

class CourseAssignmentSchema(BaseModel):
    teacher_id: int
    class_id: int
    sessions_per_week: Optional[int] = 5  # Default: this course meets every weekday, Monday-Friday


# --- SHIFTS -------------------------------------------------------------------------
# Morning shift   : 09:00 - 13:30 (six 45-min periods), then a 30-minute break (13:30 - 14:00)
# 2nd shift       : 14:00 - 18:00 (six 40-min periods)
# 3rd shift       : 17:00 - 21:00 (six 40-min periods)
# Every class belongs to one shift and is only scheduled inside that shift's periods.
# 2nd and 3rd shift overlap between 17:00 and 18:00, so a *teacher* is treated as busy whenever
# any of their periods overlaps in real clock time, even if it is in a different shift.

SHIFT_ORDER = ["Morning", "Afternoon", "Evening"]
SHIFT_DEFAULTS = {
    "Morning":   {"start": "09:00", "end": "13:30", "period_minutes": 45, "friday_periods": 4},
    "Afternoon": {"start": "14:00", "end": "18:00", "period_minutes": 40, "friday_periods": 99},
    "Evening":   {"start": "17:00", "end": "21:00", "period_minutes": 40, "friday_periods": 99},
}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
SHIFT_LABELS = {"Morning": "Morning shift", "Afternoon": "2nd shift", "Evening": "3rd shift"}


def shift_info_label(value: str) -> str:
    return SHIFT_LABELS.get(value, value or "Morning")



def to_minutes(value) -> Optional[int]:
    """'09:00', '9:00 AM', '1:30 PM' -> minutes since midnight. Returns None if unparseable."""
    if not value:
        return None
    m = re.match(r"^\s*(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*$", str(value))
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    if ap:
        ap = ap.lower()
        if ap == "pm" and h != 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
    if h > 23 or mi > 59:
        return None
    return h * 60 + mi


def fmt_24h(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def fmt_12h(value) -> str:
    m = to_minutes(value)
    if m is None:
        return str(value or "")
    h, mi = divmod(m, 60)
    suffix = "AM" if h < 12 else "PM"
    return f"{(h % 12) or 12}:{mi:02d} {suffix}"


def shift_of(obj) -> str:
    return (obj or {}).get("shift") or "Morning"


def shift_index(obj) -> int:
    s = shift_of(obj)
    return SHIFT_ORDER.index(s) if s in SHIFT_ORDER else len(SHIFT_ORDER)


def slot_sort_key(slot: dict):
    return (shift_index(slot), slot.get("period_number") or 0)


def slots_for_day(all_slots: list, day: str, shift: Optional[str] = None) -> list:
    """Periods available on a given day, in order. Friday is a shorter day (Jummah), so only
    slots flagged applies_on_friday=True are offered on Friday. If a shift is given, only that
    shift's periods are returned."""
    slots = sorted(all_slots, key=slot_sort_key)
    if shift:
        slots = [s for s in slots if shift_of(s) == shift]
    if day == "Friday":
        slots = [s for s in slots if s.get("applies_on_friday", True)]
    return slots


def build_shift_slots(shift: str) -> list:
    cfg = SHIFT_DEFAULTS[shift]
    start, end, step = to_minutes(cfg["start"]), to_minutes(cfg["end"]), cfg["period_minutes"]
    slots, n, cur = [], 1, start
    while cur + step <= end:
        slots.append({
            "period_number": n,
            "start_time": fmt_24h(cur),
            "end_time": fmt_24h(cur + step),
            "applies_on_friday": n <= cfg["friday_periods"],
            "shift": shift,
        })
        cur += step
        n += 1
    return slots


class BusyTracker:
    """Clash detection. Teachers clash on real time overlap (works across shifts);
    classes clash on the exact same period."""

    def __init__(self):
        self.teacher_busy = {}   # (day, teacher_id) -> [(start, end, slot_id)]
        self.class_busy = set()  # (day, class_id, slot_id)

    @staticmethod
    def _span(slot):
        s, e = to_minutes(slot.get("start_time")), to_minutes(slot.get("end_time"))
        return (s, e) if s is not None and e is not None and e > s else (None, None)

    def teacher_free(self, day, teacher_id, slot) -> bool:
        s0, e0 = self._span(slot)
        for (s, e, sid) in self.teacher_busy.get((day, teacher_id), []):
            if sid == slot["id"]:
                return False
            if None not in (s0, e0, s, e) and s0 < e and s < e0:
                return False
        return True

    def class_free(self, day, class_id, slot) -> bool:
        return (day, class_id, slot["id"]) not in self.class_busy

    def book(self, day, teacher_id, class_id, slot):
        s, e = self._span(slot)
        self.teacher_busy.setdefault((day, teacher_id), []).append((s, e, slot["id"]))
        if class_id is not None:
            self.class_busy.add((day, class_id, slot["id"]))


def try_place(tracker: BusyTracker, day: str, teacher: dict, cls: dict, day_slots: list, is_double: bool):
    """Find the first free period (or two consecutive periods for a double) and book it.
    Returns the list of slots booked, or None."""
    for idx, slot in enumerate(day_slots):
        if not (tracker.teacher_free(day, teacher["id"], slot) and tracker.class_free(day, cls["id"], slot)):
            continue
        if not is_double:
            tracker.book(day, teacher["id"], cls["id"], slot)
            return [slot]
        if idx + 1 < len(day_slots):
            nxt = day_slots[idx + 1]
            if tracker.teacher_free(day, teacher["id"], nxt) and tracker.class_free(day, cls["id"], nxt):
                tracker.book(day, teacher["id"], cls["id"], slot)
                tracker.book(day, teacher["id"], cls["id"], nxt)
                return [slot, nxt]
    return None


def teacher_technology(teacher: dict) -> Optional[str]:
    """Teacher.subject is stored as 'Course (Technology · Year)'. Pull the technology out."""
    m = re.search(r"\(([^()·]+?)\s*·", (teacher or {}).get("subject") or "")
    return m.group(1).strip() if m else None


# --- ADMIN CRUD ENDPOINTS ---

@app.get("/get-all-data")
def get_all_data():
    try:
        teachers = supabase.table("teachers").select("*").execute().data
        classes = supabase.table("classes").select("*").execute().data
        time_slots = sorted(
            supabase.table("time_slots").select("*").execute().data, key=slot_sort_key
        )
        courses = supabase.table("courses").select("*").order("year").execute().data
        assignments = supabase.table("course_assignments").select(
            "*, teachers(name, subject, is_double_period), classes(class_name, section, shift)"
        ).execute().data
        try:
            absences = supabase.table("teacher_absences").select("*").execute().data
        except Exception:
            absences = []  # migration.sql not run yet
        return {
            "success": True,
            "teachers": teachers,
            "classes": classes,
            "time_slots": time_slots,
            "courses": courses,
            "assignments": assignments,
            "absences": absences,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/add-teacher")
def add_teacher(data: TeacherSchema):
    try:
        payload = {
            "name": data.name,
            "subject": data.subject,
            "is_double_period": data.is_double_period,
            "shift": data.shift or "Morning",
        }
        res = supabase.table("teachers").insert(payload).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-teacher/{teacher_id}")
def update_teacher(teacher_id: int, data: TeacherSchema):
    try:
        payload = {
            "name": data.name,
            "subject": data.subject,
            "is_double_period": data.is_double_period,
            "shift": data.shift or "Morning",
        }
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
        res = supabase.table("classes").insert(
            {"class_name": data.class_name, "section": data.section, "shift": data.shift or "Morning"}
        ).execute()
        return {"success": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/update-class/{class_id}")
def update_class(class_id: int, data: ClassSchema):
    try:
        res = supabase.table("classes").update(
            {"class_name": data.class_name, "section": data.section, "shift": data.shift or "Morning"}
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
            "applies_on_friday": data.applies_on_friday,
            "shift": data.shift or "Morning",
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
            "applies_on_friday": data.applies_on_friday,
            "shift": data.shift or "Morning",
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


@app.post("/setup-default-shifts")
def setup_default_shifts():
    """Adds the standard Morning / 2nd / 3rd shift periods. Safe to click more than once:
    a shift that already has periods is left untouched."""
    try:
        existing = supabase.table("time_slots").select("*").execute().data
        have = {shift_of(s) for s in existing}
        added = []
        for shift in SHIFT_ORDER:
            if shift in have:
                continue
            rows = build_shift_slots(shift)
            supabase.table("time_slots").insert(rows).execute()
            added.append(f"{shift} ({len(rows)} periods)")
        if not added:
            return {"success": True, "message": "All three shifts already have periods - nothing was added."}
        return {"success": True, "message": "Added periods for: " + ", ".join(added) + "."}
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
        teacher_res = supabase.table("teachers").select("*").eq("id", data.teacher_id).execute().data
        class_res = supabase.table("classes").select("*").eq("id", data.class_id).execute().data
        if not teacher_res:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        if not class_res:
            raise HTTPException(status_code=404, detail="Class not found.")
        teacher, cls = teacher_res[0], class_res[0]
        if shift_of(teacher) != shift_of(cls):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{teacher['name']} is a {shift_info_label(shift_of(teacher))} teacher and can't be linked to "
                    f"{cls['class_name']}-{cls['section']}, which is a {shift_info_label(shift_of(cls))} class. "
                    f"Pick a teacher from the same shift, or change the teacher's shift."
                ),
            )
        payload = {
            "teacher_id": data.teacher_id,
            "class_id": data.class_id,
            "sessions_per_week": data.sessions_per_week or 5,
        }
        res = supabase.table("course_assignments").insert(payload).execute()
        return {"success": True, "data": res.data}
    except HTTPException:
        raise
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

        time_slots = supabase.table("time_slots").select("*").execute().data
        if not time_slots:
            raise HTTPException(status_code=400, detail="Please add Time Slots first.")

        slot_map = {s["id"]: s for s in time_slots}
        existing = supabase.table("timetable").select("day, time_slot_id, class_id, teacher_id").execute().data
        tracker = BusyTracker()
        for e in existing:
            if e["time_slot_id"] in slot_map:
                tracker.book(e["day"], e["teacher_id"], e["class_id"], slot_map[e["time_slot_id"]])

        if shift_of(teacher) != shift_of(cls):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{teacher['name']} is a {shift_info_label(shift_of(teacher))} teacher and can't teach "
                    f"{cls['class_name']}-{cls['section']}, which is a {shift_info_label(shift_of(cls))} class."
                ),
            )

        days_to_try = [data.day] if data.day else DAYS
        is_double = teacher.get("is_double_period", False)
        shift = shift_of(cls)

        for day in days_to_try:
            day_slots = slots_for_day(time_slots, day, shift)
            placed = try_place(tracker, day, teacher, cls, day_slots, is_double)
            if placed:
                entries = [
                    {"day": day, "class_id": cls["id"], "teacher_id": teacher["id"], "time_slot_id": s["id"]}
                    for s in placed
                ]
                supabase.table("timetable").insert(entries).execute()
                periods = [s["period_number"] for s in placed]
                period_txt = f"Period {periods[0]}" + (f" & {periods[1]} (double period)" if len(periods) > 1 else "")
                return {
                    "success": True,
                    "message": f"{teacher['name']} ({teacher['subject']}) was assigned to {cls['class_name']}-{cls['section']} ({shift} shift) on {day}, {period_txt}.",
                    "day": day,
                    "periods": periods,
                    "double_period": len(periods) > 1,
                }

        raise HTTPException(
            status_code=409,
            detail=f"No free slot was found in the {shift} shift for this teacher/class. Try a different day, or add more Time Slots."
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# --- SMART CONSTRAINT-BASED TIMETABLE GENERATOR ---
# Reads every Course Assignment (teacher + class + sessions/week) and spreads each one across
# Monday-Friday on its own, clash-free, honoring the teacher's double-period flag and the
# class's shift. Any absences already recorded are re-applied afterwards.

@app.post("/generate-timetable")
def generate_timetable():
    try:
        assignments = supabase.table("course_assignments").select(
            "*, teachers(*), classes(*)"
        ).execute().data
        time_slots = supabase.table("time_slots").select("*").execute().data

        if not assignments:
            raise HTTPException(
                status_code=400,
                detail="Please add Teachers, Classes, and Time Slots first, then link each teacher to a class under 'Course Assignments'."
            )
        if not time_slots:
            raise HTTPException(status_code=400, detail="Please add Time Slots first.")

        # Clear the previous timetable before rebuilding it (substitutions cascade with it)
        supabase.table("timetable").delete().gt("id", 0).execute()

        generated_entries = []
        shortfalls = []
        tracker = BusyTracker()

        # Heaviest weekly loads are placed first - they're the hardest to fit
        assignments_sorted = sorted(assignments, key=lambda a: -(a.get("sessions_per_week") or 5))

        for a in assignments_sorted:
            teacher = a.get("teachers")
            cls = a.get("classes")
            if not teacher or not cls:
                continue

            sessions_needed = a.get("sessions_per_week") or 5
            is_double = teacher.get("is_double_period", False)
            shift = shift_of(cls)

            if shift_of(teacher) != shift:
                shortfalls.append(
                    f"{teacher['name']} ({shift_info_label(shift_of(teacher))}) -> {cls['class_name']}-{cls['section']} "
                    f"({shift_info_label(shift)}): shifts don't match, skipped - fix this Course Assignment"
                )
                continue

            if not any(shift_of(s) == shift for s in time_slots):
                shortfalls.append(
                    f"{cls['class_name']}-{cls['section']}: no periods exist for the {shift} shift (use 'Load default shift timings')"
                )
                continue

            day_order = DAYS.copy()
            random.shuffle(day_order)  # fairness: don't always start the week on Monday

            placed = 0
            attempts = 0
            max_attempts = sessions_needed * len(DAYS)

            while placed < sessions_needed and attempts < max_attempts:
                day = day_order[attempts % len(DAYS)]
                attempts += 1
                day_slots = slots_for_day(time_slots, day, shift)
                result = try_place(tracker, day, teacher, cls, day_slots, is_double)
                if result:
                    for s in result:
                        generated_entries.append(
                            {"day": day, "class_id": cls["id"], "teacher_id": teacher["id"], "time_slot_id": s["id"]}
                        )
                    placed += 1

            if placed < sessions_needed:
                shortfalls.append(
                    f"{teacher['name']} ({teacher['subject']}) -> {cls['class_name']}-{cls['section']}: {placed}/{sessions_needed} periods placed"
                )

        if generated_entries:
            supabase.table("timetable").insert(generated_entries).execute()

        # Re-apply any recorded absences to the fresh timetable
        sub_count = 0
        try:
            absence_days = {a["day"] for a in supabase.table("teacher_absences").select("*").execute().data}
            for day in absence_days:
                sub_count += len(apply_substitutions(day)["assigned"])
        except Exception:
            pass

        message = f"Schedule auto-distributed across Monday-Friday. {len(generated_entries)} period-slots filled."
        if sub_count:
            message += f" {sub_count} period(s) were covered by substitute teachers for recorded absences."
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


def fetch_timetable_merged() -> list:
    """Timetable rows with the class, original teacher, period (incl. shift) and - when the
    original teacher is absent - the `substitute` teacher covering that period."""
    rows = supabase.table("timetable").select(
        "id, day, class_id, teacher_id, classes(*), teachers(*), time_slots(*)"
    ).execute().data
    try:
        subs = supabase.table("substitutions").select("*").execute().data
    except Exception:
        subs = []  # migration.sql not run yet
    teacher_by_id = {t["id"]: t for t in supabase.table("teachers").select("*").execute().data} if subs else {}
    sub_by_tt = {s["timetable_id"]: teacher_by_id.get(s["substitute_teacher_id"]) for s in subs}
    for r in rows:
        r["substitute"] = sub_by_tt.get(r["id"])
    return rows


@app.delete("/clear-timetable")
def clear_timetable():
    """Wipes the generated/manual timetable (and any substitutions riding on it). Teachers,
    classes, courses, periods and absence records are left untouched, so it can be regenerated
    or rebuilt from scratch."""
    try:
        try:
            supabase.table("substitutions").delete().gt("id", 0).execute()
        except Exception:
            pass  # migration.sql not run yet - nothing to clean up there
        supabase.table("timetable").delete().gt("id", 0).execute()
        return {"success": True, "message": "Timetable cleared. Course assignments and periods were kept."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/get-timetable")
def get_timetable():
    try:
        return {"success": True, "timetable": fetch_timetable_merged()}
    except Exception as e:
        return {"success": False, "error": str(e)}


# --- TEACHER ABSENCE + AUTOMATIC SUBSTITUTES ---
# When a teacher is marked absent on a day, every period they teach that day is handed to a
# teacher who is free at that exact time (and not absent themselves). The original timetable is
# never edited - substitutions live in their own table, so removing the absence restores
# everything. Preference order for who covers: same teacher for both halves of a double period,
# then a teacher of the class's technology, then one of the absent teacher's technology, then
# anyone free - always picking whoever has covered the fewest periods so far.

def apply_substitutions(day: str) -> dict:
    entries = supabase.table("timetable").select(
        "id, day, class_id, teacher_id, time_slot_id, time_slots(*), classes(*)"
    ).eq("day", day).execute().data
    teachers = supabase.table("teachers").select("*").execute().data
    teacher_by_id = {t["id"]: t for t in teachers}
    absences = supabase.table("teacher_absences").select("*").eq("day", day).execute().data
    absent_ids = {a["teacher_id"] for a in absences}
    absence_for = {a["teacher_id"]: a["id"] for a in absences}
    subs = supabase.table("substitutions").select("*").eq("day", day).execute().data

    # A substitute who has now gone absent themselves can no longer cover - free those periods up
    stale = [s for s in subs if s["substitute_teacher_id"] in absent_ids]
    if stale:
        supabase.table("substitutions").delete().in_("id", [s["id"] for s in stale]).execute()
        subs = [s for s in subs if s not in stale]

    sub_by_tt = {s["timetable_id"]: s["substitute_teacher_id"] for s in subs}

    tracker = BusyTracker()
    for e in entries:
        slot = e.get("time_slots")
        if not slot:
            continue
        effective = sub_by_tt.get(e["id"], e["teacher_id"])
        if effective in absent_ids:
            continue  # absent and uncovered -> not actually teaching
        tracker.book(day, effective, None, slot)

    load = {}
    for tid in sub_by_tt.values():
        load[tid] = load.get(tid, 0) + 1

    targets = [
        e for e in entries
        if e["teacher_id"] in absent_ids and e["id"] not in sub_by_tt and e.get("time_slots")
    ]
    targets.sort(key=lambda e: (to_minutes(e["time_slots"].get("start_time")) or 0, shift_index(e["time_slots"])))

    new_rows, assigned, unresolved = [], [], []
    last_sub = {}
    for e in targets:
        slot = e["time_slots"]
        cls = e.get("classes") or {}
        orig = teacher_by_id.get(e["teacher_id"], {})
        where = f"{day}, {cls.get('class_name', '?')}-{cls.get('section', '?')}, {shift_of(slot)} shift P{slot.get('period_number')}"

        candidates = [
            t for t in teachers
            if t["id"] not in absent_ids
            and shift_of(t) == shift_of(cls)
            and tracker.teacher_free(day, t["id"], slot)
        ]
        if not candidates:
            unresolved.append(f"{orig.get('name', '?')} ({where}): no free teacher available")
            continue

        preferred = last_sub.get((e["class_id"], e["teacher_id"]))
        class_tech = cls.get("section")
        orig_tech = teacher_technology(orig)

        def score(t):
            tech = teacher_technology(t)
            tier = 0 if tech and tech == class_tech else (1 if tech and tech == orig_tech else 2)
            return (0 if t["id"] == preferred else 1, tier, load.get(t["id"], 0), t["id"])

        chosen = min(candidates, key=score)
        tracker.book(day, chosen["id"], None, slot)
        load[chosen["id"]] = load.get(chosen["id"], 0) + 1
        last_sub[(e["class_id"], e["teacher_id"])] = chosen["id"]
        new_rows.append({
            "absence_id": absence_for[e["teacher_id"]],
            "timetable_id": e["id"],
            "original_teacher_id": e["teacher_id"],
            "substitute_teacher_id": chosen["id"],
            "day": day,
            "time_slot_id": e["time_slot_id"],
        })
        assigned.append(f"{orig.get('name', '?')} -> {chosen['name']} ({where})")

    if new_rows:
        supabase.table("substitutions").insert(new_rows).execute()
    return {"assigned": assigned, "unresolved": unresolved}


@app.post("/mark-absent")
def mark_absent(data: AbsenceSchema):
    try:
        teacher_res = supabase.table("teachers").select("*").eq("id", data.teacher_id).execute().data
        if not teacher_res:
            raise HTTPException(status_code=404, detail="Teacher not found.")
        teacher = teacher_res[0]

        days = [d for d in data.days if d in DAYS]
        if not days:
            raise HTTPException(status_code=400, detail="Please choose at least one weekday.")

        assigned, unresolved = [], []
        for day in days:
            already = supabase.table("teacher_absences").select("id").eq(
                "teacher_id", data.teacher_id).eq("day", day).execute().data
            if not already:
                supabase.table("teacher_absences").insert({"teacher_id": data.teacher_id, "day": day}).execute()
            result = apply_substitutions(day)
            assigned += result["assigned"]
            unresolved += result["unresolved"]

        message = f"{teacher['name']} marked absent ({', '.join(days)})."
        if assigned:
            message += f" {len(assigned)} period(s) covered by free teachers."
        else:
            message += " No periods needed covering."
        if unresolved:
            message += " Could not cover: " + "; ".join(unresolved)
        return {"success": True, "message": message, "assigned": assigned, "unresolved": unresolved}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)} (have you run migration.sql in Supabase?)"
        )


@app.delete("/remove-absence/{absence_id}")
def remove_absence(absence_id: int):
    try:
        supabase.table("substitutions").delete().eq("absence_id", absence_id).execute()
        supabase.table("teacher_absences").delete().eq("id", absence_id).execute()
        return {"success": True, "message": "Absence removed - the original timetable is back in place."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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
        timetable = fetch_timetable_merged()

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
        cell_style = ParagraphStyle("ReportCell", parent=styles["Normal"], fontSize=8, leading=9.5)

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
            t = entry.get("substitute") or entry.get("teachers")
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
        any_day_rendered = False
        for day in DAYS:
            day_entries = sorted(
                [e for e in timetable if e["day"] == day],
                key=lambda e: slot_sort_key(e.get("time_slots") or {})
            )
            if not day_entries:
                continue
            any_day_rendered = True
            elements.append(Paragraph(day, day_style))
            table_data = [["Shift / Period", "Time", "Class", "Teacher", "Course"]]
            for e in day_entries:
                ts = e.get("time_slots") or {}
                cls = e.get("classes") or {}
                t = e.get("teachers") or {}
                sub = e.get("substitute")
                teacher_txt = f"{sub['name']} (sub for {t.get('name', '')})" if sub else t.get("name", "")
                table_data.append([
                    f"{shift_of(ts)} · P{ts.get('period_number', '-')}",
                    f"{fmt_12h(ts.get('start_time'))} - {fmt_12h(ts.get('end_time'))}",
                    Paragraph(f"{cls.get('class_name', '')} ({cls.get('section', '')})", cell_style),
                    Paragraph(teacher_txt, cell_style),
                    Paragraph(t.get("subject", ""), cell_style),
                ])
            day_table = Table(table_data, colWidths=[2.6 * cm, 3.6 * cm, 3.2 * cm, 3.8 * cm, 4.8 * cm])
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