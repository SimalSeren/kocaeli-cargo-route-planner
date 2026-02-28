const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');

let RENTAL_COST_PER_500KG = 200;
let RENTAL_VEHICLE_CAPACITY = 500;
let FUEL_COST_PER_KM = 1;

router.get('/params', authenticateToken, (req, res) => {
    try {
        res.json({
            rental_cost_per_500kg: RENTAL_COST_PER_500KG,
            rental_vehicle_capacity: RENTAL_VEHICLE_CAPACITY,
            fuel_cost_per_km: FUEL_COST_PER_KM
        });
    } catch (error) {
        res.status(500).json({ error: 'Parametreler alınamadı', message: error.message });
    }
});

router.put('/params', authenticateToken, isAdmin, (req, res) => {
    try {
        const { rental_cost_per_500kg, rental_vehicle_capacity, fuel_cost_per_km } = req.body;
        
        if (rental_cost_per_500kg !== undefined) {
            RENTAL_COST_PER_500KG = parseFloat(rental_cost_per_500kg);
        }
        if (rental_vehicle_capacity !== undefined) {
            RENTAL_VEHICLE_CAPACITY = parseInt(rental_vehicle_capacity);
        }
        if (fuel_cost_per_km !== undefined) {
            FUEL_COST_PER_KM = parseFloat(fuel_cost_per_km);
        }
        
        res.json({
            message: 'Parametreler güncellendi',
            rental_cost_per_500kg: RENTAL_COST_PER_500KG,
            rental_vehicle_capacity: RENTAL_VEHICLE_CAPACITY,
            fuel_cost_per_km: FUEL_COST_PER_KM
        });
    } catch (error) {
        res.status(500).json({ error: 'Parametreler güncellenemedi', message: error.message });
    }
});

router.get('/', (req, res) => {
    try {
        const vehicles = db.prepare('SELECT * FROM vehicles ORDER BY capacity_kg').all();
        res.json(vehicles);
    } catch (error) {
        res.status(500).json({ error: 'Araçlar alınamadı', message: error.message });
    }
});

router.get('/available', (req, res) => {
    try {
        const vehicles = db.prepare('SELECT * FROM vehicles WHERE is_rented = 0 ORDER BY capacity_kg').all();
        res.json(vehicles);
    } catch (error) {
        res.status(500).json({ error: 'Araçlar alınamadı', message: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ error: 'Araç bulunamadı' });
        }
        res.json(vehicle);
    } catch (error) {
        res.status(500).json({ error: 'Araç alınamadı', message: error.message });
    }
});

router.post('/rent', authenticateToken, isAdmin, (req, res) => {
    try {
        const { capacity_kg = 500 } = req.body;
        const rentalCost = (capacity_kg / 500) * RENTAL_COST_PER_500KG;

        const result = db.prepare(
            'INSERT INTO vehicles (name, capacity_kg, rental_cost, is_rented) VALUES (?, ?, ?, 1)'
        ).run(`Kiralık Araç ${Date.now()}`, capacity_kg, rentalCost);

        res.status(201).json({
            message: 'Araç kiralandı',
            vehicleId: result.lastInsertRowid,
            rentalCost
        });
    } catch (error) {
        res.status(500).json({ error: 'Araç kiralanamadı', message: error.message });
    }
});

router.delete('/rented/clear', authenticateToken, isAdmin, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM vehicles WHERE is_rented = 1').run();
        res.json({ message: `${result.changes} kiralık araç silindi` });
    } catch (error) {
        res.status(500).json({ error: 'Araçlar silinemedi', message: error.message });
    }
});

router.get('/stats/capacity', (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_vehicles,
                SUM(capacity_kg) as total_capacity,
                SUM(CASE WHEN is_rented = 0 THEN capacity_kg ELSE 0 END) as own_capacity,
                SUM(CASE WHEN is_rented = 1 THEN capacity_kg ELSE 0 END) as rented_capacity,
                SUM(rental_cost) as total_rental_cost
            FROM vehicles
        `).get();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'İstatistikler alınamadı', message: error.message });
    }
});

router.post('/', authenticateToken, isAdmin, (req, res) => {
    try {
        const { name, capacity_kg, rental_cost = 0, is_rented = 0 } = req.body;

        if (!name || !capacity_kg) {
            return res.status(400).json({ error: 'Araç adı ve kapasitesi gerekli' });
        }

        db.prepare(
            'INSERT INTO vehicles (name, capacity_kg, rental_cost, is_rented) VALUES (?, ?, ?, ?)'
        ).run(name, capacity_kg, rental_cost, is_rented);
        
        const vehicleId = db.prepare('SELECT last_insert_rowid() as id').get();

        res.status(201).json({
            message: 'Araç eklendi',
            vehicleId: vehicleId.id
        });
    } catch (error) {
        res.status(500).json({ error: 'Araç eklenemedi', message: error.message });
    }
});

router.put('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { name, capacity_kg, rental_cost } = req.body;

        const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
        if (!vehicle) {
            return res.status(404).json({ error: 'Araç bulunamadı' });
        }

        db.prepare(`
            UPDATE vehicles 
            SET name = COALESCE(?, name),
                capacity_kg = COALESCE(?, capacity_kg),
                rental_cost = COALESCE(?, rental_cost)
            WHERE id = ?
        `).run(name || null, capacity_kg || null, rental_cost !== undefined ? rental_cost : null, id);

        res.json({ message: 'Araç güncellendi' });
    } catch (error) {
        res.status(500).json({ error: 'Araç güncellenemedi', message: error.message });
    }
});

router.delete('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
        if (!vehicle) {
            return res.status(404).json({ error: 'Araç bulunamadı' });
        }

        const activeRoute = db.prepare(`
            SELECT COUNT(*) as count FROM routes 
            WHERE vehicle_id = ? AND status != 'completed'
        `).get(id);

        if (activeRoute.count > 0) {
            return res.status(400).json({ error: 'Aktif rotası olan araç silinemez' });
        }

        db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
        res.json({ message: 'Araç silindi' });
    } catch (error) {
        res.status(500).json({ error: 'Araç silinemedi', message: error.message });
    }
});

module.exports = router;
