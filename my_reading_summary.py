# -*- coding: utf-8 -*-
from datetime import date, timedelta

from plugins.metadata.base import BaseMetadataProvider

# 플러그인은 자체 라우트를 가질 수 없어 캘린더/일별 로그 전체가 단일 API 응답에
# 실려야 한다. 페이로드 크기를 억제하기 위해 조회 범위를 최근 2년으로 제한한다.
CALENDAR_HISTORY_DAYS = 730


class MyReadingSummaryProvider(BaseMetadataProvider):
    """개인 독서 캘린더 / 일간·월간 통계 위젯."""

    id = "my_reading_summary"
    name = "내 독서 요약"
    is_searchable = False
    config_schema = []
    dashboard_widget = {
        "title": "내 독서 요약",
        "subtitle": "일간/월간 독서 캘린더",
        "provider": "BookOasis",
        "icon": "fa-solid fa-calendar-days",
        "limit": 2,
        "all_desk_tab": True,
    }
    category_tab = {
        "title": "내 독서 요약",
        "icon": "fa-solid fa-calendar-days",
        "order": 91,
    }

    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/grandfoxx/my_reading_summary/master",
        "files": ["my_reading_summary.py", "__init__.py", "VERSION", "index.html", "script.js", "style.css"],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": True,
    }

    def search(self, db_type, query):
        return []

    def apply(self, db_type, book_id, item_data):
        return False, "내 독서 요약 플러그인은 메타데이터 적용을 지원하지 않습니다."

    def _current_user_id(self):
        try:
            from flask import session, has_request_context
        except Exception:
            return None
        if not has_request_context():
            return None
        return session.get("user_id")

    @staticmethod
    def _col(row, key, idx):
        return row[key] if isinstance(row, dict) else row[idx]

    def _fetch_calendar(self, db_type, user_id):
        gateway = self.get_db_gateway(db_type)
        cutoff = (date.today() - timedelta(days=CALENDAR_HISTORY_DAYS)).strftime("%Y-%m-%d")
        col = self._col

        daily_rows = gateway.fetch_all(
            """
            SELECT read_date,
                   SUM(pages_read_delta) AS pages,
                   SUM(duration_seconds) AS secs,
                   COUNT(DISTINCT book_id) AS books
            FROM user_reading_log
            WHERE user_id = ?
              AND read_date >= ?
            GROUP BY read_date
            ORDER BY read_date
            """,
            (user_id, cutoff),
        ) or []

        completed_rows = gateway.fetch_all(
            """
            SELECT b.id AS book_id, b.title, b.series_name, b.cover_image, b.file_format,
                   DATE(p.last_read_at) AS completed_date
            FROM user_progress p
            JOIN books b ON b.id = p.book_id
            WHERE p.user_id = ?
              AND COALESCE(p.is_completed, 0) = 1
              AND COALESCE(b.is_deleted, 0) = 0
              AND DATE(p.last_read_at) >= ?
            """,
            (user_id, cutoff),
        ) or []

        detail_rows = gateway.fetch_all(
            """
            SELECT l.read_date, b.id AS book_id, b.title, b.series_name, b.cover_image, b.file_format,
                   l.pages_read_delta AS pages, l.duration_seconds AS secs
            FROM user_reading_log l
            JOIN books b ON b.id = l.book_id
            WHERE l.user_id = ?
              AND l.read_date >= ?
              AND COALESCE(b.is_deleted, 0) = 0
            ORDER BY l.read_date DESC, l.pages_read_delta DESC
            """,
            (user_id, cutoff),
        ) or []

        daily = {}
        for r in daily_rows:
            d = str(col(r, "read_date", 0))
            daily[d] = {
                "pages": int(col(r, "pages", 1) or 0),
                "minutes": round(int(col(r, "secs", 2) or 0) / 60),
                "books": int(col(r, "books", 3) or 0),
            }

        completed_by_date = {}
        for r in completed_rows:
            d = str(col(r, "completed_date", 5))
            completed_by_date.setdefault(d, []).append({
                "book_id": col(r, "book_id", 0),
                "title": col(r, "title", 1),
                "series_name": col(r, "series_name", 2) or "",
                "cover_image": col(r, "cover_image", 3) or "",
                "file_format": col(r, "file_format", 4) or "",
            })

        detail_by_date = {}
        for r in detail_rows:
            d = str(col(r, "read_date", 0))
            detail_by_date.setdefault(d, []).append({
                "book_id": col(r, "book_id", 1),
                "title": col(r, "title", 2),
                "series_name": col(r, "series_name", 3) or "",
                "cover_image": col(r, "cover_image", 4) or "",
                "file_format": col(r, "file_format", 5) or "",
                "pages": int(col(r, "pages", 6) or 0),
                "minutes": round(int(col(r, "secs", 7) or 0) / 60),
            })

        monthly = {}
        for d, v in daily.items():
            ym = d[:7]
            m = monthly.setdefault(ym, {"pages": 0, "active_days": 0, "completed_books": 0})
            m["pages"] += v["pages"]
            if v["pages"] > 0:
                m["active_days"] += 1
        for d, entries in completed_by_date.items():
            ym = d[:7]
            m = monthly.setdefault(ym, {"pages": 0, "active_days": 0, "completed_books": 0})
            m["completed_books"] += len(entries)

        active_dates = {d for d, v in daily.items() if v["pages"] > 0}
        today_str = date.today().strftime("%Y-%m-%d")

        return {
            "available": True,
            "daily": daily,
            "monthly": monthly,
            "completed_by_date": completed_by_date,
            "detail_by_date": detail_by_date,
            "completed_by_category": self._fetch_completed_by_category(gateway, user_id),
            "streak": {
                "current": self._current_streak(active_dates),
                "longest": self._longest_streak(active_dates),
            },
            "today": today_str,
            "this_month": today_str[:7],
            "history_days": CALENDAR_HISTORY_DAYS,
        }

    def _fetch_completed_by_category(self, gateway, user_id):
        """카테고리(라이브러리)별 누적 완독 권수 — 캘린더 조회 범위와 무관하게 전체 기간 집계."""
        col = self._col
        rows = gateway.fetch_all(
            """
            SELECT COALESCE(l.name, '기타') AS category_name,
                   COUNT(DISTINCT p.book_id) AS completed_count
            FROM user_progress p
            JOIN books b ON b.id = p.book_id
            LEFT JOIN libraries l ON l.id = b.library_id
            WHERE p.user_id = ?
              AND COALESCE(p.is_completed, 0) = 1
              AND COALESCE(b.is_deleted, 0) = 0
            GROUP BY COALESCE(l.name, '기타')
            ORDER BY completed_count DESC, category_name ASC
            """,
            (user_id,),
        ) or []

        return [
            {
                "category_name": col(r, "category_name", 0),
                "completed_count": int(col(r, "completed_count", 1) or 0),
            }
            for r in rows
        ]

    @staticmethod
    def _current_streak(active_dates):
        cursor = date.today()
        if cursor.strftime("%Y-%m-%d") not in active_dates:
            cursor -= timedelta(days=1)
        streak = 0
        while cursor.strftime("%Y-%m-%d") in active_dates:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    @staticmethod
    def _longest_streak(active_dates):
        if not active_dates:
            return 0
        days = sorted(date.fromisoformat(d) for d in active_dates)
        longest = 1
        run = 1
        for i in range(1, len(days)):
            if (days[i] - days[i - 1]).days == 1:
                run += 1
                longest = max(longest, run)
            else:
                run = 1
        return longest

    def get_dashboard_data(self, db_type, limit=2):
        user_id = self._current_user_id()
        if not user_id:
            return {
                "success": False,
                "error": "로그인 후 이용할 수 있는 개인 독서 통계입니다.",
            }

        calendar = self._fetch_calendar(db_type, user_id)
        this_month_stats = calendar["monthly"].get(
            calendar["this_month"], {"pages": 0, "active_days": 0, "completed_books": 0}
        )

        items = [
            {
                "item_type": "metric",
                "metric": "이번달 독서 페이지 / 독서일수",
                "value": f"{this_month_stats['pages']}쪽 / {this_month_stats['active_days']}일",
                "description": "내 기록(user_reading_log) 기준",
            },
            {
                "item_type": "metric",
                "metric": "연속 독서일 (현재 / 최장)",
                "value": f"{calendar['streak']['current']}일 / {calendar['streak']['longest']}일",
                "description": "오늘 또는 어제까지 이어진 기록 기준",
            },
        ]

        return {
            "success": True,
            "calendar": calendar,
            "items": items[: max(1, int(limit or 2))],
        }

    def get_context_menu_items(self, db_type, context):
        return []

    def run_context_menu_action(self, db_type, action_id, context):
        return {"success": False, "error": f"지원하지 않는 액션입니다: {action_id}"}
