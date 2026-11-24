'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  parent_phone?: string | null;
  role: 'student' | 'teacher';
  max_capacity: number;
  is_registered: boolean;
};

type Subject = { id: string; name: string };
type TeacherSubject = { teacher_id: string; subject_id: string };
type AvailabilitySlot = {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

type PricingItem = {
  id: string;
  kind: 'hourly' | 'combo';
  name: string;
  hours_included: number;
  price: number;
};

type StudentCombo = {
  id: string;
  student_id: string;
  total_hours: number;
  remaining_hours: number;
  pricing_catalog?: { name: string } | null;
};

type Booking = {
  id: string;
  receipt_code: string;
  student_id: string;
  teacher_id: string;
  subject_id: string;
  booking_date: string;
  start_time: string;
  end_time?: string | null;
  duration_hours: number;
  modality: 'hourly' | 'combo';
  student_combo_id?: string | null;
  status?: 'confirmed' | 'cancelled' | null;
  is_override: boolean;
  is_urgent_walkin: boolean;
  attended: boolean | null;
  profiles?: { full_name: string; phone?: string | null; parent_phone?: string | null } | null;
  teacher?: { full_name: string } | null;
  subjects?: { name: string } | null;
};

const TEACHER_MAX_CAPACITY = 4;
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function minutesToHHMM(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getHalfHourSlots(startHHMM: string, endHHMM: string): string[] {
  const startMin = Math.round(parseTimeToHours(startHHMM) * 60);
  const endMin = Math.round(parseTimeToHours(endHHMM) * 60);
  const slotsList: string[] = [];
  for (let cur = startMin; cur < endMin; cur += 30) {
    slotsList.push(minutesToHHMM(cur));
  }
  return slotsList;
}

const GANTT_HALF_HOURS = getHalfHourSlots('14:00', '21:00');

function parseTimeToHours(hhmm: string): number {
  const [hStr, mStr] = hhmm.slice(0, 5).split(':');
  const h = Number(hStr);
  const m = Number(mStr || 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h + m / 60;
}

function formatHoursDecimal(hoursVal: number): string {
  const totalMinutes = Math.round(Number(hoursVal || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} hs`;
}

function getHourlyBlocks(startHHMM: string, endHHMM: string): string[] {
  const startMin = Math.round(parseTimeToHours(startHHMM) * 60);
  const endMin = Math.round(parseTimeToHours(endHHMM) * 60);
  const blocks: string[] = [];
  for (let cur = startMin; cur < endMin; cur += 60) {
    blocks.push(minutesToHHMM(cur));
  }
  return blocks;
}

function computeEndTimeFromStartAndDuration(startHHMM: string, durationHours: number): string {
  const startMin = Math.round(parseTimeToHours(startHHMM) * 60);
  const endMin = startMin + Math.round(Number(durationHours || 1) * 60);
  return minutesToHHMM(endMin);
}

function getBookingStartDate(bookingDate: string, startTime: string): Date {
  const cleanTime = startTime.slice(0, 5);
  const [hh, mm] = cleanTime.split(':').map(Number);
  const [yy, mo, dd] = bookingDate.split('-').map(Number);
  return new Date(yy, (mo || 1) - 1, dd || 1, hh || 0, mm || 0, 0, 0);
}

function addThirtyMinutes(hhmm: string): string {
  const startMin = Math.round(parseTimeToHours(hhmm) * 60);
  return minutesToHHMM(startMin + 30);
}

function isBookingCoveringHalfHour(
  bStartHHMM: string,
  bEndHHMM: string,
  slotStartHHMM: string
): boolean {
  const bStart = Math.round(parseTimeToHours(bStartHHMM) * 60);
  const bEnd = Math.round(parseTimeToHours(bEndHHMM) * 60);
  const sStart = Math.round(parseTimeToHours(slotStartHHMM) * 60);
  const sEnd = sStart + 30;
  return bStart < sEnd && bEnd > sStart;
}

function formatPricingDisplayName(item: PricingItem): string {
  if (item.kind === 'hourly' && item.name.trim().toLowerCase() === 'hora suelta') {
    return 'Hora individual';
  }
  return item.name;
}

export default function HomePage() {
  // Estado de autenticación y perfil actual
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authParentPhone, setAuthParentPhone] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Datos de la app
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<TeacherSubject[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [combos, setCombos] = useState<StudentCombo[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [nowTick, setNowTick] = useState<number>(0);

  // Reserva turno alumno (hora entrada y hora salida)
  const [bookSubjectId, setBookSubjectId] = useState('');
  const [bookTeacherId, setBookTeacherId] = useState('');
  const [manualTeacherOverride, setManualTeacherOverride] = useState(false);
  const [bookDate, setBookDate] = useState('');
  const [bookStartTime, setBookStartTime] = useState('15:00');
  const [bookEndTime, setBookEndTime] = useState('19:00');
  const [lastReceipt, setLastReceipt] = useState<Booking | null>(null);

  // Mensaje WhatsApp
  const [msgTeacherId, setMsgTeacherId] = useState('');
  const [msgText, setMsgText] = useState('');

  // Profesora: urgencia & excepción
  const [urgentName, setUrgentName] = useState('');
  const [urgentPhone, setUrgentPhone] = useState('');
  const [urgentParentPhone, setUrgentParentPhone] = useState('');
  const [urgentSubjectId, setUrgentSubjectId] = useState('');
  const [urgentTeacherId, setUrgentTeacherId] = useState('');
  const [urgentDate, setUrgentDate] = useState('');
  const [urgentTime, setUrgentTime] = useState('15:00');
  const [forceOverride, setForceOverride] = useState(false);

  // Profesora: cargar / modificar horas de un alumno (tras pago o inconveniente)
  const [adjustStudentId, setAdjustStudentId] = useState('');
  const [adjustHoursDelta, setAdjustHoursDelta] = useState<number>(4);
  const [adjustReason, setAdjustReason] = useState('');

  // Profesora: nueva franja horaria y edición de franja propia
  const [slotDay, setSlotDay] = useState(1);
  const [slotStart, setSlotStart] = useState('15:00');
  const [slotEnd, setSlotEnd] = useState('19:00');
  const [addingSlot, setAddingSlot] = useState(false);

  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editSlotDay, setEditSlotDay] = useState(1);
  const [editSlotStart, setEditSlotStart] = useState('15:00');
  const [editSlotEnd, setEditSlotEnd] = useState('19:00');
  const [savingSlotEdit, setSavingSlotEdit] = useState(false);

  // Profesora: fecha de Gantt y rango de análisis de turnos
  const [ganttDate, setGanttDate] = useState('');
  const [statsFrom, setStatsFrom] = useState('');
  const [statsTo, setStatsTo] = useState('');
  const [todayStr, setTodayStr] = useState('');

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const past30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setTodayStr(today);
    setBookDate(today);
    setUrgentDate(today);
    setGanttDate(today);
    setStatsFrom(past30);
    setStatsTo(today);
  }, []);

  useEffect(() => {
    setNowTick(Date.now());
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchCurrentProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (data) {
      setCurrentUserProfile(data as Profile);
    } else {
      setCurrentUserProfile(null);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await fetchCurrentProfile(session.user.id);
      }
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await fetchCurrentProfile(session.user.id);
      } else {
        setCurrentUserProfile(null);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadAll() {
    const [
      { data: profs },
      { data: subjs },
      { data: tSubjs },
      { data: avSlots },
      { data: prices },
      { data: stCombos },
      { data: bks },
    ] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('subjects').select('*').order('name'),
      supabase.from('teacher_subjects').select('*'),
      supabase.from('availability_slots').select('*').order('day_of_week').order('start_time'),
      supabase.from('pricing_catalog').select('*').eq('is_active', true).order('hours_included'),
      supabase
        .from('student_combos')
        .select('*, pricing_catalog(name)')
        .order('created_at', { ascending: false }),
      supabase
        .from('bookings')
        .select(
          '*, profiles:student_id(full_name, phone, parent_phone), teacher:teacher_id(full_name), subjects(name)'
        )
        .order('booking_date', { ascending: false })
        .order('start_time', { ascending: true }),
    ]);

    const allProfiles = (profs || []) as Profile[];
    const tList = allProfiles.filter((p) => p.role === 'teacher');
    const sList = allProfiles.filter((p) => p.role === 'student');

    setTeachers(tList);
    setStudents(sList);
    if (!adjustStudentId && sList.length > 0) setAdjustStudentId(sList[0].id);
    if (!msgTeacherId && tList.length > 0) setMsgTeacherId(tList[0].id);
    if (!urgentTeacherId && tList.length > 0) setUrgentTeacherId(tList[0].id);

    if (subjs) {
      setSubjects(subjs as Subject[]);
      if (!bookSubjectId && subjs.length > 0) setBookSubjectId(subjs[0].id);
      if (!urgentSubjectId && subjs.length > 0) setUrgentSubjectId(subjs[0].id);
    }
    if (tSubjs) setTeacherSubjects(tSubjs as TeacherSubject[]);
    if (avSlots) setSlots(avSlots as AvailabilitySlot[]);
    if (prices) setPricing(prices as PricingItem[]);
    if (stCombos) setCombos(stCombos as unknown as StudentCombo[]);
    if (bks) setBookings(bks as unknown as Booking[]);
  }

  useEffect(() => {
    if (currentUserProfile) {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserProfile]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setAuthSubmitting(true);

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) {
        setBanner({ type: 'err', text: 'Email o contraseña incorrectos: ' + error.message });
      }
    } else {
      if (!authFullName.trim()) {
        setBanner({ type: 'err', text: 'Ingresá tu nombre y apellido.' });
        setAuthSubmitting(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: {
          data: {
            full_name: authFullName.trim(),
            phone: authPhone.trim() || null,
            parent_phone: authParentPhone.trim() || null,
            role: 'student',
          },
        },
      });
      if (error) {
        setBanner({ type: 'err', text: error.message });
      } else if (data.user) {
        if (authParentPhone.trim()) {
          await supabase
            .from('profiles')
            .update({ parent_phone: authParentPhone.trim() })
            .eq('auth_user_id', data.user.id);
        }
        await fetchCurrentProfile(data.user.id);
        setBanner({ type: 'ok', text: '¡Cuenta creada! Bienvenido/a.' });
      }
    }
    setAuthSubmitting(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setCurrentUserProfile(null);
    setEditingSlotId(null);
    setBanner(null);
    setLastReceipt(null);
  }

  // Duración calculada entre hora de entrada y hora de salida
  const requestedDurationHours = useMemo(() => {
    const startH = parseTimeToHours(bookStartTime);
    const endH = parseTimeToHours(bookEndTime);
    if (Number.isNaN(startH) || Number.isNaN(endH)) return 0;
    return Math.round((endH - startH) * 100) / 100;
  }, [bookStartTime, bookEndTime]);

  const requestedBlocks = useMemo(() => {
    if (requestedDurationHours <= 0) return [];
    return getHourlyBlocks(bookStartTime, bookEndTime);
  }, [bookStartTime, bookEndTime, requestedDurationHours]);

  // Turnos activos (no cancelados)
  const activeBookings = useMemo(() => {
    return bookings.filter((b) => b.status !== 'cancelled');
  }, [bookings]);

  // Profesoras habilitadas para la materia seleccionada + carga en el rango de horas elegido
  const eligibleTeachersWithLoad = useMemo(() => {
    const allowedIds = teacherSubjects
      .filter((ts) => ts.subject_id === bookSubjectId)
      .map((ts) => ts.teacher_id);

    const blocksToCheck = requestedBlocks.length > 0 ? requestedBlocks : [bookStartTime.slice(0, 5)];

    return teachers
      .filter((t) => allowedIds.includes(t.id))
      .map((t) => {
        const count = activeBookings.filter((b) => {
          if (b.teacher_id !== t.id || b.booking_date !== bookDate) return false;
          const bStart = b.start_time.slice(0, 5);
          const bEnd = b.end_time
            ? b.end_time.slice(0, 5)
            : computeEndTimeFromStartAndDuration(bStart, Number(b.duration_hours || 1));
          const bBlocks = getHourlyBlocks(bStart, bEnd);
          return blocksToCheck.some((blk) => bBlocks.includes(blk));
        }).length;
        return { ...t, loadCount: count };
      })
      .sort((a, b) => a.loadCount - b.loadCount);
  }, [teacherSubjects, bookSubjectId, teachers, activeBookings, bookDate, bookStartTime, requestedBlocks]);

  // Balanceo automático: selecciona la profesora con menor carga si el alumno no forzó manual
  useEffect(() => {
    if (eligibleTeachersWithLoad.length === 0) {
      setBookTeacherId('');
      return;
    }
    if (!manualTeacherOverride) {
      setBookTeacherId(eligibleTeachersWithLoad[0].id);
    } else if (!eligibleTeachersWithLoad.some((t) => t.id === bookTeacherId)) {
      setBookTeacherId(eligibleTeachersWithLoad[0].id);
      setManualTeacherOverride(false);
    }
  }, [eligibleTeachersWithLoad, manualTeacherOverride, bookTeacherId]);

  const myCombos = useMemo(() => {
    if (!currentUserProfile) return [];
    return combos.filter((c) => c.student_id === currentUserProfile.id && c.remaining_hours > 0);
  }, [combos, currentUserProfile]);

  const totalComboHours = useMemo(
    () => myCombos.reduce((acc, c) => acc + Number(c.remaining_hours), 0),
    [myCombos]
  );

  const myBookings = useMemo(() => {
    if (!currentUserProfile) return [];
    return bookings.filter((b) => b.student_id === currentUserProfile.id);
  }, [bookings, currentUserProfile]);

  const maxCap = TEACHER_MAX_CAPACITY;

  const maxOccupancyInRange = useMemo(() => {
    if (!bookTeacherId || !bookDate) return 0;
    const blocksToCheck = requestedBlocks.length > 0 ? requestedBlocks : [bookStartTime.slice(0, 5)];
    let peak = 0;
    for (const blk of blocksToCheck) {
      const occ = activeBookings.filter((b) => {
        if (b.teacher_id !== bookTeacherId || b.booking_date !== bookDate) return false;
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time
          ? b.end_time.slice(0, 5)
          : computeEndTimeFromStartAndDuration(bStart, Number(b.duration_hours || 1));
        return getHourlyBlocks(bStart, bEnd).includes(blk);
      }).length;
      if (occ > peak) peak = occ;
    }
    return peak;
  }, [activeBookings, bookTeacherId, bookDate, bookStartTime, requestedBlocks]);

  // Gráfico de carga horaria de media hora (14:00 a 21:00) por profesora y fecha
  const ganttRows = useMemo(() => {
    const targetDayOfWeek = ganttDate ? new Date(ganttDate + 'T12:00:00').getDay() : -1;
    const dayBookings = activeBookings.filter((b) => b.booking_date === ganttDate);

    return teachers.map((t) => {
      const teacherDaySlots = slots.filter(
        (sl) => sl.teacher_id === t.id && sl.day_of_week === targetDayOfWeek && sl.is_active
      );
      const cap = TEACHER_MAX_CAPACITY;

      const cells = GANTT_HALF_HOURS.map((slotStart) => {
        const slotEnd = addThirtyMinutes(slotStart);
        const sStartMin = Math.round(parseTimeToHours(slotStart) * 60);
        const sEndMin = sStartMin + 30;

        const isEnabled = teacherDaySlots.some((sl) => {
          const slStartMin = Math.round(parseTimeToHours(sl.start_time) * 60);
          const slEndMin = Math.round(parseTimeToHours(sl.end_time) * 60);
          return sStartMin >= slStartMin && sEndMin <= slEndMin;
        });

        const matchingBookings = dayBookings.filter((b) => {
          if (b.teacher_id !== t.id) return false;
          const bStart = b.start_time.slice(0, 5);
          const bEnd = b.end_time
            ? b.end_time.slice(0, 5)
            : computeEndTimeFromStartAndDuration(bStart, Number(b.duration_hours || 1));
          return isBookingCoveringHalfHour(bStart, bEnd, slotStart);
        });

        const studentNames = matchingBookings.map((b) => b.profiles?.full_name || 'Alumno');
        const hasOverride = matchingBookings.some((b) => b.is_override);

        return {
          slotStart,
          slotEnd,
          isEnabled,
          count: matchingBookings.length,
          cap,
          studentNames,
          hasOverride,
        };
      });

      const activeHalfHours = cells.filter((c) => c.count > 0).length;
      const totalBookedHalfHourSlots = cells.reduce((acc, c) => acc + c.count, 0);

      return {
        teacher: t,
        cap,
        activeHalfHours,
        totalBookedHalfHourSlots,
        cells,
      };
    });
  }, [teachers, slots, activeBookings, ganttDate]);

  // Resumen en HORAS (cada alumno que reserva suma la duración en horas de su turno)
  const filteredStats = useMemo(() => {
    const bookingsInRange = activeBookings.filter((b) => {
      const afterFrom = !statsFrom || b.booking_date >= statsFrom;
      const beforeTo = !statsTo || b.booking_date <= statsTo;
      return afterFrom && beforeTo;
    });

    const totalHoursBooked = bookingsInRange.reduce(
      (sum, b) => sum + Number(b.duration_hours || 1),
      0
    );

    const bySubject = subjects
      .map((s) => ({
        id: s.id,
        name: s.name,
        hours: bookingsInRange
          .filter((b) => b.subject_id === s.id)
          .reduce((sum, b) => sum + Number(b.duration_hours || 1), 0),
      }))
      .sort((a, b) => b.hours - a.hours);

    const byTeacher = teachers.map((t) => ({
      id: t.id,
      name: t.full_name,
      hours: bookingsInRange
        .filter((b) => b.teacher_id === t.id)
        .reduce((sum, b) => sum + Number(b.duration_hours || 1), 0),
    }));

    return {
      totalHoursBooked,
      bySubject,
      byTeacher,
    };
  }, [activeBookings, subjects, teachers, statsFrom, statsTo]);

  function handleNotifyParents(booking: Booking) {
    const studentObj = students.find((s) => s.id === booking.student_id);
    const parentPhoneRaw =
      booking.profiles?.parent_phone ||
      studentObj?.parent_phone ||
      booking.profiles?.phone ||
      studentObj?.phone ||
      '';
    const cleanPhone = parentPhoneRaw.replace(/\D/g, '');

    const studentName = booking.profiles?.full_name || studentObj?.full_name || 'el alumno';
    const subjectName = booking.subjects?.name || 'la clase';
    const attendanceText =
      booking.attended === true
        ? 'asistió a la clase'
        : booking.attended === false
        ? 'no asistió a la clase'
        : 'tuvo clase registrada';

    const defaultMsg = `Hola, les escribo de parte de ${
      currentUserProfile?.full_name || 'la profesora'
    } para contarles cómo fue la jornada de ${studentName} en ${subjectName} el ${
      booking.booking_date
    } (${booking.start_time.slice(0, 5)} hs): ${attendanceText}.`;

    const customMsg = window.prompt(
      `Mensaje para los padres de ${studentName}${
        cleanPhone ? ` (WA: ${cleanPhone})` : ' (sin número cargado, se abrirá WhatsApp para elegir contacto)'
      }:`,
      defaultMsg
    );

    if (customMsg === null) return;
    const encoded = encodeURIComponent(customMsg.trim() || defaultMsg);
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
  }

  async function handleAdjustStudentHours(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustStudentId || adjustHoursDelta === 0 || !adjustReason.trim()) {
      setBanner({
        type: 'err',
        text: 'Seleccioná un alumno, indicá horas distintas de 0 y escribí el motivo (ej: pago en efectivo/transferencia).',
      });
      return;
    }

    const studentCombos = combos
      .filter((c) => c.student_id === adjustStudentId)
      .sort((a, b) => Number(b.remaining_hours) - Number(a.remaining_hours));

    if (studentCombos.length > 0) {
      const targetCombo = studentCombos[0];
      const nextRemaining = Math.max(0, Number(targetCombo.remaining_hours) + Number(adjustHoursDelta));
      await supabase
        .from('student_combos')
        .update({ remaining_hours: nextRemaining })
        .eq('id', targetCombo.id);
    } else if (adjustHoursDelta > 0) {
      await supabase.from('student_combos').insert({
        student_id: adjustStudentId,
        total_hours: Number(adjustHoursDelta),
        remaining_hours: Number(adjustHoursDelta),
      });
    } else {
      setBanner({
        type: 'err',
        text: 'El alumno no tiene saldo de horas cargado para descontar.',
      });
      return;
    }

    await supabase.from('hour_adjustments').insert({
      student_id: adjustStudentId,
      teacher_id: currentUserProfile?.id || null,
      hours_delta: Number(adjustHoursDelta),
      reason: adjustReason.trim(),
    });

    const studentName = students.find((s) => s.id === adjustStudentId)?.full_name || 'Alumno';
    setAdjustReason('');
    setBanner({
      type: 'ok',
      text: `Se actualizaron ${adjustHoursDelta > 0 ? '+' : ''}${adjustHoursDelta}h al perfil de ${studentName}.`,
    });
    loadAll();
  }

  async function handleUpdatePrice(id: string, newPrice: number) {
    const { error } = await supabase
      .from('pricing_catalog')
      .update({ price: newPrice, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setBanner({ type: 'ok', text: 'Precio actualizado.' });
      loadAll();
    }
  }

  async function handleBookTurn(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserProfile || !bookTeacherId || !bookSubjectId || !bookDate) {
      setBanner({ type: 'err', text: 'Completá materia, profesora y fecha.' });
      return;
    }

    if (requestedDurationHours <= 0) {
      setBanner({
        type: 'err',
        text: 'La hora de salida debe ser posterior a la hora de entrada.',
      });
      return;
    }

    if (totalComboHours < requestedDurationHours) {
      setBanner({
        type: 'err',
        text: `Necesitás ${formatHoursDecimal(requestedDurationHours)} disponibles y tenés ${totalComboHours}h. Avisale a tu profesora cuando abones para que cargue tus horas.`,
      });
      return;
    }

    const dayOfWeek = new Date(bookDate + 'T12:00:00').getDay();
    const matchingSlot = slots.find(
      (s) =>
        s.teacher_id === bookTeacherId &&
        s.day_of_week === dayOfWeek &&
        s.is_active &&
        bookStartTime >= s.start_time.slice(0, 5) &&
        bookEndTime <= s.end_time.slice(0, 5)
    );

    if (!matchingSlot) {
      setBanner({
        type: 'err',
        text: `El rango ${bookStartTime} a ${bookEndTime} del día ${DAYS[dayOfWeek]} no está habilitado por la profesora.`,
      });
      return;
    }

    for (const blk of requestedBlocks) {
      const currentBlockCount = activeBookings.filter((b) => {
        if (b.teacher_id !== bookTeacherId || b.booking_date !== bookDate) return false;
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time
          ? b.end_time.slice(0, 5)
          : computeEndTimeFromStartAndDuration(bStart, Number(b.duration_hours || 1));
        return getHourlyBlocks(bStart, bEnd).includes(blk);
      }).length;

      if (currentBlockCount >= maxCap) {
        setBanner({
          type: 'err',
          text: `Cupo lleno (${maxCap}/${maxCap}) en el bloque ${blk}. Solo una profesora puede habilitar una excepción.`,
        });
        return;
      }
    }

    let usedComboId: string | null = null;
    let remainingToDeduct = requestedDurationHours;
    const orderedCombos = [...myCombos].sort(
      (a, b) => Number(b.remaining_hours) - Number(a.remaining_hours)
    );

    for (const c of orderedCombos) {
      if (remainingToDeduct <= 0) break;
      const currentRem = Number(c.remaining_hours);
      const deductHere = Math.min(currentRem, remainingToDeduct);
      if (!usedComboId) usedComboId = c.id;
      await supabase
        .from('student_combos')
        .update({ remaining_hours: Math.max(0, currentRem - deductHere) })
        .eq('id', c.id);
      remainingToDeduct = Math.round((remainingToDeduct - deductHere) * 100) / 100;
    }

    const receiptCode = 'CMP-' + Math.floor(100000 + Math.random() * 900000);

    const { data: inserted, error } = await supabase
      .from('bookings')
      .insert({
        receipt_code: receiptCode,
        student_id: currentUserProfile.id,
        teacher_id: bookTeacherId,
        subject_id: bookSubjectId,
        booking_date: bookDate,
        start_time: bookStartTime + ':00',
        end_time: bookEndTime + ':00',
        duration_hours: requestedDurationHours,
        modality: 'combo',
        student_combo_id: usedComboId,
        status: 'confirmed',
        is_override: false,
        is_urgent_walkin: false,
      })
      .select(
        '*, profiles:student_id(full_name, phone, parent_phone), teacher:teacher_id(full_name), subjects(name)'
      )
      .single();

    if (error) {
      setBanner({ type: 'err', text: error.message });
    } else {
      setLastReceipt(inserted as unknown as Booking);
      setManualTeacherOverride(false);
      setBanner({
        type: 'ok',
        text: `Turno reservado (${bookStartTime} a ${bookEndTime}). Se descontaron ${formatHoursDecimal(requestedDurationHours)} de tu saldo. Comprobante: ${receiptCode}`,
      });
      loadAll();
    }
  }

  async function handleCancelBooking(booking: Booking) {
    if (!currentUserProfile || booking.status === 'cancelled') return;

    const startDate = getBookingStartDate(booking.booking_date, booking.start_time);
    const diffHours = (startDate.getTime() - Date.now()) / (1000 * 60 * 60);

    if (diffHours < 2) {
      setBanner({
        type: 'err',
        text: 'Ya faltan menos de 2 horas para el inicio del turno: no se puede cancelar. Debés asistir al turno o se perderán las horas.',
      });
      return;
    }

    const { error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', booking.id);

    if (error) {
      setBanner({ type: 'err', text: error.message });
      return;
    }

    const hoursToRefund = Number(booking.duration_hours || 1);

    if (hoursToRefund > 0) {
      const targetCombo =
        combos.find((c) => c.id === booking.student_combo_id) ||
        combos.find((c) => c.student_id === booking.student_id);

      if (targetCombo) {
        await supabase
          .from('student_combos')
          .update({
            remaining_hours: Number(targetCombo.remaining_hours) + hoursToRefund,
          })
          .eq('id', targetCombo.id);
      } else {
        await supabase.from('student_combos').insert({
          student_id: booking.student_id,
          total_hours: hoursToRefund,
          remaining_hours: hoursToRefund,
        });
      }
    }

    setBanner({
      type: 'ok',
      text: `Turno ${booking.receipt_code} cancelado a tiempo. Se devolvieron ${formatHoursDecimal(hoursToRefund)} a tu saldo.`,
    });
    loadAll();
  }

  async function handleUrgentBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!urgentName.trim() || !urgentTeacherId || !urgentSubjectId || !urgentDate) return;

    const currentOcc = activeBookings.filter((b) => {
      if (b.teacher_id !== urgentTeacherId || b.booking_date !== urgentDate) return false;
      const bStart = b.start_time.slice(0, 5);
      const bEnd = b.end_time
        ? b.end_time.slice(0, 5)
        : computeEndTimeFromStartAndDuration(bStart, Number(b.duration_hours || 1));
      return getHourlyBlocks(bStart, bEnd).includes(urgentTime.slice(0, 5));
    }).length;

    if (currentOcc >= TEACHER_MAX_CAPACITY && !forceOverride) {
      setBanner({
        type: 'err',
        text: `Cupo lleno (${TEACHER_MAX_CAPACITY}/${TEACHER_MAX_CAPACITY}) para ese horario. Tildá "Forzar excepción de cupo" para inscribir igual.`,
      });
      return;
    }

    const { data: tempStudent, error: stErr } = await supabase
      .from('profiles')
      .insert({
        full_name: urgentName.trim() + ' (Urgencia)',
        phone: urgentPhone.trim() || null,
        parent_phone: urgentParentPhone.trim() || null,
        role: 'student',
        is_registered: false,
      })
      .select()
      .single();

    if (stErr || !tempStudent) {
      setBanner({ type: 'err', text: stErr?.message || 'Error creando alumno rápido' });
      return;
    }

    const receiptCode = 'URG-' + Math.floor(100000 + Math.random() * 900000);
    const { error } = await supabase.from('bookings').insert({
      receipt_code: receiptCode,
      student_id: tempStudent.id,
      teacher_id: urgentTeacherId,
      subject_id: urgentSubjectId,
      booking_date: urgentDate,
      start_time: urgentTime + ':00',
      duration_hours: 1,
      modality: 'hourly',
      status: 'confirmed',
      is_override: forceOverride,
      is_urgent_walkin: true,
    });

    if (error) {
      setBanner({ type: 'err', text: error.message });
    } else {
      setUrgentName('');
      setUrgentPhone('');
      setUrgentParentPhone('');
      setForceOverride(false);
      setBanner({
        type: 'ok',
        text: `Alumno de urgencia agendado (${receiptCode})${forceOverride ? ' con EXCEPCIÓN de cupo' : ''}.`,
      });
      loadAll();
    }
  }

  async function handleSendWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    if (!msgText.trim() || !msgTeacherId || !currentUserProfile) return;
    const teacher = teachers.find((t) => t.id === msgTeacherId);

    await supabase.from('student_messages').insert({
      student_id: currentUserProfile.id,
      teacher_id: msgTeacherId,
      message: msgText.trim(),
      sent_via_whatsapp: true,
    });

    const cleanPhone = (teacher?.phone || '').replace(/\D/g, '');
    const fullText = encodeURIComponent(
      `Hola ${teacher?.full_name || 'Profe'}, soy ${currentUserProfile.full_name}: ${msgText.trim()}`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${fullText}`, '_blank');
    setMsgText('');
    setBanner({ type: 'ok', text: 'Mensaje guardado y abierto en WhatsApp.' });
  }

  async function handleToggleSlot(slot: AvailabilitySlot) {
    if (!currentUserProfile || slot.teacher_id !== currentUserProfile.id) {
      setBanner({ type: 'err', text: 'Solo podés modificar tus propios horarios.' });
      return;
    }
    const { error } = await supabase
      .from('availability_slots')
      .update({ is_active: !slot.is_active })
      .eq('id', slot.id)
      .eq('teacher_id', currentUserProfile.id);
    if (!error) {
      loadAll();
    }
  }

  function startEditingSlot(slot: AvailabilitySlot) {
    if (!currentUserProfile || slot.teacher_id !== currentUserProfile.id) {
      setBanner({ type: 'err', text: 'Solo podés editar tus propios horarios.' });
      return;
    }
    setEditingSlotId(slot.id);
    setEditSlotDay(slot.day_of_week);
    setEditSlotStart(slot.start_time.slice(0, 5));
    setEditSlotEnd(slot.end_time.slice(0, 5));
  }

  async function handleSaveEditedSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserProfile || !editingSlotId || savingSlotEdit) return;
    const targetSlot = slots.find((s) => s.id === editingSlotId);
    if (!targetSlot || targetSlot.teacher_id !== currentUserProfile.id) {
      setBanner({ type: 'err', text: 'No tenés permiso para modificar ese horario.' });
      return;
    }
    if (parseTimeToHours(editSlotEnd) <= parseTimeToHours(editSlotStart)) {
      setBanner({ type: 'err', text: 'La hora de fin debe ser posterior a la hora de inicio.' });
      return;
    }

    setSavingSlotEdit(true);
    const { error } = await supabase
      .from('availability_slots')
      .update({
        day_of_week: editSlotDay,
        start_time: editSlotStart + ':00',
        end_time: editSlotEnd + ':00',
      })
      .eq('id', editingSlotId)
      .eq('teacher_id', currentUserProfile.id);
    setSavingSlotEdit(false);

    if (error) {
      setBanner({ type: 'err', text: error.message });
    } else {
      setEditingSlotId(null);
      setBanner({ type: 'ok', text: 'Horario actualizado correctamente.' });
      loadAll();
    }
  }

  async function handleDeleteSlot(slot: AvailabilitySlot) {
    if (!currentUserProfile || slot.teacher_id !== currentUserProfile.id) {
      setBanner({ type: 'err', text: 'Solo podés eliminar tus propios horarios.' });
      return;
    }
    const { error } = await supabase
      .from('availability_slots')
      .delete()
      .eq('id', slot.id)
      .eq('teacher_id', currentUserProfile.id);
    if (!error) {
      if (editingSlotId === slot.id) setEditingSlotId(null);
      setBanner({ type: 'ok', text: 'Franja horaria eliminada.' });
      loadAll();
    }
  }

  async function handleAddSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserProfile || currentUserProfile.role !== 'teacher' || addingSlot) return;
    if (parseTimeToHours(slotEnd) <= parseTimeToHours(slotStart)) {
      setBanner({ type: 'err', text: 'La hora de fin debe ser posterior a la hora de inicio.' });
      return;
    }

    setAddingSlot(true);
    const { error } = await supabase.from('availability_slots').insert({
      teacher_id: currentUserProfile.id,
      day_of_week: slotDay,
      start_time: slotStart + ':00',
      end_time: slotEnd + ':00',
      is_active: true,
    });
    setAddingSlot(false);

    if (!error) {
      setBanner({ type: 'ok', text: 'Franja horaria habilitada para tu perfil.' });
      loadAll();
    }
  }

  async function handleMarkAttendance(booking: Booking, attended: boolean) {
    if (!currentUserProfile || booking.teacher_id !== currentUserProfile.id) {
      setBanner({
        type: 'err',
        text: 'Solo la profesora que dictó o tiene asignada la clase puede marcar Asistió o Faltó.',
      });
      return;
    }
    const { error } = await supabase
      .from('bookings')
      .update({ attended })
      .eq('id', booking.id)
      .eq('teacher_id', currentUserProfile.id);
    if (!error) {
      loadAll();
    }
  }

  // ==================== PANTALLA DE CARGA ====================
  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-slate-600 text-sm font-medium">Cargando sesión...</p>
      </main>
    );
  }

  // ==================== PANTALLA DE INICIO (LOGIN / REGISTRO) ====================
  if (!currentUserProfile) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border rounded-2xl p-6 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold">Agenda de Clases Particulares</h1>
            <p className="text-sm text-slate-600">
              Iniciá sesión para ingresar automáticamente a tu perfil de Alumno o Profesora
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setBanner(null);
              }}
              className={`py-2 rounded-lg text-sm font-medium ${
                authMode === 'login' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setBanner(null);
              }}
              className={`py-2 rounded-lg text-sm font-medium ${
                authMode === 'register' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'
              }`}
            >
              Registrarme (Alumno)
            </button>
          </div>

          {banner && (
            <div
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium ${
                banner.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-red-50 border-red-300 text-red-900'
              }`}
            >
              {banner.text}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-3">
            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre y Apellido
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Juan Pérez"
                    value={authFullName}
                    onChange={(e) => setAuthFullName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Teléfono / WhatsApp del alumno
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 5492657000000"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    WhatsApp de madre / padre / tutor (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 5492657111111 (para avisos de clases)"
                    value={authParentPhone}
                    onChange={(e) => setAuthParentPhone(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Correo Electrónico
              </label>
              <input
                type="email"
                required
                placeholder="tu-correo@ejemplo.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium text-sm"
            >
              {authSubmitting
                ? 'Ingresando...'
                : authMode === 'login'
                ? 'Entrar a mi Perfil'
                : 'Crear Cuenta e Ingresar'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const upcomingBookings = activeBookings.filter((b) => !todayStr || b.booking_date >= todayStr);
  const pastBookings = activeBookings.filter((b) => Boolean(todayStr) && b.booking_date < todayStr);
  const mySlots = slots.filter((sl) => sl.teacher_id === currentUserProfile.id);
  const maxSubjectHours = Math.max(0.5, ...filteredStats.bySubject.map((x) => x.hours));
  const maxTeacherHours = Math.max(0.5, ...filteredStats.byTeacher.map((x) => x.hours));
  const ganttDayName = ganttDate ? DAYS[new Date(ganttDate + 'T12:00:00').getDay()] : '';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ENCABEZADO CON SESIÓN INICIADA */}
        <header className="bg-white border rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold">Agenda de Clases Particulares</h1>
            <p className="text-sm text-slate-600">
              Sesión iniciada como <strong>{currentUserProfile.full_name}</strong> •{' '}
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                  currentUserProfile.role === 'teacher'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {currentUserProfile.role === 'teacher' ? 'Perfil Profesora' : 'Perfil Alumno'}
              </span>
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg font-medium border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm"
          >
            Cerrar Sesión
          </button>
        </header>

        {banner && (
          <div
            className={`px-4 py-3 rounded-lg border text-sm font-medium ${
              banner.type === 'ok'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-red-50 border-red-300 text-red-900'
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* ==================== VISTA AUTOMÁTICA: ALUMNO ==================== */}
        {currentUserProfile.role === 'student' && (
          <div className="space-y-6">
            <section className="bg-white border rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-base">
                  Bienvenido/a, {currentUserProfile.full_name}
                </h2>
                <p className="text-xs text-slate-500">
                  {currentUserProfile.email}{' '}
                  {currentUserProfile.phone ? `• Tel: ${currentUserProfile.phone}` : ''}
                  {currentUserProfile.parent_phone
                    ? ` • WA Padres: ${currentUserProfile.parent_phone}`
                    : ''}
                </p>
              </div>
              <div className="text-right space-y-1">
                <div className="px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                  Horas disponibles:{' '}
                  <strong className="text-blue-900">{totalComboHours} hora(s)</strong>
                </div>
                <p className="text-[11px] text-slate-500">
                  Cuando abones tus clases, tu profesora cargará las horas en tu perfil.
                </p>
              </div>
            </section>

            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-lg">1. Agendar Turno en la Agenda</h2>
              <form
                onSubmit={handleBookTurn}
                className="grid sm:grid-cols-2 md:grid-cols-5 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Materia</label>
                  <select
                    value={bookSubjectId}
                    onChange={(e) => {
                      setBookSubjectId(e.target.value);
                      setManualTeacherOverride(false);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Profesora (balanceo automático)
                  </label>
                  <select
                    value={bookTeacherId}
                    onChange={(e) => {
                      setBookTeacherId(e.target.value);
                      setManualTeacherOverride(true);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {eligibleTeachersWithLoad.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.loadCount} en turno)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={bookDate}
                    onChange={(e) => {
                      setBookDate(e.target.value);
                      setManualTeacherOverride(false);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Hora entrada
                  </label>
                  <input
                    type="time"
                    step={1800}
                    value={bookStartTime}
                    onChange={(e) => {
                      setBookStartTime(e.target.value);
                      setManualTeacherOverride(false);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Hora salida
                  </label>
                  <input
                    type="time"
                    step={1800}
                    value={bookEndTime}
                    onChange={(e) => {
                      setBookEndTime(e.target.value);
                      setManualTeacherOverride(false);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div className="sm:col-span-2 md:col-span-5 flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-600 space-y-1 sm:space-y-0">
                    <span className="inline-block mr-3 px-2.5 py-0.5 rounded bg-slate-100 text-slate-800 font-medium border">
                      A descontar de tu saldo:{' '}
                      <strong>
                        {requestedDurationHours > 0
                          ? formatHoursDecimal(requestedDurationHours)
                          : 'Revisá inicio/fin'}
                      </strong>
                    </span>
                    {eligibleTeachersWithLoad.length > 1 && !manualTeacherOverride && (
                      <span className="inline-block mr-3 px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                        Asignación balanceada a quien tiene menor carga en este horario
                      </span>
                    )}
                    <span
                      className={`text-sm font-medium ${
                        maxOccupancyInRange >= maxCap ? 'text-red-600' : 'text-slate-700'
                      }`}
                    >
                      Ocupación máx. en rango: {maxOccupancyInRange} / {maxCap}{' '}
                      {maxOccupancyInRange >= maxCap ? '(CUPO LLENO)' : '(Disponible)'}
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={maxOccupancyInRange >= maxCap || requestedDurationHours <= 0}
                    className="px-5 py-2 rounded-lg bg-emerald-600 disabled:bg-slate-300 text-white font-medium text-sm"
                  >
                    Reservar Turno y Generar Comprobante
                  </button>
                </div>
              </form>

              {lastReceipt && (
                <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-50/60 space-y-1 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-900">
                      COMPROBANTE DE RESERVA • {lastReceipt.receipt_code}
                    </span>
                    <button
                      onClick={() => window.print()}
                      className="px-3 py-1 rounded bg-emerald-700 text-white text-xs"
                    >
                      Imprimir / Guardar PDF
                    </button>
                  </div>
                  <p>
                    <strong>Alumno:</strong> {lastReceipt.profiles?.full_name}
                  </p>
                  <p>
                    <strong>Materia y Profesora:</strong> {lastReceipt.subjects?.name} —{' '}
                    {lastReceipt.teacher?.full_name}
                  </p>
                  <p>
                    <strong>Día y Horario:</strong> {lastReceipt.booking_date} de{' '}
                    {lastReceipt.start_time.slice(0, 5)} a{' '}
                    {(
                      lastReceipt.end_time ||
                      computeEndTimeFromStartAndDuration(
                        lastReceipt.start_time.slice(0, 5),
                        Number(lastReceipt.duration_hours || 1)
                      )
                    ).slice(0, 5)}{' '}
                    hs ({formatHoursDecimal(Number(lastReceipt.duration_hours || 1))} descontadas)
                  </p>
                </div>
              )}
            </section>

            {/* Mis turnos agendados */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-lg">2. Mis Turnos Agendados ({myBookings.length})</h2>
                <span className="text-xs text-slate-500">
                  Podés cancelar con 2:00 hs o más de anticipación y recuperar tus horas.
                </span>
              </div>
              <div className="space-y-2 text-sm">
                {myBookings.map((b) => {
                  const isCancelled = b.status === 'cancelled';
                  const startDate = getBookingStartDate(b.booking_date, b.start_time);
                  const hoursUntilStart = (startDate.getTime() - nowTick) / (1000 * 60 * 60);
                  const canCancel = !isCancelled && hoursUntilStart >= 2;
                  const endStr = (
                    b.end_time ||
                    computeEndTimeFromStartAndDuration(
                      b.start_time.slice(0, 5),
                      Number(b.duration_hours || 1)
                    )
                  ).slice(0, 5);

                  return (
                    <div
                      key={b.id}
                      className={`border rounded-lg p-3 flex flex-wrap justify-between items-center gap-3 ${
                        isCancelled ? 'bg-slate-50 opacity-75' : ''
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold flex flex-wrap items-center gap-2">
                          <span>
                            {b.booking_date} • {b.start_time.slice(0, 5)} a {endStr} hs —{' '}
                            {b.subjects?.name}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                            {formatHoursDecimal(Number(b.duration_hours || 1))}
                          </span>
                          {isCancelled && (
                            <span className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                              Cancelado
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600">
                          Profesora: {b.teacher?.full_name} • Comprobante: {b.receipt_code}
                        </div>
                        {!isCancelled && hoursUntilStart > 0 && hoursUntilStart < 2 && (
                          <div className="text-xs text-amber-800 font-medium">
                            Faltan menos de 2:00 hs para el inicio: ya no se puede cancelar (debés
                            asistir o perderás las horas).
                          </div>
                        )}
                      </div>

                      <div>
                        {!isCancelled && (
                          <button
                            type="button"
                            disabled={!canCancel}
                            onClick={() => handleCancelBooking(b)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                              canCancel
                                ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                                : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            }`}
                          >
                            {canCancel ? 'Cancelar Turno' : 'Cancelación cerrada (< 2 hs)'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {myBookings.length === 0 && (
                  <p className="text-xs text-slate-500">Todavía no tenés turnos reservados.</p>
                )}
              </div>
            </section>

            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">3. Enviar Mensaje a una Profesora (vía WhatsApp)</h2>
              <form onSubmit={handleSendWhatsApp} className="grid md:grid-cols-4 gap-3">
                <select
                  value={msgTeacherId}
                  onChange={(e) => setMsgTeacherId(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      Para: {t.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Escribí tu consulta o aviso..."
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium text-sm"
                >
                  Enviar por WhatsApp
                </button>
              </form>
            </section>

            {/* ÚLTIMO CAMPO EN VISTA ALUMNO: PRECIOS DE HORA INDIVIDUAL Y COMBOS */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-base">4. Precios de Hora Individual y Combos</h2>
                <span className="text-xs text-slate-500">
                  Valores de referencia. Al abonar, avisale a tu profesora para que cargue las horas.
                </span>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                {pricing.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-xl p-3.5 bg-slate-50/70 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <span
                        className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded mb-1 ${
                          item.kind === 'combo'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {item.kind === 'combo' ? 'Combo' : 'Hora individual'}
                      </span>
                      <div className="font-semibold text-sm text-slate-900">
                        {formatPricingDisplayName(item)}
                      </div>
                      <div className="text-xs text-slate-600">{item.hours_included} hora(s)</div>
                    </div>
                    <div className="text-lg font-bold text-emerald-700">
                      ${Number(item.price).toLocaleString('es-AR')}
                    </div>
                  </div>
                ))}
                {pricing.length === 0 && (
                  <p className="text-xs text-slate-500 col-span-full">
                    No hay precios publicados en este momento.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ==================== VISTA AUTOMÁTICA: PROFESORA ==================== */}
        {currentUserProfile.role === 'teacher' && (
          <div className="space-y-6">
            {/* DIAGRAMA DE CARGA HORARIA CADA 30 MIN (14:00 A 21:00) */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-lg">
                    Diagrama de Carga Horaria por Profesora
                  </h2>
                  <p className="text-xs text-slate-600">
                    Franja de 14:00 a 21:00 hs en bloques de 30 minutos • Cupo máximo:{' '}
                    {TEACHER_MAX_CAPACITY} alumnos por profesora.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="text-xs font-medium text-slate-600">Día a consultar:</label>
                  <input
                    type="date"
                    value={ganttDate}
                    onChange={(e) => setGanttDate(e.target.value)}
                    className="border rounded-lg px-2.5 py-1.5 text-sm"
                  />
                  {ganttDayName && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700">
                      {ganttDayName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                  Habilitada con alumnos
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-50 border border-sky-200 text-sky-900">
                  <span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />
                  Habilitada libre (0 alumnos)
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-900">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
                  Cupo completo ({TEACHER_MAX_CAPACITY}/{TEACHER_MAX_CAPACITY}) / Excepción
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" />
                  Sin franja habilitada
                </span>
              </div>

              <div className="overflow-x-auto border rounded-xl">
                <table className="min-w-[1620px] w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b">
                      <th className="p-2.5 text-left font-semibold sticky left-0 bg-slate-100 z-10 min-w-[180px] border-r">
                        Profesora
                      </th>
                      {GANTT_HALF_HOURS.map((slotStart) => {
                        const slotEnd = addThirtyMinutes(slotStart);
                        return (
                          <th
                            key={slotStart}
                            className="p-2 text-center font-semibold border-r last:border-r-0 min-w-[104px] whitespace-nowrap"
                          >
                            {slotStart} a {slotEnd}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {ganttRows.map((row) => (
                      <tr key={row.teacher.id} className="border-b last:border-b-0">
                        <td className="p-2.5 font-semibold sticky left-0 bg-white z-10 border-r align-top">
                          <div>{row.teacher.full_name}</div>
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                            Cupo máx: {row.cap} • Tramos ocupados: {row.activeHalfHours} (
                            {formatHoursDecimal(row.totalBookedHalfHourSlots * 0.5)})
                          </div>
                        </td>
                        {row.cells.map((cell) => {
                          const isFull = cell.count >= cell.cap || cell.hasOverride;
                          let cellClasses = 'bg-slate-50 text-slate-400';
                          if (isFull && cell.count > 0) {
                            cellClasses = 'bg-rose-100 border-rose-300 text-rose-950';
                          } else if (cell.count > 0) {
                            cellClasses = 'bg-emerald-100 border-emerald-300 text-emerald-950';
                          } else if (cell.isEnabled) {
                            cellClasses = 'bg-sky-50 border-sky-200 text-sky-900';
                          }

                          return (
                            <td
                              key={cell.slotStart}
                              title={`${row.teacher.full_name} (${cell.slotStart} a ${cell.slotEnd}): ${
                                cell.count
                              }/${cell.cap} alumnos${
                                cell.studentNames.length > 0
                                  ? ' — ' + cell.studentNames.join(', ')
                                  : ''
                              }`}
                              className="p-1 border-r last:border-r-0 align-top"
                            >
                              <div
                                className={`rounded-md border p-1.5 min-h-[58px] flex flex-col justify-between ${cellClasses}`}
                              >
                                <div className="flex items-center justify-between font-bold text-[11px]">
                                  <span>
                                    {cell.count}/{cell.cap}
                                  </span>
                                  {cell.hasOverride && <span>!</span>}
                                </div>
                                {cell.studentNames.length > 0 ? (
                                  <div className="text-[10px] leading-tight mt-1 line-clamp-2">
                                    {cell.studentNames.join(', ')}
                                  </div>
                                ) : (
                                  <div className="text-[10px] opacity-75 mt-1">
                                    {cell.isEnabled ? 'Libre' : '—'}
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* CARGAR / MODIFICAR HORAS DE ALUMNOS (CUANDO ABONAN O POR INCONVENIENTES) */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <div>
                <h2 className="font-semibold text-lg">
                  Cargar o Modificar Horas de Alumnos (Pagos / Ajustes)
                </h2>
                <p className="text-xs text-slate-600">
                  Sumá horas al perfil del alumno cuando te abone (en efectivo o transferencia) o
                  ajustá saldo ante algún inconveniente.
                </p>
              </div>

              <form
                onSubmit={handleAdjustStudentHours}
                className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Alumno</label>
                  <select
                    value={adjustStudentId}
                    onChange={(e) => setAdjustStudentId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Horas a cargar (+) o descontar (-)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={adjustHoursDelta}
                    onChange={(e) => setAdjustHoursDelta(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Detalle / Motivo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Pago combo 4hs en efectivo"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                >
                  Actualizar Saldo de Horas
                </button>
              </form>

              <div className="pt-2 border-t">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Saldo Actual y Contacto de Padres por Alumno
                </h3>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {students.map((st) => {
                    const stHours = combos
                      .filter((c) => c.student_id === st.id)
                      .reduce((sum, c) => sum + Number(c.remaining_hours), 0);
                    return (
                      <div
                        key={st.id}
                        className="border rounded-lg px-3 py-2 flex justify-between items-center bg-slate-50/60 gap-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {st.full_name}{' '}
                            {!st.is_registered && (
                              <em className="text-xs text-amber-700">(urgencia)</em>
                            )}
                          </div>
                          {st.parent_phone && (
                            <div className="text-[11px] text-slate-500 truncate">
                              WA Padres: {st.parent_phone}
                            </div>
                          )}
                        </div>
                        <span className="font-semibold text-blue-700 shrink-0">
                          {stHours}h disp.
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* RESUMEN EN HORAS POR PERÍODO */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-lg">Resumen de Clases por Período (en Horas)</h2>
                  <p className="text-xs text-slate-600">
                    Cada alumno que solicita una clase suma su duración en horas (ej: 2 alumnos de 1h
                    en la misma materia y horario = 02:00 hs).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="text-xs text-slate-600">Desde:</label>
                  <input
                    type="date"
                    value={statsFrom}
                    onChange={(e) => setStatsFrom(e.target.value)}
                    className="border rounded-lg px-2.5 py-1.5 text-sm"
                  />
                  <label className="text-xs text-slate-600">Hasta:</label>
                  <input
                    type="date"
                    value={statsTo}
                    onChange={(e) => setStatsTo(e.target.value)}
                    className="border rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-xs text-emerald-800 font-medium">
                  Horas Totales Agendadas en Período
                </div>
                <div className="text-2xl font-bold text-emerald-950 mt-1">
                  {formatHoursDecimal(filteredStats.totalHoursBooked)}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 text-sm">
                <div className="border rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold">Horas por Materia</h3>
                  <div className="space-y-2">
                    {filteredStats.bySubject.map((sub) => (
                      <div key={sub.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{sub.name}</span>
                          <strong>{formatHoursDecimal(sub.hours)}</strong>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-indigo-600 h-2.5"
                            style={{ width: `${Math.round((sub.hours / maxSubjectHours) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold">Horas por Profesora</h3>
                  <div className="space-y-2">
                    {filteredStats.byTeacher.map((tc) => (
                      <div key={tc.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{tc.name}</span>
                          <strong>{formatHoursDecimal(tc.hours)}</strong>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-amber-500 h-2.5"
                            style={{ width: `${Math.round((tc.hours / maxTeacherHours) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Carga de urgencia + excepción de cupo */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">
                Cargar Alumno de Urgencia / Forzar Excepción de Cupo
              </h2>
              <form
                onSubmit={handleUrgentBooking}
                className="grid sm:grid-cols-2 md:grid-cols-7 gap-3 items-end"
              >
                <input
                  type="text"
                  placeholder="Nombre del alumno"
                  value={urgentName}
                  onChange={(e) => setUrgentName(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Tel. alumno (opc.)"
                  value={urgentPhone}
                  onChange={(e) => setUrgentPhone(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="WA padres (opc.)"
                  value={urgentParentPhone}
                  onChange={(e) => setUrgentParentPhone(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <select
                  value={urgentSubjectId}
                  onChange={(e) => setUrgentSubjectId(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={urgentTeacherId}
                  onChange={(e) => setUrgentTeacherId(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={urgentDate}
                  onChange={(e) => setUrgentDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="time"
                  step={1800}
                  value={urgentTime}
                  onChange={(e) => setUrgentTime(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <div className="sm:col-span-2 md:col-span-7 flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 text-sm font-medium text-amber-800">
                    <input
                      type="checkbox"
                      checked={forceOverride}
                      onChange={(e) => setForceOverride(e.target.checked)}
                    />
                    Forzar excepción de cupo (permitir alumno excedente por encima de{' '}
                    {TEACHER_MAX_CAPACITY})
                  </label>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium"
                  >
                    Agendar Urgencia
                  </button>
                </div>
              </form>
            </section>

            {/* Calendario de turnos futuros y pasados */}
            <section className="bg-white border rounded-xl p-5 shadow-sm grid md:grid-cols-2 gap-6">
              <div>
                <h2 className="font-semibold text-base mb-3">
                  Próximos Turnos Reservados ({upcomingBookings.length})
                </h2>
                <div className="space-y-2 max-h-72 overflow-y-auto text-sm">
                  {upcomingBookings.map((b) => {
                    const isMyTurn = b.teacher_id === currentUserProfile.id;
                    return (
                      <div
                        key={b.id}
                        className="border rounded-lg p-3 flex justify-between items-center gap-2"
                      >
                        <div>
                          <div className="font-semibold">
                            {b.booking_date} • {b.start_time.slice(0, 5)}hs — {b.profiles?.full_name}
                          </div>
                          <div className="text-xs text-slate-600">
                            {b.subjects?.name} ({b.teacher?.full_name}) • {b.receipt_code} •{' '}
                            {formatHoursDecimal(Number(b.duration_hours || 1))}
                            {b.is_override && ' • [EXCEPCIÓN]'}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              disabled={!isMyTurn}
                              onClick={() => handleMarkAttendance(b, true)}
                              className={`px-2 py-1 rounded text-xs border ${
                                !isMyTurn
                                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                  : b.attended === true
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-white'
                              }`}
                            >
                              Asistió
                            </button>
                            <button
                              type="button"
                              disabled={!isMyTurn}
                              onClick={() => handleMarkAttendance(b, false)}
                              className={`px-2 py-1 rounded text-xs border ${
                                !isMyTurn
                                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                  : b.attended === false
                                  ? 'bg-red-600 text-white border-red-600'
                                  : 'bg-white'
                              }`}
                            >
                              Faltó
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNotifyParents(b)}
                              className="px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-800 border border-green-300 hover:bg-green-100"
                            >
                              Avisar a padres
                            </button>
                          </div>
                          {!isMyTurn && (
                            <span className="text-[11px] text-slate-400">
                              Asistencia: solo {b.teacher?.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {upcomingBookings.length === 0 && (
                    <p className="text-slate-500 text-xs">No hay turnos futuros agendados todavía.</p>
                  )}
                </div>
              </div>

              <div>
                <h2 className="font-semibold text-base mb-3">
                  Historial de Turnos Pasados ({pastBookings.length})
                </h2>
                <div className="space-y-2 max-h-72 overflow-y-auto text-sm">
                  {pastBookings.map((b) => {
                    const isMyTurn = b.teacher_id === currentUserProfile.id;
                    return (
                      <div
                        key={b.id}
                        className="border rounded-lg p-3 flex justify-between items-center gap-2"
                      >
                        <div>
                          <div className="font-semibold">
                            {b.booking_date} • {b.profiles?.full_name}
                          </div>
                          <div className="text-xs text-slate-600">
                            {b.subjects?.name} ({b.teacher?.full_name})
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100">
                            {b.attended === true
                              ? 'Asistió'
                              : b.attended === false
                              ? 'Faltó'
                              : 'Sin marcar'}
                          </span>
                          <div className="flex flex-wrap justify-end gap-1">
                            {isMyTurn && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMarkAttendance(b, true)}
                                  className={`px-2 py-0.5 rounded text-[11px] border ${
                                    b.attended === true ? 'bg-emerald-600 text-white' : 'bg-white'
                                  }`}
                                >
                                  Asistió
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkAttendance(b, false)}
                                  className={`px-2 py-0.5 rounded text-[11px] border ${
                                    b.attended === false ? 'bg-red-600 text-white' : 'bg-white'
                                  }`}
                                >
                                  Faltó
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleNotifyParents(b)}
                              className="px-2 py-0.5 rounded text-[11px] font-medium bg-green-50 text-green-800 border border-green-300 hover:bg-green-100"
                            >
                              Avisar a padres
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {pastBookings.length === 0 && (
                    <p className="text-slate-500 text-xs">Aún no hay turnos pasados registrados.</p>
                  )}
                </div>
              </div>
            </section>

            {/* Días y horarios habilitados (solo para la profesora logueada) */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <div>
                <h2 className="font-semibold text-base">
                  Mis Días y Horarios Habilitados ({currentUserProfile.full_name})
                </h2>
                <p className="text-xs text-slate-500">
                  Solo podés cargar, editar, activar/desactivar o eliminar tus propios horarios.
                </p>
              </div>
              <form onSubmit={handleAddSlot} className="flex flex-wrap gap-2 items-end">
                <select
                  value={slotDay}
                  onChange={(e) => setSlotDay(Number(e.target.value))}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  {DAYS.map((d, idx) => (
                    <option key={idx} value={idx}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="time"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={addingSlot}
                  className="px-4 py-2 rounded-lg bg-slate-900 disabled:bg-slate-400 text-white text-sm font-medium"
                >
                  {addingSlot ? 'Guardando...' : 'Agregar Horario'}
                </button>
              </form>

              {editingSlotId && (
                <form
                  onSubmit={handleSaveEditedSlot}
                  className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-wrap gap-2 items-end"
                >
                  <span className="text-xs font-semibold text-amber-900 w-full">
                    Editando franja horaria propia:
                  </span>
                  <select
                    value={editSlotDay}
                    onChange={(e) => setEditSlotDay(Number(e.target.value))}
                    className="border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    {DAYS.map((d, idx) => (
                      <option key={idx} value={idx}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={editSlotStart}
                    onChange={(e) => setEditSlotStart(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm bg-white"
                  />
                  <input
                    type="time"
                    value={editSlotEnd}
                    onChange={(e) => setEditSlotEnd(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm bg-white"
                  />
                  <button
                    type="submit"
                    disabled={savingSlotEdit}
                    className="px-3.5 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium"
                  >
                    {savingSlotEdit ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSlotId(null)}
                    className="px-3.5 py-2 rounded-lg bg-white border text-slate-700 text-sm"
                  >
                    Cancelar
                  </button>
                </form>
              )}

              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {mySlots.map((sl) => (
                  <div
                    key={sl.id}
                    className="border rounded-lg p-2.5 flex justify-between items-center gap-2"
                  >
                    <span>
                      <strong>{DAYS[sl.day_of_week]}</strong> {sl.start_time.slice(0, 5)}-
                      {sl.end_time.slice(0, 5)}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleSlot(sl)}
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          sl.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {sl.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditingSlot(sl)}
                        className="px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSlot(sl)}
                        className="px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {mySlots.length === 0 && (
                  <p className="text-xs text-slate-500 col-span-full">
                    Todavía no cargaste días y horarios habilitados.
                  </p>
                )}
              </div>
            </section>

            {/* Precios de hora individual y combos */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-base">Precios de Hora Individual y Combos</h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {pricing.map((item) => (
                  <div key={item.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold">{formatPricingDisplayName(item)}</div>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {item.kind === 'combo' ? 'Combo' : 'Hora individual'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{item.hours_included} hora(s)</div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        defaultValue={item.price}
                        id={`price-${item.id}`}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const input = document.getElementById(
                            `price-${item.id}`
                          ) as HTMLInputElement;
                          const val = Number(input?.value);
                          if (!Number.isNaN(val) && val > 0) handleUpdatePrice(item.id, val);
                        }}
                        className="px-3 py-1 rounded bg-emerald-600 text-white text-sm"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}