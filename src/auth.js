import { supabase } from './supabaseClient.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 минут без действий — автовыход
let idleTimer = null;

export async function signIn(login, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: login, password });
  if (error) throw new Error(человекочитаемаяОшибкаВхода(error));
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
  clearIdleTimer();
}

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Профиль (логин/роль) — то, что раньше приходило в ответе login() из Apps Script.
export async function getProfile() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;
  const { data, error } = await supabase.from('profiles').select('login, role, active').eq('id', userData.user.id).single();
  if (error) throw error;
  return data;
}

function человекочитаемаяОшибкаВхода(error) {
  if (error.message?.includes('Invalid login credentials')) return 'Неверный логин или пароль';
  return error.message || 'Не удалось войти';
}

// Автовыход по бездействию — на общем компьютере в филиале нельзя, чтобы
// сессия одного человека висела вечно и досталась следующему без пароля.
export function armIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(() => { signOut(); location.reload(); }, IDLE_TIMEOUT_MS);
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

['click', 'keydown', 'mousemove', 'touchstart'].forEach((ev) =>
  document.addEventListener(ev, () => { if (idleTimer) armIdleTimer(); }, { passive: true })
);
