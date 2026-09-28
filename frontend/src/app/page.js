'use client';

import { useState, useEffect, useMemo } from 'react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const YEARS = ['1st Year', '2nd Year', '3rd Year'];

// Shifts. `value` is what is stored in the database.
const SHIFTS = [
  { value: 'Morning', label: 'Morning shift', short: 'Morning', hours: '9:00 AM – 1:30 PM' },
  { value: 'Afternoon', label: '2nd shift', short: '2nd shift', hours: '2:00 PM – 6:00 PM' },
  { value: 'Evening', label: '3rd shift', short: '3rd shift', hours: '5:00 PM – 9:00 PM' },
];
const shiftInfo = (value) => SHIFTS.find((s) => s.value === (value || 'Morning')) || SHIFTS[0];
const shiftIndex = (value) => Math.max(0, SHIFTS.findIndex((s) => s.value === (value || 'Morning')));

// '09:00' or '9:00 AM' -> '9:00 AM'
function fmtTime(t) {
  if (!t) return '';
  const m = String(t).trim().match(/^(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const mins = m[2];
  if (m[3]) return `${h}:${mins} ${m[3].toUpperCase()}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mins} ${suffix}`;
}
// Common DAE technologies offered across Pakistani technical boards. This is a general
// reference list, not a confirmed roster from your specific institute or board — add,
// rename, or remove entries here to match what you actually offer.
const TECHNOLOGIES = [
  'CIT',
  'Software',
  'Auto Diesel',
  'Mechanical',
  'Electrical',
  'Electronics',
  'Civil',
  'Chemical',
  'Architecture',
  'Textile',
  'Textile Spinning',
  'Textile Processing',
  'Instrument Technology',
  'Refrigeration & Air Conditioning',
  'Mining',
  'Petroleum',
  'Metallurgy',
  'Surveyor',
  'Marine',
  'Other',
];

// Lightweight, dependency-free SVG bar chart matching the app's palette.
function BarChart({ data, color = '#C9A24B' }) {
  const W = 320, H = 180, padBottom = 34, padTop = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barSlot = data.length ? (W - 20) / data.length : 0;

  if (data.length === 0) {
    return <p className="text-xs text-[#4A5157]">No data yet.</p>;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <line x1="10" y1={H - padBottom} x2={W - 10} y2={H - padBottom} stroke="#2A343B" strokeWidth="1" />
      {data.map((d, i) => {
        const barH = ((H - padBottom - padTop) * d.value) / max;
        const x = 10 + i * barSlot + barSlot * 0.15;
        const w = barSlot * 0.7;
        const y = H - padBottom - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={w} height={Math.max(barH, 1)} fill={color} rx="2" />
            <text x={x + w / 2} y={y - 4} fontSize="7" textAnchor="middle" fill="#ECE8DE">{d.value}</text>
            <text x={x + w / 2} y={H - padBottom + 12} fontSize="6.5" textAnchor="middle" fill="#92999E">
              {d.label.length > 9 ? d.label.slice(0, 8) + '…' : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Lightweight, dependency-free SVG pie chart with a legend.
function PieChart({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let cumulative = 0;
  const R = 42, CX = 50, CY = 50;
  const toXY = (angle) => [CX + R * Math.cos(angle), CY + R * Math.sin(angle)];

  if (data.length === 0) {
    return <p className="text-xs text-[#4A5157]">No data yet.</p>;
  }

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg viewBox="0 0 100 100" className="w-32 h-32 shrink-0">
        {data.map((d) => {
          const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
          cumulative += d.value;
          const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
          const [x1, y1] = toXY(startAngle);
          const [x2, y2] = toXY(endAngle);
          const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
          const path = data.length === 1
            ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
            : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          return <path key={d.label} d={path} fill={d.color} stroke="#12181C" strokeWidth="0.5" />;
        })}
      </svg>
      <div className="space-y-1.5 text-xs">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-[#ECE8DE]">{d.label}</span>
            <span className="text-[#6B7378]">({d.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState('grid');
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Admin data
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);
  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [absentForm, setAbsentForm] = useState({ teacher_id: '', day: DAYS[0] });

  // Form inputs
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherYear, setNewTeacherYear] = useState('');
  const [newTeacherTechnology, setNewTeacherTechnology] = useState('');
  const [newTeacherCourseId, setNewTeacherCourseId] = useState('');
  const [newTeacherDouble, setNewTeacherDouble] = useState(false);
  const [newTeacherShift, setNewTeacherShift] = useState('Morning');

  const [newClass, setNewClass] = useState({ class_name: '', section: '', customSection: '', shift: 'Morning' });
  const [newSlot, setNewSlot] = useState({ period_number: '', start_time: '', end_time: '', applies_on_friday: true, shift: 'Morning' });
  const [newCourse, setNewCourse] = useState({ year: '1st Year', technology: TECHNOLOGIES[0], name: '', course_type: 'Theory' });
  const [catalogTechFilter, setCatalogTechFilter] = useState('All');
  const [newAssignment, setNewAssignment] = useState({ teacher_id: '', class_id: '', sessions_per_week: 5 });

  // Edit mode
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [editTeacher, setEditTeacher] = useState({ name: '', subject: '', is_double_period: false, shift: 'Morning' });
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [editCourse, setEditCourse] = useState({ year: '1st Year', technology: TECHNOLOGIES[0], name: '', course_type: 'Theory' });
  const [editingClassId, setEditingClassId] = useState(null);
  const [editClass, setEditClass] = useState({ class_name: '', section: '', customSection: '', shift: 'Morning' });
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [editSlot, setEditSlot] = useState({ period_number: '', start_time: '', end_time: '', applies_on_friday: true, shift: 'Morning' });

  const loadAllData = async () => {
    try {
      const ttRes = await fetch('/api/get-timetable');
      const ttData = await ttRes.json();
      if (ttData.success) setTimetable(ttData.timetable || []);

      const adminRes = await fetch('/api/get-all-data');
      const adminData = await adminRes.json();
      if (adminData.success) {
        setTeachers(adminData.teachers || []);
        setClasses(adminData.classes || []);
        setTimeSlots(adminData.time_slots || []);
        setCourses(adminData.courses || []);
        setAssignments(adminData.assignments || []);
        setAbsences(adminData.absences || []);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleClearTimetable = async () => {
    if (!window.confirm('Clear the whole timetable? Course assignments and periods will be kept, so you can regenerate any time.')) {
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/clear-timetable', { method: 'DELETE' });
      const data = await res.json();
      setMessage(res.ok && data.success ? data.message : data.detail || 'Could not clear the timetable.');
      loadAllData();
    } catch (err) {
      setMessage('Server error. Please make sure the FastAPI server is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/generate-timetable', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage(data.message);
        loadAllData();
      } else {
        setMessage(data.detail || 'Generation failed.');
      }
    } catch (err) {
      setMessage('Server error. Please make sure the FastAPI server is running.');
    } finally {
      setLoading(false);
    }
  };

  // Courses available for the year + technology currently selected in the Teacher form
  const coursesForSelectedYear = useMemo(
    () => courses.filter((c) => c.year === newTeacherYear && c.technology === newTeacherTechnology),
    [courses, newTeacherYear, newTeacherTechnology]
  );

  const selectedCourse = useMemo(
    () => courses.find((c) => String(c.id) === String(newTeacherCourseId)),
    [courses, newTeacherCourseId]
  );

  const sortedSlots = useMemo(
    () =>
      [...timeSlots].sort(
        (a, b) => shiftIndex(a.shift) - shiftIndex(b.shift) || (a.period_number || 0) - (b.period_number || 0)
      ),
    [timeSlots]
  );

  const substitutionRows = useMemo(
    () =>
      timetable
        .filter((e) => e.substitute)
        .sort(
          (a, b) =>
            DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
            shiftIndex(a.time_slots?.shift) - shiftIndex(b.time_slots?.shift) ||
            (a.time_slots?.period_number || 0) - (b.time_slots?.period_number || 0)
        ),
    [timetable]
  );

  const sortedAbsences = useMemo(
    () => [...absences].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)),
    [absences]
  );

  // --- REPORT DATA: teacher workload (bar) and course-type split (pie) ---
  const teacherWorkloadData = useMemo(() => {
    const counts = {};
    timetable.forEach((entry) => {
      const name = (entry.substitute || entry.teachers)?.name;
      if (name) counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [timetable]);

  const courseTypeData = useMemo(() => {
    const counts = {};
    courses.forEach((c) => {
      const type = c.course_type || 'Theory';
      counts[type] = (counts[type] || 0) + 1;
    });
    const palette = { Theory: '#C9A24B', Lab: '#6E9583', 'Theory + Lab': '#8AAEDB' };
    return Object.entries(counts).map(([label, value], i) => ({
      label,
      value,
      color: palette[label] || ['#9CA3A8', '#A6543D'][i % 2],
    }));
  }, [courses]);

  // --- TEACHER ACTIONS ---
  const handleAddTeacher = async (e) => {
    e.preventDefault();
    if (!newTeacherName || !selectedCourse) return;
    await fetch('/api/add-teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTeacherName,
        subject: `${selectedCourse.name} (${newTeacherTechnology} · ${newTeacherYear})`,
        is_double_period: newTeacherDouble,
        shift: newTeacherShift,
      }),
    });
    setNewTeacherName('');
    setNewTeacherYear('');
    setNewTeacherTechnology('');
    setNewTeacherCourseId('');
    setNewTeacherDouble(false);
    setNewTeacherShift('Morning');
    loadAllData();
  };

  const handleUpdateTeacher = async (id) => {
    await fetch(`/api/update-teacher/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editTeacher),
    });
    setEditingTeacherId(null);
    loadAllData();
  };

  const handleDeleteTeacher = async (id) => {
    await fetch(`/api/delete-teacher/${id}`, { method: 'DELETE' });
    loadAllData();
  };

  // --- CLASS ACTIONS ---
  const handleAddClass = async (e) => {
    e.preventDefault();
    const resolvedSection = newClass.section === 'Other' ? newClass.customSection.trim() : newClass.section;
    if (!newClass.class_name || !resolvedSection) return;
    await fetch('/api/add-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_name: newClass.class_name, section: resolvedSection, shift: newClass.shift }),
    });
    setNewClass({ class_name: '', section: '', customSection: '', shift: newClass.shift });
    loadAllData();
  };

  const handleUpdateClass = async (id) => {
    const resolvedSection = editClass.section === 'Other' ? editClass.customSection.trim() : editClass.section;
    if (!editClass.class_name || !resolvedSection) return;
    await fetch(`/api/update-class/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_name: editClass.class_name, section: resolvedSection, shift: editClass.shift }),
    });
    setEditingClassId(null);
    loadAllData();
  };

  const handleDeleteClass = async (id) => {
    await fetch(`/api/delete-class/${id}`, { method: 'DELETE' });
    loadAllData();
  };

  // --- SLOT ACTIONS ---
  const handleAddSlot = async (e) => {
    e.preventDefault();
    if (!newSlot.period_number || !newSlot.start_time || !newSlot.end_time) return;
    await fetch('/api/add-timeslot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_number: parseInt(newSlot.period_number),
        start_time: newSlot.start_time,
        end_time: newSlot.end_time,
        applies_on_friday: newSlot.applies_on_friday,
        shift: newSlot.shift,
      }),
    });
    setNewSlot({ period_number: '', start_time: '', end_time: '', applies_on_friday: true, shift: newSlot.shift });
    loadAllData();
  };

  const handleUpdateSlot = async (id) => {
    if (!editSlot.period_number || !editSlot.start_time || !editSlot.end_time) return;
    await fetch(`/api/update-timeslot/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_number: parseInt(editSlot.period_number),
        start_time: editSlot.start_time,
        end_time: editSlot.end_time,
        applies_on_friday: editSlot.applies_on_friday,
        shift: editSlot.shift,
      }),
    });
    setEditingSlotId(null);
    loadAllData();
  };

  const handleDeleteSlot = async (id) => {
    await fetch(`/api/delete-timeslot/${id}`, { method: 'DELETE' });
    loadAllData();
  };

  // --- COURSE CATALOG ACTIONS (the master subject list, per year, Theory or Lab) ---
  const handleAddCourse = async (e) => {
    e.preventDefault();
    if (!newCourse.year || !newCourse.technology || !newCourse.name) return;
    await fetch('/api/add-course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCourse),
    });
    setNewCourse({ ...newCourse, name: '' });
    loadAllData();
  };

  const handleUpdateCourse = async (id) => {
    if (!editCourse.year || !editCourse.technology || !editCourse.name) return;
    await fetch(`/api/update-course/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editCourse),
    });
    setEditingCourseId(null);
    loadAllData();
  };

  const handleDeleteCourse = async (id) => {
    await fetch(`/api/delete-course/${id}`, { method: 'DELETE' });
    loadAllData();
  };

  // --- COURSE ASSIGNMENT ACTIONS (teacher's course -> class, X sessions/week) ---
  const handleAddAssignment = async (e) => {
    e.preventDefault();
    if (!newAssignment.teacher_id || !newAssignment.class_id) return;
    const res = await fetch('/api/add-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: parseInt(newAssignment.teacher_id),
        class_id: parseInt(newAssignment.class_id),
        sessions_per_week: parseInt(newAssignment.sessions_per_week) || 5,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setMessage(data.detail || 'Could not add the assignment.');
      return;
    }
    setNewAssignment({ teacher_id: '', class_id: '', sessions_per_week: 5 });
    loadAllData();
  };

  const assignmentTeacherOptions = useMemo(() => {
    if (!newAssignment.class_id) return teachers;
    const cls = classes.find((c) => String(c.id) === String(newAssignment.class_id));
    return cls ? teachers.filter((t) => (t.shift || 'Morning') === (cls.shift || 'Morning')) : teachers;
  }, [teachers, classes, newAssignment.class_id]);

  const assignmentClassOptions = useMemo(() => {
    if (!newAssignment.teacher_id) return classes;
    const t = teachers.find((x) => String(x.id) === String(newAssignment.teacher_id));
    return t ? classes.filter((c) => (c.shift || 'Morning') === (t.shift || 'Morning')) : classes;
  }, [teachers, classes, newAssignment.teacher_id]);

  const handleDeleteAssignment = async (id) => {
    await fetch(`/api/delete-assignment/${id}`, { method: 'DELETE' });
    loadAllData();
  };

  // --- SHIFT SETUP ---
  const handleSetupShifts = async () => {
    try {
      const res = await fetch('/api/setup-default-shifts', { method: 'POST' });
      const data = await res.json();
      setMessage(res.ok && data.success ? data.message : data.detail || 'Could not load shift timings.');
    } catch (err) {
      setMessage('Server error. Please make sure the FastAPI server is running.');
    }
    loadAllData();
  };

  // --- ABSENCE ACTIONS ---
  const handleMarkAbsent = async (e) => {
    e.preventDefault();
    if (!absentForm.teacher_id) return;
    const days = absentForm.day === 'Whole week' ? DAYS : [absentForm.day];
    try {
      const res = await fetch('/api/mark-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: parseInt(absentForm.teacher_id), days }),
      });
      const data = await res.json();
      setMessage(res.ok && data.success ? data.message : data.detail || 'Could not mark the teacher absent.');
    } catch (err) {
      setMessage('Server error. Please make sure the FastAPI server is running.');
    }
    setAbsentForm({ ...absentForm, teacher_id: '' });
    loadAllData();
  };

  const handleRemoveAbsence = async (id) => {
    try {
      const res = await fetch(`/api/remove-absence/${id}`, { method: 'DELETE' });
      const data = await res.json();
      setMessage(res.ok && data.success ? data.message : data.detail || 'Could not remove the absence.');
    } catch (err) {
      setMessage('Server error. Please make sure the FastAPI server is running.');
    }
    loadAllData();
  };

  return (
    <div className="min-h-screen bg-[#12181C] text-[#ECE8DE] font-[Inter,sans-serif]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Source Serif 4', Georgia, serif; }
        .font-ui { font-family: 'IBM Plex Sans', system-ui, sans-serif; }
        /* Stop the page jiggling when the mouse moves over it: reserve room for the scrollbar
           so it appearing/disappearing never changes the layout width. */
        html { overflow-y: scroll; scrollbar-gutter: stable; }
        body { overflow-x: hidden; }
        .scroll-stable { scrollbar-gutter: stable; overscroll-behavior: contain; }
      `}</style>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8 font-ui">

        {/* Letterhead */}
        <header className="border-b border-[#2A343B] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-[#C9A24B] text-xs tracking-wide mb-1">Timetable office</p>
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-[#ECE8DE]">
              Weekly Class Schedule
            </h1>
            <p className="text-[#92999E] text-sm mt-1.5">
              Add a teacher and their course once, link it to a class — the engine spreads it across Monday–Friday.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleClearTimetable}
              disabled={loading || timetable.length === 0}
              className="bg-transparent border border-[#C97B5F] text-[#C97B5F] hover:bg-[#C97B5F] hover:text-[#12181C] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#C97B5F] font-semibold px-4 py-2.5 rounded-md text-sm transition-colors"
            >
              Clear timetable
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="bg-[#C9A24B] hover:bg-[#E4C77A] disabled:opacity-40 text-[#12181C] font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
            >
              {loading ? 'Distributing…' : 'Auto-distribute Mon–Fri'}
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="flex gap-6 -mt-2">
          {[
            { id: 'grid', label: 'Weekly timetable' },
            { id: 'admin', label: 'Teachers, classes & courses' },
            { id: 'absence', label: `Absences & substitutes${absences.length ? ` (${absences.length})` : ''}` },
            { id: 'reports', label: 'Reports' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'text-[#ECE8DE]' : 'text-[#6B7378] hover:text-[#9CA3A8]'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#C9A24B] rounded-full" />
              )}
            </button>
          ))}
        </nav>
        <div className="border-b border-[#2A343B] -mt-8" />

        {message && (
          <div className="border-l-2 border-[#C9A24B] bg-[#1F272D] px-4 py-3 text-sm text-[#ECE8DE] rounded-r-md leading-relaxed">
            {message}
          </div>
        )}

        {activeTab === 'grid' && (
          <div className="space-y-10">
            {assignments.length === 0 && (
              <div className="bg-[#181F24] border border-[#2A343B] border-l-2 border-l-[#C9A24B] rounded-lg p-5 text-sm text-[#92999E]">
                There are no course assignments yet. Go to the{' '}
                <span className="text-[#ECE8DE]">Teachers, classes &amp; courses</span> tab, link a teacher to a
                class, then come back here and click "Auto-distribute".
              </div>
            )}

            {/* ONE WEEKLY GRID PER SHIFT — each shift's teachers and classes are separate,
                so each shift gets its own Monday–Friday board. */}
            {SHIFTS.map((shift) => {
              const shiftSlots = timetable.filter((item) => (item.time_slots?.shift || 'Morning') === shift.value);

              return (
                <div key={shift.value} className="space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#2A343B] pb-2">
                    <h2 className="font-display text-xl font-semibold text-[#ECE8DE]">
                      {shift.label} <span className="text-[#6B7378] text-sm font-normal">· {shift.hours}</span>
                    </h2>
                    <span className="text-[11px] text-[#6B7378]">
                      {shiftSlots.length} {shiftSlots.length === 1 ? 'period' : 'periods'} scheduled this week
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {DAYS.map((day) => {
                      const daySlots = shiftSlots
                        .filter((item) => item.day === day)
                        .sort((a, b) => (a.time_slots?.period_number || 0) - (b.time_slots?.period_number || 0));

                      return (
                        <div key={day} className="bg-[#181F24] border border-[#2A343B] rounded-lg flex flex-col">
                          <div className="flex justify-between items-center px-4 py-3 border-b border-[#2A343B]">
                            <h3 className="font-display text-base font-semibold">
                              {day}
                            </h3>
                            <span className="text-[11px] text-[#6B7378]">
                              {daySlots.length} {daySlots.length === 1 ? 'period' : 'periods'}
                            </span>
                          </div>

                          {daySlots.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center min-h-[140px]">
                              <p className="text-[#4A5157] text-xs">Nothing scheduled yet</p>
                            </div>
                          ) : (
                            <div className="flex-1 divide-y divide-[#2A343B]">
                              {daySlots.map((slot) => (
                                <div key={slot.id} className="px-4 py-3 space-y-1">
                                  <div className="flex justify-between items-baseline text-[11px] text-[#6B7378]">
                                    <span>Period {slot.time_slots?.period_number ?? '—'}</span>
                                    <span>{fmtTime(slot.time_slots?.start_time)}–{fmtTime(slot.time_slots?.end_time)}</span>
                                  </div>
                                  <div className="text-sm font-semibold text-[#ECE8DE]">
                                    {slot.classes?.class_name} <span className="text-[#92999E] font-normal">({slot.classes?.section})</span>
                                  </div>
                                  <div className="flex justify-between items-center text-xs text-[#92999E] pt-0.5">
                                    {slot.substitute ? (
                                      <span>
                                        <span className="line-through text-[#6B7378]">{slot.teachers?.name}</span>{' '}
                                        <span className="text-[#C9A24B] font-medium">→ {slot.substitute.name}</span>
                                      </span>
                                    ) : (
                                      <span>{slot.teachers?.name}</span>
                                    )}
                                    <span className={slot.teachers?.is_double_period ? 'text-[#6E9583]' : 'text-[#6B7378]'}>
                                      {slot.teachers?.subject}{slot.teachers?.is_double_period ? ' · double' : ''}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="space-y-5">

            {/* COURSE CATALOG — the master subject list per year, Theory or Lab */}
            <div className="bg-[#181F24] border border-[#2A343B] border-l-2 border-l-[#C9A24B] rounded-lg p-5 space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Course catalog</h3>
                <p className="text-[#92999E] text-sm mt-1">
                  The subjects offered in each year, so a teacher can be linked to a real course instead of typed
                  free text. Add your institute's official Sindh Board of Technical Education (SBTE) subjects here —
                  Theory and Lab are tracked separately, since labs need a double period.
                </p>
              </div>

              <form onSubmit={handleAddCourse} className="grid grid-cols-1 md:grid-cols-[0.9fr_1fr_1.6fr_0.9fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Year</label>
                  <select
                    value={newCourse.year}
                    onChange={(e) => setNewCourse({ ...newCourse, year: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Technology</label>
                  <select
                    value={newCourse.technology}
                    onChange={(e) => setNewCourse({ ...newCourse, technology: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    {TECHNOLOGIES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Course name</label>
                  <input
                    type="text"
                    placeholder="e.g. Database Systems"
                    value={newCourse.name}
                    onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Type</label>
                  <select
                    value={newCourse.course_type}
                    onChange={(e) => setNewCourse({ ...newCourse, course_type: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="Theory">Theory</option>
                    <option value="Lab">Lab</option>
                    <option value="Theory + Lab">Theory + Lab</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="bg-[#C9A24B] hover:bg-[#E4C77A] text-[#12181C] font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
                >
                  Add course
                </button>
              </form>

              <div className="flex items-center gap-2 pt-1">
                <label className="text-xs text-[#92999E]">Filter by technology:</label>
                <select
                  value={catalogTechFilter}
                  onChange={(e) => setCatalogTechFilter(e.target.value)}
                  className="bg-[#12181C] border border-[#2A343B] p-1.5 rounded-md text-xs outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                >
                  <option value="All">All technologies</option>
                  {TECHNOLOGIES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {YEARS.map((year) => {
                  const yearCourses = courses.filter(
                    (c) => c.year === year && (catalogTechFilter === 'All' || c.technology === catalogTechFilter)
                  );
                  return (
                    <div key={year} className="space-y-1.5">
                      <p className="text-xs text-[#6B7378]">
                        {year} ({yearCourses.length})
                      </p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto scroll-stable">
                        {yearCourses.map((c) => (
                          <div key={c.id} className="bg-[#12181C] border border-[#2A343B] px-2.5 py-2 rounded-md text-xs">
                            {editingCourseId === c.id ? (
                              <div className="space-y-1.5">
                                <select
                                  value={editCourse.year}
                                  onChange={(e) => setEditCourse({ ...editCourse, year: e.target.value })}
                                  className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                                >
                                  {YEARS.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                  ))}
                                </select>
                                <select
                                  value={editCourse.technology}
                                  onChange={(e) => setEditCourse({ ...editCourse, technology: e.target.value })}
                                  className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                                >
                                  {TECHNOLOGIES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={editCourse.name}
                                  onChange={(e) => setEditCourse({ ...editCourse, name: e.target.value })}
                                  className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                                />
                                <select
                                  value={editCourse.course_type}
                                  onChange={(e) => setEditCourse({ ...editCourse, course_type: e.target.value })}
                                  className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                                >
                                  <option value="Theory">Theory</option>
                                  <option value="Lab">Lab</option>
                                  <option value="Theory + Lab">Theory + Lab</option>
                                </select>
                                <div className="flex gap-2 pt-0.5">
                                  <button onClick={() => handleUpdateCourse(c.id)} className="bg-[#6E9583] text-[#12181C] font-medium px-2.5 py-1 rounded text-xs">Save</button>
                                  <button onClick={() => setEditingCourseId(null)} className="bg-[#2A343B] text-[#92999E] px-2.5 py-1 rounded text-xs">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center">
                                <span className="text-[#ECE8DE]">
                                  {c.name}{' '}
                                  <span className="text-[#C9A24B]">· {c.technology}</span>{' '}
                                  <span className={c.course_type === 'Lab' ? 'text-[#6E9583]' : c.course_type === 'Theory + Lab' ? 'text-[#8AAEDB]' : 'text-[#6B7378]'}>
                                    · {c.course_type}
                                  </span>
                                </span>
                                <div className="flex gap-3 shrink-0 pl-2">
                                  <button
                                    onClick={() => {
                                      setEditingCourseId(c.id);
                                      setEditCourse({ year: c.year, technology: c.technology, name: c.name, course_type: c.course_type });
                                    }}
                                    className="text-[#C9A24B]"
                                  >
                                    Edit
                                  </button>
                                  <button onClick={() => handleDeleteCourse(c.id)} className="text-[#C97B5F]">Delete</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {yearCourses.length === 0 && (
                          <p className="text-[11px] text-[#4A5157]">No courses added yet.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* TEACHER FORM */}
              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5 space-y-4">
                <h3 className="font-display text-lg font-semibold">Teachers</h3>
                <form onSubmit={handleAddTeacher} className="space-y-3">
                  <input
                    type="text"
                    placeholder="Teacher name, e.g. Sir Ali"
                    value={newTeacherName}
                    onChange={(e) => setNewTeacherName(e.target.value)}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                  />
                  <select
                    value={newTeacherYear}
                    onChange={(e) => {
                      setNewTeacherYear(e.target.value);
                      setNewTeacherCourseId('');
                    }}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select year</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={newTeacherTechnology}
                    onChange={(e) => {
                      setNewTeacherTechnology(e.target.value);
                      setNewTeacherCourseId('');
                    }}
                    disabled={!newTeacherYear}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE] disabled:opacity-40"
                  >
                    <option value="">
                      {newTeacherYear ? 'Select technology' : 'Select a year first'}
                    </option>
                    {TECHNOLOGIES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={newTeacherCourseId}
                    onChange={(e) => {
                      setNewTeacherCourseId(e.target.value);
                      const course = courses.find((c) => String(c.id) === e.target.value);
                      if (course) setNewTeacherDouble(course.course_type === 'Lab' || course.course_type === 'Theory + Lab');
                    }}
                    disabled={!newTeacherYear || !newTeacherTechnology}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE] disabled:opacity-40"
                  >
                    <option value="">
                      {!newTeacherYear ? 'Select a year first' : !newTeacherTechnology ? 'Select a technology first' : 'Select course'}
                    </option>
                    {coursesForSelectedYear.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.course_type})</option>
                    ))}
                  </select>
                  {newTeacherYear && newTeacherTechnology && coursesForSelectedYear.length === 0 && (
                    <p className="text-xs text-[#C97B5F]">
                      No courses for {newTeacherTechnology} · {newTeacherYear} yet — add one in the Course catalog above first.
                    </p>
                  )}
                  <div>
                    <label className="block text-xs text-[#92999E] mb-1.5">Shift</label>
                    <select
                      value={newTeacherShift}
                      onChange={(e) => setNewTeacherShift(e.target.value)}
                      className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                    >
                      {SHIFTS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label} ({s.hours})</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[#4A5157] mt-1">
                      This teacher can only be linked to classes in the same shift.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer pt-1 text-xs text-[#92999E]">
                    <input
                      type="checkbox"
                      checked={newTeacherDouble}
                      onChange={(e) => setNewTeacherDouble(e.target.checked)}
                      className="w-4 h-4 accent-[#C9A24B] rounded"
                    />
                    <span>Needs a double period (two 45-min slots back to back) — auto-checked for Lab courses</span>
                  </label>
                  <button
                    type="submit"
                    disabled={!newTeacherName || !selectedCourse}
                    className="w-full bg-[#C9A24B] hover:bg-[#E4C77A] disabled:opacity-40 text-[#12181C] font-semibold py-2.5 rounded-md text-sm transition-colors"
                  >
                    Add teacher
                  </button>
                </form>

                <div className="space-y-2 pt-2 max-h-64 overflow-y-auto scroll-stable">
                  <p className="text-xs text-[#6B7378]">Existing teachers ({teachers.length})</p>
                  {teachers.map((t) => (
                    <div key={t.id} className="bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm space-y-2">
                      {editingTeacherId === t.id ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editTeacher.name}
                            onChange={(e) => setEditTeacher({ ...editTeacher, name: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                          />
                          <input
                            type="text"
                            value={editTeacher.subject}
                            onChange={(e) => setEditTeacher({ ...editTeacher, subject: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                          />
                          <select
                            value={editTeacher.shift}
                            onChange={(e) => setEditTeacher({ ...editTeacher, shift: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                          >
                            {SHIFTS.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 text-xs text-[#92999E]">
                            <input
                              type="checkbox"
                              checked={editTeacher.is_double_period}
                              onChange={(e) => setEditTeacher({ ...editTeacher, is_double_period: e.target.checked })}
                            />
                            <span>Double period</span>
                          </label>
                          <div className="flex gap-2">
                            <button onClick={() => handleUpdateTeacher(t.id)} className="bg-[#6E9583] text-[#12181C] font-medium px-2.5 py-1 rounded text-xs">Save</button>
                            <button onClick={() => setEditingTeacherId(null)} className="bg-[#2A343B] text-[#92999E] px-2.5 py-1 rounded text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-[#ECE8DE]">{t.name}</p>
                            <p className="text-xs text-[#6B7378]">
                              <span className="text-[#8AAEDB]">{shiftInfo(t.shift).short}</span> · {t.subject}{t.is_double_period ? ' · double period' : ''}
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={() => {
                                setEditingTeacherId(t.id);
                                setEditTeacher({ name: t.name, subject: t.subject, is_double_period: t.is_double_period, shift: t.shift || 'Morning' });
                              }}
                              className="text-[#C9A24B] text-xs"
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDeleteTeacher(t.id)} className="text-[#C97B5F] text-xs">Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* CLASS FORM */}
              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5 space-y-4">
                <h3 className="font-display text-lg font-semibold">Classes</h3>
                <form onSubmit={handleAddClass} className="space-y-3">
                  <select
                    value={newClass.class_name}
                    onChange={(e) => setNewClass({ ...newClass, class_name: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select year</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select
                    value={newClass.section}
                    onChange={(e) => setNewClass({ ...newClass, section: e.target.value, customSection: '' })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select technology / section</option>
                    {TECHNOLOGIES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {newClass.section === 'Other' && (
                    <input
                      type="text"
                      placeholder="Type the technology name"
                      value={newClass.customSection}
                      onChange={(e) => setNewClass({ ...newClass, customSection: e.target.value })}
                      className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                    />
                  )}
                  <select
                    value={newClass.shift}
                    onChange={(e) => setNewClass({ ...newClass, shift: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    {SHIFTS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label} ({s.hours})</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={!newClass.class_name || !newClass.section || (newClass.section === 'Other' && !newClass.customSection.trim())}
                    className="w-full bg-[#C9A24B] hover:bg-[#E4C77A] disabled:opacity-40 text-[#12181C] font-semibold py-2.5 rounded-md text-sm transition-colors"
                  >
                    Add class
                  </button>
                </form>

                <div className="space-y-2 pt-2 max-h-64 overflow-y-auto scroll-stable">
                  <p className="text-xs text-[#6B7378]">Existing classes ({classes.length})</p>
                  {classes.map((c) => (
                    <div key={c.id} className="bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm space-y-2">
                      {editingClassId === c.id ? (
                        <div className="space-y-1.5">
                          <select
                            value={editClass.class_name}
                            onChange={(e) => setEditClass({ ...editClass, class_name: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                          >
                            {YEARS.map((y) => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                          <select
                            value={TECHNOLOGIES.includes(editClass.section) ? editClass.section : 'Other'}
                            onChange={(e) => setEditClass({ ...editClass, section: e.target.value, customSection: '' })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                          >
                            {TECHNOLOGIES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          {(editClass.section === 'Other' || !TECHNOLOGIES.includes(editClass.section)) && (
                            <input
                              type="text"
                              placeholder="Type the technology name"
                              value={editClass.customSection || (TECHNOLOGIES.includes(editClass.section) ? '' : editClass.section)}
                              onChange={(e) => setEditClass({ ...editClass, section: 'Other', customSection: e.target.value })}
                              className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                            />
                          )}
                          <select
                            value={editClass.shift}
                            onChange={(e) => setEditClass({ ...editClass, shift: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                          >
                            {SHIFTS.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button onClick={() => handleUpdateClass(c.id)} className="bg-[#6E9583] text-[#12181C] font-medium px-2.5 py-1 rounded text-xs">Save</button>
                            <button onClick={() => setEditingClassId(null)} className="bg-[#2A343B] text-[#92999E] px-2.5 py-1 rounded text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-[#ECE8DE]">{c.class_name}</p>
                            <p className="text-xs text-[#6B7378]">
                              Section {c.section} · <span className="text-[#8AAEDB]">{shiftInfo(c.shift).label}</span>
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={() => {
                                setEditingClassId(c.id);
                                setEditClass({ class_name: c.class_name, section: c.section, customSection: '', shift: c.shift || 'Morning' });
                              }}
                              className="text-[#C9A24B] text-xs"
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDeleteClass(c.id)} className="text-[#C97B5F] text-xs">Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* TIME SLOTS FORM */}
              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5 space-y-4">
                <h3 className="font-display text-lg font-semibold">Periods</h3>
                <form onSubmit={handleAddSlot} className="space-y-3">
                  <select
                    value={newSlot.shift}
                    onChange={(e) => setNewSlot({ ...newSlot, shift: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    {SHIFTS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label} ({s.hours})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Period number, e.g. 1"
                    value={newSlot.period_number}
                    onChange={(e) => setNewSlot({ ...newSlot, period_number: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Start (09:00)"
                      value={newSlot.start_time}
                      onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                      className="w-1/2 bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                    />
                    <input
                      type="text"
                      placeholder="End (09:45)"
                      value={newSlot.end_time}
                      onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                      className="w-1/2 bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B]"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[#92999E]">
                    <input
                      type="checkbox"
                      checked={newSlot.applies_on_friday}
                      onChange={(e) => setNewSlot({ ...newSlot, applies_on_friday: e.target.checked })}
                      className="w-4 h-4 accent-[#C9A24B] rounded"
                    />
                    <span>Also runs on Friday (uncheck for late periods — Friday ends earlier for Jummah)</span>
                  </label>
                  <button type="submit" className="w-full bg-[#C9A24B] hover:bg-[#E4C77A] text-[#12181C] font-semibold py-2.5 rounded-md text-sm transition-colors">
                    Add period
                  </button>
                </form>
                <button
                  type="button"
                  onClick={handleSetupShifts}
                  className="w-full border border-[#C9A24B] text-[#C9A24B] hover:bg-[#C9A24B] hover:text-[#12181C] font-medium py-2 rounded-md text-xs transition-colors"
                >
                  Load default shift timings
                </button>
                <div className="text-xs text-[#6B7378] -mt-1 space-y-0.5">
                  <p>Morning: 9:00 AM–1:30 PM (six 45-min periods), then a 30-min break.</p>
                  <p>2nd shift: 2:00 PM–6:00 PM · 3rd shift: 5:00 PM–9:00 PM (six 40-min periods each).</p>
                  <p>Type times in 24-hour form (e.g. 14:00). Only shifts with no periods yet are filled in.</p>
                </div>

                <div className="space-y-2 pt-2 max-h-64 overflow-y-auto scroll-stable">
                  <p className="text-xs text-[#6B7378]">Existing periods ({timeSlots.length})</p>
                  {sortedSlots.map((s) => (
                    <div key={s.id} className="bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm space-y-2">
                      {editingSlotId === s.id ? (
                        <div className="space-y-1.5">
                          <select
                            value={editSlot.shift}
                            onChange={(e) => setEditSlot({ ...editSlot, shift: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs text-[#ECE8DE]"
                          >
                            {SHIFTS.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            value={editSlot.period_number}
                            onChange={(e) => setEditSlot({ ...editSlot, period_number: e.target.value })}
                            className="w-full bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                          />
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={editSlot.start_time}
                              onChange={(e) => setEditSlot({ ...editSlot, start_time: e.target.value })}
                              className="w-1/2 bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                            />
                            <input
                              type="text"
                              value={editSlot.end_time}
                              onChange={(e) => setEditSlot({ ...editSlot, end_time: e.target.value })}
                              className="w-1/2 bg-[#181F24] border border-[#2A343B] p-1.5 rounded text-xs"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-xs text-[#92999E]">
                            <input
                              type="checkbox"
                              checked={editSlot.applies_on_friday}
                              onChange={(e) => setEditSlot({ ...editSlot, applies_on_friday: e.target.checked })}
                            />
                            <span>Also runs on Friday</span>
                          </label>
                          <div className="flex gap-2">
                            <button onClick={() => handleUpdateSlot(s.id)} className="bg-[#6E9583] text-[#12181C] font-medium px-2.5 py-1 rounded text-xs">Save</button>
                            <button onClick={() => setEditingSlotId(null)} className="bg-[#2A343B] text-[#92999E] px-2.5 py-1 rounded text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-[#ECE8DE]">
                              <span className="text-[#8AAEDB]">{shiftInfo(s.shift).short}</span> · Period {s.period_number}
                            </p>
                            <p className="text-xs text-[#6B7378]">
                              {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                              {s.applies_on_friday === false && <span className="text-[#C9A24B]"> · Mon–Thu only</span>}
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={() => {
                                setEditingSlotId(s.id);
                                setEditSlot({
                                  period_number: s.period_number,
                                  start_time: s.start_time,
                                  end_time: s.end_time,
                                  applies_on_friday: s.applies_on_friday !== false,
                                  shift: s.shift || 'Morning',
                                });
                              }}
                              className="text-[#C9A24B] text-xs"
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDeleteSlot(s.id)} className="text-[#C97B5F] text-xs">Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* COURSE ASSIGNMENTS — the step that replaces manual scheduling */}
            <div className="bg-[#181F24] border border-[#2A343B] border-l-2 border-l-[#C9A24B] rounded-lg p-5 space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Course assignments</h3>
                <p className="text-[#92999E] text-sm mt-1">
                  Link a teacher's course to the class it's taught to, and how many times a week it meets.
                  This is the only setup "Auto-distribute" needs — it fills in Monday through Friday itself.
                </p>
              </div>

              <form onSubmit={handleAddAssignment} className="grid grid-cols-1 md:grid-cols-[1.4fr_1.4fr_0.8fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Teacher &amp; course</label>
                  <select
                    value={newAssignment.teacher_id}
                    onChange={(e) => setNewAssignment({ ...newAssignment, teacher_id: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select a teacher</option>
                    {assignmentTeacherOptions.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} — {t.subject} · {shiftInfo(t.shift).short}</option>
                    ))}
                  </select>
                  {newAssignment.class_id && assignmentTeacherOptions.length === 0 && (
                    <p className="text-[11px] text-[#C97B5F] mt-1">No teachers in this class's shift yet.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Class</label>
                  <select
                    value={newAssignment.class_id}
                    onChange={(e) => setNewAssignment({ ...newAssignment, class_id: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select a class</option>
                    {assignmentClassOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.class_name} — {c.section} · {shiftInfo(c.shift).short}</option>
                    ))}
                  </select>
                  {newAssignment.teacher_id && assignmentClassOptions.length === 0 && (
                    <p className="text-[11px] text-[#C97B5F] mt-1">No classes in this teacher's shift yet.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Sessions / week</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={newAssignment.sessions_per_week}
                    onChange={(e) => setNewAssignment({ ...newAssignment, sessions_per_week: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!newAssignment.teacher_id || !newAssignment.class_id}
                  className="bg-[#C9A24B] hover:bg-[#E4C77A] disabled:opacity-40 text-[#12181C] font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
                >
                  Add
                </button>
              </form>

              <div className="pt-2">
                <p className="text-xs text-[#6B7378] mb-2">Existing assignments ({assignments.length})</p>
                {assignments.length === 0 ? (
                  <p className="text-xs text-[#4A5157]">No assignments yet.</p>
                ) : (
                  <div className="divide-y divide-[#2A343B] border border-[#2A343B] rounded-md overflow-hidden">
                    {assignments.map((a) => (
                      <div key={a.id} className="flex justify-between items-center bg-[#12181C] px-3 py-2.5 text-sm">
                        <div>
                          <span className="font-medium text-[#ECE8DE]">{a.teachers?.name}</span>
                          <span className="text-[#6B7378]"> · {a.teachers?.subject}</span>
                          <span className="text-[#92999E]"> → {a.classes?.class_name}-{a.classes?.section}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-[#6E9583]">
                            {a.sessions_per_week}× / week{a.teachers?.is_double_period ? ' · double' : ''}
                          </span>
                          <button onClick={() => handleDeleteAssignment(a.id)} className="text-[#C97B5F] text-xs">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'absence' && (
          <div className="space-y-5">
            <div className="bg-[#181F24] border border-[#2A343B] border-l-2 border-l-[#C9A24B] rounded-lg p-5 space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Teacher absence</h3>
                <p className="text-[#92999E] text-sm mt-1">
                  Mark a teacher absent for a day. Each of their periods on that day is handed to a teacher who is
                  free at that time — same technology first, and whoever has covered the fewest periods. The original
                  timetable is not changed: remove the absence and everything goes back.
                </p>
              </div>

              <form onSubmit={handleMarkAbsent} className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Absent teacher</label>
                  <select
                    value={absentForm.teacher_id}
                    onChange={(e) => setAbsentForm({ ...absentForm, teacher_id: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    <option value="">Select a teacher</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} — {t.subject}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#92999E] mb-1.5">Day</label>
                  <select
                    value={absentForm.day}
                    onChange={(e) => setAbsentForm({ ...absentForm, day: e.target.value })}
                    className="w-full bg-[#12181C] border border-[#2A343B] p-2.5 rounded-md text-sm outline-none focus:border-[#C9A24B] text-[#ECE8DE]"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                    <option value="Whole week">Whole week</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={!absentForm.teacher_id}
                  className="bg-[#C9A24B] hover:bg-[#E4C77A] disabled:opacity-40 text-[#12181C] font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
                >
                  Mark absent &amp; auto-assign
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">Current absences ({sortedAbsences.length})</h3>
                {sortedAbsences.length === 0 ? (
                  <p className="text-xs text-[#4A5157]">No teacher is marked absent.</p>
                ) : (
                  <div className="divide-y divide-[#2A343B] border border-[#2A343B] rounded-md overflow-hidden">
                    {sortedAbsences.map((a) => (
                      <div key={a.id} className="flex justify-between items-center bg-[#12181C] px-3 py-2.5 text-sm">
                        <div>
                          <span className="font-medium text-[#ECE8DE]">
                            {teachers.find((t) => t.id === a.teacher_id)?.name || `Teacher #${a.teacher_id}`}
                          </span>
                          <span className="text-[#92999E]"> · {a.day}</span>
                        </div>
                        <button onClick={() => handleRemoveAbsence(a.id)} className="text-[#C97B5F] text-xs">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5 space-y-3">
                <h3 className="font-display text-lg font-semibold">Substitutes assigned ({substitutionRows.length})</h3>
                {substitutionRows.length === 0 ? (
                  <p className="text-xs text-[#4A5157]">No substitutions right now.</p>
                ) : (
                  <div className="divide-y divide-[#2A343B] border border-[#2A343B] rounded-md overflow-hidden max-h-96 overflow-y-auto scroll-stable">
                    {substitutionRows.map((r) => (
                      <div key={r.id} className="bg-[#12181C] px-3 py-2.5 text-sm space-y-0.5">
                        <p className="text-[#ECE8DE]">
                          <span className="line-through text-[#6B7378]">{r.teachers?.name}</span>
                          <span className="text-[#C9A24B]"> → {r.substitute?.name}</span>
                        </p>
                        <p className="text-xs text-[#6B7378]">
                          {r.day} · {shiftInfo(r.time_slots?.shift).short} P{r.time_slots?.period_number} ·{' '}
                          {fmtTime(r.time_slots?.start_time)}–{fmtTime(r.time_slots?.end_time)} ·{' '}
                          {r.classes?.class_name}-{r.classes?.section} · {r.teachers?.subject}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-5">

            <div className="bg-[#181F24] border border-[#2A343B] border-l-2 border-l-[#C9A24B] rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Downloadable report</h3>
                <p className="text-[#92999E] text-sm mt-1">
                  A PDF with the summary, both charts below, and the full weekly timetable laid out day by day.
                </p>
              </div>
              <a
                href="/api/export-report-pdf"
                className="shrink-0 inline-flex items-center justify-center bg-[#C9A24B] hover:bg-[#E4C77A] text-[#12181C] font-semibold px-5 py-2.5 rounded-md text-sm transition-colors"
              >
                Download PDF report
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Teachers', value: teachers.length },
                { label: 'Classes', value: classes.length },
                { label: 'Courses in catalog', value: courses.length },
                { label: 'Periods scheduled / week', value: timetable.length },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#181F24] border border-[#2A343B] rounded-lg p-4">
                  <p className="font-display text-2xl font-semibold text-[#ECE8DE]">{stat.value}</p>
                  <p className="text-xs text-[#92999E] mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5">
                <h3 className="font-display text-lg font-semibold mb-1">Teacher workload</h3>
                <p className="text-[#92999E] text-xs mb-4">Periods scheduled per week, per teacher.</p>
                <BarChart data={teacherWorkloadData} />
              </div>

              <div className="bg-[#181F24] border border-[#2A343B] rounded-lg p-5">
                <h3 className="font-display text-lg font-semibold mb-1">Course catalog by type</h3>
                <p className="text-[#92999E] text-xs mb-4">Theory vs Lab vs Theory + Lab, across all years.</p>
                <PieChart data={courseTypeData} />
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}