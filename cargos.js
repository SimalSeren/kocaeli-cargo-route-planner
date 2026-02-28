const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');

router.get('/', authenticateToken, (req, res) => {
    try {
        let cargos;
        if (req.user.role === 'admin') {
            cargos = db.prepare(`
                SELECT c.*, s.name as station_name, u.username as sender_name
                FROM cargos c
                JOIN stations s ON c.station_id = s.id
                LEFT JOIN users u ON c.sender_id = u.id
                ORDER BY c.created_at DESC
            `).all();
        } else {
            cargos = db.prepare(`
                SELECT c.*, s.name as station_name
                FROM cargos c
                JOIN stations s ON c.station_id = s.id
                WHERE c.sender_id = ?
                ORDER BY c.created_at DESC
            `).all(req.user.id);
        }
        res.json(cargos);
    } catch (error) {
        res.status(500).json({ error: 'Kargolar alınamadı', message: error.message });
    }
});

router.get('/pending', authenticateToken, isAdmin, (req, res) => {
    try {
        const cargos = db.prepare(`
            SELECT c.*, s.name as station_name, u.username as sender_name
            FROM cargos c
            JOIN stations s ON c.station_id = s.id
            LEFT JOIN users u ON c.sender_id = u.id
            WHERE c.status = 'pending'
            ORDER BY c.delivery_date ASC, c.created_at ASC
        `).all();
        res.json(cargos);
    } catch (error) {
        res.status(500).json({ error: 'Kargolar alınamadı', message: error.message });
    }
});

router.get('/by-date/:date', authenticateToken, (req, res) => {
    try {
        const { date } = req.params;
        const cargos = db.prepare(`
            SELECT c.*, s.name as station_name, u.username as sender_name
            FROM cargos c
            JOIN stations s ON c.station_id = s.id
            LEFT JOIN users u ON c.sender_id = u.id
            WHERE c.delivery_date = ? AND c.status = 'pending'
            ORDER BY s.name
        `).all(date);
        res.json(cargos);
    } catch (error) {
        res.status(500).json({ error: 'Kargolar alınamadı', message: error.message });
    }
});

router.get('/summary/by-station', authenticateToken, (req, res) => {
    try {
        const { date } = req.query;
        let query = `
            SELECT 
                s.id as station_id,
                s.name as station_name,
                s.latitude,
                s.longitude,
                COUNT(c.id) as cargo_count,
                COALESCE(SUM(c.weight_kg), 0) as total_weight
            FROM stations s
            LEFT JOIN cargos c ON s.id = c.station_id AND c.status = 'pending'
        `;

        if (date) {
            query += ` AND c.delivery_date = '${date}'`;
        }

        query += `
            WHERE s.is_center = 0
            GROUP BY s.id
            ORDER BY s.name
        `;

        const summary = db.prepare(query).all();
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: 'Özet alınamadı', message: error.message });
    }
});

router.get('/:id', authenticateToken, (req, res) => {
    try {
        const cargo = db.prepare(`
            SELECT c.*, s.name as station_name
            FROM cargos c
            JOIN stations s ON c.station_id = s.id
            WHERE c.id = ?
        `).get(req.params.id);

        if (!cargo) {
            return res.status(404).json({ error: 'Kargo bulunamadı' });
        }

        if (req.user.role !== 'admin' && cargo.sender_id !== req.user.id) {
            return res.status(403).json({ error: 'Bu kargoya erişim yetkiniz yok' });
        }

        res.json(cargo);
    } catch (error) {
        res.status(500).json({ error: 'Kargo alınamadı', message: error.message });
    }
});

router.post('/', authenticateToken, (req, res) => {
    try {
        const { station_id, weight_kg, description, delivery_date } = req.body;

        if (!station_id) {
            return res.status(400).json({ error: 'İstasyon seçimi zorunludur' });
        }

        if (!weight_kg || weight_kg <= 0) {
            return res.status(400).json({ error: 'Geçerli bir ağırlık girilmelidir' });
        }

        const station = db.prepare('SELECT * FROM stations WHERE id = ? AND is_center = 0').get(station_id);
        if (!station) {
            return res.status(400).json({ error: 'Geçersiz istasyon. Sadece ilçe istasyonları seçilebilir.' });
        }

        const today = new Date().toISOString().split('T')[0];
        const deliveryDateValue = delivery_date || today;

        if (deliveryDateValue < today) {
            return res.status(400).json({ error: 'Teslimat tarihi bugün veya sonrası olmalıdır' });
        }

        const result = db.prepare(
            'INSERT INTO cargos (sender_id, station_id, weight_kg, description, delivery_date) VALUES (?, ?, ?, ?, ?)'
        ).run(req.user.id, station_id, weight_kg, description || '', deliveryDateValue);

        res.status(201).json({
            message: 'Kargo başarıyla oluşturuldu',
            cargoId: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ error: 'Kargo oluşturulamadı', message: error.message });
    }
});

router.post('/bulk', authenticateToken, isAdmin, (req, res) => {
    try {
        const { cargos, delivery_date } = req.body;

        if (!cargos || !Array.isArray(cargos)) {
            return res.status(400).json({ error: 'Kargo listesi gerekli' });
        }

        const today = new Date().toISOString().split('T')[0];
        const deliveryDateValue = delivery_date || today;

        const insertStmt = db.prepare(
            'INSERT INTO cargos (station_id, weight_kg, description, delivery_date, status) VALUES (?, ?, ?, ?, ?)'
        );

        const insertMany = db.transaction((cargoList) => {
            let inserted = 0;
            for (const cargo of cargoList) {
                const { station_id, weight_kg, count = 1 } = cargo;

                const weightPerCargo = weight_kg / count;
                for (let i = 0; i < count; i++) {
                    insertStmt.run(station_id, weightPerCargo, `Toplu kargo ${i + 1}`, deliveryDateValue, 'pending');
                    inserted++;
                }
            }
            return inserted;
        });

        const insertedCount = insertMany(cargos);

        res.status(201).json({
            message: `${insertedCount} kargo başarıyla eklendi`,
            count: insertedCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Kargolar eklenemedi', message: error.message });
    }
});

router.put('/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const { station_id, weight_kg, description, status } = req.body;

        const cargo = db.prepare('SELECT * FROM cargos WHERE id = ?').get(id);
        if (!cargo) {
            return res.status(404).json({ error: 'Kargo bulunamadı' });
        }

        if (req.user.role !== 'admin') {
            if (cargo.sender_id !== req.user.id) {
                return res.status(403).json({ error: 'Bu kargoya erişim yetkiniz yok' });
            }
            if (cargo.status !== 'pending') {
                return res.status(400).json({ error: 'Sadece bekleyen kargolar güncellenebilir' });
            }
        }

        db.prepare(`
            UPDATE cargos 
            SET station_id = ?, weight_kg = ?, description = ?, status = ?
            WHERE id = ?
        `).run(
            station_id || cargo.station_id,
            weight_kg || cargo.weight_kg,
            description !== undefined ? description : cargo.description,
            status || cargo.status,
            id
        );

        res.json({ message: 'Kargo güncellendi' });
    } catch (error) {
        res.status(500).json({ error: 'Kargo güncellenemedi', message: error.message });
    }
});

router.delete('/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;

        const cargo = db.prepare('SELECT * FROM cargos WHERE id = ?').get(id);
        if (!cargo) {
            return res.status(404).json({ error: 'Kargo bulunamadı' });
        }

        if (req.user.role !== 'admin') {
            if (cargo.sender_id !== req.user.id) {
                return res.status(403).json({ error: 'Bu kargoya erişim yetkiniz yok' });
            }
            if (cargo.status !== 'pending') {
                return res.status(400).json({ error: 'Sadece bekleyen kargolar silinebilir' });
            }
        }

        db.prepare('DELETE FROM cargos WHERE id = ?').run(id);
        res.json({ message: 'Kargo silindi' });
    } catch (error) {
        res.status(500).json({ error: 'Kargo silinemedi', message: error.message });
    }
});

router.delete('/clear/pending', authenticateToken, isAdmin, (req, res) => {
    res.status(403).json({
        error: 'Bu işlem deaktif edilmiştir',
        message: 'Proje gereksinimlerine göre eski veriler silinemez. Tüm kargo geçmişi saklanmalıdır.'
    });
});

module.exports = router;
