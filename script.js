(function() {
  console.log('[MyReadingSummary-Plugin] Category-Level Fullpage UI loaded.');

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const WEEKDAY_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

  let currentType = 'general';
  let calendarData = null;
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1; // 1-12
  let selectedDate = null;
  let activeView = 'month';
  let reportYear = String(new Date().getFullYear());

  // ---------------------------------------------------------------- 공통 도우미
  const $ = (id) => document.getElementById(id);

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function ymKey(y, m) {
    return `${y}-${pad2(m)}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function coverSrc(coverImage) {
    if (!coverImage || typeof coverImage !== 'string') return '';
    let clean = coverImage.trim().replace(/^[\/\\]+/, '');
    if (clean.toLowerCase().startsWith('/api/') || clean.toLowerCase().startsWith('api/')) {
      return '/' + clean.replace(/^\/+/, '');
    }
    if (clean.toLowerCase().startsWith('covers/')) {
      clean = clean.substring(7).replace(/^[\/\\]+/, '');
    }
    return clean ? `/covers/${clean}` : '';
  }

  function levelForPages(pages) {
    if (!pages || pages <= 0) return 0;
    if (pages < 20) return 1;
    if (pages < 50) return 2;
    if (pages < 100) return 3;
    return 4;
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function fmtMinutes(min) {
    min = Math.round(min || 0);
    if (min < 60) return `${min}분`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  }

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, value) {
    try {
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* 저장 불가 환경(시크릿 모드 등)에서는 조용히 무시 */ }
  }

  function isAudio() {
    return !!calendarData && calendarData.mode === 'audiobook';
  }

  function dailyOf(dateStr) {
    return (calendarData && calendarData.daily && calendarData.daily[dateStr]) || { pages: 0, minutes: 0, books: 0 };
  }

  function yearData(y) {
    return (calendarData && calendarData.years && calendarData.years[String(y)]) || null;
  }

  function availableYears() {
    const list = (calendarData && calendarData.available_years) || [];
    return list.map(String);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setHidden(ids, hidden) {
    ids.forEach((id) => {
      const el = $(id);
      if (el) el.hidden = hidden;
    });
  }

  function setNotice(message) {
    const notice = $('mrs-notice');
    const main = $('mrs-main');
    if (message) {
      notice.textContent = message;
      notice.style.display = 'block';
      main.style.display = 'none';
    } else {
      notice.style.display = 'none';
      main.style.display = '';
    }
  }

  // ---------------------------------------------------------------- 일간 목표 (이 브라우저에 저장)
  const GOAL_KEY = 'mrs_goal_v1';

  function loadGoal() {
    try {
      const g = JSON.parse(storeGet(GOAL_KEY) || 'null');
      if (g && (g.kind === 'pages' || g.kind === 'minutes') && g.value > 0) return g;
    } catch (e) { /* 손상된 값은 무시 */ }
    return null;
  }

  function goalAmount(dateStr, goal) {
    const d = dailyOf(dateStr);
    return goal.kind === 'minutes' ? d.minutes : d.pages;
  }

  function goalHit(dateStr, goal) {
    return !!goal && goalAmount(dateStr, goal) >= goal.value;
  }

  function goalUnit(goal) {
    return goal.kind === 'minutes' ? '분' : '쪽';
  }

  function renderGoal() {
    const body = $('mrs-goal-body');
    const goal = loadGoal();
    if (!calendarData) return;
    if (!goal) {
      body.innerHTML = '<p class="mrs-panel-note">하루 목표를 정해 보세요. 달성한 날은 달력에 표시됩니다.</p>';
      return;
    }
    const today = calendarData.today;
    const done = goalAmount(today, goal);
    const pct = Math.min(100, Math.round((done / goal.value) * 100));
    let monthHits = 0;
    const key = ymKey(viewYear, viewMonth);
    Object.keys(calendarData.daily || {}).forEach((d) => {
      if (d.startsWith(key) && goalHit(d, goal)) monthHits += 1;
    });
    body.innerHTML = `
      <div class="mrs-goal-line">
        <span>오늘 <b>${fmtNum(done)}</b> / ${fmtNum(goal.value)}${goalUnit(goal)}</span>
        <span class="mrs-goal-pct${pct >= 100 ? ' done' : ''}">${pct >= 100 ? '오늘의 목표 완료!' : pct + '%'}</span>
      </div>
      <div class="mrs-progress"><div class="mrs-progress-fill${pct >= 100 ? ' done' : ''}" style="width:${pct}%"></div></div>
      <p class="mrs-panel-note">${viewMonth}월 목표 달성 ${monthHits}일</p>
    `;
  }

  function bindGoalForm() {
    $('mrs-goal-edit').addEventListener('click', () => {
      const form = $('mrs-goal-form');
      const goal = loadGoal();
      $('mrs-goal-kind').value = goal ? goal.kind : 'pages';
      $('mrs-goal-value').value = goal ? goal.value : '';
      form.hidden = !form.hidden;
    });
    $('mrs-goal-cancel').addEventListener('click', () => { $('mrs-goal-form').hidden = true; });
    $('mrs-goal-clear').addEventListener('click', () => {
      storeSet(GOAL_KEY, null);
      $('mrs-goal-form').hidden = true;
      renderGoal(); renderWeek(); renderCalendar();
    });
    $('mrs-goal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = parseInt($('mrs-goal-value').value, 10);
      if (!(value > 0)) return;
      storeSet(GOAL_KEY, JSON.stringify({ kind: $('mrs-goal-kind').value, value }));
      $('mrs-goal-form').hidden = true;
      renderGoal(); renderWeek(); renderCalendar();
    });
  }

  // ---------------------------------------------------------------- 데이터 불러오기
  function fetchStatsData(type) {
    fetch(`/api/media/dashboard/widgets/my_reading_summary/data?type=${type}`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          setNotice(data.error || '독서 통계를 불러올 수 없습니다.');
          return;
        }
        setNotice(null);
        calendarData = data.calendar || null;
        if (!calendarData) return;

        const [ty, tm] = String(calendarData.this_month || '').split('-');
        if (ty && tm) {
          viewYear = parseInt(ty, 10);
          viewMonth = parseInt(tm, 10);
        }
        const years = availableYears();
        reportYear = years.includes(String(viewYear)) ? String(viewYear) : (years[0] || String(viewYear));
        selectedDate = null;
        renderAll();
      })
      .catch(err => {
        console.error('[MyReadingSummary-Plugin] Fetch stats failed:', err);
        setNotice('독서 통계를 불러오는 중 오류가 발생했습니다.');
      });
  }

  function renderAll() {
    renderSummary();
    renderWeek();
    renderGoal();
    renderCalendar();
    renderDetail(null);
    renderCategoryList();
    renderYear();
    renderRewind();
    // 오디오북은 일별 청취 기록이 없어 일부 카드/패널이 의미가 없다.
    setHidden(['mrs-card-pages', 'mrs-card-minutes', 'mrs-card-days', 'mrs-card-streak', 'mrs-week-goal-row'], isAudio());
    $('mrs-export-csv').hidden = isAudio();
  }

  // ---------------------------------------------------------------- 월간 화면
  function renderSummary() {
    if (!calendarData) return;
    const key = ymKey(viewYear, viewMonth);
    const m = calendarData.monthly[key] || { pages: 0, minutes: 0, active_days: 0, completed_books: 0 };
    $('mrs-month-pages').textContent = `${fmtNum(m.pages)}쪽`;
    $('mrs-month-minutes').textContent = fmtMinutes(m.minutes);
    $('mrs-month-days').textContent = `${m.active_days || 0}일`;
    $('mrs-month-completed').textContent = `${m.completed_books || 0}권`;

    const streak = calendarData.streak || { current: 0, longest: 0 };
    $('mrs-streak').textContent = `${streak.current}일 (최장 ${streak.longest}일)`;
    const detail = calendarData.streak_detail;
    let sub = '';
    if (detail && detail.current && detail.current.length > 0) {
      sub = `${fmtShortDate(detail.current.start)} ~ ${fmtShortDate(detail.current.end)} 진행 중`;
    } else {
      sub = '오늘 읽으면 새 기록이 시작돼요';
    }
    if (detail && detail.longest && detail.longest.length > 0) {
      sub += ` · 최장 ${fmtShortDate(detail.longest.start)}~${fmtShortDate(detail.longest.end)}`;
    }
    $('mrs-streak-range').textContent = sub;
  }

  function renderWeek() {
    const strip = $('mrs-week-strip');
    if (!calendarData) return;
    const goal = loadGoal();
    const [ty, tm, td] = calendarData.today.split('-').map(Number);
    const base = new Date(ty, tm - 1, td);
    strip.innerHTML = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const v = dailyOf(ds);
      const item = document.createElement('div');
      item.className = 'mrs-week-item' + (i === 0 ? ' today' : '') + (v.pages > 0 ? ' read' : '') + (goalHit(ds, goal) ? ' goal' : '');
      item.title = `${ds} · ${fmtNum(v.pages)}쪽 · ${fmtMinutes(v.minutes)}`;
      item.innerHTML = `
        <span class="mrs-week-wd">${WEEKDAYS[d.getDay()]}</span>
        <span class="mrs-week-dot">${v.pages > 0 ? '<i class="fa-solid fa-check"></i>' : ''}</span>
        <span class="mrs-week-pages">${v.pages > 0 ? fmtNum(v.pages) + '쪽' : '-'}</span>
      `;
      strip.appendChild(item);
    }
  }

  function renderCategoryList() {
    const list = $('mrs-category-list');
    if (!calendarData) return;

    const categories = calendarData.completed_by_category || [];
    if (categories.length === 0) {
      list.innerHTML = '<p class="mrs-panel-note">완독 기록이 없습니다.</p>';
      return;
    }

    list.innerHTML = '';
    categories.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'mrs-category-item';
      row.innerHTML = `
        <span class="mrs-category-name">${escapeHtml(cat.category_name)}</span>
        <span class="mrs-category-count">${cat.completed_count}권</span>
      `;
      list.appendChild(row);
    });
  }

  function renderCalendar() {
    if (!calendarData) return;
    $('mrs-cal-month-label').textContent = `${viewYear}년 ${viewMonth}월`;

    const grid = $('mrs-cal-grid');
    grid.innerHTML = '';

    const goal = loadGoal();
    const showCovers = $('mrs-opt-covers').checked;
    const firstDay = new Date(viewYear, viewMonth - 1, 1);
    const startWeekday = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const todayStr = calendarData.today;

    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'mrs-cal-cell empty';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${pad2(viewMonth)}-${pad2(day)}`;
      const dayData = calendarData.daily[dateStr];
      const pages = dayData ? dayData.pages : 0;
      const level = levelForPages(pages);
      const completed = calendarData.completed_by_date[dateStr] || [];
      const hasCompleted = completed.length > 0;
      const cover = showCovers && hasCompleted ? coverSrc(completed[0].cover_image) : '';

      const cell = document.createElement('div');
      cell.className = `mrs-cal-cell has-day level-${level}`;
      if (dateStr === todayStr) cell.classList.add('today');
      if (dateStr === selectedDate) cell.classList.add('selected');
      if (goalHit(dateStr, goal)) cell.classList.add('goal-hit');
      if (cover) {
        cell.classList.add('has-cover');
        cell.style.backgroundImage = `linear-gradient(rgba(15,23,42,0.35), rgba(15,23,42,0.55)), url("${cover.replace(/"/g, '%22')}")`;
      }
      cell.dataset.date = dateStr;

      const num = document.createElement('span');
      num.className = 'mrs-cal-day-num';
      num.textContent = String(day);
      cell.appendChild(num);

      if (pages > 0) {
        const pagesEl = document.createElement('span');
        pagesEl.className = 'mrs-cal-day-pages';
        pagesEl.textContent = `${pages}쪽`;
        cell.appendChild(pagesEl);
      }

      if (hasCompleted) {
        const dot = document.createElement('span');
        dot.className = 'mrs-cal-completed-dot';
        cell.appendChild(dot);
        if (completed.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'mrs-cal-count-badge';
          badge.textContent = `+${completed.length}`;
          cell.appendChild(badge);
        }
      }

      cell.addEventListener('click', () => {
        selectedDate = dateStr;
        renderCalendar();
        renderDetail(dateStr);
      });

      grid.appendChild(cell);
    }
  }

  function detailRow(item, extraMeta, completed) {
    const src = coverSrc(item.cover_image);
    const row = document.createElement('div');
    row.className = `mrs-detail-item${completed ? ' completed' : ''}`;
    const coverHtml = src
      ? `<img class="mrs-detail-cover" src="${escapeHtml(src)}" alt="">`
      : `<div class="mrs-detail-cover placeholder"><i class="fa-solid fa-book"></i></div>`;
    row.innerHTML = `
      ${coverHtml}
      <div class="mrs-detail-info">
        <span class="mrs-detail-title">${escapeHtml(item.title)}</span>
        <span class="mrs-detail-meta">${escapeHtml(item.series_name || '기타 단행본')}${extraMeta ? ' · ' + extraMeta : ''}</span>
      </div>
      ${completed ? '<span class="mrs-detail-badge"><i class="fa-solid fa-circle-check"></i> 완독</span>' : ''}
    `;
    return row;
  }

  function renderDetail(dateStr) {
    const title = $('mrs-detail-title');
    const list = $('mrs-detail-list');

    if (!dateStr || !calendarData) {
      title.innerHTML = '<i class="fa-solid fa-book-open-reader"></i> 날짜를 선택하세요';
      list.innerHTML = '<p class="mrs-panel-note">캘린더에서 날짜를 클릭하면 그날 읽은 책과 완독 도서가 표시됩니다.</p>';
      return;
    }

    const day = dailyOf(dateStr);
    const goal = loadGoal();
    let head = `<i class="fa-solid fa-book-open-reader"></i> ${dateStr} 독서 기록`;
    if (day.pages > 0) head += ` <span class="mrs-detail-total">· ${fmtNum(day.pages)}쪽 · ${fmtMinutes(day.minutes)}</span>`;
    if (goalHit(dateStr, goal)) head += ' <span class="mrs-detail-goal"><i class="fa-solid fa-bullseye"></i> 목표 달성</span>';
    title.innerHTML = head;

    const detail = calendarData.detail_by_date[dateStr] || [];
    const completed = calendarData.completed_by_date[dateStr] || [];
    const completedIds = new Set(completed.map(b => b.book_id));

    if (detail.length === 0 && completed.length === 0) {
      list.innerHTML = '<p class="mrs-panel-note">이 날짜에는 독서 기록이 없습니다.</p>';
      return;
    }

    list.innerHTML = '';
    detail.forEach(item => {
      list.appendChild(detailRow(item, `${item.pages}쪽 · 약 ${item.minutes}분`, completedIds.has(item.book_id)));
    });

    // 그날 읽은 로그는 없지만 완독으로만 표기된 도서(예: 다른 기기에서 완료 처리)
    completed.forEach(item => {
      if (detail.some(d => d.book_id === item.book_id)) return;
      list.appendChild(detailRow(item, '', true));
    });
  }

  // ---------------------------------------------------------------- 연간 화면
  function stepYear(delta) {
    const years = availableYears();
    // 목록은 최신순이므로 이전 해 = 인덱스 +1
    let idx = years.indexOf(reportYear);
    if (idx < 0) idx = 0;
    const next = idx + (delta < 0 ? 1 : -1);
    if (next < 0 || next >= years.length) return;
    reportYear = years[next];
    renderYear();
    renderRewind();
  }

  function renderNavState(prevId, nextId, labelId) {
    const years = availableYears();
    const idx = years.indexOf(reportYear);
    $(labelId).textContent = `${reportYear}년`;
    $(prevId).disabled = idx < 0 || idx >= years.length - 1;
    $(nextId).disabled = idx <= 0;
  }

  function statCard(label, value, sub, highlight) {
    return `<div class="mrs-summary-card${highlight ? ' highlight' : ''}">
      <span class="mrs-summary-label">${label}</span>
      <h3 class="mrs-summary-value">${value}</h3>
      ${sub ? `<span class="mrs-summary-sub">${sub}</span>` : ''}
    </div>`;
  }

  function ygoalKey() {
    return `mrs_ygoal_${currentType}_${reportYear}`;
  }

  function renderYearGoal(y) {
    const body = $('mrs-ygoal-body');
    const goal = parseInt(storeGet(ygoalKey()) || '0', 10);
    if (!(goal > 0)) {
      body.innerHTML = '<p class="mrs-panel-note">올해 완독 목표 권수를 정해 보세요.</p>';
      return;
    }
    const done = y ? y.completed_books : 0;
    const pct = Math.min(100, Math.round((done / goal) * 100));
    body.innerHTML = `
      <div class="mrs-goal-line">
        <span><b>${done}</b> / ${goal}권</span>
        <span class="mrs-goal-pct${pct >= 100 ? ' done' : ''}">${pct >= 100 ? '올해 목표 완료!' : pct + '%'}</span>
      </div>
      <div class="mrs-progress"><div class="mrs-progress-fill${pct >= 100 ? ' done' : ''}" style="width:${pct}%"></div></div>
    `;
  }

  function renderMonthBars(y) {
    const wrap = $('mrs-month-bars');
    const audio = isAudio();
    $('mrs-month-chart-title').textContent = audio ? '월별 완독 권수' : '월별 독서량 (쪽)';
    const vals = y.months.map(m => (audio ? m.completed_books : m.pages));
    const max = Math.max(1, ...vals);
    wrap.innerHTML = '';
    y.months.forEach((m, i) => {
      const v = vals[i];
      const col = document.createElement('div');
      col.className = 'mrs-bar-col' + (v === max && v > 0 ? ' peak' : '');
      col.title = `${i + 1}월 · ${fmtNum(m.pages)}쪽 · ${fmtMinutes(m.minutes)} · ${m.active_days}일 · 완독 ${m.completed_books}권`;
      col.innerHTML = `
        <span class="mrs-bar-val">${v > 0 ? fmtNum(v) : ''}</span>
        <div class="mrs-bar-track"><div class="mrs-bar" style="height:${Math.round((v / max) * 100)}%"></div></div>
        <span class="mrs-bar-label">${i + 1}월</span>
        <span class="mrs-bar-done">${!audio && m.completed_books > 0 ? '<i class="fa-solid fa-circle"></i>' + m.completed_books : ''}</span>
      `;
      wrap.appendChild(col);
    });
  }

  function renderWeekdayBars(y) {
    const wrap = $('mrs-weekday-bars');
    const max = Math.max(1, ...y.weekdays.map(w => w.pages));
    const top = y.weekdays.reduce((best, w, i) => (w.pages > y.weekdays[best].pages ? i : best), 0);
    wrap.innerHTML = '';
    // 월요일부터 보여준다 (일요일=0 이므로 1..6,0 순서)
    [1, 2, 3, 4, 5, 6, 0].forEach(i => {
      const w = y.weekdays[i];
      const row = document.createElement('div');
      row.className = 'mrs-hbar-row' + (i === top && w.pages > 0 ? ' peak' : '');
      row.innerHTML = `
        <span class="mrs-hbar-label">${WEEKDAYS[i]}</span>
        <div class="mrs-hbar-track"><div class="mrs-hbar" style="width:${Math.round((w.pages / max) * 100)}%"></div></div>
        <span class="mrs-hbar-val">${fmtNum(w.pages)}쪽 · ${w.days}일</span>
      `;
      wrap.appendChild(row);
    });
  }

  function renderHeatmap() {
    const heat = $('mrs-heat');
    const labels = $('mrs-heat-months');
    const year = parseInt(reportYear, 10);
    const jan1 = new Date(year, 0, 1);
    const offset = jan1.getDay();
    const todayStr = calendarData.today;
    heat.innerHTML = '';
    labels.innerHTML = '';

    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('span');
      blank.className = 'mrs-heat-cell blank';
      heat.appendChild(blank);
    }
    const daysInYear = (new Date(year, 11, 31) - jan1) / 86400000 + 1;
    let monthStarts = [];
    for (let n = 0; n < daysInYear; n++) {
      const d = new Date(year, 0, 1 + n);
      const ds = `${year}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const v = dailyOf(ds);
      const cell = document.createElement('span');
      cell.className = `mrs-heat-cell level-${levelForPages(v.pages)}` + (ds > todayStr ? ' future' : '') + (ds === todayStr ? ' today' : '');
      cell.title = v.pages > 0 ? `${ds} · ${fmtNum(v.pages)}쪽 · ${fmtMinutes(v.minutes)}` : ds;
      heat.appendChild(cell);
      if (d.getDate() === 1) monthStarts.push({ month: d.getMonth() + 1, col: Math.floor((offset + n) / 7) });
    }
    monthStarts.forEach(ms => {
      const lab = document.createElement('span');
      lab.className = 'mrs-heat-month';
      lab.style.gridColumn = `${ms.col + 1} / span 3`;
      lab.textContent = `${ms.month}월`;
      labels.appendChild(lab);
    });
  }

  function rankRows(el, rows, kind, emptyText) {
    el.innerHTML = '';
    if (!rows || rows.length === 0) {
      el.innerHTML = `<p class="mrs-panel-note">${emptyText || '기록이 없습니다.'}</p>`;
      return;
    }
    const max = Math.max(1, ...rows.map(r => r.minutes || r.pages));
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'mrs-rank-item';
      const bar = Math.round(((r.minutes || r.pages) / max) * 100);
      if (kind === 'book') {
        const src = coverSrc(r.cover_image);
        const cover = src
          ? `<img class="mrs-rank-cover" src="${escapeHtml(src)}" alt="">`
          : '<div class="mrs-rank-cover placeholder"><i class="fa-solid fa-book"></i></div>';
        row.innerHTML = `
          <span class="mrs-rank-no">${i + 1}</span>${cover}
          <div class="mrs-rank-info">
            <span class="mrs-rank-title">${escapeHtml(r.title)}</span>
            <span class="mrs-rank-meta">${escapeHtml(r.series_name || '기타 단행본')} · ${fmtNum(r.pages)}쪽 · ${fmtMinutes(r.minutes)} · ${r.days}일</span>
            <div class="mrs-rank-bar"><span style="width:${bar}%"></span></div>
          </div>`;
      } else {
        row.innerHTML = `
          <span class="mrs-rank-no">${i + 1}</span>
          <div class="mrs-rank-info">
            <span class="mrs-rank-title">${escapeHtml(r.name)}</span>
            <span class="mrs-rank-meta">${fmtNum(r.pages)}쪽 · ${fmtMinutes(r.minutes)} · ${r.books}권</span>
            <div class="mrs-rank-bar"><span style="width:${bar}%"></span></div>
          </div>`;
      }
      el.appendChild(row);
    });
  }

  function renderWall(el, items, limit) {
    el.innerHTML = '';
    if (!items || items.length === 0) {
      el.innerHTML = '<p class="mrs-panel-note">완독한 책이 없습니다.</p>';
      return;
    }
    items.slice(0, limit).forEach(b => {
      const src = coverSrc(b.cover_image);
      const tile = document.createElement('div');
      tile.className = 'mrs-wall-item';
      tile.title = `${b.title} · ${b.date || ''}`;
      tile.innerHTML = src
        ? `<img src="${escapeHtml(src)}" alt="" loading="lazy">`
        : '<div class="mrs-wall-ph"><i class="fa-solid fa-book"></i></div>';
      el.appendChild(tile);
    });
    if (items.length > limit) {
      const more = document.createElement('div');
      more.className = 'mrs-wall-more';
      more.textContent = `+${items.length - limit}권`;
      el.appendChild(more);
    }
  }

  function renderYear() {
    if (!calendarData) return;
    renderNavState('mrs-year-prev', 'mrs-year-next', 'mrs-year-label');
    const y = yearData(reportYear);
    const empty = !y || (y.pages === 0 && y.completed_books === 0);
    $('mrs-year-empty').hidden = !empty;
    $('mrs-year-body').hidden = empty;
    if (empty) return;

    const audio = isAudio();
    const cards = audio
      ? [statCard('완독 권수', `${y.completed_books}권`, '', true)]
      : [
        statCard('총 독서 페이지', `${fmtNum(y.pages)}쪽`),
        statCard('총 독서 시간', fmtMinutes(y.minutes)),
        statCard('독서일수', `${y.active_days}일`, `하루 평균 ${fmtNum(y.avg_pages_per_active_day)}쪽 · ${fmtMinutes(y.avg_minutes_per_active_day)}`),
        statCard('완독 권수', `${y.completed_books}권`, '', true),
        statCard('읽는 속도', `${y.pace_pages_per_min || 0}쪽/분`, y.pace_pages_per_min ? `1쪽에 약 ${Math.round(60 / y.pace_pages_per_min)}초` : ''),
        statCard('최장 연속 독서', `${y.longest_streak.length}일`, y.longest_streak.length ? `${fmtShortDate(y.longest_streak.start)} ~ ${fmtShortDate(y.longest_streak.end)}` : ''),
      ];
    $('mrs-year-cards').innerHTML = cards.join('');

    renderYearGoal(y);
    renderMonthBars(y);
    renderWeekdayBars(y);
    renderHeatmap();
    rankRows($('mrs-top-books'), y.top_books, 'book');
    rankRows($('mrs-top-series'), y.top_series, 'name');
    rankRows($('mrs-top-cats'), y.top_categories, 'name');
    rankRows($('mrs-top-formats'), y.by_format, 'name');
    $('mrs-wall-title').textContent = `${reportYear}년에 완독한 책 (${y.completed_books}권)`;
    renderWall($('mrs-year-wall'), y.completed, 60);

    // 오디오북은 쪽/시간 기반 패널이 의미가 없다.
    setHidden(['mrs-heat-panel'], audio);
    ['mrs-weekday-bars', 'mrs-top-books', 'mrs-top-series', 'mrs-top-formats'].forEach(id => {
      const panel = $(id) && $(id).closest('.mrs-panel');
      if (panel) panel.hidden = audio;
    });
  }

  // ---------------------------------------------------------------- 리와인드
  function rewindFacts(y) {
    const facts = [];
    if (y.best_month) facts.push(`가장 많이 읽은 달은 ${y.best_month.month}월 (${fmtNum(y.best_month.pages)}쪽)`);
    const topWd = y.weekdays.reduce((best, w, i) => (w.pages > y.weekdays[best].pages ? i : best), 0);
    if (y.weekdays[topWd].pages > 0) facts.push(`가장 많이 읽은 요일은 ${WEEKDAY_FULL[topWd]}`);
    if (y.best_day) facts.push(`최고의 하루는 ${y.best_day.date} (${fmtNum(y.best_day.pages)}쪽 · ${fmtMinutes(y.best_day.minutes)})`);
    if (y.top_series[0]) facts.push(`가장 오래 함께한 시리즈: ${y.top_series[0].name}`);
    if (y.top_categories[0]) facts.push(`가장 많이 읽은 카테고리: ${y.top_categories[0].name}`);
    return facts;
  }

  function rewindText(y) {
    const lines = [`${reportYear} 독서 리와인드`, ''];
    lines.push(`완독 ${y.completed_books}권`);
    if (!isAudio()) {
      lines.push(`읽은 시간 ${fmtMinutes(y.minutes)} · ${fmtNum(y.pages)}쪽 · 독서일 ${y.active_days}일`);
      lines.push(`최장 연속 ${y.longest_streak.length}일`);
    }
    rewindFacts(y).forEach(f => lines.push(`- ${f}`));
    if (y.top_books.length) {
      lines.push('', '많이 읽은 책');
      y.top_books.slice(0, 3).forEach((b, i) => lines.push(`${i + 1}. ${b.title}`));
    }
    return lines.join('\n');
  }

  function renderRewind() {
    if (!calendarData) return;
    renderNavState('mrs-rw-prev', 'mrs-rw-next', 'mrs-rw-label');
    const y = yearData(reportYear);
    const empty = !y || (y.pages === 0 && y.completed_books === 0);
    $('mrs-rw-empty').hidden = !empty;
    $('mrs-rw-body').hidden = empty;
    $('mrs-rw-hint').textContent = '';
    if (empty) return;

    const audio = isAudio();
    const tiles = audio ? '' : `
      <div class="mrs-rw-tiles">
        <div><b>${fmtMinutes(y.minutes)}</b><span>읽은 시간</span></div>
        <div><b>${fmtNum(y.pages)}쪽</b><span>읽은 페이지</span></div>
        <div><b>${y.active_days}일</b><span>독서한 날</span></div>
        <div><b>${y.longest_streak.length}일</b><span>최장 연속</span></div>
      </div>`;
    const facts = rewindFacts(y).map(f => `<li>${escapeHtml(f)}</li>`).join('');
    const tops = y.top_books.slice(0, 3).map((b, i) => {
      const src = coverSrc(b.cover_image);
      return `<div class="mrs-rw-top">
        <span class="mrs-rw-rank">${i + 1}</span>
        ${src ? `<img src="${escapeHtml(src)}" alt="">` : '<div class="mrs-rw-ph"><i class="fa-solid fa-book"></i></div>'}
        <span class="mrs-rw-top-title">${escapeHtml(b.title)}</span>
      </div>`;
    }).join('');
    const wall = (y.completed || []).slice(0, 12).map(b => {
      const src = coverSrc(b.cover_image);
      return src ? `<img src="${escapeHtml(src)}" alt="">` : '<div class="mrs-rw-ph"><i class="fa-solid fa-book"></i></div>';
    }).join('');

    $('mrs-rewind-card').innerHTML = `
      <div class="mrs-rw-head"><span class="mrs-rw-year">${reportYear}</span><span class="mrs-rw-sub">독서 리와인드</span></div>
      <div class="mrs-rw-hero"><span class="mrs-rw-hero-num">${y.completed_books}</span><span class="mrs-rw-hero-unit">권 완독</span></div>
      ${tiles}
      ${facts ? `<ul class="mrs-rw-facts">${facts}</ul>` : ''}
      ${tops ? `<div class="mrs-rw-section">많이 읽은 책</div><div class="mrs-rw-tops">${tops}</div>` : ''}
      ${wall ? `<div class="mrs-rw-section">완독한 책들</div><div class="mrs-rw-wall">${wall}</div>` : ''}
      <div class="mrs-rw-foot">BookOasis · 내 독서 요약</div>
    `;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawCover(ctx, img, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h);
    ctx.clip();
    if (img) {
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  function fitText(ctx, text, maxWidth) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  async function saveRewindImage() {
    const y = yearData(reportYear);
    if (!y) return;
    const hint = $('mrs-rw-hint');
    hint.textContent = '이미지를 만드는 중...';
    try {
      const W = 1080;
      // 내용에 맞춰 높이를 계산한다 (머리말 520 + 요약 타일 + 사실 목록 + 많이 읽은 책 + 완독 표지 벽 + 하단)
      const WALL_COLS = 6;
      const wallCw = (W - 160 - (WALL_COLS - 1) * 12) / WALL_COLS;
      const wallCh = wallCw * 1.42;
      const factCount = Math.min(4, rewindFacts(y).length);
      const topCount = Math.min(3, y.top_books.length);
      const wallCount = Math.min(12, (y.completed || []).length);
      const wallRows = Math.ceil(wallCount / WALL_COLS);
      const H = Math.ceil(
        520 + (isAudio() ? 0 : 190) + factCount * 50 + 30 +
        (topCount ? 24 + 290 + 100 : 0) +
        (wallRows ? 24 + wallRows * (wallCh + 12) + 20 : 0) + 90
      );
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const font = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0f172a');
      g.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#93c5fd';
      ctx.font = `700 64px ${font}`;
      ctx.fillText(reportYear, 80, 130);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `600 40px ${font}`;
      ctx.fillText('독서 리와인드', 80, 190);

      ctx.fillStyle = '#f8fafc';
      ctx.font = `800 220px ${font}`;
      ctx.fillText(String(y.completed_books), 80, 430);
      const numW = ctx.measureText(String(y.completed_books)).width;
      ctx.font = `700 64px ${font}`;
      ctx.fillStyle = '#4ade80';
      ctx.fillText('권 완독', 80 + numW + 24, 430);

      let cursorY = 520;
      if (!isAudio()) {
        const tiles = [
          [fmtMinutes(y.minutes), '읽은 시간'],
          [`${fmtNum(y.pages)}쪽`, '읽은 페이지'],
          [`${y.active_days}일`, '독서한 날'],
          [`${y.longest_streak.length}일`, '최장 연속'],
        ];
        const tw = (W - 160 - 3 * 20) / 4;
        tiles.forEach((t, i) => {
          const x = 80 + i * (tw + 20);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, cursorY, tw, 130, 16); else ctx.rect(x, cursorY, tw, 130);
          ctx.fill();
          ctx.fillStyle = '#f8fafc';
          ctx.font = `700 34px ${font}`;
          ctx.fillText(fitText(ctx, t[0], tw - 24), x + 16, cursorY + 56);
          ctx.fillStyle = '#94a3b8';
          ctx.font = `500 24px ${font}`;
          ctx.fillText(t[1], x + 16, cursorY + 100);
        });
        cursorY += 190;
      }

      ctx.font = `500 30px ${font}`;
      rewindFacts(y).slice(0, 4).forEach(f => {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText('· ' + fitText(ctx, f, W - 200), 80, cursorY);
        cursorY += 50;
      });
      cursorY += 30;

      const tops = y.top_books.slice(0, 3);
      if (tops.length) {
        ctx.fillStyle = '#93c5fd';
        ctx.font = `700 30px ${font}`;
        ctx.fillText('많이 읽은 책', 80, cursorY);
        cursorY += 24;
        const imgs = await Promise.all(tops.map(b => loadImage(coverSrc(b.cover_image))));
        const cw = 200;
        const ch = 290;
        const gap = (W - 160 - 3 * cw) / 2;
        tops.forEach((b, i) => {
          const x = 80 + i * (cw + gap);
          drawCover(ctx, imgs[i], x, cursorY, cw, ch);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = `600 24px ${font}`;
          ctx.fillText(fitText(ctx, `${i + 1}. ${b.title}`, cw + gap - 10), x, cursorY + ch + 36);
        });
        cursorY += ch + 100;
      }

      const wall = (y.completed || []).slice(0, 12);
      if (wall.length) {
        ctx.fillStyle = '#93c5fd';
        ctx.font = `700 30px ${font}`;
        ctx.fillText('완독한 책들', 80, cursorY);
        cursorY += 24;
        const imgs = await Promise.all(wall.map(b => loadImage(coverSrc(b.cover_image))));
        wall.forEach((b, i) => {
          const r = Math.floor(i / WALL_COLS);
          const c = i % WALL_COLS;
          drawCover(ctx, imgs[i], 80 + c * (wallCw + 12), cursorY + r * (wallCh + 12), wallCw, wallCh);
        });
      }

      ctx.fillStyle = '#64748b';
      ctx.font = `500 24px ${font}`;
      ctx.fillText('BookOasis · 내 독서 요약', 80, H - 40);

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('이미지 생성 실패');
      downloadBlob(`독서리와인드_${reportYear}.png`, blob);
      hint.textContent = '이미지를 저장했어요.';
    } catch (e) {
      console.error('[MyReadingSummary-Plugin] 리와인드 이미지 생성 실패:', e);
      hint.textContent = '이미지를 만들지 못했습니다. (표지를 불러오지 못했을 수 있어요)';
    }
  }

  async function copyRewindText() {
    const y = yearData(reportYear);
    const hint = $('mrs-rw-hint');
    if (!y) return;
    const text = rewindText(y);
    try {
      await navigator.clipboard.writeText(text);
      hint.textContent = '복사했어요.';
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); hint.textContent = '복사했어요.'; } catch (e2) { hint.textContent = '복사하지 못했습니다.'; }
      ta.remove();
    }
  }

  // ---------------------------------------------------------------- 내보내기
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    if (!calendarData) return;
    const completedByDate = calendarData.completed_by_date || {};
    const rows = [['날짜', '제목', '시리즈', '형식', '읽은 페이지', '읽은 시간(분)', '완독']];
    Object.keys(calendarData.detail_by_date || {}).sort().forEach(d => {
      const done = new Set((completedByDate[d] || []).map(b => b.book_id));
      calendarData.detail_by_date[d].forEach(it => {
        rows.push([d, it.title, it.series_name, it.file_format, it.pages, it.minutes, done.has(it.book_id) ? 'O' : '']);
      });
    });
    const body = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadBlob(`독서기록_${currentType}.csv`, new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  }

  function exportMarkdown() {
    const y = yearData(reportYear);
    if (!calendarData || !y) return;
    const L = [`# ${reportYear}년 독서 요약`, ''];
    if (!isAudio()) {
      L.push(`- 읽은 페이지: ${fmtNum(y.pages)}쪽`, `- 읽은 시간: ${fmtMinutes(y.minutes)}`, `- 독서일수: ${y.active_days}일`);
    }
    L.push(`- 완독: ${y.completed_books}권`);
    if (!isAudio()) {
      L.push(`- 최장 연속 독서: ${y.longest_streak.length}일${y.longest_streak.length ? ` (${y.longest_streak.start} ~ ${y.longest_streak.end})` : ''}`);
      L.push('', '## 월별', '', '| 월 | 페이지 | 시간 | 독서일 | 완독 |', '|---|---:|---:|---:|---:|');
      y.months.forEach((m, i) => L.push(`| ${i + 1}월 | ${fmtNum(m.pages)} | ${fmtMinutes(m.minutes)} | ${m.active_days} | ${m.completed_books} |`));
      const sec = (title, rows, fmt) => {
        if (!rows || !rows.length) return;
        L.push('', `## ${title}`, '');
        rows.forEach((r, i) => L.push(`${i + 1}. ${fmt(r)}`));
      };
      sec('많이 읽은 책 Top 5', y.top_books, r => `${r.title} — ${fmtNum(r.pages)}쪽, ${fmtMinutes(r.minutes)}`);
      sec('시리즈 Top 5', y.top_series, r => `${r.name} — ${fmtNum(r.pages)}쪽, ${r.books}권`);
      sec('카테고리 Top 5', y.top_categories, r => `${r.name} — ${fmtNum(r.pages)}쪽, ${r.books}권`);
    }
    if (y.completed.length) {
      L.push('', '## 완독한 책', '');
      y.completed.forEach(b => L.push(`- ${b.date} · ${b.title}${b.series_name && b.series_name !== b.title ? ` (${b.series_name})` : ''}`));
    }
    downloadBlob(`독서요약_${reportYear}.md`, new Blob([L.join('\n') + '\n'], { type: 'text/markdown;charset=utf-8' }));
  }

  // ---------------------------------------------------------------- 이벤트 연결
  function switchView(view) {
    activeView = view;
    document.querySelectorAll('.mrs-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    ['month', 'year', 'rewind'].forEach(v => { $(`mrs-view-${v}`).hidden = v !== view; });
  }

  document.querySelectorAll('.mrs-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mrs-btn[data-type]').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      currentType = target.dataset.type || 'general';
      fetchStatsData(currentType);
    });
  });

  document.querySelectorAll('.mrs-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  function stepMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
    if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
    selectedDate = null;
    renderSummary();
    renderGoal();
    renderCalendar();
    renderDetail(null);
  }

  $('mrs-cal-prev').addEventListener('click', () => stepMonth(-1));
  $('mrs-cal-next').addEventListener('click', () => stepMonth(1));
  $('mrs-year-prev').addEventListener('click', () => stepYear(-1));
  $('mrs-year-next').addEventListener('click', () => stepYear(1));
  $('mrs-rw-prev').addEventListener('click', () => stepYear(-1));
  $('mrs-rw-next').addEventListener('click', () => stepYear(1));
  $('mrs-rw-save').addEventListener('click', saveRewindImage);
  $('mrs-rw-copy').addEventListener('click', copyRewindText);
  $('mrs-export-csv').addEventListener('click', exportCsv);
  $('mrs-export-md').addEventListener('click', exportMarkdown);

  $('mrs-ygoal-edit').addEventListener('click', () => {
    const current = storeGet(ygoalKey()) || '';
    const input = window.prompt(`${reportYear}년 완독 목표 권수 (비우면 목표 삭제)`, current);
    if (input === null) return;
    const n = parseInt(input, 10);
    storeSet(ygoalKey(), n > 0 ? String(n) : null);
    renderYearGoal(yearData(reportYear));
  });

  $('mrs-opt-covers').checked = storeGet('mrs_opt_covers') !== '0';
  $('mrs-opt-covers').addEventListener('change', (e) => {
    storeSet('mrs_opt_covers', e.target.checked ? '1' : '0');
    renderCalendar();
  });

  bindGoalForm();
  switchView('month');
  fetchStatsData(currentType);
})();
