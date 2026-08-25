import { supabase } from './supabaseClient.js';
import { signIn, signOut, getSession, getProfile, armIdleTimer } from './auth.js';
import './style.css';

const app = document.getElementById('app');

async function start() {
  const session = await getSession();
  if (session) return showApp();
  showLogin();
}

function showLogin(errorMsg) {
  app.innerHTML = `
    <div class="gate">
      <h1>Ведомость</h1>
      <form id="loginForm">
        <input id="login" type="text" placeholder="Логин" autocomplete="username" required>
        <input id="password" type="password" placeholder="Пароль" autocomplete="current-password" required>
        <button type="submit">Войти</button>
      </form>
      <p class="err">${errorMsg ? esc(errorMsg) : ''}</p>
    </div>
  `;
  document.getElementById('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const login = document.getElementById('login').value.trim();
    const password = document.getElementById('password').value;
    try {
      await signIn(login, password);
      armIdleTimer();
      await showApp();
    } catch (e) {
      showLogin(e.message);
    }
  });
}

async function showApp() {
  app.innerHTML = `<p>Загрузка…</p>`;
  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    app.innerHTML = `<p class="err">Не удалось загрузить профиль: ${esc(e.message)}</p>`;
    return;
  }

  const { data: branches, error } = await supabase.from('branches').select('id, name').order('name');
  if (error) {
    app.innerHTML = `<p class="err">Не удалось загрузить филиалы: ${esc(error.message)}</p>`;
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <header>
        <span>Вы вошли как <b>${esc(profile.login)}</b> (${esc(profile.role)})</span>
        <button id="logoutBtn">Выйти</button>
      </header>
      <h2>Доступные филиалы</h2>
      <ul>
        ${branches.map((b) => `<li>${esc(b.name)}</li>`).join('') || '<li>Нет доступных филиалов</li>'}
      </ul>
      <p class="hint">Это проверочная страница Фазы 3 — вход и доступ к данным через Supabase работают.
      Сам расчёт (мастера/персонал/табель) ещё предстоит перенести.</p>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut();
    showLogin();
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

start();
