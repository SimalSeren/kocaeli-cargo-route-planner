# Kargo İşletme Sistemi

Kocaeli Üniversitesi - Yazılım Laboratuvarı Projesi (2025-2026 Güz)

## Proje Açıklaması

Bu proje, Kocaeli'nin ilçelerinden Kocaeli Üniversitesi'ne gelen kargo araçları için yük ve rota planlaması yapmaktadır. Sistem, dinamik rota planlamaları yaparak en optimum rotaları oluşturmayı hedeflemektedir.

## Özellikler

### Kullanıcı Paneli
- Kargo gönderimi (istasyon seçimi zorunlu)
- Kargo takibi
- Güzergah görüntüleme (sadece kendi kargolarının rotası)

### Yönetici Paneli
- İstasyon yönetimi (yeni istasyon ekleme)
- Kargo yönetimi
- Araç yönetimi
- Rota planlama (optimizasyon)
- Senaryo yükleme ve test
- Harita görünümü (tüm rotalar)
- Maliyet ve özet raporları

### Teknik Özellikler
- **Algoritma**: Genetik Algoritma + 2-opt (Sezgisel yaklaşım - Brute-force YASAK)
- **Harita**: OpenStreetMap + Leaflet (Google/Yandex YASAK)
- **Rota Çizimi**: OSRM (Gerçek yol çizimi - Kuş uçuşu YASAK)
- **Veritabanı**: SQLite (better-sqlite3)

## Kurulum

### Gereksinimler
- Node.js (v18 veya üzeri)
- npm veya yarn

### Backend Kurulumu

```bash
cd backend
npm install
npm start
```

Backend http://localhost:3001 adresinde çalışacaktır.

### Frontend Kurulumu

```bash
cd frontend
npm install
npm start
```

Frontend http://localhost:3000 adresinde çalışacaktır.

## Kullanım

### Varsayılan Hesaplar
- **Admin**: admin / admin123
- **Kullanıcı**: Kayıt olarak oluşturabilirsiniz

### İlk Kullanım
1. Backend'i başlatın
2. Frontend'i başlatın
3. Admin olarak giriş yapın
4. İstasyonlar sayfasından "Mesafeleri Hesapla" butonuna tıklayın (OSRM API ile gerçek mesafeler hesaplanır)
5. Senaryolar sayfasından bir test senaryosu yükleyin
6. Rota Planlama sayfasından optimizasyon yapın

## Kocaeli İlçeleri (İstasyonlar)

- Başiskele
- Çayırova
- Darıca
- Derince
- Dilovası
- Gebze
- Gölcük
- Kandıra
- Karamürsel
- Kartepe
- Körfez
- İzmit

Merkez: **Kocaeli Üniversitesi**

## Araç Bilgileri

| Araç | Kapasite | Kiralama Maliyeti |
|------|----------|-------------------|
| Araç 1 | 500 kg | 0 (mevcut) |
| Araç 2 | 750 kg | 0 (mevcut) |
| Araç 3 | 1000 kg | 0 (mevcut) |
| Kiralık | 500 kg | 200 birim |

**Toplam Mevcut Kapasite**: 2250 kg

## Problem Tipleri

### 1. Sınırsız Sayıda Araç Problemi
Minimum maliyet ile kaç araç kullanılarak taşıma işlemi tamamlanabilir? Gerekirse araç kiralanır.

### 2. Belirli Sayıda Araç Problemi
- **Maksimum Kargo Sayısı**: Mevcut araçlarla en fazla kaç kargo taşınabilir?
- **Maksimum Kargo Ağırlığı**: Mevcut araçlarla en fazla kaç kg kargo taşınabilir?

## Örnek Senaryolar

| Senaryo | Kargo Sayısı | Toplam Ağırlık | Özellik |
|---------|--------------|----------------|---------|
| 1 | 113 | 1445 kg | Dengeli dağılım |
| 2 | 118 | 905 kg | Dengesiz dağılım |
| 3 | 17 | 2700 kg | Ek araç gerekli |
| 4 | 88 | 1150 kg | Optimizasyon kritik |

## Maliyet Hesaplama

- **Yol Maliyeti**: 1 birim / km
- **Araç Kiralama**: 200 birim / 500 kg kapasiteli araç
- **Toplam Maliyet**: Yol Maliyeti + Kiralama Maliyeti

## API Endpoints

### Auth
- POST `/api/auth/login` - Giriş
- POST `/api/auth/register` - Kayıt
- GET `/api/auth/me` - Kullanıcı bilgisi

### Stations
- GET `/api/stations` - Tüm istasyonlar
- POST `/api/stations` - İstasyon ekle (admin)
- POST `/api/stations/distances/recalculate` - Mesafeleri hesapla

### Cargos
- GET `/api/cargos` - Kargolar
- POST `/api/cargos` - Kargo oluştur
- GET `/api/cargos/summary/by-station` - İstasyon bazlı özet

### Planning
- POST `/api/planning/optimize` - Rota optimizasyonu
- POST `/api/planning/compare` - Tüm çözümleri karşılaştır
- POST `/api/planning/save-routes` - Rotaları kaydet

### Scenarios
- GET `/api/scenarios/examples` - Örnek senaryolar
- POST `/api/scenarios/:id/load` - Senaryo yükle

## Teknolojiler

### Backend
- Node.js
- Express.js
- better-sqlite3
- bcryptjs (şifreleme)
- jsonwebtoken (JWT)
- axios (OSRM API)

### Frontend
- React
- React Router
- Axios
- Leaflet (Harita)
# Kocaeli Cargo Route Planner

## Overview
Kocaeli Cargo Route Planner is a web-based logistics optimization system that calculates efficient cargo delivery routes from Kocaeli districts to a central hub using structured JSON scenario data.

The system applies heuristic optimization techniques to minimize cost and respect vehicle capacity constraints.

---

## Features
- Cargo distribution planning
- Route optimization using Genetic Algorithm + 2-opt
- Vehicle capacity management
- Unlimited / Limited vehicle modes
- JSON-based scenario loading
- Real road distance calculation via OSRM
- Map visualization (OpenStreetMap)

---

## Technologies Used
- Node.js
- Express
- SQLite (better-sqlite3)
- React
- Leaflet (OpenStreetMap)
- OSRM API
- JSON data modeling

---

## Optimization Approach
- Genetic Algorithm for global route search
- 2-opt for local route improvement
- Cost-based evaluation (distance + vehicle cost)
- No brute-force search

---

## Data Model
Cargo scenarios are generated from structured JSON files.

Example:

```json
{
  "Basiskele": { "cargo_count": 10, "weight_kg": 120 },
  "Cayirova": { "cargo_count": 8, "weight_kg": 80 },
  "Izmit": { "cargo_count": 14, "weight_kg": 160 }
}

