-- Public geocoding metadata only; never alters listings or financial data.
CREATE TABLE map_geocode_cache (
 key TEXT PRIMARY KEY,result TEXT NOT NULL,expires_at INTEGER NOT NULL
);
CREATE INDEX map_geocode_cache_expiry_idx ON map_geocode_cache(expires_at);
CREATE TABLE map_geocode_budget (
 id INTEGER PRIMARY KEY CHECK(id=1),last_ms INTEGER NOT NULL DEFAULT 0,
 day INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0)
);
INSERT INTO map_geocode_budget(id) VALUES(1);
