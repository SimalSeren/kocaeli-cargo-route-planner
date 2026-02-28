const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, isAdmin } = require('./auth');

// Örnek senaryolar (PDF'den)
const EXAMPLE_SCENARIOS = [
    {
        id: 1,
        name: 'Senaryo 1',
        description: 'Toplam kargo ağırlığı 1445 kg, kargo adedi 113. Mevcut kapasite yeterli.',
        data: {
            'Başiskele': { cargo_count: 10, weight_kg: 120 },
            'Çayırova': { cargo_count: 8, weight_kg: 80 },
            'Darıca': { cargo_count: 15, weight_kg: 200 },
            'Derince': { cargo_count: 10, weight_kg: 150 },
            'Dilovası': { cargo_count: 12, weight_kg: 180 },
            'Gebze': { cargo_count: 5, weight_kg: 70 },
            'Gölcük': { cargo_count: 7, weight_kg: 90 },
            'Kandıra': { cargo_count: 6, weight_kg: 60 },
            'Karamürsel': { cargo_count: 9, weight_kg: 110 },
            'Kartepe': { cargo_count: 11, weight_kg: 130 },
            'Körfez': { cargo_count: 6, weight_kg: 75 },
            'İzmit': { cargo_count: 14, weight_kg: 160 }
        }
    },
    {
        id: 2,
        name: 'Senaryo 2',
        description: 'Toplam kargo ağırlığı 905 kg, kargo adedi 118. Dengesiz dağılım.',
        data: {
            'Başiskele': { cargo_count: 40, weight_kg: 200 },
            'Çayırova': { cargo_count: 35, weight_kg: 175 },
            'Darıca': { cargo_count: 10, weight_kg: 150 },
            'Derince': { cargo_count: 5, weight_kg: 100 },
            'Dilovası': { cargo_count: 0, weight_kg: 0 },
            'Gebze': { cargo_count: 8, weight_kg: 120 },
            'Gölcük': { cargo_count: 0, weight_kg: 0 },
            'Kandıra': { cargo_count: 0, weight_kg: 0 },
            'Karamürsel': { cargo_count: 0, weight_kg: 0 },
            'Kartepe': { cargo_count: 0, weight_kg: 0 },
            'Körfez': { cargo_count: 0, weight_kg: 0 },
            'İzmit': { cargo_count: 20, weight_kg: 160 }
        }
    },
    {
        id: 3,
        name: 'Senaryo 3',
        description: 'Toplam kargo ağırlığı 2700 kg. Ek araç kiralama zorunlu.',
        data: {
            'Başiskele': { cargo_count: 0, weight_kg: 0 },
            'Çayırova': { cargo_count: 3, weight_kg: 700 },
            'Darıca': { cargo_count: 0, weight_kg: 0 },
            'Derince': { cargo_count: 0, weight_kg: 0 },
            'Dilovası': { cargo_count: 4, weight_kg: 800 },
            'Gebze': { cargo_count: 5, weight_kg: 900 },
            'Gölcük': { cargo_count: 0, weight_kg: 0 },
            'Kandıra': { cargo_count: 0, weight_kg: 0 },
            'Karamürsel': { cargo_count: 0, weight_kg: 0 },
            'Kartepe': { cargo_count: 0, weight_kg: 0 },
            'Körfez': { cargo_count: 0, weight_kg: 0 },
            'İzmit': { cargo_count: 5, weight_kg: 300 }
        }
    },
    {
        id: 4,
        name: 'Senaryo 4',
        description: 'Toplam kargo ağırlığı 1150 kg, kargo sayısı 88. Optimizasyon gerekli.',
        data: {
            'Başiskele': { cargo_count: 30, weight_kg: 300 },
            'Çayırova': { cargo_count: 0, weight_kg: 0 },
            'Darıca': { cargo_count: 0, weight_kg: 0 },
            'Derince': { cargo_count: 0, weight_kg: 0 },
            'Dilovası': { cargo_count: 0, weight_kg: 0 },
            'Gebze': { cargo_count: 0, weight_kg: 0 },
            'Gölcük': { cargo_count: 15, weight_kg: 220 },
            'Kandıra': { cargo_count: 5, weight_kg: 250 },
            'Karamürsel': { cargo_count: 20, weight_kg: 180 },
            'Kartepe': { cargo_count: 10, weight_kg: 200 },
            'Körfez': { cargo_count: 8, weight_kg: 400 },
            'İzmit': { cargo_count: 0, weight_kg: 0 }
        }
    }
];

// Tüm senaryoları listele
router.get('/', (req, res) => {
    try {
        // Veritabanındaki senaryolar
        const dbScenarios = db.prepare('SELECT * FROM scenarios ORDER BY id').all();

        // Örnek senaryoları da ekle
        const allScenarios = [
            ...EXAMPLE_SCENARIOS.map(s => ({
                ...s,
                is_example: true,
                data: JSON.stringify(s.data)
            })),
            ...dbScenarios.map(s => ({ ...s, is_example: false }))
        ];

        res.json(allScenarios);
    } catch (error) {
        res.status(500).json({ error: 'Senaryolar alınamadı', message: error.message });
    }
});

// Örnek senaryoları getir
router.get('/examples', (req, res) => {
    res.json(EXAMPLE_SCENARIOS);
});

// Tek senaryo getir
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;

        // Önce örnek senaryolara bak
        const exampleScenario = EXAMPLE_SCENARIOS.find(s => s.id === parseInt(id));
        if (exampleScenario) {
            return res.json(exampleScenario);
        }

        // Veritabanında ara
        const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
        if (!scenario) {
            return res.status(404).json({ error: 'Senaryo bulunamadı' });
        }

        res.json({
            ...scenario,
            data: JSON.parse(scenario.data)
        });
    } catch (error) {
        res.status(500).json({ error: 'Senaryo alınamadı', message: error.message });
    }
});

// Yeni senaryo oluştur
router.post('/', authenticateToken, isAdmin, (req, res) => {
    try {
        const { name, description, data } = req.body;

        if (!name || !data) {
            return res.status(400).json({ error: 'Senaryo adı ve verisi gerekli' });
        }

        const result = db.prepare(
            'INSERT INTO scenarios (name, description, data) VALUES (?, ?, ?)'
        ).run(name, description || '', JSON.stringify(data));

        res.status(201).json({
            message: 'Senaryo oluşturuldu',
            scenarioId: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ error: 'Senaryo oluşturulamadı', message: error.message });
    }
});

// Senaryoyu kargoalara yükle
router.post('/:id/load', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_date } = req.body;

        // Senaryoyu bul
        let scenarioData;
        const exampleScenario = EXAMPLE_SCENARIOS.find(s => s.id === parseInt(id));

        if (exampleScenario) {
            scenarioData = exampleScenario.data;
        } else {
            const dbScenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
            if (!dbScenario) {
                return res.status(404).json({ error: 'Senaryo bulunamadı' });
            }
            scenarioData = JSON.parse(dbScenario.data);
        }

        // SENARYO YÜKLEMESİ: Önce bu teslimat tarihine ait bekleyen kargoları temizle
        // (Aynı tarih için tekrar senaryo yüklenebilmesi için)
        const today = new Date().toISOString().split('T')[0];
        const deliveryDateValue = delivery_date || today;

        // Bu tarihe ait bekleyen kargoları sil
        const deleteResult = db.prepare('DELETE FROM cargos WHERE delivery_date = ? AND status = ?')
            .run(deliveryDateValue, 'pending');
        console.log(`${deleteResult.changes} adet eski bekleyen kargo silindi (${deliveryDateValue} tarihi için)`);

        // İstasyonları al
        const stations = db.prepare('SELECT * FROM stations WHERE is_center = 0').all();
        const stationMap = {};
        stations.forEach(s => { stationMap[s.name] = s.id; });

        // Kargoları ekle
        const insertStmt = db.prepare(
            'INSERT INTO cargos (station_id, weight_kg, description, delivery_date, status) VALUES (?, ?, ?, ?, ?)'
        );

        let totalInserted = 0;
        const insertCargos = db.transaction(() => {
            for (const [stationName, data] of Object.entries(scenarioData)) {
                const stationId = stationMap[stationName];
                if (!stationId) continue;

                const { cargo_count, weight_kg } = data;
                if (cargo_count > 0 && weight_kg > 0) {
                    const weightPerCargo = weight_kg / cargo_count;
                    for (let i = 0; i < cargo_count; i++) {
                        insertStmt.run(
                            stationId,
                            weightPerCargo,
                            `${stationName} - Kargo ${i + 1}`,
                            deliveryDateValue,
                            'pending'
                        );
                        totalInserted++;
                    }
                }
            }
        });

        insertCargos();

        res.json({
            message: `Senaryo yüklendi. ${totalInserted} kargo eklendi.`,
            cargoCount: totalInserted
        });
    } catch (error) {
        res.status(500).json({ error: 'Senaryo yüklenemedi', message: error.message });
    }
});

// Senaryo sil
router.delete('/:id', authenticateToken, isAdmin, (req, res) => {
    try {
        const { id } = req.params;

        // Örnek senaryolar silinemez
        const exampleScenario = EXAMPLE_SCENARIOS.find(s => s.id === parseInt(id));
        if (exampleScenario) {
            return res.status(400).json({ error: 'Örnek senaryolar silinemez' });
        }

        const result = db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Senaryo bulunamadı' });
        }

        res.json({ message: 'Senaryo silindi' });
    } catch (error) {
        res.status(500).json({ error: 'Senaryo silinemedi', message: error.message });
    }
});

module.exports = router;
module.exports.EXAMPLE_SCENARIOS = EXAMPLE_SCENARIOS;
