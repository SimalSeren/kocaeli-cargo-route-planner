const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');
const axios = require('axios');

router.get('/', (req, res) => {
    try {
        const stations = db.prepare('SELECT * FROM stations ORDER BY name').all();
        res.json(stations);
    } catch (error) {
        res.status(500).json({ error: 'İstasyonlar alınamadı', message: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
        if (!station) {
            return res.status(404).json({ error: 'İstasyon bulunamadı' });
        }
        res.json(station);
    } catch (error) {
        res.status(500).json({ error: 'İstasyon alınamadı', message: error.message });
    }
});

router.post('/', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { name, latitude, longitude, is_center = 0 } = req.body;

        if (!name || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: 'İstasyon adı, enlem ve boylam gerekli' });
        }

        const existing = db.prepare('SELECT id FROM stations WHERE name = ?').get(name);
        if (existing) {
            return res.status(400).json({ error: 'Bu isimde bir istasyon zaten var' });
        }

        const result = db.prepare(
            'INSERT INTO stations (name, latitude, longitude, is_center) VALUES (?, ?, ?, ?)'
        ).run(name, latitude, longitude, is_center);

        await calculateDistancesForStation(result.lastInsertRowid);

        res.status(201).json({
            message: 'İstasyon başarıyla eklendi',
            stationId: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ error: 'İstasyon eklenemedi', message: error.message });
    }
});

router.put('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { name, latitude, longitude, is_center } = req.body;
        const { id } = req.params;

        const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
        if (!station) {
            return res.status(404).json({ error: 'İstasyon bulunamadı' });
        }

        db.prepare(
            'UPDATE stations SET name = ?, latitude = ?, longitude = ?, is_center = ? WHERE id = ?'
        ).run(
            name || station.name,
            latitude !== undefined ? latitude : station.latitude,
            longitude !== undefined ? longitude : station.longitude,
            is_center !== undefined ? is_center : station.is_center,
            id
        );

        res.json({ message: 'İstasyon güncellendi' });
    } catch (error) {
        res.status(500).json({ error: 'İstasyon güncellenemedi', message: error.message });
    }
});

router.delete('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
        if (!station) {
            return res.status(404).json({ error: 'İstasyon bulunamadı' });
        }

        db.prepare('DELETE FROM distances WHERE from_station_id = ? OR to_station_id = ?').run(id, id);

        db.prepare('DELETE FROM stations WHERE id = ?').run(id);

        res.json({ message: 'İstasyon silindi' });
    } catch (error) {
        res.status(500).json({ error: 'İstasyon silinemedi', message: error.message });
    }
});

router.get('/distances/all', (req, res) => {
    try {
        const distances = db.prepare(`
            SELECT d.*, 
                   s1.name as from_station_name, 
                   s2.name as to_station_name
            FROM distances d
            JOIN stations s1 ON d.from_station_id = s1.id
            JOIN stations s2 ON d.to_station_id = s2.id
        `).all();
        res.json(distances);
    } catch (error) {
        res.status(500).json({ error: 'Mesafeler alınamadı', message: error.message });
    }
});

router.get('/distance/:from/:to', (req, res) => {
    try {
        const { from, to } = req.params;
        const distance = db.prepare(
            'SELECT * FROM distances WHERE from_station_id = ? AND to_station_id = ?'
        ).get(from, to);

        if (!distance) {
            return res.status(404).json({ error: 'Mesafe bulunamadı' });
        }
        res.json(distance);
    } catch (error) {
        res.status(500).json({ error: 'Mesafe alınamadı', message: error.message });
    }
});

async function calculateDistancesForStation(stationId) {
    const newStation = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
    const allStations = db.prepare('SELECT * FROM stations WHERE id != ?').all(stationId);

    for (const station of allStations) {
        try {
            const response = await axios.get(
                `https://router.project-osrm.org/route/v1/driving/${newStation.longitude},${newStation.latitude};${station.longitude},${station.latitude}?overview=full&geometries=polyline`
            );

            if (response.data.routes && response.data.routes.length > 0) {
                const route = response.data.routes[0];
                const distanceKm = route.distance / 1000;
                const durationMin = route.duration / 60;
                const geometry = route.geometry;

                db.prepare(
                    'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min, route_geometry) VALUES (?, ?, ?, ?, ?)'
                ).run(newStation.id, station.id, distanceKm, durationMin, geometry);

                db.prepare(
                    'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min, route_geometry) VALUES (?, ?, ?, ?, ?)'
                ).run(station.id, newStation.id, distanceKm, durationMin, geometry);
            }
        } catch (error) {
            console.error(`Mesafe hesaplama hatası: ${newStation.name} - ${station.name}`, error.message);
        }
    }
}

router.post('/distances/recalculate', authenticateToken, isAdmin, async (req, res) => {
    try {
        const stations = db.prepare('SELECT * FROM stations').all();

        db.prepare('DELETE FROM distances').run();

        let calculated = 0;
        for (let i = 0; i < stations.length; i++) {
            for (let j = i + 1; j < stations.length; j++) {
                try {
                    const from = stations[i];
                    const to = stations[j];

                    const response = await axios.get(
                        `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=polyline`
                    );

                    if (response.data.routes && response.data.routes.length > 0) {
                        const route = response.data.routes[0];
                        const distanceKm = route.distance / 1000;
                        const durationMin = route.duration / 60;
                        const geometry = route.geometry;

                        db.prepare(
                            'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min, route_geometry) VALUES (?, ?, ?, ?, ?)'
                        ).run(from.id, to.id, distanceKm, durationMin, geometry);

                        db.prepare(
                            'INSERT OR REPLACE INTO distances (from_station_id, to_station_id, distance_km, duration_min, route_geometry) VALUES (?, ?, ?, ?, ?)'
                        ).run(to.id, from.id, distanceKm, durationMin, geometry);

                        calculated++;
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error('Mesafe hesaplama hatası:', error.message);
                }
            }
        }

        res.json({ message: `${calculated} mesafe hesaplandı` });
    } catch (error) {
        res.status(500).json({ error: 'Mesafeler hesaplanamadı', message: error.message });
    }
});

router.get('/:id/stats', (req, res) => {
    try {
        const { id } = req.params;
        const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
        
        if (!station) {
            return res.status(404).json({ error: 'İstasyon bulunamadı' });
        }

        const cargoStats = db.prepare(`
            SELECT 
                COUNT(*) as total_cargos,
                SUM(weight_kg) as total_weight,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count
            FROM cargos 
            WHERE station_id = ?
        `).get(id);

        res.json({
            station,
            stats: cargoStats
        });
    } catch (error) {
        res.status(500).json({ error: 'İstatistikler alınamadı', message: error.message });
    }
});

module.exports = router;
