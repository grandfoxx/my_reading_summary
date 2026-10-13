# -*- coding: utf-8 -*-
from datetime import date, timedelta

from plugins.metadata.base import BaseMetadataProvider

# 플러그인은 자체 라우트를 가질 수 없어 캘린더/일별 로그 전체가 단일 API 응답에
# 실려야 한다. 날짜 단위 합계(daily)는 하루 한 줄이라 전체 기간을 싣고,
# 날짜별 책 목록(detail_by_date)만 최근 2년으로 제한해 페이로드를 억제한다.
DETAIL_HISTORY_DAYS = 730
TOP_N = 5
COMPLETED_LIST_LIMIT = 200


def _iso(d):
    return d.strftime("%Y-%m-%d")


def _new_month():
    return {"pages": 0, "minutes": 0, "active_days": 0, "completed_books": 0}


class MyReadingSummaryProvider(BaseMetadataProvider):
    """개인 독서 캘린더 / 월간·연간 통계 / 리와인드 위젯."""

    id = "my_reading_summary"
    name = "내 독서 요약"
    is_searchable = False
    config_schema = []
    dashboard_widget = {
        "title": "내 독서 요약",
        "subtitle": "독서 캘린더 · 연간 통계 · 리와인드",
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

    # 이 NAS 인스턴스에서만 직접 관리하는 플러그인이라 GitHub 자동 업데이트는 사용하지 않는다.
    update_manifest = {"enabled": False}

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

    # ------------------------------------------------------------------
    # 일반 서재 / 성인 서재 — 책 기준 (user_reading_log 일별 기록 보유)
    # ------------------------------------------------------------------
    def _fetch_book_calendar(self, db_type, user_id):
        gateway = self.get_db_gateway(db_type)
        col = self._col
        today = date.today()
        detail_cutoff = _iso(today - timedelta(days=DETAIL_HISTORY_DAYS))

        log_rows = gateway.fetch_all(
            """
            SELECT l.read_date,
                   b.id AS book_id, b.title, b.series_name, b.cover_image, b.file_format,
                   COALESCE(lib.name, '기타') AS category_name,
                   l.pages_read_delta AS pages, l.duration_seconds AS secs
            FROM user_reading_log l
            JOIN books b ON b.id = l.book_id
            LEFT JOIN libraries lib ON lib.id = b.library_id
            WHERE l.user_id = ?
              AND l.read_date IS NOT NULL
              AND COALESCE(b.is_deleted, 0) = 0
            """,
            (user_id,),
        ) or []

        completed_rows = gateway.fetch_all(
            """
            SELECT b.id AS book_id, b.title, b.series_name, b.cover_image, b.file_format,
                   DATE(p.last_read_at) AS completed_date,
                   COALESCE(lib.name, '기타') AS category_name
            FROM user_progress p
            JOIN books b ON b.id = p.book_id
            LEFT JOIN libraries lib ON lib.id = b.library_id
            WHERE p.user_id = ?
              AND COALESCE(p.is_completed, 0) = 1
              AND COALESCE(b.is_deleted, 0) = 0
              AND p.last_read_at IS NOT NULL
            """,
            (user_id,),
        ) or []

        # 같은 날 같은 책의 여러 로그 행을 하나로 합친다.
        per_day_book = {}
        for r in log_rows:
            d = str(col(r, "read_date", 0))[:10]
            bid = col(r, "book_id", 1)
            item = per_day_book.setdefault((d, bid), {
                "date": d,
                "book_id": bid,
                "title": col(r, "title", 2),
                "series_name": col(r, "series_name", 3) or "",
                "cover_image": col(r, "cover_image", 4) or "",
                "file_format": col(r, "file_format", 5) or "",
                "category_name": col(r, "category_name", 6) or "기타",
                "pages": 0,
                "secs": 0,
            })
            item["pages"] += int(col(r, "pages", 7) or 0)
            item["secs"] += int(col(r, "secs", 8) or 0)

        daily = {}
        detail_by_date = {}
        for (d, _bid), it in per_day_book.items():
            day = daily.setdefault(d, {"pages": 0, "secs": 0, "books": 0})
            day["pages"] += it["pages"]
            day["secs"] += it["secs"]
            day["books"] += 1
            if d >= detail_cutoff:
                detail_by_date.setdefault(d, []).append({
                    "book_id": it["book_id"],
                    "title": it["title"],
                    "series_name": it["series_name"],
                    "cover_image": it["cover_image"],
                    "file_format": it["file_format"],
                    "pages": it["pages"],
                    "minutes": round(it["secs"] / 60),
                })
        for lst in detail_by_date.values():
            lst.sort(key=lambda x: -x["pages"])

        daily_out = {
            d: {"pages": v["pages"], "minutes": round(v["secs"] / 60), "books": v["books"]}
            for d, v in daily.items()
        }

        completed_by_date = {}
        for r in completed_rows:
            d = str(col(r, "completed_date", 5))[:10]
            completed_by_date.setdefault(d, []).append({
                "book_id": col(r, "book_id", 0),
                "title": col(r, "title", 1),
                "series_name": col(r, "series_name", 2) or "",
                "cover_image": col(r, "cover_image", 3) or "",
                "file_format": col(r, "file_format", 4) or "",
                "category_name": col(r, "category_name", 6) or "기타",
            })

        monthly = {}
        for d, v in daily_out.items():
            m = monthly.setdefault(d[:7], _new_month())
            m["pages"] += v["pages"]
            m["minutes"] += v["minutes"]
            if v["pages"] > 0:
                m["active_days"] += 1
        for d, entries in completed_by_date.items():
            m = monthly.setdefault(d[:7], _new_month())
            m["completed_books"] += len(entries)

        active_dates = {d for d, v in daily_out.items() if v["pages"] > 0}
        years = self._build_years(list(per_day_book.values()), daily_out, completed_by_date, active_dates)
        streak = self._streak_ranges(active_dates, today)
        today_str = _iso(today)

        return {
            "available": True,
            "mode": "book",
            "daily": daily_out,
            "monthly": monthly,
            "completed_by_date": completed_by_date,
            "detail_by_date": detail_by_date,
            "completed_by_category": self._fetch_book_completed_by_category(gateway, user_id),
            "years": years,
            "available_years": sorted(years.keys(), reverse=True),
            "streak": {"current": streak["current"]["length"], "longest": streak["longest"]["length"]},
            "streak_detail": streak,
            "today": today_str,
            "this_month": today_str[:7],
            "history_days": DETAIL_HISTORY_DAYS,
        }

    def _fetch_book_completed_by_category(self, gateway, user_id):
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

    # ------------------------------------------------------------------
    # 연간 집계 — 연도 통계 / 리와인드 화면이 쓰는 데이터
    # ------------------------------------------------------------------
    @staticmethod
    def _empty_year():
        return {
            "pages": 0,
            "minutes": 0,
            "active_days": 0,
            "completed_books": 0,
            "months": [_new_month() for _ in range(12)],
            "weekdays": [{"pages": 0, "minutes": 0, "days": 0} for _ in range(7)],  # 0=일요일
            "top_books": [],
            "top_series": [],
            "top_categories": [],
            "by_format": [],
            "pace_pages_per_min": 0,
            "avg_pages_per_active_day": 0,
            "avg_minutes_per_active_day": 0,
            "best_day": None,
            "best_month": None,
            "longest_streak": {"length": 0, "start": None, "end": None},
            "completed": [],
        }

    def _build_years(self, day_book_items, daily, completed_by_date, active_dates):
        years = {}

        def year_of(d):
            y = d[:4]
            if y not in years:
                years[y] = self._empty_year()
            return years[y]

        for d, v in daily.items():
            y = year_of(d)
            mi = int(d[5:7]) - 1
            y["pages"] += v["pages"]
            y["minutes"] += v["minutes"]
            y["months"][mi]["pages"] += v["pages"]
            y["months"][mi]["minutes"] += v["minutes"]
            if v["pages"] > 0:
                y["active_days"] += 1
                y["months"][mi]["active_days"] += 1
            # 파이썬 weekday(): 월=0 → 자바스크립트 getDay() 기준(일=0)으로 변환
            wd = (date.fromisoformat(d).weekday() + 1) % 7
            y["weekdays"][wd]["pages"] += v["pages"]
            y["weekdays"][wd]["minutes"] += v["minutes"]
            if v["pages"] > 0:
                y["weekdays"][wd]["days"] += 1
            if y["best_day"] is None or v["pages"] > y["best_day"]["pages"]:
                y["best_day"] = {"date": d, "pages": v["pages"], "minutes": v["minutes"]}

        for d, entries in completed_by_date.items():
            y = year_of(d)
            mi = int(d[5:7]) - 1
            y["completed_books"] += len(entries)
            y["months"][mi]["completed_books"] += len(entries)
            for e in entries:
                y["completed"].append(dict(e, date=d))

        # 책/시리즈/카테고리/형식별 합계 (연도별)
        books = {}
        series = {}
        cats = {}
        fmts = {}
        for it in day_book_items:
            yk = it["date"][:4]
            mins = round(it["secs"] / 60)
            b = books.setdefault((yk, it["book_id"]), {
                "book_id": it["book_id"], "title": it["title"], "series_name": it["series_name"],
                "cover_image": it["cover_image"], "file_format": it["file_format"],
                "pages": 0, "minutes": 0, "days": set(),
            })
            b["pages"] += it["pages"]
            b["minutes"] += mins
            b["days"].add(it["date"])
            skey = it["series_name"] or it["title"]
            s = series.setdefault((yk, skey), {"name": skey, "pages": 0, "minutes": 0, "books": set()})
            s["pages"] += it["pages"]
            s["minutes"] += mins
            s["books"].add(it["book_id"])
            c = cats.setdefault((yk, it["category_name"]), {"name": it["category_name"], "pages": 0, "minutes": 0, "books": set()})
            c["pages"] += it["pages"]
            c["minutes"] += mins
            c["books"].add(it["book_id"])
            fkey = it["file_format"] or "기타"
            f = fmts.setdefault((yk, fkey), {"name": fkey, "pages": 0, "minutes": 0, "books": set()})
            f["pages"] += it["pages"]
            f["minutes"] += mins
            f["books"].add(it["book_id"])

        def ranked(bucket, yk, limit):
            rows = [v for (k, _n), v in bucket.items() if k == yk]
            rows.sort(key=lambda x: (-x["minutes"], -x["pages"]))
            out = []
            for v in rows[:limit] if limit else rows:
                row = dict(v)
                if "books" in row:
                    row["books"] = len(row["books"])
                if "days" in row:
                    row["days"] = len(row["days"])
                out.append(row)
            return out

        for yk, y in years.items():
            y["top_books"] = ranked(books, yk, TOP_N)
            y["top_series"] = ranked(series, yk, TOP_N)
            y["top_categories"] = ranked(cats, yk, TOP_N)
            y["by_format"] = ranked(fmts, yk, 0)
            if y["minutes"] > 0:
                y["pace_pages_per_min"] = round(y["pages"] / y["minutes"], 2)
            if y["active_days"] > 0:
                y["avg_pages_per_active_day"] = round(y["pages"] / y["active_days"])
                y["avg_minutes_per_active_day"] = round(y["minutes"] / y["active_days"])
            best_idx = max(range(12), key=lambda i: y["months"][i]["pages"])
            if y["months"][best_idx]["pages"] > 0:
                y["best_month"] = {"month": best_idx + 1, **{k: y["months"][best_idx][k] for k in ("pages", "minutes", "active_days")}}
            y["longest_streak"] = self._streak_ranges({d for d in active_dates if d.startswith(yk)})["longest"]
            y["completed"].sort(key=lambda e: e["date"], reverse=True)
            y["completed"] = y["completed"][:COMPLETED_LIST_LIMIT]

        return years

    # ------------------------------------------------------------------
    # 오디오북 — audiobook_progress 기준 (일별 청취 기록 테이블이 없어
    # 완독 표시/카테고리 집계만 제공, 일별 분량·스트릭은 제공 불가)
    # ------------------------------------------------------------------
    def _fetch_audiobook_calendar(self, user_id):
        col = self._col
        today = date.today()
        today_str = _iso(today)

        try:
            gateway = self.get_db_gateway("audiobook")
        except Exception:
            gateway = None

        completed_rows = []
        category_rows = []
        if gateway is not None:
            try:
                completed_rows = gateway.fetch_all(
                    """
                    SELECT a.id AS audiobook_id, a.title,
                           CONCAT('/api/media/audiobooks/', a.id, '/cover') AS cover_image,
                           DATE(p.last_listened_at) AS completed_date
                    FROM audiobook_progress p
                    JOIN audiobooks a ON a.id = p.audiobook_id
                    WHERE p.user_id = ?
                      AND COALESCE(p.is_completed, 0) = 1
                      AND p.last_listened_at IS NOT NULL
                    """,
                    (user_id,),
                ) or []
            except Exception:
                completed_rows = []
            try:
                category_rows = gateway.fetch_all(
                    """
                    SELECT COALESCE(l.name, '오디오북') AS category_name,
                           COUNT(DISTINCT p.audiobook_id) AS completed_count
                    FROM audiobook_progress p
                    JOIN audiobooks a ON a.id = p.audiobook_id
                    LEFT JOIN libraries l ON l.id = a.library_id
                    WHERE p.user_id = ?
                      AND COALESCE(p.is_completed, 0) = 1
                    GROUP BY COALESCE(l.name, '오디오북')
                    ORDER BY completed_count DESC, category_name ASC
                    """,
                    (user_id,),
                ) or []
            except Exception:
                category_rows = []

        completed_by_date = {}
        for r in completed_rows:
            d = str(col(r, "completed_date", 3))[:10]
            completed_by_date.setdefault(d, []).append({
                "book_id": col(r, "audiobook_id", 0),
                "title": col(r, "title", 1),
                "series_name": col(r, "title", 1) or "",
                "cover_image": col(r, "cover_image", 2) or "",
                "file_format": "audiobook",
                "category_name": "오디오북",
            })

        monthly = {}
        for d, entries in completed_by_date.items():
            m = monthly.setdefault(d[:7], _new_month())
            m["completed_books"] += len(entries)

        years = self._build_years([], {}, completed_by_date, set())

        return {
            "available": True,
            "mode": "audiobook",
            "daily": {},
            "monthly": monthly,
            "completed_by_date": completed_by_date,
            "detail_by_date": {},
            "completed_by_category": [
                {
                    "category_name": col(r, "category_name", 0),
                    "completed_count": int(col(r, "completed_count", 1) or 0),
                }
                for r in category_rows
            ],
            "years": years,
            "available_years": sorted(years.keys(), reverse=True),
            "streak": {"current": 0, "longest": 0},
            "streak_detail": {
                "current": {"length": 0, "start": None, "end": None},
                "longest": {"length": 0, "start": None, "end": None},
            },
            "today": today_str,
            "this_month": today_str[:7],
            "history_days": DETAIL_HISTORY_DAYS,
        }

    # ------------------------------------------------------------------
    # 연속 독서일 — 길이와 기간(시작~끝)을 함께 계산
    # ------------------------------------------------------------------
    @staticmethod
    def _streak_ranges(active_dates, today=None):
        """현재(오늘 또는 어제까지 이어진) 연속 기록과 최장 연속 기록을 기간과 함께 돌려준다."""
        today = today or date.today()
        empty = {"length": 0, "start": None, "end": None}
        if not active_dates:
            return {"current": dict(empty), "longest": dict(empty)}

        days = sorted(date.fromisoformat(d) for d in active_dates)

        longest = {"length": 1, "start": days[0], "end": days[0]}
        run_start = days[0]
        run_len = 1
        for i in range(1, len(days)):
            if (days[i] - days[i - 1]).days == 1:
                run_len += 1
            else:
                run_start = days[i]
                run_len = 1
            if run_len >= longest["length"]:
                longest = {"length": run_len, "start": run_start, "end": days[i]}

        dayset = set(days)
        cursor = today if today in dayset else today - timedelta(days=1)
        end = cursor
        length = 0
        while cursor in dayset:
            length += 1
            cursor -= timedelta(days=1)
        current = {"length": length, "start": _iso(end - timedelta(days=length - 1)) if length else None,
                   "end": _iso(end) if length else None}

        return {
            "current": current,
            "longest": {"length": longest["length"], "start": _iso(longest["start"]), "end": _iso(longest["end"])},
        }

    def get_dashboard_data(self, db_type, limit=2):
        user_id = self._current_user_id()
        if not user_id:
            return {
                "success": False,
                "error": "로그인 후 이용할 수 있는 개인 독서 통계입니다.",
            }

        if db_type == "audiobook":
            calendar = self._fetch_audiobook_calendar(user_id)
            this_month_stats = calendar["monthly"].get(calendar["this_month"], _new_month())
            items = [
                {
                    "item_type": "metric",
                    "metric": "이번달 완독 오디오북",
                    "value": f"{this_month_stats['completed_books']}권",
                    "description": "audiobook_progress 기준 (일별 청취 기록 없음)",
                },
            ]
        else:
            calendar = self._fetch_book_calendar(db_type, user_id)
            this_month_stats = calendar["monthly"].get(calendar["this_month"], _new_month())
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
