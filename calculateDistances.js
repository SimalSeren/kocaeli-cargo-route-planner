/**
 * OSRM API kullanarak gerçek yol mesafelerini hesaplar
 * Kuş uçuşu değil, gerçek yol mesafesi ve geometrisi kaydedilir
 */

const sql = require('sql.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const dbPath = path.join(__dirname, '..', 'database', 'kargo.db');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function calculateDistances() {
    const SQL = await sql();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    
    // İstasyonları al
    const stationsResult = db.exec('SELECT id, name, latitude, longitude FROM stations');
    const stations = stationsResult[0].values.map(v => ({
        id: v[0], name: v[1], lat: v[2], lon: v[3]
    }));
    
    console.log(`${stations.length} istasyon bulundu.`);
    console.log('OSRM API ile gerçek yol mesafeleri hesaplanıyor...\n');
    
    // Mevcut mesafeleri temizle
    db.run('DELETE FROM distances');
    
    let count = 0;
    let errors = 0;
    
    for (let i = 0; i < stations.length; i++) {
        for (let j = 0; j < stations.length; j++) {
            if (i !== j) {
                const from = stations[i];
                const to = stations[j];
                
                try {
                    // OSRM API'yi çağır (açık kaynak, ücretsiz)
                    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline`;
                    
                    const response = await axios.get(url, { timeout: 10000 });
                    
                    if (response.data.routes && response.data.routes.length > 0) {
                        const route = response.data.routes[0];
                        const distanceKm = (route.distance / 1000).toFixed(2);
                        const durationMin = (route.duration / 60).toFixed(2);
                        const geometry = route.geometry; // Polyline formatında
                        
                        db.run(
                            'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min, route_geometry) VALUES (?, ?, ?, ?, ?)',
                            [from.id, to.id, distanceKm, durationMin, geometry]
                        );
                        
                        count++;
                        process.stdout.write(`\r${from.name} -> ${to.name}: ${distanceKm} km (${count} tamamlandı)`);
                    }
                    
                    // Rate limiting - OSRM API'yi yormamak için
                    await sleep(100);
                    
                } catch (error) {
                    errors++;
                    console.error(`\nHata: ${from.name} -> ${to.name}: ${error.message}`);
                    
                    // Hata durumunda Haversine ile hesapla (yedek)
                    const dist = haversineDistance(from.lat, from.lon, to.lat, to.lon);
                    db.run(
                        'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min) VALUES (?, ?, ?, ?)',
                        [from.id, to.id, dist.toFixed(2), (dist / 50 * 60).toFixed(2)]
                    );
                    count++;
                }
            }
        }
    }
    
    // Veritabanını kaydet
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    
    console.log(`\n\nTamamlandı!`);
    console.log(`- ${count} mesafe kaydedildi`);
    console.log(`- ${errors} hata oluştu (Haversine ile yedeklendi)`);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1.3; // %30 yol faktörü
}

calculateDistances().catch(console.error);
