'use strict';

/* ====================== 1. МОДЕЛЬ ====================== */
const POSTS = ['Менеджер','Мастер маникюра-педикюра','Бровист','Уборщик помещений'];
const STATUSES = ['Стандарт','Бизнес','Абсолют','Партнёр','Партнёр плюс','Без статуса'];
const СТАРЫЕ_СТАТУСЫ = {'Партнер':'Партнёр','Мастер':'Стандарт','Стажер':'Стандарт','Топ-мастер':'Партнёр плюс'};
const ВЕРСИЯ_МОДЕЛИ = 5;
/* Отметка сборки страницы. Видна на «Синхронизации» — по ней сразу понятно,
   загрузилась свежая версия или браузер отдал залежавшуюся. */
const СБОРКА = '2026-08-21 · 14';
const КАТ_МАСТЕРА = ['Стандарт','Бизнес','Абсолют','Партнёр','Партнёр плюс'];
function ДОЛЖНОСТИ_ПО_УМОЛЧАНИЮ(){
  return [
    {name:'Менеджер',                 процент:false, категории:['Стандарт','Старший']},
    {name:'Мастер маникюра-педикюра', процент:true,  категории:КАТ_МАСТЕРА.slice()},
    {name:'Бровист',                  процент:true,  категории:КАТ_МАСТЕРА.slice()},
    {name:'Уборщик помещений',        процент:false, категории:[]}
  ];
}
/* Должности и категории живут в данных, а не в коде: их можно менять из ведомости */
function роль(post){ return (S.roles||[]).find(r=>r.name===post) || null; }
function должности(){ return (S.roles||[]).map(r=>r.name); }
function категории(post){ const r=роль(post); return r ? (r.категории||[]) : []; }
function процентная(post){ const r=роль(post); return r ? !!r.процент : false; }
function работает(p){ return !(p && p.уволен); }
function всеКатегории(){
  const s=new Set(); (S.roles||[]).forEach(r=>(r.категории||[]).forEach(k=>s.add(k)));
  return [...s];
}
const ПОКАЗАТЕЛИ = {
  revS:   'Выручка по услугам',
  revG:   'Выручка по товарам',
  shifts: 'Отработано смен',
  hours:  'Отработано часов',
  perSh:  'Выручка за смену',
  base:   'Начислено до мотивации'
};

/* Приводит ранее сохранённые расчёты к новой модели: переименовывает статусы,
   раскладывает единый процент по ступеням выручки, добавляет поля оклада.
   Вызывается при каждой отрисовке, но реально работает только один раз. */
function миграция(x){
  if(!x || x.v===ВЕРСИЯ_МОДЕЛИ) return x;
  x.tiers = x.tiers || [{from:0},{from:150000}];
  x.params = x.params || {};
  if(x.params.нормаСмен===undefined) x.params.нормаСмен = 22;
  (x.people||[]).forEach(p=>{
    if(СТАРЫЕ_СТАТУСЫ[p.status]) p.status = СТАРЫЕ_СТАТУСЫ[p.status];
    if(!p.payType) p.payType = 'смена';
    if(p.monthSalary===undefined) p.monthSalary = null;
  });
  (x.matrix||[]).forEach(m=>{
    if(СТАРЫЕ_СТАТУСЫ[m.status]) m.status = СТАРЫЕ_СТАТУСЫ[m.status];
    if(!Array.isArray(m.pctT)) m.pctT = x.tiers.map(()=>m.pctS);
    while(m.pctT.length < x.tiers.length) m.pctT.push(m.pctT[m.pctT.length-1] ?? null);
  });
  // должности и категории переезжают из кода в данные
  if(!Array.isArray(x.roles)){
    x.roles = ДОЛЖНОСТИ_ПО_УМОЛЧАНИЮ();
    (x.people||[]).forEach(p=>{
      if(p.post && !x.roles.some(r=>r.name===p.post)){
        x.roles.push({name:p.post, процент:false, категории:[]});
      }
    });
  }
  // приводим статусы людей к категориям их должности
  (x.people||[]).forEach(p=>{
    const r=(x.roles||[]).find(r=>r.name===p.post); if(!r) return;
    const к=r.категории||[];
    if(!к.length) p.status='';
    else if(!к.includes(p.status)) p.status=к[0];
  });
  // пересобираем матрицу под справочник, сохраняя уже введённые значения
  const было={}; (x.matrix||[]).forEach(m=>{ было[m.post+'|'+m.status]=m; });
  const нов=[];
  (x.roles||[]).forEach(r=>{
    const к=(r.категории||[]).length ? r.категории : [''];
    к.forEach(st=>{
      const o = было[r.name+'|'+st] || было[r.name+'|Без статуса'] || {};
      нов.push({post:r.name, status:st,
        pctS:o.pctS??null, pctG:o.pctG??null, hour:o.hour??null,
        pctT: Array.isArray(o.pctT) ? o.pctT.slice() : x.tiers.map(()=>o.pctS??null)});
    });
  });
  x.matrix = нов;
  if(!Array.isArray(x.bonuses)) x.bonuses = [];
  if(!x.tabel || typeof x.tabel!=='object') x.tabel = {};   // { empId: { '01': {h,r} } }
  (x.people||[]).forEach(p=>{
    if(p.mrot===undefined) p.mrot=null;
    if(p.уволен===undefined) p.уволен=false;
    if(p.orphan===undefined) p.orphan=false;
  });
  if(x.params.ндс===undefined) x.params.ндс=0;
  if(x.проведён===undefined) x.проведён=null;   // {когда, кто} — месяц закрыт
  // Авансы двух видов: обычные (было a1 и a2) и отдельно выданные из кассы.
  // Обычных по умолчанию два, кассовых нет вовсе — их добавляют по надобности.
  if(x.params.авансов===undefined) x.params.авансов = 2;
  if(x.params.авансовКасса===undefined) x.params.авансовКасса = 0;
  [].concat(x.masters||[], x.staff||[]).forEach(r=>{
    if(!Array.isArray(r.av)) r.av = [n(r.a1), n(r.a2)];
    delete r.a1; delete r.a2;
    if(!Array.isArray(r.avk)) r.avk = [];
    while(r.av.length  < x.params.авансов)      r.av.push(0);
    while(r.avk.length < x.params.авансовКасса) r.avk.push(0);
  });
  if(x.params.усн===undefined) x.params.усн=0;
  x.v = ВЕРСИЯ_МОДЕЛИ;
  return x;
}
const PCT_POSTS = ['Мастер маникюра-педикюра','Бровист'];   // оплата от процента
const MAX_MASTERS = 20;

function defaultRoles(){ return ДОЛЖНОСТИ_ПО_УМОЛЧАНИЮ(); }
function defaultMatrix(){
  // pctT — проценты по ступеням выручки: [до порога, после порога]
  const known = {
    'Мастер маникюра-педикюра|Стандарт':      [[0.35,0.37],0.10,181],
    'Мастер маникюра-педикюра|Бизнес':        [[0.37,0.40],0.10,181],
    'Мастер маникюра-педикюра|Абсолют':       [[0.40,0.42],0.10,181],
    'Мастер маникюра-педикюра|Партнёр':       [[0.42,0.42],0.10,181],
    'Мастер маникюра-педикюра|Партнёр плюс':  [[null,null],0.10,181],
    'Менеджер|Стандарт':                      [[0,0],0.10,0],
    'Менеджер|Старший':                       [[0,0],0.10,0],
    'Уборщик помещений|':                     [[0,0],0,0]
  };
  const out=[];
  ДОЛЖНОСТИ_ПО_УМОЛЧАНИЮ().forEach(r=>{
    const к=(r.категории||[]).length ? r.категории : [''];
    к.forEach(st=>{
      const v=known[r.name+'|'+st]||[[null,null],null,null];
      out.push({post:r.name,status:st,pctT:v[0].slice(),pctS:v[0][0],pctG:v[1],hour:v[2]});
    });
  });
  return out;
}

function seed(){
  const emp=(fio,post,status,form,shiftRate,note)=>({id:uid(),fio,post,status,form,
    shiftRate:shiftRate||null, payType:'смена', monthSalary:null, mrot:null, note:note||''});
  const people=[
    emp('Уразова Татьяна Николаевна','Мастер маникюра-педикюра','Абсолют','НО'),
    emp('Царэлунгэ Нина Анатольевна','Мастер маникюра-педикюра','Абсолют','НО'),
    emp('Эшиева Айпери','Мастер маникюра-педикюра','Абсолют','НО',null,'вернулась в сеть 20.01.2025'),
    emp('Галстян Офеля Маисовна','Мастер маникюра-педикюра','Абсолют','НО'),
    emp('Татарчук Татьяна Станиславовна','Мастер маникюра-педикюра','Партнёр','НО'),
    emp('Гуломходжаева Муниса','Мастер маникюра-педикюра','Абсолют','НО'),
    emp('Рябова Анжелика Игоревна','Менеджер','Стандарт','Оформлен',5300),
    emp('Ковалева Маргарита Максимовна','Менеджер','Стандарт','Оформлен',5300),
    emp('Уборщица (подряд)','Уборщик помещений','','НО',1000)
  ];
  const mf=[[5,46,51267,0,8000],[4,34,41523,0,8500],[4,44,56429,0,8000],
            [4,44,60502,0,8000],[2,18,31820,0,8000],[1,6,8589,0,2500]];
  const masters=mf.map((f,i)=>({empId:people[i].id,shifts:f[0],hours:f[1],revS:f[2],revG:f[3],
    corr:0,vac:0,extra:0,redo:0,inv:0,carry:0,av:[0,f[4]],avk:[]}));
  const sf=[[3,4200,0],[3,390,15900],[6,0,6000]];
  const staff=sf.map((f,i)=>({empId:people[6+i].id,shifts:f[0],revG:f[1],bonus:0,bonus100:0,
    night:0,vac:0,ded:0,carry:0,av:[0,f[2]],avk:[]}));
  return {
    branch:'Беломорская', period:'2026-06',
    v:ВЕРСИЯ_МОДЕЛИ,
    params:{hour:181, step:50, plan:15, ndflOf:0, ndflNO:0, нормаСмен:22},
    tiers:[{from:0},{from:150000}], bonuses:[], roles:defaultRoles(), tabel:{},
    matrix:defaultMatrix(), people, masters, staff
  };
}

let S;
const uid=()=>Math.random().toString(36).slice(2,10);

import { supabase as sb } from './supabaseClient.js';

/* ---- слой 1: память браузера (мгновенно, на этом устройстве) ---- */
const LS={
  ok:(()=>{try{localStorage.setItem('__t','1');localStorage.removeItem('__t');return true}catch(e){return false}})(),
  get(k){try{const v=localStorage.getItem(k);return v?JSON.parse(v):null}catch(e){return null}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
  keys(){try{return Object.keys(localStorage)}catch(e){return []}}
};
const keyOf = st => `${st.branch}|${st.period}`;
/* Раньше здесь был настраиваемый адрес Apps Script — теперь бэкенд один
   (Supabase), настраивать нечего. cfg.url оставлен как флаг «бэкенд есть»,
   чтобы все прежние проверки if(cfg.url) в коде ниже не трогать. */
let cfg = {url:true};
let auth = {};
let usersCache = null;

function localKeys(){
  return LS.keys().filter(k=>k.startsWith('ved:d:')).map(k=>k.slice(6));
}
/* Правки копятся в памяти браузера — это мгновенно и переживает случайное
   закрытие вкладки. В общее хранилище они уходят только по кнопке
   «Сохранить изменения»: раньше каждое нажатие клавиши тянуло за собой
   поход к Google, и работать было невозможно. */
let естьПравки=false;

function save(){
  LS.set('ved:d:'+keyOf(S), S);
  LS.set('ved:last', keyOf(S));
  LS.set('ved:k:'+S.branch, S.people||[]);
  пометитьПравки();
}

function пометитьПравки(){
  if(толькоСмотрим()) return;   // в режиме просмотра сохранять нечего
  if(JSON.stringify(S)===последняяВыгрузка){ снятьПравки(); return; }
  естьПравки=true;
  LS.set('ved:pending:'+keyOf(S), true);
  const b=document.getElementById('btnCommit');
  if(b) b.style.display='';
  status('Есть несохранённые правки — нажмите «Сохранить изменения»','warn');
}

function снятьПравки(){
  естьПравки=false;
  LS.set('ved:pending:'+keyOf(S), false);
  const b=document.getElementById('btnCommit');
  if(b) b.style.display='none';
}
/* Правки, оставленные в этом браузере и ещё не отправленные в облако —
   переживают перезагрузку страницы, поэтому проверяем localStorage,
   а не только переменную в памяти текущей вкладки. */
function естьНесохранённыеЛокально(key){ return !!LS.get('ved:pending:'+key); }

/* Спросить перед уходом с несохранёнными правками.
   Возвращает true, если можно продолжать. */
async function можноУходить(куда){
  if(!естьПравки) return true;
  const ответ=confirm(`Есть несохранённые изменения.\n\nСохранить их перед тем,`
    +` как ${куда}?\n\nОК — сохранить и продолжить\nОтмена — продолжить без сохранения`);
  if(ответ){
    const вышло=await cloudSave();
    if(!вышло) return confirm('Сохранить не удалось. Всё равно продолжить?\n\n'
      +'Правки останутся в этом браузере.');
  }
  return true;
}

/* ---- слой 2: облако (теперь Supabase, а не Google Таблица) ---- */
let cloudBusy=false;
function status(text,cls){
  const el=document.getElementById('status'); if(!el) return;
  el.textContent=text; el.className='status'+(cls?' '+cls:'');
}
function hhmm(){ return new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }

let последняяВыгрузка='';

/* ---- филиалы: имя <-> id, нужен на каждый вызов к базе ---- */
let ветвиКэш=null;
async function справочникФилиалов(){
  if(ветвиКэш) return ветвиКэш;
  const {data,error}=await sb.from('branches').select('id,name');
  if(error) throw new Error(error.message);
  ветвиКэш={byName:{},byId:{}};
  data.forEach(b=>{ ветвиКэш.byName[b.name]=b.id; ветвиКэш.byId[b.id]=b.name; });
  return ветвиКэш;
}
async function филиалId(name){
  const м=await справочникФилиалов();
  const id=м.byName[name];
  if(!id) throw new Error('Нет доступа к этому филиалу');
  return id;
}
function splitKey(key){ const i=key.lastIndexOf('|'); return [key.slice(0,i), key.slice(i+1)]; }

/* ---- примитивы api(action, extra) — раньше ходили в Apps Script,
   теперь бьют напрямую в Supabase (RPC/таблицы). Имя и форма ответа
   каждого действия сохранены такими же, как были — весь код ниже
   (картотека, замок, журнал, свод, отрисовка) вызывает api()/cloudGet()
   и ни строчки не знает, что сервер поменялся. ---- */

async function apiPing(){
  return {ok:true, login:auth.login, role:auth.role, periods:0};
}

async function apiSave(p){
  const [branchName, period]=splitKey(p.key);
  const branchId=await филиалId(branchName);
  if(period==='картотека'){
    const {error}=await sb.rpc('save_roster',{p_branch:branchId, p_people:p.state});
    if(error) throw new Error(error.message);
    return {ok:true, key:p.key, updated:new Date().toISOString(), by:auth.login};
  }
  const {data,error}=await sb.rpc('save_payroll',
    {p_branch:branchId, p_period:period+'-01', p_state:p.state, p_note:p.note||null});
  if(error) throw new Error(error.message);
  return {ok:true, key:p.key, updated:data.updated, by:auth.login};
}

async function apiLoad(p){
  const [branchName, period]=splitKey(p.key);
  const branchId=await филиалId(branchName);
  if(period==='картотека'){
    const {data,error}=await sb.rpc('load_roster',{p_branch:branchId});
    if(error) throw new Error(error.message);
    return data;
  }
  const {data,error}=await sb.rpc('load_payroll',{p_branch:branchId, p_period:period+'-01'});
  if(error) throw new Error(error.message);
  return data;
}

async function apiList(){
  const {data,error}=await sb.rpc('list_keys');
  if(error) throw new Error(error.message);
  return data;
}

async function apiLock(p){
  const [branchName, period]=splitKey(p.key);
  const branchId=await филиалId(branchName);
  const fn=({take:'lock_take',ping:'lock_ping',free:'lock_free',ask:'lock_ask',status:'lock_status'})[p.what]||'lock_status';
  const {data,error}=await sb.rpc(fn,{p_branch:branchId, p_period:period+'-01'});
  if(error) throw new Error(error.message);
  return data;
}

async function apiUsers(){
  const {data,error}=await sb.rpc('users_list');
  if(error) throw new Error(error.message);
  return data;
}

/* Заводит НОВУЮ учётку (или меняет пароль/права существующей) через
   Edge Function create-user — она одна знает служебный ключ, из браузера
   его не видно. Раньше это мог делать только разработчик вручную. */
async function вызовФункции(name, body){
  const {data, error} = await sb.functions.invoke(name, {body});
  if(error){
    let msg = error.message || 'Не вышло';
    try{
      if(error.context && typeof error.context.json === 'function'){
        const j = await error.context.json();
        if(j && j.error) msg = j.error;
      }
    }catch(e){}
    throw new Error(msg);
  }
  if(data && data.ok===false) throw new Error(data.error||'Не вышло');
  return data;
}

async function apiUserSave(p){
  await вызовФункции('create-user', {
    app:'vedomost', login:p.login, pass:p.pass||undefined,
    role:p.role==='админ'?'admin':'user', active:p.active!==false, branches:p.branches||''
  });
  return {ok:true, updated:p.login};
}

async function apiUserDel(p){
  // Настоящее удаление учётки требует служебного ключа — вместо этого
  // отключаем доступ (active=false), эффект для пользователя тот же.
  const {error}=await sb.rpc('user_set_access',{p_login:p.login, p_role:'user', p_branches:'', p_active:false});
  if(error) throw new Error(error.message);
  return {ok:true, deleted:p.login};
}

async function apiPassword(p){
  const {error}=await sb.auth.updateUser({password:p.pass});
  if(error) throw new Error(error.message);
  return {ok:true};
}

async function apiJournal(p){
  const {data,error}=await sb.rpc('journal_read',{p_limit:p.limit||200});
  if(error) throw new Error(error.message);
  return data;
}

async function api(action, extra){
  const p=extra||{};
  try{
    if(action==='ping')      return await apiPing();
    if(action==='save')      return await apiSave(p);
    if(action==='load')      return await apiLoad(p);
    if(action==='list')      return await apiList();
    if(action==='lock')      return await apiLock(p);
    if(action==='users')     return await apiUsers();
    if(action==='user_save') return await apiUserSave(p);
    if(action==='user_del')  return await apiUserDel(p);
    if(action==='password')  return await apiPassword(p);
    if(action==='journal')   return await apiJournal(p);
    if(action==='logout'){ await sb.auth.signOut(); return {ok:true}; }
    throw new Error('Неизвестное действие: '+action);
  }catch(err){
    const m=String(err.message||'');
    if(m.includes('JWT')||m.includes('session')||m.includes('not authenticated')){
      сброситьВход('Сессия истекла — войдите заново');
      throw new Error('Сессия истекла');
    }
    throw err;
  }
}

async function cloudSave(){
  if(!cfg.url||!auth.session||cloudBusy) return false;
  cloudBusy=true; status('Сохраняю…','busy');
  try{
    const снимок=JSON.stringify(S);
    await api('save',{key:keyOf(S), state:S, note:tab});
    последняяВыгрузка=снимок;
    await выгрузитьКартотеку();
    снятьПравки();
    status('Сохранено · '+hhmm(),'ok');
    return true;
  }catch(err){
    status('В облако не ушло: '+err.message,'bad'); return false;
  }finally{ cloudBusy=false; }
}

async function cloudGet(params){
  const p=Object.assign({},params); const a=p.action||'load'; delete p.action;
  return api(a,p);
}

/* ---- вход и выход ---- */
function сброситьВход(msg){
  auth={}; usersCache=null;
  sb.auth.signOut().catch(()=>{});
  document.body.classList.add('locked');
  const m=document.getElementById('gateMsg');
  if(m){ m.textContent=msg||''; m.className='gatemsg'+(msg?' bad':''); }
  const l=document.getElementById('gateLogin'); if(l) setTimeout(()=>l.focus(),50);
}

/* Логин/роль/филиалы человека — раньше приходили прямо в ответе на вход
   от Apps Script, теперь это отдельная строка в vedomost.profiles плюс
   список филиалов из vedomost.user_branches. Роль в базе хранится
   английскими 'admin'/'user' — переводим в 'админ'/'пользователь' один раз
   здесь, дальше весь код ниже сравнивает только с русскими значениями. */
async function профильИФилиалы(userId){
  const {data:profile,error}=await sb.from('profiles').select('login,role,active').eq('id',userId).single();
  if(error || !profile) throw new Error('Профиль не найден — обратитесь к администратору');
  if(!profile.active) throw new Error('Доступ отключён');
  let branches='';
  if(profile.role!=='admin'){
    const {data:rows}=await sb.from('user_branches').select('branch_id').eq('user_id',userId);
    const м=await справочникФилиалов();
    branches=(rows||[]).map(r=>м.byId[r.branch_id]).filter(Boolean).join(',');
  }
  return {login:profile.login, role:profile.role==='admin'?'админ':'пользователь', branches};
}

function переводОшибкиВхода(error){
  const m=String(error.message||'');
  if(m.includes('Invalid login credentials')) return 'Неверный логин или пароль';
  return m || 'Сервер не ответил';
}

async function войти(login, pass){
  const {data,error}=await sb.auth.signInWithPassword({email:login, password:pass});
  if(error) throw new Error(переводОшибкиВхода(error));
  const info=await профильИФилиалы(data.user.id);
  auth={session:data.session.access_token, uid:data.user.id, login:info.login, role:info.role, branches:info.branches};
}

async function выйти(){
  try{ if(замок.mine) await замокДействие('free'); }catch(e){}
  try{ await api('logout'); }catch(e){}
  сброситьВход('Вы вышли');
}

/* Кому доступен хотя бы один филиал — берём первый как безопасный старт.
   Нужно, когда S.branch унаследован от прошлой сессии в этом же браузере
   (общий компьютер в филиале), а вошедший сейчас человек его не видит. */
function первыйДоступныйФилиал(){
  const parts=(auth.branches||'').split(',').map(s=>s.trim()).filter(Boolean);
  return parts[0] || S.branch;
}

/* Единая точка загрузки расчёта одного месяца. Сервер — источник истины:
   локальная копия в этом браузере используется, только если сети нет,
   или если по этому же ключу в браузере остались правки, ещё не отправленные
   в облако — тогда решение отдаём человеку, а не выбираем молча сами. */
async function загрузитьРасчёт(key){
  const локально=LS.get('ved:d:'+key);
  if(!cfg.url || !auth.session) return {data:локально};
  let ответ;
  try{ ответ=await cloudGet({action:'load', key}); }
  catch(err){
    if(String(err.message).indexOf('доступ')>=0) return {denied:true};
    if(String(err.message).indexOf('Сессия')>=0) return {denied:true, reauth:true};
    return {data:локально, офлайн:true, ошибка:err.message};
  }
  const облачные=ответ.state;
  if(!облачные) return {data:локально};
  if(локально && естьНесохранённыеЛокально(key)){
    const взятьСервер=confirm(
      `Для «${key.replace('|',' · ')}» на сервере есть данные, а в этом браузере — `+
      `несохранённые правки.\n\nОК — открыть версию с сервера (локальные правки потеряются)\n`+
      `Отмена — оставить как есть в этом браузере`);
    if(!взятьСервер) return {data:локально};
  }
  LS.set('ved:d:'+key, облачные);
  LS.set('ved:pending:'+key, false);
  return {data:облачные};
}

async function открытьВедомость(){
  document.body.classList.remove('locked');
  const w=document.getElementById('railWho'); if(w) w.textContent=auth.login||'';
  status('Загружаю месяц…','busy');

  let key=keyOf(S);
  let рез=await загрузитьРасчёт(key);
  if(рез.denied){
    if(рез.reauth) return;   // сброситьВход уже сработал внутри api()
    S.branch=первыйДоступныйФилиал();
    key=keyOf(S);
    рез=await загрузитьРасчёт(key);
  }
  if(рез.data) S=миграция(рез.data);
  if(рез.офлайн) status('Облако недоступно, показываю локальную копию: '+рез.ошибка,'warn');

  последняяВыгрузка=JSON.stringify(S);
  последняяКартотека=JSON.stringify(S.people||[]);
  подтянутьКартотеку(S).then(()=>{
    последняяВыгрузка=JSON.stringify(S);   // пересняли снимок — уже после слияния сирот месяца
    render(); занятьМесяц();
  });
  const t=document.getElementById('tabAccess');
  if(t) t.style.display = auth.role==='админ' ? '' : 'none';
  render();
  if(!рез.офлайн) status('Вход выполнен · '+auth.login,'ok');
  cloudGet({action:'list'})
    .then(j=>{cloudList=j.keys; render();})
    .catch(err=>{ if(String(err.message).indexOf('Сессия')<0) status('Работаем локально: '+err.message,'warn'); });
}

async function старт(){
  if(!auth.session){ сброситьВход(''); return; }
  await открытьВедомость();
}

/* На перезагрузке страницы своя сессия входа лежит не в localStorage
   (как раньше), а в куда более надёжном месте — сессии Supabase Auth,
   которая сама себя продлевает. Восстанавливаем auth из неё. */
async function восстановитьВход(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){ auth={}; return; }
  try{
    const info=await профильИФилиалы(session.user.id);
    auth={session:session.access_token, uid:session.user.id, login:info.login, role:info.role, branches:info.branches};
  }catch(e){ auth={}; }
}

/* ---- стартовое состояние ---- */
S = LS.get('ved:d:'+(LS.get('ved:last')||'')) || LS.get('vedomost') || seed();

/* ====================== 2. РАСЧЁТ ====================== */
const n = v => { const x=parseFloat(String(v??'').replace(',','.')); return isFinite(x)?x:0; };
const down = v => Math.floor(v+1e-9);                       // округление вниз до рубля
const step = v => { const s=S.params.step||1; return v<=0?0:Math.floor(v/s+1e-9)*s; };
const rub = v => (v===null||v===undefined||v==='')?'—':
  (Math.round(v)===0?'—':Math.round(v).toLocaleString('ru-RU'));
const pctTxt = v => (v===null||v===undefined)?'—':Math.round(v*1000)/10+'%';

/* ---- авансы: обычные и кассовые ---- */
const скольковАвансов = () => Math.max(1, Math.min(n(S.params.авансов)||2, 8));
const скольковКассы   = () => Math.max(0, Math.min(n(S.params.авансовКасса)||0, 8));
const суммаАвансов = row =>
  (row.av||[]).reduce((a,v)=>a+n(v),0) + (row.avk||[]).reduce((a,v)=>a+n(v),0);
const пустыеАвансы = () => Array.from({length:скольковАвансов()},()=>0);
const пустаяКасса  = () => Array.from({length:скольковКассы()},()=>0);
const заголовкиАвансов = () => [].concat(
  Array.from({length:скольковАвансов()},(_,i)=>`Аванс ${i+1} ₽`),
  Array.from({length:скольковКассы()},  (_,i)=>`Аванс ${i+1} (касса) ₽`));
/* ячейки ввода одной строки: сначала обычные, следом кассовые */
const ячейкиАвансов = r => [].concat(
  (r.av||[]).map((v,k)=>`<td><input data-av="${k}" class="num" value="${v||''}" placeholder="0"></td>`),
  (r.avk||[]).map((v,k)=>`<td><input data-avk="${k}" class="num" value="${v||''}" placeholder="0"></td>`)
).join('');
/* итоги по каждой колонке */
const итогиАвансов = список => [].concat(
  Array.from({length:скольковАвансов()},(_,k)=>
    `<td class="num">${rub(список.reduce((a,r)=>a+n((r.av||[])[k]),0))}</td>`),
  Array.from({length:скольковКассы()},(_,k)=>
    `<td class="num">${rub(список.reduce((a,r)=>a+n((r.avk||[])[k]),0))}</td>`)
).join('');

const person = id => S.people.find(p=>p.id===id) || null;
const rate = (post,status) => S.matrix.find(m=>m.post===post&&m.status===status)
  || {pctS:null,pctG:null,hour:null};

/* ---- ТАБЕЛЬ ---- */
function днейВМесяце(period){
  const [y,m]=String(period).split('-').map(Number);
  return (y&&m) ? new Date(y, m, 0).getDate() : 31;
}
function деньНедели(period, d){
  const [y,m]=String(period).split('-').map(Number);
  return ['вс','пн','вт','ср','чт','пт','сб'][new Date(y, m-1, d).getDay()];
}
function выходной(period, d){
  const дн=деньНедели(period,d);
  return дн==='сб'||дн==='вс';
}
/* Итоги по одному сотруднику: смены, часы, выручка */
function итогТабеля(empId){
  const дни=(S.tabel||{})[empId]||{};
  let смен=0, часов=0, выручка=0;
  Object.keys(дни).forEach(k=>{
    const з=дни[k]||{};
    const ч=n(з.h), в=n(з.r);
    if(ч>0||в>0) смен++;
    часов+=ч; выручка+=в;
  });
  return {смен, часов, выручка};
}
function che_post(p){ return p ? p.post : ''; }
function табельЗаполнен(empId){
  const дни=(S.tabel||{})[empId]||{};
  return Object.keys(дни).some(k=>n((дни[k]||{}).h)>0 || n((дни[k]||{}).r)>0);
}

/* НДФЛ. У оформленного сотрудника с заданным МРОТ налог считается с МРОТ:
   официально человек оформлен на минималку, и облагается именно она,
   независимо от того, сколько начислено фактически.
   Если МРОТ не задан — база прежняя, всё начисление. */
function ндфл_(p, accrued){
  const ставка = p.form==='Оформлен' ? n(S.params.ndflOf) : n(S.params.ndflNO);
  if(!ставка) return 0;
  const мрот = n(p.mrot);
  const база = (p.form==='Оформлен' && мрот>0) ? мрот : accrued;
  return Math.round(база * ставка);
}
function базаНДФЛ(p, accrued){
  const мрот = n(p.mrot);
  return (p.form==='Оформлен' && мрот>0) ? мрот : accrued;
}

/* Конструктор мотивации: перебирает правила и возвращает сработавшие надбавки.
   Правило адресуется должности и статусу, сравнивает показатель с порогом
   и даёт либо фиксированную сумму, либо процент от этого же показателя. */
function мотивация(p, ctx){
  const out=[];
  (S.bonuses||[]).forEach(b=>{
    if(b.активно===false) return;
    if(b.кому && b.кому!=='все' && b.кому!==p.post) return;
    if(b.статус && b.статус!=='любой' && b.статус!==p.status) return;
    const v = ctx[b.показатель];
    if(v===undefined || v===null) return;
    const ok = b.условие==='<=' ? v <= n(b.порог) : v >= n(b.порог);
    if(!ok) return;
    const сумма = b.тип==='процент' ? down(v*n(b.значение)/100) : down(n(b.значение));
    if(сумма) out.push({name:b.name||'Без названия', сумма});
  });
  return out;
}

/* Какая ступень сработала при такой выручке услуг */
function ступень(rev){
  const t=S.tiers||[{from:0}];
  let idx=0;
  for(let i=0;i<t.length;i++) if(rev >= n(t[i].from)) idx=i;
  return idx;
}
function процентПоСтупени(r, rev){
  if(Array.isArray(r.pctT)){
    const v=r.pctT[ступень(rev)];
    if(v!==null && v!==undefined) return v;
  }
  return r.pctS;
}

function calcMaster(row){
  const p = person(row.empId);
  if(!p) return null;
  const r = rate(p.post,p.status);
  const baseRev0 = n(row.revS)+n(row.corr);
  const stIdx = ступень(baseRev0);
  const pctS = процентПоСтупени(r, baseRev0), pctG = r.pctG ?? 0;
  const hour = (r.hour ?? null) !== null ? r.hour : S.params.hour;
  const baseRev = baseRev0;
  const accS = down(baseRev*(pctS??0));
  const accH = down(n(row.hours)*hour);
  const base = Math.max(accS,accH);
  const accG = down(n(row.revG)*pctG);
  const бонусы = мотивация(p, {revS:baseRev, revG:n(row.revG), shifts:n(row.shifts),
    hours:n(row.hours), perSh: n(row.shifts)?down(baseRev/n(row.shifts)):0, base:base+accG});
  const бонус = бонусы.reduce((a,x)=>a+x.сумма,0);
  const accrued = base + accG + бонус + n(row.vac) + n(row.extra) + n(row.carry) - n(row.redo) - n(row.inv);
  const ndfl = ндфл_(p, accrued);
  const total = accrued - ndfl - суммаАвансов(row);
  const paid = step(total);
  let flag='ok', note='Норма';
  if(pctS===null||pctS===undefined){flag='bad'; note='% не задан';}
  else if(accH>accS){flag='warn'; note='Гарантия по часам';}
  if(total<0){flag='bad'; note='Отрицательная сумма';}
  return {p,pctS,pctG,hour,baseRev,accS,accH,base,accG,accrued,ndfl,total,paid,
          rest:total-paid, flag, note, stIdx, бонусы, бонус,
          perShift: n(row.shifts)?Math.round(n(row.revS)/n(row.shifts)):0};
}

function calcStaff(row){
  const p = person(row.empId);
  if(!p) return null;
  const r = rate(p.post,p.status);
  const pctG = r.pctG ?? 0;
  const shiftRate = n(p.shiftRate);
  // Оклад за месяц пересчитывается по факту отработанных смен:
  // норма 22 смены, вышел 11 — получит половину оклада.
  const оклад = p.payType==='оклад';
  const норма = n(S.params.нормаСмен) || 22;
  const byRate = оклад
    ? down(n(p.monthSalary) * n(row.shifts) / норма)
    : down(shiftRate*n(row.shifts));
  const accG = down(n(row.revG)*pctG);
  const бонусы = мотивация(p, {revS:0, revG:n(row.revG), shifts:n(row.shifts), hours:0,
    perSh:0, base:byRate+accG});
  const бонус = бонусы.reduce((a,x)=>a+x.сумма,0);
  const accrued = byRate + accG + бонус + n(row.bonus) + n(row.bonus100) + n(row.night)
                + n(row.vac) + n(row.carry) - n(row.ded);
  const ndfl = ндфл_(p, accrued);
  const total = accrued - ndfl - суммаАвансов(row);
  const paid = step(total);
  let flag='ok', note='Норма';
  if(оклад && !n(p.monthSalary)){flag='bad'; note='Не задан оклад';}
  else if(!оклад && !shiftRate){flag='bad'; note='Нет ставки за смену';}
  if(total<0){flag='bad'; note='Отрицательная сумма';}
  return {p,pctG,shiftRate,byRate,accG,accrued,ndfl,total,paid,rest:total-paid,flag,note,оклад,норма,бонусы,бонус};
}

function totals(){
  const M=S.masters.map(calcMaster).filter(Boolean);
  const T=S.staff.map(calcStaff).filter(Boolean);
  const sum=(a,f)=>a.reduce((s,x)=>s+f(x),0);
  const revS=sum(S.masters,r=>n(r.revS));
  const revG=sum(S.masters,r=>n(r.revG))+sum(S.staff,r=>n(r.revG));
  const accrued=sum(M,x=>x.accrued)+sum(T,x=>x.accrued);
  const total=sum(M,x=>x.total)+sum(T,x=>x.total);
  const paid=sum(M,x=>x.paid)+sum(T,x=>x.paid);
  const rest=sum(M,x=>x.rest)+sum(T,x=>x.rest);
  const shifts=sum(S.masters,r=>n(r.shifts));
  const issues=M.filter(x=>x.flag==='bad').length+T.filter(x=>x.flag==='bad').length;
  const guar=M.filter(x=>x.flag==='warn').length;
  return {M,T,revS,revG,rev:revS+revG,accrued,total,paid,rest,shifts,issues,guar,
          share:(revS+revG)?accrued/(revS+revG):0,
          perShift:shifts?revS/shifts:0, heads:M.length+T.length};
}

/* ---- плоская выгрузка для читаемого листа Google Таблицы ---- */
function flatTable(){
  const t=totals();
  const rows=[['ФИО','Должность','Статус','Смен','Часов','Выручка услуги','Выручка товары',
    'Начислено','Авансы и удержания','К выплате','Выдано','Остаток','Контроль']];
  S.masters.forEach((r,i)=>{const c=t.M[i]; if(!c)return;
    rows.push([c.p.fio,c.p.post,c.p.status,n(r.shifts),n(r.hours),n(r.revS),n(r.revG),
      c.accrued,c.accrued-c.total,c.total,c.paid,c.rest,c.note]);});
  S.staff.forEach((r,i)=>{const c=t.T[i]; if(!c)return;
    rows.push([c.p.fio,c.p.post,c.p.status,n(r.shifts),0,0,n(r.revG),
      c.accrued,c.accrued-c.total,c.total,c.paid,c.rest,c.note]);});
  rows.push(['ИТОГО','','',t.shifts,'',t.revS,t.revG,t.accrued,t.accrued-t.total,
    t.total,t.paid,t.rest,'']);
  return rows;
}

/* ---- картотека: одна на филиал, общая для всех месяцев ----
   Раньше список сотрудников лежал внутри снимка месяца, и его приходилось
   набирать заново в каждом новом периоде. Теперь картотека хранится
   отдельным ключом «филиал|картотека» и подтягивается при открытии любого
   месяца. Уволенных не удаляют — им ставят признак, чтобы расчёты прошлых
   месяцев не потеряли фамилию. */
const КЛЮЧ_КАРТОТЕКИ = br => br+'|картотека';

const поФамилии = f => String(f||'').trim().toLowerCase().replace(/\s+/g,' ');

function слитьКартотеку(state, общая){
  if(!Array.isArray(общая) || !общая.length) return state;
  const есть={}; общая.forEach(p=>{ есть[p.id]=true; });
  const итог=общая.map(копия);

  // Пока картотека жила внутри месяца, одного и того же человека заводили
  // заново в каждом периоде — и каждый раз он получал новый внутренний номер.
  // Поэтому сначала пробуем узнать его по фамилии и переклеить на неё старые
  // строки месяца: иначе рядом появится двойник, а табель повиснет на нём.
  const поФИО={}; общая.forEach(p=>{ const k=поФамилии(p.fio); if(k && !поФИО[k]) поФИО[k]=p; });
  const замена={};
  (state.people||[]).forEach(p=>{
    if(есть[p.id]) return;
    const свой=поФИО[поФамилии(p.fio)];
    if(свой) замена[p.id]=свой.id;
  });
  if(Object.keys(замена).length){
    (state.masters||[]).forEach(r=>{ if(замена[r.empId]) r.empId=замена[r.empId]; });
    (state.staff||[]).forEach(r=>{ if(замена[r.empId]) r.empId=замена[r.empId]; });
    const т=state.tabel||{};
    Object.keys(замена).forEach(старый=>{
      if(!т[старый]) return;
      const новый=замена[старый];
      т[новый]=Object.assign({}, т[новый]||{}, т[старый]);
      delete т[старый];
    });
  }

  // тех, кого в общей картотеке нет и по фамилии не узнали, но кто участвует
  // в расчёте этого месяца, оставляем — иначе строка лишится фамилии и процента
  const занят=new Set();
  (state.masters||[]).forEach(r=>занят.add(r.empId));
  (state.staff||[]).forEach(r=>занят.add(r.empId));
  Object.keys(state.tabel||{}).forEach(id=>занят.add(id));
  (state.people||[]).forEach(p=>{
    if(!есть[p.id] && !замена[p.id] && занят.has(p.id)){ const c=копия(p); c.orphan=true; итог.push(c); }
  });
  state.people=итог;
  return state;
}

function картотекаЛокально(br){ return LS.get('ved:k:'+br); }

async function подтянутьКартотеку(state){
  let общая=null;
  if(cfg.url && auth.session){
    try{ const j=await cloudGet({action:'load', key:КЛЮЧ_КАРТОТЕКИ(state.branch)});
         if(Array.isArray(j.state)) общая=j.state; }
    catch(e){}
  }
  if(!общая) общая=картотекаЛокально(state.branch);
  // снимок для сравнения — от канонического списка ДО слияния с сиротами месяца,
  // иначе после слияния «изменений» никогда не найдётся и правки не уйдут в облако
  последняяКартотека=JSON.stringify(общая || state.people || []);
  if(общая && общая.length){ слитьКартотеку(state, общая); LS.set('ved:k:'+state.branch, общая); }
  else if((state.people||[]).length) LS.set('ved:k:'+state.branch, state.people);
  return state;
}

let последняяКартотека='';
async function выгрузитьКартотеку(){
  if(!cfg.url||!auth.session) return;
  const снимок=JSON.stringify(S.people||[]);
  if(снимок===последняяКартотека) return;
  try{ await api('save',{key:КЛЮЧ_КАРТОТЕКИ(S.branch), state:S.people||[], table:[]});
       последняяКартотека=снимок; }
  catch(e){}
}

/* ---- ревизия: что лежит в каждом месяце ----
   Отвечает на вопрос «куда делся табель»: проходит по всем сохранённым
   расчётам и показывает, сколько в каждом людей, строк и заполненных дней. */
let аудитОтчёт='';
let журналОтчёт='';

/* ---- журнал: кто, когда и что делал с базой ---- */
async function показатьЖурнал(){
  if(!cfg.url||!auth.session){ status('Журнал живёт в общем хранилище — нужен вход','warn'); return; }
  status('Читаю журнал…','busy');
  let j;
  try{ j=await api('journal',{limit:300}); }
  catch(err){ status('Журнал не открылся: '+err.message,'bad'); return; }

  const когда=t=>t?new Date(t).toLocaleString('ru-RU'):'—';
  const учётки=(j.users||[]).slice().sort((a,b)=>String(b.last).localeCompare(String(a.last)));
  const строки=(j.rows||[]);

  журналОтчёт=`
  <div class="grid2">
    <div>
      <p class="hint">Последний вход по каждой учётной записи.</p>
      <div class="scroll"><table><thead><tr>
        <th class="l">Логин</th><th class="l">Роль</th><th class="l">Последний вход</th>
      </tr></thead><tbody>${учётки.length?учётки.map(u=>`<tr>
        <td class="l"><b>${esc(u.login)}</b>${u.login===auth.login?' <span class="pill ok">это вы</span>':''}</td>
        <td class="l calc">${esc(u.role)}</td>
        <td class="l">${когда(u.last)}</td></tr>`).join('')
        :'<tr><td class="l" colspan="3">Пусто.</td></tr>'}</tbody></table></div>
    </div>
    <div>
      <p class="hint">Последние действия: вход, выход, сохранение месяца.
      Журнал начинает заполняться с момента обновления хранилища —
      того, что было раньше, в нём нет.</p>
    </div>
  </div>
  <div class="scroll" style="margin-top:14px;max-height:420px"><table><thead><tr>
    <th class="l">Когда</th><th class="l">Кто</th><th class="l">Что</th><th class="l">Месяц</th>
  </tr></thead><tbody>${строки.length?строки.map(r=>`<tr>
    <td class="l">${когда(r.when)}</td>
    <td class="l"><b>${esc(r.who)}</b></td>
    <td class="l">${esc(r.what)}</td>
    <td class="l calc">${r.key?esc(String(r.key).split('|')[0]+' · '+периодТекст(String(r.key).split('|').pop())):''}</td>
  </tr>`).join(''):'<tr><td class="l" colspan="4">Записей пока нет.</td></tr>'}</tbody></table></div>`;
  render();
  status(`Журнал: записей ${строки.length}, учёток ${учётки.length}`,'ok');
}

async function ревизияХранилища(){
  if(cfg.url && auth.session){
    status('Обновляю список месяцев…','busy');
    try{ const j=await cloudGet({action:'list'}); cloudList=j.keys; }catch(e){}
  }
  const ключи=известныеКлючи().sort();
  const строки=[];
  for(let i=0;i<ключи.length;i++){
    const key=ключи[i];
    status(`Смотрю ${i+1} из ${ключи.length}: ${key}`,'busy');
    let d=LS.get('ved:d:'+key), где='на этом устройстве';
    if(!d && cfg.url && auth.session){
      где='в облаке';
      try{ const j=await cloudGet({action:'load',key}); d=j.state; }
      catch(e){ строки.push({key,ошибка:e.message}); continue; }
    }
    if(!d){ строки.push({key,ошибка:'запись пуста'}); continue; }
    const t=d.tabel||{};
    let людейВТабеле=0, дней=0, часов=0;
    Object.keys(t).forEach(id=>{
      const дни=t[id]||{}; let свои=0;
      Object.keys(дни).forEach(k=>{ const з=дни[k]||{};
        if(n(з.h)>0||n(з.r)>0){ свои++; часов+=n(з.h); } });
      if(свои){ людейВТабеле++; дней+=свои; }
    });
    строки.push({key, где, людей:(d.people||[]).length,
      мастеров:(d.masters||[]).length, персонала:(d.staff||[]).length,
      людейВТабеле, дней, часов:Math.round(часов*10)/10,
      сироты:Object.keys(t).filter(id=>!(d.people||[]).some(p=>p.id===id)).length});
  }
  const сТабелем=строки.filter(r=>r.людейВТабеле>0).length;
  аудитОтчёт=`<p class="hint">Просмотрено расчётов: ${строки.length}. Табель заполнен в ${сТабелем}.</p>
  <div class="scroll"><table><thead><tr>
    <th class="l">Филиал</th><th class="l">Месяц</th><th class="l">Где</th>
    <th>Людей</th><th>Мастеров</th><th>Персонала</th>
    <th>В табеле</th><th>Дней</th><th>Часов</th><th class="l">Замечание</th>
  </tr></thead><tbody>${строки.map(r=>{
    if(r.ошибка) return `<tr><td class="l">${esc(String(r.key).split('|')[0])}</td>
      <td class="l">${esc(String(r.key).split('|').pop())}</td>
      <td class="l" colspan="7"><span class="pill bad">${esc(r.ошибка)}</span></td></tr>`;
    return `<tr><td class="l">${esc(String(r.key).split('|')[0])}</td>
      <td class="l">${esc(периодТекст(String(r.key).split('|').pop()))}</td>
      <td class="l calc">${r.где}</td>
      <td class="num">${r.людей||'—'}</td><td class="num">${r.мастеров||'—'}</td>
      <td class="num">${r.персонала||'—'}</td>
      <td class="num">${r.людейВТабеле?'<b>'+r.людейВТабеле+'</b>':'—'}</td>
      <td class="num">${r.дней||'—'}</td><td class="num">${r.часов||'—'}</td>
      <td class="l">${r.сироты?'<span class="pill warn">'+r.сироты+' в табеле не из картотеки</span>':''}</td>
    </tr>`;}).join('')}</tbody></table></div>`;
  render();
  status(`Ревизия готова: расчётов ${строки.length}, с табелем ${сТабелем}`, сТабелем?'ok':'warn');
}

/* Забрать месяц из общего хранилища, затерев местную копию.
   Нужно после восстановления из резервной копии: в памяти браузера
   лежит прежний, испорченный расчёт, и он старше того, что в таблице. */
async function взятьИзОблака(){
  if(!cfg.url||!auth.session){ status('Нужен вход в хранилище','warn'); return; }
  const key=keyOf(S);
  if(!confirm(`Взять «${S.branch} · ${периодТекст(S.period)}» из общего хранилища?\n\n`
    +`Всё, что не сохранено из этого браузера, будет потеряно.`)) return;
  status('Забираю из хранилища…','busy');
  try{
    const j=await cloudGet({action:'load',key});
    if(!j.state){ status('В хранилище такого месяца нет','warn'); return; }
    S=миграция(j.state);
    LS.set('ved:d:'+key,S);
    снятьПравки();
    await подтянутьКартотеку(S);
    последняяВыгрузка=JSON.stringify(S);   // снимок — уже после слияния сирот месяца
    render();
    const t=totals();
    status(`Взято из хранилища · выручка ${rub(t.rev)} ₽`,'ok');
  }catch(err){ status('Не получилось: '+err.message,'bad'); }
}

/* ====================== ЗАМОК НА МЕСЯЦ ======================
   Месяц лежит в хранилище одной записью, поэтому сохранение с любой
   вкладки переписывает его целиком. Значит, править месяц в один момент
   должен один человек — иначе второй молча затрёт первого.
   Пока месяц занят кем-то другим, страница работает в режиме просмотра. */

let замок = {held:false, mine:false, who:'', since:'', asks:''};
let таймерЗамка = null;

const толькоСмотрим = () => замок.held && !замок.mine;

function когдаБыл(iso){
  if(!iso) return '';
  const мин=Math.round((Date.now()-new Date(iso))/60000);
  if(мин<1) return 'только что';
  if(мин===1) return 'минуту назад';
  if(мин<5) return мин+' минуты назад';
  return мин+' минут назад';
}

async function замокДействие(что){
  if(!cfg.url||!auth.session) return null;
  try{ return await api('lock',{key:keyOf(S), what:что}); }
  catch(err){ return null; }
}

/* Занять месяц. Вызывается при входе и при каждой смене филиала или периода. */
async function занятьМесяц(){
  const был=замок.mine;
  const j=await замокДействие('take');
  if(!j) return;
  замок=j;
  if(!был && замок.mine && таймерЗамка===null) держатьЗамок();
  render();
}

/* Отмечаемся раз в три минуты: пока страница открыта, месяц наш.
   Если не отмечаться десять минут, хранилище отпустит замок само —
   закрытый ноутбук не должен запирать месяц до утра. */
function держатьЗамок(){
  clearInterval(таймерЗамка);
  таймерЗамка=setInterval(async ()=>{
    const было=замок.mine, кто=замок.who;
    const j=await замокДействие('ping');
    if(!j) return;
    замок=j;
    if(!было && замок.mine){
      status('Месяц освободился — можно править','ok'); render();
    } else if(было && !замок.mine){
      status('Месяц перешёл к '+замок.who,'warn'); render();
    } else if(замок.mine && замок.asks && !показаннаяПросьба){
      показаннаяПросьба=замок.asks; render();
    } else if(кто!==замок.who) render();
  }, 180000);
}
let показаннаяПросьба='';

async function освободитьМесяц(){
  if(естьПравки && !await можноУходить('выйти из месяца')) return;
  const j=await замокДействие('free');
  замок = j || {held:false, mine:false, who:'', since:'', asks:''};
  показаннаяПросьба='';
  clearInterval(таймерЗамка); таймерЗамка=null;
  render();
  status('Вы вышли из месяца — теперь его может занять другой','ok');
}

async function попроситьОсвободить(){
  status('Отправляю просьбу…','busy');
  const j=await замокДействие('ask');
  if(!j){ status('Не получилось отправить','bad'); return; }
  замок=j;
  status(`${замок.who} увидит просьбу освободить месяц`,'ok');
  render();
}

/* Полоса вверху страницы: кто держит месяц и что можно сделать. */
function полосаЗамка(){
  if(!замок.held || замок.mine){
    if(замок.mine && замок.asks){
      return `<div class="panel" style="border-color:#E8B04B"><div class="body">
        <div class="field"><span><b>${esc(замок.asks)} просит освободить ${esc(периодТекст(S.period))}</b>
          <small>Сохраните правки и выйдите из месяца — человек ждёт</small></span>
          <button class="btn" id="lockFree">Сохранить и выйти из месяца</button></div>
      </div></div>`;
    }
    return '';
  }
  return `<div class="panel" style="border-color:#E0457B"><div class="body">
    <div class="field"><span><b>Только просмотр</b>
      <small>${esc(периодТекст(S.period))} по филиалу «${esc(S.branch)}» сейчас редактирует
      ${esc(замок.who)}${замок.since?', был здесь '+когдаБыл(замок.since):''}.
      Правки заблокированы, чтобы вы не затёрли работу друг друга.
      Смотреть, выгружать в Excel и печатать листки можно.</small></span>
      <button class="btn ghost" id="lockAsk">Попросить освободить</button></div>
  </div></div>`;
}

/* ---- проводка месяца ----
   Закрытый месяц нельзя править случайно: поля становятся серыми, а чтобы
   вернуться к правкам, нужно снять проводку и подтвердить это вслух.
   Разблокировка живёт только до перезагрузки страницы. */
let разблокировано=false;

function закрыто(){ return !!(S.проведён && !разблокировано); }

function провестиМесяц(){
  const t=totals();
  if(t.issues && !confirm(`В расчёте ${t.issues} строк с ошибками.\n\nВсё равно провести месяц?`)) return;
  if(!confirm(`Провести ${периодТекст(S.period)} по филиалу «${S.branch}»?\n\n`
    +`Фонд оплаты труда: ${rub(t.accrued)} ₽\nК выдаче: ${rub(t.paid)} ₽\n\n`
    +`После проводки поля закроются от правок. Снять проводку можно будет там же.`)) return;
  S.проведён={когда:new Date().toISOString(), кто:auth.login||''};
  разблокировано=false;
  save(); render();
  status('Месяц проведён. Не забудьте сохранить изменения','warn');
}

function снятьПроводку(){
  if(!confirm(`Снять проводку с ${периодТекст(S.period)}?\n\n`
    +`Месяц снова откроется для правок. Отметка о проводке будет снята.`)) return;
  S.проведён=null; разблокировано=true;
  save(); render();
  status('Проводка снята — месяц открыт для правок','warn');
}

function плашкаПроводки(){
  if(!S.проведён){
    return `<div class="panel"><div class="body">
      <div class="actions"><button class="btn" id="doClose">Провести месяц</button>
      <span class="hint" style="margin-left:10px">Закрывает период от случайных правок</span></div>
    </div></div>`;
  }
  const д=new Date(S.проведён.когда);
  return `<div class="panel"><div class="body">
    <div class="field"><span>Месяц проведён<small>${esc(S.проведён.кто||'')} · ${д.toLocaleString('ru-RU')}</small></span>
      <span class="pill ok">закрыт</span></div>
    <div class="actions" style="margin-top:10px">
      <button class="btn ghost" id="doOpen">Снять проводку и править</button>
    </div>
  </div></div>`;
}

function перекрытьПоля(){
  if(!закрыто() && !толькоСмотрим()) return;
  document.querySelectorAll('#page input, #page select, #page textarea').forEach(el=>{
    if(el.id==='newPeriod'||el.id==='cfgUrl'||el.id==='pwdOld'||el.id==='pwdNew') return;
    if(el.type==='checkbox') return;
    el.disabled=true; el.style.background='#F4F1F6';
  });
}

/* Кнопки и действия, которые меняют данные: в закрытом месяце глушим. */
const МЕНЯЮЩИЕ_КНОПКИ=new Set(['addPerson','confirmOrphans','addMaster','addStaff','addRole','addTier',
  'addBonus','tabelToVed','tabelToVedHours','tabelToVedRev','tabelLoad','spreadRefs',
  'doRoll','doRollNo','btnLoad']);
const МЕНЯЮЩИЕ_ПРИЗНАКИ=['del','rdel','bdel','tierDel','tabDel'];

function правкаЗапрещена(target){
  if(толькоСмотрим()){
    const меняет = МЕНЯЮЩИЕ_КНОПКИ.has(target.id)
      || МЕНЯЮЩИЕ_ПРИЗНАКИ.some(k=>target.dataset && target.dataset[k]!==undefined);
    if(меняет){ status('Месяц занят: '+замок.who+'. Правки заблокированы','warn'); return true; }
    return false;
  }
  if(!закрыто()) return false;
  const меняет = МЕНЯЮЩИЕ_КНОПКИ.has(target.id)
    || МЕНЯЮЩИЕ_ПРИЗНАКИ.some(k=>target.dataset && target.dataset[k]!==undefined);
  if(!меняет) return false;
  status('Месяц проведён. Чтобы править, снимите проводку на вкладке «Свод»','warn');
  return true;
}

/* ---- какие филиалы и периоды вообще есть ---- */
function известныеКлючи(){
  const set=new Set(localKeys());
  (cloudList||[]).forEach(k=>set.add(k.key));
  set.add(keyOf(S));
  // «филиал|картотека» — не месяц: в выпадающие списки и разноску не берём
  return [...set].filter(k=>k && String(k).split('|').pop()!=='картотека');
}
function филиалы(){
  const s=new Set(известныеКлючи().map(k=>String(k).split('|')[0]).filter(Boolean));
  if(S.branch) s.add(S.branch);
  return [...s].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
}
function периоды(br){
  const s=new Set(известныеКлючи()
    .filter(k=>String(k).split('|')[0]===br)
    .map(k=>String(k).split('|').pop()));
  if(S.period) s.add(S.period);
  return [...s].filter(Boolean).sort().reverse();
}
const МЕС=['январь','февраль','март','апрель','май','июнь',
           'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
function периодТекст(p){
  const [y,m]=String(p).split('-');
  return МЕС[+m-1] ? (МЕС[+m-1] + ' ' + y) : p;
}

/* ---- единый справочник на все филиалы и месяцы ----
   Справочник лежит внутри снимка каждого месяца — так в мае остаются майские
   проценты, даже если в июле их подняли. Обратная сторона: правка в одном
   месяце не долетает до остальных, они узнают о ней только при создании
   (новый месяц и новый филиал наследуют справочник от текущего).
   Эта кнопка разносит справочник открытого месяца по всем остальным. */
const ПОЛЯ_СПРАВОЧНИКА = ['params','roles','matrix','tiers','bonuses'];
const копия = o => JSON.parse(JSON.stringify(o));

function справочникИз(x){
  const o={}; ПОЛЯ_СПРАВОЧНИКА.forEach(k=>{ o[k]=копия(x[k] ?? null); }); return o;
}

/* Накладываем справочник на чужой снимок. Должности, которых в справочнике нет,
   но по которым здесь числятся люди, оставляем: иначе у сотрудника пропадёт
   строка в матрице и начисление молча обнулится. */
function наложитьСправочник(целевое, спр){
  const N=копия(целевое);
  ПОЛЯ_СПРАВОЧНИКА.forEach(k=>{ N[k]=копия(спр[k]); });
  const лишние=new Set();
  (N.people||[]).forEach(p=>{
    if(!p.post || N.roles.some(r=>r.name===p.post)) return;
    const было=(целевое.roles||[]).find(r=>r.name===p.post);
    N.roles.push(было ? копия(было) : {name:p.post, процент:false, категории:[]});
    лишние.add(p.post);
  });
  N.v=0;
  return {состояние: миграция(N), лишние:[...лишние]};
}

async function разнестиСправочник(){
  const спр=справочникИз(S);
  const свой=keyOf(S);
  if(cfg.url && auth.session){
    status('Смотрю, какие месяцы есть в облаке…','busy');
    try{ const j=await cloudGet({action:'list'}); cloudList=j.keys; }catch(e){}
  }
  const ключи=известныеКлючи().filter(k=>k && k!==свой);
  if(!ключи.length){ status('Кроме открытого месяца ничего нет','warn'); return; }
  if(!confirm(`Справочник из «${S.branch} · ${периодТекст(S.period)}» будет записан`
    +` в ${ключи.length} других месяцев и филиалов.\n\nЗаменятся параметры расчёта,`
    +` должности, ступени, матрица процентов и правила мотивации.`
    +` Люди, смены и выручка останутся как есть.\n\nОтменить это будет нельзя.`)) return;

  const готово=[], лишниеВезде=new Set(); let ошибок=0, нечего=0;
  for(let i=0;i<ключи.length;i++){
    const key=ключи[i];
    status(`Разношу справочник: ${i+1} из ${ключи.length} · ${key}`,'busy');
    let data=LS.get('ved:d:'+key);
    if(!data && cfg.url && auth.session){
      try{ const j=await cloudGet({action:'load',key}); data=j.state; }
      catch(e){ ошибок++; continue; }
    }
    if(!data){ нечего++; continue; }
    const r=наложитьСправочник(миграция(data), спр);
    r.лишние.forEach(x=>лишниеВезде.add(x));
    LS.set('ved:d:'+key, r.состояние);
    if(cfg.url && auth.session){
      const прежнее=S; let табл;
      try{ S=r.состояние; табл=flatTable(); } finally { S=прежнее; }
      try{ await api('save',{key, state:r.состояние, table:табл}); }
      catch(e){ ошибок++; continue; }
    }
    готово.push(key);
  }
  render();
  let м=`Справочник разнесён: ${готово.length} из ${ключи.length}`;
  if(нечего) м+=` · пустых ${нечего}`;
  if(ошибок) м+=` · не сохранилось ${ошибок}`;
  status(м, ошибок?'warn':'ok');
  if(лишниеВезде.size) alert('Готово: '+готово.length+'.\n\nВ некоторых месяцах нашлись должности,'
    +' которых нет в общем справочнике. Их оставили на месте, чтобы не обнулить людям начисление:\n\n'
    +[...лишниеВезде].join('\n')+'\n\nПроверьте их на вкладке «Справочники».');
}

/* Новый филиал: настройки расчёта переносим, людей и цифры — нет */
function новыйФилиал(name){
  const N=JSON.parse(JSON.stringify(S));
  N.branch=name; N.people=[]; N.masters=[]; N.staff=[];
  S=N; render(); занятьМесяц();
  status('Создан филиал «'+name+'». Заполните картотеку.','ok');
}

async function открытьФилиал(br){
  if(!br || br===S.branch){ render(); return; }
  if(!await можноУходить('открыть другой филиал')){ render(); return; }
  if(замок.mine) await замокДействие('free');
  const key=br+'|'+S.period;
  status('Открываю филиал…','busy');
  const рез=await загрузитьРасчёт(key);
  if(рез.denied){ status('Нет доступа к филиалу «'+br+'»','bad'); render(); return; }
  if(рез.офлайн) status('Облако недоступно, показываю локальную копию: '+рез.ошибка,'warn');
  if(рез.data){ S=await подтянутьКартотеку(миграция(рез.data));
             последняяВыгрузка=JSON.stringify(S); render();
             if(!рез.офлайн) status('Открыт филиал «'+br+'»','ok'); занятьМесяц(); return; }
  if(confirm(`У филиала «${br}» нет расчёта за ${периодТекст(S.period)}.\n\nСоздать? Настройки расчёта перенесутся, картотека будет пустой.`)){
    новыйФилиал(br);
  } else render();
}

/* ---- открыть другой месяц ---- */
async function openPeriod(p){
  if(p===S.period) return;
  if(!await можноУходить('открыть другой месяц')){ render(); return; }
  if(замок.mine) await замокДействие('free');
  const key=S.branch+'|'+p;
  status('Открываю месяц…','busy');
  const рез=await загрузитьРасчёт(key);
  if(рез.denied){ status('Нет доступа к этому филиалу','bad'); render(); return; }
  if(рез.офлайн) status('Облако недоступно, показываю локальную копию: '+рез.ошибка,'warn');
  if(рез.data){ S=await подтянутьКартотеку(миграция(рез.data));
             последняяВыгрузка=JSON.stringify(S); render();
             if(!рез.офлайн) status('Открыт период '+p,'ok'); занятьМесяц(); return; }

  const carry = confirm(
    `За ${p} расчёта ещё нет.\n\nПеренести список сотрудников и остатки с прошлого месяца?\n\n` +
    `ОК — перенести сотрудников и остатки\nОтмена — перенести только сотрудников, остатки обнулить`);
  rollover(p, carry);
}

/* ---- новый месяц: люди и справочники остаются, факт обнуляется ---- */
function rollover(period, withCarry){
  const t=totals();
  const restM={}, restS={};
  S.masters.forEach((r,i)=>{ if(t.M[i]) restM[r.empId]=t.M[i].rest; });
  S.staff.forEach((r,i)=>{ if(t.T[i]) restS[r.empId]=t.T[i].rest; });
  const N=JSON.parse(JSON.stringify(S));
  N.period=period;
  N.tabel={};          // табель — факт конкретного месяца, в новый не переносится
  // уволенных в новый месяц не тянем
  const жив=id=>работает(person(id));
  N.masters=S.masters.filter(r=>жив(r.empId)).map(r=>({empId:r.empId,shifts:0,hours:0,revS:0,revG:0,corr:0,vac:0,
    extra:0,redo:0,inv:0,carry:withCarry?(restM[r.empId]||0):0,av:пустыеАвансы(),avk:пустаяКасса()}));
  N.staff=S.staff.filter(r=>жив(r.empId)).map(r=>({empId:r.empId,shifts:0,revG:0,bonus:0,bonus100:0,night:0,vac:0,
    ded:0,carry:withCarry?(restS[r.empId]||0):0,av:пустыеАвансы(),avk:пустаяКасса()}));
  S=N; render(); занятьМесяц();
  status(`Открыт ${period}: ${S.masters.length+S.staff.length} сотрудников перенесено`,'ok');
}

/* ====================== 3. ОТРИСОВКА ====================== */
const $ = s => document.querySelector(s);
let tab='masters';

const TITLES={masters:'Расчёты',staff:'Персонал',people:'Картотека сотрудников',
              refs:'Справочники и параметры',summary:'Свод по фонду оплаты труда',
              sync:'Синхронизация и хранение',access:'Доступ к ведомости',
              motiv:'Конструктор мотивации',help:'Инструкция и термины',
              tabel:'Табель учёта рабочего времени'};

function render(){
  S=миграция(S);
  const t=totals();
  $('#title').textContent=TITLES[tab];
  $('#brandBranch').textContent=S.branch||'—';
  const бр=филиалы();
  $('#branch').innerHTML = бр.map(b=>`<option${b===S.branch?' selected':''}>${esc(b)}</option>`).join('')
    + `<option value="__новый">＋ новый филиал…</option>`;
  const пер=периоды(S.branch);
  $('#period').innerHTML = пер.map(p=>`<option value="${esc(p)}"${p===S.period?' selected':''}>${периодТекст(p)}</option>`).join('')
    + `<option value="__новый">＋ следующий месяц…</option>`;
  $('#tagM').textContent=S.masters.length;
  $('#tagS').textContent=S.staff.length;
  $('#tagP').textContent=S.people.length;
  $('#tagB').textContent=(S.bonuses||[]).filter(b=>b.активно!==false).length||'';
  $('#tagT').textContent=Object.keys(S.tabel||{}).filter(id=>табельЗаполнен(id)).length||'';
  $('#strip').innerHTML=strip(t);
  $('#tagC').textContent=localKeys().length||'';
  $('#page').innerHTML=полосаЗамка()+({masters:viewMasters,staff:viewStaff,people:viewPeople,
                         refs:viewRefs,summary:viewSummary,sync:viewSync,
                         access:viewAccess,motiv:viewMotiv,help:viewHelp,
                         tabel:viewTabel}[tab])(t);
  $('#slips').innerHTML=slips(t);
  перекрытьПоля();
  save();
}

function strip(t){
  const cards=[
    ['Выручка за период', rub(t.rev)+' ₽', 'услуги '+rub(t.revS)+' · товары '+rub(t.revG)],
    ['ФОТ начислено', rub(t.accrued)+' ₽', t.heads+' чел. в расчёте'],
    ['Доля ФОТ в выручке', (t.rev?Math.round(t.share*1000)/10:0)+'%', 'к личной выручке'],
    ['К выдаче', rub(t.paid)+' ₽', 'остаток '+rub(t.rest)+' ₽'],
    ['Контроль', t.issues?t.issues+' ошиб.':'чисто',
      t.guar?t.guar+' на гарантии по часам':'гарантия не сработала']
  ];
  return cards.map(c=>`<div class="kpi"><div class="k">${c[0]}</div>
    <div class="v num">${c[1]}</div><div class="s">${c[2]}</div></div>`).join('');
}

/* ---- Мастера ---- */
function viewMasters(t){
  const free = S.people.filter(p=>процентная(p.post) && работает(p)
    && !S.masters.some(m=>m.empId===p.id));
  const opts = id => S.people.filter(p=>процентная(p.post) && (работает(p)||p.id===id))
    .map(p=>`<option value="${p.id}"${p.id===id?' selected':''}>${esc(p.fio)}</option>`).join('');

  const rows=S.masters.map((r,i)=>{
    const c=calcMaster(r); if(!c) return '';
    const mx=Math.max(c.accS,c.accH,1);
    const gauge=`<span class="gauge${c.flag==='warn'?' guar':''}" title="по проценту ${rub(c.accS)} ₽ · по часам ${rub(c.accH)} ₽">
      <span class="track"><span class="fill" style="width:${Math.round(c.accS/mx*100)}%"></span>
      <span class="mark" style="left:calc(${Math.round(c.accH/mx*100)}% - 1px)"></span></span></span>`;
    return `<tr data-i="${i}">
      <td class="l fix"><select data-f="empId" style="width:190px">${opts(r.empId)}</select></td>
      <td class="l calc">${esc(c.p.status)}</td>
      <td class="calc num">${pctTxt(c.pctS)}</td>
      ${['shifts','hours','revS','revG','corr'].map(f=>
        `<td><input data-f="${f}" class="num" value="${r[f]||''}" placeholder="0"></td>`).join('')}
      <td class="calc num">${rub(c.accS)}</td>
      <td class="calc num">${rub(c.accH)}</td>
      <td class="l">${gauge}</td>
      <td class="calc num">${rub(c.base)}</td>
      <td class="calc num">${rub(c.accG)}</td>
      ${['vac','extra','redo','inv','carry'].map(f=>
        `<td><input data-f="${f}" class="num" value="${r[f]||''}" placeholder="0"></td>`).join('')}
      <td class="calc num">${rub(c.accrued)}</td>
      ${ячейкиАвансов(r)}
      <td class="pay num">${rub(c.total)}</td>
      <td class="pay num">${rub(c.paid)}</td>
      <td class="calc num">${rub(c.rest)}</td>
      <td class="l"><span class="pill ${c.flag}">${c.note}</span></td>
      <td class="l"><button class="btn ghost sm" data-slip="${c.p.id}">Листок</button> <button class="btn ghost sm" data-del="${i}">Убрать</button></td>
    </tr>`;
  }).join('');

  const sum=f=>S.masters.map(calcMaster).filter(Boolean).reduce((s,x)=>s+x[f],0);
  const sumIn=f=>S.masters.reduce((s,r)=>s+n(r[f]),0);

  return `
  <div class="panel">
    <header>
      <h3>Расчёт по мастерам</h3>
      <p>Полоса в колонке «База» показывает, что победило: процент от услуг или гарантия по часам.</p>
      <span class="tiers-inline">Пороги месяца:
        ${(S.tiers||[]).map((t,k)=>`<input data-tier-from="${k}" class="num" style="width:88px"
           value="${t.from||''}" placeholder="0" title="Ступень ${k+1}">`).join('<span class="calc"> · </span>')}
        <span class="calc">₽ по услугам</span>
      </span>
      <div class="actions noprint">
        <button class="btn" id="addMaster"${free.length&&S.masters.length<MAX_MASTERS?'':' disabled style="opacity:.4;cursor:not-allowed"'}>
          Добавить мастера</button>
      </div>
    </header>
    ${S.masters.length?`<div class="scroll"><table>
      <thead><tr>
        <th class="l fix">Мастер</th><th class="l">Статус</th><th>%</th>
        <th>Смен</th><th>Часов</th><th>Услуги ₽</th><th>Товары ₽</th><th>Коррект. ₽</th>
        <th>По %, ₽</th><th>По часам ₽</th><th class="l">База</th><th>База ₽</th><th>С товаров ₽</th>
        <th>Отпуск ₽</th><th>Доплаты ₽</th><th>Переделки ₽</th><th>Инвент. ₽</th><th>Перенос ₽</th>
        <th>Начислено ₽</th>${заголовкиАвансов().map(h=>`<th>${h}</th>`).join('')}
        <th>К выплате ₽</th><th>Выдано ₽</th><th>Остаток ₽</th><th class="l">Контроль</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td class="l fix">Итого · ${S.masters.length} чел.</td><td></td><td></td>
        <td class="num">${sumIn('shifts')}</td><td class="num">${sumIn('hours')}</td>
        <td class="num">${rub(sumIn('revS'))}</td><td class="num">${rub(sumIn('revG'))}</td><td></td>
        <td class="num">${rub(sum('accS'))}</td><td class="num">${rub(sum('accH'))}</td><td></td>
        <td class="num">${rub(sum('base'))}</td><td class="num">${rub(sum('accG'))}</td>
        <td class="num">${rub(sumIn('vac'))}</td><td class="num">${rub(sumIn('extra'))}</td>
        <td class="num">${rub(sumIn('redo'))}</td><td class="num">${rub(sumIn('inv'))}</td>
        <td class="num">${rub(sumIn('carry'))}</td><td class="num">${rub(sum('accrued'))}</td>
        ${итогиАвансов(S.masters)}
        <td class="num">${rub(sum('total'))}</td><td class="num">${rub(sum('paid'))}</td>
        <td class="num">${rub(sum('rest'))}</td><td></td><td></td>
      </tr></tfoot></table></div>`
    :`<div class="empty"><b>В расчёте пока никого нет</b>
      Добавьте мастера — фамилии берутся из картотеки.</div>`}
  </div>`;
}

/* ---- Персонал ---- */
function viewStaff(){
  const opts = id => S.people.filter(p=>!процентная(p.post) && (работает(p)||p.id===id))
    .map(p=>`<option value="${p.id}"${p.id===id?' selected':''}>${esc(p.fio)}</option>`).join('');
  const free = S.people.filter(p=>!процентная(p.post) && работает(p)
    && !S.staff.some(m=>m.empId===p.id));
  const rows=S.staff.map((r,i)=>{
    const c=calcStaff(r); if(!c) return '';
    return `<tr data-i="${i}">
      <td class="l fix"><select data-f="empId" style="width:190px">${opts(r.empId)}</select></td>
      <td class="l calc">${esc(c.p.post)}</td>
      <td class="l calc">${c.оклад
        ? rub(n(c.p.monthSalary))+' ₽ оклад · норма '+c.норма+' см'
        : rub(c.shiftRate)+' ₽ за смену'}</td>
      <td><input data-f="shifts" class="num" value="${r.shifts||''}" placeholder="0"></td>
      <td class="calc num">${rub(c.byRate)}</td>
      <td><input data-f="revG" class="num" value="${r.revG||''}" placeholder="0"></td>
      <td class="calc num">${pctTxt(c.pctG)}</td>
      <td class="calc num">${rub(c.accG)}</td>
      ${['bonus','bonus100','night','vac','ded','carry'].map(f=>
        `<td><input data-f="${f}" class="num" value="${r[f]||''}" placeholder="0"></td>`).join('')}
      <td class="calc num">${rub(c.accrued)}</td>
      ${ячейкиАвансов(r)}
      <td class="pay num">${rub(c.total)}</td>
      <td class="pay num">${rub(c.paid)}</td>
      <td class="calc num">${rub(c.rest)}</td>
      <td class="l"><span class="pill ${c.flag}">${c.note}</span></td>
      <td class="l"><button class="btn ghost sm" data-slip="${c.p.id}">Листок</button> <button class="btn ghost sm" data-del="${i}">Убрать</button></td>
    </tr>`;
  }).join('');
  return `
  <div class="panel">
    <header><h3>Менеджеры и уборщики</h3>
      <p>Оплата считается от ставки за смену — ставка хранится в картотеке сотрудника.</p>
      <div class="actions noprint"><button class="btn" id="addStaff"${free.length?'':' disabled style="opacity:.4;cursor:not-allowed"'}>Добавить сотрудника</button></div>
    </header>
    ${S.staff.length?`<div class="scroll"><table>
      <thead><tr>
        <th class="l fix">Сотрудник</th><th class="l">Должность</th><th class="l">Ставка или оклад</th><th>Смен</th>
        <th>По ставке ₽</th><th>Товары ₽</th><th>%</th><th>С товаров ₽</th>
        <th>Бонус ₽</th><th>Бонус 100% ₽</th><th>Ночные ₽</th><th>Отпуск ₽</th><th>Удержания ₽</th>
        <th>Перенос ₽</th><th>Начислено ₽</th>${заголовкиАвансов().map(h=>`<th>${h}</th>`).join('')}
        <th>К выплате ₽</th><th>Выдано ₽</th><th>Остаток ₽</th><th class="l">Контроль</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`
    :`<div class="empty"><b>Список пуст</b>Добавьте менеджера или уборщика из картотеки.</div>`}
  </div>`;
}

/* ---- Картотека ---- */
let показыватьУволенных=false;

function viewPeople(){
  const уволено=S.people.filter(p=>!работает(p)).length;
  const сирот=S.people.filter(p=>p.orphan).length;
  const видимые=S.people
    .map((p,i)=>({p,i}))
    .filter(x=>показыватьУволенных || работает(x.p));
  const rows=видимые.map(({p,i})=>{
    const r=rate(p.post,p.status);
    const needRate=!процентная(p.post);
    return `<tr data-i="${i}"${работает(p)?'':' style="opacity:.55"'}>
      <td class="l fix"><input data-f="fio" class="wide" value="${esc(p.fio)}"></td>
      <td class="l"><select data-f="post">${должности().map(o=>`<option${o===p.post?' selected':''}>${esc(o)}</option>`).join('')}</select></td>
      <td class="l">${категории(p.post).length
        ? `<select data-f="status">${категории(p.post).map(o=>`<option${o===p.status?' selected':''}>${esc(o)}</option>`).join('')}</select>`
        : '<span class="zero">без категорий</span>'}</td>
      <td class="l"><select data-f="form"><option${p.form==='НО'?' selected':''}>НО</option><option${p.form==='Оформлен'?' selected':''}>Оформлен</option></select></td>
      <td class="l">${needRate?`<select data-f="payType">
          <option value="смена"${p.payType!=='оклад'?' selected':''}>за смену</option>
          <option value="оклад"${p.payType==='оклад'?' selected':''}>оклад за месяц</option>
        </select>`:'<span class="zero">—</span>'}</td>
      <td>${needRate&&p.payType!=='оклад'?`<input data-f="shiftRate" class="num" value="${p.shiftRate||''}" placeholder="0">`:'<span class="zero">—</span>'}</td>
      <td>${needRate&&p.payType==='оклад'?`<input data-f="monthSalary" class="num" value="${p.monthSalary||''}" placeholder="0">`:'<span class="zero">—</span>'}</td>
      <td class="calc num">${процентная(p.post)?(r.pctT||[]).map(v=>v==null?'—':Math.round(v*1000)/10+'%').join(' / '):'—'}</td>
      <td class="calc num">${pctTxt(r.pctG)}</td>
      <td>${p.form==='Оформлен'
        ? `<input data-f="mrot" class="num" value="${p.mrot||''}" placeholder="0">`
        : '<span class="zero">—</span>'}</td>
      <td class="l">${p.orphan?'<span class="pill warn">не в картотеке</span> ':''}<select data-f="уволен">
        <option value="работает"${работает(p)?' selected':''}>работает</option>
        <option value="уволен"${работает(p)?'':' selected'}>уволен</option></select></td>
      <td class="l"><input data-f="note" class="wide" value="${esc(p.note||'')}"></td>
      <td class="l"><button class="btn ghost sm" data-del="${i}">Удалить</button></td>
    </tr>`;
  }).join('');
  return `
  <div class="panel">
    <header><h3>Картотека</h3><p>Одна на филиал и общая для всех месяцев: заново заполнять её каждый период не нужно. Процент подтягивается из матрицы по паре «должность + категория». Колонка «Оплата» переключает сотрудника между ставкой за смену и окладом за месяц.</p>
      <div class="actions noprint">
        <label class="calc" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="showFired"${показыватьУволенных?' checked':''}>
          показывать уволенных${уволено?' ('+уволено+')':''}</label>
        ${сирот?`<button class="btn ghost" id="confirmOrphans">Подтвердить (${сирот})</button>`:''}
        <button class="btn" id="addPerson">Добавить сотрудника</button></div>
      ${сирот?`<p class="hint warn">${сирот} ${сирот===1?'сотрудник найден':'сотрудников найдено'} в табеле этого месяца, но отсутству${сирот===1?'ет':'ют'} в общей картотеке — проверьте данные и нажмите «Подтвердить», чтобы добавить их в картотеку насовсем.</p>`:''}
    </header>
    <div class="scroll"><table><thead><tr>
      <th class="l fix">ФИО</th><th class="l">Должность</th><th class="l">Статус</th><th class="l">Оформление</th>
      <th class="l">Оплата</th><th>Ставка/смена ₽</th><th>Оклад/месяц ₽</th>
      <th>% услуг</th><th>% товаров</th><th>МРОТ ₽</th><th class="l">Состояние</th>
      <th class="l">Комментарий</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div class="body"><p class="hint">Уволенного не удаляйте: поставьте ему «уволен».
    Он исчезнет из списков на вкладках «Расчёты» и «Персонал», но останется в расчётах
    прошлых месяцев — там сохранятся и фамилия, и проценты. Удаление стирает человека
    из картотеки во всех периодах сразу.</p></div>
  </div>`;
}

/* ---- Справочники ---- */
function viewRefs(){
  const P=S.params;
  const f=(k,label,hint,suffix)=>`<div class="field"><span>${label}<small>${hint}</small></span>
    <input data-p="${k}" class="num" value="${P[k]}"><span style="width:24px;color:var(--muted)">${suffix}</span></div>`;
  const T=S.tiers||[{from:0}];
  const пусто=m=>процентная(m.post) && (m.pctT||[]).every(v=>v===null||v===undefined);
  const mrows=S.matrix.map((m,i)=>`<tr data-i="${i}">
    <td class="l fix">${esc(m.post)}</td><td class="l">${esc(m.status)}</td>
    ${T.map((_,k)=>`<td><input data-m="t${k}" class="num" value="${(m.pctT&&m.pctT[k]!=null)?Math.round(m.pctT[k]*1000)/10:''}" placeholder="—"></td>`).join('')}
    <td><input data-m="pctG" class="num" value="${m.pctG===null?'':Math.round(m.pctG*1000)/10}" placeholder="—"></td>
    <td><input data-m="hour" class="num" value="${m.hour===null?'':m.hour}" placeholder="—"></td>
    <td class="l">${пусто(m)?'<span class="pill warn">не заполнено</span>':'<span class="pill ok">готово</span>'}</td>
  </tr>`).join('');
  const trows=T.map((t,k)=>`<tr data-tier="${k}">
    <td class="l">Ступень ${k+1}</td>
    <td><input data-tier-from="${k}" class="num" value="${t.from||''}" placeholder="0"></td>
    <td class="l calc">${k<T.length-1?('до '+rub(n(T[k+1].from)-1)+' ₽'):'и выше'}</td>
    <td>${T.length>1?`<button class="btn ghost sm" data-tier-del="${k}">Убрать</button>`:''}</td>
  </tr>`).join('');
  return `
  <div class="grid2">
    <div class="panel"><header><h3>Параметры расчёта</h3></header><div class="body">
      ${f('hour','Ставка за час','Гарантийный минимум мастера','₽')}
      ${f('step','Шаг округления выдачи','Сумма к выдаче округляется вниз','₽')}
      ${f('plan','План смен на мастера','Норма месяца','см')}
      ${f('нормаСмен','Норма смен для оклада','Оклад делится на неё и умножается на факт','см')}
      ${f('авансов','Сколько авансов','Колонки «Аванс 1», «Аванс 2» и далее, от 1 до 8','шт')}
      ${f('авансовКасса','Из них выдано из кассы','Добавляет отдельные колонки «Аванс 1 (касса)» и далее. 0 — не показывать','шт')}
      ${f('ndflOf','НДФЛ — «Оформлен»','Доля, например 0.13','')}
      ${f('ndflNO','НДФЛ — «НО»','Обычно 0','')}
      ${f('ндс','НДС с выручки','В процентах: 20 — это 20%','%')}
      ${f('усн','УСН с выручки','В процентах: 6 — это 6%','%')}
    </div></div>
    <div class="panel"><header><h3>Откуда взяты цифры</h3></header><div class="body">
      <p class="hint">Значения восстановлены из вашего файла за 06.26 обратным счётом:<br>
      40% = 20 506 / 51 267 · 10% = 420 / 4 200 · 181 ₽/ч = 8 326 / 46 ч<br>
      округление до 50 ₽ = 14 571 → 14 550 · начисления округляются вниз до рубля.</p>
      <p class="hint">Проценты по остальным статусам пока не заданы — заполните матрицу справа снизу,
      иначе мастер с этим статусом получит нулевое начисление и строка подсветится красным.</p>
    </div></div>
  </div>
  <div class="panel">
    <header><h3>Должности и категории</h3>
      <p>Список сотрудников строится по этому справочнику</p>
      <div class="actions noprint"><button class="btn ghost" id="addRole">Добавить должность</button></div>
    </header>
    <div class="body">
      <p class="hint">Категории перечисляйте через запятую. Оставьте поле пустым, если у должности
      категорий нет — так сделано у уборщицы. Галочка «процент от выручки» разделяет два типа расчёта:
      с ней сотрудник попадает на вкладку «Расчёты» и считается по проценту или гарантии по часам,
      без неё — на вкладку «Персонал» и считается по ставке за смену либо по окладу.</p>
      <div class="scroll"><table><thead><tr>
        <th class="l fix">Должность</th><th class="l">Категории через запятую</th>
        <th class="l">Расчёт</th><th class="l">Людей</th><th></th>
      </tr></thead><tbody>${(S.roles||[]).map((r,i)=>{
        const занято=S.people.filter(p=>p.post===r.name).length;
        return `<tr data-r="${i}">
          <td class="l fix"><input data-rf="name" class="wide" value="${esc(r.name)}"></td>
          <td class="l"><input data-rf="категории" class="wide" style="width:280px"
              value="${esc((r.категории||[]).join(', '))}" placeholder="без категорий"></td>
          <td class="l"><select data-rf="процент">
            <option value="да"${r.процент?' selected':''}>процент от выручки</option>
            <option value="нет"${!r.процент?' selected':''}>ставка или оклад</option></select></td>
          <td class="l calc">${занято||'—'}</td>
          <td>${занято?'<span class="calc">занята</span>':`<button class="btn ghost sm" data-rdel="${i}">Удалить</button>`}</td>
        </tr>`;}).join('')}</tbody></table></div>
    </div>
  </div>

  <div class="panel">
    <header><h3>Ступени выручки</h3>
      <p>Процент мастера растёт, когда его выручка по услугам переходит порог</p>
      <div class="actions noprint"><button class="btn ghost" id="addTier">Добавить ступень</button></div>
    </header>
    <div class="body">
      <p class="hint">Порог — это выручка мастера по услугам за месяц. Ступень с порогом 0 работает
      с первого рубля. Пример: пороги 0 и 150 000 дают две колонки в матрице — «до 150 000» и «от 150 000».</p>
      <div class="scroll"><table><thead><tr>
        <th class="l">Ступень</th><th>Выручка от, ₽</th><th class="l">Диапазон</th><th></th>
      </tr></thead><tbody>${trows}</tbody></table></div>
    </div>
  </div>

  <div class="panel">
    <header><h3>Матрица: должность × статус × ступень</h3>
      <p>Проценты вводятся в процентах: 40 — это 40%</p></header>
    <div class="scroll"><table><thead><tr>
      <th class="l fix">Должность</th><th class="l">Статус</th>
      ${T.map((t,k)=>`<th>% услуг<br><span style="font-weight:400;text-transform:none">${k===0?'от 0':'от '+rub(t.from)} ₽</span></th>`).join('')}
      <th>% от товаров</th><th>Ставка за час ₽</th><th class="l">Состояние</th>
    </tr></thead><tbody>${mrows}</tbody></table></div>
  </div>

  <div class="panel">
    <header><h3>Единый справочник</h3>
      <p>Разнести настройки этого месяца по всем филиалам и периодам</p></header>
    <div class="body">
      <p class="hint">Справочник хранится внутри каждого месяца: в мае остаются майские проценты,
      даже если в июле их подняли. Новый месяц и новый филиал наследуют справочник от того,
      что открыт сейчас, — но уже созданные месяцы о правке не узнают.
      Кнопка ниже записывает справочник открытого месяца во все остальные:
      параметры расчёта, должности, ступени, матрицу процентов и правила мотивации.
      Люди, смены и выручка не трогаются.</p>
      <div class="actions noprint">
        <button class="btn" id="spreadRefs">Применить ко всем филиалам и месяцам</button>
      </div>
    </div>
  </div>`;
}

/* ---- Свод ---- */
function viewSummary(t){
  const проводка=плашкаПроводки();
  const byPost=должности().map(p=>{
    const m=t.M.filter(x=>x.p.post===p), s=t.T.filter(x=>x.p.post===p);
    const acc=[...m,...s].reduce((a,x)=>a+x.accrued,0);
    return {p, heads:m.length+s.length, acc};
  }).filter(x=>x.heads);
  const mx=Math.max(1,...byPost.map(x=>x.acc));
  const people=[...t.M].sort((a,b)=>b.accrued-a.accrued);
  const pmx=Math.max(1,...people.map(x=>x.accrued));
  const ноль = v => (Math.round(v)||0).toLocaleString('ru-RU');
  const ндс = down(t.rev * n(S.params.ндс)/100);
  const усн = down(t.rev * n(S.params.усн)/100);
  const после = t.rev - ндс - усн;
  return `
  ${проводка}
  <div class="panel"><header><h3>Налоги с выручки</h3>
    <p>Ставки задаются на вкладке «Справочники»</p></header><div class="body">
    <div class="grid2">
      <div>
        <div class="field"><span>Выручка за период<small>услуги и товары</small></span><b class="num">${ноль(t.rev)} ₽</b></div>
        <div class="field"><span>НДС<small>${n(S.params.ндс)||0}% с выручки</small></span><b class="num">${ноль(ндс)} ₽</b></div>
        <div class="field"><span>УСН<small>${n(S.params.усн)||0}% с выручки</small></span><b class="num">${ноль(усн)} ₽</b></div>
        <div class="field"><span>Выручка после налогов</span><b class="num">${ноль(после)} ₽</b></div>
      </div>
      <div>
        <div class="field"><span>Фонд оплаты труда</span><b class="num">${ноль(t.accrued)} ₽</b></div>
        <div class="field"><span>Доля ФОТ в выручке<small>норма до 47%</small></span>
          <b class="num">${t.rev?Math.round(t.accrued/t.rev*1000)/10:0}%</b></div>
        <div class="field"><span>Доля ФОТ после налогов<small>сколько остаётся нести</small></span>
          <b class="num">${после>0?Math.round(t.accrued/после*1000)/10:0}%</b></div>
        <div class="field"><span>Осталось после ФОТ и налогов<small>до аренды и прочих расходов</small></span>
          <b class="num">${ноль(после - t.accrued)} ₽</b></div>
      </div>
    </div>
  </div></div>

  <div class="grid2">
    <div class="panel"><header><h3>Структура ФОТ по должностям</h3></header><div class="body">
      <div class="bars">${byPost.map(x=>`<div class="bar">
        <span>${esc(x.p)} <span class="calc">· ${x.heads}</span></span>
        <span class="t"><span class="f" style="width:${Math.round(x.acc/mx*100)}%"></span></span>
        <b class="num">${rub(x.acc)} ₽</b></div>`).join('')}</div>
    </div></div>
    <div class="panel"><header><h3>Проверки</h3></header><div class="body">
      <div class="field"><span>К выплате = выдано + остаток<small>сходимость расчёта</small></span>
        <span class="pill ${Math.round(t.total-t.paid-t.rest)===0?'ok':'bad'}">${Math.round(t.total-t.paid-t.rest)===0?'сходится':'расхождение'}</span></div>
      <div class="field"><span>Ошибки в строках<small>красные метки контроля</small></span>
        <span class="pill ${t.issues?'bad':'ok'}">${t.issues?t.issues+' стр.':'нет'}</span></div>
      <div class="field"><span>Мастера на гарантии по часам<small>не отработали свой процент</small></span>
        <span class="pill ${t.guar?'warn':'ok'}">${t.guar?t.guar+' чел.':'нет'}</span></div>
      <div class="field"><span>Средняя выручка мастера за смену<small>производительность</small></span>
        <b class="num">${rub(t.perShift)} ₽</b></div>
    </div></div>
  </div>
  <div class="panel"><header><h3>Начислено по мастерам</h3><p>Отсортировано по сумме начисления.</p></header>
    <div class="body"><div class="bars">${people.map(x=>`<div class="bar">
      <span>${esc(x.p.fio.split(' ').slice(0,2).join(' '))}</span>
      <span class="t"><span class="f" style="width:${Math.round(x.accrued/pmx*100)}%"></span></span>
      <b class="num">${rub(x.accrued)} ₽</b></div>`).join('')}</div></div>
  </div>`;
}

/* ---- Синхронизация ---- */
let cloudList=null;
function viewSync(){
  const here=localKeys().sort().reverse();
  const line=(k,when,where)=>`<div class="prow"><b>${esc(k.split('|').pop())}</b>
    <span class="calc">${esc(k.split('|')[0])}</span>
    <span class="when">${where}${when?' · '+when:''}</span>
    ${k===keyOf(S)?'<span class="pill ok">открыт</span>'
      :`<button class="btn ghost sm" data-open="${esc(k)}">Открыть</button>`}</div>`;
  return `
  <div class="grid2">
    <div class="panel"><header><h3>Общее хранилище</h3></header><div class="body">
      <p class="hint">Расчёт хранится в общей базе (Supabase) — открывается с любого
      устройства сразу, отдельно подключать ничего не нужно.</p>
      <div class="actions" style="margin:14px 0 0">
        <button class="btn ghost" id="cfgPing">Проверить связь</button>
        <button class="btn ghost" id="cfgPush">Отправить текущий месяц</button>
        <button class="btn ghost" id="cfgPull">Взять месяц из хранилища</button>
      </div>
      <p class="hint" style="margin-top:12px"><b>Версия страницы: ${СБОРКА}</b><br>
      Если после обновления здесь прежняя дата — браузер отдал страницу из кэша.
      Нажмите Cmd+Shift+R, а если не поможет, откройте в приватном окне.</p>
      <p class="hint">Кто и когда заходил и сохранял — в панели
      «Кто и когда работал с базой» ниже. Что лежит в каждом месяце — кнопка «Что где лежит».</p>
      <p class="hint">Память браузера: ${LS.ok?'работает':'недоступна — включите хранилище сайтов или разместите файл на хостинге'}.</p>
    </div></div>

    <div class="panel"><header><h3>Учётная запись</h3></header><div class="body">
      <div class="field"><span>Вы вошли как<small>роль: ${esc(auth.role||'—')}${auth.branches?' · филиалы: '+esc(auth.branches):' · все филиалы'}</small></span>
        <b>${esc(auth.login||'—')}</b></div>
      <div class="field" style="margin-top:10px"><span>Текущий пароль</span>
        <span class="pwrap"><input id="pwdOld" type="password" autocomplete="current-password" style="width:190px">
        <button type="button" class="eye" data-eye="pwdOld">показать</button></span></div>
      <div class="field"><span>Новый пароль<small>не короче 8 символов</small></span>
        <span class="pwrap"><input id="pwdNew" type="password" autocomplete="new-password" style="width:190px">
        <button type="button" class="eye" data-eye="pwdNew">показать</button></span></div>
      <div class="actions" style="margin:14px 0 0">
        <button class="btn" id="pwdSave">Сменить пароль</button>
        <button class="btn ghost" id="authOut">Выйти</button>
      </div>
    </div></div>

    <div class="panel"><header><h3>Новый месяц</h3></header><div class="body">
      <p class="hint">Сотрудники, статусы, проценты и параметры переносятся автоматически.
      Обнуляется только факт месяца. Остатки прошлого месяца встают в колонку «Перенос».</p>
      <div class="field"><span>Месяц, который открыть<small>текущий: ${esc(S.period)}</small></span>
        <input type="month" id="newPeriod" value="${esc(nextMonth(S.period))}"></div>
      <div class="actions" style="margin:14px 0 0">
        <button class="btn" id="doRoll">Открыть с остатками</button>
        <button class="btn ghost" id="doRollNo">Открыть без остатков</button>
      </div>
    </div></div>
  </div>

  <div class="panel"><header><h3>Кто и когда работал с базой</h3>
    <div class="actions noprint"><button class="btn ghost sm" id="showJournal">Показать журнал</button></div></header>
    <div class="body">${журналОтчёт||'<p class="hint">Нажмите «Показать журнал»: увидите последний вход каждой учётной записи и последние действия — входы и сохранения по месяцам.</p>'}</div>
  </div>

  <div class="panel"><header><h3>Сохранённые расчёты</h3>
    <div class="actions noprint">
      <button class="btn ghost sm" id="pullList">Обновить список из облака</button>
      <button class="btn ghost sm" id="audit">Что где лежит</button></div></header>
    <div class="body" id="auditOut" style="display:${аудитОтчёт?'block':'none'}">${аудитОтчёт}</div>
    <div class="body"><div class="periods">
      ${here.length?here.map(k=>line(k,'','на этом устройстве')).join(''):'<p class="hint">Пока пусто.</p>'}
      ${cloudList?cloudList.filter(x=>!here.includes(x.key)).map(x=>
        line(x.key, x.updated?new Date(x.updated).toLocaleString('ru-RU'):'', 'в облаке')).join(''):''}
    </div></div>
  </div>`;
}
function nextMonth(p){
  const [y,m]=String(p||'').split('-').map(Number);
  if(!y||!m) return '';
  const d=new Date(y, m, 1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}

/* ---- расчётные листки ---- */
function slips(t){
  const line=(a,b)=>`<tr><td class="l">${a}</td><td class="num">${rub(b)} ₽</td></tr>`;
  const head=x=>`<h4>${esc(x.p.fio)}</h4><div class="meta">${esc(x.p.post)} · ${esc(x.p.status)} ·
    ${esc(S.branch)} · ${esc(S.period)}</div>`;
  return `<h3 style="font-family:var(--display)">Расчётные листки · ${esc(S.branch)} · ${esc(S.period)}</h3>`
  + t.M.map(x=>`<div class="slip">${head(x)}<table>
      ${line('Начислено по проценту от услуг',x.accS)}
      ${line('Начислено по часам (гарантия)',x.accH)}
      ${line('Принято к расчёту (база)',x.base)}
      ${line('Начислено с продажи товаров',x.accG)}
      ${line('Начислено всего',x.accrued)}
      ${line('Авансы и удержания',x.accrued-x.total)}
      ${line('К выплате',x.total)}
      ${line('Выдано',x.paid)}
      ${line('Остаток на следующий месяц',x.rest)}
    </table></div>`).join('')
  + t.T.map(x=>`<div class="slip">${head(x)}<table>
      ${line('Оплата по ставке за смены',x.byRate)}
      ${line('Начислено с продажи товаров',x.accG)}
      ${line('Начислено всего',x.accrued)}
      ${line('Авансы и удержания',x.accrued-x.total)}
      ${line('К выплате',x.total)}
      ${line('Выдано',x.paid)}
      ${line('Остаток на следующий месяц',x.rest)}
    </table></div>`).join('');
}

const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let режимТабеля='h';   // 'h' — часы, 'r' — выручка за смену

function viewTabel(){
  const дней=днейВМесяце(S.period);
  const занятые=Object.keys(S.tabel||{});
  const люди=S.people.filter(p=>занятые.includes(p.id));
  const свободные=S.people.filter(p=>!занятые.includes(p.id));

  const шапка=`<tr><th class="l fix">Сотрудник</th>
    ${Array.from({length:дней},(_,i)=>{const d=i+1;
      return `<th class="${выходной(S.period,d)?'wknd':''}" style="min-width:54px">
        ${d}<br><span style="font-weight:400;text-transform:none">${деньНедели(S.period,d)}</span></th>`;}).join('')}
    <th>Смен</th><th>Часов</th><th>Выручка</th><th></th></tr>`;

  const строки=люди.length ? люди.map(p=>{
    const дни=(S.tabel||{})[p.id]||{};
    const it=итогТабеля(p.id);
    const ячейки=Array.from({length:дней},(_,i)=>{
      const d=String(i+1).padStart(2,'0');
      const з=дни[d]||{};
      const v=режимТабеля==='h'?з.h:з.r;
      return `<td class="${выходной(S.period,i+1)?'wknd':''}"><input data-tab-emp="${p.id}" data-tab-day="${d}"
        class="num tcell" value="${v||''}" placeholder=""></td>`;}).join('');
    return `<tr><td class="l fix">${esc(p.fio)}<br><span class="calc" style="font-size:11px">${esc(p.post)}</span></td>
      ${ячейки}
      <td class="calc num"><b>${it.смен||'—'}</b></td>
      <td class="calc num">${it.часов||'—'}</td>
      <td class="calc num">${it.выручка?rub(it.выручка):'—'}</td>
      <td><button class="btn ghost sm" data-tab-del="${p.id}">Убрать</button></td></tr>`;
  }).join('') : `<tr><td class="l" colspan="${дней+5}">Никого нет. Добавьте сотрудника из картотеки.</td></tr>`;

  const всего=люди.reduce((a,p)=>{const i=итогТабеля(p.id);
    return {смен:a.смен+i.смен, часов:a.часов+i.часов, выручка:a.выручка+i.выручка};},
    {смен:0,часов:0,выручка:0});

  return `
  <div class="panel">
    <header><h3>Табель за ${периодТекст(S.period)}</h3>
      <p>${esc(S.branch)} · ${дней} дней в месяце</p>
      <div class="actions noprint">
        <button class="btn ghost${режимТабеля==='h'?' on-mode':''}" id="modeH">Часы</button>
        <button class="btn ghost${режимТабеля==='r'?' on-mode':''}" id="modeR">Выручка за смену</button>
        ${свободные.length?`<select id="addToTabel" style="width:210px">
          <option value="">Добавить сотрудника…</option>
          ${свободные.map(p=>`<option value="${p.id}">${esc(p.fio)}</option>`).join('')}
        </select>`:'<span class="calc">все сотрудники добавлены</span>'}
      </div>
    </header>
    <div class="body">
      <p class="hint">Сейчас вводятся <b>${режимТабеля==='h'?'часы':'выручка за смену'}</b>.
      Смена засчитывается, если в дне указаны часы или выручка. Выходные подсвечены.
      Пустая клетка — человек не работал.</p>
      <div class="scroll"><table class="tabel"><thead>${шапка}</thead>
        <tbody>${строки}</tbody>
        <tfoot><tr><td class="l fix">Итого</td>
          <td colspan="${дней}"></td>
          <td class="num">${всего.смен}</td><td class="num">${всего.часов}</td>
          <td class="num">${rub(всего.выручка)}</td><td></td></tr></tfoot>
      </table></div>
      <div class="actions" style="margin-top:14px;justify-content:flex-start">
        <button class="btn" id="tabelToVedHours">Перенести смены и часы</button>
        <button class="btn" id="tabelToVedRev">Перенести выручку</button>
        <button class="btn ghost" id="tabelToVed">Перенести всё</button>
        <button class="btn ghost" id="tabelXls">Табель в Excel для печати</button>
        <button class="btn ghost" id="tabelLoad">Загрузить из файла</button>
        <button class="btn ghost" id="tabelTpl">Скачать шаблон</button>
      </div>
      <p class="hint" style="margin-top:10px">«Перенести в ведомость» заполнит смены, часы и выручку
      по услугам на вкладках «Расчёты» и «Персонал». Введённое там вручную будет заменено —
      ведомость спросит подтверждение. В печатный табель выручка не попадает.</p>
    </div>
  </div>`;
}

function viewMotiv(t){
  const B=S.bonuses||[];
  const кто=['все'].concat(должности());
  const срабатывания={};
  [...t.M,...t.T].forEach(c=>(c.бонусы||[]).forEach(b=>{
    срабатывания[b.name]=(срабатывания[b.name]||0)+b.сумма; }));

  const rows=B.length ? B.map((b,i)=>`<tr data-b="${i}">
    <td class="l fix"><input data-bf="name" class="wide" value="${esc(b.name||'')}" placeholder="Например: премия за 150 тысяч"></td>
    <td class="l"><select data-bf="кому">${кто.map(o=>`<option${o===(b.кому||'все')?' selected':''}>${o}</option>`).join('')}</select></td>
    <td class="l"><select data-bf="статус"><option${!b.статус||b.статус==='любой'?' selected':''}>любой</option>
      ${всеКатегории().map(o=>`<option${o===b.статус?' selected':''}>${o}</option>`).join('')}</select></td>
    <td class="l"><select data-bf="показатель">${Object.keys(ПОКАЗАТЕЛИ).map(k=>`<option value="${k}"${k===b.показатель?' selected':''}>${ПОКАЗАТЕЛИ[k]}</option>`).join('')}</select></td>
    <td class="l"><select data-bf="условие"><option value=">="${b.условие!=='<='?' selected':''}>не меньше</option>
      <option value="<="${b.условие==='<='?' selected':''}>не больше</option></select></td>
    <td><input data-bf="порог" class="num" value="${b.порог||''}" placeholder="0"></td>
    <td class="l"><select data-bf="тип"><option value="фикс"${b.тип!=='процент'?' selected':''}>рублей</option>
      <option value="процент"${b.тип==='процент'?' selected':''}>% от показателя</option></select></td>
    <td><input data-bf="значение" class="num" value="${b.значение||''}" placeholder="0"></td>
    <td class="l"><select data-bf="активно"><option value="да"${b.активно!==false?' selected':''}>да</option>
      <option value="нет"${b.активно===false?' selected':''}>нет</option></select></td>
    <td class="calc num">${срабатывания[b.name||'Без названия']?rub(срабатывания[b.name||'Без названия'])+' ₽':'—'}</td>
    <td><button class="btn ghost sm" data-bdel="${i}">Удалить</button></td>
  </tr>`).join('') : `<tr><td class="l" colspan="11">Правил пока нет. Нажмите «Добавить правило».</td></tr>`;

  const итого=Object.values(срабатывания).reduce((a,x)=>a+x,0);
  return `
  <div class="panel">
    <header><h3>Правила мотивации</h3>
      <p>Условие проверяется по каждому сотруднику отдельно</p>
      <div class="actions noprint"><button class="btn" id="addBonus">Добавить правило</button></div>
    </header>
    <div class="body">
      <p class="hint">Правило читается как фраза: «кому — если показатель не меньше порога — начислить столько».
      Надбавка попадает в начисление и облагается так же, как основная часть.
      В колонке «Сработало» видно, сколько правило дало в этом месяце.</p>
      <div class="scroll"><table><thead><tr>
        <th class="l fix">Название</th><th class="l">Кому</th><th class="l">Статус</th>
        <th class="l">Показатель</th><th class="l">Условие</th><th>Порог</th>
        <th class="l">Начислить</th><th>Сколько</th><th class="l">Работает</th>
        <th>Сработало ₽</th><th></th>
      </tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td class="l">Итого мотивации за месяц</td><td colspan="8"></td>
        <td class="num">${rub(итого)}</td><td></td></tr></tfoot></table></div>
    </div>
  </div>

  <div class="panel"><header><h3>Примеры</h3></header><div class="body">
    <p class="hint">
    <b>Премия за объём:</b> кому — мастер маникюра-педикюра, показатель «Выручка по услугам»,
    не меньше 150 000, начислить 5 000 рублей.<br><br>
    <b>Процент за товары сверх плана:</b> показатель «Выручка по товарам», не меньше 20 000,
    начислить 5% от показателя.<br><br>
    <b>Доплата за выработку:</b> показатель «Отработано смен», не меньше 20, начислить 3 000 рублей.<br><br>
    <b>Поддержка новичка:</b> показатель «Выручка за смену», не больше 8 000, начислить 1 000 рублей —
    условие «не больше» работает как страховка, а не как премия.</p>
  </div></div>`;
}

function viewHelp(){
  const т=(k,v)=>`<div class="field"><span>${k}<small>${v}</small></span></div>`;
  return `
  <div class="grid2">
    <div class="panel"><header><h3>Порядок работы за месяц</h3></header><div class="body">
      <ol class="steps">
        <li><b>Начало месяца.</b> В шапке справа выберите в списке «Период» пункт
            <b>«＋ следующий месяц…»</b>. Ведомость спросит, переносить ли остатки, и создаст месяц:
            сотрудники, ставки, проценты, ступени и правила мотивации перейдут как есть,
            факт обнулится, хвосты округления встанут в колонку «Перенос».
            То же самое можно сделать на вкладке «Синхронизация», там кнопка описана подробнее.</li>
        <li><b>Картотека набирается один раз.</b> Список сотрудников общий для всех месяцев филиала:
            добавили человека в июле — он есть и в августе, и в декабре. Уволенного не удаляйте,
            поставьте ему в колонке «Состояние» значение <b>«уволен»</b>: он пропадёт из списков
            на вкладках «Расчёты» и «Персонал», но останется в расчётах прошлых месяцев.
            Удаление стирает человека сразу отовсюду.</li>
        <li><b>Вернуться в прошлый месяц.</b> Тот же список «Период» — там все месяцы,
            по которым есть расчёт. Ничего не потеряется: каждый месяц хранится отдельной записью
            и открывается в один клик. Полный перечень с датами правок — на вкладке «Синхронизация».</li>
        <li><b>Другой филиал.</b> Список «Филиал» слева от периода. Пункт <b>«＋ новый филиал…»</b>
            создаёт филиал с теми же настройками расчёта — матрица, ступени, мотивация, параметры —
            но с пустой картотекой: люди у каждого филиала свои.
            Правки в справочнике одного месяца до уже созданных остальных сами не доходят —
            для этого внизу вкладки «Справочники» есть кнопка «Применить ко всем филиалам и месяцам».</li>
        <li><b>В течение месяца.</b> Либо заполняйте <b>«Табель»</b> по дням, либо вносите итоги
            месяца сразу на вкладках «Расчёты» и «Персонал».
            Из табеля в ведомость переносят тремя отдельными кнопками:
            <b>«Перенести смены и часы»</b>, <b>«Перенести выручку»</b> и «Перенести всё».
            Раздельно — чтобы табель с одними часами не обнулил уже внесённую выручку.
            Табель нужен, если важен учёт по дням и печатная форма для отдела кадров.</li>
        <li><b>Сохранение.</b> Правки копятся в этом браузере и уходят в общее хранилище
            только по кнопке <b>«Сохранить изменения»</b> вверху справа. Она появляется,
            как только что-то изменили. При переходе на другую вкладку, в другой месяц или
            филиал ведомость сама спросит, сохранять ли.</li>
        <li><b>Проверка.</b> Смотрите полосу вверху: доля фонда оплаты труда в выручке.
            Норма — до 47%. Колонка «Контроль» подсвечивает спорные строки.</li>
        <li><b>Проводка месяца.</b> Когда расчёт согласован, нажмите на вкладке «Свод»
            <b>«Провести месяц»</b>. Поля станут серыми, случайно испортить закрытый период
            не выйдет. Понадобилось поправить — там же «Снять проводку», с подтверждением.</li>
        <li><b>Закрытие.</b> «Выгрузить в Excel» для бухгалтерии, «Расчётные листки» — сотрудникам.</li>
      </ol>
    </div></div>

    <div class="panel"><header><h3>Как считается зарплата мастера</h3></header><div class="body">
      <p class="hint">Берётся <b>большее из двух</b>: процент от выручки по услугам или гарантия по часам.
      Это защита мастера в слабый месяц: если процент дал меньше, чем часы по ставке, заплатим по часам.</p>
      <p class="hint">К этому прибавляются: процент от проданных товаров, сработавшие правила мотивации,
      отпускные и разовые доплаты, перенос с прошлого месяца. Вычитаются переделки, инвентаризация,
      НДФЛ и авансы. Итог округляется вниз до шага выдачи, а хвост переносится на следующий месяц.</p>
    </div></div>
  </div>

  <div class="panel"><header><h3>Термины в таблице</h3></header><div class="body">
    <div class="grid2">
      <div>
        ${т('Услуги ₽','Выручка мастера за оказанные услуги. Именно она определяет ступень процента')}
        ${т('Товары ₽','Выручка от проданной продукции. Процент по ней отдельный и ступеней не имеет')}
        ${т('Коррект. ₽','Ручная поправка к выручке: возврат, переброска между мастерами, исправление кассы')}
        ${т('По %, ₽','Сколько вышло по проценту от услуг')}
        ${т('По часам ₽','Сколько вышло бы по гарантийной часовой ставке')}
        ${т('База','Что победило — процент или гарантия. Полоса показывает это наглядно')}
        ${т('Ступень','Диапазон выручки, от которого зависит процент. Настраивается на вкладке «Справочники»')}
      </div>
      <div>
        ${т('Начислено','Полная сумма до вычетов: база, товары, мотивация, доплаты, перенос')}
        ${т('НДФЛ','Удерживается только с оформленных. Если в карточке указан МРОТ, налог считается с него, а не со всего начисления')}
        ${т('МРОТ','Официальная часть оклада. Поле появляется в картотеке, когда оформление «Оформлен»')}
        ${т('НДС и УСН','Налоги с выручки салона. Ставки задаются в «Справочниках», результат виден в «Своде»')}
        ${т('Аванс 1, Аванс 2','Уже выданные в течение месяца суммы')}
        ${т('Аванс (касса)','Отдельные колонки для выданного из кассы. Сколько их — задаётся в «Справочниках» полем «Из них выдано из кассы»; поставьте 0, и колонок не будет')}
        ${т('К выплате','Начислено минус НДФЛ и авансы. Это долг перед сотрудником')}
        ${т('Выдано','К выплате, округлённое вниз до шага — реальная сумма на руки')}
        ${т('Остаток','Разница между «К выплате» и «Выдано». Автоматически уходит в следующий месяц')}
        ${т('Перенос','Остаток прошлого месяца, добавленный к начислению текущего')}
      </div>
    </div>
  </div></div>

  <div class="panel"><header><h3>Вкладка за вкладкой</h3>
    <p>Что делать на каждой и в каком порядке</p></header><div class="body">
    <div class="terms">
      ${т('Расчёты','Те, кто получает процент от своей выручки. Фамилию выбираете из картотеки, дальше вносите смены, часы, выручку по услугам и по товарам. Процент подставляется сам — из матрицы по паре «должность + категория». Колонка «База» показывает, что победило: процент или гарантия по часам. Дальше идут доплаты, авансы и итог к выплате. Кнопка «Листок» печатает расчётный лист одному человеку')}
      ${т('Персонал','Те, кто получает ставку за смену или оклад. Смены, премии, ночные, отпускные, удержания. Процент от товаров считается, если он задан у должности. Выручку по услугам здесь не вносят')}
      ${т('Табель','Учёт по дням. Сверху переключатель: заполнять часы или выручку. Можно вбить руками, можно загрузить из файла — кнопка «Скачать шаблон» даёт готовый CSV с вашими фамилиями. Внизу три кнопки переноса в ведомость: отдельно смены с часами, отдельно выручка, и всё сразу. Переносите раздельно, если часть цифр уже внесена руками — иначе перезапишете')}
      ${т('Картотека','Список сотрудников филиала. Общий для всех месяцев: заполняется один раз. Здесь же должность, категория, оформление, ставка или оклад, МРОТ. Ушедшему ставьте «уволен», а не удаляйте — тогда он исчезнет из списков, но останется в прошлых расчётах')}
      ${т('Справочники','Настройки расчёта: ставка за час, шаг округления, НДФЛ, НДС и УСН, число колонок аванса. Ниже — должности с категориями, ступени выручки и матрица процентов. Внизу кнопка «Применить ко всем филиалам и месяцам»: разносит эти настройки везде')}
      ${т('Свод','Итоги месяца: налоги с выручки, структура фонда оплаты труда по должностям, проверки сходимости. Первым блоком — «Провести месяц». Проводите, когда расчёт согласован')}
      ${т('Мотивация','Конструктор надбавок. Правило читается фразой: кому — если показатель не меньше порога — начислить столько. Показатель любой из шести: выручка по услугам или товарам, смены, часы, выручка за смену, начисленное до мотивации. Начислить можно рублями или процентом от показателя. Колонка «Сработало» показывает, сколько правило дало в этом месяце. Ненужное правило не удаляйте — переключите «Работает» в «нет»')}
      ${т('Синхронизация','Смена пароля, выход, открытие нового месяца, список всех сохранённых расчётов. Здесь же журнал, ревизия хранилища и загрузка месяца из общей таблицы — они описаны ниже')}
      ${т('Доступ','Только для администратора. Заводит учётные записи, задаёт роль и филиалы. Если у человека указан филиал, он не увидит остальные — ни в списке, ни в хранилище')}
    </div>
  </div></div>

  <div class="panel"><header><h3>Что означают цвета</h3></header><div class="body">
    <p class="hint"><span class="pill ok">зелёный</span> — расчёт в норме.
    <span class="pill warn">жёлтый</span> — требует внимания: сработала гарантия по часам вместо процента,
    или доля фонда оплаты труда подошла к границе.
    <span class="pill bad">красный</span> — ошибка: не задан процент или ставка, либо сумма к выплате
    получилась отрицательной. Такие строки нельзя закрывать месяцем.</p>
  </div></div>

  <div class="panel"><header><h3>Хранение и доступ</h3></header><div class="body">
    <p class="hint">Расчёт хранится в двух местах: в памяти браузера — сразу, и в Google Таблице —
    после нажатия «Сохранить изменения». Индикатор вверху показывает состояние.
    Открыть ведомость можно с любого устройства, войдя под своей учётной записью.
    Учётки заводит администратор на вкладке «Доступ»; там же задаются филиалы,
    если человеку нужно видеть только свой.</p>
    <p class="hint"><b>Важно про два места хранения.</b> У каждого браузера своя память,
    и она может разойтись с общей таблицей — например, если правили с двух устройств
    или если расчёт восстанавливали из резервной копии. Тогда на вкладке
    «Синхронизация» нажмите <b>«Взять месяц из хранилища»</b>: местная копия заменится
    той, что лежит в таблице. Несохранённые правки при этом пропадут — на то и предупреждение.</p>
  </div></div>

  <div class="panel"><header><h3>Три кнопки на «Синхронизации»</h3></header><div class="body">
    <div class="terms">
      ${т('Взять месяц из хранилища','Забирает открытый месяц из общей таблицы, затирая местную копию. Нужно, когда браузер показывает устаревшие цифры')}
      ${т('Что где лежит','Ревизия: обходит все филиалы и месяцы и показывает, сколько в каждом людей, строк ведомости и заполненных дней табеля. Отдельной пометкой — записи табеля, которым не соответствует никто из картотеки')}
      ${т('Замок на месяц','Месяц лежит в хранилище одной записью, поэтому править его в один момент может один человек. Кто открыл первым, тот и работает; остальные видят полосу «Только просмотр» с именем и кнопкой «Попросить освободить». Держатель увидит просьбу и сможет выйти одним нажатием. Если страницу просто закрыли, замок отпустится сам через десять минут')}
      ${т('Показать журнал','Кто и когда заходил и сохранял. Сверху — последний вход каждой учётной записи, ниже лента действий: вход, неверный пароль, сохранение с указанием месяца')}
    </div>
    <p class="hint">Резервные копии обеих таблиц складываются на Google Диск каждую ночь
    и хранятся месяц. Если данные испортились, их можно вернуть из копии — этим
    занимается администратор через редактор скрипта.</p>
  </div></div>`;
}

function viewAccess(){
  if(auth.role!=='админ'){
    return `<div class="panel"><div class="body"><p class="hint">
      Раздел доступен только администратору.</p></div></div>`;
  }
  const rows = usersCache===null
    ? `<tr><td class="l" colspan="6">Нажмите «Обновить список».</td></tr>`
    : (usersCache.length
        ? usersCache.map(u=>`<tr>
            <td class="l"><b>${esc(u.login)}</b>${u.login===auth.login?' <span class="pill ok">это вы</span>':''}</td>
            <td class="l">${esc(u.role)}</td>
            <td class="l">${u.branches?esc(u.branches):'все'}</td>
            <td class="l">${u.active?'<span class="pill ok">да</span>':'<span class="pill bad">нет</span>'}</td>
            <td class="l calc">${u.last?new Date(u.last).toLocaleString('ru-RU'):'ни разу'}</td>
            <td><button class="btn ghost sm" data-uedit="${esc(u.login)}">Изменить</button>
                ${u.login===auth.login?'':` <button class="btn ghost sm" data-udel="${esc(u.login)}">Удалить</button>`}</td>
          </tr>`).join('')
        : `<tr><td class="l" colspan="6">Учёток нет.</td></tr>`);

  return `
  <div class="panel"><header><h3>Кто имеет доступ</h3>
    <div class="actions"><button class="btn ghost" id="accReload">Обновить список</button></div>
  </header><div class="body">
    <p class="hint">Пароли хранятся в таблице не текстом, а необратимой свёрткой:
    подсмотреть чужой пароль нельзя даже вам — можно только назначить новый.</p>
    <div class="scroll"><table>
      <thead><tr><th class="l">Логин</th><th class="l">Роль</th><th class="l">Филиалы</th>
        <th class="l">Активен</th><th class="l">Последний вход</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div></div>

  <div class="panel"><header><h3>Завести или изменить</h3></header><div class="body">
    <p class="hint">Существующий логин — изменение, новый — создание.
    Чтобы оставить пароль прежним, оставьте поле пустым.</p>
    <div class="grid2">
      <div>
        <div class="field"><span>Логин<small>латиницей, без пробелов</small></span>
          <input id="uLogin" style="width:190px" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><span>Пароль<small>не короче 8 символов</small></span>
          <input id="uPass" type="text" style="width:190px" autocomplete="off"></div>
      </div>
      <div>
        <div class="field"><span>Роль<small>администратор управляет доступом</small></span>
          <select id="uRole" style="width:190px">
            <option value="пользователь">пользователь</option>
            <option value="админ">админ</option></select></div>
        <div class="field"><span>Филиалы<small>через запятую; пусто — все</small></span>
          <input id="uBranches" style="width:190px" placeholder="Беломорская"></div>
        <div class="field"><span>Активен</span>
          <select id="uActive" style="width:190px">
            <option value="да">да</option><option value="нет">нет</option></select></div>
      </div>
    </div>
    <div class="actions" style="margin:14px 0 0">
      <button class="btn" id="accSave">Сохранить учётку</button>
      <button class="btn ghost" id="accClear">Очистить форму</button>
    </div>
  </div></div>`;
}

/* ====================== 4. СОБЫТИЯ ====================== */
document.querySelectorAll('.rail button[data-tab]').forEach(b=>{
  b.addEventListener('click',async ()=>{
    if(b.dataset.tab===tab) return;
    if(!await можноУходить('перейти на другую вкладку')) return;
    tab=b.dataset.tab;
    document.querySelectorAll('.rail button[data-tab]').forEach(x=>x.classList.toggle('on',x===b));
    render();
  });
});

document.getElementById('btnCommit').addEventListener('click',async ()=>{
  if(!cfg.url||!auth.session){ status('Нет связи с хранилищем — правки только в этом браузере','warn'); return; }
  await cloudSave();
});

// Закрыть вкладку с несохранённым тоже даём не молча
window.addEventListener('beforeunload',e=>{
  if(!естьПравки) return;
  e.preventDefault(); e.returnValue='';
});

$('#branch').addEventListener('change',e=>{
  if(e.target.value==='__новый'){
    const имя=(prompt('Название нового филиала:')||'').trim();
    if(!имя){ render(); return; }
    if(филиалы().includes(имя)){ открытьФилиал(имя); return; }
    новыйФилиал(имя); return;
  }
  открытьФилиал(e.target.value);
});
$('#period').addEventListener('change',e=>{
  if(e.target.value==='__новый'){
    const след=nextMonth(S.period);
    const p=(prompt('Какой месяц открыть? Формат ГГГГ-ММ:', след)||'').trim();
    if(!/^\d{4}-\d{2}$/.test(p)){ render(); return; }
    openPeriod(p); return;
  }
  openPeriod(e.target.value);
});

$('#page').addEventListener('input',e=>{
  const el=e.target, tr=el.closest('tr');
  if(el.dataset.p!==undefined){
    // Перерисовка на каждом символе пересоздавала поле и выбрасывала курсор —
    // дописать число было невозможно. Пересчитываем только полосу итогов,
    // а полную перерисовку делаем при уходе из поля.
    S.params[el.dataset.p]=n(el.value);
    save(); liveTotals(); return;
  }
  if(!tr) return;
  const i=+tr.dataset.i;
  if(el.dataset.av!==undefined || el.dataset.avk!==undefined){
    const arr = tab==='masters' ? S.masters : S.staff;
    const касса = el.dataset.avk!==undefined;
    const поле = касса ? 'avk' : 'av';
    if(!Array.isArray(arr[i][поле])) arr[i][поле] = касса ? пустаяКасса() : пустыеАвансы();
    arr[i][поле][+(касса ? el.dataset.avk : el.dataset.av)] = n(el.value);
    liveTotals(); save(); return;
  }
  if(el.dataset.m!==undefined){
    const k=el.dataset.m, v=el.value.trim();
    if(/^t\d+$/.test(k)){
      const idx=+k.slice(1);
      if(!Array.isArray(S.matrix[i].pctT)) S.matrix[i].pctT=[];
      S.matrix[i].pctT[idx] = v===''?null:n(v)/100;
      if(idx===0) S.matrix[i].pctS = S.matrix[i].pctT[0];
    } else {
      S.matrix[i][k] = v===''?null:(k==='hour'?n(v):n(v)/100);
    }
    save(); return;
  }
  if(el.dataset.tierFrom!==undefined){
    S.tiers[+el.dataset.tierFrom].from = n(el.value);
    save(); return;
  }
  if(el.dataset.f!==undefined){
    const k=el.dataset.f;
    const arr = tab==='masters'?S.masters : tab==='staff'?S.staff : S.people;
    arr[i][k] = (k==='fio'||k==='note') ? el.value : n(el.value);
    if(tab!=='people') liveTotals();
    save();
  }
});

$('#page').addEventListener('change',e=>{
  const el=e.target, tr=el.closest('tr');
  if(el.dataset && (el.dataset.p==='авансов' || el.dataset.p==='авансовКасса')){
    S.params.авансов=скольковАвансов();
    S.params.авансовКасса=скольковКассы();
    const подогнать=(r,поле,сколько)=>{
      if(!Array.isArray(r[поле])) r[поле]=[];
      while(r[поле].length<сколько) r[поле].push(0);
      if(r[поле].length>сколько) r[поле]=r[поле].slice(0,сколько);
    };
    [].concat(S.masters,S.staff).forEach(r=>{
      подогнать(r,'av', S.params.авансов);
      подогнать(r,'avk',S.params.авансовКасса);
    });
    save(); render(); return;
  }
  if(!tr||el.tagName!=='SELECT'||tr.dataset.i===undefined||el.dataset.f===undefined) return;
  const i=+tr.dataset.i, k=el.dataset.f;
  if(k==='уволен'){ S.people[i].уволен = (el.value==='уволен'); render(); return; }
  const arr = tab==='masters'?S.masters : tab==='staff'?S.staff : S.people;
  arr[i][k]=el.value;
  render();
});

$('#page').addEventListener('click',e=>{
  const d=e.target.dataset;
  if(e.target.id==='lockAsk'){ попроситьОсвободить(); return; }
  if(e.target.id==='lockFree'){ освободитьМесяц(); return; }
  if(e.target.id==='doClose'){ провестиМесяц(); return; }
  if(e.target.id==='doOpen'){ снятьПроводку(); return; }
  if(правкаЗапрещена(e.target)) return;
  if(d.del!==undefined){
    const i=+d.del;
    if(tab==='masters') S.masters.splice(i,1);
    else if(tab==='staff') S.staff.splice(i,1);
    else {
      const id=S.people[i].id;
      S.masters=S.masters.filter(r=>r.empId!==id);
      S.staff=S.staff.filter(r=>r.empId!==id);
      S.people.splice(i,1);
    }
    render(); return;
  }
  if(e.target.id==='addMaster'){
    const free=S.people.find(p=>процентная(p.post)&&работает(p)&&!S.masters.some(m=>m.empId===p.id));
    if(free&&S.masters.length<MAX_MASTERS){
      S.masters.push({empId:free.id,shifts:0,hours:0,revS:0,revG:0,corr:0,vac:0,extra:0,
        redo:0,inv:0,carry:0,av:пустыеАвансы(),avk:пустаяКасса()});
      render();
    }
    return;
  }
  if(e.target.id==='addStaff'){
    const free=S.people.find(p=>!процентная(p.post)&&работает(p)&&!S.staff.some(m=>m.empId===p.id));
    if(free){ S.staff.push({empId:free.id,shifts:0,revG:0,bonus:0,bonus100:0,night:0,
      vac:0,ded:0,carry:0,av:пустыеАвансы(),avk:пустаяКасса()}); render(); }
    return;
  }
  if(e.target.id==='cfgPing'){
    status('Проверяю…','busy');
    cloudGet({action:'ping'})
      .then(j=>status(`Связь есть · вы ${j.login} · периодов в базе: ${j.periods}`,'ok'))
      .catch(err=>status('Связи нет: '+err.message,'bad'));
    return;
  }
  if(e.target.id==='cfgPush'){ cloudSave(); return; }
  if(e.target.id==='pullList'){
    if(!cfg.url){ status('Хранилище не подключено','warn'); return; }
    status('Читаю список…','busy');
    cloudGet({action:'list'}).then(j=>{cloudList=j.keys; status('Список обновлён','ok'); render();})
      .catch(err=>status('Не получилось: '+err.message,'bad'));
    return;
  }
  if(e.target.id==='doRoll'||e.target.id==='doRollNo'){
    const p=$('#newPeriod').value;
    if(!p){ status('Укажите месяц','bad'); return; }
    if(p===S.period){ status('Этот месяц уже открыт','warn'); return; }
    rollover(p, e.target.id==='doRoll');
    return;
  }
  if(d.open!==undefined){ openPeriod(d.open.split('|').pop()); return; }
  if(d.slip!==undefined){
    const t=totals();
    const c=[...t.M,...t.T].find(x=>x&&x.p.id===d.slip);
    if(!c){ status('Не нашёл сотрудника','bad'); return; }
    dl(new Blob([листкиКнига([c])],{type:'application/vnd.ms-excel'}),
       `Листок_${c.p.fio.replace(/\s+/g,'_')}_${S.period}.xls`);
    status('Листок выгружен: '+c.p.fio,'ok');
    return;
  }
  if(e.target.id==='modeH'){ режимТабеля='h'; render(); return; }
  if(e.target.id==='modeR'){ режимТабеля='r'; render(); return; }

  if(d.tabDel!==undefined){
    const p=person(d.tabDel);
    if(табельЗаполнен(d.tabDel) && !confirm(`Убрать «${p?p.fio:''}» из табеля? Проставленные дни удалятся.`)) return;
    delete S.tabel[d.tabDel]; render(); return;
  }

  if(e.target.id==='tabelToVed'){ перенестиТабель('всё'); return; }
  if(e.target.id==='tabelToVedHours'){ перенестиТабель('часы'); return; }
  if(e.target.id==='tabelToVedRev'){ перенестиТабель('выручка'); return; }

  if(e.target.id==='tabelLoad'){ $('#tabelFile').click(); return; }
  if(e.target.id==='tabelTpl'){ шаблонТабеля(); return; }
  if(e.target.id==='tabelXls'){
    const занятые=Object.keys(S.tabel||{});
    if(!занятые.length){ status('Табель пуст','warn'); return; }
    dl(new Blob([табельКнига()],{type:'application/vnd.ms-excel'}),
       `Табель_${S.branch}_${S.period}.xls`);
    status('Табель выгружен','ok');
    return;
  }

  if(e.target.id==='addRole'){
    if(!Array.isArray(S.roles)) S.roles=[];
    S.roles.push({name:'Новая должность', процент:false, категории:[]});
    S.v=0; S=миграция(S); render(); return;
  }
  if(d.rdel!==undefined){
    const r=S.roles[+d.rdel];
    if(S.people.some(p=>p.post===r.name)){ status('Должность занята сотрудниками','warn'); return; }
    S.roles.splice(+d.rdel,1);
    S.matrix=S.matrix.filter(m=>m.post!==r.name);
    render(); return;
  }
  if(e.target.id==='addBonus'){
    if(!Array.isArray(S.bonuses)) S.bonuses=[];
    S.bonuses.push({name:'',кому:'все',статус:'любой',показатель:'revS',
      условие:'>=',порог:150000,тип:'фикс',значение:5000,активно:true});
    render(); return;
  }
  if(d.bdel!==undefined){
    S.bonuses.splice(+d.bdel,1); render(); return;
  }
  if(e.target.id==='spreadRefs'){ разнестиСправочник(); return; }
  if(e.target.id==='audit'){ ревизияХранилища(); return; }
  if(e.target.id==='showJournal'){ показатьЖурнал(); return; }
  if(e.target.id==='cfgPull'){ взятьИзОблака(); return; }
  if(e.target.id==='addTier'){
    const last=S.tiers[S.tiers.length-1];
    S.tiers.push({from:n(last.from)+150000});
    S.matrix.forEach(m=>{ if(!Array.isArray(m.pctT)) m.pctT=[]; m.pctT.push(m.pctT[m.pctT.length-1] ?? null); });
    render(); return;
  }
  if(d.tierDel!==undefined){
    const k=+d.tierDel;
    if(S.tiers.length<2){ status('Должна остаться хотя бы одна ступень','warn'); return; }
    S.tiers.splice(k,1);
    S.matrix.forEach(m=>{ if(Array.isArray(m.pctT)) m.pctT.splice(k,1); });
    S.matrix.forEach(m=>{ m.pctS = Array.isArray(m.pctT)?m.pctT[0]:m.pctS; });
    render(); return;
  }
  if(e.target.id==='showFired'){
    показыватьУволенных=e.target.checked; render(); return;
  }
  if(e.target.id==='addPerson'){
    S.people.push({id:uid(),fio:'',post:'Мастер маникюра-педикюра',status:'Абсолют',
      form:'НО',shiftRate:null,note:''});
    render();
    const inp=document.querySelector('tbody tr:last-child input[data-f="fio"]'); if(inp) inp.focus();
  }
  if(e.target.id==='confirmOrphans'){
    S.people.forEach(p=>{ if(p.orphan) delete p.orphan; });
    save(); render();
  }
});

/* Перенос из табеля в ведомость. Раньше кнопка была одна и писала сразу
   смены, часы и выручку — если в табеле стояли только часы, выручка
   обнулялась. Теперь переносим ровно то, что просят. */
function перенестиТабель(что){
  const занятые=Object.keys(S.tabel||{}).filter(id=>табельЗаполнен(id));
  if(!занятые.length){ status('Табель пуст — переносить нечего','warn'); return; }

  const пустаяВыручка=занятые.every(id=>!итогТабеля(id).выручка);
  if(что!=='часы' && пустаяВыручка){
    status('В табеле нет ни одной суммы выручки — перенеслись бы нули','warn');
    if(!confirm('В табеле не проставлена выручка.\n\nПеренести всё равно?'
      +' Выручка в ведомости обнулится.')) return;
  }

  const чтоИменно = что==='часы' ? 'смены и часы'
                  : что==='выручка' ? 'выручку по услугам'
                  : 'смены, часы и выручку';
  if(!confirm(`Перенести ${чтоИменно} по ${занятые.length} сотрудникам?\n\n`
    +`Эти колонки в ведомости будут заменены значениями из табеля.`
    +` Остальные останутся как есть.`)) return;

  let м=0, п=0;
  занятые.forEach(id=>{
    const т=итогТабеля(id), че=person(id); if(!че) return;
    if(процентная(che_post(че))){
      let r=S.masters.find(x=>x.empId===id);
      if(!r){ r={empId:id,shifts:0,hours:0,revS:0,revG:0,corr:0,vac:0,extra:0,redo:0,inv:0,carry:0,av:пустыеАвансы(),avk:пустаяКасса()};
              S.masters.push(r); }
      if(что!=='выручка'){ r.shifts=т.смен; r.hours=т.часов; }
      if(что!=='часы') r.revS=т.выручка;
      м++;
    } else {
      let r=S.staff.find(x=>x.empId===id);
      if(!r){ r={empId:id,shifts:0,revG:0,bonus:0,bonus100:0,night:0,vac:0,ded:0,carry:0,av:пустыеАвансы(),avk:пустаяКасса()};
              S.staff.push(r); }
      if(что!=='выручка') r.shifts=т.смен;
      п++;
    }
  });
  render();
  status(`Перенесено (${чтоИменно}): мастеров ${м}, персонала ${п}`,'ok');
}

/* ---- табель ---- */
$('#page').addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.tabEmp===undefined) return;
  const id=el.dataset.tabEmp, d=el.dataset.tabDay;
  if(!S.tabel[id]) S.tabel[id]={};
  if(!S.tabel[id][d]) S.tabel[id][d]={h:0,r:0};
  S.tabel[id][d][режимТабеля] = n(el.value);
  if(!n(S.tabel[id][d].h) && !n(S.tabel[id][d].r)) delete S.tabel[id][d];
  save();
  const т=итогТабеля(id);
  const стр=el.closest('tr');
  if(стр){
    const яч=стр.querySelectorAll('td.calc');
    if(яч.length>=3){
      яч[яч.length-3].innerHTML='<b>'+(т.смен||'—')+'</b>';
      яч[яч.length-2].textContent=т.часов||'—';
      яч[яч.length-1].textContent=т.выручка?rub(т.выручка):'—';
    }
  }
});

$('#page').addEventListener('change',e=>{
  if(e.target.id!=='addToTabel') return;
  const id=e.target.value; if(!id) return;
  if(!S.tabel[id]) S.tabel[id]={};
  render();
});

/* ---- справочник должностей ---- */
$('#page').addEventListener('input',e=>{
  const el=e.target, tr=el.closest('tr');
  if(!tr || el.dataset.rf===undefined) return;
  const i=+tr.dataset.r, k=el.dataset.rf, r=S.roles[i];
  if(k==='name'){
    const было=r.name, стало=el.value;
    r.name=стало;
    S.people.forEach(p=>{ if(p.post===было) p.post=стало; });
    S.matrix.forEach(m=>{ if(m.post===было) m.post=стало; });
    (S.bonuses||[]).forEach(b=>{ if(b.кому===было) b.кому=стало; });
  }
  // Категории применяем не на каждом символе, а когда ушли из поля:
  // иначе на первой букве «С» матрица пересобралась бы под категорию «С»
  // и уже введённые проценты по «Стандарту» потерялись бы.
  save();
});
$('#page').addEventListener('change',e=>{
  const el=e.target, tr=el.closest('tr');
  if(!tr || el.dataset.rf===undefined) return;
  const r=S.roles[+tr.dataset.r];
  if(el.dataset.rf==='процент'){
    r.процент = el.value==='да';
    S.masters=S.masters.filter(x=>процентная((person(x.empId)||{}).post));
    S.staff=S.staff.filter(x=>!процентная((person(x.empId)||{}).post));
    render(); return;
  }
  if(el.dataset.rf==='категории'){
    r.категории = el.value.split(',').map(x=>x.trim()).filter(Boolean);
    S.v=0; S=миграция(S);      // пересобрать матрицу и поправить статусы людей
    render(); return;
  }
});

/* ---- правила мотивации ---- */
$('#page').addEventListener('input',e=>{
  const el=e.target, tr=el.closest('tr');
  if(!tr || el.dataset.bf===undefined) return;
  const i=+tr.dataset.b, k=el.dataset.bf;
  S.bonuses[i][k] = (k==='порог'||k==='значение') ? n(el.value) : el.value;
  save();
});
$('#page').addEventListener('change',e=>{
  const el=e.target, tr=el.closest('tr');
  if(!tr || el.dataset.bf===undefined) return;
  const i=+tr.dataset.b, k=el.dataset.bf;
  S.bonuses[i][k] = k==='активно' ? (el.value==='да') : el.value;
  render();
});

/* ---- вход, пароль, учётки ---- */
$('#page').addEventListener('click',e=>{
  const d=e.target.dataset;

  if(e.target.id==='authOut'){ выйти(); return; }

  if(e.target.id==='pwdSave'){
    const o=$('#pwdOld').value, p=$('#pwdNew').value;
    if(!o||!p){ status('Заполните оба поля пароля','bad'); return; }
    status('Меняю пароль…','busy');
    api('password',{old:o, pass:p})
      .then(()=>{ status('Пароль изменён','ok'); render(); })
      .catch(err=>status('Не вышло: '+err.message,'bad'));
    return;
  }

  if(e.target.id==='accReload'){
    status('Читаю список…','busy');
    api('users').then(j=>{ usersCache=j.users; status(`Учёток: ${j.users.length}`,'ok'); render(); })
      .catch(err=>status('Не вышло: '+err.message,'bad'));
    return;
  }

  if(d.uedit!==undefined){
    const u=(usersCache||[]).find(x=>x.login===d.uedit); if(!u) return;
    $('#uLogin').value=u.login; $('#uPass').value='';
    $('#uRole').value=u.role; $('#uBranches').value=u.branches||'';
    $('#uActive').value=u.active?'да':'нет';
    status('Учётка «'+u.login+'» подставлена в форму','ok');
    return;
  }

  if(d.udel!==undefined){
    if(!confirm('Удалить учётку «'+d.udel+'»? Человек сразу потеряет доступ.')) return;
    api('user_del',{login:d.udel})
      .then(()=>api('users'))
      .then(j=>{ usersCache=j.users; status('Учётка удалена','ok'); render(); })
      .catch(err=>status('Не вышло: '+err.message,'bad'));
    return;
  }

  if(e.target.id==='accClear'){
    $('#uLogin').value=''; $('#uPass').value=''; $('#uBranches').value='';
    $('#uRole').value='пользователь'; $('#uActive').value='да';
    return;
  }

  if(e.target.id==='accSave'){
    const login=$('#uLogin').value.trim();
    if(!login){ status('Укажите логин','bad'); return; }
    status('Сохраняю учётку…','busy');
    api('user_save',{login, pass:$('#uPass').value, role:$('#uRole').value,
                     branches:$('#uBranches').value.trim(), active:$('#uActive').value==='да'})
      .then(()=>api('users'))
      .then(j=>{ usersCache=j.users; status('Учётка сохранена','ok'); render(); })
      .catch(err=>status('Не вышло: '+err.message,'bad'));
    return;
  }
});

/* пересчёт итогов без перерисовки таблицы — курсор остаётся в ячейке */
function liveTotals(){ $('#strip').innerHTML=strip(totals()); }
$('#page').addEventListener('focusout',e=>{ if(e.target.tagName==='INPUT'&&tab!=='people'&&tab!=='sync'&&tab!=='access') render(); });

/* ---- файлы ---- */
$('#btnSave').addEventListener('click',()=>{
  dl(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}),
     `ведомость_${S.branch}_${S.period}.json`);
});
$('#btnLoad').addEventListener('click',()=>$('#fileIn').click());
$('#fileIn').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ S=JSON.parse(r.result); render(); }
                 catch(err){ alert('Файл не читается: нужен JSON, сохранённый этой же ведомостью.'); } };
  r.readAsText(f); e.target.value='';
});
$('#btnCsv').addEventListener('click',()=>{
  const t=totals();
  const rows=[['ФИО','Должность','Статус','Смен','Часов','Выручка услуги','Выручка товары',
    'Начислено','Авансы','К выплате','Выдано','Остаток','Контроль']];
  S.masters.forEach((r,i)=>{ const c=t.M[i]; if(!c) return;
    rows.push([c.p.fio,c.p.post,c.p.status,r.shifts,r.hours,r.revS,r.revG,
      c.accrued,c.accrued-c.total,c.total,c.paid,c.rest,c.note]); });
  S.staff.forEach((r,i)=>{ const c=t.T[i]; if(!c) return;
    rows.push([c.p.fio,c.p.post,c.p.status,r.shifts,'',0,r.revG,
      c.accrued,c.accrued-c.total,c.total,c.paid,c.rest,c.note]); });
  const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');
  dl(new Blob([csv],{type:'text/csv'}), `ведомость_${S.branch}_${S.period}.csv`);
});
/* ---- выгрузка в Excel ----
   Формат SpreadsheetML: обычный XML, который Excel и Numbers открывают как книгу.
   Библиотек не требует, поэтому работает и без интернета. */
function xmlEsc(v){
  return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function xlsCell(v, style){
  const число = typeof v==='number' && isFinite(v);
  const st = style?` ss:StyleID="${style}"`:'';
  return `<Cell${st}><Data ss:Type="${число?'Number':'String'}">${xmlEsc(число?Math.round(v*100)/100:v)}</Data></Cell>`;
}
function xlsSheet(name, rows, widths, шапка, итог){
  const cols=(widths||[]).map(w=>`<Column ss:Width="${w}"/>`).join('');
  const body=rows.map((r,i)=>{
    const последняя = итог && i===rows.length-1;
    const стиль = (i===0&&шапка) ? 'hdr' : (последняя?'tot':null);
    return '<Row>'+r.map(v=>{
      const числовой = typeof v==='number';
      let st=стиль;
      if(!st && числовой) st='num';
      if(последняя && числовой) st='totnum';
      return xlsCell(v, st);
    }).join('')+'</Row>';
  }).join('');
  return `<Worksheet ss:Name="${xmlEsc(name).slice(0,31)}"><Table>${cols}${body}</Table>`
    + (шапка?`<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/>`
      + `<SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane>`
      + `<ActivePane>2</ActivePane></WorksheetOptions>`:'')
    + `</Worksheet>`;
}
/* Расчётный листок одного человека: строки «показатель — сумма — пояснение» */
function листокСтроки(c){
  const мастер = c.baseRev!==undefined;
  const r=[['Показатель','Сумма ₽','Пояснение']];
  r.push(['Сотрудник', c.p.fio, c.p.post+', '+c.p.status]);
  r.push(['Период', S.period, 'Филиал: '+S.branch]);
  r.push(['Оформление', c.p.form, '']);
  r.push(['', '', '']);
  if(мастер){
    r.push(['Выручка по услугам', c.baseRev, 'с учётом корректировки']);
    r.push(['Процент по ступени', Math.round(c.pctS*1000)/10+'%', 'ступень '+(c.stIdx+1)]);
    r.push(['Начислено по проценту', c.accS, '']);
    r.push(['Начислено по часам', c.accH, 'гарантия: ставка '+c.hour+' ₽ × часы']);
    r.push(['Взято в расчёт', c.base, c.accH>c.accS?'сработала гарантия по часам':'процент от услуг']);
  } else {
    r.push([c.оклад?'Оклад за месяц':'Ставка за смену', c.оклад?n(c.p.monthSalary):c.shiftRate,
            c.оклад?('норма '+c.норма+' смен'):'']);
    r.push(['Начислено за смены', c.byRate, '']);
  }
  if(c.accG) r.push(['Процент с товаров', c.accG, Math.round((c.pctG||0)*1000)/10+'%']);
  (c.бонусы||[]).forEach(b=>r.push(['Мотивация: '+b.name, b.сумма, 'правило сработало']));
  r.push(['', '', '']);
  r.push(['Начислено всего', c.accrued, 'до вычетов']);
  if(c.ndfl) r.push(['НДФЛ', -c.ndfl, 'с базы '+rub(базаНДФЛ(c.p, c.accrued))+' ₽'
    + (n(c.p.mrot) && c.p.form==='Оформлен' ? ' (МРОТ)' : '')]);
  r.push(['К выплате', c.total, 'после вычетов и авансов']);
  r.push(['Выдано на руки', c.paid, 'округлено вниз до '+(S.params.step||1)+' ₽']);
  r.push(['Остаток к переносу', c.rest, 'войдёт в следующий месяц']);
  return r;
}

function имяЛиста(fio){
  return String(fio).replace(/[\\\/\?\*\[\]:]/g,' ').slice(0,31) || 'Сотрудник';
}

/* Книга с листками: по листу на человека */
function листкиКнига(люди){
  const шапка=`<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Arial" ss:Size="10"/></Style>
 <Style ss:ID="hdr"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E1726" ss:Pattern="Solid"/></Style>
 <Style ss:ID="tot"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/></Style>
 <Style ss:ID="num"><NumberFormat ss:Format="#,##0"/></Style>
 <Style ss:ID="totnum"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>
</Styles>`;
  const листы=люди.map(c=>xlsSheet(имяЛиста(c.p.fio), листокСтроки(c), [230,120,300], true, false)).join('\n');
  return шапка+листы+'</Workbook>';
}

/* ---- загрузка табеля из файла ----
   Формат: первая колонка ФИО, вторая необязательная «Показатель» (часы|выручка),
   дальше по колонке на каждый день месяца. Разделитель — точка с запятой,
   запятая или табуляция, определяется по первой строке. */
function читатьCSV(buf){
  const b=new Uint8Array(buf);
  let txt;
  if(b[0]===0xEF && b[1]===0xBB && b[2]===0xBF){
    txt=new TextDecoder('utf-8').decode(b.subarray(3));
  } else {
    try{ txt=new TextDecoder('utf-8',{fatal:true}).decode(b); }
    catch(e){ txt=new TextDecoder('windows-1251').decode(b); }  // так сохраняет Excel на Windows
  }
  const строки=txt.split(/\r?\n/).filter(l=>l.trim());
  if(!строки.length) return [];
  const счёт=ch=>(строки[0].match(new RegExp('\\'+ch,'g'))||[]).length;
  const разд = счёт(';')>=счёт(',') ? (счёт(';')>=счёт('\t')?';':'\t')
                                    : (счёт(',')>=счёт('\t')?',':'\t');
  return строки.map(l=>l.split(разд).map(x=>x.trim().replace(/^"|"$/g,'')));
}

function применитьТабель(таблица){
  if(таблицаПуста(таблица)) { status('Файл пустой','bad'); return; }
  const дней=днейВМесяце(S.period);
  const шапка=таблица[0].map(x=>x.toLowerCase());
  const естьПоказатель = шапка[1] && /показ|тип|значен/.test(шапка[1]);
  const перваяДневная = естьПоказатель ? 2 : 1;

  const поФИО={};
  S.people.forEach(p=>{ поФИО[String(p.fio).trim().toLowerCase()]=p; });

  const найдено={}, ненайдено=new Set();
  let клеток=0;
  таблица.slice(1).forEach(р=>{
    const имя=String(р[0]||'').trim().toLowerCase();
    if(!имя) return;
    const ч=поФИО[имя];
    if(!ч){ ненайдено.add(р[0]); return; }
    const вид = естьПоказатель && /выруч|деньг|сумм/.test(String(р[1]||'').toLowerCase())
      ? 'r' : (естьПоказатель && /час/.test(String(р[1]||'').toLowerCase()) ? 'h' : режимТабеля);
    if(!найдено[ч.id]) найдено[ч.id]={};
    for(let д=1; д<=дней; д++){
      const v=n(р[перваяДневная + д - 1]);
      if(!v) continue;
      const k=String(д).padStart(2,'0');
      if(!найдено[ч.id][k]) найдено[ч.id][k]={h:0,r:0};
      найдено[ч.id][k][вид]=v;
      клеток++;
    }
  });

  const кого=Object.keys(найдено).length;
  if(!кого){
    alert('Ни одной фамилии из файла нет в картотеке.\n\nНе найдены:\n'
      + [...ненайдено].slice(0,15).join('\n'));
    return;
  }
  let вопрос=`Распознано сотрудников: ${кого}\nЗаполненных клеток: ${клеток}`;
  if(ненайдено.size) вопрос += `\n\nНе найдены в картотеке (${ненайдено.size}):\n`
    + [...ненайдено].slice(0,10).join('\n');
  вопрос += `\n\nЗаписать в табель? Уже проставленные дни этих сотрудников будут заменены.`;
  if(!confirm(вопрос)) return;

  Object.keys(найдено).forEach(id=>{
    S.tabel[id]=S.tabel[id]||{};
    Object.keys(найдено[id]).forEach(k=>{
      const было=S.tabel[id][k]||{h:0,r:0};
      S.tabel[id][k]={h: найдено[id][k].h || было.h || 0,
                      r: найдено[id][k].r || было.r || 0};
      if(!S.tabel[id][k].h && !S.tabel[id][k].r) delete S.tabel[id][k];
    });
  });
  render();
  status(`Загружено: ${кого} сотрудников, ${клеток} клеток`,'ok');
}
function таблицаПуста(t){ return !t || !t.length || !t[0] || !t[0].length; }

function шаблонТабеля(){
  const дней=днейВМесяце(S.period);
  const дни=Array.from({length:дней},(_,i)=>String(i+1));
  const строки=[['ФИО','Показатель'].concat(дни)];
  S.people.forEach(p=>{
    строки.push([p.fio,'часы'].concat(дни.map(()=>'')));
    строки.push([p.fio,'выручка'].concat(дни.map(()=>'')));
  });
  const csv='\uFEFF'+строки.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
  dl(new Blob([csv],{type:'text/csv;charset=utf-8'}), `Шаблон_табеля_${S.period}.csv`);
}

/* Печатный табель: только часы, выручки в нём нет */
function табельКнига(){
  const дней=днейВМесяце(S.period);
  const люди=S.people.filter(p=>Object.keys(S.tabel||{}).includes(p.id));
  const шапка=['Сотрудник','Должность']
    .concat(Array.from({length:дней},(_,i)=>String(i+1)))
    .concat(['Смен','Часов']);
  const строки=[шапка];
  люди.forEach(p=>{
    const дни=(S.tabel||{})[p.id]||{}, т=итогТабеля(p.id);
    строки.push([p.fio, p.post].concat(
      Array.from({length:дней},(_,i)=>{
        const з=дни[String(i+1).padStart(2,'0')]||{};
        return n(з.h) ? n(з.h) : '';
      })).concat([т.смен, т.часов]));
  });
  const итог=люди.reduce((a,p)=>{const т=итогТабеля(p.id);
    return [a[0]+т.смен, a[1]+т.часов];},[0,0]);
  строки.push(['ИТОГО',''].concat(Array.from({length:дней},()=>'')).concat(итог));

  const ширины=[220,170].concat(Array.from({length:дней},()=>28)).concat([50,55]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Arial" ss:Size="9"/></Style>
 <Style ss:ID="hdr"><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E1726" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>
 <Style ss:ID="tot"><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/></Style>
 <Style ss:ID="num"><NumberFormat ss:Format="0"/><Alignment ss:Horizontal="Center"/></Style>
 <Style ss:ID="totnum"><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/><NumberFormat ss:Format="0"/></Style>
</Styles>
${xlsSheet('Табель '+S.period, строки, ширины, true, true)}
</Workbook>`;
}

function excelBook(){
  const t=totals();
  const ведомость=flatTable();
  const свод=[
    ['Показатель','Значение','Комментарий'],
    ['Филиал', S.branch||'—',''],
    ['Период', S.period||'—',''],
    ['Выручка за период', t.rev, 'услуги '+Math.round(t.revS)+', товары '+Math.round(t.revG)],
    ['Фонд оплаты труда', t.accrued, t.heads+' чел. в расчёте'],
    ['Доля ФОТ в выручке', t.rev?Math.round(t.share*1000)/10:0, 'процентов, норма до 47'],
    ['К выплате на руки', t.paid, ''],
    ['Остаток на следующий месяц', t.rest, 'хвосты округления'],
    ['Смен отработано', t.shifts, ''],
    ['Выгружено', new Date().toLocaleString('ru-RU'), 'кто: '+(auth.login||'—')]
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Arial" ss:Size="10"/></Style>
 <Style ss:ID="hdr"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E1726" ss:Pattern="Solid"/><Alignment ss:Vertical="Bottom" ss:WrapText="1"/></Style>
 <Style ss:ID="tot"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/></Style>
 <Style ss:ID="num"><NumberFormat ss:Format="#,##0"/></Style>
 <Style ss:ID="totnum"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/>
   <Interior ss:Color="#F0EBF4" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0"/></Style>
</Styles>
${xlsSheet('Ведомость '+(S.period||''), ведомость, [200,150,80,55,55,95,95,95,110,95,90,80,120], true, true)}
${xlsSheet('Свод', свод, [220,140,260], true, false)}
</Workbook>`;
}
$('#btnXls').addEventListener('click',()=>{
  dl(new Blob([excelBook()],{type:'application/vnd.ms-excel'}),
     `Ведомость_${S.branch}_${S.period}.xls`);
  status('Файл для Excel выгружен','ok');
});

$('#btnSlips').addEventListener('click',()=>{
  const t=totals();
  const люди=[...t.M,...t.T].filter(Boolean);
  if(!люди.length){ status('Некому выгружать листки','warn'); return; }
  dl(new Blob([листкиКнига(люди)],{type:'application/vnd.ms-excel'}),
     `Листки_${S.branch}_${S.period}.xls`);
  status('Листки выгружены: '+люди.length+' чел.','ok');
});

$('#tabelFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ применитьТабель(читатьCSV(r.result)); }
                 catch(err){ alert('Не смог разобрать файл: '+err.message); } };
  r.readAsArrayBuffer(f);
  e.target.value='';
});

$('#btnPrint').addEventListener('click',()=>window.print());
function dl(blob,name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

document.getElementById('gateForm').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const btn=document.getElementById('gateBtn'), msg=document.getElementById('gateMsg');
  const l=document.getElementById('gateLogin').value.trim();
  const p=document.getElementById('gatePass').value;
  if(!l||!p){ msg.textContent='Введите логин и пароль'; msg.className='gatemsg bad'; return; }
  btn.disabled=true; msg.className='gatemsg busy';
  let сек=0;
  msg.textContent='Проверяю…';
  const тик=setInterval(()=>{ сек++;
    msg.textContent = сек<8 ? 'Проверяю…'
      : 'Проверяю… '+сек+' с. Google отвечает медленно, это нормально.';
  },1000);
  try{
    await войти(l,p);
    document.getElementById('gatePass').value='';
    msg.textContent=''; msg.className='gatemsg';
    открытьВедомость();
  }catch(err){
    msg.textContent=err.message; msg.className='gatemsg bad';
  }finally{ clearInterval(тик); btn.disabled=false; }
});

document.getElementById('railOut').addEventListener('click', ()=>{
  if(confirm('Выйти из ведомости? Расчёт уже сохранён в облаке.')) выйти();
});

/* показать/скрыть пароль — работает на всех полях с кнопкой data-eye */
document.addEventListener('click', ev=>{
  const b=ev.target.closest?ev.target.closest('.eye'):null;
  if(!b) return;
  ev.preventDefault();
  const inp=document.getElementById(b.dataset.eye); if(!inp) return;
  const скрыт = inp.type==='password';
  inp.type = скрыт ? 'text' : 'password';
  b.textContent = скрыт ? 'скрыть' : 'показать';
  inp.focus();
});

восстановитьВход().then(старт);