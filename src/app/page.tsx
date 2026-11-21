'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
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

type Payment = {
  id: string;
  student_id: string;
  amount: number;
  method: 'virtual_wallet' | 'cash';
  status: 'pending' | 'paid' | 'cancelled';
  notes: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
  pricing_catalog?: { name: string; kind: string; hours_included: number } | null;
};

type Booking = {
  id: string;
  receipt_code: string;
  student_id: string;
  teacher_id: string;
  subject_id: string;
  booking_date: string;
  start_time: string;
  duration_hours: number;
  modality: 'hourly' | 'combo';
  is_override: boolean;
  is_urgent_walkin: boolean;
  attended: boolean | null;
  profiles?: { full_name: string } | null;
  teacher?: { full_name: string } | null;
  subjects?: { name: string } | null;
};

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function HomePage() {
  // Estado de autenticación y perfil actual
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Datos de la app
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<TeacherSubject[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [combos, setCombos] = useState<StudentCombo[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Compra horas / combos
  const [selectedPricingId, setSelectedPricingId] = useState('');
  const [payMethod, setPayMethod] = useState<'virtual_wallet' | 'cash'>('virtual_wallet');

  // Reserva turno alumno
  const [bookSubjectId, setBookSubjectId] = useState('');
  const [bookTeacherId, setBookTeacherId] = useState('');
  const [manualTeacherOverride, setManualTeacherOverride] = useState(false);
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('15:00');
  const [bookModality, setBookModality] = useState<'hourly' | 'combo'>('hourly');
  const [lastReceipt, setLastReceipt] = useState<Booking | null>(null);

  // Mensaje WhatsApp
  const [msgTeacherId, setMsgTeacherId] = useState('');
  const [msgText, setMsgText] = useState('');

  // Profesora: urgencia & excepción
  const [urgentName, setUrgentName] = useState('');
  const [urgentPhone, setUrgentPhone] = useState('');
  const [urgentSubjectId, setUrgentSubjectId] = useState('');
  const [urgentTeacherId, setUrgentTeacherId] = useState('');
  const [urgentDate, setUrgentDate] = useState('');
  const [urgentTime, setUrgentTime] = useState('15:00');
  const [forceOverride, setForceOverride] = useState(false);

  // Profesora: modificar horas de un alumno
  const [adjustStudentId, setAdjustStudentId] = useState('');
  const [adjustHoursDelta, setAdjustHoursDelta] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState('');

  // Profesora: nueva franja horaria
  const [slotTeacherId, setSlotTeacherId] = useState('');
  const [slotDay, setSlotDay] = useState(1);
  const [slotStart, setSlotStart] = useState('15:00');
  const [slotEnd, setSlotEnd] = useState('19:00');

  // Profesora: rango de fechas para gráficos y análisis
  const [statsFrom, setStatsFrom] = useState('');
  const [statsTo, setStatsTo] = useState('');
  const [todayStr, setTodayStr] = useState('');

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const past30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setTodayStr(today);
    setBookDate(today);
    setUrgentDate(today);
    setStatsFrom(past30);
    setStatsTo(today);
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
      { data: pays },
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
        .from('payments')
        .select('*, profiles(full_name), pricing_catalog(name, kind, hours_included)')
        .order('created_at', { ascending: false }),
      supabase
        .from('bookings')
        .select('*, profiles:student_id(full_name), teacher:teacher_id(full_name), subjects(name)')
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
    if (!slotTeacherId && tList.length > 0) setSlotTeacherId(tList[0].id);

    if (subjs) {
      setSubjects(subjs as Subject[]);
      if (!bookSubjectId && subjs.length > 0) setBookSubjectId(subjs[0].id);
      if (!urgentSubjectId && subjs.length > 0) setUrgentSubjectId(subjs[0].id);
    }
    if (tSubjs) setTeacherSubjects(tSubjs as TeacherSubject[]);
    if (avSlots) setSlots(avSlots as AvailabilitySlot[]);
    if (prices) {
      setPricing(prices as PricingItem[]);
      if (!selectedPricingId && prices.length > 0) setSelectedPricingId(prices[0].id);
    }
    if (stCombos) setCombos(stCombos as unknown as StudentCombo[]);
    if (pays) setPayments(pays as unknown as Payment[]);
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
            role: 'student',
          },
        },
      });
      if (error) {
        setBanner({ type: 'err', text: error.message });
      } else if (data.user) {
        await fetchCurrentProfile(data.user.id);
        setBanner({ type: 'ok', text: '¡Cuenta creada! Bienvenido/a.' });
      }
    }
    setAuthSubmitting(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setCurrentUserProfile(null);
    setBanner(null);
    setLastReceipt(null);
  }

  // Profesoras habilitadas para la materia seleccionada + carga en la fecha/hora elegida
  const eligibleTeachersWithLoad = useMemo(() => {
    const allowedIds = teacherSubjects
      .filter((ts) => ts.subject_id === bookSubjectId)
      .map((ts) => ts.teacher_id);

    return teachers
      .filter((t) => allowedIds.includes(t.id))
      .map((t) => {
        const count = bookings.filter(
          (b) =>
            b.teacher_id === t.id &&
            b.booking_date === bookDate &&
            b.start_time.slice(0, 5) === bookTime.slice(0, 5)
        ).length;
        return { ...t, loadCount: count };
      })
      .sort((a, b) => a.loadCount - b.loadCount);
  }, [teacherSubjects, bookSubjectId, teachers, bookings, bookDate, bookTime]);

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

  const currentSlotCount = useMemo(() => {
    return bookings.filter(
      (b) =>
        b.teacher_id === bookTeacherId &&
        b.booking_date === bookDate &&
        b.start_time.slice(0, 5) === bookTime.slice(0, 5)
    ).length;
  }, [bookings, bookTeacherId, bookDate, bookTime]);

  const selectedBookTeacher = teachers.find((t) => t.id === bookTeacherId);
  const maxCap = selectedBookTeacher?.max_capacity ?? 8;

  // Estadísticas y gráficos filtrados por período
  const filteredStats = useMemo(() => {
    const paidInRange = payments.filter((p) => {
      const day = p.created_at.slice(0, 10);
      const afterFrom = !statsFrom || day >= statsFrom;
      const beforeTo = !statsTo || day <= statsTo;
      return p.status === 'paid' && afterFrom && beforeTo;
    });

    const totalRevenue = paidInRange.reduce((sum, p) => sum + Number(p.amount), 0);

    const walletTotal = paidInRange
      .filter((p) => p.method === 'virtual_wallet')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const cashTotal = paidInRange
      .filter((p) => p.method === 'cash')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const walletCount = paidInRange.filter((p) => p.method === 'virtual_wallet').length;
    const cashCount = paidInRange.filter((p) => p.method === 'cash').length;

    const bookingsInRange = bookings.filter((b) => {
      const afterFrom = !statsFrom || b.booking_date >= statsFrom;
      const beforeTo = !statsTo || b.booking_date <= statsTo;
      return afterFrom && beforeTo;
    });

    const bySubject = subjects
      .map((s) => ({
        id: s.id,
        name: s.name,
        count: bookingsInRange.filter((b) => b.subject_id === s.id).length,
      }))
      .sort((a, b) => b.count - a.count);

    const byTeacher = teachers.map((t) => ({
      id: t.id,
      name: t.full_name,
      count: bookingsInRange.filter((b) => b.teacher_id === t.id).length,
    }));

    return {
      totalRevenue,
      walletTotal,
      cashTotal,
      walletCount,
      cashCount,
      totalTurns: bookingsInRange.length,
      bySubject,
      byTeacher,
    };
  }, [payments, bookings, subjects, teachers, statsFrom, statsTo]);

  async function handleBuyPackage(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserProfile || !selectedPricingId) return;
    const item = pricing.find((p) => p.id === selectedPricingId);
    if (!item) return;

    const status = payMethod === 'virtual_wallet' ? 'paid' : 'pending';

    const { error } = await supabase.from('payments').insert({
      student_id: currentUserProfile.id,
      pricing_id: item.id,
      amount: item.price,
      method: payMethod,
      status,
      notes: payMethod === 'cash' ? 'Abona en efectivo en clase' : 'Pago con billetera virtual',
    });

    if (error) {
      setBanner({ type: 'err', text: error.message });
      return;
    }

    if (status === 'paid' && item.kind === 'combo') {
      await supabase.from('student_combos').insert({
        student_id: currentUserProfile.id,
        pricing_id: item.id,
        total_hours: item.hours_included,
        remaining_hours: item.hours_included,
      });
    }

    setBanner({
      type: 'ok',
      text:
        payMethod === 'virtual_wallet'
          ? `Pago acreditado por $${item.price} (${item.name}).`
          : `Solicitud registrada en EFECTIVO por $${item.price}. La profesora lo confirmará al recibir el dinero.`,
    });
    loadAll();
  }

  async function handleConfirmCashPayment(payment: Payment) {
    const { error } = await supabase
      .from('payments')
      .update({ status: 'paid' })
      .eq('id', payment.id);

    if (error) {
      setBanner({ type: 'err', text: error.message });
      return;
    }

    if (payment.pricing_catalog?.kind === 'combo') {
      await supabase.from('student_combos').insert({
        student_id: payment.student_id,
        total_hours: payment.pricing_catalog.hours_included,
        remaining_hours: payment.pricing_catalog.hours_included,
      });
    }

    setBanner({ type: 'ok', text: 'Pago en efectivo confirmado y acreditado.' });
    loadAll();
  }

  async function handleAdjustStudentHours(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustStudentId || adjustHoursDelta === 0 || !adjustReason.trim()) {
      setBanner({
        type: 'err',
        text: 'Seleccioná un alumno, indicá horas distintas de 0 y escribí el motivo del ajuste.',
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

    setAdjustReason('');
    setBanner({
      type: 'ok',
      text: `Horas ajustadas (${adjustHoursDelta > 0 ? '+' : ''}${adjustHoursDelta}h) correctamente.`,
    });
    loadAll();
  }

  async function handleBookTurn(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserProfile || !bookTeacherId || !bookSubjectId || !bookDate) {
      setBanner({ type: 'err', text: 'Completá materia, profesora y fecha.' });
      return;
    }

    const dayOfWeek = new Date(bookDate + 'T12:00:00').getDay();
    const isDayOpen = slots.some(
      (s) =>
        s.teacher_id === bookTeacherId &&
        s.day_of_week === dayOfWeek &&
        s.is_active &&
        bookTime >= s.start_time.slice(0, 5) &&
        bookTime < s.end_time.slice(0, 5)
    );

    if (!isDayOpen) {
      setBanner({
        type: 'err',
        text: `Ese día/horario (${DAYS[dayOfWeek]} ${bookTime}) no está habilitado por la profesora.`,
      });
      return;
    }

    const { data: hasSpace, error: capErr } = await supabase.rpc('check_slot_capacity', {
      p_teacher_id: bookTeacherId,
      p_date: bookDate,
      p_start_time: bookTime + ':00',
      p_force_override: false,
    });

    if (capErr) {
      setBanner({ type: 'err', text: capErr.message });
      return;
    }
    if (!hasSpace) {
      setBanner({
        type: 'err',
        text: `Cupo lleno (${maxCap}/${maxCap}) para este horario. Solo una profesora puede habilitar una excepción.`,
      });
      return;
    }

    let usedComboId: string | null = null;
    if (bookModality === 'combo') {
      const activeCombo = myCombos[0];
      if (!activeCombo || activeCombo.remaining_hours < 1) {
        setBanner({
          type: 'err',
          text: 'No tenés horas disponibles en combos. Comprá un combo o elegí modalidad Horas.',
        });
        return;
      }
      usedComboId = activeCombo.id;
      await supabase
        .from('student_combos')
        .update({ remaining_hours: Number(activeCombo.remaining_hours) - 1 })
        .eq('id', activeCombo.id);
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
        start_time: bookTime + ':00',
        duration_hours: 1,
        modality: bookModality,
        student_combo_id: usedComboId,
        is_override: false,
        is_urgent_walkin: false,
      })
      .select('*, profiles:student_id(full_name), teacher:teacher_id(full_name), subjects(name)')
      .single();

    if (error) {
      setBanner({ type: 'err', text: error.message });
    } else {
      setLastReceipt(inserted as unknown as Booking);
      setManualTeacherOverride(false);
      setBanner({ type: 'ok', text: `Turno reservado con éxito. Comprobante: ${receiptCode}` });
      loadAll();
    }
  }

  async function handleUrgentBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!urgentName.trim() || !urgentTeacherId || !urgentSubjectId || !urgentDate) return;

    const { data: hasSpace } = await supabase.rpc('check_slot_capacity', {
      p_teacher_id: urgentTeacherId,
      p_date: urgentDate,
      p_start_time: urgentTime + ':00',
      p_force_override: forceOverride,
    });

    if (!hasSpace) {
      setBanner({
        type: 'err',
        text: 'Cupo lleno para ese horario. Tildá "Forzar excepción de cupo" para inscribir igual.',
      });
      return;
    }

    const { data: tempStudent, error: stErr } = await supabase
      .from('profiles')
      .insert({
        full_name: urgentName.trim() + ' (Urgencia)',
        phone: urgentPhone.trim() || null,
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
      is_override: forceOverride,
      is_urgent_walkin: true,
    });

    if (error) {
      setBanner({ type: 'err', text: error.message });
    } else {
      setUrgentName('');
      setUrgentPhone('');
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
    await supabase
      .from('availability_slots')
      .update({ is_active: !slot.is_active })
      .eq('id', slot.id);
    loadAll();
  }

  async function handleAddSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!slotTeacherId) return;
    await supabase.from('availability_slots').insert({
      teacher_id: slotTeacherId,
      day_of_week: slotDay,
      start_time: slotStart + ':00',
      end_time: slotEnd + ':00',
      is_active: true,
    });
    setBanner({ type: 'ok', text: 'Franja horaria habilitada.' });
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

  async function handleMarkAttendance(bookingId: string, attended: boolean) {
    await supabase.from('bookings').update({ attended }).eq('id', bookingId);
    loadAll();
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
                    Teléfono / WhatsApp
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 5492657000000"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
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

  const upcomingBookings = bookings.filter((b) => !todayStr || b.booking_date >= todayStr);
  const pastBookings = bookings.filter((b) => Boolean(todayStr) && b.booking_date < todayStr);
  const maxSubjectTurns = Math.max(1, ...filteredStats.bySubject.map((x) => x.count));
  const maxTeacherTurns = Math.max(1, ...filteredStats.byTeacher.map((x) => x.count));

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
                </p>
              </div>
              <div className="px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                Saldo disponible en combos:{' '}
                <strong className="text-blue-900">{totalComboHours} hora(s)</strong>
              </div>
            </section>

            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-lg">1. Cargar Horas o Comprar Combo</h2>
              <form onSubmit={handleBuyPackage} className="grid md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Elegí Horas sueltas o Combo (más económico)
                  </label>
                  <select
                    value={selectedPricingId}
                    onChange={(e) => setSelectedPricingId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {pricing.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.hours_included}h — ${p.price}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Medio de pago
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'virtual_wallet' | 'cash')}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="virtual_wallet">Billetera Virtual (Mercado Pago / Transferencia)</option>
                    <option value="cash">Efectivo (se registra en la app)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm"
                >
                  Confirmar Compra / Carga
                </button>
              </form>
            </section>

            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-lg">2. Agendar Turno en la Agenda</h2>
              <form onSubmit={handleBookTurn} className="grid sm:grid-cols-2 md:grid-cols-5 gap-3 items-end">
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">Hora</label>
                  <input
                    type="time"
                    step={3600}
                    value={bookTime}
                    onChange={(e) => {
                      setBookTime(e.target.value);
                      setManualTeacherOverride(false);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Modalidad</label>
                  <select
                    value={bookModality}
                    onChange={(e) => setBookModality(e.target.value as 'hourly' | 'combo')}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="hourly">Por Hora suelta</option>
                    <option value="combo">Descontar de mi Combo ({totalComboHours}h disp.)</option>
                  </select>
                </div>

                <div className="sm:col-span-2 md:col-span-5 flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-600">
                    {eligibleTeachersWithLoad.length > 1 && !manualTeacherOverride && (
                      <span className="inline-block mr-3 px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                        Asignación balanceada a quien tiene menor carga en este horario
                      </span>
                    )}
                    <span
                      className={`text-sm font-medium ${
                        currentSlotCount >= maxCap ? 'text-red-600' : 'text-slate-700'
                      }`}
                    >
                      Cupo profesora: {currentSlotCount} / {maxCap}{' '}
                      {currentSlotCount >= maxCap ? '(CUPO LLENO)' : '(Disponible)'}
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={currentSlotCount >= maxCap}
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
                    <strong>Día y Hora:</strong> {lastReceipt.booking_date} a las{' '}
                    {lastReceipt.start_time.slice(0, 5)} hs
                  </p>
                  <p>
                    <strong>Modalidad:</strong>{' '}
                    {lastReceipt.modality === 'combo' ? 'Descuento de Combo' : 'Hora suelta'}
                  </p>
                </div>
              )}
            </section>

            {/* Mis turnos agendados */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">3. Mis Turnos Agendados ({myBookings.length})</h2>
              <div className="space-y-2 text-sm">
                {myBookings.map((b) => (
                  <div key={b.id} className="border rounded-lg p-3 flex flex-wrap justify-between items-center gap-2">
                    <div>
                      <div className="font-semibold">
                        {b.booking_date} • {b.start_time.slice(0, 5)}hs — {b.subjects?.name}
                      </div>
                      <div className="text-xs text-slate-600">
                        Profesora: {b.teacher?.full_name} • Comprobante: {b.receipt_code}
                      </div>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded bg-slate-100 font-medium">
                      {b.modality === 'combo' ? 'Combo' : 'Hora suelta'}
                    </span>
                  </div>
                ))}
                {myBookings.length === 0 && (
                  <p className="text-xs text-slate-500">Todavía no tenés turnos reservados.</p>
                )}
              </div>
            </section>

            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">4. Enviar Mensaje a una Profesora (vía WhatsApp)</h2>
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
          </div>
        )}

        {/* ==================== VISTA AUTOMÁTICA: PROFESORA ==================== */}
        {currentUserProfile.role === 'teacher' && (
          <div className="space-y-6">
            {/* SECTOR DE GRÁFICOS Y ANÁLISIS POR PERÍODO */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-lg">Gráficos y Análisis por Período</h2>
                  <p className="text-xs text-slate-600">
                    Facturación, medios de pago, materias concurridas y carga por profesora
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

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-xs text-emerald-800 font-medium">Facturación en Período</div>
                  <div className="text-2xl font-bold text-emerald-950 mt-1">
                    ${filteredStats.totalRevenue.toLocaleString('es-AR')}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <div className="text-xs text-blue-800 font-medium">Turnos en Período</div>
                  <div className="text-2xl font-bold text-blue-950 mt-1">
                    {filteredStats.totalTurns}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-100 border border-slate-200">
                  <div className="text-xs text-slate-700 font-medium">Medio Más Usado (Cobros)</div>
                  <div className="text-lg font-bold text-slate-900 mt-1">
                    {filteredStats.walletCount >= filteredStats.cashCount
                      ? `Billetera Virtual (${filteredStats.walletCount})`
                      : `Efectivo (${filteredStats.cashCount})`}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6 text-sm">
                <div className="border rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold">Medios de Pago (Monto Cobrado)</h3>
                  <div className="space-y-2">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>Billetera Virtual ({filteredStats.walletCount})</span>
                        <strong>${filteredStats.walletTotal.toLocaleString('es-AR')}</strong>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-blue-600 h-3"
                          style={{
                            width: `${
                              filteredStats.totalRevenue > 0
                                ? Math.round((filteredStats.walletTotal / filteredStats.totalRevenue) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>Efectivo ({filteredStats.cashCount})</span>
                        <strong>${filteredStats.cashTotal.toLocaleString('es-AR')}</strong>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-3"
                          style={{
                            width: `${
                              filteredStats.totalRevenue > 0
                                ? Math.round((filteredStats.cashTotal / filteredStats.totalRevenue) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold">Materias Más Concurridas</h3>
                  <div className="space-y-2">
                    {filteredStats.bySubject.map((sub) => (
                      <div key={sub.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{sub.name}</span>
                          <strong>{sub.count} turno(s)</strong>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-indigo-600 h-2.5"
                            style={{ width: `${Math.round((sub.count / maxSubjectTurns) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold">Turnos por Profesora</h3>
                  <div className="space-y-2">
                    {filteredStats.byTeacher.map((tc) => (
                      <div key={tc.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{tc.name}</span>
                          <strong>{tc.count} turno(s)</strong>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-amber-500 h-2.5"
                            style={{ width: `${Math.round((tc.count / maxTeacherTurns) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Modificar horas de usuarios por inconvenientes */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">
                Modificar Horas de Alumnos (por inconvenientes o reprogramaciones)
              </h2>
              <form onSubmit={handleAdjustStudentHours} className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
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
                    Horas a sumar (+) o restar (-)
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
                    Motivo del ajuste
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Corte de luz / clase suspendida"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium"
                >
                  Aplicar Ajuste de Horas
                </button>
              </form>
            </section>

            {/* Carga de urgencia + excepción de cupo */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-lg">
                Cargar Alumno de Urgencia / Forzar Excepción de Cupo
              </h2>
              <form onSubmit={handleUrgentBooking} className="grid sm:grid-cols-2 md:grid-cols-6 gap-3 items-end">
                <input
                  type="text"
                  placeholder="Nombre del alumno"
                  value={urgentName}
                  onChange={(e) => setUrgentName(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Teléfono (opcional)"
                  value={urgentPhone}
                  onChange={(e) => setUrgentPhone(e.target.value)}
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
                  step={3600}
                  value={urgentTime}
                  onChange={(e) => setUrgentTime(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <div className="sm:col-span-2 md:col-span-6 flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 text-sm font-medium text-amber-800">
                    <input
                      type="checkbox"
                      checked={forceOverride}
                      onChange={(e) => setForceOverride(e.target.checked)}
                    />
                    Forzar excepción de cupo (permitir alumno excedente por encima de 8)
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
                  {upcomingBookings.map((b) => (
                    <div key={b.id} className="border rounded-lg p-3 flex justify-between items-center">
                      <div>
                        <div className="font-semibold">
                          {b.booking_date} • {b.start_time.slice(0, 5)}hs — {b.profiles?.full_name}
                        </div>
                        <div className="text-xs text-slate-600">
                          {b.subjects?.name} ({b.teacher?.full_name}) • {b.receipt_code}
                          {b.is_override && ' • [EXCEPCIÓN]'}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMarkAttendance(b.id, true)}
                          className={`px-2 py-1 rounded text-xs border ${
                            b.attended === true ? 'bg-emerald-600 text-white' : 'bg-white'
                          }`}
                        >
                          Asistió
                        </button>
                        <button
                          onClick={() => handleMarkAttendance(b.id, false)}
                          className={`px-2 py-1 rounded text-xs border ${
                            b.attended === false ? 'bg-red-600 text-white' : 'bg-white'
                          }`}
                        >
                          Faltó
                        </button>
                      </div>
                    </div>
                  ))}
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
                  {pastBookings.map((b) => (
                    <div key={b.id} className="border rounded-lg p-3 flex justify-between items-center">
                      <div>
                        <div className="font-semibold">
                          {b.booking_date} • {b.profiles?.full_name}
                        </div>
                        <div className="text-xs text-slate-600">
                          {b.subjects?.name} ({b.teacher?.full_name})
                        </div>
                      </div>
                      <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100">
                        {b.attended === true
                          ? 'Asistió'
                          : b.attended === false
                          ? 'Faltó'
                          : 'Sin marcar'}
                      </span>
                    </div>
                  ))}
                  {pastBookings.length === 0 && (
                    <p className="text-slate-500 text-xs">Aún no hay turnos pasados registrados.</p>
                  )}
                </div>
              </div>
            </section>

            {/* Estado de alumnos, combos y pagos */}
            <section className="bg-white border rounded-xl p-5 shadow-sm grid md:grid-cols-2 gap-6">
              <div>
                <h2 className="font-semibold text-base mb-3">Estado de Alumnos y Combos</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
                  {students.map((st) => {
                    const stHours = combos
                      .filter((c) => c.student_id === st.id)
                      .reduce((sum, c) => sum + Number(c.remaining_hours), 0);
                    return (
                      <div key={st.id} className="border-b pb-2 flex justify-between">
                        <span>
                          {st.full_name}{' '}
                          {!st.is_registered && (
                            <em className="text-xs text-amber-700">(sin usuario)</em>
                          )}
                        </span>
                        <span className="font-semibold text-blue-700">Combo: {stHours}h disp.</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h2 className="font-semibold text-base mb-3">Pagos (Billetera Virtual y Efectivo)</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
                  {payments.map((p) => (
                    <div key={p.id} className="border rounded-lg p-2.5 flex justify-between items-center">
                      <div>
                        <div className="font-medium">
                          {p.profiles?.full_name} — ${p.amount}
                        </div>
                        <div className="text-xs text-slate-600">
                          {p.method === 'cash' ? 'Efectivo' : 'Billetera Virtual'} •{' '}
                          {p.status === 'paid' ? 'PAGADO' : 'PENDIENTE'}
                        </div>
                      </div>
                      {p.status === 'pending' && p.method === 'cash' && (
                        <button
                          onClick={() => handleConfirmCashPayment(p)}
                          className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                        >
                          Registrar Cobro Efectivo
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Días y horarios habilitados */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-base">Días y Horarios Habilitados para Turnos</h2>
              <form onSubmit={handleAddSlot} className="flex flex-wrap gap-2 items-end">
                <select
                  value={slotTeacherId}
                  onChange={(e) => setSlotTeacherId(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
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
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium"
                >
                  Agregar Horario
                </button>
              </form>

              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {slots.map((sl) => {
                  const tName = teachers.find((t) => t.id === sl.teacher_id)?.full_name;
                  return (
                    <div
                      key={sl.id}
                      className="border rounded-lg p-2.5 flex justify-between items-center"
                    >
                      <span>
                        <strong>{tName}:</strong> {DAYS[sl.day_of_week]} {sl.start_time.slice(0, 5)}-
                        {sl.end_time.slice(0, 5)}
                      </span>
                      <button
                        onClick={() => handleToggleSlot(sl)}
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          sl.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {sl.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Modificar precios de horas y combos */}
            <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="font-semibold text-base">Modificar Precios de Horas y Combos</h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {pricing.map((item) => (
                  <div key={item.id} className="border rounded-lg p-4 space-y-2">
                    <div className="font-bold">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.hours_included} hora(s)</div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        defaultValue={item.price}
                        id={`price-${item.id}`}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                      <button
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