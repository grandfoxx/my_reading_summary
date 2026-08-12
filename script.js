(function() {
  console.log('[MyReadingSummary-Plugin] Category-Level Fullpage UI loaded.');

  let currentType = 'general';
  let calendarData = null;
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1; // 1-12
  let selectedDate = null;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function ymKey(y, m) {
    return `${y}-${pad2(m)}`;
  }

  function coverSrc(coverImage) {
    if (!coverImage || typeof coverImage !== 'string') return '';
    let clean = coverImage.trim().replace(/^[\/\\]+/, '');
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

  function setNotice(message) {
    const notice = document.getElementById('mrs-notice');
    const main = document.getElementById('mrs-main');
    if (message) {
      notice.textContent = message;
      notice.style.display = 'block';
      main.style.display = 'none';
    } else {
      notice.style.display = 'none';
      main.style.display = '';
    }
  }

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
        selectedDate = null;
        renderSummary();
        renderCalendar();
        renderDetail(null);
        renderCategoryList();
      })
      .catch(err => {
        console.error('[MyReadingSummary-Plugin] Fetch stats failed:', err);
        setNotice('독서 통계를 불러오는 중 오류가 발생했습니다.');
      });
  }

  function renderSummary() {
    if (!calendarData) return;
    const key = ymKey(viewYear, viewMonth);
    const m = calendarData.monthly[key] || { pages: 0, active_days: 0, completed_books: 0 };
    document.getElementById('mrs-month-pages').textContent = `${(m.pages || 0).toLocaleString()}쪽`;
    document.getElementById('mrs-month-days').textContent = `${m.active_days || 0}일`;
    document.getElementById('mrs-month-completed').textContent = `${m.completed_books || 0}권`;

    const streak = calendarData.streak || { current: 0, longest: 0 };
    document.getElementById('mrs-streak').textContent = `${streak.current}일 (최장 ${streak.longest}일)`;

    // 오디오북은 일별 청취 기록이 없어 페이지/독서일수/연속 독서일 카드는 의미가 없으므로 숨긴다.
    const isAudiobook = calendarData.mode === 'audiobook';
    ['mrs-card-pages', 'mrs-card-days', 'mrs-card-streak'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isAudiobook ? 'none' : '';
    });
  }

  function renderCategoryList() {
    const list = document.getElementById('mrs-category-list');
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
    document.getElementById('mrs-cal-month-label').textContent = `${viewYear}년 ${viewMonth}월`;

    const grid = document.getElementById('mrs-cal-grid');
    grid.innerHTML = '';

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
      const hasCompleted = !!(calendarData.completed_by_date[dateStr] && calendarData.completed_by_date[dateStr].length);

      const cell = document.createElement('div');
      cell.className = `mrs-cal-cell has-day level-${level}`;
      if (dateStr === todayStr) cell.classList.add('today');
      if (dateStr === selectedDate) cell.classList.add('selected');
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
      }

      cell.addEventListener('click', () => {
        selectedDate = dateStr;
        renderCalendar();
        renderDetail(dateStr);
      });

      grid.appendChild(cell);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderDetail(dateStr) {
    const title = document.getElementById('mrs-detail-title');
    const list = document.getElementById('mrs-detail-list');

    if (!dateStr || !calendarData) {
      title.innerHTML = '<i class="fa-solid fa-book-open-reader"></i> 날짜를 선택하세요';
      list.innerHTML = '<p class="mrs-panel-note">캘린더에서 날짜를 클릭하면 그날 읽은 책과 완독 도서가 표시됩니다.</p>';
      return;
    }

    title.innerHTML = `<i class="fa-solid fa-book-open-reader"></i> ${dateStr} 독서 기록`;

    const detail = calendarData.detail_by_date[dateStr] || [];
    const completed = calendarData.completed_by_date[dateStr] || [];
    const completedIds = new Set(completed.map(b => b.book_id));

    if (detail.length === 0 && completed.length === 0) {
      list.innerHTML = '<p class="mrs-panel-note">이 날짜에는 독서 기록이 없습니다.</p>';
      return;
    }

    list.innerHTML = '';
    detail.forEach(item => {
      const src = coverSrc(item.cover_image);
      const isCompleted = completedIds.has(item.book_id);

      const row = document.createElement('div');
      row.className = `mrs-detail-item${isCompleted ? ' completed' : ''}`;

      const coverHtml = src
        ? `<img class="mrs-detail-cover" src="${src}" alt="">`
        : `<div class="mrs-detail-cover placeholder"><i class="fa-solid fa-book"></i></div>`;

      row.innerHTML = `
        ${coverHtml}
        <div class="mrs-detail-info">
          <span class="mrs-detail-title">${escapeHtml(item.title)}</span>
          <span class="mrs-detail-meta">${escapeHtml(item.series_name || '기타 단행본')} · ${item.pages}쪽 · 약 ${item.minutes}분</span>
        </div>
        ${isCompleted ? '<span class="mrs-detail-badge"><i class="fa-solid fa-circle-check"></i> 완독</span>' : ''}
      `;
      list.appendChild(row);
    });

    // 그날 읽은 로그는 없지만 완독으로만 표기된 도서(예: 다른 기기에서 완료 처리)
    completed.forEach(item => {
      if (detail.some(d => d.book_id === item.book_id)) return;
      const src = coverSrc(item.cover_image);
      const row = document.createElement('div');
      row.className = 'mrs-detail-item completed';
      const coverHtml = src
        ? `<img class="mrs-detail-cover" src="${src}" alt="">`
        : `<div class="mrs-detail-cover placeholder"><i class="fa-solid fa-book"></i></div>`;
      row.innerHTML = `
        ${coverHtml}
        <div class="mrs-detail-info">
          <span class="mrs-detail-title">${escapeHtml(item.title)}</span>
          <span class="mrs-detail-meta">${escapeHtml(item.series_name || '기타 단행본')}</span>
        </div>
        <span class="mrs-detail-badge"><i class="fa-solid fa-circle-check"></i> 완독</span>
      `;
      list.appendChild(row);
    });
  }

  document.querySelectorAll('.mrs-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mrs-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      currentType = target.dataset.type || 'general';
      fetchStatsData(currentType);
    });
  });

  document.getElementById('mrs-cal-prev').addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
    selectedDate = null;
    renderSummary();
    renderCalendar();
    renderDetail(null);
  });

  document.getElementById('mrs-cal-next').addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
    selectedDate = null;
    renderSummary();
    renderCalendar();
    renderDetail(null);
  });

  fetchStatsData(currentType);
})();
