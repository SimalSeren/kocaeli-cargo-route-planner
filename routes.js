const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');

router.get('/', authenticateToken, (req, res) => {
    try {
        const routes = db.prepare(`
            SELECT r.*, v.name as vehicle_name, v.capacity_kg as vehicle_capacity
            FROM routes r
            JOIN vehicles v ON r.vehicle_id = v.id
            ORDER BY r.created_at DESC
        `).all();
        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: 'Rotalar alınamadı', message: error.message });
    }
});

router.get('/by-date/:date', authenticateToken, (req, res) => {
    try {
        const { date } = req.params;
        const routes = db.prepare(`
            SELECT r.*, v.name as vehicle_name, v.capacity_kg as vehicle_capacity
            FROM routes r
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.plan_date = ?
            ORDER BY r.id
        `).all(date);
        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: 'Rotalar alınamadı', message: error.message });
    }
});

router.get('/my-routes', authenticateToken, (req, res) => {
    try {
        const userCargos = db.prepare(`
            SELECT DISTINCT c.station_id, c.delivery_date
            FROM cargos c
            WHERE c.sender_id = ? AND c.status IN ('assigned', 'in_transit', 'delivered')
        `).all(req.user.id);

        if (userCargos.length === 0) {
            return res.json([]);
        }

        const allRoutes = db.prepare(`
            SELECT r.*, v.name as vehicle_name, v.capacity_kg as vehicle_capacity
            FROM routes r
            JOIN vehicles v ON r.vehicle_id = v.id
            ORDER BY r.plan_date DESC
        `).all();

        const matchingRoutes = allRoutes.filter(route => {
            try {
                const routeStations = JSON.parse(route.route_order || '[]');
                return userCargos.some(cargo => 
                    routeStations.includes(cargo.station_id) && 
                    route.plan_date === cargo.delivery_date
                );
            } catch (e) {
                return false;
            }
        });

        res.json(matchingRoutes);
    } catch (error) {
        res.status(500).json({ error: 'Rotalar alınamadı', message: error.message });
    }
});

router.get('/:id', authenticateToken, (req, res) => {
    try {
        const route = db.prepare(`
            SELECT r.*, v.name as vehicle_name, v.capacity_kg as vehicle_capacity
            FROM routes r
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.id = ?
        `).get(req.params.id);

        if (!route) {
            return res.status(404).json({ error: 'Rota bulunamadı' });
        }

        let details = db.prepare(`
            SELECT rd.*, s.name as station_name, s.latitude, s.longitude
            FROM route_details rd
            JOIN stations s ON rd.station_id = s.id
            WHERE rd.route_id = ?
            ORDER BY rd.sequence_order
        `).all(req.params.id);

        if (details.length === 0 && route.route_order) {
            try {
                const stationIds = JSON.parse(route.route_order);
                const center = db.prepare('SELECT * FROM stations WHERE is_center = 1').get();
                
                details = [];

                stationIds.forEach((stationId, idx) => {
                    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
                    if (station) {
                        const cargoInfo = db.prepare(`
                            SELECT COUNT(*) as count, COALESCE(SUM(weight_kg), 0) as weight
                            FROM cargos 
                            WHERE station_id = ? AND delivery_date = ?
                        `).get(stationId, route.plan_date);

                        details.push({
                            station_id: station.id,
                            station_name: station.name,
                            latitude: station.latitude,
                            longitude: station.longitude,
                            sequence_order: idx,
                            cargo_count: cargoInfo?.count || 0,
                            cargo_weight_kg: cargoInfo?.weight || 0
                        });
                    }
                });

                if (center) {
                    details.push({
                        station_id: center.id,
                        station_name: center.name,
                        latitude: center.latitude,
                        longitude: center.longitude,
                        sequence_order: stationIds.length,
                        cargo_count: 0,
                        cargo_weight_kg: 0
                    });
                }
            } catch (e) {
                console.error('route_order parse error:', e);
            }
        }

        if (req.user.role !== 'admin') {
            let routeStationIds = [];
            try {
                routeStationIds = JSON.parse(route.route_order || '[]');
            } catch (e) {}

            const userCargoInRoute = db.prepare(`
                SELECT COUNT(*) as count
                FROM cargos c
                WHERE c.station_id IN (${routeStationIds.map(() => '?').join(',') || '0'})
                AND c.sender_id = ? AND c.delivery_date = ?
            `).get(...routeStationIds, req.user.id, route.plan_date);

            if (!userCargoInRoute || userCargoInRoute.count === 0) {
                return res.status(403).json({ error: 'Bu rotaya erişim yetkiniz yok' });
            }
        }

        const routeGeometry = [];
        for (let i = 0; i < details.length - 1; i++) {
            const distance = db.prepare(`
                SELECT route_geometry 
                FROM distances 
                WHERE from_station_id = ? AND to_station_id = ?
            `).get(details[i].station_id, details[i + 1].station_id);

            if (distance && distance.route_geometry) {
                routeGeometry.push({
                    from: details[i].station_name,
                    to: details[i + 1].station_name,
                    geometry: distance.route_geometry
                });
            }
        }

        res.json({
            ...route,
            details,
            geometry: routeGeometry
        });
    } catch (error) {
        res.status(500).json({ error: 'Rota alınamadı', message: error.message });
    }
});

router.post('/', authenticateToken, isAdmin, (req, res) => {
    try {
        const { vehicle_id, plan_date, stations } = req.body;

        if (!vehicle_id || !plan_date || !stations || stations.length === 0) {
            return res.status(400).json({ error: 'Araç, tarih ve istasyon listesi gerekli' });
        }

        const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle_id);
        if (!vehicle) {
            return res.status(400).json({ error: 'Geçersiz araç' });
        }

        const center = db.prepare('SELECT * FROM stations WHERE is_center = 1').get();

        let totalDistance = 0;
        let totalCargoCount = 0;
        let totalWeight = 0;

        const firstDistance = db.prepare(
            'SELECT distance_km FROM distances WHERE from_station_id = ? AND to_station_id = ?'
        ).get(center.id, stations[0].station_id);
        if (firstDistance) totalDistance += firstDistance.distance_km;

        for (let i = 0; i < stations.length - 1; i++) {
            const dist = db.prepare(
                'SELECT distance_km FROM distances WHERE from_station_id = ? AND to_station_id = ?'
            ).get(stations[i].station_id, stations[i + 1].station_id);
            if (dist) totalDistance += dist.distance_km;
            totalCargoCount += stations[i].cargo_count || 0;
            totalWeight += stations[i].cargo_weight || 0;
        }

        totalCargoCount += stations[stations.length - 1].cargo_count || 0;
        totalWeight += stations[stations.length - 1].cargo_weight || 0;

        const lastDistance = db.prepare(
            'SELECT distance_km FROM distances WHERE from_station_id = ? AND to_station_id = ?'
        ).get(stations[stations.length - 1].station_id, center.id);
        if (lastDistance) totalDistance += lastDistance.distance_km;

        const totalCost = totalDistance + vehicle.rental_cost;

        const routeOrder = JSON.stringify(stations.map(s => s.station_id));
        const result = db.prepare(`
            INSERT INTO routes (vehicle_id, plan_date, total_distance_km, total_cost, total_cargo_count, total_weight_kg, route_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(vehicle_id, plan_date, totalDistance, totalCost, totalCargoCount, totalWeight, routeOrder);

        const routeId = result.lastInsertRowid;

        const insertDetail = db.prepare(`
            INSERT INTO route_details (route_id, station_id, sequence_order, cargo_count, cargo_weight_kg)
            VALUES (?, ?, ?, ?, ?)
        `);

        insertDetail.run(routeId, center.id, 0, 0, 0);

        stations.forEach((station, index) => {
            insertDetail.run(routeId, station.station_id, index + 1, station.cargo_count || 0, station.cargo_weight || 0);
        });

        insertDetail.run(routeId, center.id, stations.length + 1, 0, 0);

        res.status(201).json({
            message: 'Rota oluşturuldu',
            routeId,
            totalDistance,
            totalCost
        });
    } catch (error) {
        res.status(500).json({ error: 'Rota oluşturulamadı', message: error.message });
    }
});

router.delete('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        db.prepare('DELETE FROM route_details WHERE route_id = ?').run(id);

        const result = db.prepare('DELETE FROM routes WHERE id = ?').run(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Rota bulunamadı' });
        }

        res.json({ message: 'Rota silindi' });
    } catch (error) {
        res.status(500).json({ error: 'Rota silinemedi', message: error.message });
    }
});

router.delete('/clear/all', authenticateToken, isAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM trips').run();
        db.prepare('DELETE FROM route_details').run();
        db.prepare('DELETE FROM routes').run();
        db.prepare('DELETE FROM vehicles WHERE is_rented = 1').run();
        db.prepare("UPDATE cargos SET status = 'pending' WHERE status IN ('assigned', 'in_transit', 'delivered')").run();
        
        res.json({ message: 'Tüm rotalar temizlendi' });
    } catch (error) {
        res.status(500).json({ error: 'Temizleme hatası', message: error.message });
    }
});

router.post('/:id/start-trip', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(id);
        if (!route) {
            return res.status(404).json({ error: 'Rota bulunamadı' });
        }

        db.prepare(
            'INSERT INTO trips (route_id, vehicle_id, status) VALUES (?, ?, ?)'
        ).run(id, route.vehicle_id, 'started');
        const tripIdResult = db.prepare('SELECT last_insert_rowid() as id').get();

        db.prepare("UPDATE routes SET status = 'in_progress' WHERE id = ?").run(id);

        const routeInfo = db.prepare('SELECT plan_date, route_order FROM routes WHERE id = ?').get(id);

        let stationIds = [];
        const details = db.prepare('SELECT station_id FROM route_details WHERE route_id = ?').all(id);
        
        if (details && details.length > 0) {
            stationIds = details.map(d => d.station_id);
        } else if (routeInfo.route_order) {
            try {
                stationIds = JSON.parse(routeInfo.route_order);
            } catch (e) {
                console.error('route_order parse error:', e);
            }
        }

        if (stationIds.length > 0) {
            const placeholders = stationIds.map(() => '?').join(',');
            db.prepare(`
                UPDATE cargos 
                SET status = 'in_transit' 
                WHERE station_id IN (${placeholders}) 
                AND status = 'assigned' 
                AND delivery_date = ?
            `).run(...stationIds, routeInfo.plan_date);
        }

        res.json({
            message: 'Sefer başlatıldı',
            tripId: tripIdResult.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Sefer başlatılamadı', message: error.message });
    }
});

router.post('/:id/complete-trip', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const trip = db.prepare(
            "SELECT * FROM trips WHERE route_id = ? AND status = 'started'"
        ).get(id);

        if (!trip) {
            return res.status(404).json({ error: 'Aktif sefer bulunamadı' });
        }

        db.prepare(`
            UPDATE trips 
            SET status = 'completed', end_time = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(trip.id);

        db.prepare("UPDATE routes SET status = 'completed' WHERE id = ?").run(id);

        const routeInfo = db.prepare('SELECT plan_date, route_order FROM routes WHERE id = ?').get(id);

        let stationIds = [];
        const details = db.prepare('SELECT station_id FROM route_details WHERE route_id = ?').all(id);
        
        if (details && details.length > 0) {
            stationIds = details.map(d => d.station_id);
        } else if (routeInfo.route_order) {
            try {
                stationIds = JSON.parse(routeInfo.route_order);
            } catch (e) {
                console.error('route_order parse error:', e);
            }
        }

        if (stationIds.length > 0) {
            const placeholders = stationIds.map(() => '?').join(',');
            db.prepare(`
                UPDATE cargos 
                SET status = 'delivered' 
                WHERE station_id IN (${placeholders}) 
                AND status IN ('in_transit', 'assigned') 
                AND delivery_date = ?
            `).run(...stationIds, routeInfo.plan_date);
        }

        res.json({ message: 'Sefer tamamlandı' });
    } catch (error) {
        res.status(500).json({ error: 'Sefer tamamlanamadı', message: error.message });
    }
});

module.exports = router;
