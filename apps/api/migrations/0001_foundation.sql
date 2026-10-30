PRAGMA foreign_keys = ON;

-- Chỉ dữ liệu cấu hình đã chốt. Nghiệp vụ tài khoản/tiền/tin có migration riêng ở các phần tiếp theo.
CREATE TABLE listing_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_vnd INTEGER NOT NULL CHECK (typeof(price_vnd) = 'integer' AND price_vnd > 0),
  duration_days INTEGER NOT NULL CHECK (typeof(duration_days) = 'integer' AND duration_days > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO listing_plans (id, name, price_vnd, duration_days) VALUES
  ('basic-7d', 'Gói 7 ngày', 5000, 7),
  ('standard-30d', 'Gói 30 ngày', 10000, 30);

