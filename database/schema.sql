-- Kargo İşletme Sistemi Veritabanı Şeması

-- Kullanıcılar tablosu
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- İstasyonlar tablosu (Kocaeli ilçeleri)
CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    is_center INTEGER DEFAULT 0,  -- Merkez istasyon (Kocaeli Üniversitesi)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Araçlar tablosu
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    capacity_kg INTEGER NOT NULL,
    rental_cost REAL DEFAULT 0,  -- Kiralama maliyeti (başlangıç araçları için 0)
    is_rented INTEGER DEFAULT 0,  -- Kiralık mı
    fuel_consumption REAL DEFAULT 0.1,  -- Yakıt tüketimi (birim/km)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Kargolar tablosu
CREATE TABLE IF NOT EXISTS cargos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    station_id INTEGER NOT NULL,
    weight_kg REAL NOT NULL,
    description TEXT,
    status TEXT CHECK(status IN ('pending', 'assigned', 'in_transit', 'delivered')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    delivery_date DATE,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (station_id) REFERENCES stations(id)
);

-- İstasyonlar arası mesafeler tablosu
CREATE TABLE IF NOT EXISTS distances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_station_id INTEGER NOT NULL,
    to_station_id INTEGER NOT NULL,
    distance_km REAL NOT NULL,
    duration_min REAL,
    route_geometry TEXT,  -- Polyline formatında yol geometrisi
    FOREIGN KEY (from_station_id) REFERENCES stations(id),
    FOREIGN KEY (to_station_id) REFERENCES stations(id),
    UNIQUE(from_station_id, to_station_id)
);

-- Rotalar tablosu
CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    plan_date DATE NOT NULL,
    total_distance_km REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    total_cargo_count INTEGER DEFAULT 0,
    total_weight_kg REAL DEFAULT 0,
    route_order TEXT,  -- JSON formatında istasyon sırası
    status TEXT CHECK(status IN ('planned', 'in_progress', 'completed')) DEFAULT 'planned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

-- Rota detayları tablosu
CREATE TABLE IF NOT EXISTS route_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    station_id INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL,
    cargo_count INTEGER DEFAULT 0,
    cargo_weight_kg REAL DEFAULT 0,
    arrival_time DATETIME,
    FOREIGN KEY (route_id) REFERENCES routes(id),
    FOREIGN KEY (station_id) REFERENCES stations(id)
);

-- Seferler tablosu (anlık kayıt)
CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    vehicle_id INTEGER NOT NULL,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT CHECK(status IN ('started', 'completed', 'cancelled')) DEFAULT 'started',
    notes TEXT,
    FOREIGN KEY (route_id) REFERENCES routes(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

-- Senaryo tablosu (test senaryoları)
CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    data TEXT,  -- JSON formatında senaryo verileri
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rota planlaması sonuçları tablosu
CREATE TABLE IF NOT EXISTS planning_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER,
    problem_type TEXT CHECK(problem_type IN ('unlimited_vehicles', 'limited_vehicles')) NOT NULL,
    optimization_type TEXT CHECK(optimization_type IN ('max_cargo_count', 'max_cargo_weight')),
    total_vehicles_used INTEGER,
    total_distance_km REAL,
    total_cost REAL,
    total_cargo_delivered INTEGER,
    total_weight_delivered REAL,
    computation_time_ms INTEGER,
    result_data TEXT,  -- JSON formatında detaylı sonuçlar
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
);

-- Başlangıç verileri: Kocaeli ilçeleri koordinatları
INSERT OR IGNORE INTO stations (name, latitude, longitude, is_center) VALUES
('Kocaeli Üniversitesi', 40.8225, 29.9213, 1),  -- Merkez
('Başiskele', 40.7167, 29.8500, 0),
('Çayırova', 40.8269, 29.3708, 0),
('Darıca', 40.7692, 29.3753, 0),
('Derince', 40.7553, 29.8314, 0),
('Dilovası', 40.7833, 29.5333, 0),
('Gebze', 40.8028, 29.4314, 0),
('Gölcük', 40.7167, 29.8167, 0),
('Kandıra', 41.0711, 30.1528, 0),
('Karamürsel', 40.6917, 29.6167, 0),
('Kartepe', 40.6833, 30.0333, 0),
('Körfez', 40.7500, 29.7500, 0),
('İzmit', 40.7667, 29.9167, 0);

-- Başlangıç araçları (3 araç, kiralama maliyeti yok)
INSERT OR IGNORE INTO vehicles (name, capacity_kg, rental_cost, is_rented) VALUES
('Araç 1', 500, 0, 0),
('Araç 2', 750, 0, 0),
('Araç 3', 1000, 0, 0);

-- Varsayılan admin kullanıcısı (şifre: admin123)
INSERT OR IGNORE INTO users (username, password, role) VALUES
('admin', '$2a$10$T4/ZtixRWNciplA4wo0kIuYhafPhMK4v9xIDoMu/9oxQB9xFRQ4S2', 'admin');
