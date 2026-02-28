const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');
const RouteOptimizer = require('../algorithms/routeOptimizer');

router.post('/optimize', authenticateToken, isAdmin, async (req, res) => {
    try {
        const {
            problem_type = 'unlimited_vehicles',
            optimization_type = 'max_cargo_count',
            delivery_date
        } = req.body;

        const stations = db.prepare('SELECT * FROM stations').all();
        const distances = db.prepare('SELECT * FROM distances').all();
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE is_rented = 0 ORDER BY capacity_kg DESC').all();

        let cargos;
        if (delivery_date) {
            cargos = db.prepare(
                "SELECT * FROM cargos WHERE status = 'pending' AND delivery_date = ?"
            ).all(delivery_date);
        } else {
            cargos = db.prepare("SELECT * FROM cargos WHERE status = 'pending'").all();
        }

        if (cargos.length === 0) {
            return res.json({
                success: true,
                message: 'Taşınacak kargo bulunamadı',
                routes: [],
                summary: {
                    totalDistance: 0,
                    totalCost: 0,
                    totalCargoCount: 0,
                    totalCargoWeight: 0,
                    vehiclesUsed: 0
                }
            });
        }

        const optimizer = new RouteOptimizer(stations, distances, vehicles, cargos);

        let result;
        if (problem_type === 'unlimited_vehicles') {
            result = optimizer.solveUnlimitedVehicles();
        } else {
            result = optimizer.solveLimitedVehicles(optimization_type);
        }

        const planningResult = db.prepare(`
            INSERT INTO planning_results 
            (problem_type, optimization_type, total_vehicles_used, total_distance_km, 
             total_cost, total_cargo_delivered, total_weight_delivered, computation_time_ms, result_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            problem_type,
            optimization_type,
            result.summary.vehiclesUsed,
            parseFloat(result.summary.totalDistance),
            parseFloat(result.summary.totalCost),
            result.summary.totalCargoCount,
            parseFloat(result.summary.totalCargoWeight),
            result.computationTime,
            JSON.stringify(result)
        );

        result.planningId = planningResult.lastInsertRowid;
        res.json(result);
    } catch (error) {
        console.error('Optimizasyon hatası:', error);
        res.status(500).json({ error: 'Rota optimizasyonu başarısız', message: error.message });
    }
});

router.post('/save-routes', authenticateToken, isAdmin, (req, res) => {
    try {
        const { routes, plan_date } = req.body;

        if (!routes || routes.length === 0) {
            return res.status(400).json({ error: 'Kaydedilecek rota yok' });
        }

        const today = new Date().toISOString().split('T')[0];
        const planDate = plan_date || today;

        const savedRoutes = [];
        const center = db.prepare('SELECT * FROM stations WHERE is_center = 1').get();

        const saveRoute = db.transaction(() => {
            routes.forEach((routeData, idx) => {
                let vehicleId = routeData.vehicle_id;
                if (routeData.is_rented && vehicleId >= 1000) {
                    const uniqueName = `Kiralık Araç ${Date.now()}_${idx}`;
                    db.prepare(
                        'INSERT INTO vehicles (name, capacity_kg, rental_cost, is_rented) VALUES (?, ?, ?, 1)'
                    ).run(uniqueName, routeData.vehicle_capacity, routeData.rental_cost);
                    const vehicleIdResult = db.prepare('SELECT last_insert_rowid() as id').get();
                    vehicleId = vehicleIdResult.id;
                }

                const routeOrder = JSON.stringify(routeData.stations.map(s => s.station_id));
                db.prepare(`
                    INSERT INTO routes 
                    (vehicle_id, plan_date, total_distance_km, total_cost, total_cargo_count, total_weight_kg, route_order, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')
                `).run(
                    vehicleId,
                    planDate,
                    routeData.distance_km,
                    routeData.cost,
                    routeData.cargo_count,
                    routeData.cargo_weight,
                    routeOrder
                );

                const routeIdResult = db.prepare('SELECT last_insert_rowid() as id').get();
                const routeId = routeIdResult.id;
                console.log('Saving route details for route ID:', routeId);

                const insertDetail = db.prepare(`
                    INSERT INTO route_details (route_id, station_id, sequence_order, cargo_count, cargo_weight_kg)
                    VALUES (?, ?, ?, ?, ?)
                `);

                routeData.stations.forEach((station, idx) => {
                    console.log('Inserting station:', station.station_id, 'at order:', idx);
                    insertDetail.run(routeId, station.station_id, idx, station.cargo_count, station.cargo_weight);

                    db.prepare(`
                        UPDATE cargos 
                        SET status = 'assigned' 
                        WHERE station_id = ? AND status = 'pending' AND delivery_date = ?
                    `).run(station.station_id, planDate);
                });

                console.log('Inserting center end');
                insertDetail.run(routeId, center.id, routeData.stations.length, 0, 0);

                console.log('Route saved with', routeData.stations.length + 1, 'details');

                savedRoutes.push({
                    routeId,
                    vehicleId,
                    vehicleName: routeData.vehicle_name
                });
            });
        });

        saveRoute();

        res.json({
            message: `${savedRoutes.length} rota kaydedildi`,
            routes: savedRoutes
        });
    } catch (error) {
        res.status(500).json({ error: 'Rotalar kaydedilemedi', message: error.message });
    }
});

router.get('/history', authenticateToken, (req, res) => {
    try {
        const history = db.prepare(`
            SELECT * FROM planning_results 
            ORDER BY created_at DESC 
            LIMIT 50
        `).all();

        res.json(history.map(h => ({
            ...h,
            result_data: JSON.parse(h.result_data || '{}')
        })));
    } catch (error) {
        res.status(500).json({ error: 'Geçmiş alınamadı', message: error.message });
    }
});

router.get('/stats', authenticateToken, (req, res) => {
    try {
        const stats = {
            totalCargos: db.prepare('SELECT COUNT(*) as count FROM cargos').get().count,
            pendingCargos: db.prepare("SELECT COUNT(*) as count FROM cargos WHERE status = 'pending'").get().count,
            deliveredCargos: db.prepare("SELECT COUNT(*) as count FROM cargos WHERE status = 'delivered'").get().count,
            totalRoutes: db.prepare('SELECT COUNT(*) as count FROM routes').get().count,
            completedRoutes: db.prepare("SELECT COUNT(*) as count FROM routes WHERE status = 'completed'").get().count,
            totalVehicles: db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count,
            ownVehicles: db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE is_rented = 0').get().count,
            totalStations: db.prepare('SELECT COUNT(*) as count FROM stations WHERE is_center = 0').get().count,
            totalTripsCostSum: db.prepare('SELECT COALESCE(SUM(total_cost), 0) as total FROM routes').get().total,
            totalDistanceSum: db.prepare('SELECT COALESCE(SUM(total_distance_km), 0) as total FROM routes').get().total
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'İstatistikler alınamadı', message: error.message });
    }
});

router.post('/compare', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { delivery_date } = req.body;

        const stations = db.prepare('SELECT * FROM stations').all();
        const distances = db.prepare('SELECT * FROM distances').all();
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE is_rented = 0 ORDER BY capacity_kg DESC').all();

        let cargos;
        if (delivery_date) {
            cargos = db.prepare(
                "SELECT * FROM cargos WHERE status = 'pending' AND delivery_date = ?"
            ).all(delivery_date);
        } else {
            cargos = db.prepare("SELECT * FROM cargos WHERE status = 'pending'").all();
        }

        if (cargos.length === 0) {
            return res.json({
                message: 'Taşınacak kargo bulunamadı',
                comparisons: []
            });
        }

        const optimizer = new RouteOptimizer(stations, distances, vehicles, cargos);

        const results = {
            unlimited_vehicles: optimizer.solveUnlimitedVehicles(),
            limited_max_count: optimizer.solveLimitedVehicles('max_cargo_count'),
            limited_max_weight: optimizer.solveLimitedVehicles('max_cargo_weight')
        };

        res.json({
            success: true,
            comparisons: [
                {
                    name: 'Sınırsız Araç',
                    description: 'Minimum maliyet ile tüm kargoları taşı',
                    ...results.unlimited_vehicles
                },
                {
                    name: 'Belirli Araç - Max Kargo Sayısı',
                    description: 'Mevcut araçlarla maksimum kargo sayısı',
                    ...results.limited_max_count
                },
                {
                    name: 'Belirli Araç - Max Kargo Ağırlığı',
                    description: 'Mevcut araçlarla maksimum kargo ağırlığı',
                    ...results.limited_max_weight
                }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: 'Karşılaştırma başarısız', message: error.message });
    }
});

module.exports = router;
